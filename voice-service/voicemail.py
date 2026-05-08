"""Voicemail / answering-machine detection.

LiveKit doesn't ship AMD. We use a two-pronged heuristic on the first user
transcript turn after the call is answered:

1. Keyword phrase match (multi-language) — high precision.
2. Long-turn detection: many words, many chars, and the turn happens within
   the early call window. Real humans say "hello" or "yes who's this" first
   and pause; a recorded greeting launches into a paragraph immediately.

Both rules are tunable via environment so operators can tighten them in
production without redeploying.
"""

from __future__ import annotations

import os

VOICEMAIL_PHRASES: tuple[str, ...] = (
    # English
    "leave a message",
    "leave your message",
    "after the tone",
    "after the beep",
    "please record",
    "voicemail box",
    "voicemail",
    "is not available",
    "cannot take your call",
    "can't take your call",
    "currently unavailable",
    # Hindi/Hinglish — common voicemail prompts on Indian carriers
    "uplabdh nahi",
    "abhi uplabdh",
    "sandesh chhod",
    "the number you have dialed is not reachable",
)


def _int_env(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (TypeError, ValueError):
        return default


def _float_env(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except (TypeError, ValueError):
        return default


# Long-turn thresholds. Bumped from 8/40 → 14/80 after review feedback that
# the old levels would catch a real customer answering "Hi, this is Aakash,
# I'm at home, who's calling?" (10 words, 53 chars). 14 words is more
# forgiving without losing the recorded-greeting signal.
LONG_TURN_WORD_THRESHOLD = _int_env("VOICEMAIL_LONG_TURN_WORDS", 14)
LONG_TURN_CHAR_THRESHOLD = _int_env("VOICEMAIL_LONG_TURN_CHARS", 80)

# Long-turn detection only fires within this many seconds of call answer —
# real AMD systems gate on the same idea: humans take a beat before launching
# into a monologue, so a long uninterrupted opening turn is a strong signal.
LONG_TURN_ELAPSED_LIMIT_SEC = _float_env("VOICEMAIL_LONG_TURN_ELAPSED_SEC", 3.0)


def looks_like_voicemail(transcript: str, elapsed_seconds: float | None = None) -> bool:
    """Return True if the first transcript turn looks like a recorded greeting.

    `elapsed_seconds` is the seconds since the call was answered. When None
    or non-positive, the long-turn rule still applies — callers without
    timing context fall back to the simpler check. Phrase matching always
    runs because phrases are the high-precision signal.
    """
    if not transcript:
        return False
    lower = transcript.lower()
    if any(p in lower for p in VOICEMAIL_PHRASES):
        return True
    word_count = len(lower.split())
    if (
        word_count >= LONG_TURN_WORD_THRESHOLD
        and len(lower) >= LONG_TURN_CHAR_THRESHOLD
    ):
        # If we know how long the call has been live, only trust the long-turn
        # rule during the early window — after that, customers may legitimately
        # be giving long answers.
        if elapsed_seconds is None or elapsed_seconds <= LONG_TURN_ELAPSED_LIMIT_SEC:
            return True
    return False
