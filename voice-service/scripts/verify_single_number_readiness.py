"""Check saved provider read-backs and current local worker; never place calls."""
import json
from pathlib import Path
import urllib.request
import psutil
import argparse
import re
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/verify'
TARGET = '+918065481576'
OLD = '+918065480036'
audit = json.loads((OUT / 'single-number-audit.json').read_text())
migration = json.loads((OUT / 'single-number-migration.json').read_text())
parser = argparse.ArgumentParser()
parser.add_argument('--restart-label', default='conversation-v11')
parser.add_argument('--expect-business-mode', choices=['test', 'live'], default='test')
args = parser.parse_args()
if not re.fullmatch(r'[a-zA-Z0-9.-]+', args.restart_label):
    raise ValueError('Expected simple restart artifact label')
restart = json.loads((OUT / f'{args.restart_label}-restart.json').read_text())
checks = {}
settings = {row['key']: row['value'] for row in audit['settings']}
checks['outbound_environment_and_setting'] = (
    audit['environment']['VOBIZ_OUTBOUND_NUMBER'] == settings['VOBIZ_OUTBOUND_NUMBER'] == TARGET)
active = [row for row in audit['phone_numbers'] if row['isActive']]
checks['only_requested_number_active'] = len(active) == 1 and active[0]['number'] == TARGET
checks['same_assistant'] = bool(active) and active[0]['assistantId'] == 'cmuv65lxx0013v7f4thzf2qtv'
inbound = next(row for row in audit['inbound_trunks'] if row['id'] == 'ST_mKsscodyJixr')
outbound = next(row for row in audit['outbound_trunks'] if row['id'] == 'ST_reLomjZWYvH3')
checks['inbound_only_target_aliases'] = set(inbound['numbers']) == {
    TARGET, '918065481576', '08065481576', '8065481576'}
checks['outbound_only_target'] = outbound['numbers'] == [TARGET]
checks['settings_trunks_match_livekit'] = (
    settings['INBOUND_TRUNK_ID'] == inbound['id'] and settings['OUTBOUND_TRUNK_ID'] == outbound['id'])
checks['dispatch_preserved'] = any(
    inbound['id'] in row['trunk_ids'] and 'voice-agent' in row['agent_names'] for row in audit['dispatch'])
carrier = next(step['numbers'] for step in migration['steps'] if step['step'] == 'final_carrier_readback')
new = next(row for row in carrier if row['e164'] == TARGET)
old = next(row for row in carrier if row['e164'] == OLD)
checks['carrier_target_sip_assigned'] = (
    new['trunk_group_id'] == 'dcb49c8b-2e62-436c-b2db-bd41db884e40'
    and new['application_id'] is None and not new['is_blocked'])
checks['carrier_old_unassigned'] = old['trunk_group_id'] is None and old['application_id'] is None
processes = []
for process in psutil.process_iter():
    try:
        if process.cmdline()[-2:] == ['agent.py', 'start']:
            environment = process.environ()
            number = environment.get('VOBIZ_OUTBOUND_NUMBER')
            number_source = 'initial_environment'
            dotenv_path = Path(process.cwd()) / '.env'
            # Linux /proc exposes the initial environment, not values loaded
            # by agent.py's absolute load_dotenv call after Python started.
            if (number is None and Path(process.cwd()).resolve() == ROOT
                    and dotenv_path.exists() and dotenv_path.stat().st_mtime <= process.create_time()):
                number = dotenv_values(dotenv_path).get('VOBIZ_OUTBOUND_NUMBER')
                number_source = 'unchanged_checkout_dotenv_at_start'
            processes.append({'pid': process.pid, 'parent': process.ppid(),
                            'outbound_number': number, 'outbound_number_source': number_source,
                            'read_only': environment.get('VOICE_TEST_READ_ONLY')})
    except (psutil.AccessDenied, psutil.NoSuchProcess):
        pass
candidate_ids = {row['pid'] for row in processes}
# The SDK prewarm/forkserver children inherit the worker command line.
# Count roots rather than misidentifying its idle child pool as duplicates.
workers = [row for row in processes if row['parent'] not in candidate_ids]
checks['one_expected_worker'] = len(workers) == 1 and workers[0]['pid'] == restart['new_pid']
expected_read_only = 'true' if args.expect_business_mode == 'test' else 'false'
checks['worker_number_and_expected_mode'] = bool(workers) and all(
    row['outbound_number'] == TARGET and row['read_only'] == expected_read_only for row in workers)
with urllib.request.urlopen('http://127.0.0.1:8081/worker', timeout=10) as response:
    health = json.load(response)
    checks['worker_healthy'] = response.status == 200 and health['agent_name'] == 'voice-agent'
checks['fresh_registration'] = restart['registered'] is True
report = {'checks': checks, 'passed': all(checks.values()), 'workers': workers, 'worker_health': health,
          'expected_business_mode': args.expect_business_mode,
          'provider_readback': 'Saved after-mutation read-back; no carrier API mutation in this check.',
          'phone_call_tested': False, 'outbound_call_tested': False, 'ownership_released': False}
filename = ('single-number-readiness.json' if args.restart_label == 'conversation-v11'
            else f'{args.restart_label}-number-readiness.json')
(OUT / filename).write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
raise SystemExit(0 if report['passed'] else 1)
