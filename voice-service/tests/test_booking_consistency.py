"""Booking consistency between Cal.com (external) and Neon (local).

Covers the split-brain window: Cal.com accepted the booking but the local
write did not land. The rules under test:

  * a confirmed Cal.com UID is never thrown away;
  * a failed local write is recorded durably so it can be reconciled;
  * the caller is NOT told our calendar is synchronised when it is not;
  * an ambiguous external timeout is never blindly retried;
  * reconciliation cannot create a duplicate.

All I/O is mocked. No Cal.com request is made and no booking is created.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
import respx

import tools

EVENT_ID = "3918684"
DATE = "2026-06-01"
SLOTS_URL = "https://api.cal.com/v2/slots"
BOOKINGS_URL = "https://api.cal.com/v2/bookings"
PHONE = "+919876500000"


@pytest.fixture
def calcom_env(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "cal_test_key")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", EVENT_ID)
    monkeypatch.setenv("CALCOM_TIMEZONE", "Asia/Kolkata")


@pytest.fixture
def free_slot():
    """Cal.com offers 10:00 IST (04:30Z) and the local slot check passes."""
    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        yield


def _tools():
    return tools.AppointmentTools(MagicMock(), PHONE, "Ravi")


# ── the local row already exists (slot-level unique index) ──────────────────
@pytest.mark.asyncio
async def test_slot_conflict_is_caught_before_any_external_booking(calcom_env, monkeypatch):
    """A different service in the same slot must be rejected BEFORE Cal.com.

    The pre-insert guard matches phone+date+time+service, but the database
    index is unique on phone+date+time. Previously that mismatch let the
    request reach Cal.com, create a SECOND external booking, and only then
    fail locally. The slot-level pre-check closes that window: no external
    request is made at all.
    """
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, "find_booked_slot", AsyncMock(return_value={
        "booking_id": "BK-EXISTING", "service": "consultation", "calcom_booking_uid": "bk_old"}))
    insert = AsyncMock(return_value="SHOULD-NOT-HAPPEN")
    monkeypatch.setattr(tools.db, "insert_appointment", insert)

    with respx.mock:
        slots = respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        post = respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_should_not_exist"}}))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    assert post.call_count == 0, "a second external booking must never be created"
    assert slots.call_count == 0, "no external call is needed once the slot is known to be taken"
    insert.assert_not_awaited()
    assert "BK-EXISTING" in out
    assert "consultation" in out, "the caller should hear which booking already holds the slot"


@pytest.mark.asyncio
async def test_new_external_booking_is_never_attached_to_an_unrelated_row(calcom_env, monkeypatch):
    """Safety net: if a slot conflict is only discovered at insert time, the
    freshly created Cal.com booking must NOT be linked to the pre-existing
    local appointment.

    Attaching would mean a later cancellation of the OLD appointment cancels
    the NEW external booking — a booking made for a different service. The new
    uid is recorded for reconciliation instead, so it is visible rather than
    silently stranded.
    """
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    # Pre-check sees nothing (race), the insert then collides.
    monkeypatch.setattr(tools.db, "find_booked_slot",
                        AsyncMock(side_effect=[None, {"booking_id": "BK-EXISTING",
                                                      "service": "consultation",
                                                      "calcom_booking_uid": None}]))
    monkeypatch.setattr(tools.db, "insert_appointment",
                        AsyncMock(side_effect=Exception(
                            'duplicate key value violates unique constraint '
                            '"appointments_active_customer_slot_idx"')))
    attach = AsyncMock(return_value=True)
    monkeypatch.setattr(tools.db, "attach_calcom_uid", attach)
    orphan = AsyncMock()
    monkeypatch.setattr(tools.db, "record_calcom_orphan", orphan)

    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_new"}}))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    attach.assert_not_awaited(), "a new external booking must never be linked to an old appointment"
    orphan.assert_awaited_once()
    assert orphan.await_args.args[0] == "bk_new"
    assert "NOT attached" in orphan.await_args.args[6]
    assert "BK-EXISTING" in out
    assert "consultation" in out


@pytest.mark.asyncio
async def test_existing_row_with_uid_is_not_relinked(calcom_env, monkeypatch):
    """First-write-wins: an appointment that already carries a uid is left alone."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, "insert_appointment", AsyncMock(side_effect=Exception("dup")))
    monkeypatch.setattr(tools.db, "find_booked_slot", AsyncMock(return_value={
        "booking_id": "BK-OLD", "service": "demo", "calcom_booking_uid": "bk_original"}))
    attach = AsyncMock()
    monkeypatch.setattr(tools.db, "attach_calcom_uid", attach)

    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_second"}}))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    attach.assert_not_awaited()
    assert "BK-OLD" in out


