"""Calls are billed on answer -> hangup, not on how long the room lived.

Reconstructed from room call-917397075913-5801 (16 Oct, outbound to
+917397075913 from the Vobiz DID +918065480036):

    08:21:16  call row created
    08:21:18  sip_participant_found        <- answer
    08:21:25  FIRST_GREETING_STARTED       = 01:51:25 PM IST
    08:24:59  sip_participant_left         <- hangup
    09:17:43  participant_left             <- LiveKit reaped the room
    09:18:23  session_ended                 durationSeconds = 3417

Three independent sources agree the call was 3m34s: the carrier's own log
(1:51 PM, 3m34s), recordingDurationSeconds = 214, and greeting -> hangup =
214s. The stored 3417s came from job-start -> shutdown-hook, so every
duration-derived cost line (Vobiz telephony, Deepgram STT, LiveKit media)
was 16x too high.

All arithmetic is pure; no provider, SIP or DB access.
"""
from __future__ import annotations

import time

import pytest

import agent as ag


class _Tools:
    def __init__(self, answered=None, started=None):
        self._answered_mono = answered
        self._call_start_time = started if started is not None else time.time()


class _Ctx:
    def __init__(self, hangup=None):
        if hangup is not None:
            self._jj_hangup_mono = hangup


# ── the incident, reproduced ───────────────────────────────────────────────
def test_the_incident_call_bills_214_seconds_not_3417():
    answered = 1000.0
    hangup = answered + 214          # 08:21:25 -> 08:24:59
    reaped = answered + 3417         # 09:18:23
    tools = _Tools(answered=answered, started=time.time() - reaped)
    secs, basis = ag._billable_seconds(_Ctx(hangup=hangup), tools)
    assert secs == 214
    assert basis == "answer_to_hangup"


def test_the_old_anchor_was_the_room_lifetime():
    """Documents what the stored figure actually measured."""
    assert round(3417 / 214, 1) == 16.0


# ── the durations the brief names ──────────────────────────────────────────
@pytest.mark.parametrize("seconds,label", [
    (30, "30-second call"),
    (180, "3-minute call"),
    (214, "the incident call"),
    (1800, "30-minute legitimate conversation"),
    (3600, "1-hour legitimate conversation"),
])
def test_durations_are_billed_exactly(seconds, label):
    answered = 500.0
    secs, basis = ag._billable_seconds(
        _Ctx(hangup=answered + seconds), _Tools(answered=answered))
    assert secs == seconds, label
    assert basis == "answer_to_hangup"


def test_a_long_genuine_conversation_is_never_truncated():
    """Explicit safeguard: nothing here shortens a call for being long. A real
    one-hour conversation must bill one hour."""
    answered = 0.0
    secs, _ = ag._billable_seconds(_Ctx(hangup=3600.0), _Tools(answered=answered))
    assert secs == 3600


# ── every teardown path ────────────────────────────────────────────────────
def test_agent_initiated_hangup_bills_to_teardown():
    """end_call(): no SIP disconnect event, so the span runs answer -> now."""
    answered = time.monotonic() - 95
    secs, basis = ag._billable_seconds(_Ctx(), _Tools(answered=answered))
    assert 94 <= secs <= 97
    assert basis == "answer_to_teardown"


def test_a_call_that_never_connected_bills_nothing_from_answer():
    """Provider failure / no answer: there is no answer stamp, so the old
    wall-clock is used and the basis says so — an estimate is never passed off
    as a measurement."""
    tools = _Tools(answered=None, started=time.time() - 42)
    secs, basis = ag._billable_seconds(_Ctx(), tools)
    assert basis == "job_wallclock"
    assert 41 <= secs <= 44


def test_a_hangup_before_answer_cannot_go_negative():
    secs, basis = ag._billable_seconds(_Ctx(hangup=10.0), _Tools(answered=100.0))
    assert secs >= 0
    assert basis == "answer_to_teardown", "an impossible ordering must not bill"


