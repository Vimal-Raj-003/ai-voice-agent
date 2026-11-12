"""Native engine contracts; no paid sessions or business writes."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

import pytest

from native_voice import runtime_settings, phone_engine
from livekit.agents.llm.utils import prepare_function_arguments


async def invoke_from_model(tool, **arguments):
    args, kwargs = prepare_function_arguments(fnc=tool, json_arguments=arguments)
    return await tool(*args, **kwargs)


def profile(engine='gemini-live', **settings):
    return {'id': 'selected', 'metadata': {'unrelated': 'preserved', 'voiceRuntime': {
        'engine': engine, **settings}}}


async def test_memory_updates_never_append_the_full_system_prompt_again():
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    from livekit.agents import llm
    state = CallState(language='ta')
    runtime = GeminiRuntime(ctx=NS(room=NS(name='offline'), add_shutdown_callback=Mock()),
        profile=profile(), system_prompt='PRIVATE_BUSINESS_INSTRUCTIONS ' * 400,
        state=state, owner=NS(work=CallTasks(state)), tools=[], keys={'google':'synthetic'},
        language_state=None, route=None, log=Mock(), vad=None, carrier_pattern=None)
    original_instructions = runtime.agent.instructions
    compression = runtime.voice._opts.context_window_compression
    assert compression.trigger_tokens == 8192
    assert compression.sliding_window.target_tokens == 4096
    agent = NS(chat_ctx=llm.ChatContext.empty(), update_instructions=AsyncMock())
    async def adopt(context): agent.chat_ctx = context
    agent.update_chat_ctx = AsyncMock(side_effect=adopt)
    runtime.agent = agent
    for turn in range(18):
        state.observe_user('Hello', message_id=f'cost-turn-{turn}')
        await runtime._sync_instructions()
    agent.update_instructions.assert_not_awaited()
    assert 3 <= agent.update_chat_ctx.await_count <= 4
    messages = list(agent.chat_ctx.messages())
    assert all('PRIVATE_BUSINESS_INSTRUCTIONS' not in m.text_content for m in messages)
    assert len(messages[-1].text_content) < len(original_instructions) / 2
    before = agent.update_chat_ctx.await_count
    await runtime._sync_instructions()
    assert agent.update_chat_ctx.await_count == before
    await runtime.close()


def test_compact_memory_retains_constraints_corrections_and_verified_results():
    import json
    from gemini_live_runtime import memory_snapshot
    from callstate import CallState
    state=CallState(language='ta')
    state.entities.update(name='Synthetic',email='synthetic@example.invalid')
    state.tool_state.update(booking='confirmed:synthetic-id',email_delivery='queued')
    state.booking_hold=True
    state.cancel_requested=True
    state.pending_slug='email_confirmation'
    state.spelling_field='email'
    state.known_facts=['Existing site maintenance only; no new website.']
    memory=json.loads(memory_snapshot(state))
    assert memory['entities']==state.entities and memory['tool_state']==state.tool_state
    assert memory['booking_hold'] and memory['cancel_requested']
    assert memory['spelling_field']=='email' and memory['pending_slug']=='email_confirmation'
    assert memory['caller_evidence']==state.known_facts


async def test_memory_sync_does_not_send_context_updates_over_playing_audio():
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    from livekit.agents import llm
    state=CallState(language='ta')
    runtime=GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile=profile(),system_prompt='SAVED',state=state,owner=NS(work=CallTasks(state)),
        tools=[],keys={'google':'synthetic'},language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    runtime.agent=NS(chat_ctx=llm.ChatContext.empty(),update_chat_ctx=AsyncMock())
    runtime._audio_playing=True
    state.booking_hold=True
    await runtime._sync_instructions()
    runtime.agent.update_chat_ctx.assert_not_awaited()
    runtime._audio_playing=False
    await runtime._sync_instructions()
    runtime.agent.update_chat_ctx.assert_awaited_once()
    assert '"booking_hold":true' in list(runtime.agent.update_chat_ctx.await_args.args[0].messages())[-1].text_content
    await runtime.close()


async def test_committed_demo_messages_are_collected_once_without_internal_memory():
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    from livekit.agents import llm
    state=CallState(language='ta')
    runtime=GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile=profile(),system_prompt='SAVED',state=state,owner=NS(work=CallTasks(state)),
        tools=[],keys={'google':'synthetic'},language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    item=llm.ChatMessage(id='one',role='assistant',content=['A synthetic answer.'])
    runtime.item(NS(item=item));runtime.item(NS(item=item))
    runtime.item(NS(item=llm.ChatMessage(id='one',role='assistant',content=['A synthetic answer.[APPLICATION CALL MEMORY; turn=1]\n{"pending_question":"Internal"}'])))
    runtime.item(NS(item=llm.ChatMessage(id='internal',role='assistant',content=['[APPLICATION CALL MEMORY; turn=1] private'])))
    assert len(runtime.transcript_items)==1
    assert runtime.transcript_items['one']['content']=='A synthetic answer.'
    assert state.pending_question != 'Internal'
    await runtime.close()


def test_engine_is_assistant_scoped_and_legacy_selection_survives():
    assert runtime_settings({}) is None
    env = {'GPT_LIVE_PHONE_ENABLED': 'true', 'GPT_LIVE_PHONE_ASSISTANT_IDS': 'old'}
    assert phone_engine({'id': 'old'}, '+910000000000', env) == 'gpt-live'
    assert phone_engine({'id': 'other'}, '+910000000000', env) is None
    assert phone_engine(profile(), '+910000000000', {}) == 'gemini-live'
    assert phone_engine(profile('pipeline'), '+910000000000', env) is None
    assert phone_engine(profile(), 'unknown', {}) is None
    assert phone_engine(profile(), 'demo', {}) is None


def test_zephyr_and_supported_current_model_defaults():
    settings = runtime_settings(profile())
    assert settings.engine == 'gemini-live'
    assert settings.model == 'gemini-3.8-live'
    assert settings.voice == 'Zephyr'
    with pytest.raises(ValueError):
        runtime_settings(profile(voice='kavya'))
    with pytest.raises(ValueError):
        runtime_settings(profile(model='gemini-3.8-flash'))
    with pytest.raises(ValueError):
        runtime_settings(profile('untrusted-provider'))


@pytest.mark.parametrize('sandbox', [False, True], ids=['phone', 'browser-sandbox'])
async def test_direct_tools_use_existing_state_and_preserve_complete_results(sandbox):
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    from livekit.agents import llm
    state = CallState(language='ta')
    owner = NS(work=CallTasks(), call_state=state)
    observed = []

    @llm.function_tool
    async def update_call_details(turn_id: int, field: str, value: str = '') -> str:
        """Synthetic state update."""
        observed.append(turn_id)
        return 'சோதனை தகவல் முழுவதும் பாதுகாக்கப்பட வேண்டும். ' * 20

    runtime = GeminiRuntime(ctx=NS(room=NS(name='offline'), add_shutdown_callback=Mock()),
        profile={**profile(), 'prompt_direction': 'INBOUND'}, system_prompt='SAVED POLICY',
        state=state, owner=owner, tools=[update_call_details], keys={'google': 'synthetic'},
        language_state=None, route=NS(), log=Mock(), vad=None, carrier_pattern=None, sandbox=sandbox)
    runtime.ready.set()
    runtime.observe_user('Keep Friday; change only the time to noon.', 'message-1')
    runtime.observe_user('Keep Friday; change only the time to noon.', 'message-1')
    assert state.user_turn_id == 1
    result = await invoke_from_model(runtime.tools[0], turn_id=999, field='time', value='12:00')
    assert observed == [1]
    assert len(result.encode()) > 400
    assert 'SAVED POLICY' in runtime.agent.instructions
    assert '<|SpawnThinking|>' not in runtime.agent.instructions
    await runtime.close()


async def test_native_model_and_session_construct_without_opening_network():
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    ctx = NS(room=NS(name='offline'), add_shutdown_callback=Mock(), shutdown=Mock())
    owner = NS(work=CallTasks(), call_state=CallState(language='ta'))
    runtime = GeminiRuntime(ctx=ctx, profile={**profile(), 'prompt_direction': 'INBOUND',
        'min_pause_ms': 350, 'interruption_threshold_ms': 500},
        system_prompt='SAVED POLICY', state=owner.call_state, owner=owner, tools=[],
        keys={'google': 'synthetic'}, language_state=None, route=NS(), log=Mock(), vad=None,
        carrier_pattern=None)
    assert runtime.voice.model == 'gemini-3.8-live'
    assert runtime.session.stt is None and runtime.session.tts is None
    assert runtime.voice_name == 'Zephyr'
    assert runtime.session._jj_gemini_live
    assert owner._gpt_live_runtime is runtime
    assert runtime.voice._opts.api_key == 'synthetic'
    await runtime.close()


async def test_waiting_action_rejects_new_caller_transcript_before_submission():
    import asyncio
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    from livekit.agents import llm
    writes = []

    @llm.function_tool
    async def synthetic_action() -> str:
        """Synthetic action; no network or external writes."""
        writes.append('submitted')
        return 'Done'

    state = CallState(language='ta')
    runtime = GeminiRuntime(ctx=NS(room=NS(name='offline'), add_shutdown_callback=Mock()),
        profile=profile(), system_prompt='SAVED', state=state, owner=NS(work=CallTasks(state)),
        tools=[synthetic_action], keys={'google': 'synthetic'}, language_state=None,
        route=None, log=Mock(), vad=None, carrier_pattern=None)
    runtime.ready.set()
    await runtime._serial.acquire()
    pending = asyncio.create_task(invoke_from_model(runtime.tools[0]))
    await asyncio.sleep(0)
    runtime.transcript(NS(transcript='Wait, do not do that.', is_final=True))
    runtime._serial.release()
    result = await pending
    assert writes == []
    assert 'No new action submitted' in result
    await runtime.close()


async def test_missing_google_key_stops_before_model_construction(monkeypatch):
    from gemini_live_runtime import GeminiRuntime
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    with pytest.raises(ValueError, match='Google'):
        GeminiRuntime(ctx=NS(), profile=profile(), system_prompt='', state=NS(), owner=NS(),
            tools=[], keys={}, language_state=None, route=NS(), log=Mock(), vad=None, carrier_pattern=None)


async def test_repeated_yes_turns_are_distinct_but_transcript_and_history_are_not_duplicates():
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    state = CallState(language='ta')
    runtime = GeminiRuntime(ctx=NS(room=NS(name='offline'), add_shutdown_callback=Mock()),
        profile=profile(), system_prompt='SAVED', state=state, owner=NS(work=CallTasks(state)),
        tools=[], keys={'google': 'synthetic'}, language_state=None, route=None, log=Mock(), vad=None,
        carrier_pattern=None)
    for n in [1, 2]:
        runtime.transcript(NS(transcript='Yes', is_final=True))
        runtime._flush_transcript()
        runtime.observe_user('Yes', f'message-{n}')
        runtime.observe_user('Yes', f'message-{n}')
        assert state.user_turn_id == n
    await runtime.close()


async def test_existing_core_tool_schemas_convert_to_google_without_network():
    from gemini_live_runtime import GeminiRuntime
    from livekit.plugins.google.realtime.realtime_api import create_tools_config
    from livekit.agents import llm
    from google.genai import types
    from callstate import CallState
    from tools import AppointmentTools
    ctx = NS(room=NS(name='offline'), add_shutdown_callback=Mock())
    state = CallState(language='ta')
    owner = AppointmentTools(ctx, 'synthetic-phone', call_state=state)
    runtime = GeminiRuntime(ctx=ctx, profile=profile(), system_prompt='SAVED', state=state,
        owner=owner, tools=owner.build_tool_list([]), keys={'google': 'synthetic'},
        language_state=None, route=None, log=Mock(), vad=None, carrier_pattern=None)
    config, _ = create_tools_config(llm.ToolContext(runtime.agent.tools),
        tool_behavior=types.Behavior.BLOCKING, use_parameters_json_schema=False)
    names = {f.name for tool in config for f in (tool.function_declarations or [])}
    assert {'book_appointment', 'update_call_details', 'search_business_knowledge'} <= names
    assert 'end_call' in names
    # Export alone passed before the fix. Exercise the actual SDK binding seam
    # for every wrapped tool, including end_call, without executing any action.
    for tool in runtime.tools:
        args, kwargs = prepare_function_arguments(fnc=tool, json_arguments={'synthetic_probe': True})
        assert args == ({'synthetic_probe': True},) and kwargs == {}
    await runtime.close()


async def test_cancelled_speech_does_not_cancel_committed_existing_integration():
    import asyncio
    from gemini_live_runtime import GeminiRuntime
    from callstate import CallState
    from call_tasks import CallTasks
    from livekit.agents import llm
    committed, release = asyncio.Event(), asyncio.Event()
    writes = []
    @llm.function_tool
    async def synthetic_action() -> str:
        """Synthetic integration with no external action."""
        committed.set()
        await release.wait()
        writes.append('once')
        return 'Verified synthetic success.'
    state = CallState(language='ta')
    owner = NS(work=CallTasks(state))
    runtime = GeminiRuntime(ctx=NS(room=NS(name='offline'), add_shutdown_callback=Mock()),
        profile=profile(), system_prompt='SAVED', state=state, owner=owner,
        tools=[synthetic_action], keys={'google': 'synthetic'}, language_state=None,
        route=None, log=Mock(), vad=None, carrier_pattern=None)
    runtime.ready.set()
    waiter = asyncio.create_task(invoke_from_model(runtime.tools[0]))
    await asyncio.wait_for(committed.wait(), 2)
    waiter.cancel()
    await asyncio.gather(waiter, return_exceptions=True)
    runtime.observe_user('Actually, wait.', 'new-turn')
    release.set()
    await runtime.close()
    assert writes == ['once']


async def test_saved_gemini_demo_uses_google_key_and_config_read_never_dispatches(monkeypatch):
    import voice_usage
    monkeypatch.setattr(voice_usage,'start_demo_call',AsyncMock())
    import asyncio
    import server
    import provider_credentials
    from fastapi import HTTPException
    from gpt_live_gate import configured_test
    env = {'GPT_LIVE_EXPERIMENT_ENABLED': 'true', 'GPT_LIVE_TEST_ROOM': 'demo-gpt-live-offline',
           'GPT_LIVE_TEST_ASSISTANT_ID': 'selected', 'GPT_LIVE_TEST_DIRECTION': 'INBOUND',
           'LIVEKIT_API_KEY': 'synthetic', 'LIVEKIT_API_SECRET': 'synthetic-only-not-a-real-secret',
           'LIVEKIT_URL': 'wss://synthetic.invalid'}
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.delenv('GOOGLE_API_KEY', raising=False)
    monkeypatch.setattr(server.db, 'get_assistant_as_profile', AsyncMock(return_value={**profile(), 'name':'Synthetic'}))
    keys = AsyncMock(return_value={})
    monkeypatch.setattr(provider_credentials, 'load_for_org', keys)
    dispatch = Mock(side_effect=AssertionError('Read-only config must not dispatch'))
    monkeypatch.setattr(server, '_lk_client', dispatch)
    config = await server.demo_config()
    assert config['engine'] == 'gemini-live' and config['voice'] == 'Zephyr'
    dispatch.assert_not_called()
    with pytest.raises(HTTPException, match='Google'):
        await server.demo_token()
    dispatch.assert_not_called()
    keys.return_value = {'google': 'synthetic-only'}
    client = NS(room=NS(list_rooms=AsyncMock(return_value=NS(rooms=[]))),
                agent_dispatch=NS(create_dispatch=AsyncMock()), aclose=AsyncMock())
    monkeypatch.setattr(server, '_lk_client', lambda: client)
    monkeypatch.setattr(server, '_gpt_live_dispatched_rooms', set())
    monkeypatch.setattr(server, '_gpt_live_demo_uncertain', False)
    monkeypatch.setattr(server, '_gpt_live_demo_lock', asyncio.Lock())
    token = await server.demo_token()
    assert token['room'].startswith(configured_test().room)
    client.agent_dispatch.create_dispatch.assert_awaited_once()
