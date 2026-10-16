from unittest.mock import AsyncMock, MagicMock

import pytest

from tools import AppointmentTools


def test_build_tool_list_returns_core_tools_when_empty(monkeypatch):
    """An empty `enabled` list yields the always-available core tools.

    The optional tools are deliberately gated and must NOT be in the default
    set: lookup_contact is opt-in (prior history is already in the system
    prompt, so shipping its schema every turn only burns Groq input tokens),
    and the Cal.com / Twilio tools are exposed only when their backend is
    configured, because an unusable tool's schema costs ITPM on every request.
    """
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)
    for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.delenv(k, raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    names = {fn.__name__ for fn in t.build_tool_list([])}
    assert {"check_availability", "book_appointment", "end_call",
            "transfer_to_human", "remember_details"} <= names
    # gated off when their backend is absent
    assert "book_calcom" not in names
    assert "cancel_calcom" not in names
    assert "send_sms_confirmation" not in names
    assert "lookup_contact" not in names


def test_build_tool_list_exposes_calcom_tools_when_configured(monkeypatch):
    """Configuring Cal.com adds cancellation — the gate works both ways.

    UPDATED: book_calcom is no longer in the DEFAULT set. It books Cal.com
    without writing the local row, so a booking made through it is invisible to
    the local calendar, reminders and reconciliation, and it duplicates
    book_appointment (which does both as one synchronised operation) at ~160
    input tokens of schema on every request. The method and its backend are
    retained and it is still reachable by naming it explicitly — asserted
    below. See test_context_consolidation.py.
    """
    monkeypatch.setenv("CALCOM_API_KEY", "cal_test_key")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", "3918684")
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    default = {fn.__name__ for fn in t.build_tool_list([])}
    assert "cancel_calcom" in default, "cancellation must stay available"
    assert "book_calcom" not in default, "the legacy booking path is opt-in now"
    opt_in = {fn.__name__ for fn in t.build_tool_list(["book_calcom", "cancel_calcom"])}
    assert {"book_calcom", "cancel_calcom"} <= opt_in


def test_build_tool_list_opt_in_lookup_contact(monkeypatch):
    """lookup_contact appears only when explicitly enabled for the assistant."""
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    assert "lookup_contact" in {fn.__name__ for fn in t.build_tool_list(["lookup_contact"])}


def test_build_tool_list_filters_by_enabled():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list(["check_availability", "end_call"])
    names = {fn.__name__ for fn in out}
    assert names == {"check_availability", "end_call"}


@pytest.mark.asyncio
async def test_check_availability_returns_available(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)
    async def fake_check_slot(date, time): return True
    async def fake_get_next(date, time): return "2026-06-01 at 11:00"
    monkeypatch.setattr("tools.db.check_slot", fake_check_slot)
    monkeypatch.setattr("tools.db.get_next_available", fake_get_next)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.check_availability("2026-06-01", "10:00")
    assert out == "available"


@pytest.mark.asyncio
async def test_check_availability_returns_next_when_booked(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)
    async def fake_check_slot(date, time): return False
    async def fake_get_next(date, time): return "2026-06-01 at 11:00"
    monkeypatch.setattr("tools.db.check_slot", fake_check_slot)
    monkeypatch.setattr("tools.db.get_next_available", fake_get_next)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.check_availability("2026-06-01", "10:00")
    assert out.startswith("unavailable: next available slot is")


@pytest.mark.asyncio
async def test_book_appointment_returns_confirmation(monkeypatch):
    # No Cal.com configured → local-only path (legacy behaviour preserved).
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)

    async def fake_insert(name, phone, date, time, service, **kwargs):
        assert kwargs.get("calcom_uid") is None
        return "ABC12345"
    monkeypatch.setattr("tools.db.insert_appointment", fake_insert)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.book_appointment("Ravi", "2026-06-01", "10:00", "consultation")
    assert "ABC12345" in out
    assert "2026-06-01" in out


@pytest.mark.asyncio
async def test_end_call_records_outcome():
    ctx = MagicMock()
    ctx.room.disconnect = AsyncMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.end_call("booked", "appointment confirmed")
    assert "Call ended" in out
    assert t._closed_outcome == "booked"
    assert t._closed_reason == "appointment confirmed"
    ctx.room.disconnect.assert_awaited_once()


