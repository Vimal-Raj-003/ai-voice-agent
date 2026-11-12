import asyncio
import io
import json
import wave
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock
import pytest
import speech_references as refs


async def test_aac_upload_is_decoded_locally_and_sent_as_standard_flac(monkeypatch):
    import av
    from fractions import Fraction
    encoded=io.BytesIO()
    with av.open(encoded,'w',format='adts') as target:
        stream=target.add_stream('aac',rate=16000)
        stream.layout='mono'
        for offset in range(0,16000,1024):
            frame=av.AudioFrame(format='fltp',layout='mono',samples=1024)
            frame.planes[0].update(bytes(frame.planes[0].buffer_size))
            frame.sample_rate=16000;frame.pts=offset;frame.time_base=Fraction(1,16000)
            for packet in stream.encode(frame):target.mux(packet)
        for packet in stream.encode(None):target.mux(packet)
    saved=AsyncMock();analyze=AsyncMock()
    monkeypatch.setattr(refs,'change',saved);monkeypatch.setattr(refs,'analyze',analyze)
    result=await refs.upload('synthetic','conversation.AAC',encoded.getvalue())
    await asyncio.sleep(0)
    args=analyze.await_args.args
    assert args[3]=='audio/flac'
    assert args[2].startswith(b'fLaC')
    assert 1<=result['seconds']<=1.2
    assert result['enabled'] is False and result['sourceFormat']=='aac'


async def test_busy_analysis_uses_distinct_analysis_fallback_without_extra_attempts(monkeypatch):
    from google import genai
    from google.genai.errors import ServerError
    failure=ServerError(503,{'error':{'message':'private diagnostic','status':'UNAVAILABLE'}})
    generate=AsyncMock(side_effect=[failure,NS(text=json.dumps({'guidance':['Use familiar words.']}))])
    class Context:
        async def __aenter__(self):return NS(models=NS(generate_content=generate))
        async def __aexit__(self,*args):pass
    monkeypatch.setattr(genai,'Client',Mock(return_value=NS(aio=Context())))
    monkeypatch.setattr(refs.asyncio,'sleep',AsyncMock())
    monkeypatch.setenv('SPEECH_REFERENCE_FALLBACK_MODEL','synthetic-fallback')
    profile=await refs.generate_profile('synthetic-key','synthetic-primary',b'fixture','audio/flac')
    assert [call.kwargs['model'] for call in generate.await_args_list]==['synthetic-primary','synthetic-fallback']
    assert profile['analysisModel']=='synthetic-fallback'


async def test_single_request_cap_does_not_retry_provider_error(monkeypatch):
    from google import genai
    from google.genai.errors import ServerError
    failure=ServerError(503,{'error':{'message':'private diagnostic','status':'UNAVAILABLE'}})
    generate=AsyncMock(side_effect=failure)
    class Context:
        async def __aenter__(self):return NS(models=NS(generate_content=generate))
        async def __aexit__(self,*args):pass
    monkeypatch.setattr(genai,'Client',Mock(return_value=NS(aio=Context())))
    with pytest.raises(ServerError):
        await refs.generate_profile('synthetic-key','gemini-3.8-flash',b'fixture','audio/flac',max_attempts=1)
    generate.assert_awaited_once()
    config=generate.await_args.kwargs['config']
    assert config.temperature is None and str(config.thinking_config.thinking_level).lower().endswith('low')


@pytest.mark.parametrize('code,recover', [(503,True),(429,False),(403,False)])
async def test_recording_analysis_retries_only_temporary_provider_failures(monkeypatch,code,recover):
    from google import genai
    from google.genai.errors import ServerError, ClientError
    import provider_credentials
    failure=(ServerError if code>=500 else ClientError)(code,{'error':{'message':'private provider diagnostic','status':'UNAVAILABLE'}})
    result=NS(text=json.dumps({'guidance':['Use familiar words.']}))
    generate=AsyncMock(side_effect=[failure,result])
    client=NS(models=NS(generate_content=generate))
    class Context:
        async def __aenter__(self):return client
        async def __aexit__(self,*args):pass
    monkeypatch.setattr(genai,'Client',Mock(return_value=NS(aio=Context())))
    monkeypatch.setattr(refs.db,'get_pool',AsyncMock(return_value=NS(fetchval=AsyncMock(return_value='org'))))
    monkeypatch.setattr(provider_credentials,'load_for_org',AsyncMock(return_value={'google':'synthetic-key'}))
    monkeypatch.setattr(refs,'list_references',AsyncMock(return_value=[{'id':'reference'}]))
    saved=AsyncMock();monkeypatch.setattr(refs,'change',saved)
    monkeypatch.setattr(refs.asyncio,'sleep',AsyncMock())
    await refs.analyze('assistant','reference',b'synthetic-audio','audio/aac')
    assert generate.await_count==(2 if recover else 1)
    patch=saved.await_args.args[2]
    assert patch['status']==('READY' if recover else 'FAILED')
    if not recover:
        assert str(code) in patch['error']
        assert 'private provider diagnostic' not in patch['error']


