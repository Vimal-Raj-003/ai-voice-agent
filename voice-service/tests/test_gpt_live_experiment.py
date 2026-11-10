"""Offline contracts only. These tests do not prove GPT-Live speech quality."""
import asyncio
import json
from array import array
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

import pytest

from gpt_live_gate import configured_test, select_test, test_metadata as metadata, ExperimentRejected
from gpt_live_experiment import DelegationBridge, AudioEvidence, sandbox_tools, build_backend, commentary_text
from callstate import CallState


ENV = dict(GPT_LIVE_EXPERIMENT_ENABLED='true', GPT_LIVE_TEST_ROOM='demo-gpt-live-unit',
           GPT_LIVE_TEST_ASSISTANT_ID='synthetic-assistant')


def test_default_off_does_not_require_credentials():
    assert configured_test({}) is None
    assert select_test('phone-room', {}, {}) is None
    assert select_test('phone-room', {}, ENV) is None
    selected = configured_test(ENV)
    with pytest.raises(ExperimentRejected):
        select_test(selected.room, metadata(selected), {})
    assert select_test('ordinary-demo', {}, ENV) is None


@pytest.mark.parametrize('change', [dict(room='call-123'), dict(assistant_id=''), dict(direction='SIDEWAYS')])
def test_invalid_server_configuration(change):
    env = dict(ENV)
    keys = dict(room='GPT_LIVE_TEST_ROOM', assistant_id='GPT_LIVE_TEST_ASSISTANT_ID', direction='GPT_LIVE_TEST_DIRECTION')
    env.update({keys[k]: v for k, v in change.items()})
    with pytest.raises(ExperimentRejected):
        configured_test(env)


@pytest.mark.parametrize('change', [dict(phone_number='+910000000000'), dict(is_demo=False),
                                  dict(campaign_id='campaign'), dict(target_id='target'),
                                  dict(agent_profile_id='other'), dict(test_direction='OUTBOUND')])
def test_dispatch_cannot_change_routing_or_enable_phone_calls(change):
    selected = configured_test(ENV)
    with pytest.raises(ExperimentRejected):
        select_test(selected.room, {**metadata(selected), **change}, ENV)
    with pytest.raises(ExperimentRejected):
        select_test('some-other-room', metadata(selected), ENV)


def test_exact_trusted_selection_and_restoration():
    selected = configured_test(ENV)
    assert select_test(selected.room, metadata(selected), ENV) == selected
    assert select_test('normal-inbound', dict(phone_number='+910000000000'), ENV) is None
    assert select_test('normal-outbound', dict(campaign_id='existing'), {}) is None


def test_native_sdk_contract_without_opening_connection():
    import inspect
    from livekit.plugins.openai.realtime import GPTLiveModel, GPTLiveSession, GPTLiveDelegation
    from livekit.agents import AgentSession, RoomInputOptions
    assert {'api_key', 'delegation', 'max_session_duration'} <= set(inspect.signature(GPTLiveModel).parameters)
    assert 'pending_transcript' in inspect.signature(GPTLiveDelegation).parameters
    assert 'delegation_id' in inspect.signature(GPTLiveSession.append_commentary).parameters
    assert 'participant_identity' in inspect.signature(RoomInputOptions).parameters
    assert 'llm' in inspect.signature(AgentSession).parameters


async def test_installed_native_model_constructs_without_a_network_request():
    from livekit.plugins.openai.realtime import GPTLiveModel
    from livekit.agents import AgentSession
    model = GPTLiveModel(api_key='synthetic-offline-only', delegation='client',
                         base_url='https://api.openai.com/v1')
    session = AgentSession(llm=model, tools=[])
    assert session.stt is None and session.tts is None
    await session.aclose()
    await model.aclose()


