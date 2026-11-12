import io
import json
import wave
from pathlib import Path

import numpy as np
import pytest

from voice_previews import preview_audio, preview_source, sample_key


def test_agent_preview_never_contains_caller_channel_and_matches_saved_voice(tmp_path, monkeypatch):
    import config
    monkeypatch.setattr(config, 'RECORDINGS_DIR', str(tmp_path / 'recordings'))
    monkeypatch.chdir(tmp_path)
    journal = Path('output/verify/gpt-live'); journal.mkdir(parents=True)
    key = '2026/11/11/demo-test.wav'
    path = Path(config.RECORDINGS_DIR) / key; path.parent.mkdir(parents=True)
    rate = 16000
    pcm = np.zeros((rate * 4, 2), dtype='<i2')
    pcm[:, 0] = 9000  # Caller throughout; must never leak to output.
    pcm[rate:2 * rate, 1] = 1000
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(rate); wav.writeframes(pcm.tobytes())
    events = [{'event':'test_session_start','assistant_id':'clinic','voice_model':'saved','voice':'Zephyr'},
              {'event':'recording_finalized','path':key}]
    (journal / 'demo-test.jsonl').write_text('\n'.join(json.dumps(e) for e in events))
    assert preview_source('clinic', 'saved', 'Zephyr') == (key, 'demo')
    assert preview_source('other', 'saved', 'Zephyr') is None
    assert preview_source('clinic', 'saved', 'Despina') is None
    audio = preview_audio('clinic', 'saved', 'Zephyr')
    with wave.open(io.BytesIO(audio), 'rb') as wav:
        assert wav.getnchannels() == 1
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2')
        assert samples.max() == 1000 and wav.getnframes() < rate * 2


def test_sample_names_reject_path_traversal():
    with pytest.raises(ValueError):
        sample_key('../private', 'model', 'voice')
    assert sample_key('clinic', 'one', 'Zephyr') != sample_key('clinic', 'two', 'Zephyr')


def test_mixed_mono_demo_cannot_be_used_as_private_agent_preview(tmp_path, monkeypatch):
    import voice_previews
    import recorder
    path = tmp_path / 'mixed.wav'
    with wave.open(str(path), 'wb') as wav:
        wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(8000)
        wav.writeframes(np.full(8000, 1000, dtype='<i2').tobytes())
    monkeypatch.setattr(voice_previews, 'preview_source', lambda *args: ('mixed.wav', 'demo'))
    monkeypatch.setattr(recorder, 'resolve_recording_path', lambda key: str(path))
    assert preview_audio('clinic', 'model', 'voice') is None
