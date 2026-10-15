"""Multilingual routing helpers: normalize a detected language code, map it to
a provider-specific TTS language, and track the caller's active language across
a call. Pure functions + a small state object — no I/O, fully unit-testable.

Backend/structured values (dates, times, phone numbers, booking IDs) are NEVER
touched here; this module only decides what language the agent SPEAKS in.
"""

from __future__ import annotations

import re

# Sarvam TTS supported target_language_code values (verified against the
# installed livekit-plugins-sarvam 1.8.3 SarvamTTSLanguages literal).
SARVAM_TTS: dict[str, str] = {
    "bn": "bn-IN",
    "en": "en-IN",
    "gu": "gu-IN",
    "hi": "hi-IN",
    "kn": "kn-IN",
    "ml": "ml-IN",
    "mr": "mr-IN",
    "od": "od-IN",
    "or": "od-IN",   # ISO 639-1 for Odia is "or"; Sarvam uses "od-IN"
    "pa": "pa-IN",
    "ta": "ta-IN",
    "te": "te-IN",
}

# Codes that mean "no concrete language detected" — keep the current language.
_UNKNOWN = {"", "multi", "unknown", "und", "none", "zxx"}


def normalize_lang(code: str | None) -> str:
    """Reduce any STT/BCP-47 code to a base language key, e.g.
    'ta' / 'ta-IN' -> 'ta', 'en-US' -> 'en', 'hi-Latn' -> 'hi' (Hinglish script),
    'multi'/'unknown'/None -> '' (unknown). Returns a lowercase base code."""
    if not code:
        return ""
    c = str(code).strip().lower().replace("_", "-")
    if c in _UNKNOWN:
        return ""
    base = c.split("-", 1)[0]
    if base in _UNKNOWN:
        return ""
    return base


def sarvam_code(base: str) -> str | None:
    """Sarvam target_language_code for a base language, or None if Sarvam TTS
    does not support it."""
    return SARVAM_TTS.get(normalize_lang(base) or base)


def tts_route(base: str, provider: str) -> dict | None:
    """Decide how to set the TTS language for the active provider.

    Returns {"provider", "kwarg", "lang"} to pass to <tts>.update_options(**{kwarg: lang}),
    or None when the active provider cannot speak this language (caller should
    log UNSUPPORTED_TTS_LANGUAGE and keep the current language rather than fail).

    - sarvam: only its 11 supported Indic languages (kwarg target_language_code).
    - elevenlabs / cartesia: multilingual single-model TTS — pass the ISO base as
      `language`; their models cover a broad language set and ignore unsupported.
    """
    b = normalize_lang(base)
    if not b:
        return None
    provider = (provider or "").lower()
    if provider == "sarvam":
        code = SARVAM_TTS.get(b)
        return {"provider": "sarvam", "kwarg": "target_language_code", "lang": code} if code else None
    if provider in ("elevenlabs", "cartesia"):
        return {"provider": provider, "kwarg": "language", "lang": b}
    # Google / OpenAI TTS: no per-turn language switch wired — treat as unsupported.
    return None


# ── Persistent conversation-language policy ──────────────────────────────────
# The conversation keeps ONE language for the whole call. It is established from
# the first meaningful utterance(s), then locked — detection can never flip it;
# only an explicit caller request ("speak in English", "தமிழ்ல பேசுங்க") changes
# it. English loan-words inside Tamil speech and short acknowledgements never
# change it. This stops Deepgram "multi" per-turn mis-detections from making the
# agent ping-pong between languages.

# Languages this agent will actually converse in.
_ALLOWED = {"en", "ta", "hi", "te", "ml"}
_LANG_NAMES = {"en": "English", "ta": "Tamil", "hi": "Hindi", "te": "Telugu", "ml": "Malayalam"}

# Tamil Unicode block — any Tamil script in the transcript means Tamil.
_TAMIL_SCRIPT = re.compile(r"[஀-௿]")
_TELUGU_SCRIPT = re.compile(r"[ఀ-౿]")
_MALAYALAM_SCRIPT = re.compile(r"[ഀ-ൿ]")


def script_lang(text: str) -> str:
    """Base language implied by NATIVE SCRIPT in `text` ("" when none).

    Script is unambiguous evidence — unlike an STT language guess it cannot be a
    mis-detection, so it is what allows an immediate per-turn language switch.
    """
    t = text or ""
    if _TAMIL_SCRIPT.search(t):
        return "ta"
    if _TELUGU_SCRIPT.search(t):
        return "te"
    if _MALAYALAM_SCRIPT.search(t):
        return "ml"
    return ""