async def test_missing_voice_key_stops_before_native_construction(monkeypatch):
    from gpt_live_experiment import run_test_session
    import provider_credentials
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    monkeypatch.setattr(provider_credentials, 'load_for_org', AsyncMock(return_value={}))
    ctx = NS(room=NS(remote_participants={}))
    with pytest.raises(ExperimentRejected, match='missing'):
        await run_test_session(ctx, configured_test(ENV), resolve_profile=AsyncMock(return_value={
            'id': 'synthetic-assistant', 'organization_id': 'synthetic'}), log=lambda *a, **k: None)


def bridge(backend=None, lookup=None):
    events = []
    state = CallState(language='ta')
    owner, tools = sandbox_tools(NS(room=NS(name='test')), state,
                                 lambda event, **kw: events.append((event, kw)), slow_seconds=0)
    value = DelegationBridge(state=state, owner=owner, tools=tools, backend=backend,
                             backend_prompt='Synthetic business rules', assistant_id='synthetic',
                             emit=lambda event, **kw: events.append((event, kw)), lookup=lookup)
    value.duplex = NS(append_commentary=lambda *a, **kw: events.append(('commentary', (a, kw))))
    return value, events


class Backend:
    def __init__(self, rounds):
        self.rounds = iter(rounds)
        self.calls = []
    def chat(self, **kwargs):
        self.calls.append(kwargs)
        chunks = next(self.rounds)
        class Stream:
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            def __aiter__(self): return self.generate()
            async def generate(self):
                for chunk in chunks:
                    yield chunk
        return Stream()


def text(value): return NS(delta=NS(content=value, tool_calls=[]))
def tool(name, args):
    return NS(delta=NS(content=None, tool_calls=[NS(name=name, arguments=json.dumps(args), call_id='fake-call')]))


async def test_real_state_tool_correction_preserves_other_fields():
    backend = Backend([[tool('update_call_details', dict(turn_id=999, field='time', value='12:00'))],
                       [text('Requested time is noon; no booking has been made.')]])
    b, events = bridge(backend)
    b.state.update_entity('date', '2026-11-06', confirmed=True)
    b.state.update_entity('service', 'website maintenance', confirmed=True)
    b.transcript('Keep Friday; change only the time to 12 noon.', True)
    result = await b.answer(b.epoch)
    assert b.state.entities['time'] == '12:00'
    assert b.state.entities['date'] == '2026-11-06'
    assert b.state.entities['service'] == 'website maintenance'
    assert 'no booking' in result
    assert any(e[0] == 'sandbox_tool_result' for e in events)
    await b.close()


async def test_wrong_name_and_email_approval_use_existing_state_rules():
    b, _ = bridge()
    b.state.set_pending('name', 'What is your name?')
    b.transcript('எனக்கு நாளைக்கு.', True)
    assert 'name' not in b.state.entities
    b.transcript('My email is nila@example.test', True)
    b.state.set_pending('email_confirmation', 'Is nila@example.test correct?')
    b.transcript('Correct, send it to that email.', True)
    assert b.state.entities['email_confirmed'] == 'yes'
    original = dict(b.state.entities)
    b.transcript('Hello, can you hear me?', True)
    assert b.state.entities == original
    await b.close()


async def test_tool_allowlist_never_reaches_real_business_io(monkeypatch):
    import db
    monkeypatch.setattr(db, 'get_pool', AsyncMock(side_effect=AssertionError('No business DB I/O allowed')))
    for name in ['create_appointment', 'create_call', 'upsert_active_call', 'save_contact_memory']:
        if hasattr(db, name):
            monkeypatch.setattr(db, name, AsyncMock(side_effect=AssertionError('No DB writes allowed')))
    b, _ = bridge()
    names = {t.info.name for t in b.tools}
    assert names == {'update_call_details', 'check_availability', 'book_appointment',
                     'remember_details', 'transfer_to_human', 'end_call'}
    assert 'read-only' in (await b.owner.book_appointment('Nila', '2026-11-06', '12:00', 'maintenance')).lower()
    assert 'TEST ONLY' in await b.owner.check_availability('2026-11-06', '12:00')
    assert 'nothing saved' in await b.owner.remember_details('Existing slow website; not a new site.')
    assert 'no human' in await b.owner.transfer_to_human('support')
    assert 'no telephony' in await b.owner.end_call('done')
    assert any('slow website' in fact for fact in b.state.known_facts)
    await b.close()


