"""Synthetic WAV through real STT/VAD/LLM/TTS; local PCM, no room or SIP call."""
from __future__ import annotations
import asyncio
import json
import time
import wave
import aiohttp
from livekit import rtc
from livekit.plugins import sarvam
from livekit.agents.voice import io
from replay_understanding import ROOT, CASES, profile, run_case
from replay_synthetic_speech import Capture, save
import agent
import config


async def main():
    dest = ROOT / 'output' / 'verify'
    prof = await profile()
    case = dict(next(c for c in CASES if c['id'] == 'presence_with_question'))
    path = dest / 'synthetic-tamil-caller.wav'
    with wave.open(str(path), 'rb') as wav:
        rate, channels = wav.getframerate(), wav.getnchannels()
        assert channels == 1 and wav.getsampwidth() == 2
        pcm = wav.readframes(wav.getnframes())
    anchor = time.monotonic()
    sink = Capture(anchor)
    async def audio():
        width = rate // 50 * 2
        # Pace recorded speech as real microphone frames. Silence keeps the
        # streaming provider open through endpoint detection and the reply.
        for data in (pcm, bytes(rate * 2 * 15)):
            for offset in range(0, len(data), width):
                frame = data[offset:offset+width]
                if len(frame) != width:
                    frame += bytes(width-len(frame))
                yield rtc.AudioFrame(frame, sample_rate=rate, num_channels=1, samples_per_channel=len(frame)//2)
                await asyncio.sleep(.02)
    class RecordedInput(io.AudioInput):
        def __init__(self):
            super().__init__(label='synthetic-recorded-Tamil')
            self.stream = audio()
        async def __anext__(self):
            return await anext(self.stream)
    report = dict(synthetic_audio=True, external_business_actions_mocked=True,
                  stt_transport='real streaming Sarvam', sip_call=False,
                  measurement='generated PCM/local sink, not room or handset playback')
    async with aiohttp.ClientSession() as http:
        tts = sarvam.TTS(target_language_code='ta-IN', model=config.SARVAM_MODEL,
                         speaker=prof.get('voice') or config.SARVAM_SPEAKER,
                         speech_sample_rate=config.SARVAM_SAMPLE_RATE, pace=config.SARVAM_PACE,
                         output_audio_codec='linear16', http_session=http)
        stt = sarvam.STT(language='unknown', model=config.SARVAM_STT_MODEL,
                         mode=config.SARVAM_STT_MODE, sample_rate=16000, http_session=http)
        try:
            report['agent'] = await run_case(case, prof, 'session', tts=tts, stt=stt,
                vad=agent._shared_vad(), audio_input=RecordedInput(), output_sink=sink,
                budget_file=dest/'overlap-request-budget.json', request_limit=12)
            report['first_pcm_mono'] = anchor + sink.first_ms/1000 if sink.first_ms is not None else None
            report['output_frames'] = len(sink.frames)
            save(dest/'overlap-streaming-answer.wav', sink.frames)
        except Exception as exc:
            report['error'] = type(exc).__name__ + ': ' + str(exc)[:250]
        finally:
            await stt.aclose()
            await tts.aclose()
    (dest/'overlap-streaming.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'agent'}, ensure_ascii=False))


if __name__ == '__main__':
    asyncio.run(main())