def test_only_enabled_ready_style_is_appended_without_replacing_saved_prompt():
    from prompts import build_prompt
    sample={'summary':'natural','guidance':['Use simple Tanglish.'],'wordChoices':[{'avoid':'முன்பதிவு','prefer':'appointment book'}],'examples':[]}
    metadata={'voiceRuntime':{'engine':'gemini-live'},'speechReferences':[
        {'enabled':False,'status':'READY','profile':{'guidance':['disabled secret']}},
        {'enabled':True,'status':'PROCESSING','profile':{'guidance':['pending secret']}},
        {'enabled':True,'status':'READY','profile':sample}]}
    prompt=build_prompt(custom_prompt='SAVED ROLE',native_audio=True,speech_style=metadata)
    assert prompt.startswith('SAVED ROLE')
    assert 'simple Tanglish' in prompt and 'appointment book' in prompt
    assert 'disabled secret' not in prompt and 'pending secret' not in prompt
    assert 'never business facts' in prompt
    assert refs.style_directive(None)==''


def test_situation_guidance_is_shared_by_demo_and_phone_without_changing_role():
    from gemini_live_runtime import instructions
    for sandbox in (False,True):
        prompt=instructions('SAVED ROLE','INBOUND',sandbox=sandbox)
        assert prompt.startswith('SAVED ROLE')
        assert 'occasional brief mm/hmm or oh' in prompt
        assert 'Never laugh at sadness, confusion, complaints' in prompt
        assert 'Never read stage directions' in prompt


async def test_recording_validates_audio_before_analysis_and_never_enables_it_automatically(monkeypatch):
    saved=AsyncMock()
    analyze=AsyncMock()
    monkeypatch.setattr(refs,'change',saved)
    monkeypatch.setattr(refs,'analyze',analyze)
    with pytest.raises(ValueError): await refs.upload('synthetic','fake.mp3',b'not audio')
    with pytest.raises(ValueError): await refs.upload('synthetic','data.txt',b'not audio')
    saved.assert_not_awaited();analyze.assert_not_awaited()
    stream=io.BytesIO()
    with wave.open(stream,'wb') as audio:
        audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(8000);audio.writeframes(b'\0'*16000)
    row=await refs.upload('synthetic','conversation.wav',stream.getvalue())
    await asyncio.sleep(0)
    assert row['seconds']==1 and row['enabled'] is False and row['status']=='PROCESSING'
    analyze.assert_awaited_once()


async def test_native_usage_replaces_updates_for_same_request_and_preserves_modality():
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    state=CallState(language='ta')
    owner=NS(work=CallTasks(state))
    runtime=GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile={'id':'offline','metadata':{'voiceRuntime':{'engine':'gemini-live'}}},
        system_prompt='SAVED',state=state,owner=owner,tools=[],keys={'google':'synthetic'},
        language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None,sandbox=True)
    def event(output):
        return NS(metrics=NS(type='realtime_model_metrics',request_id='one',input_tokens=120,output_tokens=output,
            input_token_details=NS(audio_tokens=100,text_tokens=20,cached_tokens=0),
            output_token_details=NS(audio_tokens=output-5,text_tokens=5)))
    runtime.metrics(event(10));runtime.metrics(event(30));runtime.metrics(event(30))
    usage=runtime.usage_snapshot()
    assert owner._usage_prompt_tokens==120 and owner._usage_completion_tokens==30
    assert owner._usage_requests==1
    assert usage['complete'] and usage['mode']=='demo'
    assert usage['tokens']['outputAudio']==25
    await runtime.close()


async def test_demo_usage_ledger_does_not_create_contacts_or_business_actions(monkeypatch):
    import voice_usage
    execute=AsyncMock()
    monkeypatch.setattr(voice_usage.db,'get_pool',AsyncMock(return_value=NS(execute=execute)))
    usage={'model':'gemini-3.8-live','mode':'demo','tokens':dict(inputAudio=100,inputText=10,outputAudio=30,outputText=5)}
    profile={'id':'synthetic','organization_id':'synthetic-org'}
    await voice_usage.record_demo_usage(profile,'synthetic-room',60,usage)
    await voice_usage.record_demo_usage(profile,'synthetic-room',60,usage)
    first,second=execute.await_args_list
    assert first.args[1]==second.args[1]
    assert 'ON CONFLICT' in first.args[0] and 'contacts' not in first.args[0]
    assert json.loads(first.args[-1])['voiceUsage']['mode']=='demo'


async def test_added_forwarding_people_resolve_by_person_or_team_without_schema_change(monkeypatch):
    import db
    from tools import AppointmentTools
    ident='person_00000000-0000-0000-0000-000000000001'
    pool=NS(fetch=AsyncMock(return_value=[]),fetchval=AsyncMock(return_value={'humanTransferPeople':[
        {'id':ident,'category':'software','label':'Synthetic support','enabled':True,'phoneE164':'+919000000000','priority':4},
        {'id':'tel:+919000000001','category':'other','enabled':True,'phoneE164':'+919000000001'}]}))
    monkeypatch.setattr(db,'get_pool',AsyncMock(return_value=pool))
    targets=await db.get_human_transfer_targets('synthetic')
    assert set(targets)=={ident,'software'}
    owner=AppointmentTools(NS(room=NS(name='offline')),'synthetic')
    owner.transfer_targets=targets
    assert owner._resolve_transfer_target(ident)[0]['phone']=='+919000000000'
    assert owner._resolve_transfer_target('software')[0]['category']==ident
    assert owner._resolve_transfer_target('+919000000001')[0] is None
