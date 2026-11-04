"""Save only the user-requested outbound follow-up prompt; preserve inbound/metadata."""
import asyncio
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT/'.env')
import db

ASSISTANT = 'cmuv65lxx0013v7f4thzf2qtv'
PURPOSE = '''
[OUTBOUND ENQUIRY / APPOINTMENT FOLLOW-UP]
You are the voice assistant for {business_name}, handling follow-up calls. This is not an inbound reception or new-booking intake script.
This call was initiated by {business_name} to follow up an existing enquiry or appointment.
Identify the configured business and briefly explain that follow-up purpose when asked why you called. Do not answer only with a greeting or ask why the recipient called you.
For a reason-for-calling question, answer with business identity and follow-up purpose, then stop. Do not append a service/name/email intake question. Natural Tamil example: "நான் {business_name}-லிருந்து பேசுறேன். Enquiry அல்லது appointment follow-up தொடர்பாக அழைக்கிறேன்."
Use verified lead/campaign/history/tool details to know which enquiry or appointment is involved. If those details are missing, say only that this is an enquiry/appointment follow-up call and ask one focused question to identify the matter. Never invent a prior date, service, booking, consent, message delivery or customer request.
Confirm you reached the intended person when identity is available, respect a wrong number or a request to stop, and ask if it is a convenient time. Do not force booking intake or pitch unrelated services. Preserve known details and the caller's latest correction. Once an email is approved, do not ask for it or its approval again unless it changes.
Speak natural Tamil/Tanglish in short relevant replies; address everyone only as நீங்க/நீங்கள். Never claim a booking, availability check or message succeeded without its verified tool result. Read-only test limitations take priority.
'''.strip()


async def main():
    pool = await db.get_pool()
    try:
        async with pool.acquire() as connection, connection.transaction():
            row = await connection.fetchrow('SELECT id, "systemPrompt", metadata FROM assistants WHERE id=$1 FOR UPDATE', ASSISTANT)
            if not row:
                raise RuntimeError('Selected assistant missing; no configuration changed')
            metadata = row['metadata']
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            metadata = metadata or {}
            directions = metadata.get('directionPrompts') or {}
            old = directions.get('outbound') or ''
            if old.strip() and '[OUTBOUND ENQUIRY / APPOINTMENT FOLLOW-UP]' not in old:
                raise RuntimeError('An outbound prompt was concurrently configured; preserve it and review')
            # A separate outbound script must not inherit the inbound intake
            # steps that caused the configured-model follow-up case to fail.
            new = PURPOSE
            backup = ROOT/'output/verify/email-loop-prompt-backup.json'
            if not backup.exists():
                backup.write_text(json.dumps(dict(assistant_id=ASSISTANT, metadata=metadata,
                    inbound_prompt=row['systemPrompt']), ensure_ascii=False, indent=2), encoding='utf-8')
            updated = {**metadata, 'directionPrompts': {**directions, 'outbound': new}}
            await connection.execute('UPDATE assistants SET metadata=$1::jsonb, "updatedAt"=NOW() WHERE id=$2',
                                     json.dumps(updated, ensure_ascii=False), ASSISTANT)
        profile = await db.get_assistant_as_profile(ASSISTANT)
        assert profile['system_prompt'] == row['systemPrompt']
        assert profile['outbound_system_prompt'] == new
        result = dict(assistant_id=ASSISTANT, inbound_unchanged=True,
                      outbound_purpose='Existing enquiry/appointment follow-up',
                      outbound_prompt_sha256=hashlib.sha256(new.encode()).hexdigest(),
                      other_metadata_preserved=True, credentials_changed=False)
        (ROOT/'output/verify/email-loop-outbound-config.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps(result))
    finally:
        await db.close_pool()


if __name__ == '__main__':
    asyncio.run(main())
