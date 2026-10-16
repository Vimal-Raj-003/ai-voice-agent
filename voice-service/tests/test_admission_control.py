"""Quota-aware admission: spend the budget that EXISTS, before paying a 429.

Measured context (this deployment, Groq Free Plan):
    provider-reported prompt_tokens   3,266
    TPM per model                     8,000   (gpt-oss-120b and gpt-oss-20b
                                               have SEPARATE buckets)
    sustainable on one model          8000/3266 = 2.45 requests/min
    sustainable across both          16000/3266 = 4.90 requests/min
    natural conversation rate         ~4-5 requests/min

The node always tried the primary first, so one bucket was drained while the
other sat idle: usable budget was 8K, not the 16K actually available. The
primary 429'd inside the first minute of every call, and the fallback only
engaged AFTER that failure had already cost the caller a turn. Logs across all
calls: 43 primary 429s, 26 fallback 429s, and 85 turns that ended with no
answer at all against 607 answered — 12.3% of turns lost.

Nothing here changes a provider, a credential or the operator's selected
model: both models are already in the resolved route.
"""
from __future__ import annotations

import inspect
import time

import pytest

import agent as ag

PRI = "groq/openai/gpt-oss-120b"
FB = "groq/openai/gpt-oss-20b"
CTX = 3266                      # provider-reported


class FakeAgent:
    def __init__(self):
        self._model_spend = {}
        self._last_ctx_tokens = CTX

    _record_spend = ag.BoundedAgent._record_spend
    _spend60 = ag.BoundedAgent._spend60
    _headroom = ag.BoundedAgent._headroom


# ── spend tracking ─────────────────────────────────────────────────────────
def test_spend_is_tracked_per_model_not_globally():
    """Groq meters per model; a shared counter would park a healthy model."""
    a = FakeAgent()
    a._record_spend(PRI, CTX)
    assert a._spend60(PRI) == CTX
    assert a._spend60(FB) == 0


def test_spend_ages_out_of_the_minute_window():
    a = FakeAgent()
    a._model_spend[PRI] = [(time.monotonic() - 61, CTX)]
    assert a._spend60(PRI) == 0


def test_spend_inside_the_window_still_counts():
    a = FakeAgent()
    a._model_spend[PRI] = [(time.monotonic() - 30, CTX)]
    assert a._spend60(PRI) == CTX


# ── headroom ───────────────────────────────────────────────────────────────
def test_a_fresh_model_can_afford_a_turn():
    assert FakeAgent()._headroom(PRI, CTX) > 0


def test_two_turns_fit_in_one_model_three_do_not():
    """8,000 less a 10% margin is 7,200; two turns is 6,532, three is 9,798."""
    a = FakeAgent()
    a._record_spend(PRI, CTX)
    assert a._headroom(PRI, CTX) > 0, "a second turn still fits"
    a._record_spend(PRI, CTX)
    assert a._headroom(PRI, CTX) < 0, "a third does not"


def test_a_safety_margin_is_kept():
    """The prediction is the PREVIOUS turn's context and history grows, so the
    budget must not be spent to the last token."""
    a = FakeAgent()
    assert a._headroom(PRI, 0) == pytest.approx(
        ag._LLM_ITPM_BUDGET - int(ag._LLM_ITPM_BUDGET * 0.10), abs=1)


def test_headroom_is_unbounded_when_no_budget_is_configured(monkeypatch):
    monkeypatch.setattr(ag, "_LLM_ITPM_BUDGET", 0)
    assert FakeAgent()._headroom(PRI, CTX) > 1_000_000


# ── the routing decision ───────────────────────────────────────────────────
def _decide(p_spend, f_spend, pred=CTX):
    """Mirrors the node's rule."""
    a = FakeAgent()
    if p_spend:
        a._model_spend[PRI] = [(time.monotonic(), p_spend)]
    if f_spend:
        a._model_spend[FB] = [(time.monotonic(), f_spend)]
    p, f = a._headroom(PRI, pred), a._headroom(FB, pred)
    return "fallback" if p < 0 <= f else "primary"


def test_the_primary_is_used_while_it_can_afford_the_turn():
    """The operator's selected model stays the default."""
    assert _decide(0, 0) == "primary"
    assert _decide(CTX, 0) == "primary"


def test_the_fallback_is_used_before_the_primary_429s():
    """The whole point: step aside BEFORE the failure, not after."""
    assert _decide(2 * CTX, 0) == "fallback"


def test_the_primary_is_kept_when_neither_has_room():
    """If stepping aside buys nothing, don't — the existing cooldown and
    recovery path handles it."""
    assert _decide(3 * CTX, 3 * CTX) == "primary"


def test_capacity_doubles_across_a_simulated_minute():
    """Five turns in a minute — a natural conversational rate — must all be
    admitted. On the old primary-only path the third would have 429'd."""
    a = FakeAgent()
    served = []
    for _ in range(5):
        p, f = a._headroom(PRI, CTX), a._headroom(FB, CTX)
        if p >= 0:
            a._record_spend(PRI, CTX); served.append(PRI)
        elif f >= 0:
            a._record_spend(FB, CTX); served.append(FB)
        else:
            served.append(None)
    assert served.count(None) == 1, f"expected 4 of 5 admitted, got {served}"
    assert served.count(PRI) == 2 and served.count(FB) == 2


def test_old_behaviour_would_have_lost_three_of_five():
    """Primary-only: 8,000 less margin / 3,266 = 2 turns per minute."""
    a = FakeAgent()
    admitted = 0
    for _ in range(5):
        if a._headroom(PRI, CTX) >= 0:
            a._record_spend(PRI, CTX); admitted += 1
    assert admitted == 2


# ── wiring ─────────────────────────────────────────────────────────────────
def test_the_decision_runs_before_any_provider_request():
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    assert "llm_admission_routed" in src
    assert src.index("_prefer_fallback") < src.index("primary_llm_started")


def test_it_never_overrides_a_cooldown():
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    i = src.index("_prefer_fallback = (")
    cond = src[i:i + 220]
    assert "not groq_cooling" in cond and "not fallback_cooling" in cond


def test_spend_is_recorded_for_whichever_model_serves():
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    assert src.count("_record_spend(") == 2


def test_no_new_provider_or_model_is_introduced():
    src = inspect.getsource(ag.BoundedAgent.llm_node)
    i = src.index("_prefer_fallback")
    seg = src[i - 1200:i + 1200]
    assert "self._fallback_label" in seg
    for foreign in ("anthropic", "openai.com", "gemini", "openrouter"):
        assert foreign not in seg.lower()
