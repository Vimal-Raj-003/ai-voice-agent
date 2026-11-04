"""Offline inspection of the supplied 11:57 recording and matching worker trace."""
import json
from pathlib import Path
import re
import sys
import wave
from inspect_silent_call import objects

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
ROOM = 'inbound-_917397075913_r9A2EwaD76JE'
CALL = '3d828c3a-5ec1-40fd-a2a1-0a76e7669f72'
rows = [row for row in objects((ROOT/'output/verify/conversation-v11-worker.log').read_text(encoding='utf-8'))
        if row.get('room') == ROOM or row.get('call_id') in (ROOM, CALL)]
def redact(value):
    return re.sub(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[email]', value)
compact = []
for row in rows:
    event = row.get('event', row.get('message', ''))
    if event == 'turn_summary' or event in ('entity_updated', 'pending_question_changed',
            'understood_details_recorded', 'assistant_profile_loaded', 'call_test_mode'):
        compact.append({k: v for k, v in row.items() if k not in ('logger', 'source', 'room', 'call_id')})
audio = Path('/mnt/c/Users/CT/Downloads/917397075913_918065481576_2026-11-03-11-57-23.wav')
with wave.open(str(audio)) as stream:
    audio_info = dict(channels=stream.getnchannels(), sample_rate=stream.getframerate(),
                      duration_s=stream.getnframes()/stream.getframerate())
report = dict(call_id=CALL, room=ROOM, audio=audio_info, events=compact,
              fresh_audio_transcription=False, external_upload=False)
if '--align-audio' in sys.argv:
    from dotenv import load_dotenv
    load_dotenv(ROOT/'.env')
    from recorder import resolve_recording_path
    import numpy as np
    original = resolve_recording_path('2026/11/03/' + ROOM + '.wav')
    if original:
        def envelope(path):
            with wave.open(str(path)) as stream:
                frames = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2')
                frames = frames.reshape(-1, stream.getnchannels()).astype(np.float32)
                width = stream.getframerate() // 100
                frames = frames[:len(frames)//width*width]
                return np.sqrt(np.mean(frames.reshape(-1, width, frames.shape[1])**2, axis=1)).sum(axis=1)
        attached = envelope(audio)
        local = envelope(original)
        # Envelope matching verifies recording identity approximately. It does
        # not identify words, speakers or handset-audible boundaries.
        # NumPy FFT avoids installing a new audio/scientific dependency.
        left, right = attached-attached.mean(), local-local.mean()
        size = 1 << (len(left)+len(right)-1).bit_length()
        full = np.fft.irfft(np.fft.rfft(left, size)*np.fft.rfft(right[::-1], size), size)
        score = full[len(right)-1:len(left)]
        offset = int(score.argmax())
        paired = attached[offset:offset+len(local)]
        report['local_audio_alignment'] = dict(offset_s=offset/100,
            envelope_correlation=round(float(np.corrcoef(paired, local)[0, 1]), 4),
            scope='100 Hz summed-channel RMS envelope; no word/handset timing verification')
(ROOT/'output/verify/email-loop-call-analysis.json').write_text(
    json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
for row in compact:
    print(redact(json.dumps(row, ensure_ascii=False)))
print(json.dumps(audio_info))
