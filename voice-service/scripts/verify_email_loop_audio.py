"""One synthetic Tamil approval through real Sarvam STT, SDK agent and TTS.

The customer recording is never uploaded. Shares this repair's 12-attempt LLM
cap. Captures generated PCM locally; no SIP/room/handset timing is implied.
"""
import asyncio
import argparse
import json
import time
import aiohttp
from livekit.plugins import sarvam
from livekit.agents.types import APIConnectOptions
from replay_understanding import ROOT, profile, run_case
from replay_synthetic_speech import Capture, save
from verify_email_loop_model import CASES
from assistant_prompts import profile_for_direction
import config


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--budget-file', default='email-loop-request-budget.json')
    parser.add_argument('--label', default='email-loop')
    args = parser.parse_args()
    prof = profile_for_direction(await profile(), 'INBOUND')
    case = dict(CASES[0])
    output = ROOT/'output/verify'
    async with aiohttp.ClientSession() as http:
        tts = sarvam.TTS(target_language_code='ta-IN', model=config.SARVAM_MODEL,
            speaker=prof.get('voice') or config.SARVAM_SPEAKER, pace=config.SARVAM_PACE,
            speech_sample_rate=config.SARVAM_SAMPLE_RATE, output_audio_codec='linear16',
            min_buffer_size=config.SARVAM_MIN_BUFFER_SIZE,
            max_chunk_length=config.SARVAM_MAX_CHUNK_LENGTH, http_session=http)
        stt = sarvam.STT(language='unknown', model=config.SARVAM_STT_MODEL,
            mode=config.SARVAM_STT_MODE, sample_rate=16000, http_session=http)
        try:
            frames = []
            async with tts.synthesize(case['text'], conn_options=APIConnectOptions(max_retry=0, timeout=15)) as stream:
                async for event in stream:
                    frames.append(event.frame)
            save(output/f'{args.label}-synthetic-input.wav', frames)
            anchor = time.monotonic()
            recognized = await stt.recognize(frames, conn_options=APIConnectOptions(max_retry=0, timeout=15))
            stt_ms = round((time.monotonic()-anchor)*1000, 1)
            case['text'] = recognized.alternatives[0].text
            sink = Capture(time.monotonic())
            result = await run_case(case, prof, 'session', tts=tts, output_sink=sink,
                budget_file=output/args.budget_file, request_limit=12, test_read_only=True)
            save(output/f'{args.label}-synthetic-answer.wav', sink.frames)
            report = dict(synthetic_input=True, customer_recording_uploaded=False,
                stt_text=case['text'], batch_stt_ms=stt_ms, agent=result,
                text_submission_to_first_generated_pcm_ms=sink.agent_to_pcm_ms,
                generated_audio_frames=len(sink.frames), room_playback_measured=False,
                handset_timing_measured=False)
            (output/f'{args.label}-audio-verification.json').write_text(
                json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False), flush=True)
        finally:
            await tts.aclose()
            await stt.aclose()


if __name__ == '__main__':
    asyncio.run(main())
