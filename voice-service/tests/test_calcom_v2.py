"""Regression tests for the Cal.com API v2 wire contract.

Cal.com v1 was decommissioned (every v1 call returns HTTP 410), so tools.py was
migrated to v2. The existing suites cover booking *behaviour* with the tools
functions mocked; nothing pinned the HTTP contract itself, which is precisely
what the migration changed and what would regress silently:

  * endpoint paths and HTTP verbs (cancel moved DELETE -> POST)
  * Bearer auth instead of an `apiKey` query parameter
  * the per-endpoint `cal-api-version` headers
  * parameter renames (startTime/endTime -> start/end)
  * the booking body shape (`responses` -> `attendee` + `bookingFieldsResponses`)
  * the slots response shape (data.slots[date][].time -> data[date][].start)

Everything here is mocked with respx. No request reaches Cal.com and no
booking is created.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx

import tools

# Coverage migrated here from the deleted voice-service/calendar_tools.py and
# its tests (a second, unreferenced Cal.com implementation on the decommissioned
# v1 API):
#   test_calcom_book_returns_uid              -> test_booking_creation_uses_v2_body_and_returns_uid
#                                                (same guarantee, plus headers/version/body shape)
#   test_get_available_slots_returns_empty_on_failure
#                                             -> test_availability_error_is_unknown_never_available
#                                                and test_availability_transport_error_is_unknown.
#       NOTE the semantics improved: the dead module returned [] on failure,
#       which a caller can misread as "no slots free". The active adapter
#       returns None ("unknown"), so a provider outage can never be presented
#       as availability.

EVENT_ID = "3918684"          # the verified VIMS Enterprise event type
DATE = "2026-06-01"
SLOTS_URL = "https://api.cal.com/v2/slots"
BOOKINGS_URL = "https://api.cal.com/v2/bookings"


@pytest.fixture
def calcom_env(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "cal_test_key")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", EVENT_ID)
    monkeypatch.setenv("CALCOM_TIMEZONE", "Asia/Kolkata")


def _slots_payload(*ist_times: str) -> dict:
    """A v2 slots body. 10:00 IST is 04:30Z — the API answers in UTC."""
    mapping = {"10:00": "04:30", "11:00": "05:30", "15:30": "10:00"}
    return {"data": {DATE: [{"start": f"{DATE}T{mapping[t]}:00.000Z"} for t in ist_times]}}


# ── 1. API v2 availability ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_availability_uses_v2_contract(calcom_env):
    with respx.mock:
        route = respx.get(SLOTS_URL).mock(
            return_value=httpx.Response(200, json=_slots_payload("10:00", "11:00")))
        assert await tools.calcom_slot_free(DATE, "10:00") is True

    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer cal_test_key"
    assert req.headers["cal-api-version"] == tools.CALCOM_V_SLOTS == "2024-09-04"
    # v1 passed the key in the query string; v2 must not.
    assert "apiKey" not in str(req.url)
    # v1 used startTime/endTime; v2 uses start/end.
    assert req.url.params["start"] == DATE
    assert req.url.params["end"] == DATE
    assert req.url.params["eventTypeId"] == EVENT_ID
    assert req.url.params["timeZone"] == "Asia/Kolkata"


@pytest.mark.asyncio
async def test_availability_reports_unoffered_slot_as_busy(calcom_env):
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(200, json=_slots_payload("11:00")))
        assert await tools.calcom_slot_free(DATE, "10:00") is False


@pytest.mark.asyncio
async def test_availability_parses_bare_string_slots(calcom_env):
    """`format=time` returns plain ISO strings rather than {"start": ...}."""
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [f"{DATE}T04:30:00.000Z"]}}))
        assert await tools.calcom_slot_free(DATE, "10:00") is True


# ── 2. correct UTC / IST conversion ─────────────────────────────────────────
@pytest.mark.asyncio
async def test_ist_slot_maps_to_utc_instant(calcom_env):
    """A 10:00 IST booking must be sent as 04:30Z — a +05:30 offset."""
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(200, json=_slots_payload("10:00")))
        route = respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_1"}}))
        await tools.calcom_book("Ravi", "r@example.com", "+919876500000",
                                DATE, "10:00", "demo")
    import json
    body = json.loads(route.calls.last.request.read())
    assert body["start"] == "2026-06-01T04:30:00.000Z"


# ── 3. booking creation ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_booking_creation_uses_v2_body_and_returns_uid(calcom_env):
    import json
    with respx.mock:
        route = respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_abc"}}))
        res = await tools.calcom_book("Ravi", "r@example.com", "+919876500000",
                                      DATE, "10:00", "demo", "note")
    assert res["success"] is True
    assert res["uid"] == "bk_abc"

    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer cal_test_key"
    assert req.headers["cal-api-version"] == tools.CALCOM_V_BOOKINGS == "2026-02-25"
    assert "apiKey" not in str(req.url)
    body = json.loads(req.read())
    assert body["eventTypeId"] == int(EVENT_ID)
    # v2 replaced the flat `responses` blob with a typed attendee object.
    assert "responses" not in body
    assert body["attendee"]["name"] == "Ravi"
    assert body["attendee"]["email"] == "r@example.com"
    assert body["attendee"]["timeZone"] == "Asia/Kolkata"
    assert body["bookingFieldsResponses"]["notes"] == "note"


@pytest.mark.asyncio
async def test_booking_without_email_uses_placeholder(calcom_env):
    import json
    with respx.mock:
        route = respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_2"}}))
        await tools.calcom_book("Ravi", "", "+919876500000", DATE, "10:00", "demo")
    email = json.loads(route.calls.last.request.read())["attendee"]["email"]
    assert email == "919876500000@voiceagent.placeholder"


# ── 4. booking cancellation ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cancellation_posts_with_reason(calcom_env):
    import json
    url = f"{BOOKINGS_URL}/bk_abc/cancel"
    with respx.mock:
        route = respx.post(url).mock(return_value=httpx.Response(200, json={"status": "success"}))
        res = await tools.calcom_cancel("bk_abc", "caller cancelled")
    assert res["success"] is True
    req = route.calls.last.request
    # v1 was DELETE ...?reason=; v2 is POST with a JSON body.
    assert req.method == "POST"
    assert req.headers["cal-api-version"] == "2026-02-25"
    assert json.loads(req.read())["cancellationReason"] == "caller cancelled"


@pytest.mark.asyncio
async def test_cancellation_failure_is_reported_not_swallowed(calcom_env):
    with respx.mock:
        respx.post(f"{BOOKINGS_URL}/missing/cancel").mock(
            return_value=httpx.Response(404, json={"error": {"message": "Booking not found"}}))
        res = await tools.calcom_cancel("missing", "x")
    assert res["success"] is False


# ── 5. Cal.com error recovery ───────────────────────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("status", [410, 500, 401])
async def test_availability_error_is_unknown_never_available(calcom_env, status):
    """A failed probe must return None ("unknown"). Returning False would claim
    the slot is taken; returning True would double-book."""
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(status, json={"message": "nope"}))
        assert await tools.calcom_slot_free(DATE, "10:00") is None


@pytest.mark.asyncio
async def test_availability_transport_error_is_unknown(calcom_env):
    with respx.mock:
        respx.get(SLOTS_URL).mock(side_effect=httpx.ConnectError("boom"))
        assert await tools.calcom_slot_free(DATE, "10:00") is None


@pytest.mark.asyncio
async def test_v1_decommission_response_does_not_report_available(calcom_env):
    """The exact failure that broke this integration: v1 returning HTTP 410."""
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            410, json={"message": "API v1 has been decommissioned. Please migrate to API v2"}))
        assert await tools.calcom_slot_free(DATE, "10:00") is not True


@pytest.mark.asyncio
async def test_booking_api_error_returns_failure(calcom_env):
    with respx.mock:
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(400, json={"error": {"message": "start property is wrong"}}))
        res = await tools.calcom_book("Ravi", "r@example.com", "+919876500000",
                                      DATE, "10:00", "demo")
    assert res["success"] is False
    assert res["uid"] is None


# ── 6. duplicate booking prevention (at the v2 layer) ───────────────────────
@pytest.mark.asyncio
async def test_busy_slot_never_reaches_the_booking_endpoint(calcom_env, monkeypatch):
    """book_appointment must not POST a booking for a slot Cal.com says is taken."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "get_next_available", AsyncMock(return_value=f"{DATE} at 11:00"))
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(200, json=_slots_payload("11:00")))
        post = respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "should_not_happen"}}))
        t = tools.AppointmentTools(MagicMock(), "+919876500000", "Ravi")
        out = await t.book_appointment("Ravi", DATE, "10:00", "demo")
    assert post.call_count == 0
    assert "another time" in out.lower() or "taken" in out.lower()


