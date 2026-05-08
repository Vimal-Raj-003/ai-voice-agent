"""Voicemail / answering-machine detection.

LiveKit doesn't ship AMD. We use a two-pronged heuristic on the first user
transcript turn after the call is answered. Cheap, language-aware via
keyword sets, and produces almost no false positives in production
testing — humans don't say "please leave a message after the tone".
"""

from __future__ import annotations

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

# >8 words AND >40 chars in the first turn = almost certainly a recording.
LONG_TURN_WORD_THRESHOLD = 8
LONG_TURN_CHAR_THRESHOLD = 40


def looks_like_voicemail(transcript: str) -> bool:
    if not transcript:
        return False
    lower = transcript.lower()
    if any(p in lower for p in VOICEMAIL_PHRASES):
        return True
    word_count = len(lower.split())
    if word_count >= LONG_TURN_WORD_THRESHOLD and len(lower) >= LONG_TURN_CHAR_THRESHOLD:
        return True
    return False
