from assistant_identity import business_name_for_profile
from prompts import build_prompt
import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest


def test_two_assistants_do_not_inherit_global_brand_or_each_others_instructions():
    for brand in ('Vasan Eye Care', 'Another Clinic'):
        profile={'_profile_source':'assistant','metadata':{'businessName':brand},
                 'system_prompt':'You are Priya for {business_name}. Answer from verified eye care knowledge.'}
        business=business_name_for_profile(profile,'VIMS Enterprises')
        prompt=build_prompt(custom_prompt=profile['system_prompt'],business_name=business,native_audio=True)
        assert brand in prompt and 'VIMS' not in prompt
        assert ('Another Clinic' if brand=='Vasan Eye Care' else 'Vasan Eye Care') not in prompt


def test_unconfigured_custom_identity_never_injects_deployment_brand():
    profile={'system_prompt':'You are Priya for Vasan Eye Care.'}
    assert 'VIMS' not in business_name_for_profile(profile,'VIMS Enterprises')
    assert business_name_for_profile({},'VIMS Enterprises')=='VIMS Enterprises'


async def test_missing_selected_assistant_never_loads_unrelated_default():
    # Execute the actual resolver without importing the native worker DLLs.
    tree=ast.parse(Path('agent.py').read_text(encoding='utf-8'))
    node=next(n for n in tree.body if isinstance(n,ast.AsyncFunctionDef) and n.name=='_resolve_profile')
    db=SimpleNamespace(get_agent_profile=AsyncMock(return_value=None),
                       get_assistant_as_profile=AsyncMock(return_value=None),
                       get_default_agent_profile=AsyncMock(return_value={'id':'unrelated'}))
    namespace={'db':db}
    exec(compile(ast.Module(body=[node],type_ignores=[]),'agent.py','exec'),namespace)
    with pytest.raises(LookupError):await namespace['_resolve_profile']('deleted-assistant')
    db.get_default_agent_profile.assert_not_awaited()
    db.get_assistant_as_profile.return_value={'id':'vasan','system_prompt':'Vasan policy'}
    assert (await namespace['_resolve_profile']('vasan'))['id']=='vasan'
