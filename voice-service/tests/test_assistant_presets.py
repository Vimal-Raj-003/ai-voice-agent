from assistant_presets import ROLES, role_prompt, greeting
from prompts import build_prompt
import pytest


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("direction", ["INBOUND", "OUTBOUND"])
def test_role_prompts_preserve_identity_tools_and_real_action_confirmation(role, direction):
    prompt = role_prompt(role, direction)
    assembled = build_prompt(
        custom_prompt=prompt,
        business_name="Synthetic business",
        native_audio=True,
        call_direction=direction,
    )
    assert "VIMS" not in assembled
    assert "Synthetic business" in assembled
    assert "matching tool returns verified success" in assembled
    assert "YYYY-MM-DD" in assembled and "HH:MM" in assembled
    assert "English, Tamil, Tanglish, Telugu, Kannada, Malayalam or Hindi" in assembled
    assert 'Respect "do not book yet"' in assembled
    assert "{business_name}" not in assembled
    if role == "ivr":
        assert "press-one" in assembled
    if role in ("clinic", "hospital", "vasan"):
        assert "prescrib" in assembled
    if role == "academy":
        assert "parent or guardian" in assembled
    g = greeting(role)
    assert "{business_name}" in g
