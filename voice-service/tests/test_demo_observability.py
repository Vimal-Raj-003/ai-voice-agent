import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock
import pytest
from gpt_live_gate import configured_test,select_test,test_metadata as metadata,TestSelection as Selection,ExperimentRejected

ENV={'GPT_LIVE_EXPERIMENT_ENABLED':'true','GPT_LIVE_TEST_ROOM':'demo-gpt-live-unit','GPT_LIVE_TEST_ASSISTANT_ID':'default-assistant'}


def test_explicit_browser_selection_keeps_browser_only_guards():
    base=configured_test(ENV)
    child=Selection(base.room+'-0123456789abcdef','another-assistant',base.direction)
    data=metadata(child,room_base=base.room)
    with pytest.raises(ExperimentRejected):select_test(child.room,data,ENV)
    data.update(browser_assistant_selection=True,organization_id='tenant')
    assert select_test(child.room,data,ENV).assistant_id=='another-assistant'
    for changed in ({'phone_number':'+919000000000'},{'is_demo':False},{'campaign_id':'campaign'},{'organization_id':''}):
        with pytest.raises(ExperimentRejected):select_test(child.room,{**data,**changed},ENV)


async def test_browser_selection_rejects_other_org_before_dispatch(monkeypatch):
    import server
    import voice_usage
    for k,v in {**ENV,'LIVEKIT_API_KEY':'synthetic','LIVEKIT_API_SECRET':'synthetic','LIVEKIT_URL':'wss://synthetic.invalid'}.items():monkeypatch.setenv(k,v)
    monkeypatch.setattr(server.db,'get_assistant_as_profile',AsyncMock(return_value={'id':'other','organization_id':'another-tenant'}))
    start=AsyncMock();monkeypatch.setattr(voice_usage,'start_demo_call',start)
    client=AsyncMock();monkeypatch.setattr(server,'_lk_client',client)
    request=NS(headers={'content-length':'1'},json=AsyncMock(return_value={'assistant_id':'other','organization_id':'tenant'}))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:await server.demo_token(request)
    assert error.value.status_code==404
    client.assert_not_called();start.assert_not_awaited()


async def test_demo_start_and_status_never_create_business_records(monkeypatch):
    import voice_usage
    execute=AsyncMock();monkeypatch.setattr(voice_usage.db,'get_pool',AsyncMock(return_value=NS(execute=execute)))
    profile={'id':'assistant','organization_id':'tenant','metadata':{'voiceRuntime':{'engine':'gemini-live'}}}
    await voice_usage.start_demo_call(profile,'demo-room')
    await voice_usage.finish_demo_call('demo-room','FAILED')
    first,last=execute.await_args_list
    assert first.args[1]==voice_usage.demo_call_id('demo-room')==last.args[1]
    assert first.args[4]=='demo-room'
    assert json.loads(first.args[-1])['voiceUsage']['complete'] is False
    assert all('appointments' not in c.args[0] and 'contacts' not in c.args[0] for c in execute.await_args_list)
    with pytest.raises(ValueError):await voice_usage.finish_demo_call('demo-room','BOOKED')


@pytest.mark.parametrize('headers', [{'content-length':'1'}, {'transfer-encoding':'chunked'}])
async def test_selected_assistant_reaches_trusted_dispatch_and_ledger(monkeypatch, headers):
    import asyncio,server,voice_usage,provider_credentials
    for k,v in {**ENV,'LIVEKIT_API_KEY':'synthetic','LIVEKIT_API_SECRET':'synthetic-secret-for-offline-only','LIVEKIT_URL':'wss://synthetic.invalid'}.items():monkeypatch.setenv(k,v)
    profile={'id':'choice','organization_id':'tenant','metadata':{'voiceRuntime':{'engine':'gemini-live'}}}
    monkeypatch.setattr(server.db,'get_assistant_as_profile',AsyncMock(return_value=profile))
    monkeypatch.setattr(provider_credentials,'load_for_org',AsyncMock(return_value={'google':'synthetic'}))
    start=AsyncMock();monkeypatch.setattr(voice_usage,'start_demo_call',start)
    client=NS(room=NS(list_rooms=AsyncMock(return_value=NS(rooms=[]))),agent_dispatch=NS(create_dispatch=AsyncMock()),aclose=AsyncMock())
    monkeypatch.setattr(server,'_lk_client',lambda:client)
    monkeypatch.setattr(server,'_gpt_live_dispatched_rooms',set());monkeypatch.setattr(server,'_gpt_live_demo_uncertain',False)
    monkeypatch.setattr(server,'_gpt_live_demo_lock',asyncio.Lock())
    request=NS(headers=headers,json=AsyncMock(return_value={'assistant_id':'choice','organization_id':'tenant'}))
    response=await server.demo_token(request)
    sent=client.agent_dispatch.create_dispatch.await_args.args[0]
    selected=select_test(response['room'],json.loads(sent.metadata),ENV)
    assert selected.assistant_id=='choice' and start.await_args.args[0]['id']=='choice'
    assert response['call_id']==voice_usage.demo_call_id(response['room'])


async def test_legacy_browser_reuses_allocated_demo_row_without_duplicate(monkeypatch):
    import db
    pool=NS(fetchval=AsyncMock(return_value='existing-demo'),execute=AsyncMock())
    monkeypatch.setattr(db,'get_pool',AsyncMock(return_value=pool))
    result=await db.create_call_row('demo',None,livekit_room_name='demo-room')
    assert result=='existing-demo'
    assert all('INSERT' not in call.args[0] for call in pool.execute.await_args_list)


async def test_phone_call_does_not_use_demo_ledger_lookup(monkeypatch):
    import db
    pool=NS(fetchval=AsyncMock(),execute=AsyncMock())
    monkeypatch.setattr(db,'get_pool',AsyncMock(return_value=pool))
    result=await db.create_call_row('+919000000000',None,livekit_room_name='phone-room')
    pool.fetchval.assert_not_awaited()
    assert result and 'INSERT INTO calls' in pool.execute.await_args.args[0]


async def test_inherited_voice_uses_saved_pipeline_instead_of_implicit_gpt_live(monkeypatch):
    import server,voice_usage,provider_credentials
    for k,v in {**ENV,'LIVEKIT_API_KEY':'synthetic','LIVEKIT_API_SECRET':'synthetic-secret-for-offline-only','LIVEKIT_URL':'wss://synthetic.invalid'}.items():monkeypatch.setenv(k,v)
    profile={'id':'support','organization_id':'tenant','metadata':{}}
    monkeypatch.setattr(server.db,'get_assistant_as_profile',AsyncMock(return_value=profile))
    credentials=AsyncMock();monkeypatch.setattr(provider_credentials,'load_for_org',credentials)
    monkeypatch.setattr(voice_usage,'start_demo_call',AsyncMock())
    client=NS(agent_dispatch=NS(create_dispatch=AsyncMock()),aclose=AsyncMock())
    monkeypatch.setattr(server,'_lk_client',lambda:client)
    response=await server.demo_token(NS(json=AsyncMock(return_value={'assistant_id':'support','organization_id':'tenant'})))
    data=json.loads(client.agent_dispatch.create_dispatch.await_args.args[0].metadata)
    assert response['assistant_id']=='support' and data['agent_profile_id']=='support'
    assert response['room'].startswith('demo-') and data['test_direction']=='INBOUND'
    assert 'experimental_voice_engine' not in data
    credentials.assert_not_awaited()
