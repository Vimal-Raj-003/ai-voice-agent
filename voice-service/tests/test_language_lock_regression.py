"""A weak STT detection code must never flip an established language.

MEASURED on room call-917397075913-2902 (16 Oct, live call). The caller spoke
Tamil. Deepgram cannot transcribe Tamil — offline benchmarks show it returns
Devanagari or Cyrillic — so on this call it produced Devanagari gibberish and
reported detected='hi':

    11:59:56  "Hello?"                         detected=en   <- established en
    12:00:03  "Hello पूरी ले यार बेच रही हैं?"   detected=hi   <- FLIPPED to hi
    12:00:07  "Ok यार बेच रही हैं नहीं यार."     detected=hi

The agent then replied in Hindi for the rest of the call
("हाँ, मैं यहाँ हूँ. आपको किस बारे में जानकारी चाहिए?") to a caller who had not
spoken a word of Hindi. That is the "AI is not providing the correct response"
symptom: the model was faithfully answering gibberish, in the wrong language.

Rule 3 already protected a locked NON-English language from weak detections.
English was left open so it could be upgraded to Tamil — but that upgrade has
its own strong-evidence paths (native script, tanglish), so the opening bought
nothing.
"""
from __future__ import annotations

import pytest

import lang


def _established_english():
    st = lang.LanguageState()
    st.observe("en", "Hello? Can you hear me")
    assert (st.active, st.established) == ("en", True)
    return st


# ── the exact regression ───────────────────────────────────────────────────
def test_a_hindi_misdetection_cannot_flip_an_english_call():
    st = _established_english()
    changed = st.observe("hi", "Hello पूरी ले यार बेच रही हैं?")
    assert st.active == "en", "one Deepgram mis-transcription flipped the call"
    assert changed is False


def test_repeated_misdetections_still_cannot_flip_it():
    st = _established_english()
    for _ in range(5):
        st.observe("hi", "Ok यार बेच रही हैं नहीं यार.")
    assert st.active == "en"


@pytest.mark.parametrize("bogus", ["hi", "es", "te", "ml", "kn", "bn"])
def test_no_bare_detection_code_moves_an_established_language(bogus):
    """Deepgram has been observed reporting es for Tamil and hi for Tanglish."""
    st = _established_english()
    st.observe(bogus, "some words that are not in that language at all")
    assert st.active == "en"


# ── every INTENDED switch path still works ─────────────────────────────────
def test_an_explicit_request_still_switches():
    st = _established_english()
    assert st.observe("en", "please speak in Tamil", explicit="ta") is True
    assert st.active == "ta"


def test_native_tamil_script_still_switches_immediately():
    st = _established_english()
    assert st.observe("ta", "வணக்கம், நாளைக்கு appointment வேணும்") is True
    assert st.active == "ta"


def test_tanglish_still_upgrades_english_to_tamil():
    st = _established_english()
    st.observe("ta", "Naalaikku appointment venum bro, time sollunga")
    assert st.active == "ta"


def test_a_genuine_english_utterance_returns_from_tamil():
    st = lang.LanguageState()
    st.observe("ta", "வணக்கம், எனக்கு ஒரு appointment வேணும்")
    assert st.active == "ta"
    st.observe("en", "actually can you please speak in English now")
    assert st.active == "en"


def test_telugu_and_malayalam_script_still_switch():
    for script, code in [("నమస్కారం, నాకు అపాయింట్‌మెంట్ కావాలి", "te"),
                         ("നമസ്കാരം, എനിക്ക് ഒരു അപ്പോയിന്റ്മെന്റ് വേണം", "ml")]:
        st = _established_english()
        st.observe(code, script)
        assert st.active == code


# ── seeding is unaffected ──────────────────────────────────────────────────
def test_a_detection_still_seeds_when_nothing_is_established():
    st = lang.LanguageState()
    assert st.established is False
    st.observe("hi", "नमस्ते, मुझे एक अपॉइंटमेंट चाहिए")
    assert st.active == "hi" and st.established is True


def test_the_same_language_detection_is_a_no_op():
    st = _established_english()
    assert st.observe("en", "yes that works for me thanks") is False
    assert st.active == "en"


def test_short_acks_remain_inert():
    st = _established_english()
    for ack in ["ok", "yes", "hmm", "hello"]:
        st.observe("hi", ack)
    assert st.active == "en"


def test_a_locked_non_english_language_is_still_protected():
    """Rule 3's original guarantee must be unchanged."""
    st = lang.LanguageState()
    st.observe("ta", "வணக்கம், நாளைக்கு appointment வேணும்")
    st.observe("hi", "कुछ और शब्द")
    assert st.active == "ta"
