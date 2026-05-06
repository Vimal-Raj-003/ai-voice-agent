from unittest.mock import MagicMock

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