@pytest.mark.asyncio
async def test_transfer_to_human_when_unconfigured():
    """No destinations configured -> refuse, and never attempt a SIP REFER."""
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    t.transfer_targets = {}
    out = await t.transfer_to_human("software", "complex query")
    assert "TRANSFER_UNAVAILABLE" in out
    ctx.api.sip.transfer_sip_participant.assert_not_called()


@pytest.mark.asyncio
async def test_transfer_falls_back_to_other_category():
    """A category with no number uses Other/General rather than failing."""
    ctx = MagicMock()
    ctx.room.name = "test-room"          # protobuf needs a str, not a MagicMock
    ctx.api.sip.transfer_sip_participant = AsyncMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    t._sip_domain = ""
    t.transfer_targets = {
        "other": {"category": "other", "label": "Other / General",
                  "phone": "+919940660868", "priority": 99},
    }
    out = await t.transfer_to_human("marketing", "")
    assert "TRANSFER_OK" in out
    sent = ctx.api.sip.transfer_sip_participant.call_args.args[0].transfer_to
    assert "919940660868" in sent


@pytest.mark.asyncio
async def test_transfer_does_not_loop():
    """A second call cannot start another REFER on a call already handing over."""
    ctx = MagicMock()
    ctx.room.name = "test-room"          # protobuf needs a str, not a MagicMock
    ctx.api.sip.transfer_sip_participant = AsyncMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    t._sip_domain = ""
    t.transfer_targets = {
        "software": {"category": "software", "label": "Software",
                     "phone": "+917397075913", "priority": 10},
    }
    assert "TRANSFER_OK" in await t.transfer_to_human("software", "")
    again = await t.transfer_to_human("software", "")
    assert "already in progress" in again
    assert ctx.api.sip.transfer_sip_participant.await_count == 1


def test_transfer_number_is_masked_in_logs():
    assert AppointmentTools._mask_phone("+919940660868") == "***868"
    assert AppointmentTools._mask_phone("") == "***"


@pytest.mark.asyncio
async def test_send_sms_skip_when_unconfigured(monkeypatch):
    for v in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.delenv(v, raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.send_sms_confirmation("+91111", "test")
    assert "Twilio not configured" in out


@pytest.mark.asyncio
async def test_lookup_contact_returns_no_history(monkeypatch):
    async def fake_empty(_): return []
    monkeypatch.setattr("tools.db.get_calls_by_phone", fake_empty)
    monkeypatch.setattr("tools.db.get_appointments_by_phone", fake_empty)
    monkeypatch.setattr("tools.db.get_contact_memory", fake_empty)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.lookup_contact("+91111")
    assert "First-time contact" in out


@pytest.mark.asyncio
async def test_remember_details_inserts_memory(monkeypatch):
    inserted: list[str] = []
    async def fake_add(p, ins): inserted.append(ins)
    async def fake_get(_): return []
    monkeypatch.setattr("tools.db.add_contact_memory", fake_add)
    monkeypatch.setattr("tools.db.get_contact_memory", fake_get)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.remember_details("Prefers morning")
    assert "Remembered: Prefers morning" in out
    assert inserted == ["Prefers morning"]


@pytest.mark.asyncio
async def test_book_calcom_skip_when_unconfigured(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.book_calcom("Ravi", "ravi@x.com", "2026-06-01", "10:00")
    assert "Cal.com not configured" in out


@pytest.mark.asyncio
async def test_cancel_calcom_skip_when_unconfigured(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.cancel_calcom("uid-123")
    assert "Cal.com not configured" in out


@pytest.mark.asyncio
async def test_book_calcom_converts_local_to_utc(monkeypatch):
    """Cal.com booking time must be converted from local TZ to UTC, not labeled Z directly."""
    monkeypatch.setenv("CALCOM_API_KEY", "test-key")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", "1")
    monkeypatch.setenv("CALCOM_TIMEZONE", "Asia/Kolkata")

    captured: dict = {}

    class FakeResponse:
        status_code = 200
        text = ""
        def json(self):
            return {"uid": "uid-test"}

    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, url, headers=None, params=None, json=None):
            captured["url"] = url
            captured["params"] = params
            captured["json"] = json
            return FakeResponse()

    import httpx as _httpx
    monkeypatch.setattr(_httpx, "AsyncClient", lambda *a, **kw: FakeClient())

    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.book_calcom("Ravi", "ravi@x.com", "2026-06-01", "10:00")

    # IST 10:00 → UTC 04:30
    assert "2026-06-01T04:30:00.000Z" in captured["json"]["start"], f"Expected UTC-converted time, got {captured['json']['start']}"
    assert "Cal.com booked" in out
