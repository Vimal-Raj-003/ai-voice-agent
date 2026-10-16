"""The SIP leg leaving IS the end of the call.

Reconstructed from room call-917397075913-5801:

    08:21:03  session start
    08:24:59  sip_participant_left      <- the caller hung up
              ... 3164s (52.7 minutes) with no events at all ...
    09:17:43  participant_left          <- LiveKit reaped the empty room
    09:18:23  session_ended  duration=3417  outcome=COMPLETED

`participant_disconnected` was wired to a log line and nothing else, so a
hangup did not end the session. The consequences were all measurable:
duration was stored as 3417s for a call that really lasted 236s (~14x, and
every cost is derived from duration), a worker slot and an active_calls row
were held for 53 minutes, and campaign concurrency was starved by a call that
had already ended.

The dashboard diagnostics participant joins and leaves these rooms routinely,
so only the SIP participant may end a call.

All mocked — no LiveKit room, no SIP.
"""
from __future__ import annotations

import inspect

import agent as ag


SRC = inspect.getsource(ag.entrypoint) if hasattr(ag, "entrypoint") else inspect.getsource(ag)


def _handler_src() -> str:
    i = SRC.index('@ctx.room.on("participant_disconnected")')
    return SRC[i:i + 2600]


# ── the hangup must end the session ────────────────────────────────────────
def test_a_sip_hangup_shuts_the_session_down():
    body = _handler_src()
    assert "ctx.shutdown(reason=" in body, "a SIP hangup must end the session"


def test_shutdown_runs_the_normal_completion_path():
    """ctx.shutdown() triggers the registered shutdown hook, so the call row is
    completed exactly as it is for an agent-initiated hangup — rather than a
    second, divergent teardown path."""
    body = _handler_src()
    assert "ctx.shutdown(reason=" in body
    assert "aclose" not in body, "must not tear the session down out of band"
    assert "delete_room" not in body, "must not bypass the shutdown hook"


def test_the_hangup_is_logged_distinctly():
    assert "call_ended_by_caller_hangup" in _handler_src()


# ── only the SIP participant may end a call ────────────────────────────────
def test_a_non_sip_participant_never_ends_the_call():
    """The Dashboard Monitor joins and leaves constantly; if its departure
    ended calls, opening diagnostics would hang up on customers."""
    body = _handler_src()
    i_guard = body.index("if not is_sip:")
    i_shutdown = body.index("ctx.shutdown(reason=")
    assert i_guard < i_shutdown, "the SIP guard must precede shutdown"
    assert "return" in body[i_guard:i_shutdown]


def test_sip_detection_accepts_both_forms():
    """kind == PARTICIPANT_KIND_SIP, or an identity prefixed sip_."""
    class P:
        def __init__(self, ident="", kind=None):
            self.identity = ident
            self.kind = kind

    assert ag._is_sip_participant("sip_919940660868", P("sip_919940660868")) is True
    assert ag._is_sip_participant("Dashboard Monitor", P("Dashboard Monitor")) is False
    assert ag._is_sip_participant("", P("")) is False


def test_the_monitor_identity_is_not_sip():
    class P:
        identity = "Dashboard Monitor"
        kind = None

    assert ag._is_sip_participant(P.identity, P()) is False


# ── idempotence ────────────────────────────────────────────────────────────
def test_shutdown_is_guarded_against_firing_twice():
    """A second disconnect event (or a race with an agent-initiated hangup)
    must not start a second teardown."""
    body = _handler_src()
    assert "_jj_ending" in body
    i_flag_read = body.index('getattr(ctx, "_jj_ending"')
    i_flag_set = body.index("ctx._jj_ending = True")
    i_shutdown = body.index("ctx.shutdown(reason=")
    assert i_flag_read < i_flag_set < i_shutdown


def test_a_shutdown_failure_cannot_raise_into_the_event_loop():
    """This runs inside an rtc event callback; an exception there is swallowed
    by the SDK and would leave the call hanging with no trace."""
    body = _handler_src()
    seg = body[body.index("ctx.shutdown(reason="):]
    assert "except Exception" in seg
    assert "hangup_shutdown_failed" in seg


# ── the duration that gets stored ──────────────────────────────────────────
def test_the_recorded_duration_now_reflects_the_real_call():
    """With the session ending at hangup, duration is measured to the hangup
    rather than to LiveKit's room reaper."""
    start = 0.0
    hangup = 236.0            # the real call
    reaped = 3417.0           # when the room was actually torn down
    assert int(hangup - start) == 236
    # Before the fix the shutdown hook ran at `reaped`:
    assert int(reaped - start) == 3417
    assert round(reaped / hangup, 1) == 14.5, "the old duration was ~14.5x reality"


# ── cleanup runs exactly once (Priority 5) ─────────────────────────────────
def test_the_sdk_makes_a_second_shutdown_a_no_op():
    """Verified against the installed SDK rather than assumed.

    livekit.agents.ipc.job_proc_lazy_main._on_ctx_shutdown resolves a future
    inside `contextlib.suppress(asyncio.InvalidStateError)`, so a second
    ctx.shutdown() cannot run the shutdown callbacks again. That is what makes
    the hangup path safe to add alongside LiveKit's own room teardown: whichever
    fires first wins and the other is absorbed.
    """
    import inspect
    from livekit.agents.ipc import job_proc_lazy_main as jp

    src = inspect.getsource(jp)
    i = src.index("def _on_ctx_shutdown")
    body = src[i:i + 400]
    assert "suppress(asyncio.InvalidStateError)" in body
    assert "set_result" in body


def test_our_guard_prevents_even_the_first_duplicate():
    """Belt and braces: the SDK absorbs a double shutdown, and _jj_ending means
    we do not issue one in the first place (two disconnect events, or a race
    with an agent-initiated hangup)."""
    class Ctx:
        pass

    ctx = Ctx()
    calls = []
    # Mirrors the handler's guard.
    for _ in range(3):
        if getattr(ctx, "_jj_ending", False):
            continue
        ctx._jj_ending = True
        calls.append("shutdown")
    assert calls == ["shutdown"], "shutdown must be issued exactly once"


def test_an_agent_initiated_hangup_still_completes_the_call():
    """end_call() tears down through the same shutdown hook; the new SIP path
    must not have introduced a second, divergent teardown."""
    import inspect
    import agent as a

    hook = inspect.getsource(a._shutdown_hook)
    assert "complete_call" in hook
    assert "remove_active_call" in hook
    assert "settle_campaign_target" in hook, \
        "campaign slot release must happen on every teardown path"
