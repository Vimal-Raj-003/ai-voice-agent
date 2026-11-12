"""Actual caller constraints reach existing state and action tools; no network."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock,Mock
import pytest
from callstate import CallState
from tools import AppointmentTools

@pytest.mark.parametrize('text',[
    'வேண்டாம், எனக்கு விருப்பம் இல்லை.',
    'I only want information. Not a booking.',
    'எனக்கு appointment வேண்டாம்.',
    'I am not interested.',
    'booking venam, details mattum sollunga',
    'book panna venam', 'book panna vendam', 'not book anything',
])
def test_decline_is_durable_and_never_becomes_a_service_or_name(text):
    state=CallState();state.set_pending('service','Which service?');state.observe_user(text,'one')
    assert state.booking_hold
    assert 'service' not in state.entities
    assert any(text in fact for fact in state.known_facts)

def test_declining_email_does_not_cancel_the_requested_appointment():
    state=CallState();state.set_pending('email','Your email?');state.observe_user('Email வேண்டாம்','one')
    assert not state.booking_hold

def test_model_state_tool_cannot_turn_tanglish_refusal_into_permission():
    state=CallState();state.observe_user('book panna venam','one')
    state.booking_hold=True
    state.apply_understood_details(turn_id=state.user_turn_id,evidence='book panna venam',
        values={'booking_permission':'allowed'})
    assert state.booking_hold

def test_answered_slots_are_preserved_when_caller_changes_topic():
    state=CallState();state.observe_user('My name is Arun','one')
    state.observe_assistant('What is your name?')
    assert state.pending_slug is None
    state.observe_user('எனக்கு நாளைக்கு.','two')
    assert state.entities['name']=='Arun'

@pytest.mark.parametrize('text',[
    'I have one more question.', 'Thanks', 'Okay',
    'Bye, but first I have one more question.', 'போன் கட் பண்ணாதீங்க, இன்னும் பேசணும்.',
    'Why did you say bye?', 'Do not end the call yet.',
])
async def test_end_call_cannot_disconnect_without_caller_finishing(text):
    state=CallState();state.observe_user(text,'one')
    ctx=NS(room=NS(name='offline',disconnect=AsyncMock()))
    owner=AppointmentTools(ctx,'synthetic',call_state=state)
    result=await owner.end_call('not_interested')
    assert 'open' in result.lower()
    ctx.room.disconnect.assert_not_awaited()

async def test_explicit_bye_uses_sdk_audio_drain_instead_of_cutting_audio():
    state=CallState();state.observe_user('Thanks, bye.','one')
    ctx=NS(room=NS(name='offline',disconnect=AsyncMock()))
    owner=AppointmentTools(ctx,'synthetic',call_state=state)
    owner._session=NS(shutdown=Mock())
    await owner.end_call('not_interested')
    owner._session.shutdown.assert_called_once_with(drain=True)
    ctx.room.disconnect.assert_not_awaited()

@pytest.mark.parametrize('sensitivity,minimum,expected',[
    ('LOW',200,650),('MEDIUM',200,450),('HIGH',200,250),('MEDIUM',1200,1200),
])
async def test_saved_speech_sensitivity_controls_native_endpointing(sensitivity,minimum,expected):
    from gemini_live_runtime import GeminiRuntime
    from call_tasks import CallTasks
    state=CallState();owner=NS(work=CallTasks(state))
    runtime=GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile={'metadata':{'voiceRuntime':{'engine':'gemini-live'}},
            'end_of_speech_sensitivity':sensitivity,'min_pause_ms':minimum},
        system_prompt='SAVED',state=state,owner=owner,tools=[],keys={'google':'synthetic'},
        language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    try:
        detection=runtime.voice._opts.realtime_input_config.automatic_activity_detection
        assert detection.silence_duration_ms==expected
        assert detection.prefix_padding_ms>=200
    finally:await runtime.close()
@pytest.mark.parametrize('text', [
    "Don't cancel my booking; change the email domain only.",
    'Appointment book pannunga. Email வேண்டாம்.',
    'Appointment book pannunga; email அனுப்ப வேண்டாம்.',
])
def test_optional_message_refusal_and_negated_cancellation_do_not_hold_booking(text):
    from caller_consent import booking_declined
    assert not booking_declined(text)