def test_duration_is_never_negative_on_any_path():
    for ctx, tools in [
        (_Ctx(hangup=0.0), _Tools(answered=0.0)),
        (_Ctx(), _Tools(answered=time.monotonic())),
        (_Ctx(), _Tools(answered=None, started=time.time())),
    ]:
        secs, _ = ag._billable_seconds(ctx, tools)
        assert secs >= 0


# ── the wiring ─────────────────────────────────────────────────────────────
def test_the_answer_stamp_is_not_taken_on_the_sip_join():
    """CORRECTED against the Vobiz CDR. participant_connected fires at the
    carrier's "Start" (13:51:18) — seven seconds before "Call picked"
    (13:51:25). Billing from here charged the ringing period. The authoritative
    stamp now lives where create_sip_participant(wait_until_answered=True)
    returns; see test_call_lifecycle_billing.py."""
    import inspect
    src = inspect.getsource(ag.entrypoint)
    i = src.index('logger.info("sip_participant_found"')
    before = src[max(0, i - 900):i]
    assert "_answered_mono = time.monotonic()" not in before


def test_the_answer_stamp_is_set_once_per_call():
    """Outbound stamps unconditionally at the carrier answer (reached once);
    inbound is guarded so a re-entry cannot move it."""
    import inspect
    src = inspect.getsource(ag.entrypoint)
    i = src.index("inbound_participant_present_at_start")
    assert 'getattr(agent_tools, "_answered_mono", None) is None' in src[max(0, i - 700):i]


def test_the_hangup_stamp_is_taken_at_the_disconnect_not_at_teardown():
    import inspect
    src = inspect.getsource(ag.entrypoint)
    i = src.index('@ctx.room.on("participant_disconnected")')
    body = src[i:i + 1200]
    assert "_jj_hangup_mono" in body
    assert "time.monotonic()" in body


def test_stt_seconds_follows_the_billable_span():
    """Deepgram meters streamed audio; with the SIP leg gone there is no audio
    track, and zero STT events were logged after the 08:24:59 hangup."""
    import inspect
    src = inspect.getsource(ag._shutdown_hook)
    assert "stt_seconds = duration" in src
    i_dur = src.index("duration, duration_basis = _billable_seconds")
    i_stt = src.index("stt_seconds = duration")
    assert i_dur < i_stt, "stt_seconds must derive from the BILLABLE duration"


def test_the_basis_is_recorded_so_estimates_are_identifiable():
    import inspect
    src = inspect.getsource(ag._shutdown_hook)
    assert "duration_basis=duration_basis" in src
    assert "room_outlived_call" in src


# ── it runs inside the shutdown hook, so it must never raise ───────────────
def test_non_numeric_stamps_degrade_instead_of_raising():
    """A stub/mock/None on either attribute must not stop the call row being
    written — losing the whole record would be far worse than a rough figure."""
    from unittest.mock import MagicMock

    ctx, tools = MagicMock(), MagicMock()
    secs, basis = ag._billable_seconds(ctx, tools)
    assert isinstance(secs, int) and secs >= 0
    # Any of the non-measured bases is acceptable — the point is that it
    # returns a sane figure with a truthful label instead of raising. A mock's
    # attributes are all truthy, so it lands on the no_answer branch, which
    # bills 0: the safe direction.
    assert basis in ("job_wallclock", "unknown", "no_answer")
    assert basis != "answer_to_hangup", "must never claim a measured span"


def test_a_boolean_is_not_mistaken_for_a_timestamp():
    class T:
        _answered_mono = True
        _call_start_time = time.time() - 12

    secs, basis = ag._billable_seconds(_Ctx(), T())
    assert basis == "job_wallclock"
    assert 11 <= secs <= 14


def test_a_missing_start_time_reports_unknown_not_a_huge_number():
    class T:
        pass

    secs, basis = ag._billable_seconds(_Ctx(), T())
    assert (secs, basis) == (0, "unknown")
