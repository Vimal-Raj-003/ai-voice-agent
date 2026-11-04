"""Read-only number/trunk diagnosis. No call creation or credential output."""
import asyncio
import inspect
import json
import os
from pathlib import Path
import sys
import httpx
from dotenv import load_dotenv
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT/'.env')
import db
import config
from livekit import api

async def main():
    result = {'environment': {key: os.getenv(key, '') for key in
        ['LIVEKIT_URL', 'VOBIZ_OUTBOUND_NUMBER', 'OUTBOUND_TRUNK_ID', 'INBOUND_TRUNK_ID']}}
    pool = await db.get_pool()
    try:
        result['phone_numbers'] = [dict(r) for r in await pool.fetch('SELECT * FROM phone_numbers ORDER BY number')]
        result['db_trunks'] = [dict(r) for r in await pool.fetch('SELECT id,name,provider,"livekitTrunkId",type,"isActive" FROM sip_trunks')]
        result['settings'] = [dict(r) for r in await pool.fetch('SELECT key,value FROM settings WHERE key=ANY($1)',
            ['VOBIZ_OUTBOUND_NUMBER', 'OUTBOUND_TRUNK_ID', 'INBOUND_TRUNK_ID'])]
        result['recent_calls'] = [dict(r) for r in await pool.fetch('''SELECT id,direction,status,"fromNumber","toNumber","startedAt","endedAt","endedReason" FROM calls ORDER BY "createdAt" DESC LIMIT 8''')]
    finally:
        await db.close_pool()
    client = api.LiveKitAPI()
    try:
        inbound = (await client.sip.list_sip_inbound_trunk(api.ListSIPInboundTrunkRequest())).items
        outbound = (await client.sip.list_sip_outbound_trunk(api.ListSIPOutboundTrunkRequest())).items
        result['inbound_trunks'] = [{'id':t.sip_trunk_id, 'name':t.name, 'numbers':list(t.numbers),
            'allowed_addresses':list(t.allowed_addresses), 'allowed_numbers':list(t.allowed_numbers)} for t in inbound]
        result['outbound_trunks'] = [{'id':t.sip_trunk_id, 'name':t.name, 'numbers':list(t.numbers),
            'address':t.address, 'transport':t.transport} for t in outbound]
        result['dispatch'] = [{'id':r.sip_dispatch_rule_id, 'trunk_ids':list(r.trunk_ids),
            'agent_names':[a.agent_name for a in r.room_config.agents]} for r in
            (await client.sip.list_sip_dispatch_rule(api.ListSIPDispatchRuleRequest())).items]
        result['rooms'] = [{'name':r.name, 'participants':r.num_participants} for r in (await client.room.list_rooms(api.ListRoomsRequest())).rooms]
        result['update_signatures'] = {name:str(inspect.signature(getattr(client.sip,name))) for name in
            ['update_sip_inbound_trunk_fields','update_sip_outbound_trunk_fields'] if hasattr(client.sip,name)}
    finally:
        await client.aclose()
    result['vobiz_credentials_present'] = bool(config.VOBIZ_AUTH_ID and config.VOBIZ_AUTH_TOKEN)
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as http:
        response = await http.get('https://vobiz.ai/openapi.json')
        result['vobiz_spec_status'] = response.status_code
        if response.status_code == 200:
            paths = response.json().get('paths', {})
            result['vobiz_relevant_paths'] = {path:{method:details.get('summary') for method,details in methods.items()
                                                  if isinstance(details,dict)} for path,methods in paths.items()
                if any(word in path.lower() for word in ['trunk','number','cdr','channel','live'])}
    target = ROOT/'output/verify/single-number-audit.json'
    target.write_text(json.dumps(result, default=str, indent=2), encoding='utf-8')
    # Caller phone data stays in the local artifact; print config only.
    print(json.dumps({k:v for k,v in result.items() if k not in ['recent_calls']}, default=str, indent=2))

if __name__ == '__main__':
    asyncio.run(main())
