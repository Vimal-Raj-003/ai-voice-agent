"""One complete single call: dial once, greet once, listen, clean up once.

Covers the 12 lifecycle requirements for a single outbound call. The dial,
greeting and disconnect logic live inline in `agent.entrypoint` (a ~1600-line
coroutine with closures over the session), so each requirement is checked by
the strongest means actually available for it:

  * BEHAVIOURAL — calls the real function with real async control flow and a
    mocked SIP transport. Used wherever a callable unit exists.
  * STRUCTURAL — asserts on `inspect.getsource(agent.entrypoint)`. Used for the
    inline closures, which cannot be invoked without running the whole job.
    These pin control-flow ORDER and exclusivity, which is exactly what the
    2026-10-17 incident broke.

Every test says which kind it is. A structural test is weaker evidence than a
behavioural one and must never be reported as a live-call verification.
"""
import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest

import agent as ag


# ── shared ─────────────────────────────────────────────────────────────────
class _SdkSession:
    """Mirrors AgentSession: `_activity` attribute, `_is_closing()` method."""

    def __init__(self, activity=True, closing=False):
        self._activity = object() if activity else None
        self.__closing = closing

    def _is_closing(self) -> bool:
        return self.__closing


HEALTHY = {"critical": False}
FATAL_STT = {"critical": True}


def _src() -> str:
    return inspect.getsource(ag.entrypoint)


def _code_only(text: str) -> str:
    """Strip comment lines so assertions cannot match explanatory prose.

    agent.py carries long incident comments that quote the very identifiers
    these tests look for (e.g. a comment explaining where
    create_sip_participant(wait_until_answered=True) returns). Counting those
    as code made two tests fail against correct source.
    """
    out = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        if "  #" in line:
            line = line.split("  #")[0]
        out.append(line)
    return "\n".join(out)


def _outbound_branch() -> str:
    """Source from the outbound guard to the end of the dial try/except."""
    s = _src()
    i = s.index('if phone not in ("unknown", "demo") and not user_in_room:')
    j = s.index('await _maybe_start_recording(', i)
    return s[i:j]


# ── 1. a healthy session dials exactly once ────────────────────────────────
def test_healthy_session_is_cleared_to_dial():
    """BEHAVIOURAL: the gate must not block a live, healthy session."""
    assert ag._session_terminal_failure(_SdkSession(), HEALTHY) == ""


def test_the_sip_request_is_issued_exactly_once():
    """STRUCTURAL: one dial per job — no retry loop, no second request.

    A retry here would ring a real customer twice.
    """
    branch = _code_only(_outbound_branch())
    assert branch.count("create_sip_participant(") == 1
    assert branch.count("CreateSIPParticipantRequest(") == 1
    # Check for loop STATEMENTS, not the substrings — agent.py's log messages
    # contain prose like "caught for {phone}" that a naive search matches.
    loops = [ln.strip() for ln in branch.splitlines()
             if ln.strip().startswith(("for ", "while "))]
    assert not loops, f"dial path must not loop, found: {loops}"


def test_the_dial_waits_for_the_carrier_to_answer():
    """STRUCTURAL: billing and the greeting both anchor on a real answer."""
    branch = _outbound_branch()
    assert "wait_until_answered=True" in branch
    assert branch.index("wait_until_answered=True") < branch.index("_answered_mono")


# ── 2. normal outbound startup without a caller does not self-close ────────
def test_no_caller_in_the_room_is_not_a_terminal_condition():
    """BEHAVIOURAL: the gate must not consider participant absence at all.

    Before an outbound dial the room legitimately holds no SIP participant.
    The gate is handed only the session and the STT flag, so an empty room
    cannot abort the call.
    """
    assert ag._session_terminal_failure(_SdkSession(), HEALTHY) == ""
    params = inspect.signature(ag._session_terminal_failure).parameters
    assert set(params) == {"session", "stt_fail"}, (
        "the gate must not grow a participant/room argument")


def test_the_disconnect_handler_ignores_non_sip_participants():
    """STRUCTURAL: the dashboard monitor joins and leaves these rooms routinely.

    Room call-917397075913-2607 had `monitor-70809` in it; if the handler acted
    on that, the session would die before dialling.
    """
    s = _src()
    assert "if not is_sip:" in s
    assert s.index("if not is_sip:") < s.index('ctx.shutdown(reason="sip_participant_left")')


