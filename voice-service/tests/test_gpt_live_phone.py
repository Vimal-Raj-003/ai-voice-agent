"""Offline phone integration; SIP and model network tasks never connect."""
import asyncio
import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

import pytest
from livekit import rtc
from livekit.agents import llm

from gpt_live_gate import configured_voice, phone_enabled, ExperimentRejected
from gpt_live_phone import phone_instructions


def test_phone_selection_is_server_owned_and_assistant_scoped():
    enabled = dict(GPT_LIVE_PHONE_ENABLED='true', GPT_LIVE_PHONE_ASSISTANT_IDS='selected')
    assert not phone_enabled('selected', '+910000000000', {})
    assert phone_enabled('selected', '+910000000000', enabled)
    assert not phone_enabled('other', '+910000000000', enabled)
    assert not phone_enabled('selected', 'demo', enabled)
    assert not phone_enabled('selected', 'unknown', enabled)
    assert not phone_enabled(None, '+910000000000', enabled)
    assert not phone_enabled('selected', '+910000000000', dict(GPT_LIVE_PHONE_ENABLED='true'))
    assert configured_voice({'GPT_LIVE_VOICE':'gleam'}) == 'gleam'
    with pytest.raises(ExperimentRejected): configured_voice({'GPT_LIVE_VOICE':'kavya'})


def test_browser_custom_voice_does_not_change_phone_voice():
    env = {'GPT_LIVE_VOICE': 'gleam', 'GPT_LIVE_TEST_VOICE_ID': 'voice_TamilCandidate123'}
    assert configured_voice(env) == 'gleam'
    assert configured_voice(env, browser_test=True) == {'id': 'voice_TamilCandidate123'}
    env['GPT_LIVE_VOICE_ID'] = 'voice_ReviewedTamil456'
    assert configured_voice(env) == {'id': 'voice_ReviewedTamil456'}
    assert configured_voice(env, browser_test=True) == {'id': 'voice_TamilCandidate123'}


@pytest.mark.parametrize('voice_id', ['voice_', 'https://example.test/voice', '../voice_123', 'voice_' + 'x' * 161])
def test_invalid_custom_voice_does_not_silently_fall_back(voice_id):
    with pytest.raises(ExperimentRejected):
        configured_voice({'GPT_LIVE_VOICE_ID': voice_id})


async def test_installed_sdk_accepts_custom_voice_without_opening_audio():
    from livekit.plugins.openai.realtime import GPTLiveModel
    selected = configured_voice({'GPT_LIVE_VOICE_ID': 'voice_TamilCandidate123'})
    model = GPTLiveModel(voice=selected, api_key='synthetic', delegation='client')
    try:
        assert model._opts.voice == {'id': 'voice_TamilCandidate123'}
    finally:
        await model.aclose()


def test_native_prompt_preserves_saved_rules_and_direction():
    inbound = phone_instructions('SAVED: Discuss maintenance before collecting a name.', 'INBOUND')
    outbound = phone_instructions('SAVED: Discuss maintenance before collecting a name.', 'OUTBOUND')
    assert inbound.startswith('SAVED:') and outbound.startswith('SAVED:')
    assert 'caller called us' in inbound
    assert 'business initiated this call' in outbound
    assert '<|SpawnThinking|>' in inbound
    assert 'Default to Tamil' not in inbound