# Short acknowledgements / fillers that must NEVER establish or change the
# conversation language (rule 5). A whole utterance made only of these is inert.
_SHORT_ACKS = {
    "hello", "hi", "hey", "hii", "helo", "yes", "yeah", "yep", "yup", "ya",
    "no", "nope", "ok", "okay", "okey", "k", "kk", "hmm", "hmmm", "mm", "mmm",
    "mhm", "right", "wait", "sure", "fine", "good", "great", "thanks", "thank",
    "bye", "what", "huh", "oh", "ah", "hold", "one", "sec", "yup",
}

# English words commonly spoken INSIDE Tamil/Tanglish conversation. These must
# not be read as "the caller switched to English" (rule 4).
_LOAN_WORDS = {
    "appointment", "booking", "book", "service", "services", "doctor", "timing",
    "time", "available", "availability", "hospital", "meeting", "call", "confirm",
    "confirmed", "cancel", "reschedule", "slot", "slots", "morning", "evening",
    "afternoon", "night", "number", "address", "email", "online", "offline",
    "report", "test", "scan", "sir", "madam", "please", "ok", "okay", "yes",
    "no", "date", "today", "tomorrow", "week", "name",
}

# Latin-script Tamil/Tanglish function words — their presence marks the utterance
# as Tanglish even when Deepgram labels it English.
_TANGLISH_MARKERS = {
    "la", "enna", "epdi", "eppadi", "iruka", "irukku", "irukkudhu", "irukka",
    "pannunga", "pannu", "panna", "pannuveenga", "sollunga", "sollu", "venum",
    "vendum", "vendaam", "ponga", "vanga", "vaanga", "vanakkam", "illa", "illai",
    "aama", "aamaam", "seri", "sari", "romba", "konjam", "kekalam", "ungalukku",
    "ungaluku", "naan", "neenga", "unga", "enaku", "enakku", "kooda", "appo",
    "ippo", "appadi", "ipdi", "mudiyum", "mudiyuma", "theriyuma", "theriyum",
    "pesunga", "pesu", "solluvinga", "kudunga", "kodunga", "venum",
}

_WORD_RE = re.compile(r"[a-z஀-௿]+", re.I)


def _words(text: str) -> list[str]:
    return _WORD_RE.findall((text or "").lower())


def is_short_ack(text: str) -> bool:
    """True when the utterance is empty or made up only of short acks/fillers —
    so it must not establish or change the conversation language."""
    w = _words(text)
    if not w:
        return True
    if len(w) == 1 and w[0] in _SHORT_ACKS:
        return True
    return all(x in _SHORT_ACKS for x in w)


def has_tamil_script(text: str) -> bool:
    return bool(_TAMIL_SCRIPT.search(text or ""))


def looks_tanglish(text: str) -> bool:
    """Latin-script Tamil (Tanglish): contains Tamil function-word markers."""
    return any(w in _TANGLISH_MARKERS for w in _words(text))


def _mostly_loanwords(text: str) -> bool:
    """True when an English-detected utterance is almost entirely loan-words /
    acks / Tanglish markers (so it should NOT establish English)."""
    w = _words(text)
    if not w:
        return False  # no transcript → can't judge; don't block establishment
    real = [x for x in w if x not in _LOAN_WORDS and x not in _SHORT_ACKS and x not in _TANGLISH_MARKERS]
    return len(real) < 2


def language_name(code: str) -> str:
    return _LANG_NAMES.get(normalize_lang(code), "English")


def llm_language_directive(active: str) -> str | None:
    """A strong per-turn system directive telling the LLM which language to reply
    in, so the conversation language persists across every turn — including
    fallback LLM calls, retries, tool calls and booking steps. None for an
    unknown language (the base prompt rules then apply)."""
    base = normalize_lang(active)
    if base == "ta":
        return (
            "CONVERSATION LANGUAGE = Tamil. Reply ONLY in natural spoken Tamil "
            "written in TAMIL SCRIPT (not Latin transliteration). Common English "
            "terms the caller would normally say in English (appointment, "
            "booking, doctor, time, 4 PM) SHOULD stay in English inside the Tamil "
            "sentence — e.g. 'ஆம், tomorrow 4 PMக்கு appointment book பண்ணலாம்.' "
            "Keep replying in Tamil on EVERY turn, including short confirmations, tool "
            "results and appointment/booking steps. English words the caller uses "
            "(appointment, booking, doctor, timing, available, etc.) are normal "
            "inside Tamil — do NOT switch to English because of them. Switch to "
            "English only if the caller explicitly asks (e.g. 'speak in English')."
        )
    if base == "hi":
        return (
            "CONVERSATION LANGUAGE = Hindi. Reply in natural spoken Hindi every "
            "turn, written in DEVANAGARI script. Everyday English words the "
            "caller uses (appointment, booking, time) may stay in English."
        )
    if base == "te":
        return (
            "CONVERSATION LANGUAGE = Telugu. Reply in natural spoken Telugu every "
            "turn, written in TELUGU SCRIPT (not transliteration). Everyday "
            "English words the caller uses (appointment, booking, doctor, time) "
            "may stay in English inside the Telugu sentence — that is normal "
            "speech. Keep sentences short and conversational."
        )
    if base == "ml":
        return (
            "CONVERSATION LANGUAGE = Malayalam. Reply in natural spoken Malayalam "
            "every turn, written in MALAYALAM SCRIPT (not transliteration). "
            "Everyday English words the caller uses (appointment, booking, "
            "doctor, time) may stay in English inside the Malayalam sentence — "
            "that is normal speech. Keep sentences short and conversational."
        )
    if base == "en":
        return (
            "CONVERSATION LANGUAGE = English. Reply in English (natural Indian "
            "English, short conversational sentences) unless the caller clearly "
            "speaks another Indian language or explicitly asks to switch."
        )
    return None