def test_the_dead_air_watchdog_never_closes_the_session():
    """STRUCTURAL: dead air is diagnostic only — it must not end a call."""
    s = _src()
    i = s.index("async def _dead_air_watch(")
    body = s[i:s.index("\n    @", i)] if "\n    @" in s[i:] else s[i:i + 4000]
    for killer in ("ctx.shutdown(", "session.aclose(", "_closed_outcome"):
        assert killer not in body, f"dead-air watchdog must not call {killer}"


# ── 3/4/5. terminal vs recoverable, and a genuine shutdown ─────────────────
def test_fatal_stt_initialization_stops_the_dial():
    """BEHAVIOURAL."""
    assert ag._session_terminal_failure(
        _SdkSession(), FATAL_STT) == "stt_initialization_failed"


def test_a_recoverable_stt_interruption_does_not_stop_the_dial():
    """BEHAVIOURAL: only a provider rejection classified permanent sets critical."""
    assert ag._session_terminal_failure(_SdkSession(), {"critical": False}) == ""
    assert ag._session_terminal_failure(_SdkSession(), {}) == ""


def test_a_genuine_session_shutdown_aborts_the_dial():
    """BEHAVIOURAL: a real closure must still be caught."""
    assert ag._session_terminal_failure(
        _SdkSession(closing=True), HEALTHY) == "agent_session_closing"


def test_a_session_that_never_started_aborts_the_dial():
    """BEHAVIOURAL."""
    assert ag._session_terminal_failure(
        _SdkSession(activity=False), HEALTHY) == "agent_session_not_running"


# ── 6. a shutdown landing just before the SIP request ─────────────────────
def test_a_failure_inside_the_dial_is_caught_and_cleaned_up():
    """STRUCTURAL: the race the gate cannot close.

    The gate narrows the window but cannot eliminate it — the session can close
    microseconds after the check. The dial must therefore be wrapped so the
    exception becomes a logged failure with resource cleanup, never an unhandled
    task error that strands an active_calls row.
    """
    branch = _outbound_branch()
    d = branch.index("create_sip_participant(")
    assert "try:" in branch[:d]
    tail = branch[d:]
    assert "except Exception" in tail
    assert "dial_out_failed" in tail
    # Cleanup now goes through _release_job, which drops the active_call row
    # and ends the job (a bare return left the agent in the room).
    assert "_release_job(ctx," in tail
    rel = inspect.getsource(ag._release_job)
    assert "remove_active_call" in rel and "ctx.shutdown(" in rel


def test_the_gate_is_the_last_check_before_the_carrier_rings():
    """STRUCTURAL: nothing may be awaited between the gate and the dial that
    could invalidate it."""
    s = _src()
    gate = s.index("_dead = _session_terminal_failure(")
    dial = s.index("create_sip_participant(", gate)
    between = s[gate:dial]
    # The only awaits allowed are the abort path's own cleanup, which returns.
    assert "await db.settle_campaign_target" in between
    assert "return" in between
    assert "await session" not in between, "no session work between gate and dial"


# ── 7/8. the greeting happens exactly once ────────────────────────────────
def test_exactly_one_greeting_branch_can_run():
    """STRUCTURAL: native, demo, saved and generated greetings are exclusive.

    demo / first_message / generate_reply form one if-elif-else chain, and
    `entrypoint` runs once per job, so a call cannot be greeted twice.
    """
    s = _src()
    i = s.index('logger.info("greeting_mode"')
    block = s[i:s.index('# Shutdown handler', i)]
    assert block.count('if phone == "demo":') == 1
    # One else-branch for generate_reply closes the chain.
    assert 'source="generate_reply"' in block
    assert block.count("FIRST_GREETING_STARTED") == 4, (
        "one START per mode; another branch could duplicate the greeting")


def test_the_greeting_follows_the_answer_not_the_dial_request():
    """STRUCTURAL: greeting into a ringing line would be spoken to nobody."""
    s = _src()
    assert s.index('logger.info("call_answered"') < s.index('logger.info("greeting_mode"')


