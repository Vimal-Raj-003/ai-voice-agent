"""Simulated multi-turn conversation continuity.

The existing suites test the individual rules (a locked language ignores a
mis-detection, a short ack stores no fact, state survives history truncation).
What they do not test is a SUSTAINED sequence: the rules holding together over
a long call, which is where drift actually shows up — a language flipping on
turn 14, or an entity quietly lost after a tool call.

These drive the real lang.LanguageState and callstate.CallState over 20 turns.
No audio, no network, no LiveKit: this covers the conversation-state layer
where our own defects live. Audio delivery, barge-in timing and TTS playback
cannot be proven here — they need a real call.
"""
from __future__ import annotations

import pytest

import lang
from callstate import CallState


# A realistic Tanglish booking call. Each turn is (deepgram_detected_lang, text).
# Deepgram deliberately mis-detects several Tamil/Tanglish turns as English —
# that is the real failure mode this must survive.
TAMIL_CALL = [
    ("en", "Hello?"),                                   # 1  greeting, nothing established
    ("ta", "Vanakkam, enakku oru appointment venum"),   # 2  establishes + locks Tamil
    ("en", "doctor appointment timing enna"),           # 3  loanwords -> mis-detected
    ("en", "yes okay"),                                 # 4  short ack
    ("ta", "naalaikku mudiyuma"),                       # 5
    ("en", "ok"),                                       # 6  short ack
    ("ta", "saturday morning nalla irukkum"),           # 7
    ("en", "hmm"),                                      # 8  short ack
    ("ta", "pathu mani sari"),                          # 9
    ("en", "yes"),                                      # 10 short ack
    ("ta", "en peru Ravi"),                             # 11
    ("en", "correct"),                                  # 12 short ack
    ("ta", "phone number anuppunga"),                   # 13
    ("en", "sari sari"),                                # 14
    ("ta", "confirm pannunga"),                         # 15
    ("en", "thank you"),                                # 16 short ack
    ("ta", "innum oru kelvi"),                          # 17
    ("en", "address enna"),                             # 18 loanword turn
    ("ta", "romba nandri"),                             # 19
    ("en", "bye"),                                      # 20 short ack
]


def test_twenty_turn_tamil_call_never_drifts_to_english():
    """Across 20 turns with 9 English mis-detections, the call stays Tamil."""
    st = lang.LanguageState()
    st.observe(*TAMIL_CALL[0])          # "Hello?" — nothing established yet
    assert st.active == "en", "an unestablished call defaults to English"

    st.observe(*TAMIL_CALL[1])          # Tamil established and locked
    assert st.active == "ta" and st.established is True

    flips = []
    for i, (detected, text) in enumerate(TAMIL_CALL[2:], start=3):
        st.observe(detected, text)
        if st.active != "ta":
            flips.append((i, detected, text, st.active))
    assert flips == [], f"language drifted on turns: {flips}"
    assert st.active == "ta"
    assert st.established is True


def test_twenty_turn_english_call_stays_english():
    """The mirror case: a genuine English call must not be dragged to Tamil by
    a single mis-detection."""
    st = lang.LanguageState()
    turns = [("en", "Hi, I'd like to book an appointment")] + \
            [("en", "yes"), ("en", "that works"), ("ta", "ok"),
             ("en", "Saturday is fine"), ("en", "ten in the morning"),
             ("en", "my name is Ravi"), ("en", "correct"), ("en", "thanks")] * 2
    for detected, text in turns[:20]:
        st.observe(detected, text)
    assert st.active == "en"


def test_short_acknowledgements_never_switch_language_at_any_turn():
    """A short English ack is the most common mis-detection; none of them may
    switch a locked Tamil call, at any point in the conversation."""
    st = lang.LanguageState()
    st.observe("ta", "Vanakkam, appointment venum")
    for ack in ["ok", "yes", "hmm", "sari", "thanks", "bye", "correct", "yeah"]:
        st.observe("en", ack)
        assert st.active == "ta", f"ack {ack!r} switched the language"


