"""Read-only local audit. Prints hashes, IDs and timings, never prompts or PII."""
from __future__ import annotations
import asyncio
import importlib.metadata
import json
from pathlib import Path
import statistics
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / '.env')
import db
from prompts import build_prompt, prompt_fingerprint


async def main():
    report = {'sdk': importlib.metadata.version('livekit-agents'), 'read_only': True}
    pool = await db.get_pool()
    try:
        routes = await pool.fetch('SELECT id, "assistantId" FROM phone_numbers WHERE "isActive" = true')
        report['inbound_routes'] = [{'route_id': row['id'], 'assistant_id': row['assistantId']} for row in routes]
        profiles = []
        for assistant_id in sorted({row['assistantId'] for row in routes if row['assistantId']}):
            profile = await db.get_assistant_as_profile(assistant_id)
            if not profile:
                profiles.append({'assistant_id': assistant_id, 'resolved': False})
                continue
            diagnostics = {}
            prompt = profile.get('system_prompt') or ''
            build_prompt(custom_prompt=prompt, diagnostics=diagnostics)
            profiles.append({'assistant_id': assistant_id, 'resolved': True,
                             'source': profile.get('_profile_source'),
                             'saved_prompt_sha': prompt_fingerprint(prompt), 'prompt_chars': len(prompt),
                             'saved_prompt_first': diagnostics['saved_prompt_first_verbatim'],
                             'llm_provider': profile.get('llm_provider'), 'model': profile.get('model'),
                             'stt_provider': profile.get('stt_provider'), 'tts_provider': profile.get('tts_provider'),
                             'min_pause_ms': profile.get('min_pause_ms')})
        report['profiles'] = profiles
        events = await pool.fetch("SELECT message, detail FROM error_logs WHERE timestamp > NOW() - INTERVAL '72 hours' AND message IN ('llm_response_received', 'tts_metrics', 'turn_latency_breakdown', 'call_task_finished', 'task_ack_first_audio', 'reply_first_voice', 'reply_answer_voice') ORDER BY timestamp DESC LIMIT 250")
        fields = ('ttft_ms', 'speech_end_to_stt_final_ms', 'stt_final_to_llm_start_ms',
                  'llm_start_to_first_tok_ms', 'first_tok_to_first_audio_ms',
                  'speech_end_to_first_audio_ms', 'ttfb_ms', 'duration_ms', 'request_to_first_audio_ms',
                  'speech_end_to_first_voice_ms', 'speech_end_to_answer_voice_ms', 'first_voice_to_answer_voice_ms')
        samples = {}
        timing_proof = {'first_voice_samples': 0, 'answer_voice_samples': 0, 'target_met': 0, 'target_missed': 0,
                        'note': 'Room playback measures publication, not handset acoustic latency.'}
        for row in events:
            try:
                detail = json.loads(row['detail'] or '{}')
            except (ValueError, TypeError):
                continue
            if row['message'] == 'reply_first_voice':
                timing_proof['first_voice_samples'] += 1
                if detail.get('target_met') is True:
                    timing_proof['target_met'] += 1
                elif detail.get('target_met') is False:
                    timing_proof['target_missed'] += 1
            elif row['message'] == 'reply_answer_voice':
                timing_proof['answer_voice_samples'] += 1
            for field in fields:
                value = detail.get(field)
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    samples.setdefault(row['message'] + '.' + field, []).append(value)
        report['historical_timings_ms'] = {key: {'n': len(values), 'p50': round(statistics.median(values), 1),
                                                'min': min(values), 'max': max(values)} for key, values in samples.items()}
        report['separate_voice_timing_proof'] = timing_proof
        print(json.dumps(report, indent=2))
    finally:
        await db.close_pool()


if __name__ == '__main__':
    asyncio.run(main())
