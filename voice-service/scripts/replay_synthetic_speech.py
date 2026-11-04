"""One synthetic recorded Tamil utterance -> configured STT -> real SDK agent.

No customer recordings are uploaded. This uses batch recognition of a WAV,
not PSTN/streaming endpoint detection. Output timings measure generated PCM at
a local sink, not a loudspeaker or handset. All action I/O remains mocked.
"""
from __future__ import annotations
import asyncio
import json
import time
import wave
import aiohttp
from livekit import rtc
from livekit.plugins import sarvam
from livekit.agents.voice import io
from livekit.agents.types import APIConnectOptions
from replay_understanding import ROOT, CASES, profile, run_case
import config


class Capture(io.AudioOutput):
    def __init__(self, anchor):
        super().__init__(label='synthetic-capture', capabilities=io.AudioOutputCapabilities(pause=False))
        self.anchor = anchor
        self.frames = []
        self.first_ms = None
        self.segment = False
        self.position = 0.
        self.agent_input_at = None
        self.agent_to_pcm_ms = None

    async def capture_frame(self, frame):
        await super().capture_frame(frame)
        if self.first_ms is None:
            self.first_ms = round((time.monotonic()-self.anchor)*1000, 1)
            if self.agent_input_at:
                self.agent_to_pcm_ms = round((time.monotonic()-self.agent_input_at)*1000, 1)
        if not self.segment:
            self.segment = True
            self.on_playback_started(created_at=time.time())
        self.frames.append(frame)
        self.position += frame.samples_per_channel / frame.sample_rate

    def flush(self):
        super().flush()
        if self.segment:
            self.on_playback_finished(playback_position=self.position, interrupted=False)
            self.segment = False
            self.position = 0.

    def clear_buffer(self):
        self.flush()


def save(path, frames):
    if frames:
        combined = rtc.combine_audio_frames(frames)
        path.write_bytes(combined.to_wav_bytes())


async def main():
    prof = await profile()
    case = dict(next(c for c in CASES if c['id'] == 'presence_with_question'))
    dest = ROOT / 'output' / 'verify'
    dest.mkdir(parents=True, exist_ok=True)
    report = dict(synthetic_recording=True, customer_audio_uploaded=False,
                  expected_text=case['text'], stt_transport='batch WAV recognition',
                  handset_or_room_timing_verified=False)
    async with aiohttp.ClientSession() as http:
        tts = sarvam.TTS(target_language_code='ta-IN', model=config.SARVAM_MODEL,
                         speaker=prof.get('voice') or config.SARVAM_SPEAKER,
                         speech_sample_rate=config.SARVAM_SAMPLE_RATE,
                         pace=config.SARVAM_PACE, output_audio_codec='linear16', http_session=http)
        stt = sarvam.STT(language='unknown', model=config.SARVAM_STT_MODEL,
                         mode=config.SARVAM_STT_MODE, sample_rate=16000, http_session=http)
        try:
            frames = []
            async with tts.synthesize(case['text'], conn_options=APIConnectOptions(max_retry=0, timeout=15)) as stream:
                async for chunk in stream:
                    frames.append(chunk.frame)
            save(dest / 'synthetic-tamil-caller.wav', frames)
            report['input_audio_seconds'] = sum(f.samples_per_channel/f.sample_rate for f in frames)
            # This clock includes upload/ASR, SDK text processing, real LLM and
            # actual streaming TTS. It excludes telephony and live endpointing.
            anchor = time.monotonic()
            event = await stt.recognize(frames, conn_options=APIConnectOptions(max_retry=0, timeout=15))
            report['stt_upload_to_final_ms'] = round((time.monotonic()-anchor)*1000, 1)
            report['transcript'] = event.alternatives[0].text if event.alternatives else ''
            case['text'] = report['transcript']
            sink = Capture(anchor)
            result = await run_case(case, prof, 'session', tts=tts, output_sink=sink)
            report['agent'] = result
            report['stt_upload_to_first_response_pcm_ms'] = sink.first_ms
            report['agent_text_submission_to_first_pcm_ms'] = sink.agent_to_pcm_ms
            report['answer_response_first_pcm_ms'] = sink.first_ms if result['rounds'] and sink.frames else None
            report['timing_note'] = 'First reply and answer segment coincide only because this case has no progress/filler. Not PSTN speech-end-to-ear timing.'
            report['output_frames'] = len(sink.frames)
            save(dest / 'synthetic-tamil-answer.wav', sink.frames)
        except Exception as exc:
            report['error'] = type(exc).__name__ + ': ' + str(exc)[:250]
        finally:
            await stt.aclose()
            await tts.aclose()
    (dest / 'understanding-speech.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
