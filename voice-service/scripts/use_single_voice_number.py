"""Reconcile the explicitly requested single DID. Never releases numbers or calls.

Only routing metadata changes; SIP/account credentials remain untouched.
Run without --apply for a concrete plan. Checkpoints make partial progress visible.
"""
import argparse
import asyncio
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import quote
import httpx
from dotenv import load_dotenv
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT/'.env')
import config
import db
import vobiz
from livekit import api

TARGET = '+918065481576'
OLD = '+918065480036'
CARRIER_IN = 'dcb49c8b-2e62-436c-b2db-bd41db884e40'
LIVEKIT_IN = 'ST_mKsscodyJixr'
LIVEKIT_OUT = 'ST_reLomjZWYvH3'
ASSISTANT = 'cmuv65lxx0013v7f4thzf2qtv'
DEST = ROOT/'output/verify/single-number-migration.json'

async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--carrier-only', action='store_true')
    args = parser.parse_args()
    progress = {'target': TARGET, 'retired_number': OLD, 'credentials_changed':False,
                'release_or_purchase_number':False, 'calls_or_messages_sent':False, 'steps':[]}
    def checkpoint(name, **details):
        progress['steps'].append({'step':name, **details})
        DEST.write_text(json.dumps(progress, default=str, indent=2),encoding='utf-8')
        print(json.dumps(progress['steps'][-1], default=str), flush=True)
    lk = api.LiveKitAPI()
    pool = await db.get_pool()
    try:
        rooms = (await lk.room.list_rooms(api.ListRoomsRequest())).rooms
        if rooms:
            raise RuntimeError('Active LiveKit rooms exist; no routing changes made during a call')
        numbers = await pool.fetch('SELECT id,number,"organizationId","assistantId","isActive" FROM phone_numbers WHERE number=ANY($1)', [TARGET,OLD])
        target = next((r for r in numbers if r['number']==TARGET),None)
        previous = next((r for r in numbers if r['number']==OLD),None)
        if not target or not previous or target['organizationId'] != previous['organizationId'] or target['assistantId'] != ASSISTANT:
            raise RuntimeError('Phone mapping changed unexpectedly; manual review required')
        async with httpx.AsyncClient(timeout=15) as http:
            response = await http.get(vobiz._account_path('/numbers'),headers=vobiz._headers())
            response.raise_for_status()
            owned = response.json()['items']
            target_carrier = next((r for r in owned if r.get('e164')==TARGET),None)
            if not target_carrier or target_carrier.get('status') != 'active' or not target_carrier.get('voice_enabled') or target_carrier.get('is_blocked'):
                raise RuntimeError('Requested DID is not active and voice-enabled in the carrier account')
            checkpoint('plan', apply=args.apply, target_carrier_trunk_before=target_carrier.get('trunk_group_id'),
                target_application_before=target_carrier.get('application_id'), livekit_inbound=LIVEKIT_IN,
                livekit_outbound=LIVEKIT_OUT, carrier_inbound=CARRIER_IN,
                changes=['assign requested DID to working Vobiz inbound SIP trunk',
                         'replace LiveKit outbound caller ID and inbound DID list',
                         'reconcile app phone mapping, nonsecret settings and local number',
                         'retire previous DID routing without releasing ownership'])
            if not args.apply:
                return
            if target_carrier.get('application_id'):
                if str(target_carrier['application_id']) != '97468014913938513':
                    raise RuntimeError('Unexpected application binding changed since audit; no detach attempted')
                # Provider's official number tool unlinks /application before /assign.
                response = await http.delete(vobiz._account_path(f'/numbers/{quote(TARGET,safe="")}/application'),headers=vobiz._headers())
                if response.status_code not in (200,204):
                    checkpoint('application_unlink_failed',status=response.status_code)
                    raise RuntimeError('Could not unlink Playground number association; stopped')
                checkpoint('playground_number_association_removed',application_deleted=False)
            if target_carrier.get('trunk_group_id') != CARRIER_IN:
                url = vobiz._account_path(f'/numbers/{quote(TARGET,safe="")}/assign')
                response = await http.post(url,headers=vobiz._headers(),json={'trunk_group_id':CARRIER_IN})
                if response.status_code not in (200,204):
                    from audit_vobiz_number import safe
                    try: details=safe(response.json())
                    except ValueError: details={'message':'Non-JSON error'}
                    checkpoint('carrier_assignment_failed',status=response.status_code,detail=details)
                    raise RuntimeError(f'Carrier assignment failed with HTTP {response.status_code}; no later changes applied')
            response = await http.get(vobiz._account_path('/numbers'),headers=vobiz._headers())
            response.raise_for_status()
            assigned = next(r for r in response.json()['items'] if r.get('e164')==TARGET)
            checkpoint('carrier_assignment_readback', trunk=assigned.get('trunk_group_id'),
                       application=assigned.get('application_id'))
            if assigned.get('trunk_group_id') != CARRIER_IN or assigned.get('application_id'):
                raise RuntimeError('Carrier routing read-back is not exclusively SIP; stopped for investigation')
            if args.carrier_only:
                return
            out = await lk.sip.update_sip_outbound_trunk_fields(LIVEKIT_OUT,numbers=[TARGET],name='JillJill Outbound (+918065481576)')
            inbound = await lk.sip.update_sip_inbound_trunk_fields(LIVEKIT_IN,
                numbers=[TARGET,'918065481576','08065481576','8065481576'],name='JillJill Inbound (+918065481576)')
            checkpoint('livekit_updated',outbound_numbers=list(out.numbers),inbound_numbers=list(inbound.numbers))
            async with pool.acquire() as connection:
                async with connection.transaction():
                    for key,value in [('VOBIZ_OUTBOUND_NUMBER',TARGET),('INBOUND_TRUNK_ID',LIVEKIT_IN),('OUTBOUND_TRUNK_ID',LIVEKIT_OUT)]:
                        await connection.execute('''INSERT INTO settings (key,value,is_sensitive,updated_at) VALUES ($1,$2,false,now())
                            ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()''',key,value)
                    await connection.execute('UPDATE phone_numbers SET label=$2,"isActive"=true,"updatedAt"=now() WHERE id=$1',target['id'],'JillJill Primary Inbound & Outbound (+918065481576)')
                    await connection.execute('UPDATE phone_numbers SET label=$2,"isActive"=false,"updatedAt"=now() WHERE id=$1',previous['id'],'Retired — replaced by +918065481576')
            env_file = ROOT/'.env'
            raw = env_file.read_bytes()
            updated, count = re.subn(rb'(?m)^VOBIZ_OUTBOUND_NUMBER=[^\r\n]*',b'VOBIZ_OUTBOUND_NUMBER='+TARGET.encode(),raw)
            if count != 1:
                raise RuntimeError('Expected exactly one local outbound-number setting; local file unchanged')
            if updated != raw:
                env_file.write_bytes(updated)
            checkpoint('application_updated',active_number=TARGET,retired_number_active=False,
                       inbound_setting=LIVEKIT_IN,outbound_setting=LIVEKIT_OUT)
            old_carrier = next((r for r in owned if r.get('e164')==OLD),None)
            if old_carrier and old_carrier.get('trunk_group_id'):
                response = await http.delete(vobiz._account_path(f'/numbers/{quote(OLD,safe="")}/assign'),headers=vobiz._headers())
                if response.status_code not in (200,204):
                    checkpoint('old_carrier_unassignment_failed',status=response.status_code)
                    raise RuntimeError('New routing is configured, but old carrier unassignment failed')
            checkpoint('old_carrier_routing_retired',ownership_released=False)
            response = await http.get(vobiz._account_path('/numbers'),headers=vobiz._headers())
            response.raise_for_status()
            summary = [{k:r.get(k) for k in ['e164','status','trunk_group_id','application_id','is_blocked']}
                       for r in response.json()['items'] if r.get('e164') in (TARGET,OLD)]
            checkpoint('final_carrier_readback',numbers=summary)
    finally:
        await lk.aclose()
        await db.close_pool()

if __name__ == '__main__':
    asyncio.run(main())
