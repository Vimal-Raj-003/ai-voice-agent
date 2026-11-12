"""Server-owned selection for one experimental browser room; no SDK imports."""
from __future__ import annotations

from dataclasses import dataclass
import os
import re
from typing import Mapping


class ExperimentRejected(ValueError):
    pass


@dataclass(frozen=True)
class TestSelection:
    room: str
    assistant_id: str
    direction: str


def configured_test(env: Mapping[str, str] | None = None) -> TestSelection | None:
    env = os.environ if env is None else env
    if env.get('GPT_LIVE_EXPERIMENT_ENABLED', 'false').strip().lower() != 'true':
        return None
    room = env.get('GPT_LIVE_TEST_ROOM', '').strip()
    assistant = env.get('GPT_LIVE_TEST_ASSISTANT_ID', '').strip()
    direction = env.get('GPT_LIVE_TEST_DIRECTION', 'INBOUND').strip().upper()
    if not re.fullmatch(r'demo-gpt-live-[A-Za-z0-9_-]{1,80}', room) or not assistant:
        raise ExperimentRejected('Set GPT_LIVE_TEST_ROOM=demo-gpt-live-<unique-id> and GPT_LIVE_TEST_ASSISTANT_ID.')
    if direction not in ('INBOUND', 'OUTBOUND'):
        raise ExperimentRejected('GPT_LIVE_TEST_DIRECTION must be INBOUND or OUTBOUND.')
    return TestSelection(room, assistant, direction)


def select_test(room: str, job_metadata: dict, env: Mapping[str, str] | None = None) -> TestSelection | None:
    # Call only with dispatch/job metadata, never room/participant metadata.
    if job_metadata.get('experimental_voice_engine') != 'gpt-live':
        return None
    selected = configured_test(env)
    room_allowed = selected is not None and (room == selected.room or (
        job_metadata.get('test_room_base') == selected.room
        and re.fullmatch(re.escape(selected.room) + r'-[0-9a-f]{16}', room) is not None))
    verified_selection = (job_metadata.get('browser_assistant_selection') is True
                          and bool(job_metadata.get('organization_id'))
                          and bool(job_metadata.get('agent_profile_id')))
    if (selected is None or not room_allowed
            or (job_metadata.get('agent_profile_id') != selected.assistant_id and not verified_selection)
            or job_metadata.get('phone_number') != 'demo'
            or job_metadata.get('is_demo') is not True
            or job_metadata.get('campaign_id') or job_metadata.get('target_id')
            or job_metadata.get('test_direction') != selected.direction):
        raise ExperimentRejected('GPT-Live dispatch is not the server-selected browser test session.')
    return TestSelection(room, job_metadata['agent_profile_id'], selected.direction)


def test_metadata(selected: TestSelection, room_base: str | None = None) -> dict:
    result = dict(phone_number='demo', is_demo=True, experimental_voice_engine='gpt-live',
                agent_profile_id=selected.assistant_id, test_direction=selected.direction)
    if room_base is not None:
        result['test_room_base'] = room_base
    return result


def configured_voice(env: Mapping[str, str] | None = None, *, browser_test: bool = False) -> str | dict[str, str]:
    env = os.environ if env is None else env
    voice_id = ((env.get('GPT_LIVE_TEST_VOICE_ID', '').strip() if browser_test else '')
                or env.get('GPT_LIVE_VOICE_ID', '').strip())
    if voice_id:
        if not re.fullmatch(r'voice_[A-Za-z0-9_-]{1,160}', voice_id):
            raise ExperimentRejected('GPT-Live custom voice must be a saved voice_ identifier.')
        return {'id': voice_id}
    voice = env.get('GPT_LIVE_VOICE', 'marin').strip().lower()
    supported = {'marin', 'cedar', 'quartz', 'ripple', 'vesper', 'willow', 'stone',
                 'gleam', 'meridian', 'bossa', 'tempo', 'beacon', 'delta', 'cinder',
                 'nuri', 'juni', 'flitz', 'brise', 'sillage', 'nira', 'harema', 'shida', 'noeul'}
    if voice not in supported:
        raise ExperimentRejected('GPT_LIVE_VOICE must be a supported named GPT-Live voice.')
    return voice


def phone_enabled(assistant_id: str | None, phone: str, env: Mapping[str, str] | None = None) -> bool:
    """Select after existing DID/campaign assistant resolution, never from caller attributes."""
    env = os.environ if env is None else env
    if env.get('GPT_LIVE_PHONE_ENABLED', 'false').strip().lower() != 'true':
        return False
    if not phone or phone in ('demo', 'unknown'):
        return False
    allowed = {x.strip() for x in env.get('GPT_LIVE_PHONE_ASSISTANT_IDS', '').split(',') if x.strip()}
    return bool(assistant_id and assistant_id in allowed)
