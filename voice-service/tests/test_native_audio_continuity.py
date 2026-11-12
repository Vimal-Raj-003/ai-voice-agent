"""Exercise the real RoomIO subtitle path, without connecting any room/model."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

from livekit import rtc
from livekit.agents import RoomInputOptions, RoomOutputOptions
from livekit.agents.voice.room_io.room_io import RoomIO
from callstate import CallState
from call_tasks import CallTasks
from gemini_live_runtime import GeminiRuntime


async def test_native_room_keeps_audio_and_transcripts_without_cpu_subtitle_estimator():
    state=CallState(language='ta')
    runtime=GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile={'id':'offline','metadata':{'voiceRuntime':{'engine':'gemini-live','model':'gemini-3.1-flash-live-preview','voice':'Zephyr'}}},
        system_prompt='Saved synthetic instructions.',state=state,owner=NS(work=CallTasks(state)),
        tools=[],keys={'google':'synthetic'},language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    # Before the repair, both native entrypoints use the SDK's default output.
    output=getattr(runtime,'room_output_options',RoomOutputOptions)()
    io=RoomIO(runtime.session,rtc.Room(),input_options=RoomInputOptions(audio_enabled=False),output_options=output)
    try:
        await io.start()
        assert io.audio_output is not None
        assert io.transcription_output is not None
        assert io._tr_synchronizer is None, 'CPU speaking-rate FFT is still wrapping live audio'
    finally:
        await io.aclose()
        await runtime.close()


async def test_native_start_passes_the_audio_policy_and_preserves_room_input():
    state=CallState(language='ta')
    room=NS(name='offline')
    runtime=GeminiRuntime(ctx=NS(room=room,add_shutdown_callback=Mock()),
        profile={'id':'offline','metadata':{'voiceRuntime':{'engine':'gemini-live','model':'gemini-3.1-flash-live-preview','voice':'Zephyr'}}},
        system_prompt='SAVED BUSINESS IDENTITY',state=state,owner=NS(work=CallTasks(state)),
        tools=[],keys={'google':'synthetic'},language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    runtime.session.start=AsyncMock()
    inputs=RoomInputOptions(participant_identity='actual-caller',close_on_disconnect=True)
    try:
        await runtime.start(room_input_options=inputs)
        passed=runtime.session.start.await_args.kwargs
        assert passed['room'] is room and passed['room_input_options'] is inputs
        assert passed['room_output_options'].sync_transcription is False
        assert runtime.voice.model=='gemini-3.1-flash-live-preview'
        assert runtime.voice_name=='Zephyr'
        assert runtime.agent.instructions.startswith('SAVED BUSINESS IDENTITY')
        state.entities={'email':'synthetic@example.com'}
        state.tool_state={'email_confirmed':'yes','booking':'confirmed receipt-123'}
        state.booking_hold=True
        memory=runtime.tool_memory()
        assert 'synthetic@example.com' in memory and 'confirmed receipt-123' in memory
        assert '"booking_hold":true' in memory and '"email_confirmed":"yes"' in memory
        assert '[CURRENT CALLER TURN' not in memory  # no repeated procedural block
    finally:
        await runtime.close()
