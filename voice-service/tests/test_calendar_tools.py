import pytest
import respx
import httpx

import calendar_tools


@pytest.mark.asyncio
async def test_calcom_book_returns_uid(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "k")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", "1")
    with respx.mock:
        respx.post("https://api.cal.com/v2/bookings").mock(
            return_value=httpx.Response(200, json={"data": {"uid": "uid-xyz"}}),
        )
        out = await calendar_tools.async_create_booking(
            "2026-06-01T10:00:00+05:30", "Ravi", "+91111", "first visit",
        )
    assert out["success"] is True
    assert out["booking_id"] == "uid-xyz"


@pytest.mark.asyncio
async def test_get_available_slots_returns_empty_on_failure(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "k")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", "1")
    with respx.mock:
        respx.get("https://api.cal.com/v1/slots").mock(
            return_value=httpx.Response(500, text="boom"),
        )
        slots = calendar_tools.get_available_slots("2026-06-01")
    assert slots == []
