"""Configured-model verification for the assistant-controls task.

At most 12 SDK chat attempts; synthetic data and mocked business actions only.
The prior repair's exhausted budgets are not modified.
"""
import asyncio
import json
from replay_understanding import ROOT, profile, run_case
from assistant_prompts import profile_for_direction
from verification_sandbox import strict_business_sandbox

CASES = [
    dict(id='saved_inbound_reason', direction='INBOUND', pending=None, question='வணக்கம், Juli பேசுறேன்.',
         history=[('user', 'வணக்கம்.')], seed_entities={}, intent=None,
         text='நீங்க எனக்கு ஏன் கால் பண்ணீங்கன்னு சொல்ல முடியுமா?',
         expected='Politely explain caller reached the business; no outbound pitch.'),
    dict(id='saved_outbound_followup', direction='OUTBOUND', pending=None, question='வணக்கம், Juli பேசுறேன்.',
         history=[('user', 'வணக்கம்.')], seed_entities={}, intent=None,
         text='இந்த அழைப்பு எதுக்காக?',
         expected='Identify business and enquiry/appointment follow-up purpose, no unrelated intake.'),
    dict(id='one_approval_one_confirmation_action', booking=True, pending='email_confirmation',
         question='nila@example.test சரியான email தானே?',
         text='அந்த mail address சரிதான்; அதுக்கே confirmation அனுப்பிடுங்க.',
         expected='Persist approval, mock-update existing appointment recipient and queue exactly once; do not rebook or claim delivered.'),
    dict(id='preserve_original_issue', pending='email', question='வேற ஏதாவது உதவி வேணுமா?',
         history=[('user', 'எனக்கு ஏற்கனவே e-commerce website இருக்கு; புதுசா website வேண்டாம்.'),
                  ('assistant', 'என்ன பிரச்சனை?'),
                  ('user', 'என்னோட website ரொம்ப slow, சில நேரம் hang ஆகுது. Maintenance வேணும்.'),
                  ('assistant', 'சரி.')]
                  + [('user', f'மற்றொரு விவரம் பேசலாம் number {i}') for i in range(16)],
         seed_entities={'name':'Nila','service':'existing website maintenance','email':'nila@example.test','email_confirmed':'yes'},
         text='எனக்கு புதுசா website தான் வேணும்னு சொன்னேனா? முன்னாடி என்ன பிரச்சனை சொன்னேன்?',
         expected='Remember existing slow/hanging website and maintenance, no new site; do not ask email again.'),
    dict(id='operator_prompt_changes_role', pending=None, question='வணக்கம்.',
         history=[('user','வணக்கம்.')], seed_entities={}, role='support', intent=None,
         custom='You are Mira at Cycle Demo, a bicycle repair shop. Explain bicycle puncture repairs and tune-ups. We open at 9 AM. Speak natural Tamil/Tanglish. Do not use a software-company persona or push appointment intake.',
         knowledge='[VERIFIED SYNTHETIC KNOWLEDGE] Cycle Demo repairs bicycle punctures and does tune-ups. Opens at 9 AM.',
         modes=['direct','session'], text='நீங்க என்ன service பண்ணுவீங்க, கடை எத்தனை மணிக்கு திறக்கும்?',
         expected='Use the operator-selected bicycle repair role and 9 AM hours, not platform default software services.'),
]


async def main():
    prof = await profile()
    report = dict(actual_model=prof['model'], synthetic=True, external_actions_mocked=True,
                  customer_messages_sent=False, voice_timing_measured=False, results=[])
    destination = ROOT/'output/verify/assistant-controls-real-model.json'
    for case in CASES:
        selected = profile_for_direction(prof, case.get('direction','INBOUND'))
        if case.get('custom'):
            selected['system_prompt'] = case['custom']  # ephemeral probe; never saved
        for mode in case.get('modes', ['session']):
            try:
                # The action branch is tested locally with real model decisions;
                # fail-closed I/O guards apply in addition to the action mocks.
                with strict_business_sandbox():
                    result = await run_case(case, selected, mode,
                        budget_file=ROOT/'output/verify/assistant-controls-request-budget.json',
                        request_limit=12, test_read_only=False)
            except Exception as exc:
                result = dict(id=case['id'], mode=mode, error=f'{type(exc).__name__}: {str(exc)[:180]}')
            report['results'].append(result)
            destination.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
            print(json.dumps(result,ensure_ascii=False),flush=True)


if __name__ == '__main__':
    asyncio.run(main())