@pytest.mark.parametrize('direction', ['INBOUND', 'OUTBOUND'])
@pytest.mark.parametrize('engine', ['gpt-live', 'gemini-live'])
async def test_actual_phone_entrypoint_keeps_sip_tools_recording_and_transcripts(monkeypatch, mock_pool, direction, engine):
    import agent as ag
    import gpt_live_phone as native
    if engine == 'gemini-live':
        import gemini_live_runtime as native
    import observability
    from livekit.plugins.openai.realtime import gpt_live_model as sdk
    from assistant_controls import CallLimits
    phone, aid = '+910000000000', 'synthetic-assistant'
    monkeypatch.setenv('GPT_LIVE_PHONE_ENABLED', 'true')
    monkeypatch.setenv('GPT_LIVE_PHONE_ASSISTANT_IDS', aid)
    monkeypatch.setenv('GPT_LIVE_VOICE', 'gleam')
    monkeypatch.setenv('VOICE_TEST_READ_ONLY', 'false')
    monkeypatch.setenv('ENABLE_BVC_TELEPHONY', 'false')
    monkeypatch.setattr(observability, 'start_log_drain', lambda: None)
    monkeypatch.setattr(observability, 'attach_sdk_log_bridge', lambda: None)
    monkeypatch.setattr(ag, 'is_rate_limited', lambda _: False)
    monkeypatch.setattr(ag, '_extract_caller_phone', lambda *a: (phone, ''))
    monkeypatch.setattr(ag, '_load_caller_history', AsyncMock(return_value='Synthetic prior website issue'))
    profile = dict(id=aid, name='Synthetic assistant', _profile_source='assistant', model='qwen/qwen3-30b-a3b-instruct-2507',
                   llm_provider='openrouter', system_prompt='SAVED RULE: help with website maintenance.',
                   first_message='வணக்கம் {business_name}', enabled_tools=[], recording_enabled=True,
                   recording_consent_message='This call is recorded.', max_duration_seconds=60)
    if engine == 'gemini-live':
        profile['metadata'] = {'voiceRuntime': {'engine': 'gemini-live', 'voice': 'Zephyr', 'model': 'gemini-3.8-live'}}
    monkeypatch.setattr(ag, '_resolve_profile', AsyncMock(return_value=profile))
    monkeypatch.setattr(ag.knowledge, 'get_brain_digest', AsyncMock(return_value=''))
    monkeypatch.setattr(ag.knowledge, 'has_knowledge', AsyncMock(return_value=False))
    monkeypatch.setattr(ag.provider_credentials, 'load_for_org', AsyncMock(return_value={'openai':'synthetic', 'google':'synthetic'}))
    monkeypatch.setattr(ag.db, 'get_phone_number_routing', AsyncMock(return_value={'assistantId':aid}))
    monkeypatch.setattr(ag.db, 'get_human_transfer_targets', AsyncMock(return_value={}))
    monkeypatch.setattr(ag.db, 'get_assistant_tools', AsyncMock(return_value=[]))
    monkeypatch.setattr(ag.db, 'create_call_row', AsyncMock(return_value='synthetic-call'))
    monkeypatch.setattr(ag.db, 'upsert_active_call', AsyncMock())
    monkeypatch.setattr(ag.db, 'is_on_dnd', AsyncMock(return_value=False))
    monkeypatch.setattr(ag.db, 'get_setting', AsyncMock(return_value='redacted_only'))
    monkeypatch.setattr(ag.db, 'insert_transcript_message', AsyncMock())
    monkeypatch.setattr(ag.db, 'set_sip_call_identity', AsyncMock())
    legacy = Mock(side_effect=AssertionError('Legacy STT/LLM/TTS must not start'))
    monkeypatch.setattr(ag, '_build_session', legacy)
    monkeypatch.setattr(ag, '_build_fallback_llm', legacy)
    monkeypatch.setattr(ag, '_shared_vad', lambda: None)
    monkeypatch.setattr(ag, '_install_shutdown_tracer', lambda *a: {})
    monkeypatch.setattr(ag, '_run_diagnostic_audio', AsyncMock())
    monkeypatch.setattr(CallLimits, 'start', Mock())
    original_shutdown = AsyncMock()
    monkeypatch.setattr(ag, '_shutdown_hook', original_shutdown)
    backend = NS(aclose=AsyncMock())
    if engine == 'gpt-live':
        monkeypatch.setattr(native, 'build_backend', lambda *a: (backend, 'openrouter', profile['model']))
    monkeypatch.setattr(sdk.GPTLiveSession, '_main_task', AsyncMock())
    rec = NS(write_agent_frame=Mock(), attach_caller_track=Mock())
    recorded = []
    async def start_recording(ctx, prof, owner):
        assert owner._answered_mono is not None
        owner._recorder = rec
        recorded.append(owner)
    monkeypatch.setattr(ag, '_maybe_start_recording', start_recording)

    class Room(rtc.EventEmitter):
        def __init__(self):
            super().__init__()
            self.name = 'synthetic-phone-room'
            self.remote_participants = {}
            self.metadata = ''
            self.disconnect = AsyncMock()
    class FakeAgent:
        def __init__(self, **kwargs): self.instructions = kwargs['instructions']
    class Session(rtc.EventEmitter):
        def __init__(self, **kwargs):
            super().__init__()
            self.kwargs = kwargs
            self.options = NS(endpointing=None, interruption=None)
            self.output = NS(audio=rtc.EventEmitter())
            self.current_speech = NS(id='native-speech')
            self.aclose = AsyncMock()
            self._activity = None
            self.say = Mock(side_effect=AssertionError('Native voice must not use legacy say/TTS'))
            self.generate_reply = Mock()
        def _is_closing(self): return False
        async def start(self, *, agent, room, room_input_options):
            self._activity = object()
            self.agent, self.input_options = agent, room_input_options
            agent.session = self
            if engine == 'gpt-live':
                agent.duplex_session = self.duplex = sdk.GPTLiveSession(self.kwargs['llm'])
                self.duplex.on('input_audio_transcription_completed', lambda ev: self.emit('user_input_transcribed', ev))
                await agent.on_enter()
    monkeypatch.setattr(native, 'Agent', FakeAgent)
    monkeypatch.setattr(native, 'AgentSession', Session)
    room = Room()
    sip = NS(identity='sip_synthetic', kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP,
             attributes={'sip.calledNumber':'+918065481576', 'sip.callIDFull':'synthetic-sip-id'}, track_publications={})
    if direction == 'INBOUND': room.remote_participants['caller'] = sip
    async def dial(request):
        assert request.wait_until_answered is True
        room.remote_participants['caller'] = sip
    dialer = AsyncMock(side_effect=dial)
    callbacks = []
    ctx = NS(room=room, job=NS(metadata=json.dumps({'phone_number':phone, 'agent_profile_id':aid})),
             connect=AsyncMock(), shutdown=Mock(), add_shutdown_callback=callbacks.append,
             api=NS(sip=NS(create_sip_participant=dialer)))
    await ag.entrypoint(ctx)
    assert dialer.await_count == (direction == 'OUTBOUND')
    assert len(recorded) == 1
    owner = recorded[0]
    runtime = owner._gpt_live_runtime
    session = runtime.session
    assert session.input_options.participant_kinds == [rtc.ParticipantKind.PARTICIPANT_KIND_SIP]
    assert 'stt' not in session.kwargs and 'tts' not in session.kwargs
    if engine == 'gpt-live':
        assert session.kwargs['tools'] == []
        assert runtime.voice_name == 'gleam' and runtime.bridge.sandbox is False
        assert 'book_appointment' in {t.info.name for t in runtime.bridge.tools}
    else:
        assert runtime.voice_name == 'Zephyr' and runtime.sandbox is False
        assert 'book_appointment' in {t.info.name for t in runtime.tools}
    assert 'Synthetic prior website issue' in runtime.agent.instructions
    session.generate_reply.assert_called_once()
    assert 'INBOUND' in runtime.agent.instructions if direction == 'INBOUND' else 'OUTBOUND' in runtime.agent.instructions
    # Replay native speech, final transcript and output events after the shared call setup.
    if engine == 'gpt-live':
        session.duplex._handle_transcript_delta('user', NS(delta='Friday 12 noon', start_ms=0, end_ms=100))
    else:
        session.emit('user_input_transcribed', NS(transcript='Friday 12 noon', is_final=True))
        runtime._flush_transcript()
    frame = rtc.AudioFrame.create(24000, 1, 2400)
    if engine == 'gpt-live':
        for _ in range(15): session.duplex.push_audio(frame)
    assert runtime.state._last_observed_user == 'Friday 12 noon'
    async def pcm(): yield frame
    assert [f async for f in runtime.agent.realtime_audio_output_node(pcm(), None)] == [frame]
    rec.write_agent_frame.assert_called_once_with(frame)
    session.output.audio.emit('playback_started', NS(created_at=0))
    session.output.audio.emit('playback_finished', NS(playback_position=0.1, interrupted=True))
    assert owner.interrupt_count == 1
    message = llm.ChatContext().add_message(role='assistant', content='The current time is noon.')
    session.emit('conversation_item_added', NS(item=message))
    await asyncio.sleep(0)
    ag.db.insert_transcript_message.assert_awaited_once()
    await callbacks[-1]()
    original_shutdown.assert_awaited_once()
    await runtime.close()
    await runtime.close()
    await asyncio.sleep(0.25)  # Let the mocked knowledge prewarm finish.
    session.aclose.assert_awaited_once()
    if engine == 'gpt-live':
        backend.aclose.assert_awaited_once()
    else:
        backend.aclose.assert_not_awaited()
    legacy.assert_not_called()


