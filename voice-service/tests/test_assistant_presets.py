from assistant_presets import ROLES,role_prompt,greeting
from prompts import build_prompt
import pytest

@pytest.mark.parametrize('role',ROLES)
@pytest.mark.parametrize('direction',['INBOUND','OUTBOUND'])
def test_role_prompts_preserve_identity_tools_and_real_action_confirmation(role,direction):
    prompt=role_prompt(role,direction)
    assembled=build_prompt(custom_prompt=prompt,business_name='Synthetic business',native_audio=True,call_direction=direction)
    assert 'VIMS' not in assembled
    assert 'matching tool returns verified success' in assembled
    assert 'YYYY-MM-DD' in assembled and 'HH:MM' in assembled
    assert 'Tamil, Tanglish, English, Telugu, Malayalam or Hindi' in assembled
    assert 'Respect "do not book yet"' in assembled
    assert ROLES[role][3] in assembled
    assert 'press-one' in assembled if role=='ivr' else True
    assert 'prescrib' in assembled if role in ('clinic','vasan') else True
    assert greeting(role)
