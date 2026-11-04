"""Two synthetic recordings through real Sarvam STT, actual SDK agent and TTS.

No customer audio, SIP calls or business writes. Shares the repair's LLM cap.
"""
import asyncio
import json
import time
import aiohttp
from livekit.plugins import sarvam
from livekit.agents.types import APIConnectOptions
from replay_understanding import ROOT, profile, run_case
from replay_synthetic_speech import Capture, save
from verify_call_1554_repair import CASES
import config


async def main():
    prof = await profile()
    destination = ROOT/'output/verify'
    report = dict(synthetic_audio=True, customer_audio_uploaded=False,
                  transport='batch STT then real AgentSession with streaming TTS/local audio sink',
                  room_or_handset_timing_verified=False, results=[])
    async with aiohttp.ClientSession() as http:
        tts = sarvam.TTS(target_language_code='ta-IN', model=config.SARVAM_MODEL,
            speaker=prof.get('voice') or config.SARVAM_SPEAKER, pace=config.SARVAM_PACE,
            speech_sample_rate=config.SARVAM_SAMPLE_RATE, output_audio_codec='linear16',
            min_buffer_size=config.SARVAM_MIN_BUFFER_SIZE,
            max_chunk_length=config.SARVAM_MAX_CHUNK_LENGTH, http_session=http)
        stt = sarvam.STT(language='unknown', model=config.SARVAM_STT_MODEL,
            mode=config.SARVAM_STT_MODE, sample_rate=16000, http_session=http)
        try:
            for case_id in ['maintenance_question_during_intake', 'name_is_not_scheduling']:
                case = dict(next(c for c in CASES if c['id'] == case_id))
                row = dict(id=case_id, expected_text=case['text'])
                try:
                    frames = []
                    async with tts.synthesize(case['text'], conn_options=APIConnectOptions(max_retry=0, timeout=15)) as stream:
                        async for event in stream:
                            frames.append(event.frame)
                    save(destination/f'call-1554-{case_id}-synthetic-input.wav', frames)
                    anchor = time.monotonic()
                    event = await stt.recognize(frames, conn_options=APIConnectOptions(max_retry=0, timeout=15))
                    row['batch_stt_upload_to_final_ms'] = round((time.monotonic()-anchor)*1000, 1)
                    row['stt_text'] = event.alternatives[0].text if event.alternatives else ''
                    case['text'] = row['stt_text']
                    sink = Capture(time.monotonic())
                    result = await run_case(case, prof, 'session', tts=tts, output_sink=sink,
                        budget_file=destination/'call-1554-repair-request-budget.json', request_limit=20,
                        test_read_only=True)
                    row['agent'] = result
                    row['text_submission_to_first_generated_pcm_ms'] = sink.agent_to_pcm_ms
                    row['audio_frames'] = len(sink.frames)
                    row['timing_scope'] = 'Local generated PCM; excludes live endpoint waiting, SIP and handset playout.'
                    save(destination/f'call-1554-{case_id}-synthetic-answer.wav', sink.frames)
                except Exception as exc:
                    row['error'] = f'{type(exc).__name__}: {str(exc)[:200]}'
                report['results'].append(row)
                (destination/'call-1554-repair-audio.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps(row, ensure_ascii=False), flush=True)
        finally:
            await tts.aclose()
            await stt.aclose()


if __name__ == '__main__':
    asyncio.run(main())
