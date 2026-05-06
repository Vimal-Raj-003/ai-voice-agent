from unittest.mock import AsyncMock, MagicMock

import pytest

from tools import AppointmentTools


def test_build_tool_list_returns_all_when_empty():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list([])
    names = {fn.__name__ for fn in out}
    assert {"check_availability", "book_appointment", "end_call",
            "transfer_to_human", "send_sms_confirmation", "lookup_contact",
            "remember_details", "book_calcom", "cancel_calcom"} <= names


def test_build_tool_list_filters_by_enabled():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list(["check_availability", "end_call"])
    names = {fn.__name__ for fn in out}
    assert names == {"check_availability", "end_call"}


@pytest.mark.asyncio
async def test_check_availability_returns_available(monkeypatch):
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
    async def fake_insert(name, phone, date, time, service):
        return "ABC12345"
    monkeypatch.setattr("tools.db.insert_appointment", fake_insert)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.book_appointment("Ravi", "+91111", "2026-06-01", "10:00", "consultation")
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
async def test_transfer_to_human_when_unconfigured(monkeypatch):
    monkeypatch.delenv("DEFAULT_TRANSFER_NUMBER", raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.transfer_to_human("complex query")
    assert "no fallback number" in out


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
