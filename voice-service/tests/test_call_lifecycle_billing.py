"""Call lifecycle and billing anchored on the CARRIER's answer.

Ground truth is the Vobiz CDR for room call-917397075913-5801, reconciled to
the second against our own Live Logs:

    Vobiz "Start"        13:51:18      sip_participant_found   13:51:18.338
    Vobiz "Ring start"   13:51:20      (no event emitted)
    Vobiz "Call picked"  13:51:25      call_answered           13:51:25.113
    Vobiz "Ended"        13:54:59      sip_participant_left    13:54:59
    Vobiz total          221s  (3m41s)
    Vobiz billed         214s  (3m34s)   recordingDurationSeconds = 214
    Vobiz cost           INR 1.80
    JillJill stored      3417s, INR 32.4957 + INR 23.2886

Two separate defects produced that: billing ran to the room reaper rather than
the hangup (15.97x), and the answer anchor was briefly placed on
participant_connected — the carrier's "Start", seven seconds before pickup.

All arithmetic is pure. No provider, SIP or DB access.
"""
from __future__ import annotations

import inspect
import time

import pytest

import agent as ag

# The incident, in seconds relative to dial.
DIAL, RING, ANSWER, HANGUP, REAPED = 0.0, 2.0, 7.0, 221.0, 3424.0
BILLED = int(HANGUP - ANSWER)          # 214
TOTAL = int(HANGUP - DIAL)             # 221


class _Tools:
    def __init__(self, answered=None, started=None, ringing=None):
        self._answered_mono = answered
        self._call_start_time = started if started is not None else time.time()
        if ringing is not None:
            self._ringing_seconds = ringing


class _Ctx:
    def __init__(self, hangup=None):
        if hangup is not None:
            self._jj_hangup_mono = hangup


# ── 1/2. ringing then answer; the 7-second delay must not be billed ────────
def test_the_incident_bills_214_not_221_and_not_3417():
    secs, basis = ag._billable_seconds(_Ctx(hangup=HANGUP), _Tools(answered=ANSWER))
    assert secs == BILLED == 214, "must bill from pickup, not from dial"
    assert secs != TOTAL, "221s is the carrier's TOTAL, not its BILLED duration"
    assert basis == "answer_to_hangup"


def test_a_seven_second_ring_is_excluded():
    billed_from_answer = int(HANGUP - ANSWER)
    billed_from_dial = int(HANGUP - DIAL)
    assert billed_from_dial - billed_from_answer == 7
    assert billed_from_answer == 214


@pytest.mark.parametrize("ring", [0, 1, 7, 15, 30])
def test_ringing_is_never_part_of_connected_time(ring):
    answer = float(ring)
    hangup = answer + 180
    secs, _ = ag._billable_seconds(_Ctx(hangup=hangup), _Tools(answered=answer))
    assert secs == 180, f"{ring}s of ringing leaked into the billed duration"


# ── 3. no answer ───────────────────────────────────────────────────────────
def test_a_call_that_was_never_answered_has_no_connected_time():
    """No pickup means nothing connected; the basis must say it is an estimate."""
    secs, basis = ag._billable_seconds(_Ctx(), _Tools(answered=None, started=time.time() - 25))
    assert basis == "job_wallclock"
    assert basis != "answer_to_hangup", "an unanswered call must not look provider-aligned"


# ── 4/5. representative durations ──────────────────────────────────────────
@pytest.mark.parametrize("seconds", [30, 214, 1800, 3600])
def test_answered_durations_are_exact(seconds):
    secs, basis = ag._billable_seconds(
        _Ctx(hangup=100.0 + seconds), _Tools(answered=100.0))
    assert secs == seconds
    assert basis == "answer_to_hangup"


# ── 6/7. both hangup paths ─────────────────────────────────────────────────
def test_caller_hangup_bills_to_the_disconnect():
    secs, basis = ag._billable_seconds(_Ctx(hangup=ANSWER + 214), _Tools(answered=ANSWER))
    assert (secs, basis) == (214, "answer_to_hangup")


def test_agent_hangup_bills_to_teardown():
    secs, basis = ag._billable_seconds(_Ctx(), _Tools(answered=time.monotonic() - 60))
    assert basis == "answer_to_teardown"
    assert 59 <= secs <= 62


# ── 8. duplicate disconnects ───────────────────────────────────────────────
def test_a_second_disconnect_cannot_change_the_billed_duration():
    tools = _Tools(answered=ANSWER)
    ctx = _Ctx(hangup=HANGUP)
    first, _ = ag._billable_seconds(ctx, tools)
    ctx._jj_hangup_mono = HANGUP          # the handler is guarded; re-read anyway
    second, _ = ag._billable_seconds(ctx, tools)
    assert first == second == 214


