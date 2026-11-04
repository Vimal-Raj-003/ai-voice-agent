"""Bounded carrier GETs only. Redact credentials and unrelated callers."""
import asyncio
import json
import os
import re
from pathlib import Path
import sys
import httpx
from dotenv import load_dotenv
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT/'.env')
import vobiz
import config

def safe(value, key=''):
    if re.search(r'password|secret|token|auth.?id|username|recording.?url|email', key, re.I):
        return '<redacted>'
    if isinstance(value, dict):
        return {k:safe(v,k) for k,v in value.items()}
    if isinstance(value, list):
        return [safe(v,key) for v in value]
    if isinstance(value, str):
        for credential in [config.VOBIZ_AUTH_TOKEN, config.VOBIZ_AUTH_ID, os.getenv('VOBIZ_PASSWORD'), os.getenv('LIVEKIT_API_SECRET')]:
            if credential:
                value = value.replace(credential, '<redacted>')
        if re.search(r'caller|destination|from_number|to_number', key, re.I):
            digits = re.sub(r'\D','',value)
            if digits and digits[-10:] not in ('8065481576','8065480036'):
                return '***'+digits[-4:]
    return value

async def main():
    result = {}
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as http:
        spec = (await http.get('https://www.vobiz.ai/openapi.json')).json()
        relevant = ['/api/v1/Account/{auth_id}/trunks/{trunk_id}',
                    '/api/v1/Account/{auth_id}/numbers/{phone_number}/assign']
        result['mutation_schemas'] = {p:spec['paths'].get(p) for p in relevant}
        for name, suffix in [('trunks','/trunks'), ('numbers','/numbers'),
                             ('cdr_recent','/cdr/recent'), ('origination','/trunks/origination-uris')]:
            response = await http.get(vobiz._account_path(suffix), headers=vobiz._headers(), params={'limit':20})
            try: body = response.json()
            except ValueError: body = {'message':'non-JSON response'}
            result[name] = {'status':response.status_code, 'body':safe(body)}
        for number in ['+918065481576','+918065480036']:
            url = f'{config.VOBIZ_API_BASE}/api/v1/account/{config.VOBIZ_AUTH_ID}/numbers/{number}/health'
            response = await http.get(url, headers=vobiz._headers())
            try: body=response.json()
            except ValueError: body={'message':'non-JSON response'}
            result['health_'+number] = {'status':response.status_code, 'body':safe(body)}
    (ROOT/'output/verify/single-number-vobiz.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k != 'mutation_schemas'}, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
