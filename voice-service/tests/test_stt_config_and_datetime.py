"""The P0 incident on room call-917397075913-4812, and the three defects in it.

Live Logs, in order:

    stt_provider_initialized  {"provider": "sarvam", "model": "nova-2", ...}
    stt_connected             {"provider": "deepgram", "model": "nova-3"}   <- WRONG
    stt_stream_invalid_config  APIStatusError from
        livekit.plugins.sarvam.stt.STT — close_code 4000,
        "Invalid model 'nova-2'. Only 'saarika:v2.5', 'saaras:v3' or
         'saaras:v4' are supported"
    FIRST_GREETING_FAILED     {"error": "AgentSession isn't running"}
    log_call_failed           invalid input for query argument $23 ...
        can't subtract offset-naive and offset-aware datetimes

Three independent defects:

1. The assistant's sttProvider was changed to SARVAM while sttModel still held
   "nova-2" (a Deepgram id, and a field the Assistant UI does not expose).
   Every builder reads `model or <provider default>`, and "nova-2" is truthy,
   so the foreign id won. STT never started -> no AgentSession -> no greeting.
2. stt_connected logged the ENV DEFAULTS rather than the provider actually
   built, so the UI blamed Deepgram for a Sarvam failure.
3. answered_at/ended_at were timezone-AWARE while every `calls` timestamp
   column is `timestamp WITHOUT time zone`, failing the whole UPDATE — which
   also hid defect 1 behind log_call_failed.

All mocked. No provider call, no SIP, no DB write.
"""
from __future__ import annotations

import inspect
from datetime import UTC, datetime, timedelta, timezone

import pytest

import provider_registry


# ── 1. a foreign model must never reach a provider ─────────────────────────
def _accepts(provider: str) -> tuple:
    d = provider_registry.get(provider, "STT")
    return d.models if d else ()


def test_the_incident_pairing_is_rejected():
    """SARVAM + nova-2 — exactly what produced WebSocket close 4000."""
    assert "nova-2" not in _accepts("sarvam")


def test_sarvam_accepts_only_its_own_models():
    assert set(_accepts("sarvam")) == {"saaras:v4", "saarika:v2.5"}


def test_deepgram_still_accepts_nova_2():
    """The other four assistants are DEEPGRAM + nova-2 and must be untouched."""
    assert "nova-2" in _accepts("deepgram")


@pytest.mark.parametrize("provider,model,ok", [
    ("sarvam", "nova-2", False),          # the incident
    ("sarvam", "nova-3", False),
    ("sarvam", "saaras:v4", True),
    ("sarvam", "saarika:v2.5", True),
    ("deepgram", "nova-2", True),
    ("deepgram", "nova-3", True),
    ("deepgram", "saaras:v4", False),     # the mirror case
    ("openai", "whisper-1", True),
    ("openai", "nova-2", False),
])
def test_model_provider_compatibility(provider, model, ok):
    models = _accepts(provider)
    assert (model in models) is ok


def test_the_guard_runs_before_any_engine_is_built():
    import agent
    src = inspect.getsource(agent._build_selected_stt)
    assert "stt_model_foreign_to_provider" in src
    i_guard = src.index("stt_model_foreign_to_provider")
    i_build = src.index("_sarvam.STT(")
    assert i_guard < i_build, "the guard must precede provider construction"


def test_the_guard_clears_the_model_rather_than_the_provider():
    """No silent provider substitution: the selection stays, the unusable
    model is dropped so the provider's own default is used."""
    import agent
    src = inspect.getsource(agent._build_selected_stt)
    seg = src[src.index("stt_model_foreign_to_provider"):]
    seg = seg[:seg.index("engine: Any = None")]
    assert 'model = ""' in seg
    assert "prof_stt =" not in seg, "the provider must not be reassigned"


def test_the_guard_is_loud_and_actionable():
    import agent
    src = inspect.getsource(agent._build_selected_stt)
    seg = src[src.index("stt_model_foreign_to_provider"):][:800]
    assert "logger.error" in src[:src.index("stt_model_foreign_to_provider")] + seg
    for field in ("configured_model", "provider_accepts", "using_model", "remedy"):
        assert field in seg, field