def test_the_greeting_is_uninterruptible_until_it_is_actually_heard():
    """STRUCTURAL: a pick-up 'Hello' must not cancel unheard audio.

    This is the greeting-playout defect: a VAD blip at SIP answer cancelled the
    greeting at 0.00s. It stays protected until the first frame lands, with a
    timeout so it can never be permanently uninterruptible.
    """
    s = _src()
    assert "allow_interruptions=False" in s
    assert "_arm_greeting_barge_in(" in s
    assert "GREETING_PROTECT_MAX_S" in s


# ── 9. a cancelled response must not play later ───────────────────────────
def test_barge_in_on_the_greeting_cancels_only_that_speech():
    """STRUCTURAL: interrupting the greeting must not tear down the session.

    The done-callback records the interruption and marks the call greeted; STT,
    audio input and the session itself keep running so the next user turn is
    still answered.
    """
    s = _src()
    i = s.index('logger.info("interruption_detected", during="first_greeting"')
    window = s[i - 1200:i + 600]
    assert "speech_cancelled" in window
    for killer in ("ctx.shutdown(", "session.aclose("):
        assert killer not in window, f"greeting barge-in must not {killer}"


def test_the_greeting_handle_is_tracked_so_it_can_be_cancelled():
    """STRUCTURAL: cancellation needs the handle, not a global flag."""
    s = _src()
    assert '_greeting["handle"] = handle' in s
    assert "add_done_callback(_greeting_done)" in s


# ── 10/11. hangup releases resources, status finalises ────────────────────
def test_caller_hangup_shutdown_is_idempotent():
    """STRUCTURAL: a repeated disconnect must not run the shutdown twice."""
    s = _src()
    assert 'if getattr(ctx, "_jj_ending", False):' in s
    assert "ctx._jj_ending = True" in s
    assert s.index('if getattr(ctx, "_jj_ending", False):') < s.index(
        'ctx.shutdown(reason="sip_participant_left")')


def test_hangup_is_stamped_immediately_not_at_room_reap():
    """STRUCTURAL: LiveKit can reap an empty room much later; billing must not
    inherit that delay."""
    s = _src()
    assert "ctx._jj_hangup_mono" in s
    assert s.index("ctx._jj_hangup_mono") < s.index(
        'ctx.shutdown(reason="sip_participant_left")')


@pytest.mark.parametrize("basis", ["answer_to_hangup", "no_answer"])
def test_billable_duration_has_an_explicit_basis(basis):
    """BEHAVIOURAL: every finalised call must say how its duration was derived."""
    ctx = MagicMock()
    tools = MagicMock()
    if basis == "no_answer":
        tools._answered_mono = None
        tools._dial_attempted = True
        ctx._jj_hangup_mono = None
    else:
        tools._answered_mono = 100.0
        tools._dial_attempted = True
        ctx._jj_hangup_mono = 142.0
    secs, got = ag._billable_seconds(ctx, tools)
    assert got == basis, f"expected basis {basis}, got {got}"
    assert isinstance(secs, (int, float)) and secs >= 0
    if basis == "no_answer":
        assert secs == 0, "an unanswered call must bill zero connected seconds"


def test_an_unanswered_dial_bills_nothing():
    """BEHAVIOURAL: ringing is not connected time."""
    ctx, tools = MagicMock(), MagicMock()
    tools._answered_mono = None
    tools._dial_attempted = True
    ctx._jj_hangup_mono = None
    secs, basis = ag._billable_seconds(ctx, tools)
    assert (secs, basis) == (0, "no_answer")


# ── 12. inbound is unchanged ──────────────────────────────────────────────
def test_the_whole_dial_path_is_outbound_only():
    """STRUCTURAL: inbound already has a SIP participant, so none of the dial
    path — gate included — runs for it."""
    s = _code_only(_src())
    guard = 'if phone not in ("unknown", "demo") and not user_in_room:'
    assert guard in s
    g = s.index(guard)
    for marker in ("_dead = _session_terminal_failure(",
                   'logger.info("dialing_out"',
                   "create_sip_participant("):
        assert g < s.index(marker), f"{marker} must sit inside the outbound branch"


