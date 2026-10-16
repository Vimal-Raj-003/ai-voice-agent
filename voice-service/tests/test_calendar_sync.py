"""Cal.com ↔ local DB booking synchronisation (Phase: Cal.com + local DB).

Covers the orchestration required by the spec without a live Cal.com account:
the Cal.com HTTP layer is stubbed (tools.calcom_slot_free / calcom_book) and the
DB layer is stubbed, so we assert the *decision logic* — the part that keeps the
two systems consistent — which is what must not regress.
"""

from unittest.mock import MagicMock

import pytest

import tools
from tools import AppointmentTools

CALCOM_ENV = {"CALCOM_API_KEY": "cal_test_key", "CALCOM_EVENT_TYPE_ID": "42"}


def _enable_calcom(monkeypatch):
    for k, v in CALCOM_ENV.items():
        monkeypatch.setenv(k, v)


def _disable_calcom(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)


def _tools():
    return AppointmentTools(MagicMock(), "+919876500000", "Ravi")


# ── TEST 1: both free → booked in Cal.com and local DB ──────────────────────
@pytest.mark.asyncio
async def test_book_success_syncs_both(monkeypatch):
    _enable_calcom(monkeypatch)
    calls = {}

    async def slot_free(date, time, call_id=""):
        return True
    async def check_slot(date, time):
        return True
    async def book(name, email, phone, date, time, service, notes="", call_id=""):
        calls["booked"] = True
        return {"success": True, "uid": "CAL-UID-1", "message": "ok"}
    async def insert(name, phone, date, time, service, **kw):
        calls["calcom_uid"] = kw.get("calcom_uid")
        return "LOCAL123"

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    monkeypatch.setattr(tools, "calcom_book", book)
    monkeypatch.setattr("tools.db.check_slot", check_slot)
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    out = await _tools().book_appointment("Ravi", "2026-06-01", "10:00", "demo")
    assert calls.get("booked") is True
    assert calls.get("calcom_uid") == "CAL-UID-1"   # local row linked to Cal.com
    assert "LOCAL123" in out


# ── TEST 2: busy in Cal.com → must NOT book ─────────────────────────────────
@pytest.mark.asyncio
async def test_calcom_busy_blocks_booking(monkeypatch):
    _enable_calcom(monkeypatch)
    booked = {"v": False}
    inserted = {"v": False}

    async def slot_free(date, time, call_id=""):
        return False
    async def book(*a, **k):
        booked["v"] = True
        return {"success": True, "uid": "x"}
    async def insert(*a, **k):
        inserted["v"] = True
        return "X"

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    monkeypatch.setattr(tools, "calcom_book", book)
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    out = await _tools().book_appointment("Ravi", "2026-06-01", "10:00", "demo")
    assert booked["v"] is False
    assert inserted["v"] is False
    assert "another time" in out.lower()


# ── TEST 3: busy only in local DB → must NOT book ───────────────────────────
@pytest.mark.asyncio
async def test_local_busy_blocks_booking(monkeypatch):
    _enable_calcom(monkeypatch)
    booked = {"v": False}

    async def slot_free(date, time, call_id=""):
        return True
    async def check_slot(date, time):
        return False
    async def next_avail(date, time):
        return "2026-06-01 at 11:00"
    async def book(*a, **k):
        booked["v"] = True
        return {"success": True, "uid": "x"}

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    monkeypatch.setattr(tools, "calcom_book", book)
    monkeypatch.setattr("tools.db.check_slot", check_slot)
    monkeypatch.setattr("tools.db.get_next_available", next_avail)

    out = await _tools().book_appointment("Ravi", "2026-06-01", "10:00", "demo")
    assert booked["v"] is False
    assert "11:00" in out


# ── TEST 4: Cal.com API failure → no booking reported ───────────────────────
@pytest.mark.asyncio
async def test_calcom_api_error_no_booking(monkeypatch):
    _enable_calcom(monkeypatch)
    inserted = {"v": False}

    async def slot_free(date, time, call_id=""):
        return None  # unknown / API error
    async def insert(*a, **k):
        inserted["v"] = True
        return "X"

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    out = await _tools().book_appointment("Ravi", "2026-06-01", "10:00", "demo")
    assert inserted["v"] is False
    assert "can't reach the calendar" in out.lower()


