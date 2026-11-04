"""Restart only the verified local WSL worker, preserving its private environment."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request
import psutil

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT/'output/verify'


def worker_status():
    with urllib.request.urlopen('http://127.0.0.1:8081/worker', timeout=3) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--outbound-number')
    parser.add_argument('--label', default='conversation-v11')
    parser.add_argument('--business-mode', choices=['preserve', 'test', 'live'], default='preserve')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9.-]+', args.label):
        raise RuntimeError('Restart artifact label must be a simple filename prefix')
    old = psutil.Process(args.pid)
    command = old.cmdline()
    if (Path(old.cwd()).resolve() != ROOT or command[-2:] != ['agent.py', 'start']
            or any('forkserver' in part for part in command)):
        raise RuntimeError('Refusing to stop a process that is not this checkout worker root')
    status = worker_status()
    if status.get('active_jobs', 0):
        raise RuntimeError('An inbound call is active. Existing worker was left running.')
    environment = old.environ()  # Preserve private values in memory; never log them.
    # /worker does not report active_jobs in every SDK release. Refuse to
    # restart during an occupied cloud room rather than treating omission as 0.
    import asyncio
    from dotenv import load_dotenv
    load_dotenv(ROOT/'.env')
    from livekit import api
    async def assert_no_call():
        client = api.LiveKitAPI()
        try:
            rooms = (await client.room.list_rooms(api.ListRoomsRequest())).rooms
            if any(room.num_participants for room in rooms):
                raise RuntimeError('An occupied LiveKit room exists; worker left running')
        finally:
            await client.aclose()
    asyncio.run(assert_no_call())
    if args.outbound_number:
        from dotenv import dotenv_values
        if (not re.fullmatch(r'\+\d{8,15}', args.outbound_number)
                or dotenv_values(ROOT/'.env').get('VOBIZ_OUTBOUND_NUMBER') != args.outbound_number):
            raise RuntimeError('Requested nonsecret outbound number does not match the reviewed local configuration')
        environment['VOBIZ_OUTBOUND_NUMBER'] = args.outbound_number
    if args.business_mode != 'preserve':
        environment['VOICE_TEST_READ_ONLY'] = 'true' if args.business_mode == 'test' else 'false'
    environment['VOICE_PREEMPTIVE_GENERATION'] = 'true'
    environment['VOICE_STRICT_LANGUAGE_LOCK'] = 'true'
    record = {'old_pid': args.pid, 'active_jobs_before_restart': 0,
        'source_hashes': {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                          for name in ['agent.py', 'callstate.py', 'tools.py', 'lang.py', 'config.py', 'prompts.py', 'assistant_prompts.py',
                                       'conversation_style.py', 'contact_corrections.py', 'call_tasks.py',
                                       'assistant_controls.py', 'turn_policy.py', 'llm_routing.py', 'db.py', 'knowledge.py']},
        'public_flags': {key: environment[key] for key in environment if key.startswith('VOICE_')
                         and not any(word in key for word in ['KEY', 'SECRET', 'TOKEN', 'URL'])}}
    old.send_signal(signal.SIGTERM)
    try:
        old.wait(timeout=30)
    except psutil.TimeoutExpired:
        raise RuntimeError('Old worker is still draining; no duplicate worker was started.')
    log = DEST/f'{args.label}-worker.log'
    log_offset = log.stat().st_size if log.exists() else 0
    with log.open('ab', buffering=0) as output:
        process = subprocess.Popen([sys.executable, '-u', '-X', 'utf8', 'agent.py', 'start'],
            cwd=ROOT, env=environment, stdin=subprocess.DEVNULL, stdout=output,
            stderr=subprocess.STDOUT, start_new_session=True)
    record['new_pid'] = process.pid
    record['log'] = str(log.relative_to(ROOT))
    (DEST/f'{args.label}-restart.json').write_text(json.dumps(record, indent=2))
    print(json.dumps({'old_pid': args.pid, 'new_pid': process.pid}), flush=True)
    deadline = time.monotonic()+45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'New worker exited with code {process.returncode}; inspect startup log')
        try:
            status = worker_status()
            with log.open('rb') as stream:
                stream.seek(log_offset)
                text = stream.read().decode(errors='replace')
            if 'registered worker' in text and status.get('agent_name') == 'voice-agent':
                record['worker_status'] = status
                record['registered'] = True
                (DEST/f'{args.label}-restart.json').write_text(json.dumps(record, indent=2))
                print(json.dumps({'registered': True, 'status': status}), flush=True)
                return
        except (OSError, ValueError):
            pass
        time.sleep(.5)
    raise RuntimeError('Registration/health not verified within 45s; inspect worker log, do not start a duplicate')


if __name__ == '__main__':
    main()
