# Local acknowledgement clips (never-silent path)

Short pre-recorded WAVs played directly to the caller (TTS bypassed) when cloud
TTS cannot speak — so a Tamil caller hears a Tamil reply instead of silence.
See `local_clips.py` for the loader.

## Required files

Name each file `<lang>_<kind>.wav`:

| File | Language | Spoken content (suggested) |
|------|----------|----------------------------|
| `ta_presence.wav`    | Tamil   | "ஆமா, கேக்குது." (Yes, I'm here.) |
| `ta_filler.wav`      | Tamil   | "ஒரு நிமிஷம்…" (One moment…) |
| `ta_unavailable.wav` | Tamil   | "ஒரு sec, ஒரு சின்ன problem…" (One sec, small issue…) |
| `en_presence.wav`    | English | "Yes, I'm here." |
| `en_filler.wav`      | English | "One moment…" |
| `en_unavailable.wav` | English | "One sec, I'm having a small issue…" |

## Format

- PCM16 WAV, **mono** preferred (stereo also works)
- Any sample rate (the player reads the header)
- Keep them short (≈1–2s) — they are interruptible fillers, not messages

## Behavior

- A clip is only ever played for the caller's **own** language — if `ta_*.wav`
  is missing on a Tamil call, nothing is played (never a wrong-language clip).
- Missing files are fine — they simply disable that clip, no crash.
- Clips are interruptible and are **not** added to the LLM chat history.

Tamil files are expected to be supplied by the operator (no Tamil cloud TTS is
available under current billing to auto-generate them).