async def test_native_committed_action_survives_interruption_and_shutdown():
    from callstate import CallState
    from call_tasks import CallTasks
    from gpt_live_experiment import DelegationBridge
    committed, release = asyncio.Event(), asyncio.Event()
    writes = []
    state = CallState(language='ta')
    owner = NS(work=CallTasks(state))
    @llm.function_tool
    async def synthetic_action() -> str:
        committed.set()
        await release.wait()
        writes.append('settled')
        return 'Verified operation completed.'
    class Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        def __aiter__(self): return self.chunks()
        async def chunks(self):
            yield NS(delta=NS(content=None, tool_calls=[llm.FunctionToolCall(name='synthetic_action', arguments='{}', call_id='synthetic-write')]))
    bridge = DelegationBridge(state=state, owner=owner, tools=[synthetic_action],
        backend=NS(chat=lambda **kw: Stream()), backend_prompt='Synthetic test', assistant_id='synthetic',
        emit=lambda *a, **kw: None, sandbox=False)
    bridge.duplex = NS(append_commentary=Mock())
    bridge.transcript('Please perform the authorized action.', True)
    bridge.submit(NS(id='one', pending_transcript=''))
    await asyncio.wait_for(committed.wait(), 1)
    bridge.transcript('Actually answer a different question.', True)
    shutdown = asyncio.create_task(bridge.close())
    await asyncio.sleep(0)
    assert not shutdown.done() and owner.work.items[0].committed
    release.set()
    await asyncio.wait_for(shutdown, 1)
    assert writes == ['settled']
    bridge.duplex.append_commentary.assert_not_called()


