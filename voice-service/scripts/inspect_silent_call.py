"""Offline trace inspection; no provider calls, actions or credentials."""
from __future__ import annotations
import json
from pathlib import Path
import re
import sys
import asyncio
import time

ROOT = Path(__file__).resolve().parents[1]
DECODER = json.JSONDecoder(strict=False)


def objects(text):
    position = 0
    while True:
        start = text.find('{', position)
        if start < 0:
            return
        try:
            row, end = DECODER.raw_decode(text, start)
        except ValueError:
            position = start + 1
            continue
        position = end
        if isinstance(row, dict):
            yield row


def main():
    path = ROOT / 'output/verify/preparation-worker-start.log'
    data = path.read_bytes()
    encoding = 'utf-16' if data.startswith(b'\xff\xfe') else 'utf-8-sig'
    text = data.decode(encoding)
    rows = [r for r in objects(text) if '2026-11-03T09:32:' in str(r.get('timestamp', ''))]
    # IDs/phone numbers are intentionally omitted from printed summaries.
    fields = ('stage', 'turn_id', 'attempt_id', 'preview', 'text', 'transcript',
              'language', 'old', 'new', 'speech_id', 'source', 'interrupted',
              'playback_position', 'last_room_audio_wall', 'at_wall',
              'caller_end_wall', 'elapsed_ms', 'pipeline_stage', 'status',
              'ttft_ms', 'duration_ms', 'text_chars', 'tool_calls', 'outcome',
              'unanswered', 'error', 'error_type', 'reason', 'result', 'chars',
              'first_audio_ms', 'frames', 'speaker', 'model', 'cancelled')
    for row in rows:
        event = row.get('event') or row.get('message', '')
        if any(term in event.lower() for term in (
            'transcript', 'voice_stage', 'llm_', 'language', 'tts_', 'state_changed',
            'interrupt', 'prepar', 'playback', 'greeting', 'dead_air', 'silence',
            'turn_', 'function', 'tool_', 'error', 'reply_', 'shutdown', 'cancel',
        )):
            print(row['timestamp'], event, json.dumps({k: row[k] for k in fields if k in row}, ensure_ascii=False))
    destination = ROOT / 'output/verify/silent-call-worker-trace.json'
    destination.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    print('trace_events', len(rows))


async def probe():
    """Counterexamples to language neutrality and a bounded useful-text wait.

    Stream data is simulated solely to reproduce buffering, not to assert
    what the unlogged provider chunks in the real call contained.
    """
    sys.path.insert(0, str(ROOT))
    import agent
    import lang
    from livekit.agents import llm
    from livekit.agents.types import APIConnectOptions
    state = lang.LanguageState('en')
    switched = state.observe('hi-IN', 'हलो।')
    output = []
    class Stream:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def __aiter__(self):
            yield llm.ChatChunk(id='offline', delta=llm.ChoiceDelta(role='assistant', content='हाँ'))
            while True:
                await asyncio.sleep(.01)
                yield llm.ChatChunk(id='offline', delta=llm.ChoiceDelta(role='assistant', content=' '))
    class Model:
        def chat(self, **kwargs):
            return Stream()
    result = {}
    async def collect():
        async for chunk in agent._stream_gated(Model(), llm.ChatContext(), [], 'none',
                APIConnectOptions(timeout=.05, max_retry=0), result):
            output.append(chunk)
    started = time.monotonic()
    task = asyncio.create_task(collect())
    await asyncio.sleep(.2)
    pending = not task.done()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    report = dict(offline_only=True, provider_requests=0,
        language=dict(transcript='हलो।', treated_as_short_ack=lang.is_short_ack('हलो।'),
                      switched=switched, resulting_language=state.active),
        buffering=dict(simulated_stream=True, expected_useful_output_deadline_ms=50,
                       elapsed_ms=round((time.monotonic()-started)*1000, 1),
                       yielded_chunks=len(output), still_waiting=pending),
        verdict='FAIL: reproduced weak greeting language lock and unbounded useful-output wait')
    (ROOT/'output/verify/silent-call-offline-probe.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if switched or (pending and not output) else 0


def audio_audit():
    """Decode locally and compare waveforms; no speech recognizer/upload."""
    import av
    import numpy as np
    import wave
    from dotenv import load_dotenv
    sys.path.insert(0, str(ROOT))
    load_dotenv(ROOT/'.env')
    import config
    audio_path = Path('/mnt/c/Users/CT/Downloads/WhatsApp Audio 2026-11-03 at 3.03.09 PM.aac')
    with av.open(str(audio_path)) as container:
        stream = container.streams.audio[0]
        original_rate = stream.codec_context.sample_rate
        original_channels = stream.codec_context.channels
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=8000)
        frames = [out.to_ndarray().flatten() for frame in container.decode(audio=0)
                  for out in resampler.resample(frame)]
        frames.extend(out.to_ndarray().flatten() for out in resampler.resample(None))
    phone = np.concatenate(frames).astype(np.float64)
    local = Path(config.RECORDINGS_DIR)/'2026/11/03/inbound-_917397075913_6vxB6MF2fPAq.wav'
    with wave.open(str(local)) as recorded:
        assert recorded.getframerate() == 16000 and recorded.getnchannels() == 2
        pcm = np.frombuffer(recorded.readframes(recorded.getnframes()), dtype='<i2').reshape(-1, 2)
    comparison = {}
    for channel, name in enumerate(('caller_received_track', 'agent_generated_track')):
        track = pcm[::2, channel].astype(np.float64) / 32768.
        nfft = 1 << (len(phone)+len(track)-2).bit_length()
        corr = np.fft.irfft(np.fft.rfft(phone, nfft) * np.conj(np.fft.rfft(track, nfft)), nfft)
        correlation = np.concatenate((corr[-len(track)+1:], corr[:len(phone)]))
        index = int(np.argmax(np.abs(correlation)))
        lag = index - (len(track)-1)
        score = float(abs(correlation[index]) / max(1e-12, np.linalg.norm(phone)*np.linalg.norm(track)))
        comparison[name] = dict(global_waveform_similarity=round(score, 4),
                                phone_minus_server_offset_seconds=round(lag/8000, 4))
    report = dict(local_only=True, customer_audio_uploaded=False, transcribed=False,
        attached_file=audio_path.name, seconds=round(len(phone)/8000, 3),
        sample_rate=original_rate, channels=original_channels,
        local_recording_seconds=round(len(pcm)/16000, 3), waveform_comparison=comparison,
        note='Waveform matching does not align words or establish handset agent-answer/barge-in timing. '
             'Local agent recording contains generated frames, including cancelled/unplayed audio.')
    (ROOT/'output/verify/silent-call-audio-audit.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    if '--probe' in sys.argv:
        sys.exit(asyncio.run(probe()))
    if '--audio' in sys.argv:
        audio_audit()
        sys.exit(0)
    main()
