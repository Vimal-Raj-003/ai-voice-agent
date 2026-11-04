"""Call-derived regressions with synthetic contacts, no provider requests."""
from types import SimpleNamespace
from unittest.mock import MagicMock
import pytest
from callstate import CallState
from tools import AppointmentTools


def candidate():
    state = CallState(language='ta', entities={'service': 'existing website maintenance',
                                              'date': '2026-11-10', 'time': '11:00'})
    state.observe_user('nila@example.test')
    state.observe_assistant('nila@example.test சரியா?')
    return state


@pytest.mark.asyncio
async def test_unchanged_email_tool_value_cannot_force_another_spoken_confirmation():
    state = candidate()
    state.observe_user('ம் சரியா இருக்கு அனுப்புங்க email அனுப்புங்க.')
    owner = AppointmentTools(SimpleNamespace(), call_state=state)
    session = SimpleNamespace(say=MagicMock())
    await owner.update_call_details(turn_id=state.user_turn_id, field='email',
                                   value='nila@example.test', context=SimpleNamespace(session=session))
    session.say.assert_not_called()


def test_repeating_an_already_confirmed_address_does_not_reopen_readback():
    state = candidate()
    state.observe_user('Correct.')
    assert state.entities['email_confirmed'] == 'yes'
    state.observe_user('அதே nila@example.test தான், அதுக்கே அனுப்புங்க.')
    assert state.entities['email_confirmed'] == 'yes'
    assert state.pending_slug is None


def test_model_cannot_restore_a_rejected_address_without_new_caller_evidence():
    state = candidate()
    state.observe_user('இல்ல தப்பு.')
    result = state.apply_understood_details(turn_id=state.user_turn_id,
        evidence=state._last_observed_user, values={'email': 'nila@example.test'})
    assert 'Rejected' in result
    assert 'email' not in state.entities


def test_same_address_echo_does_not_refresh_the_pending_confirmation_turn():
    state = candidate()
    previous_turn = state.pending_set_turn
    state.observe_user('nila@example.test')
    assert state.pending_set_turn == previous_turn


def test_confirmed_email_reask_does_not_rearm_pending_state():
    state = candidate()
    state.observe_user('Correct.')
    state.observe_assistant('உங்கள் email சரியாக இருக்கிறதா?')
    assert state.pending_slug is None


def test_actual_inbound_direction_is_in_the_built_prompt():
    from assistant_prompts import profile_for_direction
    from prompts import build_prompt
    profile = profile_for_direction({'system_prompt': 'You are calling the lead. Ask if now is a good time.'}, 'INBOUND')
    prompt = build_prompt(custom_prompt=profile['system_prompt'], call_direction=profile['prompt_direction'])
    assert '[CALL DIRECTION: INBOUND]' in prompt
    assert 'caller initiated' in prompt


@pytest.mark.asyncio
async def test_ambiguous_or_question_turn_still_uses_model_not_automatic_confirmation():
    state = candidate()
    state.observe_user('email சரியா இருக்கான்னு எப்படி தெரியும்?')
    assert state.entities['email_confirmed'] != 'yes'
    assert state.pending_slug == 'email_confirmation'


@pytest.mark.parametrize('text', ['இல்ல தப்பு. nila@example.test', 'Wrong. nila@example.test',
                                 'nila @ example . test'])
def test_sentence_stop_is_not_part_of_the_replacement_email(text):
    from contact_corrections import latest_email
    assert latest_email(text) == 'nila@example.test'


@pytest.mark.asyncio
@pytest.mark.parametrize('claim', ['உங்களுக்கு ஒரு appointment ஏற்பாடு செய்துள்ளேன்.',
                                 'appointment புக் செய்து விட்டோம்.'])
async def test_observed_false_booking_wording_cannot_reach_speech(claim):
    from conversation_style import guard_verified_actions
    async def source():
        for word in claim.split(' '):
            yield word + ' '
    output = ''.join([part async for part in guard_verified_actions(source(), CallState(), read_only=True)])
    assert 'செய்துள்ளேன்' not in output and 'செய்து விட்டோம்' not in output
    assert 'Booking இன்னும் உறுதி செய்யலை' in output


def test_direction_selection_does_not_override_the_page_saved_greeting():
    from assistant_prompts import profile_for_direction, greeting_for_direction
    profile = {'system_prompt': 'Original inbound',
               'outbound_system_prompt': '[OUTBOUND ENQUIRY / APPOINTMENT FOLLOW-UP]'}
    original = 'வணக்கம், எப்படி உதவலாம்?'
    assert greeting_for_direction(profile_for_direction(profile, 'INBOUND'), original, 'Demo') == original
    outbound = greeting_for_direction(profile_for_direction(profile, 'OUTBOUND'), original, 'Demo')
    assert outbound == original