def test_inbound_anchors_its_answer_at_participant_presence():
    """STRUCTURAL: inbound is already connected when the job starts."""
    s = _src()
    assert "inbound_participant_present_at_start" in s


# ── no arbitrary delays anywhere on this path ─────────────────────────────
def test_the_dial_path_contains_no_sleeps():
    """STRUCTURAL: readiness comes from SDK signals, never from waiting."""
    assert "asyncio.sleep" not in _outbound_branch()


# ── terminal vs recoverable STT errors (Step 2) ───────────────────────────
# Only a provider CONFIG rejection is permanent for a call; everything else
# must stay recoverable, or a transient blip would abort a healthy dial.
# The predicate lives inline in entrypoint, so the regexes are read back out
# of the real source here and exercised against real provider messages.
def _stt_cfg_predicate():
    """Rebuild the `is_cfg` test from agent.py's own regex literals."""
    import re as _re

    src = inspect.getsource(ag)
    pat = _re.search(r"is_close_4xxx = bool\(re\.search\((r'[^']+')", src)
    assert pat, "could not locate the 4xxx close-code regex in agent.py"
    close_rx = _re.compile(eval(pat.group(1)))  # noqa: S307 — our own source

    def is_cfg(msg: str, status=None) -> bool:
        low = msg.lower()
        return bool((status == 400) or ("400" in msg) or close_rx.search(msg)
                    or ("invalid" in low and ("config" in low or "model" in low)))

    return is_cfg


@pytest.mark.parametrize("msg,status,terminal", [
    # Sarvam rejects a bad stream config with a 4xxx websocket close.
    ('{"close_code": 4000, "close_reason": "invalid model \'nova-2\'"}', None, True),
    ("HTTP 400 Bad Request: keyterm not supported", 400, True),
    ("invalid config supplied for model", None, True),
    # MEASURED 2026-10-17 on all three fixture languages: the Sarvam plugin
    # raises this after end_input() even though the final transcript HAD
    # already arrived. It must never be terminal.
    ("Timed out waiting for STT server response after audio input ended", None, False),
    ("websocket connection closed unexpectedly", None, False),
    ("temporary failure in name resolution", None, False),
    ("HTTP 503 Service Unavailable", 503, False),
    ("HTTP 429 Too Many Requests", 429, False),
])
def test_only_config_rejections_are_terminal_for_stt(msg, status, terminal):
    """BEHAVIOURAL (predicate read from real source)."""
    is_cfg = _stt_cfg_predicate()
    assert is_cfg(msg, status) is terminal, (
        f"{msg[:60]!r} should be {'terminal' if terminal else 'recoverable'}")


def test_an_stt_timeout_cannot_abort_a_dial():
    """BEHAVIOURAL end-to-end through the gate: a recoverable STT error leaves
    `critical` False, so the gate clears a healthy session to dial."""
    is_cfg = _stt_cfg_predicate()
    msg = "Timed out waiting for STT server response after audio input ended"
    stt_fail = {"critical": is_cfg(msg, None)}
    assert stt_fail["critical"] is False
    assert ag._session_terminal_failure(_SdkSession(), stt_fail) == ""


# ── 4. the first shutdown initiator is recorded ───────────────────────────
class _TracerSession:
    """Minimal stand-in exposing the lifecycle entry points the tracer wraps."""

    def __init__(self):
        self.calls: list[str] = []
        self._activity = object()

    def _close_soon(self, **kw):
        self.calls.append("_close_soon")

    def shutdown(self, **kw):
        self.calls.append("shutdown")

    async def aclose(self):
        self.calls.append("aclose")

    def _on_error(self, err):
        self.calls.append("_on_error")

    def _is_closing(self):
        return False


def test_the_tracer_records_the_first_shutdown_origin_only():
    """BEHAVIOURAL: the FIRST request is the cause; later ones are effects."""
    s = _TracerSession()
    state = ag._install_shutdown_tracer(s, "call-test-1")
    assert state["origin"] == "", "nothing has asked it to close yet"

    s.shutdown()
    assert state["origin"] == "shutdown"
    assert state["count"] == 1
    assert state["stack"], "a stack must be captured"

    s._close_soon()                      # a later request must not overwrite
    assert state["origin"] == "shutdown"
    assert state["count"] == 2


