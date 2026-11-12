"""Per-assistant identity; a selected assistant never inherits a platform brand."""
import json


def business_name_for_profile(profile: dict, legacy_default: str = '') -> str:
    metadata = profile.get('metadata') or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except (ValueError, TypeError):
            metadata = {}
    value = metadata.get('businessName') if isinstance(metadata, dict) else None
    if isinstance(value, str) and value.strip():
        return value.strip()
    # Older assistants may specify the business explicitly in their saved
    # prompt. Do not inject an unrelated deployment-wide brand into that text.
    if profile.get('_profile_source') == 'assistant' or profile.get('system_prompt'):
        return 'the business described in the saved assistant instructions'
    return legacy_default or 'our company'
