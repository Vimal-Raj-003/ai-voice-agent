"""Provider-health registry + fail-fast error classification (provider_health.py)."""

import time

import pytest

import provider_health as ph


class _HttpErr(Exception):
    def __init__(self, status, msg=""):
        super().__init__(msg or f"HTTP {status}")
        self.status_code = status


# ── classify_error: HTTP status → (state, retryable, cooldown) ────────────────
@pytest.mark.parametrize("status,expected_state,retryable", [
    (400, ph.INVALID_CONFIG, False),
    (402, ph.CREDITS_EXHAUSTED, False),
    (404, ph.INVALID_MODEL, False),
    (401, ph.AUTH_FAILED, False),
    (403, ph.AUTH_FAILED, False),
    (429, ph.COOLDOWN, True),
    (500, ph.UNAVAILABLE, True),
    (503, ph.UNAVAILABLE, True),
])
def test_classify_by_status(status, expected_state, retryable):
    state, r, cooldown = ph.classify_error(_HttpErr(status))
    assert state == expected_state
    assert r is retryable
    # Permanent states fail fast (no cooldown); timed states get a window.
    assert (cooldown == 0.0) == (not retryable)


def test_classify_credits_by_text_without_status():
    state, retryable, _ = ph.classify_error(Exception("Your credit balance is insufficient"))
    assert state == ph.CREDITS_EXHAUSTED and retryable is False


def test_classify_invalid_model_by_text():
    state, retryable, _ = ph.classify_error(Exception("model 'gemini-2.0-flash' does not exist"))
    assert state == ph.INVALID_MODEL and retryable is False


def test_classify_quota_vs_cooldown():
    quota, _, _ = ph.classify_error(_HttpErr(429, "Quota exceeded for requests per day"))
    assert quota == ph.QUOTA_EXHAUSTED
    burst, _, _ = ph.classify_error(_HttpErr(429, "rate limit reached"))
    assert burst == ph.COOLDOWN


def test_unknown_error_is_transient_but_retryable():
    state, retryable, cooldown = ph.classify_error(Exception("some weird glitch"))
    assert state == ph.UNAVAILABLE and retryable is True and cooldown > 0


# ── registry: permanent disable vs timed cooldown ─────────────────────────────
def test_permanent_failure_disables_provider():
    reg = ph.ProviderHealth()
    reg.record_error("gemini", "tts", _HttpErr(402))
    assert reg.usable("gemini", "tts") is False
    assert reg.state_of("gemini", "tts") == ph.CREDITS_EXHAUSTED
    # A later success does NOT clear a permanent state (needs real top-up/reset).
    reg.record_success("gemini", "tts")
    assert reg.usable("gemini", "tts") is False


def test_cooldown_auto_recovers(monkeypatch):
    reg = ph.ProviderHealth()
    reg.mark("groq", "llm", ph.COOLDOWN, cooldown_s=45)
    assert reg.usable("groq", "llm") is False
    # Jump past the cooldown window.
    base = time.monotonic()
    monkeypatch.setattr(ph.time, "monotonic", lambda: base + 46)
    assert reg.usable("groq", "llm") is True
    assert reg.state_of("groq", "llm") == ph.HEALTHY


def test_success_clears_timed_state():
    reg = ph.ProviderHealth()
    reg.record_error("deepgram", "stt", _HttpErr(503))
    assert reg.state_of("deepgram", "stt") == ph.UNAVAILABLE
    reg.record_success("deepgram", "stt")
    assert reg.usable("deepgram", "stt") is True
    assert reg.state_of("deepgram", "stt") == ph.HEALTHY


def test_healthy_by_default_and_reset():
    reg = ph.ProviderHealth()
    assert reg.usable("anything", "llm") is True
    reg.record_error("x", "llm", _HttpErr(400))
    assert reg.usable("x", "llm") is False
    reg.reset("x", "llm")
    assert reg.usable("x", "llm") is True


def test_log_callback_fires_on_change():
    seen = []
    reg = ph.ProviderHealth(log=lambda ev, **kw: seen.append((ev, kw)))
    reg.record_error("gemini", "tts", _HttpErr(402))
    assert any(ev == "provider_health_changed" and kw.get("state") == ph.CREDITS_EXHAUSTED for ev, kw in seen)


def test_snapshot_shape():
    reg = ph.ProviderHealth()
    reg.record_error("gemini", "tts", _HttpErr(402))
    reg.mark("groq", "llm", ph.COOLDOWN, cooldown_s=45)
    snap = reg.snapshot()
    assert snap["tts:gemini"]["permanent"] is True
    assert snap["llm:groq"]["permanent"] is False
    assert snap["llm:groq"]["cooldown_remaining_s"] > 0