async def test_voice_rate_seed_preserves_operator_rates(mock_pool):
    from provider_rates import ensure_gpt_live_rate
    await ensure_gpt_live_rate()
    sql, note = mock_pool.execute.call_args.args
    assert 'ON CONFLICT (provider, sku, kind) DO NOTHING' in sql
    assert "'gpt-live-1'" in sql and '0.05' in sql
    assert 'Full-duplex' in note


async def test_partial_speech_cancels_obsolete_lookup_without_changing_confirmed_state():
    from callstate import CallState
    from call_tasks import CallTasks
    from gpt_live_experiment import DelegationBridge
    state = CallState(language='ta')
    state.update_entity('date', '2026-11-06', confirmed=True)
    owner = NS(work=CallTasks(state))
    bridge = DelegationBridge(state=state, owner=owner, tools=[], backend=None, backend_prompt='',
        assistant_id='synthetic', emit=lambda *a, **kw: None, sandbox=False)
    started, cancelled = asyncio.Event(), asyncio.Event()
    async def lookup():
        started.set()
        try: await asyncio.Event().wait()
        finally: cancelled.set()
    waiter = asyncio.create_task(owner.work.run('availability', {}, lookup))
    await started.wait()
    snapshot = state.snapshot()
    bridge.transcript('Actually change the time', False)
    await asyncio.wait_for(cancelled.wait(), 1)
    await waiter
    assert state.snapshot() == snapshot
    await bridge.close()


async def test_native_shutdown_separates_session_duration_backend_and_carrier(monkeypatch, mock_pool):
    import time
    import agent as ag
    from tools import AppointmentTools
    from callstate import CallState
    ctx = NS(room=NS(name='synthetic-meter-room'), _jj_hangup_mono=160.0)
    owner = AppointmentTools(ctx, '+910000000000', call_state=CallState())
    owner._test_read_only = True  # Never send post-call messages during this test.
    owner._call_id = 'synthetic-meter-call'
    owner._call_start_time = time.time() - 60
    owner._answered_mono = 100.0
    owner._llm_route = NS(billing_provider='openrouter', billing_model='selected-backend')
    owner._usage_prompt_tokens, owner._usage_completion_tokens = 1200, 200
    owner._gpt_live_runtime = NS(close=AsyncMock(), provider_seconds=75.0, started_at=85.0,
                                 bridge=NS(requests=2))
    history = llm.ChatContext()
    history.add_message(role='user', content='Synthetic question')
    session = NS(history=history)
    complete = AsyncMock()
    monkeypatch.setattr(ag.db, 'complete_call', complete)
    monkeypatch.setattr(ag.db, 'remove_active_call', AsyncMock())
    monkeypatch.setattr(ag, '_close_job_db', AsyncMock())
    await ag._shutdown_hook(ctx, owner, session, {}, '+910000000000', '')
    values = complete.call_args.kwargs
    assert values['duration_seconds'] == 60  # SIP answer to hangup.
    assert values['stt_seconds'] == 75  # Provider-metered native session, separate from SIP duration.
    assert (values['stt_provider_used'], values['stt_sku_used']) == ('openai', 'gpt-live-1')
    assert values['tts_chars'] == 0 and values['tts_provider_used'] is None
    assert values['llm_provider_used'] == 'openrouter' and values['llm_input_tokens'] == 1200
    assert values['llm_output_tokens'] == 200
    owner._gpt_live_runtime.close.assert_awaited_once()
