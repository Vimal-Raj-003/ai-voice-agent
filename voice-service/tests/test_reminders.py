"""Customer appointment-reminder flow: scheduling, duplicate protection, and
the persistent poller. Cal.com and the DB/notify layers are stubbed so the
orchestration (what must not regress) is tested without live providers."""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest

import config
from tools import AppointmentTools, reminder_at_utc


def _no_calcom(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)


def _future_slot():
    d = datetime.now(UTC) + timedelta(days=3)
    return d.strftime("%Y-%m-%d"), "15:00"


# ── reminder_at_utc ─────────────────────────────────────────────────────────
def test_reminder_at_in_future(monkeypatch):
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", True)
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_MINUTES_BEFORE", 60)
    date, time = _future_slot()
    ra = reminder_at_utc(date, time)
    assert ra is not None and ra > datetime.now(UTC)


def test_reminder_at_disabled(monkeypatch):
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", False)
    date, time = _future_slot()
    assert reminder_at_utc(date, time) is None


def test_reminder_at_past_slot(monkeypatch):
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", True)
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_MINUTES_BEFORE", 60)
    assert reminder_at_utc("2020-01-01", "10:00") is None


# ── TEST 4: booking schedules a reminder ────────────────────────────────────
@pytest.mark.asyncio
async def test_book_schedules_reminder(monkeypatch):
    _no_calcom(monkeypatch)
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", True)
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_MINUTES_BEFORE", 60)
    captured = {}

    async def insert(name, phone, date, time, service, **kw):
        captured.update(kw)
        return "BK1"
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    date, time = _future_slot()
    out = await AppointmentTools(MagicMock(), "+919000000003", "Ravi").book_appointment(
        "Ravi", date, time, "demo")
    assert captured.get("reminder_at") is not None          # reminder scheduled
    assert "remind you" in out.lower()


# ── TEST 8: duplicate tool call → one booking, one reminder ─────────────────
@pytest.mark.asyncio
async def test_duplicate_booking_suppressed(monkeypatch):
    _no_calcom(monkeypatch)
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", True)
    calls = {"n": 0}

    async def insert(name, phone, date, time, service, **kw):
        calls["n"] += 1
        return "BK2"
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    t = AppointmentTools(MagicMock(), "+919000000004", "Ravi")
    date, time = _future_slot()
    out1 = await t.book_appointment("Ravi", date, time, "demo")
    out2 = await t.book_appointment("Ravi", date, time, "demo")
    assert calls["n"] == 1          # second call did not insert again
    assert out1 == out2             # same confirmation returned


# ── Poller: sends once and marks SENT ───────────────────────────────────────
@pytest.mark.asyncio
async def test_poll_reminders_sends_once(monkeypatch):
    import server
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", True)
    sent_ids, marked = [], []

    async def due(limit=50):
        return [{"reminder_id": "R1", "customer_phone": "+919000000005", "channel": "whatsapp",
                 "retry_count": 0, "name": "Ravi", "date": "2026-12-01", "time": "15:00", "service": "demo"}]
    def send(phone, name, business, readable):
        sent_ids.append(phone)
        return True
    async def mark_sent(rid):
        marked.append(rid)

    monkeypatch.setattr("server.db.due_reminders", due)
    monkeypatch.setattr("server.notify.notify_appointment_reminder", send)
    monkeypatch.setattr("server.db.mark_reminder_sent", mark_sent)

    await server._poll_reminders()
    assert sent_ids == ["+919000000005"]
    assert marked == ["R1"]


# ── Poller: delivery failure → mark_reminder_failed (retry/ceiling) ─────────
@pytest.mark.asyncio
async def test_poll_reminders_failure_marks_failed(monkeypatch):
    import server
    monkeypatch.setattr(config, "APPOINTMENT_REMINDER_ENABLED", True)
    failed = []

    async def due(limit=50):
        return [{"reminder_id": "R2", "customer_phone": "+91900", "channel": "whatsapp",
                 "retry_count": 0, "name": "X", "date": "2026-12-01", "time": "15:00", "service": "demo"}]
    def send(*a, **k):
        return False
    async def mark_failed(rid, err, maxr):
        failed.append((rid, maxr))
    async def mark_sent(rid):
        raise AssertionError("must not mark SENT on failure")

    monkeypatch.setattr("server.db.due_reminders", due)
    monkeypatch.setattr("server.notify.notify_appointment_reminder", send)
    monkeypatch.setattr("server.db.mark_reminder_failed", mark_failed)
    monkeypatch.setattr("server.db.mark_reminder_sent", mark_sent)

    await server._poll_reminders()
    assert failed and failed[0][0] == "R2"


# ── notify customer-reminder message content ────────────────────────────────
def test_reminder_message_targets_customer(monkeypatch):
    import notify
    captured = {}
    def fake_wa(to, msg):
        captured["to"] = to
        captured["msg"] = msg
        return True
    monkeypatch.setattr(notify, "send_whatsapp", fake_wa)
    ok = notify.notify_appointment_reminder("+919000000006", "Ravi", "JillJill",
                                            "Monday, 01 December 2026 at 03:00 PM IST")
    assert ok is True
    assert captured["to"] == "+919000000006"            # goes to the CUSTOMER
    assert "Ravi" in captured["msg"] and "JillJill" in captured["msg"]
