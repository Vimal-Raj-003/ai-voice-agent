"""Offline logical latency benchmark. Does not measure audible speech or make calls."""
from __future__ import annotations
import asyncio
import json
from pathlib import Path
import statistics
import sys
import time
import wave
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from callstate import CallState
from call_tasks import CallTasks


async def main():
    acknowledgement, durations, counts = [], [], []
    for _ in range(10):
        state = CallState(language='ta')
        work = CallTasks(state)
        state.work = work
        entered = asyncio.Event()
        count = 0
        async def lookup():
            nonlocal count
            count += 1
            entered.set()
            await asyncio.sleep(.12)
            return 'available'
        started = time.perf_counter()
        first = asyncio.create_task(work.run('availability', {'date': '2026-12-04'}, lookup))
        await entered.wait()
        first.cancel()
        await asyncio.gather(first, return_exceptions=True)
        state.observe_user('Hello?')
        requested = time.perf_counter()
        assert work.acknowledgement('Hello?', 'ta')
        acknowledgement.append((time.perf_counter()-requested)*1000)
        await work.run('availability', {'date': '2026-12-04'}, lookup)
        durations.append((time.perf_counter()-started)*1000)
        counts.append(count)
    fixtures = []
    for path in sorted((Path(__file__).resolve().parents[2] / 'output/audio-fixtures').glob('*.wav')):
        with wave.open(str(path), 'rb') as audio:
            fixtures.append({'file': path.name, 'seconds': round(audio.getnframes()/audio.getframerate(), 2),
                             'sample_rate': audio.getframerate(), 'channels': audio.getnchannels()})
    # Actual local VAD path, using existing clips; nothing is uploaded/transcribed.
    from agent import _shared_vad
    from livekit import rtc
    from livekit.agents import vad as vad_types
    detector = _shared_vad()
    vad_results = []
    for name in ('bargein.wav', 'ta_conversation.wav'):
        path = Path(__file__).resolve().parents[2] / 'output/audio-fixtures' / name
        if not detector or not path.exists():
            continue
        stream = detector.stream()
        counts_by_type = {'start': 0, 'end': 0}
        async def consume():
            async for event in stream:
                if event.type == vad_types.VADEventType.START_OF_SPEECH:
                    counts_by_type['start'] += 1
                elif event.type == vad_types.VADEventType.END_OF_SPEECH:
                    counts_by_type['end'] += 1
        consumer = asyncio.create_task(consume())
        with wave.open(str(path), 'rb') as audio:
            samples = audio.getframerate() // 50
            for _ in range(20 * 50):
                data = audio.readframes(samples)
                if not data:
                    break
                stream.push_frame(rtc.AudioFrame(data=data, sample_rate=audio.getframerate(),
                                                num_channels=audio.getnchannels(),
                                                samples_per_channel=len(data)//(2*audio.getnchannels())))
        stream.end_input()
        await asyncio.wait_for(consumer, timeout=20)
        await stream.aclose()
        vad_results.append({'file': name, 'tested_prefix_seconds': 20, 'events': counts_by_type})
    print(json.dumps({'synthetic_runs': 10, 'mock_lookup_delay_ms': 120,
                      'presence_text_ready_p50_ms': round(statistics.median(acknowledgement), 3),
                      'operation_p50_ms': round(statistics.median(durations), 2),
                      'lookup_invocations_per_run': sorted(set(counts)),
                      'audible_ack_latency': 'UNVERIFIED; no TTS/STT/provider or phone call used',
                      'existing_audio_fixtures': fixtures,
                      'local_vad_results': vad_results,
                      'audio_fixture_validation': 'Local runtime VAD smoke test only; STT/TTS and complete call behavior unverified'}, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