async def test_delegation_dedup_waits_for_final_and_discards_changed_context():
    b, events = bridge()
    started, release = asyncio.Event(), asyncio.Event()
    async def answer(epoch):
        started.set()
        await release.wait()
        return 'Obsolete answer'
    b.answer = answer
    d = NS(id='d1', pending_transcript='Friday')
    b.submit(d)
    b.submit(d)
    await asyncio.sleep(0)
    assert not started.is_set()
    b.transcript('Friday noon', True)
    await started.wait()
    b.transcript('Actually Monday', False)
    release.set()
    await asyncio.gather(*list(b.pending.values()))
    assert not any(e[0] == 'commentary' for e in events)
    assert any(e[0] == 'delegation_discarded_stale' for e in events)
    assert b.state._last_observed_user == 'Friday noon'
    await b.close()


async def test_delegation_verified_result_and_failure_are_not_fillers():
    b, events = bridge()
    b.transcript('What are your hours?', True)
    b.answer = AsyncMock(return_value='Synthetic verified hours: 9 AM.')
    b.submit(NS(id='ok', pending_transcript=''))
    await asyncio.gather(*list(b.pending.values()))
    assert [e for e in events if e[0] == 'commentary'][0][1][0][0] == 'Synthetic verified hours: 9 AM.'
    b.answer = AsyncMock(side_effect=RuntimeError('sensitive provider response'))
    b.submit(NS(id='fail', pending_transcript=''))
    await asyncio.gather(*list(b.pending.values()))
    assert 'sensitive provider' not in str(events)
    assert any(e[0] == 'delegation_failed' for e in events)
    await b.close()


async def test_late_model_text_stays_attributed_to_its_original_turn():
    b, events = bridge()
    b.transcript('Friday noon', True)
    original_turn = b.state.user_turn_id
    class Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def __aiter__(self): return self.generate()
        async def generate(self):
            b.transcript('Actually Monday noon', True)
            yield text('Obsolete answer')
    b.backend = NS(chat=lambda **kwargs: Stream())
    assert await b.answer(b.epoch) is None
    first_text = next(fields for event, fields in events if event == 'backend_first_text')
    assert first_text['turn_id'] == original_turn
    assert b.state.user_turn_id != original_turn
    await b.close()


async def test_request_cap_and_shutdown_do_not_start_extra_work():
    b, _ = bridge(Backend([]))
    b.transcript('A question', True)
    b.requests = b.request_cap
    assert 'limit' in await b.answer(b.epoch)
    b.submit(NS(id='waiting', pending_transcript='not finalized yet'))
    await b.close()
    assert not b.pending
    b.submit(NS(id='after-close', pending_transcript=''))
    assert not b.pending


def test_silence_does_not_count_and_usefulness_is_never_inferred():
    events = []
    trace = AudioEvidence(lambda event, **kw: events.append((event, kw)))
    silent, audible = NS(data=memoryview(array('h', [0]*80))), NS(data=memoryview(array('h', [1000]*80)))
    trace.frame(silent, 1)
    assert events == []
    trace.frame(audible, 1)
    trace.frame(audible, 1)
    assert len(events) == 1
    assert events[0][1]['semantic_usefulness_verified'] is False
    trace.frame(silent, 1)
    assert events[-1][0] == 'generated_non_silent_audio_end'
    assert len(commentary_text('தமிழ் '*200).encode('utf-8')) <= 400