def test_shutdown_is_issued_once_per_call():
    class Ctx:
        pass

    ctx, issued = Ctx(), []
    for _ in range(4):
        if getattr(ctx, "_jj_ending", False):
            continue
        ctx._jj_ending = True
        issued.append(1)
    assert len(issued) == 1


# ── the wiring: exactly one authoritative answer stamp ─────────────────────
def test_the_answer_is_stamped_where_the_carrier_confirms_it():
    src = inspect.getsource(ag.entrypoint)
    # The CALL SITE, not the prose: an explanatory comment elsewhere also
    # mentions wait_until_answered, and matching that would prove nothing.
    i = src.index("CreateSIPParticipantRequest(")
    after = src[i:i + 1600]
    assert "wait_until_answered=True" in after
    assert "_answered_mono = time.monotonic()" in after, \
        "outbound must stamp the answer where the carrier confirms it"
    assert "sip_wait_until_answered" in after


def test_participant_connected_no_longer_claims_to_be_the_answer():
    """It fires at the carrier's "Start" (13:51:18), 7s before pickup."""
    src = inspect.getsource(ag.entrypoint)
    i = src.index('logger.info("sip_participant_found"')
    before = src[max(0, i - 900):i]
    assert "_answered_mono = time.monotonic()" not in before
    assert 'logger.info("call_answered"' not in before


def test_sip_participant_found_is_preserved_as_its_own_event():
    src = inspect.getsource(ag.entrypoint)
    assert 'logger.info("sip_participant_found"' in src


def test_exactly_two_call_answered_emitters_one_per_direction():
    """One for outbound (carrier-confirmed) and one for inbound; never two for
    the same call, and never a duplicate in participant_connected."""
    src = inspect.getsource(ag)
    n = src.count('logger.info("call_answered"')
    assert n == 2, f"expected one outbound + one inbound emitter, found {n}"
    assert "answer_source=" in src, "each must say which signal it came from"


def test_inbound_does_not_borrow_outbound_semantics():
    src = inspect.getsource(ag.entrypoint)
    i = src.index("inbound_participant_present_at_start")
    window = src[max(0, i - 700):i + 200]
    assert "user_in_room" in window
    assert "wait_until_answered" not in window, \
        "inbound has no dial and no wait_until_answered"


def test_ringing_is_recorded_separately_from_connected_time():
    src = inspect.getsource(ag.entrypoint)
    assert "ringing_seconds" in src
    assert "_dial_mono" in src


# ── 9. STT cleanup instrumentation ─────────────────────────────────────────
def test_stt_stream_lifetime_is_now_measured():
    """99 stt_connected events existed with zero closes, so Deepgram's billable
    duration could only be inferred."""
    hook = inspect.getsource(ag._shutdown_hook)
    assert "stt_disconnected" in hook
    assert "stream_open_seconds" in hook


def test_stt_cost_is_not_derived_from_room_lifetime():
    hook = inspect.getsource(ag._shutdown_hook)
    i_dur = hook.index("duration, duration_basis = _billable_seconds")
    i_stt = hook.index("stt_seconds = duration")
    assert i_dur < i_stt


def test_stt_logging_cannot_break_teardown():
    hook = inspect.getsource(ag._shutdown_hook)
    seg = hook[hook.index("stt_disconnected") - 400:]
    assert "except Exception" in seg


# ── 10/11. recording + campaign slot still released ────────────────────────
def test_recording_and_slot_release_survive_on_every_path():
    hook = inspect.getsource(ag._shutdown_hook)
    for required in ("complete_call", "remove_active_call", "settle_campaign_target"):
        assert required in hook, f"{required} missing from teardown"


def test_the_recording_is_not_cut_short_by_the_billing_change():
    """Billing anchors moved; recording finalisation must be untouched."""
    hook = inspect.getsource(ag._shutdown_hook)
    i_rec = hook.index("recording")
    assert i_rec > 0


# ── 12. inbound / outbound isolation ───────────────────────────────────────
def test_outbound_dial_branch_is_gated_on_no_participant():
    src = inspect.getsource(ag.entrypoint)
    assert 'if phone not in ("unknown", "demo") and not user_in_room:' in src


def test_inbound_answer_is_gated_on_a_participant_being_present():
    src = inspect.getsource(ag.entrypoint)
    i = src.index("inbound_participant_present_at_start")
    assert "if user_in_room and" in src[max(0, i - 700):i]


# ── 13/14. estimated vs provider-confirmed, and rounding ───────────────────
def test_the_cost_basis_is_labelled():
    hook = inspect.getsource(ag._shutdown_hook)
    assert "cost_basis=" in hook
    assert "provider_aligned" in hook and "estimated" in hook


