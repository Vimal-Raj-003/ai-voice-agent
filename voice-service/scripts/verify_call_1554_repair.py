"""Bounded selected-model verification: synthetic speech/data, no business writes."""
from __future__ import annotations
import argparse
import asyncio
import json
from replay_understanding import ROOT, profile, run_case

BASE = {'name': 'Nila', 'service': 'existing e-commerce website maintenance',
        'date': '2026-11-06', 'time': '16:00', 'email': 'nila@example.test', 'email_confirmed': 'yes'}
HISTORY = [
    ('user', 'எனக்கு ஏற்கனவே e-commerce website இருக்கு. புதுசா website வேண்டாம்.'),
    ('assistant', 'எப்படி உதவலாம்?'),
    ('user', 'இருக்கிற website ரொம்ப slow-வா இருக்கு. அதை சரி செய்யணும்.'),
    ('assistant', 'Maintenance பற்றி பேசலாம்.'),
    ('user', 'இப்போ book பண்ணாதீங்க. முதல்ல details மட்டும் பேசலாம்.'),
    ('assistant', 'சரி, details மட்டும் பேசலாம்.'),
]
CASES = [
    dict(id='remember_original_problem', pending='email', question='உங்க email என்ன?',
         seed_entities=BASE, history=HISTORY + [('user', 'மற்ற விவரங்கள் பற்றி பிறகு பேசலாம்.'), ('assistant', 'சரி.')] * 7,
         text='நான் ஏற்கனவே வைத்திருக்கிற site-ல என்ன குறை சொன்னேன்? புதுசா கட்டணும்னு கேட்டேனா?',
         expected='Existing slow website maintenance; no new website, no unrelated intake.'),
    dict(id='name_is_not_scheduling', pending='name', question='உங்கள் பெயர் என்ன?',
         seed_entities={'service': 'website maintenance'}, history=HISTORY[:4],
         text='எனக்கு நாளைக்கு மதியம் நேரம் இருந்தா நல்லா இருக்கும்.',
         expected='Recognize scheduling preference, do not save a name; ask only the missing name or unclear time.'),
    dict(id='noon_only_correction', pending='confirm', question='Friday November 6, 4 PM சரிதானே?',
         seed_entities=BASE, history=HISTORY,
         text='வெள்ளிக்கிழமை அப்படியே இருக்கட்டும். நாலு மணி வேண்டாம், மதியம் பன்னிரண்டு மணிக்கு மட்டும் மாத்துங்க.',
         expected='Update only time to 12:00; date/name/email/service unchanged; no booking success.'),
    dict(id='neutral_and_no_false_booking', pending='email_confirmation', question='nila@example.test சரிதானே?',
         seed_entities=BASE, history=HISTORY,
         text='ஆமா அந்த email சரிதான். என்னை ஐயா சார் மேடம்னு கூப்பிட வேண்டாம். இப்போ booking செய்ய வேண்டாம்.',
         expected='Neutral address, preserve email, no booking/email success or action.'),
    dict(id='maintenance_question_during_intake', pending='email', question='உங்க email என்ன?',
         seed_entities=BASE, history=HISTORY,
         text='ஒரு நிமிஷம், எங்க online store speed issue-க்கும் support தருவீங்களா?',
         expected='Answer maintenance/speed support directly from knowledge; no unrelated intake/status/title.'),
]

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--case', action='append')
    parser.add_argument('--mode', choices=['direct', 'session', 'both'], default='both')
    parser.add_argument('--model')
    parser.add_argument('--label', default='selected')
    args = parser.parse_args()
    prof = await profile()
    destination = ROOT/'output/verify'
    artifact = destination/f'call-1554-repair-{args.label}.json'
    report = dict(synthetic=True, selected_profile=True, external_actions_mocked=True,
                  request_cap=20, voice_timing_measured=False, results=[])
    if artifact.exists():
        report = json.loads(artifact.read_text(encoding='utf-8'))
    for case in CASES:
        if args.case and case['id'] not in args.case:
            continue
        for mode in (['direct', 'session'] if args.mode == 'both' else [args.mode]):
            if any(r.get('id') == case['id'] and r.get('mode') == mode for r in report['results']):
                continue
            try:
                row = await run_case(case, prof, mode, args.model,
                    budget_file=destination/'call-1554-repair-request-budget.json', request_limit=20,
                    test_read_only=True)
            except Exception as exc:
                row = dict(id=case['id'], mode=mode, error=f'{type(exc).__name__}: {str(exc)[:180]}')
            report['results'].append(row)
            artifact.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(dict(id=row['id'], mode=mode, error=row.get('error'),
                replies=[r['reply'] for r in row.get('rounds', [])], state=row.get('after'),
                tools=[c for r in row.get('rounds', []) for c in r['tool_calls']],
                actions=row.get('external_actions')), ensure_ascii=False), flush=True)

if __name__ == '__main__':
    asyncio.run(main())