def test_backend_selection_and_byok_without_mutating_process_env(monkeypatch):
    import llm_routing
    captured = {}
    def create(provider, model, **kwargs):
        captured.update(provider=provider, model=model, **kwargs)
        return 'backend'
    monkeypatch.setattr(llm_routing, 'build_llm', create)
    monkeypatch.setenv('OPENROUTER_API_KEY', 'server-synthetic')
    profile = dict(llm_provider='OPENROUTER', model='qwen/qwen3-30b-a3b-instruct-2507')
    assert build_backend(profile, {'openrouter': 'tenant-synthetic'})[0] == 'backend'
    assert captured['provider'] == 'openrouter'
    assert captured['model'] == profile['model']
    assert captured['api_key'] == 'tenant-synthetic'
    import os
    assert os.environ['OPENROUTER_API_KEY'] == 'server-synthetic'


async def test_existing_demo_endpoint_off_and_missing_key(monkeypatch):
    import server
    monkeypatch.delenv('GPT_LIVE_EXPERIMENT_ENABLED', raising=False)
    client = NS(agent_dispatch=NS(create_dispatch=AsyncMock()), aclose=AsyncMock())
    monkeypatch.setattr(server, '_lk_client', lambda: client)
    for name in ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL']:
        monkeypatch.setenv(name, 'synthetic')
    result = await server.demo_token()
    assert result['room'].startswith('demo-')
    request = client.agent_dispatch.create_dispatch.call_args.args[0]
    assert json.loads(request.metadata) == {'phone_number': 'demo', 'is_demo': True}
    for name, value in ENV.items(): monkeypatch.setenv(name, value)
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    import provider_credentials
    monkeypatch.setattr(provider_credentials, 'load_for_org', AsyncMock(return_value={}))
    monkeypatch.setattr(server.db, 'get_assistant_as_profile', AsyncMock(return_value={
        'id': 'synthetic-assistant', 'organization_id': 'synthetic'}))
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await server.demo_token()
    assert exc.value.status_code == 503
    assert client.agent_dispatch.create_dispatch.await_count == 1


async def test_browser_dispatch_is_single_use_even_after_ambiguous_failure(monkeypatch):
    import server
    from fastapi import HTTPException
    monkeypatch.setattr(server, '_gpt_live_dispatched_rooms', set())
    monkeypatch.setattr(server, '_gpt_live_demo_lock', asyncio.Lock())
    monkeypatch.setattr(server, '_gpt_live_demo_uncertain', False)
    client = NS(room=NS(list_rooms=AsyncMock(return_value=NS(rooms=[]))),
                agent_dispatch=NS(create_dispatch=AsyncMock(side_effect=TimeoutError)))
    with pytest.raises(TimeoutError):
        await server._dispatch_browser_demo(client, 'demo-gpt-live-ambiguous', {}, True)
    with pytest.raises(HTTPException) as exc:
        await server._dispatch_browser_demo(client, 'demo-gpt-live-ambiguous', {}, True)
    assert exc.value.status_code == 409
    assert client.agent_dispatch.create_dispatch.await_count == 1


async def test_finished_demo_can_start_again_with_new_trusted_room(monkeypatch):
    import server, provider_credentials
    for name, value in ENV.items(): monkeypatch.setenv(name, value)
    for name in ('LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL'): monkeypatch.setenv(name, 'synthetic')
    monkeypatch.setenv('OPENAI_API_KEY', 'synthetic')
    monkeypatch.setattr(server, '_gpt_live_dispatched_rooms', set())
    monkeypatch.setattr(server, '_gpt_live_demo_lock', asyncio.Lock())
    monkeypatch.setattr(server, '_gpt_live_demo_uncertain', False, raising=False)
    client = NS(room=NS(list_rooms=AsyncMock(return_value=NS(rooms=[]))),
                agent_dispatch=NS(create_dispatch=AsyncMock()), aclose=AsyncMock())
    monkeypatch.setattr(server, '_lk_client', lambda: client)
    monkeypatch.setattr(server.db, 'get_assistant_as_profile', AsyncMock(return_value={'id':'synthetic-assistant'}))
    monkeypatch.setattr(provider_credentials, 'load_for_org', AsyncMock(return_value={}))
    first, second = await server.demo_token(), await server.demo_token()
    assert first['room'] != second['room']
    for request in client.agent_dispatch.create_dispatch.call_args_list:
        dispatch = request.args[0]
        selected = select_test(dispatch.room, json.loads(dispatch.metadata), ENV)
        assert selected.room == dispatch.room
        assert selected.assistant_id == 'synthetic-assistant'


