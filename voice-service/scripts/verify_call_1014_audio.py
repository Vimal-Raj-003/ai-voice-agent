"""Synthetic speech comparison only; shares the 14-request repair budget."""
import asyncio
import json
import time
from replay_understanding import ROOT, profile, run_case
from replay_synthetic_speech import Capture, save
from assistant_prompts import profile_for_direction
from verification_sandbox import strict_business_sandbox
from verify_call_1014_models import CASES


async def main():
    import agent
    from livekit.plugins import sarvam
    from livekit.agents.types import APIConnectOptions
    prof = profile_for_direction(await profile(), 'INBOUND')
    tts = agent._build_sarvam_tts(prof)
    stt = sarvam.STT(language='unknown', model='saaras:v4', mode='codemix', sample_rate=16000)
    report = dict(synthetic_audio=True, customer_audio_uploaded=False,
                  timing_boundary='text submission to local generated PCM; excludes endpoint waiting/SIP/handset', results=[])
    try:
        frames = []
        async with tts.synthesize(CASES[1]['text'], conn_options=APIConnectOptions(max_retry=0,timeout=20)) as stream:
            async for event in stream:
                frames.append(event.frame)
        save(ROOT/'output/verify/call-1014-synthetic-input.wav',frames)
        started = time.monotonic()
        transcript = await stt.recognize(frames, conn_options=APIConnectOptions(max_retry=0,timeout=20))
        report['batch_stt_ms'] = round((time.monotonic()-started)*1000,1)
        report['transcript'] = transcript.alternatives[0].text
        for label, model in [('selected',prof['model']),('qwen','qwen/qwen3-30b-a3b-instruct-2507')]:
            case = dict(CASES[1], text=report['transcript'],
                knowledge='[VERIFIED SYNTHETIC KNOWLEDGE] We develop hospital management software; we do not provide medical treatment or clinical appointments.')
            sink = Capture(time.monotonic())
            try:
                with strict_business_sandbox():
                    result = await run_case(case,prof,'session',model_override=model,
                        tts=tts,output_sink=sink,test_read_only=False,
                        budget_file=ROOT/'output/verify/call-1014-request-budget.json',request_limit=14)
                row=dict(label=label,model=model,agent=result,
                    text_submission_to_first_generated_pcm_ms=sink.agent_to_pcm_ms,
                    generated_frames=len(sink.frames))
                save(ROOT/f'output/verify/call-1014-{label}-synthetic-answer.wav',sink.frames)
            except Exception as exc:
                row=dict(label=label,error=f'{type(exc).__name__}: {str(exc)[:150]}')
            report['results'].append(row)
            (ROOT/'output/verify/call-1014-audio-verification.json').write_text(
                json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps({k:v for k,v in row.items() if k!='agent'}),flush=True)
    finally:
        await tts.aclose()
        await stt.aclose()


async def run():
    from livekit.agents.utils import http_context
    async with http_context.open():
        await main()


if __name__ == '__main__':
    asyncio.run(run())
