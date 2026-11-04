"""Save the measured model choice; preserve every other assistant setting."""
import asyncio
import json
from pathlib import Path
import sys
import httpx
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT/'.env')
import db


async def main():
    assistant = 'cmuv65lxx0013v7f4thzf2qtv'
    model = 'qwen/qwen3-30b-a3b-instruct-2507'
    fallback = 'meta-llama/llama-3.3-70b-instruct'
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(f'https://openrouter.ai/api/v1/models/{model}/endpoints')
        response.raise_for_status()
        data = response.json()['data']
    endpoints = [row for row in data['endpoints'] if row.get('status') == 0
        and 'tools' in row.get('supported_parameters',[]) and row.get('supports_tool_choice',{}).get('function')]
    if not endpoints:
        raise RuntimeError('No healthy tool-capable model endpoint; settings unchanged')
    pool = await db.get_pool()
    try:
        async with pool.acquire() as connection, connection.transaction():
            before = dict(await connection.fetchrow('SELECT * FROM assistants WHERE id=$1 FOR UPDATE',assistant))
            if before['llmModel'] not in (fallback, model):
                raise RuntimeError('Operator changed selected model during verification; left unchanged')
            backup = ROOT/'output/verify/call-1014-model-before.json'
            if not backup.exists():
                backup.write_text(json.dumps({k:before[k] for k in ('id','llmProvider','llmModel','llm_fallback_model','updatedAt')},default=str,indent=2),encoding='utf8')
            await connection.execute('''UPDATE assistants SET "llmModel"=$1, llm_fallback_model=$2,
                "updatedAt"=NOW() WHERE id=$3''',model,fallback,assistant)
            after = dict(await connection.fetchrow('SELECT * FROM assistants WHERE id=$1',assistant))
            changed = [key for key in before if before[key] != after[key]]
            assert set(changed) <= {'llmModel','llm_fallback_model','updatedAt'}
        report = dict(assistant_id=assistant, primary=model, fallback=fallback,
            changed_columns=changed, all_other_settings_preserved=True,
            credentials_changed=False, calls_or_messages_initiated=False,
            available_endpoints=[{k:r.get(k) for k in ('provider_name','tag','pricing','supports_tool_choice','latency_last_30m')} for r in endpoints])
        (ROOT/'output/verify/call-1014-model-readback.json').write_text(json.dumps(report,indent=2),encoding='utf8')
        print(json.dumps(report))
    finally:
        await db.close_pool()


if __name__ == '__main__':
    asyncio.run(main())