# ── TEST 5: Cal.com success but local write fails → inconsistency reported ──
@pytest.mark.asyncio
async def test_calcom_ok_local_fail_reports_inconsistency(monkeypatch):
    _enable_calcom(monkeypatch)

    async def slot_free(date, time, call_id=""):
        return True
    async def check_slot(date, time):
        return True
    async def book(*a, **k):
        return {"success": True, "uid": "CAL-UID-9", "message": "ok"}
    async def insert(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    monkeypatch.setattr(tools, "calcom_book", book)
    monkeypatch.setattr("tools.db.check_slot", check_slot)
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    t = _tools()
    out = await t.book_appointment("Ravi", "2026-06-01", "10:00", "demo")
    # Cal.com is the source of truth: booking is reported confirmed with its ref,
    # not a silent failure or a fake local success.
    assert "CAL-UID-9" in out
    assert t._last_booking_id == "CAL-UID-9"


# ── TEST 6: cancellation → Cal.com cancelled then local synced ──────────────
@pytest.mark.asyncio
async def test_cancel_syncs_local(monkeypatch):
    _enable_calcom(monkeypatch)
    synced = {"uid": None}

    async def cancel(uid, reason="", call_id=""):
        return {"success": True, "message": "cancelled"}
    async def local_cancel(uid):
        synced["uid"] = uid
        return True

    monkeypatch.setattr(tools, "calcom_cancel", cancel)
    monkeypatch.setattr("tools.db.cancel_appointment_by_calcom_uid", local_cancel)

    out = await _tools().cancel_calcom("CAL-UID-1", "caller request")
    assert synced["uid"] == "CAL-UID-1"
    assert "cancelled" in out.lower()


@pytest.mark.asyncio
async def test_cancel_calcom_fail_does_not_sync_local(monkeypatch):
    _enable_calcom(monkeypatch)
    synced = {"v": False}

    async def cancel(uid, reason="", call_id=""):
        return {"success": False, "message": "HTTP 500"}
    async def local_cancel(uid):
        synced["v"] = True
        return True

    monkeypatch.setattr(tools, "calcom_cancel", cancel)
    monkeypatch.setattr("tools.db.cancel_appointment_by_calcom_uid", local_cancel)

    out = await _tools().cancel_calcom("CAL-UID-1")
    assert synced["v"] is False
    assert "failed" in out.lower()


# ── Local-only fallback: Cal.com not configured → books local DB only ───────
@pytest.mark.asyncio
async def test_local_only_when_calcom_unconfigured(monkeypatch):
    _disable_calcom(monkeypatch)
    seen = {}

    async def book(*a, **k):
        seen["calcom_called"] = True
        return {"success": True, "uid": "x"}
    async def insert(name, phone, date, time, service, **kw):
        seen["calcom_uid"] = kw.get("calcom_uid")
        return "LOCALONLY1"

    monkeypatch.setattr(tools, "calcom_book", book)
    monkeypatch.setattr("tools.db.insert_appointment", insert)

    out = await _tools().book_appointment("Ravi", "2026-06-01", "10:00", "demo")
    assert "calcom_called" not in seen          # Cal.com never contacted
    assert seen.get("calcom_uid") is None
    assert "LOCALONLY1" in out


# ── Availability: both free → available ─────────────────────────────────────
@pytest.mark.asyncio
async def test_availability_available_when_both_free(monkeypatch):
    _enable_calcom(monkeypatch)

    async def slot_free(date, time, call_id=""):
        return True
    async def check_slot(date, time):
        return True

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    monkeypatch.setattr("tools.db.check_slot", check_slot)
    out = await _tools().check_availability("2026-06-01", "10:00")
    assert out == "available"


@pytest.mark.asyncio
async def test_availability_provider_down_is_not_available(monkeypatch):
    _enable_calcom(monkeypatch)

    async def slot_free(date, time, call_id=""):
        return None

    monkeypatch.setattr(tools, "calcom_slot_free", slot_free)
    out = await _tools().check_availability("2026-06-01", "10:00")
    assert "available" != out
    assert "can't reach the calendar" in out.lower()