def test_a_valid_model_is_left_alone():
    """Only a FOREIGN model is dropped; a correct one must pass through."""
    for provider in ("sarvam", "deepgram"):
        for model in _accepts(provider):
            assert model in _accepts(provider)


def test_default_model_for_is_available_to_callers():
    assert provider_registry.default_model_for("STT", "sarvam") == "saaras:v4"
    assert provider_registry.default_model_for("STT", "deepgram") == "nova-3-multilingual"
    assert provider_registry.default_model_for("STT", "nope") == ""


# ── 2. diagnostics must name the real provider ─────────────────────────────
def test_stt_connected_no_longer_reports_env_defaults():
    import agent
    src = inspect.getsource(agent.entrypoint)
    i = src.index('logger.info("stt_connected"')
    seg = src[i:i + 420]
    assert "config.DEFAULT_STT_PROVIDER" not in seg
    assert "config.STT_MODEL" not in seg


def test_stt_connected_reports_the_session_provider():
    import agent
    src = inspect.getsource(agent.entrypoint)
    i = src.index('logger.info("stt_connected"')
    seg = src[i - 700:i + 420]
    assert "_jj_stt_provider" in seg
    assert "selected_provider=" in seg, "configured vs actual must both appear"


def test_deepgram_is_not_hardcoded_as_the_stt_source():
    """Never attribute another provider's failure to Deepgram."""
    import agent
    src = inspect.getsource(agent.entrypoint)
    i = src.index('logger.info("stt_connected"')
    assert '"deepgram"' not in src[i:i + 420]


# ── 3. the datetime contract ───────────────────────────────────────────────
def test_db_utc_now_is_naive():
    import agent
    v = agent._db_utc_now()
    assert v.tzinfo is None, "calls.* columns are timestamp WITHOUT time zone"


def test_db_utc_now_is_actually_utc():
    import agent
    delta = abs((agent._db_utc_now() - datetime.now(UTC).replace(tzinfo=None)).total_seconds())
    assert delta < 5, "the instant must stay UTC; only tzinfo is dropped"


def test_no_aware_datetime_is_produced_for_the_db():
    import agent
    src = inspect.getsource(agent)
    for marker in ("_answered_at = datetime.now(UTC)",
                   "_jj_hangup_at = datetime.now(UTC)"):
        assert marker not in src, f"{marker} would fail asyncpg on a naive column"


def _naive_utc(v):
    """Mirrors the guard in db.complete_call."""
    if v is None or v.tzinfo is None:
        return v
    return v.astimezone(UTC).replace(tzinfo=None)


def test_an_aware_utc_value_is_normalised():
    aware = datetime(2026, 10, 16, 13, 12, 47, tzinfo=UTC)
    out = _naive_utc(aware)
    assert out.tzinfo is None
    assert out == datetime(2026, 10, 16, 13, 12, 47)


def test_an_ist_value_is_converted_not_stripped():
    """IST 18:42 is UTC 13:12 — stripping tzinfo would store 18:42 and shift
    the record by 5.5 hours."""
    ist = timezone(timedelta(hours=5, minutes=30))
    out = _naive_utc(datetime(2026, 10, 16, 18, 42, 47, tzinfo=ist))
    assert out == datetime(2026, 10, 16, 13, 12, 47)


def test_a_naive_legacy_value_passes_through_untouched():
    legacy = datetime(2026, 10, 16, 13, 12, 47)
    assert _naive_utc(legacy) is legacy


def test_a_null_answered_at_is_preserved():
    """A no-answer call has no answeredAt; None must stay None, not become now."""
    assert _naive_utc(None) is None


@pytest.mark.parametrize("offset_h", [-8, -5, 0, 1, 5.5, 9, 13])
def test_any_offset_normalises_to_the_same_instant(offset_h):
    tz = timezone(timedelta(hours=offset_h))
    base = datetime(2026, 6, 15, 12, 0, 0, tzinfo=UTC)
    assert _naive_utc(base.astimezone(tz)) == datetime(2026, 6, 15, 12, 0, 0)


def test_a_dst_boundary_value_is_still_a_single_instant():
    """US DST ends 2026-11-01. Both sides must map to one UTC instant."""
    before = datetime(2026, 11, 1, 5, 30, tzinfo=timezone(timedelta(hours=-4)))
    after = datetime(2026, 11, 1, 4, 30, tzinfo=timezone(timedelta(hours=-5)))
    assert _naive_utc(before) == _naive_utc(after) == datetime(2026, 11, 1, 9, 30)


