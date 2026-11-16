"""Replay the phone call's fragmented email and unrelated-acknowledgement failures."""
import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

import pytest
from livekit.agents import StopResponse, llm

from call_tasks import CallTasks
from callstate import CallState
from gemini_live_runtime import GeminiRuntime, memory_snapshot


def collecting():
    state = CallState(entities={'name':'Nila','date':'2026-12-03','time':'17:00','service':'Software'})
    state.set_pending('email', 'Please say your email address.')
    return state


def test_split_local_part_then_dot_and_domain_keeps_every_earlier_character():
    state = collecting()
    state.observe_user('ACME twenty.', 'one')
    assert 'email' not in state.entities
    state.observe_user('dot V S at example dot test.', 'two')
    assert state.entities['email'] == 'acme20.vs@example.test'
    assert state.entities['email_confirmed'] == 'no'
    assert state.entities['service'] == 'Software'


def test_chunked_local_words_and_digits_are_not_replaced_by_the_numeric_tail():
    state = collecting()
    state.observe_user('NILA', 'one')
    state.observe_user('TEAM', 'two')
    state.observe_user('one seven one one at example dot test.', 'three')
    assert state.entities['email'] == 'nilateam1711@example.test'


def test_complete_spoken_local_words_are_not_silently_dropped():
    state = collecting()
    state.observe_user('Nila Team 1711@example.test.', 'one')
    assert state.entities['email'] == 'nilateam1711@example.test'


def test_model_cannot_replace_a_complete_address_with_a_fragment_and_inherited_domain():
    state = collecting()
    state.observe_user('nilateam1711@example.test', 'one')
    state.observe_user('A B I.', 'two')
    result = state.apply_understood_details(turn_id=state.user_turn_id, evidence='A B I.',
        values={'email':'abi@example.test'})
    assert state.entities['email'] == 'nilateam1711@example.test', result
    assert state.entities.get('email_confirmed') != 'yes'


def test_digits_only_correction_keeps_the_supplied_local_prefix_and_domain():
    state = collecting()
    state.observe_user('nilateam1717@example.test', 'one')
    state.observe_user('one one one இல்லை one seven one one at example dot test.', 'two')
    assert state.entities['email'] == 'nilateam1711@example.test'
    assert state.entities['email_confirmed'] == 'no'


async def test_native_yes_after_could_not_hear_is_not_approval_of_an_unspoken_candidate():
    state = collecting()
    runtime = make_runtime(state)
    try:
        state.observe_user('nilateam1711@example.test', 'one')
        state.observe_assistant('Abhi and Anbu புரியுது, email இன்னொரு முறை சொல்ல முடியுமா?')
        state.observe_user('Yeah.', 'two')
        result = state.apply_understood_details(turn_id=state.user_turn_id, evidence='Yeah.',
            values={}, confirmed_field='email')
        assert state.entities.get('email_confirmed') != 'yes', result
        assert state.pending_slug == 'email_confirmation'
    finally:
        await runtime.close()


def make_runtime(state):
    return GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile={'metadata':{'voiceRuntime':{'engine':'gemini-live'}}},system_prompt='Synthetic policy',
        state=state, owner=NS(work=CallTasks(state)),tools=[],keys={'google':'synthetic'},
        language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None,
        input_stt=NS(model='synthetic',aclose=AsyncMock()))


async def test_phone_commit_sends_current_memory_before_requesting_a_reply():
    state = collecting()
    runtime = make_runtime(state)
    order = []
    contexts = []
    async def capture(context):
        order.append('memory')
        contexts.append(context)
    runtime.agent.update_chat_ctx = AsyncMock(side_effect=capture)
    runtime.session.generate_reply = Mock(side_effect=lambda **kw: order.append('reply'))
    runtime._response_busy = True  # the SDK marks thinking before this hook
    message = llm.ChatContext().add_message(role='user',content='ACME twenty.')
    try:
        with pytest.raises(StopResponse):
            await runtime.agent.on_user_turn_completed(llm.ChatContext(),message)
        assert order == ['memory','reply']
        memory = json.loads(contexts[0].items[-1].text_content.split('\n',1)[1])
        assert memory['entities']['name'] == 'Nila'
        assert memory['email_spelled_local'] == 'acme20'
        assert json.loads(memory_snapshot(state))['entities']['service'] == 'Software'
    finally:
        await runtime.close()


async def test_full_native_readback_then_approval_is_accepted_once():
    state = collecting()
    runtime = make_runtime(state)
    try:
        state.observe_user('ACME twenty.', 'one')
        state.observe_user('dot V S at example dot test.', 'two')
        state.observe_assistant('a c m e 2 0 dot v s @ example.test, correct?')
        state.observe_user('Correct super.', 'three')
        assert state.entities['email'] == 'acme20.vs@example.test'
        assert state.entities['email_confirmed'] == 'yes'
        assert state.pending_slug is None
        assert state.entities['name'] == 'Nila'
    finally:
        await runtime.close()


def test_an_explicit_new_email_discards_only_the_old_draft():
    state = collecting()
    state.observe_user('OLD twenty.', 'one')
    state.observe_user('நான் வேற email சொல்றேன்.', 'two')
    state.observe_user('newperson@example.test', 'three')
    assert state.entities['email'] == 'newperson@example.test'
    assert state.entities['date'] == '2026-12-03'


def test_explicit_tamil_email_label_can_supply_a_complete_literal_address():
    state = collecting()
    state.observe_user('என்னோட email nila43@example.test.', 'one')
    assert state.entities['email'] == 'nila43@example.test'


def test_non_ascii_local_words_cannot_be_dropped_to_promote_only_the_numeric_tail():
    state = collecting()
    state.observe_user('நிலா அன்பு 1711@example.test.', 'one')
    assert not state.entities.get('email')


@pytest.mark.parametrize('value', ['.vs@example.test','name..part@example.test','name.@example.test'])
def test_invalid_local_parts_cannot_become_mail_recipients_through_the_model(value):
    state = collecting()
    state.observe_user(value, 'one')
    result = state.apply_understood_details(turn_id=state.user_turn_id,evidence=value,values={'email':value})
    assert not state.entities.get('email'), result


async def test_email_repair_cannot_create_another_appointment_at_a_different_time(monkeypatch):
    import tools
    state = collecting()
    state.contact_repair = True
    owner = tools.AppointmentTools(NS(room=NS(name='offline')), 'synthetic-phone', call_state=state)
    owner._last_booking_id = 'EXISTING-TEST'
    owner._last_booking_time = '2026-12-03T17:00:00+05:30'
    calendar = AsyncMock(side_effect=AssertionError('Email repair must not create another booking'))
    monkeypatch.setattr(tools,'calcom_book',calendar)
    result = await owner.book_appointment('Nila','2026-12-04','09:00','Software','new@example.test')
    assert result.booking_id == 'EXISTING-TEST'
    assert result.status == 'existing_booking_unchanged'
    calendar.assert_not_awaited()
