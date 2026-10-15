"""Local pre-generated acknowledgement clips for the never-silent path (req 12/15).

When cloud TTS cannot speak (credits/quota exhausted, or a non-English deployment
with no same-language cloud fallback), the caller must still hear SOMETHING in
THEIR language rather than dead air. These are short, pre-recorded WAVs played
directly through the audio track (TTS bypassed), interruptible, and never added
to the LLM chat history.

LANGUAGE SAFETY (req 12): a clip is only ever returned for the caller's OWN
language. If the matching-language file is absent, this returns None and the
caller plays nothing — we never substitute a wrong-language clip (an English clip
on a Tamil call is exactly the gibberish req 12 forbids).

FILE CONVENTION — drop files into voice-service/clips/ named `<lang>_<kind>.wav`:
    ta_presence.wav     en_presence.wav      ("Yes, I'm here." / "ஆமா, கேக்குது.")
    ta_filler.wav       en_filler.wav        ("One moment…"    / "ஒரு நிமிஷம்…")
    ta_unavailable.wav  en_unavailable.wav   ("One sec, having a small issue…")
Format: PCM16 WAV, mono preferred (stereo also accepted); any sample rate — the
player reads the header. Missing files simply disable that clip (no crash).
"""

from __future__ import annotations

import os

CLIPS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "clips")

# Kinds of clip, by use:
#   presence    → caller said "hello?/can you hear me?" mid-call (quick reassure)
#   filler      → processing/dead-air micro-filler ("one moment")
#   unavailable → TTS could not synthesize this turn (never-silent fallback)
KINDS = ("presence", "filler", "unavailable")


def _base_lang(lang: str | None) -> str:
    """Normalize a language code/name to a 2-letter base (ta-IN→ta, tamil→ta)."""
    if not lang:
        return ""
    s = str(lang).strip().lower()
    if s in ("tamil", "ta", "ta-in"):
        return "ta"
    if s in ("english", "en", "en-us", "en-in", "en-gb"):
        return "en"
    if s in ("auto", "multi", "unknown", "und", ""):
        return ""
    return s.split("-")[0][:2]


def clip_path(lang: str | None, kind: str, clips_dir: str | None = None) -> str | None:
    """Return the WAV path for (caller-language, kind) if the file exists, else
    None. Same-language only — never falls back to another language."""
    base = _base_lang(lang)
    if not base or kind not in KINDS:
        return None
    d = clips_dir or CLIPS_DIR
    p = os.path.join(d, f"{base}_{kind}.wav")
    return p if os.path.isfile(p) else None


def available(clips_dir: str | None = None) -> dict[str, list[str]]:
    """Map base-language → kinds that currently have a file (for startup logging)."""
    d = clips_dir or CLIPS_DIR
    out: dict[str, list[str]] = {}
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        if not name.endswith(".wav") or "_" not in name:
            continue
        base, kind = name[:-4].split("_", 1)
        if kind in KINDS:
            out.setdefault(base, []).append(kind)
    for k in out:
        out[k].sort()
    return out
