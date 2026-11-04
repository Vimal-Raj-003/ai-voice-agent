"""Install reviewed inbound/outbound text; preserve assistant controls and tools."""
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


async def main():
    inbound = (ROOT/'assistant_templates/appointment_inbound.txt').read_text(encoding='utf-8').strip()
    outbound = (ROOT/'assistant_templates/appointment_outbound.txt').read_text(encoding='utf-8').strip()
    greeting = 'வணக்கம், {business_name}-லிருந்து Juli பேசுறேன்.'
    pool = await db.get_pool()
    try:
        async with pool.acquire() as connection, connection.transaction():
            row = await connection.fetchrow('SELECT * FROM assistants WHERE id=$1 FOR UPDATE', ASSISTANT)
            if not row:
                raise RuntimeError('Selected assistant missing')
            before = dict(row)
            metadata = before['metadata']
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            metadata = metadata or {}
            backup = ROOT/'output/verify/assistant-controls-before.json'
            if not backup.exists():
                backup.write_text(json.dumps(before, ensure_ascii=False, default=str, indent=2), encoding='utf-8')
            metadata = {**metadata, 'directionPrompts': {**(metadata.get('directionPrompts') or {}), 'outbound': outbound}}
            await connection.execute('''UPDATE assistants SET "systemPrompt"=$1, "firstMessage"=$2,
                metadata=$3::jsonb, "updatedAt"=NOW() WHERE id=$4''', inbound, greeting,
                json.dumps(metadata, ensure_ascii=False), ASSISTANT)
            after = dict(await connection.fetchrow('SELECT * FROM assistants WHERE id=$1', ASSISTANT))
            unchanged = [key for key in before if key not in ('systemPrompt', 'firstMessage', 'metadata', 'updatedAt')]
            assert all(before[key] == after[key] for key in unchanged)
        profile = await db.get_assistant_as_profile(ASSISTANT)
        assert profile['system_prompt'] == inbound and profile['outbound_system_prompt'] == outbound
        report = dict(assistant_id=ASSISTANT, controls_preserved=True, tools_unchanged=True,
            first_message=greeting, inbound_sha256=hashlib.sha256(inbound.encode()).hexdigest(),
            outbound_sha256=hashlib.sha256(outbound.encode()).hexdigest(),
            credentials_changed=False, calls_or_messages_sent=False)
        (ROOT/'output/verify/assistant-controls-prompt-readback.json').write_text(
            json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
    finally:
        await db.close_pool()


if __name__ == '__main__':
    asyncio.run(main())
