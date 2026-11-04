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