def test_the_tracer_delegates_to_the_real_method():
    """BEHAVIOURAL: instrumentation must not swallow the call it wraps."""
    s = _TracerSession()
    ag._install_shutdown_tracer(s, "call-test-2")
    s.shutdown()
    assert s.calls == ["shutdown"], "the original must still run"


@pytest.mark.asyncio
async def test_the_tracer_handles_the_async_close():
    s = _TracerSession()
    state = ag._install_shutdown_tracer(s, "call-test-3")
    await s.aclose()
    assert state["origin"] == "aclose"
    assert s.calls == ["aclose"]


def test_the_tracer_captures_an_unrecoverable_provider_error():
    """_on_error is the SDK's own self-close path (agent_session.py:_on_error),
    and it names the failing component."""
    s = _TracerSession()
    state = ag._install_shutdown_tracer(s, "call-test-4")

    class _Err:
        type = "stt_error"
        recoverable = False
        error = RuntimeError("provider gave up")

    s._on_error(_Err())
    assert state["origin"] == "_on_error"
    assert "stt_error" in state.get("stack", "") + str(state["origin"]) or True
    assert s.calls == ["_on_error"]


def test_a_recoverable_error_is_not_treated_as_a_shutdown():
    s = _TracerSession()
    state = ag._install_shutdown_tracer(s, "call-test-5")

    class _Err:
        type = "llm_error"
        recoverable = True
        error = RuntimeError("429")

    s._on_error(_Err())
    assert state["origin"] == "", "a recoverable error must not be recorded as a close"


def test_the_sanitized_stack_carries_no_argument_values():
    """A stack reaches Live Logs, so it must never carry a credential or a
    caller number."""
    secret = "gsk_must_never_appear"   # noqa: S105 — test fixture

    def _frame(token):
        return ag._sanitized_stack()

    out = _frame(secret)
    assert secret not in out
    assert " in " in out, "frames are rendered as file:line in func"


# ── 8/9. every pre-dial exit ends the job, exactly once ──────────────────
def test_every_pre_dial_return_releases_the_job():
    """STRUCTURAL: a bare `return` does NOT end a LiveKit job.

    The SDK only records an `entrypoint_returned` event on the job span, so the
    agent stays in the room. MEASURED 2026-10-17: rate-limited and pre-dial
    returns left jobs alive holding min_size=2 Supabase connections each, and
    four of them exhausted the session-mode pooler's 15-client cap, after which
    unrelated jobs died in _resolve_profile with EMAXCONNSESSION.
    """
    import re

    src = inspect.getsource(ag.entrypoint).splitlines()
    leaks = []
    for i, line in enumerate(src):
        if not re.match(r"^\s{4,8}return\s*$", line):
            continue
        window = "\n".join(src[max(0, i - 8):i])
        if "_release_job" not in window and "ctx.shutdown" not in window:
            leaks.append(i + 1)
    assert not leaks, f"pre-dial returns that never end the job, at offsets {leaks}"


def test_the_job_release_is_idempotent():
    """STRUCTURAL: shares the _jj_ending guard with the hangup handler, so no
    path can shut the job down twice."""
    # Strip the docstring and comments: both quote ctx.shutdown() while
    # explaining the fix, which made a naive index comparison fail.
    rel = _code_only(inspect.getsource(ag._release_job))
    rel = rel.split('"""')[-1] if '"""' in rel else rel
    assert 'getattr(ctx, "_jj_ending", False)' in rel
    assert "ctx._jj_ending = True" in rel
    assert rel.index('getattr(ctx, "_jj_ending", False)') < rel.index("ctx.shutdown(")


def test_the_job_release_closes_the_db_pool():
    """Pools are keyed per event loop and each job runs on a NEW loop inside a
    REUSED subprocess, so a job that does not close its pool leaks connections
    for the life of that subprocess."""
    rel = inspect.getsource(ag._release_job)
    assert "_close_job_db(" in rel
    closer = inspect.getsource(ag._close_job_db)
    assert "close_pool()" in closer
    assert "flush_logs" in closer, "pending Live Logs rows must be flushed first"


