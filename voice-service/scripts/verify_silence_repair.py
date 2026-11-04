"""Bounded real selected-model check; synthetic data, mocked business actions."""
from __future__ import annotations
import asyncio
import json
import time
import argparse
import aiohttp
from livekit.plugins import sarvam
from replay_understanding import ROOT, HOLDOUTS, profile, run_case
from replay_synthetic_speech import Capture, save
import config


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', action='append')
    parser.add_argument('--label', default='model')
    args = parser.parse_args()
    dest = ROOT/'output/verify'
    budget = dest/'silence-repair-request-budget.json'
    report = dict(synthetic=True, request_limit=8, business_actions_mocked=True,
                  customer_recording_uploaded=False, results=[])
    prof = await profile()
    cases = [
        dict(id='script_hello', pending='service', question='வணக்கம். எப்படி உதவலாம்?',
             text='हलो।', expected='A brief Tamil presence reply; no tool or language switch.'),
        dict(id='tamil_presence', pending='email', question='உங்க email என்ன?',
             text='கேட்குதா?', expected='A brief presence reply, preserve prior details; no state tool or intake.'),
        next(c for c in HOLDOUTS if c['id'] == 'heldout_noon'),
        dict(id='maintenance_paraphrase', pending='email', question='உங்க email என்ன?',
             text='எங்க online store-க்கு regular maintenance support இருக்கா?',
             expected='Answer ongoing maintenance from knowledge; no unrelated intake.'),
        dict(id='read_only_booking', pending='email_confirmation', question='nila@example.test தானே?',
             text='அதே details-ல appointment confirm பண்ணி email அனுப்புங்க.',
             expected='Explain test limitation, no booking/email tool or success claim.'),
    ]
    async with aiohttp.ClientSession() as http:
        tts = sarvam.TTS(target_language_code='ta-IN', model=config.SARVAM_MODEL,
            speaker=prof.get('voice') or config.SARVAM_SPEAKER,
            speech_sample_rate=config.SARVAM_SAMPLE_RATE, pace=config.SARVAM_PACE,
            output_audio_codec='linear16', http_session=http)
        try:
            for case in cases:
                if args.case and case['id'] not in args.case:
                    continue
                sink = Capture(time.monotonic()) if case['id'] == 'tamil_presence' else None
                try:
                    row = await run_case(case, prof, 'session',
                        budget_file=budget, request_limit=8, test_read_only=True,
                        tts=tts if sink else None, output_sink=sink)
                    if sink:
                        row['text_submission_to_generated_pcm_ms'] = sink.agent_to_pcm_ms
                        row['audio_frames'] = len(sink.frames)
                        row['audio_scope'] = 'Real Sarvam TTS/local sink, no STT/SIP/room/handset timing.'
                        save(dest/'silence-repair-presence-answer.wav', sink.frames)
                except Exception as exc:
                    row = dict(id=case['id'], error=type(exc).__name__+': '+str(exc)[:220])
                report['results'].append(row)
                (dest/f'silence-repair-{args.label}.json').write_text(
                    json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
                print(json.dumps(dict(id=row['id'], error=row.get('error'),
                    replies=[r.get('reply') for r in row.get('rounds', [])],
                    tools=[c['name'] for r in row.get('rounds', []) for c in r['tool_calls']],
                    state=row.get('after'), text_to_pcm_ms=row.get('text_submission_to_generated_pcm_ms')),
                    ensure_ascii=False), flush=True)
        finally:
            await tts.aclose()


if __name__ == '__main__':
    asyncio.run(main())
