"""Durable voice usage ledger. No customer records or business actions."""
import json
import os
import uuid
from datetime import UTC,datetime
import db


async def with_native_rate_snapshot(usage: dict, pool) -> dict:
    if usage.get('provider') != 'google' or usage.get('rateSnapshot'):
        return usage
    result=dict(usage)
    try:
        rows=await pool.fetch('''SELECT provider,sku,kind,"rateUsd",last_verified_at
            FROM provider_rates WHERE provider='google' AND sku=ANY($1::text[])''',
            [usage['model']+'/text',usage['model']+'/audio'])
        speech = usage.get('speechInput') or {}
        if speech.get('provider') and speech.get('model'):
            rows = list(rows) + list(await pool.fetch('''SELECT provider,sku,kind,"rateUsd",last_verified_at
                FROM provider_rates WHERE provider=$1 AND sku=$2 AND kind='STT_MINUTE' ''',
                speech['provider'],speech['model']))
        result['rateSnapshot']={'version':1,'capturedAt':datetime.now(UTC).isoformat(),
            'rows':[{'provider':r['provider'],'sku':r['sku'],'kind':str(r['kind']),
                     'rateUsd':float(r['rateUsd']),
                     'verifiedAt':r['last_verified_at'].isoformat() if r['last_verified_at'] else None} for r in rows]}
    except Exception:
        result['rateSnapshotStatus']='unavailable'
    return result


def demo_call_id(room: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL,'jilljill-demo:'+room))


async def start_demo_call(profile: dict, room: str) -> None:
    from native_voice import runtime_settings
    settings=runtime_settings(profile)
    pool = await db.get_pool()
    await pool.execute('''INSERT INTO calls (id,"organizationId","assistantId","livekitRoomName",
        "fromNumber","toNumber",direction,status,was_booked,"startedAt",metadata,"createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,'demo-user','browser-demo','INBOUND','QUEUED',false,now(),$5::jsonb,now(),now())
        ON CONFLICT(id) DO NOTHING''',demo_call_id(room),profile.get('organization_id') or os.getenv('DEFAULT_ORG_ID','default-org'),
        profile['id'],room,json.dumps({'voiceUsage':{'mode':'demo','complete':False},'demoSession':True,'demoEngine':settings.engine if settings else 'gpt-live'}))


async def finish_demo_call(room: str, status: str) -> None:
    if status not in ('IN_PROGRESS','COMPLETED','FAILED','CANCELED'):
        raise ValueError('Invalid demo status.')
    pool = await db.get_pool()
    await pool.execute('''UPDATE calls SET status=$2::"CallStatus",
        "answeredAt"=CASE WHEN $2='IN_PROGRESS' THEN COALESCE("answeredAt",now()) ELSE "answeredAt" END,
        "endedAt"=CASE WHEN $2 IN ('COMPLETED','FAILED','CANCELED') THEN now() ELSE "endedAt" END,
        "updatedAt"=now() WHERE id=$1 AND NOT ($2='COMPLETED' AND status IN ('FAILED','CANCELED'))''',demo_call_id(room),status)


async def save_voice_usage(call_id: str, usage: dict) -> None:
    pool = await db.get_pool()
    usage=await with_native_rate_snapshot(usage,pool)
    await pool.execute('''UPDATE calls SET metadata=COALESCE(metadata,'{}'::jsonb)||$2::jsonb,
        "updatedAt"=now() WHERE id=$1''',call_id,json.dumps({'voiceUsage':usage}))


