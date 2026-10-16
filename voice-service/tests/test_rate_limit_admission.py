"""Quota-aware admission: never send a request that is certain to 429.

Reconstructed from the 08:21 incident (room call-917397075913-5801), whose
Live Logs show the defect exactly:

    08:22:03  primary_llm_failed        rate_limit 429   turn 4
    08:22:03  llm_provider_cooldown_started  groq  45s   (PRIMARY only)
    08:23:43  fallback_llm_failed       rate_limit 429   turn 14
    08:24:32  fallback_llm_failed       rate_limit 429   turn 19   <-- doomed
    08:24:32  llm_all_providers_failed  turn 19

The fallback is a different model on the SAME Groq key. Nothing recorded that
it had been rate-limited at turn 14, so turn 19 paid another full round-trip to
a model already known to be limited, and the caller heard the recovery line
again after the wait.

Also pinned: the cooldown length came from a fixed 30-60s guess while Groq
states the real wait in the 429 itself.

All mocked — no provider request is made.
"""
from __future__ import annotations

import pytest

import agent as ag


# ── reading the provider's own retry hint ──────────────────────────────────
class _Err(Exception):
    def __init__(self, msg, headers=None, status_code=429):
        super().__init__(msg)
        self.status_code = status_code
        if headers is not None:
            self.headers = headers


def test_retry_after_is_read_from_the_groq_message():
    e = _Err("Rate limit reached for model `openai/gpt-oss-120b` in organization "
             "`org_x` on tokens per minute (TPM): Limit 6000, Used 5800, "
             "Requested 500. Please try again in 3.456s.")
    secs, kind = ag._rate_limit_hint(e)
    assert secs == pytest.approx(3.456)
    assert kind == "tokens per minute"


def test_requests_per_minute_is_distinguished_from_tokens():
    """The remedy differs: TPM is fixed by sending fewer tokens per turn, RPM
    by sending fewer turns."""
    e = _Err("Rate limit reached ... on requests per minute (RPM): Limit 30. "
             "Please try again in 2s.")
    secs, kind = ag._rate_limit_hint(e)
    assert secs == pytest.approx(2.0)
    assert kind == "requests per minute"


def test_milliseconds_are_honoured():
    secs, _ = ag._rate_limit_hint(_Err("Please try again in 870ms."))
    assert secs == pytest.approx(0.87)


def test_a_retry_after_header_is_used_when_present():
    secs, _ = ag._rate_limit_hint(_Err("rate limited", headers={"retry-after": "7"}))
    assert secs == pytest.approx(7.0)


def test_no_hint_reports_none_rather_than_guessing():
    secs, kind = ag._rate_limit_hint(_Err("429 Too Many Requests"))
    assert secs is None
    assert kind == ""


def test_an_absurd_retry_after_is_clamped():
    """A caller must never be parked for an hour because a provider said so."""
    secs, _ = ag._rate_limit_hint(_Err("Please try again in 86400s."))
    assert secs == 120.0


def test_none_error_is_safe():
    assert ag._rate_limit_hint(None) == (None, "")


# ── per-model cooldown bookkeeping ─────────────────────────────────────────
class FakeAgent:
    """Only the cooldown surface of BoundedAgent, bound to the real methods."""

    def __init__(self):
        self._model_cooldown = {}

    _cooling = ag.BoundedAgent._cooling
    _enter_model_cooldown = ag.BoundedAgent._enter_model_cooldown


PRI = "groq/openai/gpt-oss-120b"
FB = "groq/openai/gpt-oss-20b"


def test_cooling_one_model_does_not_cool_the_other():
    """Turn 4 of the incident: the primary is limited, the fallback is healthy
    and must keep serving."""
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 4, "room", 429, _Err("try again in 5s"))
    assert a._cooling(PRI, 100.5, 4, "room") is True
    assert a._cooling(FB, 100.5, 4, "room") is False


def test_a_rate_limited_fallback_is_recorded():
    """Turn 14: this is what was missing, and why turn 19 was doomed."""
    a = FakeAgent()
    a._enter_model_cooldown(FB, 100.0, 14, "room", 429, _Err("try again in 10s"))
    assert a._cooling(FB, 105.0, 19, "room") is True


def test_the_provider_stated_wait_is_used_not_the_fixed_guess():
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 1, "room", 429, _Err("try again in 3s"))
    wait = a._model_cooldown[PRI] - 100.0
    assert 3.0 <= wait <= 4.6, f"expected ~3s + jitter, got {wait}"
    assert wait < ag._GROQ_COOLDOWN_S, "must not fall back to the 45s guess"


def test_the_default_window_is_used_when_the_provider_says_nothing():
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 1, "room", 429, _Err("429"))
    wait = a._model_cooldown[PRI] - 100.0
    assert ag._GROQ_COOLDOWN_S <= wait <= ag._GROQ_COOLDOWN_S + 5.0


