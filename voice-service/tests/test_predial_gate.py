"""A customer must never be rung by an agent that is already dead.

Room call-917397075913-4812:
    [ 5.37s] stt_stream_invalid_config   Sarvam close 4000
    [ 5.58s] dialing_out                 <- dialled anyway
    [13.03s] call_answered               <- customer answered silence
    [13.49s] FIRST_GREETING_FAILED       "AgentSession isn't running"

The gate runs immediately before create_sip_participant. Signals are the SDK's
own (`_activity is None` is exactly what say()/generate_reply() raise on, and
`_is_closing`) plus the stt_fail flag, which is set ONLY for a provider
rejection already classified permanent — transient errors never set it.
"""
from __future__ import annotations

import inspect

import pytest

import agent as ag


class _Session:
    def __init__(self, activity=True, closing=False):
        self._activity = object() if activity else None
        self._is_closing = closing


HEALTHY = {"critical": False}
FATAL_STT = {"critical": True}


# ── the gate's decision ────────────────────────────────────────────────────
def test_a_healthy_session_is_not_blocked():
    """The most important negative: never block a good call."""
    assert ag._session_terminal_failure(_Session(), HEALTHY) == ""


def test_fatal_stt_initialization_blocks_the_dial():
    assert ag._session_terminal_failure(_Session(), FATAL_STT) == "stt_initialization_failed"


def test_a_session_that_never_started_blocks_the_dial():
    assert ag._session_terminal_failure(_Session(activity=False), HEALTHY) \
        == "agent_session_not_running"


def test_a_closing_session_blocks_the_dial():
    assert ag._session_terminal_failure(_Session(closing=True), HEALTHY) \
        == "agent_session_closing"


def test_a_transient_error_does_not_block():
    """stt_fail["critical"] is set only for a permanent (retryable=False)
    rejection; a transient transport blip leaves it False."""
    assert ag._session_terminal_failure(_Session(), {"critical": False}) == ""


def test_the_incident_condition_is_caught():
    """STT already terminally failed while the session object still exists —
    exactly the 4812 state at t=5.58s."""
    assert ag._session_terminal_failure(_Session(activity=True), FATAL_STT) != ""


def test_an_object_missing_the_attributes_is_treated_as_dead():
    """A stub/partially-built session must fail closed, never open."""
    class Bare:
        pass
    assert ag._session_terminal_failure(Bare(), HEALTHY) == "agent_session_not_running"


def test_the_gate_never_raises():
    """It runs on the dial path; an exception here would be worse than either
    outcome."""
    for sess in (_Session(), _Session(activity=False), _Session(closing=True), object()):
        for flags in (HEALTHY, FATAL_STT, {}):
            out = ag._session_terminal_failure(sess, flags)
            assert isinstance(out, str)


# ── wiring: where it sits and what it does ─────────────────────────────────
def _dial_block() -> str:
    """The gate, the abort path and the dial, as source text.

    Bounded by the next real step after the dial rather than a character count:
    a fixed 2000-char window silently stopped covering the abort path once the
    gate's diagnostics (session state + first shutdown origin) were added, so
    four tests failed against correct code.
    """
    src = inspect.getsource(ag.entrypoint)
    i = src.index("_dead = _session_terminal_failure(")
    j = src.index("await _maybe_start_recording(", i)
    return src[i:j]


def test_the_gate_runs_before_the_sip_request():
    src = inspect.getsource(ag.entrypoint)
    assert src.index("_dead = _session_terminal_failure(") < src.index("CreateSIPParticipantRequest(")


def test_the_gate_runs_before_dialing_out_is_even_logged():
    src = inspect.getsource(ag.entrypoint)
    assert src.index("_dead = _session_terminal_failure(") < src.index('logger.info("dialing_out"')


def test_it_aborts_rather_than_dialling():
    body = _dial_block()
    assert "outbound_dial_aborted" in body
    assert "return" in body


def test_the_campaign_slot_is_released_explicitly():
    """The shutdown hook that normally settles the target is registered AFTER
    the dial, so an early return would strand the target in DISPATCHED and
    hold a concurrency slot forever."""
    body = _dial_block()
    assert "settle_campaign_target" in body
    assert "refresh_campaign_counters" in body
    assert "campaign_slot_released" in body


def test_the_shutdown_hook_really_is_registered_after_the_dial():
    """Pins the reason the explicit release is required."""
    src = inspect.getsource(ag.entrypoint)
    assert src.index('logger.info("dialing_out"') < src.index("add_shutdown_callback")