def test_demo_and_phone_voice_preserve_saved_business_and_language_instructions():
    from gpt_live_experiment import voice_instructions
    from gpt_live_phone import phone_instructions
    saved = 'SAVED UNIQUE POLICY: respond in Malayalam; discuss verified services, not general chat.'
    demo = voice_instructions({'system_prompt':saved, 'prompt_direction':'INBOUND'}, 'Synthetic business')
    phone = phone_instructions(saved, 'INBOUND')
    for instructions in (demo, phone):
        assert saved in instructions
        assert 'Default to Tamil' not in instructions
        assert '<|SpawnThinking|>' in instructions


@pytest.mark.parametrize('text, expected', [
    ('I want to book an appointment', 'en'),
    ('எனக்கு ஒரு appointment வேண்டும்', 'ta'),
    ('enakku oru appointment venum', 'ta'),
    ('എനിക്ക് ഒരു അപ്പോയിന്റ്മെന്റ് വേണം', 'ml'),
    ('నాకు ఒక అపాయింట్మెంట్ కావాలి', 'te'),
    ('मुझे एक अपॉइंटमेंट बुक करना है', 'hi'),
])
async def test_first_meaningful_native_language_uses_existing_router(text, expected):
    import lang
    b, _ = bridge()
    b.language_state = lang.LanguageState(initial='en')
    b.language_state.strict_lock = True
    b.transcript(text, True)
    assert b.language_state.active == expected
    assert b.state.language == expected
    b.transcript('Okay', True)
    assert b.language_state.active == expected
    await b.close()


async def test_demo_rejects_another_active_call_and_unknown_dispatch_outcome(monkeypatch):
    import server
    from fastapi import HTTPException
    monkeypatch.setattr(server, '_gpt_live_dispatched_rooms', {'demo-gpt-live-previous'})
    monkeypatch.setattr(server, '_gpt_live_demo_uncertain', False)
    monkeypatch.setattr(server, '_gpt_live_demo_lock', asyncio.Lock())
    client = NS(room=NS(list_rooms=AsyncMock(return_value=NS(rooms=[NS(name='demo-gpt-live-previous', num_participants=2)]))),
                agent_dispatch=NS(create_dispatch=AsyncMock()))
    with pytest.raises(HTTPException, match='still active'):
        await server._dispatch_browser_demo(client, 'demo-gpt-live-new', {}, True)
    client.agent_dispatch.create_dispatch.assert_not_called()
    monkeypatch.setattr(server, '_gpt_live_demo_uncertain', True)
    with pytest.raises(HTTPException, match='unknown outcome'):
        await server._dispatch_browser_demo(client, 'demo-gpt-live-next', {}, True)
    client.agent_dispatch.create_dispatch.assert_not_called()


def test_child_demo_room_cannot_change_assistant_or_escape_configured_base():
    selected = configured_test(ENV)
    child = type(selected)(selected.room + '-0123456789abcdef', selected.assistant_id, selected.direction)
    tagged = metadata(child, room_base=selected.room)
    assert select_test(child.room, tagged, ENV) == child
    for changed in ({'test_room_base':'demo-gpt-live-other'}, {'agent_profile_id':'other'}, {'is_demo':False}):
        with pytest.raises(ExperimentRejected): select_test(child.room, {**tagged, **changed}, ENV)
    with pytest.raises(ExperimentRejected): select_test(selected.room + '-guessable', tagged, ENV)