async def record_demo_usage(profile: dict, room: str, duration: int, usage: dict) -> None:
    pool = await db.get_pool()
    usage=await with_native_rate_snapshot(usage,pool)
    ident = demo_call_id(room)
    tokens = usage['tokens']
    await pool.execute('''INSERT INTO calls (id,"organizationId","assistantId","fromNumber","toNumber",direction,status,
         outcome,"durationSeconds",was_booked,llm_input_tokens,llm_output_tokens,llm_provider_used,llm_sku_used,metadata,"livekitRoomName","endedAt","createdAt","updatedAt")
         VALUES ($1,$2,$3,'demo-user','browser-demo','INBOUND','COMPLETED','COMPLETED',$4,false,$5,$6,'google',$7,$8::jsonb,$8::jsonb->>'demoRoom',now(),now(),now())
         ON CONFLICT (id) DO UPDATE SET "durationSeconds"=EXCLUDED."durationSeconds",metadata=COALESCE(calls.metadata,'{}'::jsonb)||EXCLUDED.metadata,
             status=CASE WHEN calls.status IN ('FAILED','CANCELED') THEN calls.status ELSE 'COMPLETED'::"CallStatus" END,
             outcome=CASE WHEN calls.status='FAILED' THEN 'FAILED'::"CallOutcome" ELSE EXCLUDED.outcome END,
             "endedAt"=now(),
             "livekitRoomName"=COALESCE(calls."livekitRoomName",EXCLUDED."livekitRoomName"),
             llm_input_tokens=EXCLUDED.llm_input_tokens,llm_output_tokens=EXCLUDED.llm_output_tokens,
             llm_provider_used=EXCLUDED.llm_provider_used,llm_sku_used=EXCLUDED.llm_sku_used,"updatedAt"=now()''',
         ident,profile.get('organization_id') or os.getenv('DEFAULT_ORG_ID','default-org'),profile['id'],duration,
         tokens['inputAudio']+tokens['inputText'],tokens['outputAudio']+tokens['outputText'],usage['model'],json.dumps({'voiceUsage':usage,'demoRoom':room}))


async def save_demo_artifacts(room: str, messages: list[dict], recording_key=None, duration=None):
    """Attach real demo evidence to its existing call; idempotent, no business writes."""
    import redactor
    pool=await db.get_pool();ident=demo_call_id(room)
    async with pool.acquire() as conn:
        async with conn.transaction():
            row=await conn.fetchrow('''SELECT id FROM calls WHERE id=$1 AND "livekitRoomName"=$2
                AND "fromNumber"='demo-user' FOR UPDATE''',ident,room)
            if not row:
                raise ValueError('Demo call not found')
            contains_pii=False
            for item in messages:
                text=str(item.get('content') or '').split('[APPLICATION CALL MEMORY',1)[0].rstrip()
                if item.get('role') not in ('user','assistant') or not text:
                    continue
                safe,has_pii=redactor.redact(text)
                contains_pii=contains_pii or has_pii
                timestamp=item.get('timestamp') or datetime.now(UTC).timestamp()
                if isinstance(timestamp,(float,int)):
                    timestamp=datetime.fromtimestamp(timestamp,UTC).replace(tzinfo=None)
                elif isinstance(timestamp,datetime):
                    timestamp=timestamp.astimezone(UTC).replace(tzinfo=None) if timestamp.tzinfo else timestamp
                item_id=str(uuid.uuid5(uuid.NAMESPACE_URL,ident+':transcript:'+str(item['id'])))
                await conn.execute('''INSERT INTO transcript_messages
                    (id,"callId",role,content,"contentRedacted","hasPii",timestamp)
                    VALUES ($1,$2,$3::"TranscriptRole",$4,$4,$5,$6)
                    ON CONFLICT(id) DO UPDATE SET content=EXCLUDED.content,
                        "contentRedacted"=EXCLUDED."contentRedacted","hasPii"=EXCLUDED."hasPii"''',
                    item_id,ident,item['role'].upper(),safe,has_pii,timestamp)
            if contains_pii:
                await conn.execute('UPDATE calls SET "transcriptHasPii"=true WHERE id=$1',ident)
            if recording_key:
                from recorder import resolve_recording_path
                if not resolve_recording_path(recording_key):
                    raise ValueError('Recording file unavailable')
                await conn.execute('''UPDATE calls SET "recordingObjectKey"=$2,"recordingStatus"='READY',
                    "recordingSource"='LOCAL',"recordingDurationSeconds"=$3,"updatedAt"=now() WHERE id=$1''',
                    ident,recording_key,duration)