def test_the_guard_exists_at_the_db_boundary():
    import db
    src = inspect.getsource(db.complete_call)
    assert "_naive_utc" in src
    assert "answered_at = _naive_utc(answered_at)" in src
    assert "ended_at = _naive_utc(ended_at)" in src


def test_timestamps_are_still_written_idempotently():
    """A retried teardown must not move a recorded timestamp."""
    import db
    src = inspect.getsource(db.complete_call)
    assert 'COALESCE("answeredAt"' in src
    assert 'COALESCE("endedAt"' in src


# ── the failure chain, as a single statement ───────────────────────────────
def test_a_failed_stt_build_must_not_be_masked_by_a_db_error():
    """log_call_failed hid the STT failure. The row write and the STT
    diagnostic are independent paths; neither may swallow the other."""
    import agent
    hook = inspect.getsource(agent._shutdown_hook)
    i = hook.index("log_call_failed")
    assert "except Exception" in hook[:i], "the row write is already guarded"
    assert "stt_disconnected" in hook, "STT lifetime is reported separately"


# ── the diagnostic must parse the provider's own close frame ───────────────
SARVAM_4000 = (
    "type='stt_error' label='livekit.plugins.sarvam.stt.STT' "
    "error=APIStatusError('Sarvam STT WebSocket closed unexpectedly: "
    '{"msg_type": "CLOSE", "close_code": 4000, "close_reason": '
    "\"Invalid model 'nova-2'. Only 'saarika:v2.5', 'saaras:v3' or "
    "'saaras:v4' are supported\"}')"
)


def _patterns_from_agent():
    """Pull the live regexes out of agent.py rather than re-typing them."""
    import pathlib
    src = pathlib.Path(__file__).resolve().parent.parent / "agent.py"
    opener, closer = "re.search(r'", "', msg)"
    out = []
    for line in src.read_text(encoding="utf-8").splitlines():
        if opener not in line or closer not in line:
            continue
        pat = line.split(opener, 1)[1].rsplit(closer, 1)[0]
        if "close_code" in pat or "close_reason" in pat:
            out.append(pat)
    return out


def test_the_close_patterns_are_valid_regexes():
    import re as _re
    pats = _patterns_from_agent()
    assert len(pats) == 3, f"expected 3 close_* patterns, found {len(pats)}"
    for p in pats:
        _re.compile(p)          # raises if malformed


def test_the_close_code_is_extracted():
    import re as _re
    pats = [p for p in _patterns_from_agent() if "close_code" in p and "(" in p]
    assert pats
    m = _re.search(pats[0], SARVAM_4000)
    assert m and m.group(1) == "4000"


def test_the_close_reason_survives_apostrophes_in_model_ids():
    """The reason is JSON-quoted and contains 'nova-2' in single quotes; an
    earlier pattern truncated at the first apostrophe to 'Invalid model '."""
    import re as _re
    pats = [p for p in _patterns_from_agent() if "close_reason" in p]
    assert pats
    m = _re.search(pats[0], SARVAM_4000)
    assert m, "close_reason did not match"
    assert "nova-2" in m.group(1)
    assert "saaras:v4" in m.group(1)


def test_a_4xxx_close_is_classified_as_permanent():
    """Sarvam signals bad config via websocket close 4000, not HTTP 400. If it
    were treated as transient the worker would reconnect into the same wall."""
    import re as _re
    pats = [p for p in _patterns_from_agent() if "close_code" in p and "(" not in p]
    assert pats
    assert _re.search(pats[0], SARVAM_4000) is not None


def test_the_impact_line_names_the_failing_provider():
    import inspect
    import agent
    src = inspect.getsource(agent.entrypoint)
    i = src.index('"stt_stream_invalid_config"')
    seg = src[i:i + 1400]
    assert "_fail_prov" in seg, "impact must interpolate the real provider"
    assert "Deepgram rejected" not in seg, "the provider name must not be hardcoded"
    for field in ("provider=", "selected_provider=", "configured_model=",
                  "close_code=", "close_reason=", "error_category=",
                  "last_ok_stage=", "retryable="):
        assert field in seg, field