def test_native_prompt_uses_saved_policy_without_cascaded_language_overrides():
    from prompts import build_prompt
    saved = 'Answer Malayalam callers in Malayalam; keep the saved service scope.'
    prompt = build_prompt(custom_prompt=saved, native_audio=True)
    assert prompt.startswith(saved)
    assert 'Reply only in English/Tamil/Tanglish/Hindi/Telugu;' not in prompt
    assert 'HALLUCINATION GUARD' in prompt


async def test_actual_entrypoint_exits_before_legacy_setup(monkeypatch):
    import agent
    import observability
    import gpt_live_experiment
    for name, value in ENV.items(): monkeypatch.setenv(name, value)
    monkeypatch.setattr(observability, 'start_log_drain', lambda: None)
    monkeypatch.setattr(observability, 'attach_sdk_log_bridge', lambda: None)
    selected = configured_test(ENV)
    ctx = NS(room=NS(name=selected.room), job=NS(metadata=json.dumps(metadata(selected))),
             connect=AsyncMock(), shutdown=Mock())
    run = AsyncMock()
    monkeypatch.setattr(gpt_live_experiment, 'run_test_session', run)
    monkeypatch.setattr(agent.db, 'close_pool', AsyncMock())
    legacy = Mock(side_effect=AssertionError('Legacy voice engine must not start'))
    monkeypatch.setattr(agent, '_build_session', legacy)
    await agent.entrypoint(ctx)
    run.assert_awaited_once()
    ctx.connect.assert_awaited_once()
    ctx.shutdown.assert_called_once_with(reason='gpt_live_test_finished')
    legacy.assert_not_called()


async def test_actual_entrypoint_off_never_calls_experimental_runtime(monkeypatch):
    import agent
    import observability
    import gpt_live_experiment
    monkeypatch.delenv('GPT_LIVE_EXPERIMENT_ENABLED', raising=False)
    monkeypatch.setattr(observability, 'start_log_drain', lambda: None)
    monkeypatch.setattr(observability, 'attach_sdk_log_bridge', lambda: None)
    run = AsyncMock()
    monkeypatch.setattr(gpt_live_experiment, 'run_test_session', run)
    # Stop precisely at the unchanged legacy room connection, before any I/O.
    ctx = NS(room=NS(name='normal-call'), job=NS(metadata='{}'),
             connect=AsyncMock(side_effect=RuntimeError('legacy entry reached')))
    with pytest.raises(RuntimeError, match='legacy entry reached'):
        await agent.entrypoint(ctx)
    run.assert_not_awaited()


