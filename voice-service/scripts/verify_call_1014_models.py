"""Bounded configured-model comparison; synthetic callers, fail-closed actions."""
import asyncio
import json
from replay_understanding import ROOT, profile, run_case
from assistant_prompts import profile_for_direction
from verification_sandbox import strict_business_sandbox

CASES = [
    dict(id='service_question', pending=None, intent=None, seed_entities={},
         question='வணக்கம், Juli பேசுறேன்.', history=[('user', 'வணக்கம்.')],
         text='நீங்க எந்த மாதிரி services provide பண்றீங்கன்னு சுருக்கமா சொல்லுங்களேன்?',
         expected='Name verified services directly; no promise to explain later, no intake.'),
    dict(id='hospital_followup', pending=None, intent=None, seed_entities={},
         question='Hospital management software-ம் செய்கிறோம்.',
         history=[('user', 'எந்த services தருவீங்க?'),
                  ('assistant', 'Hospital management software, AI solutions, software development.')],
         text='Hospital-க்கு என்ன பண்ணுவீங்கன்னுதான் கேட்டேன். Treatment தருவீங்களா software பண்ணுவீங்களா?',
         expected='Clearly distinguish hospital software from medical treatment, no unrelated medical intake.'),
    dict(id='noon_only', pending='confirm', question='November 6, 11 AM சரிதானே?',
         text='அதே தேதி தான். நேரம் மட்டும் மதியம் பன்னிரண்டு, noon twelve-க்கு மாற்றுங்க. மற்ற details அதேதான்.',
         expected='Update only time to 12:00 noon and preserve date/name/email/service.')
]


async def main():
    import db
    import knowledge
    prof = profile_for_direction(await profile(), 'INBOUND')
    digest = await knowledge.get_brain_digest(prof['id'], max_chars=1200)
    await db.close_pool()
    verified = ('[VERIFIED BUSINESS KNOWLEDGE]\n' + digest) if digest else (
        '[VERIFIED SYNTHETIC KNOWLEDGE] Synthetic software company provides hospital management '
        'software, AI solutions, software development and engineering cost estimation. '
        'It provides software for hospitals, not medical treatment or clinical appointments.')
    destination = ROOT/'output/verify/call-1014-model-comparison.json'
    report = dict(synthetic=True, actual_saved_prompt=True, business_digest_used=bool(digest),
                  business_actions_mocked=True, customer_messages_sent=False,
                  request_cap=14, results=[])
    for case in CASES:
        case = dict(case, knowledge=verified)
        for model in (prof['model'], 'qwen/qwen3-30b-a3b-instruct-2507'):
            for mode in (['direct', 'session'] if case['id'] != 'noon_only' else ['session']):
                try:
                    with strict_business_sandbox():
                        row = await run_case(case, prof, mode, model_override=model,
                            budget_file=ROOT/'output/verify/call-1014-request-budget.json',
                            request_limit=14, test_read_only=False)
                except Exception as exc:
                    row = dict(id=case['id'], model=model, mode=mode,
                               error=f'{type(exc).__name__}: {str(exc)[:180]}')
                report['results'].append(row)
                destination.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
                print(json.dumps({k:row.get(k) for k in ('id','model','mode','error','rounds','after')},
                                 ensure_ascii=False), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
