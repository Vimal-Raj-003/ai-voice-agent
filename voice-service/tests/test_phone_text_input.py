"""Real Google protocol adapter, but no model connection or STT upload."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock
import pytest
from google.genai import types
from livekit import rtc
from livekit.agents import llm, StopResponse
from phone_text_input import PhoneTextModel, PhoneTextSession
from gemini_live_runtime import GeminiRuntime, create_phone_runtime
from callstate import CallState
from call_tasks import CallTasks
import asyncio
import time


def arguments():
    state=CallState(language='ta')
    return dict(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile={'id':'synthetic','metadata':{'voiceRuntime':{'engine':'gemini-live',
            'model':'gemini-3.1-flash-live-preview','voice':'Despina'}}},
        system_prompt='Saved business policy',state=state,owner=NS(work=CallTasks(state)),
        tools=[],keys={'google':'synthetic','sarvam':'synthetic'},language_state=None,
        route=None,log=Mock(),vad=None,carrier_pattern=None)


async def test_text_input_discards_pcm_and_keeps_real_google_text_and_voice_protocol(monkeypatch):
    monkeypatch.setattr(PhoneTextSession,'_main_task',AsyncMock())
    model=PhoneTextModel(model='gemini-3.1-flash-live-preview',voice='Despina',api_key='synthetic',
        input_audio_transcription=None,realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)))
    session=model.session()
    try:
        assert not model.capabilities.turn_detection and not model.capabilities.user_transcription
        assert model.capabilities.audio_output and model.capabilities.mutable_chat_context
        send=Mock();session._send_client_event=send
        frame=rtc.AudioFrame.create(16000,1,320)
        for _ in range(5):session.push_audio(frame)
        session.commit_audio();session.clear_audio()
        send.assert_not_called()
        session._active_session=NS()
        context=llm.ChatContext.empty()
        context.add_message(role='user',content='எந்த மாதிரி உதவிகள் பண்ணுவீங்க?')
        await session.update_chat_ctx(context)
        events=[call.args[0] for call in send.call_args_list]
        assert len(events)==1
        assert events[0].turns[0].role=='user'
        assert events[0].turns[0].parts[0].text=='எந்த மாதிரி உதவிகள் பண்ணுவீங்க?'
        assert events[0].turns[0].parts[0].inline_data is None
        assert model.model=='gemini-3.1-flash-live-preview' and model._opts.voice=='Despina'
        pending=session.generate_reply()
        assert send.call_args.args[0].turn_complete is True
        pending.cancel()
    finally:
        session._active_session=None
        await session.aclose();await model.aclose()


async def test_phone_barge_in_never_sends_audio_activity_without_audio(monkeypatch):
    """Exercise the real methods AgentActivity calls on speech start/end."""
    monkeypatch.setattr(PhoneTextSession, '_main_task', AsyncMock())
    model = PhoneTextModel(model='gemini-3.1-flash-live-preview', api_key='synthetic',
        realtime_input_config=types.RealtimeInputConfig(
            automatic_activity_detection=types.AutomaticActivityDetection(disabled=True)))
    session = model.session()
    send = Mock()
    session._send_client_event = send
    try:
        session.start_user_activity()
        session.interrupt()
        session.commit_audio()
        pending = session.generate_reply()
        events = [call.args[0] for call in send.call_args_list]
        pending.cancel()
        assert not any(isinstance(event, types.LiveClientRealtimeInput) for event in events), (
            'Text-only caller turns must not open/end an empty audio activity; Google closes 1007')
        assert events[-1].turn_complete is True
    finally:
        await session.aclose()
        await model.aclose()


async def test_recognized_phone_turn_is_forwarded_once_before_sdk_discards_it():
    """The installed AgentActivity drops STT messages after this hook returns."""
    runtime = GeminiRuntime(**arguments(), input_stt=NS(model='synthetic', aclose=AsyncMock()))
    runtime.session.generate_reply = Mock()
    message = llm.ChatContext().add_message(role='user', content='What services do you offer?')
    try:
        with pytest.raises(StopResponse):
            await runtime.agent.on_user_turn_completed(llm.ChatContext(), message)
        runtime.session.generate_reply.assert_called_once()
        assert runtime.session.generate_reply.call_args.kwargs['user_input'] is message
        assert runtime.state.user_turn_id == 1
    finally:
        await runtime.close()


async def test_repeated_phone_words_before_sdk_commit_are_still_two_caller_turns():
    runtime = GeminiRuntime(**arguments(), input_stt=NS(model='synthetic', aclose=AsyncMock()))
    runtime.session.generate_reply = Mock()
    try:
        for _ in range(2):
            message = llm.ChatContext().add_message(role='user', content='Can you hear me?')
            with pytest.raises(StopResponse):
                await runtime.agent.on_user_turn_completed(llm.ChatContext(), message)
        assert runtime.state.user_turn_id == 2
        for _ in range(2):
            committed = llm.ChatContext().add_message(role='user', content='Can you hear me?')
            runtime.item(NS(item=committed))
        assert runtime.state.user_turn_id == 2  # recreated SDK items aren't new speech
        assert runtime.session.generate_reply.call_count == 2
    finally:
        await runtime.close()


async def test_real_sdk_turn_commit_forwards_phone_words_without_an_empty_second_reply(monkeypatch):
    """Run installed AgentActivity -> hook -> realtime reply -> Google encoder."""
    from livekit.agents.voice.audio_recognition import _EndOfTurnInfo, _EndOfTurnMetrics
    monkeypatch.setattr(PhoneTextSession, '_main_task', AsyncMock())
    runtime = GeminiRuntime(**arguments(), input_stt=NS(model='synthetic', aclose=AsyncMock()))
    # No input stream is connected: exercise committed STT delivery, not a provider.
    runtime.session._stt = None
    try:
        await runtime.session.start(runtime.agent)
        activity = runtime.session._activity
        real = activity._rt_session
        real._active_session = NS()
        send = Mock()
        real._send_client_event = send
        messages = ['Please explain the services, not an appointment.', 'My name is Nila.', 'My name is Nila.']
        for number, message in enumerate(messages, 1):
            real.start_user_activity()
            real.interrupt()
            now = time.time()
            activity.on_end_of_turn(_EndOfTurnInfo(skip_reply=False, new_transcript=message,
                transcript_confidence=1, metrics=_EndOfTurnMetrics(started_speaking_at=now-1,
                    stopped_speaking_at=now, transcription_delay=0., end_of_turn_delay=.45)))
            for _ in range(60):
                if sum(bool(getattr(call.args[0], 'turn_complete', False)) for call in send.call_args_list) == number:
                    break
                await asyncio.sleep(.01)
            assert runtime.state.user_turn_id == number
        events = [call.args[0] for call in send.call_args_list]
        words = [part.text for event in events if isinstance(event, types.LiveClientContent)
                 for turn in event.turns or [] for part in turn.parts or []]
        # SDK versions may add a control placeholder; caller text must survive
        # verbatim and in order, including a genuinely repeated second utterance.
        assert [word for word in words if word != '.'] == messages
        assert sum(bool(getattr(event, 'turn_complete', False)) for event in events) == len(messages)
        assert not any(isinstance(event, types.LiveClientRealtimeInput) for event in events)
        assert [item.text_content for item in runtime.agent.chat_ctx.messages()
                if item.role == 'user'] == messages
    finally:
        if runtime.session._activity:
            runtime.session._activity._rt_session._active_session = None
        await runtime.close()


async def test_phone_room_uses_stt_sample_rate_and_valid_gain_control_frames():
    from livekit.agents import RoomInputOptions
    runtime = GeminiRuntime(**arguments(), input_stt=NS(model='synthetic', aclose=AsyncMock()))
    runtime.session.start = AsyncMock()
    caller_kinds = [rtc.ParticipantKind.PARTICIPANT_KIND_SIP]
    inputs = RoomInputOptions(participant_kinds=caller_kinds, close_on_disconnect=False)
    try:
        await runtime.start(room_input_options=inputs)
        actual = runtime.session.start.await_args.kwargs['room_input_options']
        assert actual.audio_sample_rate == 16000
        assert actual.audio_frame_size_ms == 10, 'The default 50 ms frames violate APM.process_stream\'s 10 ms contract'
        assert actual.participant_kinds == caller_kinds
        assert actual.close_on_disconnect is False
        assert actual.noise_cancellation is inputs.noise_cancellation
        assert inputs.audio_sample_rate == 24000  # caller-owned settings were not mutated
    finally:
        await runtime.close()


async def test_phone_factory_selects_sarvam_only_when_explicitly_enabled(monkeypatch):
    monkeypatch.setenv('GEMINI_PHONE_INPUT','sarvam')
    values=arguments();values.pop('vad')
    runtime=await create_phone_runtime(vad_factory=lambda:None,**values)
    try:
        assert runtime.input_stt is not None
        assert isinstance(runtime.voice,PhoneTextModel)
        assert runtime.session._jj_stt_provider=='sarvam'
        assert not runtime.voice.capabilities.turn_detection
        runtime.stt_audio_seconds=12.5
        usage=runtime.usage_snapshot()
        assert usage['speechInput']=={'provider':'sarvam','model':runtime.input_stt.model,
            'seconds':12.5,'source':'forwarded_audio_frames'}
        assert usage['tokens']['inputAudio']==0
    finally:await runtime.close()


async def test_stt_meter_counts_forwarded_audio_not_room_elapsed_time(monkeypatch):
    from livekit.agents import Agent
    async def recognize(agent,audio,settings):
        async for _ in audio:pass
        yield 'recognized text'
    monkeypatch.setattr(Agent.default,'stt_node',staticmethod(recognize))
    runtime=GeminiRuntime(**arguments(),input_stt=NS(model='saaras:v4',aclose=AsyncMock()))
    async def frames():
        for _ in range(3):yield rtc.AudioFrame.create(16000,1,320)
    try:
        assert [ev async for ev in runtime.agent.stt_node(frames(),None)]==['recognized text']
        assert abs(runtime.stt_audio_seconds-.06)<1e-9
        assert runtime.usage_snapshot()['speechInput']['seconds']==.06
    finally:await runtime.close()
    demo=GeminiRuntime(**arguments(),sandbox=True)
    try:
        assert demo.input_stt is None and demo.voice.capabilities.turn_detection
        assert 'speechInput' not in demo.usage_snapshot()
    finally:await demo.close()


async def test_missing_stt_key_never_falls_back_to_misrecognizing_phone_audio(monkeypatch):
    from gpt_live_gate import ExperimentRejected
    monkeypatch.setenv('GEMINI_PHONE_INPUT','sarvam')
    monkeypatch.delenv('SARVAM_API_KEY',raising=False)
    values=arguments();values.pop('vad');values['keys'].pop('sarvam')
    with pytest.raises(ExperimentRejected,match='Sarvam credential'):
        await create_phone_runtime(vad_factory=lambda:None,**values)


async def test_transcribed_carrier_announcement_stops_before_model_generation():
    import re
    values=arguments();values['carrier_pattern']=re.compile('being recorded')
    fake_stt=NS(model='synthetic',aclose=AsyncMock())
    runtime=GeminiRuntime(**values,input_stt=fake_stt)
    try:
        message=llm.ChatContext().add_message(role='user',content='This call is now being recorded.')
        with pytest.raises(StopResponse):await runtime.agent.on_user_turn_completed(None,message)
        assert runtime.state.user_turn_id==0
    finally:await runtime.close()