@pytest.mark.parametrize('replay', ['lifecycle', 'speech_started', 'speech_stopped', 'playback_started', 'audio_flow', 'audio_flow_journal_failure'])
async def test_native_lifecycle_uses_one_engine_and_cleans_all_resources(monkeypatch, tmp_path, replay):
    import livekit.agents
    from livekit import rtc
    from livekit.agents import llm
    from livekit.agents.voice import io
    from livekit.plugins.openai.realtime import gpt_live_model as sdk
    import provider_credentials
    import gpt_live_experiment as experiment
    import recorder
    from livekit.plugins import silero
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(experiment, 'wait_for_microphone', AsyncMock())
    monkeypatch.setattr(provider_credentials, 'load_for_org', AsyncMock(return_value={'openai': 'synthetic'}))
    backend = NS(aclose=AsyncMock())
    monkeypatch.setattr(experiment, 'build_backend', lambda *a: (backend, 'openrouter', 'selected-model'))
    rec = NS(start=Mock(), stop=Mock(return_value=('test.wav', 0)), attach_caller_track=Mock(),
             write_agent_frame=Mock())
    monkeypatch.setattr(recorder, 'CallRecorder', lambda *a: rec)
    monkeypatch.setattr(silero.VAD, 'load', lambda: None)
    log = Mock()
    if replay == 'audio_flow_journal_failure':
        original_emit = experiment.Journal.emit
        def failing_evidence(self, event, **fields):
            if event == 'caller_speech_onset':
                raise TypeError('Synthetic evidence serialization failure')
            original_emit(self, event, **fields)
        monkeypatch.setattr(experiment.Journal, 'emit', failing_evidence)
    class FakeAgent:
        def __init__(self, **kwargs): self.kwargs = kwargs
    # Exercise installed SDK event dispatch, transcript assembly and PCM buffering.
    # Only its network task is replaced; no paid connection can be opened.
    monkeypatch.setattr(sdk.GPTLiveSession, '_main_task', AsyncMock())
    class OfflineOutput(io.AudioOutput):
        def __init__(self):
            super().__init__(label='offline PCM sink', capabilities=io.AudioOutputCapabilities(pause=False))
            self.frames = []
        async def capture_frame(self, frame):
            await super().capture_frame(frame)
            self.on_playback_started(created_at=0.0)
            self.frames.append(frame)
        def flush(self): super().flush()
        def clear_buffer(self): pass
    class FakeSession:
        def __init__(self, **kwargs):
            self.kwargs, self.events = kwargs, {}
            self.output, self.usage = NS(audio=OfflineOutput()), 'offline-synthetic-usage'
            self.current_speech = NS(id='offline-speech')
            self.aclose = AsyncMock()
        def on(self, name):
            def register(fn): self.events[name] = fn; return fn
            return register
        def generate_reply(self, **kwargs): pass
        async def start(self, **kwargs):
            from livekit.agents import llm
            self.events['conversation_item_added'](NS(item=llm.AgentHandoff(new_agent_id='synthetic-test')))
            message = llm.ChatContext().add_message(role='assistant', content='Synthetic test greeting')
            self.events['conversation_item_added'](NS(item=message))
            agent = kwargs['agent']
            agent.session = self
            self.duplex = agent.duplex_session = sdk.GPTLiveSession(self.kwargs['llm'])
            await agent.on_enter()
            async def replay_events():
                try:
                    if replay == 'speech_started':
                        self.duplex.emit('input_speech_started', llm.InputSpeechStartedEvent())
                    elif replay == 'speech_stopped':
                        self.duplex.emit('input_speech_stopped', llm.InputSpeechStoppedEvent(user_transcription_enabled=False))
                    elif replay == 'playback_started':
                        self.output.audio.on_playback_started(created_at=0.0)
                    elif replay.startswith('audio_flow'):
                        self.duplex.on('input_audio_transcription_completed', lambda ev:
                            self.events['user_input_transcribed'](ev))
                        self.duplex._handle_transcript_delta('user', NS(delta='Hello', start_ms=0, end_ms=100))
                        send = self.duplex.send_event = Mock(wraps=self.duplex.send_event)
                        frame = rtc.AudioFrame.create(24000, 1, 2400)
                        for _ in range(15): self.duplex.push_audio(frame)
                        assert send.call_count >= 15, 'Audio must continue after native speech-stop callbacks'
                        async def generated_audio():
                            yield frame
                            yield frame
                        async for forwarded in agent.realtime_audio_output_node(generated_audio(), None):
                            await self.output.audio.capture_frame(forwarded)
                        self.output.audio.on_playback_finished(playback_position=0.2, interrupted=False)
                        assert len(self.output.audio.frames) == 2, 'Frames must reach the output sink after playback-start callbacks'
                        rec.write_agent_frame.assert_called_with(frame)
                finally:
                    self.events['close'](NS())
            self.replay_task = asyncio.create_task(replay_events())
    captured = []
    def create_session(**kwargs):
        session = FakeSession(**kwargs)
        captured.append(session)
        return session
    monkeypatch.setattr(livekit.agents, 'Agent', FakeAgent)
    monkeypatch.setattr(livekit.agents, 'AgentSession', create_session)
    callbacks = []
    ctx = NS(room=NS(remote_participants={}, on=lambda *a: (a[1] if len(a) > 1 else lambda fn: fn)),
             add_shutdown_callback=callbacks.append)
    await experiment.run_test_session(ctx, configured_test(ENV),
        resolve_profile=AsyncMock(return_value={'id':'synthetic-assistant', 'system_prompt':'Synthetic business'}),
        log=log)
    await captured[0].replay_task
    assert len(captured) == 1
    assert 'stt' not in captured[0].kwargs and 'tts' not in captured[0].kwargs
    assert captured[0].kwargs['tools'] == []
    await callbacks[0]('worker shutdown')
    captured[0].aclose.assert_awaited_once()
    backend.aclose.assert_awaited_once()
    rec.stop.assert_called_once()
    journal = list(tmp_path.rglob('*.jsonl'))[0].read_text()
    assert 'Synthetic test greeting' in journal
    if replay == 'audio_flow_journal_failure':
        assert sum(c.args[0] == 'gpt_live_evidence_failed' for c in log.call_args_list) == 1
        return
    assert 'test_finished' in journal
    assert '"meaningful_audio_latency_ms": null' in journal
    if replay == 'audio_flow':
        events = [json.loads(line) for line in journal.splitlines()]
        assert {'caller_speech_onset', 'caller_speech_end', 'room_playback_started', 'room_playback_finished'} <= {e['event'] for e in events}
        assert any(e['event'] == 'caller_final_transcript' and e['transcript'] == 'Hello' for e in events)