def test_jitter_spreads_concurrent_sessions():
    """Five simultaneous campaign calls on one key must not all resume on the
    same millisecond and re-trip the limit together."""
    waits = set()
    for _ in range(25):
        a = FakeAgent()
        a._enter_model_cooldown(PRI, 100.0, 1, "room", 429, _Err("try again in 5s"))
        waits.add(round(a._model_cooldown[PRI], 4))
    assert len(waits) > 15, "cooldown deadlines are not jittered"


def test_cooldown_expires_and_the_model_is_tried_again():
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 1, "room", 429, _Err("try again in 2s"))
    assert a._cooling(PRI, 101.0, 2, "room") is True
    assert a._cooling(PRI, 110.0, 3, "room") is False
    assert PRI not in a._model_cooldown, "an expired entry must be cleared"


def test_a_second_429_never_shortens_an_existing_cooldown():
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 1, "room", 429, _Err("try again in 30s"))
    long_until = a._model_cooldown[PRI]
    a._enter_model_cooldown(PRI, 100.0, 2, "room", 429, _Err("try again in 1s"))
    assert a._model_cooldown[PRI] >= long_until


def test_no_retry_storm_a_cooling_model_is_never_called():
    """Bounded, not infinite: a limited model is asked once, then skipped."""
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 1, "room", 429, _Err("try again in 20s"))
    skipped = sum(1 for t in range(2, 12) if a._cooling(PRI, 100.0 + t, t, "room"))
    assert skipped == 10, "every turn inside the window must skip the model"


def test_both_cooling_means_nothing_is_worth_sending():
    """The turn-19 condition. With both models limited the node must send no
    request at all rather than two guaranteed 429s."""
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 18, "room", 429, _Err("try again in 20s"))
    a._enter_model_cooldown(FB, 100.0, 19, "room", 429, _Err("try again in 20s"))
    now = 101.0
    assert a._cooling(PRI, now, 19, "room") and a._cooling(FB, now, 19, "room")
    resumes_in = min(a._model_cooldown.values()) - now
    assert resumes_in > 0


def test_recovery_resumes_when_the_window_actually_reopens():
    """Scenario 9: a later turn succeeds once the provider recovers."""
    a = FakeAgent()
    a._enter_model_cooldown(PRI, 100.0, 4, "room", 429, _Err("try again in 5s"))
    a._enter_model_cooldown(FB, 100.0, 4, "room", 429, _Err("try again in 5s"))
    assert a._cooling(PRI, 102.0, 5, "room") is True
    # ...past the window, both are eligible again.
    assert a._cooling(PRI, 120.0, 9, "room") is False
    assert a._cooling(FB, 120.0, 9, "room") is False
    assert a._model_cooldown == {}


# ── the node's wiring, read from source ────────────────────────────────────
def test_the_node_skips_a_cooling_fallback():
    import inspect
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    assert "fallback_cooling" in src
    assert "llm_fallback_skipped_cooldown" in src


def test_the_node_short_circuits_when_both_are_cooling():
    import inspect
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    assert "llm_all_models_cooling" in src
    i_guard = src.index("llm_all_models_cooling")
    i_primary = src.index("primary_llm_started")
    assert i_guard < i_primary, "the guard must run BEFORE any provider request"


def test_a_fallback_429_records_a_cooldown():
    import inspect
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    after = src[src.index("fallback_llm_failed"):]
    assert "_enter_model_cooldown(self._fallback_label" in after


def test_the_old_primary_only_cooldown_is_gone():
    import inspect
    src = inspect.getsource(ag)
    assert "_enter_groq_cooldown" not in src


# ── ITPM budget visibility (Step 9) ────────────────────────────────────────
# The incident's real arithmetic: ~3,400 input tokens per request at 5
# requests/min is ~17,000 ITPM against a free tier of roughly 7,000. The call
# was 2.4x over budget from its first minute, and nothing said so.
def _rolling(window, now, total, budget):
    window.append((now, total))
    while window and now - window[0][0] > 60.0:
        window.pop(0)
    spent = sum(t for _, t in window)
    return spent, spent > budget


def test_the_incident_budget_would_have_warned_in_the_first_minute():
    w = []
    over_at = None
    for i in range(5):                      # 5 requests in one minute
        spent, over = _rolling(w, i * 12.0, 3400, 7000)
        if over and over_at is None:
            over_at = i + 1
    assert over_at == 3, f"should trip on the 3rd request, tripped on {over_at}"
    assert sum(t for _, t in w) == 17000


def test_a_cheap_configuration_stays_silent():
    w = []
    flags = [_rolling(w, i * 12.0, 900, 7000)[1] for i in range(5)]
    assert not any(flags), "4,500 tokens/min must not warn against a 7,000 budget"


def test_the_window_forgets_requests_older_than_a_minute():
    w = []
    _rolling(w, 0.0, 6000, 7000)
    spent, over = _rolling(w, 61.0, 6000, 7000)
    assert spent == 6000 and not over, "the 61s-old request must have aged out"