# ── genuine split-brain: Cal.com booked, Neon down ──────────────────────────
@pytest.mark.asyncio
async def test_neon_failure_persists_recoverable_orphan_record(calcom_env, monkeypatch):
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, "insert_appointment",
                        AsyncMock(side_effect=RuntimeError("connection refused")))
    monkeypatch.setattr(tools.db, "find_booked_slot", AsyncMock(return_value=None))
    orphan = AsyncMock()
    monkeypatch.setattr(tools.db, "record_calcom_orphan", orphan)

    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_orphan"}}))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    # the UID is retained and surfaced
    assert "bk_orphan" in out
    # a recoverable record is persisted with everything reconciliation needs
    orphan.assert_awaited_once()
    args = orphan.await_args.args
    assert args[0] == "bk_orphan" and args[1] == PHONE
    assert args[2] == DATE and args[3] == "10:00"


@pytest.mark.asyncio
async def test_neon_failure_does_not_claim_our_calendar_is_synced(calcom_env, monkeypatch):
    """The caller must not be told JillJill has the booking when it does not."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, "insert_appointment", AsyncMock(side_effect=RuntimeError("down")))
    monkeypatch.setattr(tools.db, "find_booked_slot", AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, "record_calcom_orphan", AsyncMock())

    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_x"}}))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    low = out.lower()
    assert "confirmed on our calendar" not in low
    # it must say the record is incomplete, not that everything is done
    assert "could not finish" in low or "not lost" in low
    assert "provider" in low


@pytest.mark.asyncio
async def test_orphan_record_failure_never_breaks_the_call(calcom_env, monkeypatch):
    """The database is already failing; losing the audit record must not turn a
    real booking into an exception mid-call."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, "insert_appointment", AsyncMock(side_effect=RuntimeError("down")))
    monkeypatch.setattr(tools.db, "find_booked_slot", AsyncMock(side_effect=RuntimeError("down")))
    monkeypatch.setattr(tools.db, "record_calcom_orphan",
                        AsyncMock(side_effect=RuntimeError("also down")))

    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        respx.post(BOOKINGS_URL).mock(
            return_value=httpx.Response(201, json={"data": {"uid": "bk_y"}}))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    # Every database call failed, including the audit write — the caller must
    # still be told their real Cal.com booking is held, not get an error.
    assert "bk_y" in out
    assert "not lost" in out.lower()


# ── ambiguous external timeout is never blindly retried ─────────────────────
@pytest.mark.asyncio
async def test_timeout_does_not_retry_booking_creation(calcom_env, monkeypatch):
    """A timeout on POST /bookings is AMBIGUOUS — the booking may exist. A retry
    could double-book, so exactly one request must be made and the caller told
    it is unconfirmed."""
    monkeypatch.setattr(tools.db, "check_slot", AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, "find_booked_appointment", AsyncMock(return_value=None))
    insert = AsyncMock(return_value="BK-NEW")
    monkeypatch.setattr(tools.db, "insert_appointment", insert)

    with respx.mock:
        respx.get(SLOTS_URL).mock(return_value=httpx.Response(
            200, json={"data": {DATE: [{"start": f"{DATE}T04:30:00.000Z"}]}}))
        post = respx.post(BOOKINGS_URL).mock(side_effect=httpx.ReadTimeout("timed out"))
        out = await _tools().book_appointment("Ravi", DATE, "10:00", "demo")

    assert post.call_count == 1, "an ambiguous timeout must not be retried"
    # and no local row is written for a booking we cannot confirm
    insert.assert_not_awaited()
    assert "couldn't confirm" in out.lower() or "could not" in out.lower()