def test_the_active_call_row_is_cleaned_up():
    """The abort routes through _release_job, which drops the row AND ends the
    job. Returning without ending the job left the agent in the room holding
    DB connections (measured 2026-10-17)."""
    assert "_release_job(ctx," in _dial_block()
    assert "remove_active_call" in inspect.getsource(ag._release_job)
    assert "ctx.shutdown(" in inspect.getsource(ag._release_job)


def test_a_slot_release_failure_cannot_break_the_abort():
    body = _dial_block()
    seg = body[body.index("settle_campaign_target"):]
    assert "except Exception" in seg
    assert "campaign_slot_release_failed" in seg


def test_the_abort_is_actionable_in_live_logs():
    body = _dial_block()
    for field in ("reason=", "breakpoint=", "retryable=", "impact=", "remedy="):
        assert field in body, field
    assert "logger.critical" in body


def test_the_outcome_is_recorded_as_failed():
    assert '_closed_outcome = "FAILED"' in _dial_block()


# ── inbound must be untouched ──────────────────────────────────────────────
def test_the_gate_is_inside_the_outbound_branch_only():
    """Inbound already has a SIP participant in the room, so the branch
    containing the gate never runs for it."""
    src = inspect.getsource(ag.entrypoint)
    guard = 'if phone not in ("unknown", "demo") and not user_in_room:'
    assert guard in src
    assert src.index(guard) < src.index("_dead = _session_terminal_failure(")


def test_no_sleep_was_added_to_the_dial_path():
    body = _dial_block()
    assert "asyncio.sleep" not in body, "readiness must come from SDK signals, not delays"


# ── the SDK's real shape ───────────────────────────────────────────────────
# The 2026-10-17 incident: `_Session` above models `_is_closing` as a plain
# bool, but the real AgentSession exposes it as a METHOD. `getattr(s,
# "_is_closing", False)` then returns the bound method, which is always truthy,
# so the gate aborted EVERY outbound dial (4 calls, 09:47-09:52, all
# reason=agent_session_closing) while nothing had requested a shutdown. These
# tests use the real shape, so that mistake cannot come back unnoticed.
class _SdkShapedSession:
    """Mirrors livekit.agents.voice.AgentSession: _activity is an attribute,
    _is_closing is a method."""

    def __init__(self, activity=True, closing=False):
        self._activity = object() if activity else None
        self.__closing = closing

    def _is_closing(self) -> bool:
        return self.__closing


def test_a_healthy_sdk_shaped_session_is_not_blocked():
    """The regression: a live, healthy session must dial."""
    assert ag._session_terminal_failure(_SdkShapedSession(), HEALTHY) == ""


def test_a_genuinely_closing_sdk_shaped_session_blocks_the_dial():
    assert ag._session_terminal_failure(
        _SdkShapedSession(closing=True), HEALTHY) == "agent_session_closing"


def test_a_closing_check_that_raises_does_not_block_a_healthy_session():
    """A private API that cannot answer is not proof of closure."""
    class _Raises(_SdkShapedSession):
        def _is_closing(self):
            raise RuntimeError("private API changed")

    assert ag._session_terminal_failure(_Raises(), HEALTHY) == ""


def test_the_installed_sdk_still_exposes_is_closing_as_a_callable():
    """Contract test against the REAL installed SDK.

    Pins the assumption the fix is built on. If a future livekit-agents turns
    `_is_closing` into a property, this fails and the gate must be revisited
    rather than silently truth-testing a bool-like object again.
    """
    from livekit.agents.voice.agent_session import AgentSession

    attr = inspect.getattr_static(AgentSession, "_is_closing")
    assert not isinstance(attr, property), (
        "_is_closing became a property; the callable() branch in "
        "_session_terminal_failure needs review")
    assert callable(attr), "_is_closing must be a method on AgentSession"


def test_the_gate_does_not_truth_test_a_bound_method():
    """Belt-and-braces: the gate must call the method, not test its truthiness.

    A bare `if getattr(s, "_is_closing", False):` passes every other test in
    this file but fails here, because a method object is always truthy.
    """
    called = {"n": 0}

    class _Counting(_SdkShapedSession):
        def _is_closing(self):
            called["n"] += 1
            return False

    assert ag._session_terminal_failure(_Counting(), HEALTHY) == ""
    assert called["n"] == 1, "the gate must invoke _is_closing(), not just read it"