async def test_missing_browser_audio_never_constructs_a_paid_voice_model(monkeypatch, tmp_path):
    import provider_credentials
    import gpt_live_experiment as experiment
    import livekit.plugins.openai.realtime as realtime
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(provider_credentials, 'load_for_org', AsyncMock(return_value={'openai': 'synthetic'}))
    monkeypatch.setattr(experiment, 'MICROPHONE_READY_TIMEOUT', 0.01, raising=False)
    monkeypatch.setattr(experiment, 'build_backend', lambda *a: (NS(aclose=AsyncMock()), 'openrouter', 'selected'))
    voice_constructor = Mock(side_effect=AssertionError('Paid voice model constructed without a caller microphone'))
    monkeypatch.setattr(realtime, 'GPTLiveModel', voice_constructor)
    ctx = NS(room=NS(remote_participants={}, on=lambda *a: (a[1] if len(a)>1 else lambda fn: fn), off=lambda *a: None),
             add_shutdown_callback=lambda fn: None)
    with pytest.raises(ExperimentRejected, match='microphone'):
        await experiment.run_test_session(ctx, configured_test(ENV),
            resolve_profile=AsyncMock(return_value={'id':'synthetic-assistant'}), log=lambda *a, **kw: None)
    voice_constructor.assert_not_called()


async def test_microphone_gate_waits_for_real_pcm_and_releases_its_probe(monkeypatch):
    from livekit import rtc
    from gpt_live_experiment import wait_for_microphone
    events, callbacks, probes = [], {}, []
    participants = {}
    def on(name, callback): callbacks[name] = callback
    def off(name, callback): callbacks.pop(name)
    room = NS(remote_participants=participants, on=on, off=off)
    frame_ready = asyncio.Event()
    class Stream:
        def __init__(self, track, **kwargs):
            self.aclose = AsyncMock()
            probes.append(self)
        def __aiter__(self): return self
        async def __anext__(self):
            await frame_ready.wait()
            return NS(frame=NS(sample_rate=24000))
    monkeypatch.setattr(rtc, 'AudioStream', Stream)
    pending = asyncio.create_task(wait_for_microphone(room, lambda event, **kw: events.append((event, kw))))
    await asyncio.sleep(0)
    assert not pending.done()
    participants['demo-user'] = NS(track_publications={'mic':NS(track=NS(kind=rtc.TrackKind.KIND_AUDIO), muted=False)})
    callbacks['track_subscribed']()
    await asyncio.sleep(0)
    assert not pending.done(), 'A publication alone must not be reported as flowing audio'
    frame_ready.set()
    await pending
    probes[0].aclose.assert_awaited_once()
    assert not callbacks
    assert events[-1][0] == 'microphone_audio_ready'
    assert events[-1][1]['paid_voice_connection_started'] is False