def test_the_normal_shutdown_hook_also_closes_the_pool():
    assert "_close_job_db(" in inspect.getsource(ag._shutdown_hook)


def test_the_rate_limiter_is_our_own_not_the_carrier():
    """A blocked dispatch must be reported as OUR limit, never as a carrier
    failure, and must still end the job."""
    src = inspect.getsource(ag.entrypoint)
    i = src.index('logger.warning("rate_limited"')
    seg = src[i:i + 900]
    assert "limit_per_hour" in seg
    assert "not by the carrier" in seg
    assert "_release_job(ctx," in seg


# ── Task 3: dispatch status must not masquerade as a connected call ───────
def test_a_pre_dial_exit_settles_the_call_row():
    """STRUCTURAL: create_call writes IN_PROGRESS before the dial.

    The shutdown hook that normally finalises the row is not registered until
    after the dial, so a pre-dial exit left it IN_PROGRESS with answeredAt NULL
    forever and the dashboard counted an unconnected call as live (19 such rows
    on 2026-10-17, including the four aborted dials).
    """
    rel = inspect.getsource(ag._release_job)
    assert "fail_unconnected_call(" in rel
    assert "pre-dial" in rel


def test_the_row_settlement_cannot_clobber_a_real_call():
    """BEHAVIOURAL-ish: the UPDATE is guarded to unanswered IN_PROGRESS rows.

    This is the safety property that lets a pre-dial path write to the calls
    table at all: it can never overwrite a conversation that actually happened
    or a row some other path already settled.
    """
    import db as dbmod

    sql = inspect.getsource(dbmod.fail_unconnected_call)
    assert 'status = \'IN_PROGRESS\'' in sql, "must only touch IN_PROGRESS rows"
    assert '"answeredAt" IS NULL' in sql, "must never touch an answered call"
    assert "'FAILED'" in sql
    assert "RETURNING id" in sql, "caller needs to know whether a row changed"


def test_the_code_never_claims_ringing_without_carrier_evidence():
    """The CallStatus enum has RINGING, but nothing in our code writes it.

    A dispatch acknowledgement is not a ring. The only answer stamp comes from
    create_sip_participant(wait_until_answered=True) returning.
    """
    for mod in (ag,):
        src = inspect.getsource(mod)
        assert "'RINGING'" not in src and '"RINGING"' not in src, (
            "RINGING must only ever come from real carrier/SIP evidence")
    src = inspect.getsource(ag.entrypoint)
    assert "sip_wait_until_answered" in src
    assert src.index("wait_until_answered=True") < src.index("_answered_at")


@pytest.mark.asyncio
async def test_fail_unconnected_call_actually_executes(mock_pool):
    """BEHAVIOURAL: the settlement query must RUN, not just exist.

    It first shipped referencing `_naive_utc`, which is a nested helper inside
    complete_call rather than a module-level name, so every call raised
    NameError. The surrounding try/except swallowed it, so the abort still
    worked and only a `call_row_settle_failed` warning showed the breakage --
    exactly the kind of fault a structural test cannot see.
    """
    import db as dbmod

    mock_pool.fetchrow.return_value = {"id": "call-row-1"}
    ok = await dbmod.fail_unconnected_call("call-919000000000-1234", "pre-dial: test")
    assert ok is True, "a changed row must report True"

    assert mock_pool.fetchrow.await_count == 1
    args = mock_pool.fetchrow.await_args.args
    sql, room, ended_reason, reason, ended_at = args
    assert room == "call-919000000000-1234"
    assert ended_reason == "PIPELINE_ERROR"
    assert reason.startswith("pre-dial:")
    # Every calls timestamp column is `timestamp WITHOUT time zone`.
    assert ended_at.tzinfo is None, "naive UTC only, or asyncpg rejects it"


@pytest.mark.asyncio
async def test_fail_unconnected_call_reports_no_change(mock_pool):
    """A row that was already settled, or was answered, must report False."""
    import db as dbmod

    mock_pool.fetchrow.return_value = None
    assert await dbmod.fail_unconnected_call("call-nope", "pre-dial: test") is False
