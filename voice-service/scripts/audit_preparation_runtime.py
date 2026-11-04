"""Read-only runtime/route audit. Never print credentials, prompts or caller data."""
from __future__ import annotations
import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import urllib.request
import argparse
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT/'.env')
import psutil
import agent
import db
import config
import provider_credentials
from turn_policy import voice_turn_options
from livekit import api


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='output/verify/preparation-runtime.json')
    args = parser.parse_args()
    flags = ('VOICE_PAUSE_FLOOR_MS', 'VOICE_PREEMPTIVE_GENERATION', 'MIN_ENDPOINTING_DELAY',
             'DEAD_AIR_ACK', 'VOICE_TEST_READ_ONLY', 'VOICE_USEFUL_TEXT_TIMEOUT_S', 'VOICE_STREAM_IDLE_TIMEOUT_S',
             'VOICE_STRICT_LANGUAGE_LOCK', 'SARVAM_MIN_BUFFER_SIZE', 'SARVAM_MAX_CHUNK_LENGTH')
    report = dict(sdk=importlib.metadata.version('livekit-agents'), next_build=agent.AGENT_BUILD,
                  disk_flags={key: os.getenv(key, '<code default>') for key in flags},
                  running_workers=[], routes=[], profiles=[], business_sandbox_verified=False)
    report['email_transport_configuration_present'] = bool(os.getenv('RESEND_API_KEY') or (
        os.getenv('SMTP_HOST') and os.getenv('SMTP_USER') and
        (os.getenv('SMTP_PASSWORD') or os.getenv('SMTP_PASS'))))
    report['email_delivery_tested'] = False
    for process in psutil.process_iter():
        try:
            cmd = process.cmdline()
            if process.name() == 'python' and cmd[-2:] == ['agent.py', 'start'] and not any('forkserver' in x for x in cmd):
                initial = process.environ()
                report['running_workers'].append(dict(pid=process.pid, parent=process.ppid(), cwd=process.cwd(),
                    initial_flags={key: initial.get(key, '<not in initial environment>') for key in flags}))
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass
    report['read_only_test_mode'] = dict(
        all_worker_roots_enabled=bool(report['running_workers']) and all(
            row['initial_flags'].get('VOICE_TEST_READ_ONLY') == 'true' for row in report['running_workers']),
        note='Process configuration preflight; each inbound call logs its actual exposed tool set.')
    pool = await db.get_pool()
    try:
        routes = await pool.fetch('SELECT id, number, "assistantId", label FROM phone_numbers WHERE "isActive" = true')
        report['routes'] = [dict(row) for row in routes]
        for assistant_id in sorted({r['assistantId'] for r in routes if r['assistantId']}):
            profile = await db.get_assistant_as_profile(assistant_id)
            keys = await provider_credentials.load_for_org(profile.get('organization_id'))
            session = agent._build_session(tools=[], system_prompt='Runtime construction audit only; no call.',
                                           profile=profile, tenant_keys=keys)
            report['profiles'].append(dict(assistant_id=assistant_id,
                llm_provider=profile.get('llm_provider'), model=profile.get('model'),
                stt_provider=profile.get('stt_provider'), stt_model=profile.get('stt_model') or config.SARVAM_STT_MODEL,
                tts_provider=profile.get('tts_provider'), tts_model=config.SARVAM_MODEL,
                voice=profile.get('voice'), saved_min_pause_ms=profile.get('min_pause_ms'),
                saved_sensitivity=profile.get('end_of_speech_sensitivity'),
                saved_interruption_ms=profile.get('interruption_threshold_ms'),
                saved_confidence_threshold_pct=profile.get('confidence_threshold_pct'),
                confidence_probability_available=False if profile.get('stt_provider') == 'sarvam' else 'provider-dependent',
                saved_max_duration_s=profile.get('max_duration_seconds'),
                constructed_silence_timeout_s=session.options.user_away_timeout,
                saved_hallucination_guard=profile.get('hallucination_guard'),
                saved_temperature=profile.get('temperature'), saved_max_tokens=profile.get('max_tokens'),
                sarvam_min_buffer_size=config.SARVAM_MIN_BUFFER_SIZE,
                sarvam_max_chunk_length=config.SARVAM_MAX_CHUNK_LENGTH,
                recording_enabled=profile.get('recording_enabled'),
                constructed_endpointing=session.options.endpointing,
                constructed_preemptive=session.options.preemptive_generation,
                constructed_interruption=session.options.interruption,
                requested_turn_detection=voice_turn_options(profile, has_vad=session.vad is not None)['turn_detection'],
                has_vad=session.vad is not None,
                credential_sources={
                    # OpenRouter is resolved directly by llm_routing, outside
                    # the Sarvam/BYOK provider registry. Report presence only.
                    'openrouter': 'server' if os.getenv('OPENROUTER_API_KEY') else 'missing',
                    'sarvam': provider_credentials.resolve('sarvam', 'STT', keys)[1]}))
            await session.aclose()
        builds = await pool.fetch("SELECT timestamp, detail FROM error_logs WHERE message = 'VOICE_WORKER_BUILD' ORDER BY timestamp DESC LIMIT 5")
        report['recent_build_events'] = []
        for row in builds:
            try:
                detail = json.loads(row['detail'] or '{}')
            except (ValueError, TypeError):
                continue
            report['recent_build_events'].append(dict(timestamp=str(row['timestamp']),
                **{k: detail[k] for k in ('build', 'phase') if k in detail}))
    finally:
        await db.close_pool()
    client = api.LiveKitAPI()
    try:
        trunks = await client.sip.list_sip_inbound_trunk(api.ListSIPInboundTrunkRequest())
        rules = await client.sip.list_sip_dispatch_rule(api.ListSIPDispatchRuleRequest())
        report['cloud_inbound_trunks'] = [dict(id=t.sip_trunk_id, numbers=list(t.numbers)) for t in trunks.items]
        report['cloud_dispatch_rules'] = [dict(id=r.sip_dispatch_rule_id, trunk_ids=list(r.trunk_ids),
            agent_names=[a.agent_name for a in r.room_config.agents]) for r in rules.items]
    except Exception as exc:
        report['cloud_route_check_error'] = type(exc).__name__
    finally:
        await client.aclose()
    report['local_services'] = {}
    for name, url in [('api', 'http://127.0.0.1:8000/health'),
                      ('worker', 'http://127.0.0.1:8081/worker')]:
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                payload = json.load(response)
                report['local_services'][name] = dict(http_status=response.status,
                    **{k: payload[k] for k in ('worker_id', 'agent_name', 'status', 'service') if k in payload})
                if 'active_jobs' in payload:
                    report['local_services'][name]['active_job_count'] = payload['active_jobs']
                elif name == 'worker':
                    # Protobuf JSON omits zero-valued scalar fields.
                    report['local_services'][name]['active_job_count'] = 0
        except Exception as exc:
            report['local_services'][name] = dict(error=type(exc).__name__)
    try:
        with urllib.request.urlopen('http://127.0.0.1:8081/', timeout=5) as response:
            report['worker_health'] = dict(http_status=response.status, body=response.read().decode())
    except Exception as exc:
        report['worker_health'] = dict(error=type(exc).__name__)
    (ROOT/args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
