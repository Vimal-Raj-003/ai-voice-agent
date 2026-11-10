"""Select a saved direction prompt without changing the voice pipeline."""
from __future__ import annotations
import json
import re
from typing import Any


def outbound_prompt(metadata: Any) -> str | None:
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            return None
    if not isinstance(metadata, dict):
        return None
    prompts = metadata.get('directionPrompts')
    value = prompts.get('outbound') if isinstance(prompts, dict) else None
    return value if isinstance(value, str) else None


def profile_for_direction(profile: dict, direction: str) -> dict:
    direction = direction.upper()
    selected = profile.get('system_prompt')
    if direction == 'OUTBOUND':
        override = profile.get('outbound_system_prompt')
        if isinstance(override, str) and override.strip():
            selected = override
    return {**profile, 'system_prompt': selected, 'prompt_direction': direction}


def greeting_for_direction(profile: dict, greeting: str, business_name: str) -> str:
    """The page's saved first message is authoritative in either direction.

    Direction-specific purpose belongs to the saved system prompt, not a
    hidden replacement of the operator's greeting.
    """
    return greeting


def native_voice_instructions(system_prompt: str, direction: str, *, browser_test: bool = False) -> str:
    """Saved behaviour stays intact; append only transport and delegation facts."""
    direction_fact = ('INBOUND: the caller called us; this is not an outbound call.' if direction == 'INBOUND'
                      else 'OUTBOUND: the business initiated this call; use the saved outbound purpose and verified lead context.')
    limitations = ('This is a browser test with sandbox tools: no real booking, message or transfer can occur. '
                    'Disclose that once at the opening and when a requested action is simulated.' if browser_test else
                    'Use only the configured live tools and their verified results for external actions.')
    return system_prompt + f'''
[NATIVE AUDIO TRANSPORT]
{direction_fact}
{limitations}
Follow the saved assistant instructions above for identity, languages, business scope, emotional responses,
appointment intake and human transfer. Do not replace them with a generic receptionist persona.
Backchannel policy: Follow the saved listening style. Never add automatic checking/preparing announcements.
Interruption policy: Keep listening through pauses; when interrupted, stop obsolete speech and address the
newest request. Submitted operations may still complete; never claim speech cancellation undid them.
Delegation policy: Generate <|SpawnThinking|> for business knowledge, remembered details, corrections,
availability, bookings, email or other actions, including human transfer. The existing selected backend
and tools execute them. Wait quietly for verified results, and speak briefly without inventing facts.
Greetings and simple social acknowledgements can follow the saved prompt directly, without delegation.
Wait for the connected-call opening instruction before greeting; introduce yourself only once.
'''