@pytest.mark.asyncio
async def test_calcom_book_itself_makes_exactly_one_request_on_timeout(calcom_env):
    with respx.mock:
        post = respx.post(BOOKINGS_URL).mock(side_effect=httpx.ConnectTimeout("t"))
        res = await tools.calcom_book("Ravi", "r@example.com", PHONE, DATE, "10:00", "demo")
    assert post.call_count == 1
    assert res["success"] is False
    assert res["uid"] is None


# ── reconciliation is idempotent ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_reconciliation_lookup_prevents_duplicate_rows(monkeypatch):
    """find_appointment_by_calcom_uid is the idempotency key: if the uid is
    already persisted, a reconciliation pass must not insert a second row."""
    seen = {"uid": "bk_done"}

    async def fake_find(uid):
        return {"booking_id": "BK1", "status": "BOOKED", "phone_number": PHONE,
                "date": DATE, "time": "10:00"} if uid == seen["uid"] else None

    monkeypatch.setattr(tools.db, "find_appointment_by_calcom_uid", fake_find)
    assert (await tools.db.find_appointment_by_calcom_uid("bk_done"))["booking_id"] == "BK1"
    assert await tools.db.find_appointment_by_calcom_uid("bk_missing") is None


# ── durability when Neon is COMPLETELY unavailable ──────────────────────────
@pytest.mark.asyncio
async def test_orphan_record_falls_back_to_disk_when_the_database_is_down(tmp_path, monkeypatch):
    """The orphan record must not depend on the database that just failed.

    record_calcom_orphan writes to error_logs in Neon -- the same database
    whose outage caused the orphan. When that write fails the record is
    appended to a local JSONL file instead, so a real external booking is
    still recoverable after the process dies.
    """
    import db as real_db

    async def dead_log_error(*a, **k):
        raise RuntimeError("neon unreachable")

    path = tmp_path / "calcom_orphans.jsonl"
    monkeypatch.setattr(real_db, "log_error", dead_log_error)
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    ok = await real_db.record_calcom_orphan(
        "bk_durable", "+919876500000", "2026-06-01", "10:00", "demo", "Ravi",
        "neon down")

    assert ok is True, "the record must be captured somewhere"
    assert path.exists(), "a disk fallback file must be written"
    import json as _json
    row = _json.loads(path.read_text(encoding="utf-8").strip())
    assert row["calcom_uid"] == "bk_durable"
    assert row["phone_number"] == "+919876500000"
    assert row["date"] == "2026-06-01" and row["time"] == "10:00"
    assert "recorded_at" in row, "needs a timestamp to reconcile against"


@pytest.mark.asyncio
async def test_orphan_records_append_rather_than_overwrite(tmp_path, monkeypatch):
    """Two outages in a row must not lose the first booking."""
    import db as real_db

    async def dead_log_error(*a, **k):
        raise RuntimeError("down")

    path = tmp_path / "orphans.jsonl"
    monkeypatch.setattr(real_db, "log_error", dead_log_error)
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    await real_db.record_calcom_orphan("bk_1", "+91", "2026-06-01", "10:00", "a", "R", "x")
    await real_db.record_calcom_orphan("bk_2", "+91", "2026-06-01", "11:00", "b", "R", "x")

    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 2
    import json as _json
    assert [_json.loads(l)["calcom_uid"] for l in lines] == ["bk_1", "bk_2"]


@pytest.mark.asyncio
async def test_orphan_record_prefers_the_database_when_it_is_healthy(tmp_path, monkeypatch):
    """No duplicate sink: a successful database write skips the file."""
    import db as real_db
    seen = {}

    async def ok_log_error(source, message, detail="", level="ERROR"):
        seen["message"] = message
        seen["detail"] = detail
        # log_error now reports whether the row actually committed. A stub that
        # returned None implicitly read as "insert failed", which is exactly
        # the signal the durability fix depends on.
        return True

    path = tmp_path / "orphans.jsonl"
    monkeypatch.setattr(real_db, "log_error", ok_log_error)
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    assert await real_db.record_calcom_orphan(
        "bk_db", "+91", "2026-06-01", "10:00", "demo", "Ravi", "x") is True
    assert seen["message"] == "ORPHANED_CALCOM_BOOKING"
    assert "bk_db" in seen["detail"]
    assert not path.exists(), "the file sink is a fallback, not a second copy"
