"""Private voice previews: saved samples or agent-only openings from local demos."""
from __future__ import annotations

import hashlib
import io
import json
import re
import wave
from pathlib import Path

import numpy as np


def sample_key(assistant_id: str, model: str, voice: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', assistant_id):
        raise ValueError('Invalid assistant ID')
    digest = hashlib.sha256(f'{model}|{voice}'.encode()).hexdigest()[:16]
    return f'assistant-previews/{assistant_id}-{digest}.wav'


def demo_recording(assistant_id: str, model: str, voice: str) -> str | None:
    from recorder import resolve_recording_path
    candidates = sorted(Path('output/verify/gpt-live').glob('demo-*.jsonl'),
                        key=lambda p: p.stat().st_mtime, reverse=True)[:200]
    for candidate in candidates:
        if candidate.stat().st_size > 2_000_000:
            continue
        try:
            events = [json.loads(line) for line in candidate.read_text(encoding='utf-8').splitlines()]
            start = next((e for e in events if e.get('event') == 'test_session_start'), {})
            if (start.get('assistant_id'), start.get('voice_model'), start.get('voice')) != (assistant_id, model, voice):
                continue
            key = next((e.get('path') for e in reversed(events) if e.get('event') == 'recording_finalized'), None)
            if key and resolve_recording_path(key):
                return key
        except (OSError, ValueError):
            continue
    return None


def preview_source(assistant_id: str, model: str, voice: str) -> tuple[str, str] | None:
    from recorder import resolve_recording_path
    key = sample_key(assistant_id, model, voice)
    if resolve_recording_path(key):
        return key, 'sample'
    key = demo_recording(assistant_id, model, voice)
    return (key, 'demo') if key else None


def preview_audio(assistant_id: str, model: str, voice: str) -> bytes | None:
    from recorder import resolve_recording_path
    source = preview_source(assistant_id, model, voice)
    if not source:
        return None
    path = resolve_recording_path(source[0])
    with wave.open(path, 'rb') as wav:
        rate, channels = wav.getframerate(), wav.getnchannels()
        if wav.getsampwidth() != 2 or channels not in (1, 2) or not 8000 <= rate <= 48000:
            return None
        if source[1] == 'demo' and channels != 2:
            return None  # A mixed recording cannot safely separate the caller.
        pcm = np.frombuffer(wav.readframes(min(wav.getnframes(), rate * 45)), dtype='<i2')
        pcm = pcm.reshape(-1, channels)[:, 1 if source[1] == 'demo' else 0].copy()
    if not pcm.size:
        return None
    step = rate // 50
    active = [np.max(np.abs(pcm[i:i+step].astype(np.int32))) > 240 for i in range(0, len(pcm), step)]
    first = next((i for i, voiced in enumerate(active) if voiced), None)
    if first is None:
        return None
    # Keep the opening utterance only, bounded to 15 seconds; caller samples
    # are never mixed in. Stop at a natural silence after speech has begun.
    last, quiet = min(len(pcm), first * step + 15 * rate), 0
    for i in range(first + 1, min(len(active), first + 750)):
        quiet = 0 if active[i] else quiet + 1
        if quiet >= 40 and i - first >= 40:
            last = (i - quiet + 10) * step
            break
    pcm = pcm[max(0, first * step - rate // 10):last]
    output = io.BytesIO()
    with wave.open(output, 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(rate)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()