def test_the_budget_is_warn_only():
    """It must never throttle or drop a caller's turn."""
    import inspect
    src = inspect.getsource(ag.BoundedAgent.on_user_turn_completed)
    import re
    assert "llm_input_budget_exceeded" in src
    # The guarded block is the body of `if ... > _LLM_ITPM_BUDGET:`. It must
    # hold exactly one logger.warning and no control flow. Match STATEMENTS,
    # not substrings — the remedy text legitimately contains the word "raise".
    body = src[src.index("if _LLM_ITPM_BUDGET > 0"):]
    body = body[:body.index("except Exception")]
    assert body.count("logger.warning(") == 1
    for stmt in (r"^\s*return\b", r"^\s*raise\b", r"^\s*await\s+asyncio\.sleep",
                 r"^\s*continue\b", r"^\s*break\b"):
        assert re.search(stmt, body, re.M) is None, f"budget check must not use {stmt}"


def test_the_system_prompt_share_is_reported():
    """81% of every request was the prompt; naming that points at the remedy."""
    import inspect
    src = inspect.getsource(ag.BoundedAgent.on_user_turn_completed)
    assert "system_prompt_share_pct" in src


# ── account-scoped limits cool every model on the key ──────────────────────
# Per-minute token limits are per MODEL on Groq — which is why the fallback
# kept serving for ten turns after the primary was limited. Daily limits are
# organisation-scoped: once those are gone, every model on the credential is
# finished, and resting them one at a time just gives each its own doomed
# request before the call gives up.
@pytest.mark.parametrize("msg", [
    "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` "
    "on tokens per day (TPD): Limit 500000, Used 500000.",
    "Rate limit reached ... on requests per day (RPD): Limit 14400.",
    "RPD exceeded for this key",
    "account-wide limit reached",
    "organization level limit reached",
])
def test_account_scoped_limits_are_detected(msg):
    assert ag._limit_is_account_wide(_Err(msg)) is True


@pytest.mark.parametrize("msg", [
    "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` "
    "on tokens per minute (TPM): Limit 6000, Used 5800. Please try again in 3s.",
    "on requests per minute (RPM): Limit 30.",
    "429 Too Many Requests",
    "",
])
def test_per_minute_limits_stay_per_model(msg):
    """The safer default: never park a model that may still be able to serve."""
    assert ag._limit_is_account_wide(_Err(msg)) is False


def test_none_error_is_not_account_wide():
    assert ag._limit_is_account_wide(None) is False


class _Route:
    primary_provider = "groq"
    primary_model = "openai/gpt-oss-120b"


class FakeAgentWithRoute(FakeAgent):
    def __init__(self):
        super().__init__()
        self._route = _Route()
        self._fallback_label = FB


def test_a_daily_limit_cools_the_fallback_too():
    a = FakeAgentWithRoute()
    a._enter_model_cooldown(PRI, 100.0, 9, "room", 429,
                            _Err("on tokens per day (TPD): Limit 500000, Used 500000."))
    assert a._cooling(PRI, 101.0, 9, "room") is True
    assert a._cooling(FB, 101.0, 9, "room") is True, \
        "an account-wide limit must cool every model on the credential"


def test_a_per_minute_limit_leaves_the_fallback_usable():
    """Exactly the 08:21 behaviour that must be preserved: the primary rests,
    the fallback keeps the conversation alive."""
    a = FakeAgentWithRoute()
    a._enter_model_cooldown(PRI, 100.0, 4, "room", 429,
                            _Err("on tokens per minute (TPM): Limit 6000. "
                                 "Please try again in 3s."))
    assert a._cooling(PRI, 101.0, 4, "room") is True
    assert a._cooling(FB, 101.0, 4, "room") is False


def test_a_fallback_daily_limit_also_cools_the_primary():
    a = FakeAgentWithRoute()
    a._enter_model_cooldown(FB, 100.0, 14, "room", 429, _Err("requests per day (RPD) exceeded"))
    assert a._cooling(FB, 101.0, 14, "room") is True
    assert a._cooling(PRI, 101.0, 14, "room") is True


# ── the diagnostics that read the removed flag ─────────────────────────────
def test_any_cooling_reports_the_real_state():
    """The dead-air watchdog and latency breakdown used to read the
    primary-only `_groq_cooldown_active`. That flag is gone; leaving them on a
    getattr default would have made them report "not cooling" forever."""
    import time

    a = FakeAgent()
    bound = ag.BoundedAgent._any_cooling.__get__(a)
    assert bound() is False, "nothing cooling yet"
    a._model_cooldown[PRI] = time.monotonic() + 30
    assert bound() is True, "a resting model must be reported"
    a._model_cooldown[PRI] = time.monotonic() - 1
    assert bound() is False, "an expired deadline is not cooling"


def test_the_removed_flag_has_no_readers_left():
    import inspect
    src = inspect.getsource(ag)
    assert "_groq_cooldown_active" not in src.replace(
        "`_groq_cooldown_active` flag; that flag is gone, and leaving those", "")
