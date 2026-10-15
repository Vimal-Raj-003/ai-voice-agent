"""Multilingual routing logic (lang.py): normalization, Sarvam routing,
provider fallback, and per-call language switching."""

import pytest

import lang


# ── normalization: STT/BCP-47 codes → base language ─────────────────────────
@pytest.mark.parametrize("code,expected", [
    ("en", "en"), ("en-US", "en"), ("en-IN", "en"),
    ("ta", "ta"), ("ta-IN", "ta"),
    ("hi", "hi"), ("hi-Latn", "hi"),      # Hinglish script tag → hi
    ("te", "te"), ("te-IN", "te"),
    ("kn", "kn"), ("ml", "ml"), ("bn", "bn"),
    ("multi", ""), ("unknown", ""), ("und", ""), ("", ""), (None, ""),
])
def test_normalize_lang(code, expected):
    assert lang.normalize_lang(code) == expected


# ── Sarvam language routing (exact supported codes) ─────────────────────────
@pytest.mark.parametrize("base,expected", [
    ("ta", "ta-IN"), ("en", "en-IN"), ("hi", "hi-IN"), ("te", "te-IN"),
    ("kn", "kn-IN"), ("ml", "ml-IN"), ("bn", "bn-IN"), ("gu", "gu-IN"),
    ("mr", "mr-IN"), ("pa", "pa-IN"), ("or", "od-IN"), ("od", "od-IN"),
])
def test_sarvam_supported(base, expected):
    assert lang.sarvam_code(base) == expected


@pytest.mark.parametrize("base", ["fr", "de", "ja", "ar", "zh"])
def test_sarvam_unsupported(base):
    assert lang.sarvam_code(base) is None


# ── TTS routing per provider ────────────────────────────────────────────────
def test_tts_route_sarvam_supported():
    r = lang.tts_route("ta", "sarvam")
    assert r == {"provider": "sarvam", "kwarg": "target_language_code", "lang": "ta-IN"}


def test_tts_route_sarvam_unsupported_returns_none():
    # Unsupported-by-Sarvam language → None so the caller logs UNSUPPORTED and
    # keeps the current language instead of failing the call.
    assert lang.tts_route("fr", "sarvam") is None


def test_tts_route_elevenlabs_any_language():
    r = lang.tts_route("ta", "elevenlabs")
    assert r == {"provider": "elevenlabs", "kwarg": "language", "lang": "ta"}


def test_tts_route_cartesia_any_language():
    r = lang.tts_route("hi", "cartesia")
    assert r == {"provider": "cartesia", "kwarg": "language", "lang": "hi"}


def test_tts_route_google_openai_unsupported():
    assert lang.tts_route("ta", "google") is None
    assert lang.tts_route("ta", "openai") is None


def test_tts_route_unknown_language_none():
    assert lang.tts_route("", "sarvam") is None
    assert lang.tts_route("multi", "sarvam") is None


# ── LanguageState: PERSISTENT conversation language ─────────────────────────
def test_language_defaults_to_english_until_established():
    st = lang.LanguageState()
    assert st.active == "en"
    assert st.established is False


def test_english_default_upgrades_to_tamil_and_locks():
    st = lang.LanguageState()
    # A clear Tamil utterance establishes + locks Tamil (rule 2).
    assert st.observe("ta", "Vanakkam, booking venum") is True
    assert st.active == "ta"
    assert st.established is True
    # Deepgram now mis-detects a Tamil loan-word turn as English → MUST stay ta.
    assert st.observe("en", "doctor appointment timing enna") is False
    assert st.active == "ta"
    # A bare English detection also cannot flip a locked Tamil call (rule 3/6).
    assert st.observe("en", "yes okay") is False
    assert st.active == "ta"


def test_only_explicit_request_switches_a_locked_language():
    st = lang.LanguageState()
    st.observe("ta", "enakku appointment venum")
    assert st.active == "ta"
    # Explicit English request switches (rule 6).
    assert st.observe("en", "can you speak in english", explicit="en") is True
    assert st.active == "en"


def test_short_acks_never_change_language():
    st = lang.LanguageState()
    st.observe("ta", "Vanakkam enna help venum")       # lock Tamil
    for ack in ["Hello", "Yes", "Okay", "Hmm", "Right", "Wait"]:
        assert st.observe("en", ack) is False
        assert st.active == "ta"


def test_loanwords_inside_tamil_do_not_switch_to_english():
    st = lang.LanguageState()
    st.observe("ta", "ungalukku appointment book panna mudiyuma")
    assert st.active == "ta"
    assert st.observe("en", "appointment booking service doctor timing") is False
    assert st.active == "ta"


def test_tamil_script_forces_tamil():
    st = lang.LanguageState()
    assert st.observe("en", "தமிழ்ல பேசுங்க") is True
    assert st.active == "ta"


def test_tanglish_establishes_tamil_not_english():
    st = lang.LanguageState()
    # Tanglish often labelled "en" by Deepgram — markers must force Tamil (rule 9).
    assert st.observe("en", "enna timing iruku doctor ku") is True
    assert st.active == "ta"


def test_genuine_english_stays_english():
    st = lang.LanguageState()
    assert st.observe("en", "Hi, I would like to book an appointment for next week") is False  # en == default, no change
    assert st.active == "en"
    assert st.established is True


def test_update_shim_detection_only():
    st = lang.LanguageState()
    assert st.update("ta") is True      # first Tamil detection locks ta
    assert st.active == "ta"
    assert st.update("en") is False     # locked → detection cannot flip
    assert st.active == "ta"


def test_language_state_initial():
    st = lang.LanguageState("hi-IN")
    assert st.active == "hi"
    assert st.update("hi") is False


# ── Persistence helper predicates ───────────────────────────────────────────
@pytest.mark.parametrize("text", ["Hello", "yes", "okay", "Hmm", "right", "wait", "", "ok ok"])
def test_is_short_ack_true(text):
    assert lang.is_short_ack(text) is True


@pytest.mark.parametrize("text", ["enakku appointment venum", "I need to book a slot now"])
def test_is_short_ack_false(text):
    assert lang.is_short_ack(text) is False


def test_llm_language_directive_tamil_mentions_loanwords():
    d = lang.llm_language_directive("ta")
    assert d and "Tamil" in d and "English only if" in d


def test_llm_language_directive_unknown_none():
    assert lang.llm_language_directive("fr") is None


# ── End-to-end support classification used in the report ────────────────────
def test_end_to_end_vs_tts_only_classification():
    # Languages Sarvam TTS can speak (end-to-end when STT also detects them):
    for b in ["en", "hi", "ta", "te", "kn", "ml", "bn", "gu", "mr", "pa", "or"]:
        assert lang.sarvam_code(b) is not None
    # A language Sarvam cannot speak must not crash routing:
    assert lang.tts_route("fr", "sarvam") is None
