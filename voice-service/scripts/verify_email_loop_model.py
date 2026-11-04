"""Bounded configured-model checks for this repair; synthetic contacts only.

Separate task budget: at most 12 chat attempts across before/after runs.
Prior repair budgets are never reset or changed. No customer audio upload.
"""
import argparse
import asyncio
import json
from replay_understanding import ROOT, profile, run_case
from assistant_prompts import profile_for_direction

CASES = [
    dict(id='confirmed_send_request', pending='email_confirmation',
         question='nila@example.test சரியான email தானே?',
         text='ம் சரியா இருக்கு அனுப்புங்க email அனுப்புங்க.',
         expected='Confirm the existing recipient once, no repeated email question; disclose read-only sending limitation.'),
    dict(id='inbound_reason', direction='INBOUND', pending=None,
         history=[('user', 'வணக்கம்.')],
         question='உங்களுக்கு எப்படி உதவலாம்?', seed_entities={},
         text='ஏன் phone பண்ணியிருக்கீங்க?',
         expected='Explain caller initiated this inbound call, not an unsolicited outbound campaign; ask how to help without blame.'),
    dict(id='heldout_recipient_approval', pending='email_confirmation',
         question='nila@example.test சரியா?',
         text='நீங்க படிச்ச mail ID ஓகேதான், அதையே வச்சுக்கங்க. மறுபடி கேட்க வேண்டாம்.',
         expected='Existing address is approved; preserve date/name/service; do not ask for it or its confirmation again.'),
    dict(id='outbound_reason', direction='OUTBOUND', pending=None,
         history=[('user', 'வணக்கம்.')],
         question='வணக்கம், Synthetic software company-லிருந்து பேசுறேன்.', seed_entities={},
         text='எதுக்காக என்னை தொடர்பு கொண்டீங்க?',
         expected='Explain only the configured outbound purpose and business; do not claim the recipient initiated the call.'),
]


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['before', 'after'], required=True)
    parser.add_argument('--case', action='append')
    parser.add_argument('--label')
    parser.add_argument('--inspect-profile', action='store_true')
    args = parser.parse_args()
    prof = await profile()
    if args.inspect_profile:
        import re
        print(json.dumps({key: value for key, value in prof.items()
            if key in ('id', 'name', 'role', 'business_name')}, ensure_ascii=False))
        for key in ('system_prompt', 'outbound_system_prompt'):
            lines = [line for line in str(prof.get(key) or '').splitlines()
                     if re.search(r'goal|call|purpose|inbound|outbound|நோக்கம்|அழைப்பு', line, re.I)]
            print(key, json.dumps(lines, ensure_ascii=False))
        return
    selected = CASES[:2] if args.phase == 'before' else CASES
    if args.case:
        selected = [case for case in selected if case['id'] in args.case]
    result = dict(phase=args.phase, actual_model=True, synthetic=True, external_actions_mocked=True,
                  customer_data_sent=False, voice_timing_measured=False, results=[])
    output = ROOT/f'output/verify/email-loop-model-{args.label or args.phase}.json'
    for case in selected:
        selected_profile = profile_for_direction(prof, case.get('direction', 'INBOUND'))
        row = await run_case(case, selected_profile, 'session',
            budget_file=ROOT/'output/verify/email-loop-request-budget.json', request_limit=12,
            test_read_only=True)
        result['results'].append(row)
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(row, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