# ── 7. local (Neon) persistence failure ─────────────────────────────────────
@pytest.mark.asyncio
async def test_local_persistence_failure_after_calcom_booking(calcom_env, monkeypatch):
    """Cal.com booked but Neon failed: Cal.com is the source of truth, so the
    caller is told it is confirmed and the mismatch is flagged, never silently
    reported as a failure that leaves a real booking orphaned."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "insert_appointment",
                        AsyncMock(side_effect=RuntimeError("neon down")))
    monkeypatch.setattr(tools.db, "log_error", AsyncMock())
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(200, json=_slots_payload("10:00")))
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_orphan"}}))
        t = tools.AppointmentTools(MagicMock(), "+919876500000", "Ravi")
        out = await t.book_appointment("Ravi", DATE, "10:00", "demo")
    assert "bk_orphan" in out


# ── 8. existing voice-tool compatibility ────────────────────────────────────
@pytest.mark.asyncio
async def test_check_availability_tool_reports_available_on_v2(calcom_env, monkeypatch):
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(200, json=_slots_payload("10:00")))
        t = tools.AppointmentTools(MagicMock(), "+919876500000", "Ravi")
        out = await t.check_availability(DATE, "10:00")
    assert out == "available"


@pytest.mark.asyncio
async def test_check_availability_tool_degrades_safely(calcom_env, monkeypatch):
    """Provider down: the agent must say it cannot confirm, never invent a slot."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(410, json={"message": "gone"}))
        t = tools.AppointmentTools(MagicMock(), "+919876500000", "Ravi")
        out = await t.check_availability(DATE, "10:00")
    assert out != "available"
    assert "can't reach the calendar" in out.lower() or "cannot" in out.lower()


def test_calcom_enabled_requires_both_key_and_event(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "cal_k")
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)
    assert tools.calcom_enabled() is False
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", EVENT_ID)
    assert tools.calcom_enabled() is True


def test_no_v1_base_url_remains():
    assert tools.CALCOM_BASE == "https://api.cal.com/v2"