class LanguageState:
    """Persistent per-call conversation language.

    Policy (see rules 1–10): the language is established from the first MEANINGFUL
    utterance, then LOCKED. Once a non-English language is set it is kept for the
    whole call — Deepgram per-turn mis-detections, English loan-words and short
    acknowledgements can never flip it. Only an explicit caller request changes a
    locked language. English is the default/seed and may still be UPGRADED to
    Tamil when the caller clearly speaks Tamil/Tanglish (rule 2).

    observe()/update() return True only when `active` actually changed, so the
    caller re-routes TTS and logs LANGUAGE_CHANGED exactly on real changes.
    `confirm` is accepted for backward-compatibility and ignored.
    """

    def __init__(self, initial: str = "en", confirm: int = 1) -> None:
        self.active: str = normalize_lang(initial) or "en"
        self.established: bool = False
        self._confirm = confirm  # retained for backward-compat; unused

    def observe(self, detected: str | None, text: str = "", explicit: str | None = None) -> bool:
        text = text or ""
        # 1. Explicit caller request always wins and (re)locks the language.
        if explicit in _ALLOWED and explicit:
            changed = explicit != self.active
            self.active = explicit
            self.established = True
            return changed
        # 2. Short acknowledgements never establish or change the language.
        #    (Only when a transcript is present — an empty text means "no
        #    transcript given", e.g. the detection-only update() shim.)
        if text.strip() and is_short_ack(text):
            return False
        base = normalize_lang(detected)
        tamilish = has_tamil_script(text) or looks_tanglish(text) or base == "ta"
        # 2b. NATIVE SCRIPT = unambiguous evidence the caller switched language.
        #     This overrides the lock so the agent follows the caller turn-by-turn
        #     (English → Tamil → Telugu → Malayalam → …). Mis-detections cannot
        #     reach here: only real Tamil/Telugu/Malayalam glyphs match, and the
        #     short-ack guard above already dropped "ok/சரி"-style utterances.
        scripted = script_lang(text)
        if scripted and scripted in _ALLOWED:
            changed = self.active != scripted
            self.active = scripted
            self.established = True
            return changed
        # 2c. A GENUINE English utterance returns the conversation to English even
        #     from a locked Indic language (req: English → Tamil → … → English).
        #     Heavily guarded so it can never fire on the things the lock exists
        #     to protect against: short acks, English loan-words inside Indic
        #     speech, romanised Tanglish, or any text containing Indic script.
        if (base == "en" and not scripted and not looks_tanglish(text)
                and not _mostly_loanwords(text) and len(_words(text)) >= 3):
            changed = self.active != "en"
            self.active = "en"
            self.established = True
            return changed
        # 3. A locked non-English language is never changed by a weak DETECTION —
        #    only an explicit request (above) or native script (2b) moves it.
        if self.established and self.active != "en":
            return False
        # 4. Tamil / Tanglish → Tamil, locked for the rest of the call.
        if tamilish:
            changed = self.active != "ta"
            self.active = "ta"
            self.established = True
            return changed
        # 5. English / other allowed language establishes from a GENUINE
        #    utterance — not one that is only English loan-words inside Tamil.
        if base in _ALLOWED:
            if base == "en" and _mostly_loanwords(text):
                return False
            changed = self.active != base
            self.active = base
            self.established = True
            return changed
        # 6. Unknown / unsupported detection → keep the current language.
        return False

    def update(self, detected: str | None) -> bool:
        """Backward-compatible detection-only entry point (no transcript text)."""
        return self.observe(detected, "")