def test_entities_survive_a_full_booking_conversation():
    """Collected facts must still be present at the end of a long call,
    including across a tool result and an entity correction."""
    s = CallState(role="appointment")
    s.update_entity("name", "Ravi")
    s.update_entity("date", "Saturday")
    s.update_entity("time", "10:00")

    # Filler turns must not disturb what was collected.
    for ack in ["Hello?", "ok", "hmm", "yes", "thanks", "sari"]:
        s.add_fact(ack)
        s.update_entity("date", ack)

    ents = s.snapshot()["entities"]
    assert ents["name"] == "Ravi"
    assert ents["date"] == "Saturday"
    assert ents["time"] == "10:00"

    # A confirmed tool result locks the slot and keeps the entities.
    s.set_tool_fact("booking", state="confirmed:BK123",
                    entities={"date": "Saturday", "time": "10:00"})
    after = s.snapshot()["entities"]
    assert after["date"] == "Saturday"
    assert after["time"] == "10:00"
    assert after["name"] == "Ravi", "unrelated entity lost after a tool call"


def test_state_and_language_hold_together_over_a_long_call():
    """Both layers at once: 20 turns of Tanglish while entities accumulate."""
    st = lang.LanguageState()
    s = CallState(role="appointment")
    collected = {"name": "Ravi", "date": "Saturday", "time": "10:00"}

    for i, (detected, text) in enumerate(TAMIL_CALL, start=1):
        st.observe(detected, text)
        if i == 11:
            s.update_entity("name", collected["name"])
        if i == 7:
            s.update_entity("date", collected["date"])
        if i == 9:
            s.update_entity("time", collected["time"])

    assert st.active == "ta"
    ents = s.snapshot()["entities"]
    for k, v in collected.items():
        assert ents.get(k) == v, f"{k} lost over the call ({ents.get(k)!r})"


def test_explicit_request_switches_when_the_flag_is_supplied():
    """The unlock works — when a caller supplies `explicit`."""
    st = lang.LanguageState()
    st.observe("ta", "Vanakkam, appointment venum")
    assert st.active == "ta"
    assert st.observe("en", "can you speak in english", explicit="en") is True
    assert st.active == "en"


def test_genuine_english_request_returns_a_locked_tamil_call_to_english():
    """Rule 2c: a GENUINE English utterance of >= 3 words moves a locked Indic
    call back to English, so a caller is never trapped in the wrong language.

    This is the production path -- no `explicit` flag is needed or supplied
    anywhere in the codebase; the rule works off the transcript itself.
    """
    st = lang.LanguageState()
    st.observe("ta", "Vanakkam, appointment venum")
    assert st.active == "ta"
    assert st.observe("en", "can you speak in English please") is True
    assert st.active == "en"


@pytest.mark.parametrize("short_request", ["English please", "speak english"])
def test_two_word_english_requests_do_not_switch(short_request):
    """DOCUMENTED TRADE-OFF, not a defect.

    Rule 2c requires >= 3 words. That threshold is what stops short English
    acks ("ok", "yes okay") and loan-word turns from flipping a Tamil call --
    the exact failure this lock exists to prevent. The cost is that a clipped
    two-word request like "English please" does not switch on its own; the
    caller's next longer English sentence does.

    Pinned so the threshold cannot drift unnoticed in either direction.
    """
    st = lang.LanguageState()
    st.observe("ta", "Vanakkam, appointment venum")
    assert st.observe("en", short_request) is False
    assert st.active == "ta"


def test_native_script_switches_language_turn_by_turn():
    """Rule 2b: real Indic glyphs are unambiguous evidence and override the
    lock, so the agent follows a caller who changes language mid-call."""
    st = lang.LanguageState()
    st.observe("en", "Hi, I would like an appointment")
    assert st.active == "en"
    st.observe("en", "வணக்கம் எனக்கு அபாயண்ட்மெண்ட் வேணும்")
    assert st.active == "ta", "native Tamil script must switch the language"