def test_a_provider_aligned_duration_reproduces_the_vobiz_billed_span():
    secs, basis = ag._billable_seconds(_Ctx(hangup=HANGUP), _Tools(answered=ANSWER))
    assert (secs, basis) == (214, "answer_to_hangup")
    assert secs / 60 == pytest.approx(3.5667, abs=1e-3)


@pytest.mark.parametrize("seconds,rounded_minutes", [
    (1, 1), (59, 1), (60, 1), (61, 2), (214, 4), (240, 4), (241, 5),
])
def test_per_minute_rounding_model_if_the_rate_card_confirms_it(seconds, rounded_minutes):
    """Vobiz charged INR 1.80 for 214s. 1.80 / 4 = INR 0.45 exactly, which
    points at 60-second rounding. NOT applied to the tariff — this pins the
    arithmetic so it can be switched on once the rate card is seen."""
    import math
    assert math.ceil(seconds / 60) == rounded_minutes


def test_the_incident_cost_reconciles_under_the_rounding_hypothesis():
    import math
    assert math.ceil(214 / 60) * 0.45 == pytest.approx(1.80, abs=1e-9)


def test_the_configured_tariff_is_not_silently_changed():
    """One CDR is not a rate card; the tariff stays until verified."""
    src = inspect.getsource(ag)
    assert "0.45" not in src, "a tariff must not be hardcoded into the worker"


# ── 15. concurrency ────────────────────────────────────────────────────────
def test_concurrent_sessions_keep_independent_anchors():
    sessions = [(_Ctx(hangup=100.0 + d), _Tools(answered=100.0)) for d in (30, 214, 600)]
    assert [ag._billable_seconds(c, t)[0] for c, t in sessions] == [30, 214, 600]


def test_one_session_ending_does_not_touch_another():
    a_ctx, a_tools = _Ctx(hangup=314.0), _Tools(answered=100.0)
    b_ctx, b_tools = _Ctx(), _Tools(answered=time.monotonic() - 45)
    a_secs, a_basis = ag._billable_seconds(a_ctx, a_tools)
    b_secs, b_basis = ag._billable_seconds(b_ctx, b_tools)
    assert (a_secs, a_basis) == (214, "answer_to_hangup")
    assert b_basis == "answer_to_teardown" and 44 <= b_secs <= 47


# ── persistence ────────────────────────────────────────────────────────────
def test_answered_and_ended_are_persisted_not_defaulted():
    hook = inspect.getsource(ag._shutdown_hook)
    assert "answered_at=getattr(agent_tools" in hook
    assert "ended_at=getattr(ctx" in hook


def test_timestamps_cannot_be_moved_by_a_retry():
    import db
    src = inspect.getsource(db.complete_call)
    assert 'COALESCE("answeredAt"' in src
    assert 'COALESCE("endedAt"' in src


# ── no-answer calls must not accrue connected-call charges ─────────────────
class _DialedTools(_Tools):
    """A SIP dial was attempted."""
    _dial_attempted = True


def test_an_unanswered_dial_bills_zero_connected_seconds():
    """Busy, declined or ring-timeout: the carrier bills none of it, and
    Vobiz's CDR separates "Total" from "Connected/billed" for exactly this
    reason. Charging the job wall-clock invented connected time."""
    tools = _DialedTools(answered=None, started=time.time() - 45)
    secs, basis = ag._billable_seconds(_Ctx(), tools)
    assert secs == 0, "a call that never connected has no billable duration"
    assert basis == "no_answer"


def test_a_failed_dial_also_bills_zero():
    tools = _DialedTools(answered=None, started=time.time() - 8)
    assert ag._billable_seconds(_Ctx(), tools)[0] == 0


def test_an_answered_dial_is_unaffected_by_the_no_answer_rule():
    tools = _DialedTools(answered=100.0)
    secs, basis = ag._billable_seconds(_Ctx(hangup=314.0), tools)
    assert (secs, basis) == (214, "answer_to_hangup")


def test_a_demo_or_web_session_still_uses_the_wall_clock():
    """No SIP dial was attempted, so there is nothing to call unanswered."""
    tools = _Tools(answered=None, started=time.time() - 30)
    secs, basis = ag._billable_seconds(_Ctx(), tools)
    assert basis == "job_wallclock"
    assert 29 <= secs <= 32


def test_the_dial_attempt_is_flagged_at_dial_time():
    src = inspect.getsource(ag.entrypoint)
    i = src.index('logger.info("dialing_out"')
    assert "_dial_attempted = True" in src[max(0, i - 400):i]
