"""Phone-call contact failures: synthetic recipients, no providers or real actions."""
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

import pytest

from callstate import CallState
from contact_corrections import correct_email_part, latest_email


def test_model_email_case_cannot_create_a_new_correction_or_uppercase_recipient():
    state = CallState()
    state.observe_user('My email is nila43@example.test', 'one')
    state.observe_user('yes', 'two')
    state.observe_user('NILA43@EXAMPLE.TEST', 'three')
    before = state.input_revision
    result = state.apply_understood_details(turn_id=state.user_turn_id,
        evidence='NILA43@EXAMPLE.TEST', values={'email':'NILA43@EXAMPLE.TEST'})
    assert state.entities['email'] == 'nila43@example.test', result
    assert state.entities['email_confirmed'] == 'yes'
    assert state.input_revision == before


def test_clear_tamil_english_confirmation_completes_one_email_readback():
    state = CallState()
    state.observe_user('nila43@example.test', 'one')
    state.observe_user('ம் correct தான் confirm.', 'two')
    assert state.entities['email_confirmed'] == 'yes'
    assert state.pending_slug is None


def test_tamil_unique_letter_correction_keeps_other_email_characters():
    assert correct_email_part('A D-ன்னு சொல்றீங்கல்ல D வராது A B வரும்.',
                              'adila43@example.test') == 'abila43@example.test'


def test_complete_spoken_letters_and_digits_are_not_truncated_to_the_last_word():
    assert latest_email('My email is N I L A four three at example dot test') == 'nila43@example.test'


def test_email_readback_is_restored_after_a_name_correction_took_the_pending_slot():
    state = CallState(entities={'name':'Nila'})
    state.observe_user('old@example.test', 'one')
    state.observe_user('My correct email is nila43@example.test', 'two')
    state.observe_user('My name is Nila S', 'three')
    state.apply_understood_details(turn_id=state.user_turn_id,
        evidence='My name is Nila S', values={'name':'Nila S'})
    state.set_pending('name_confirmation', 'Is Nila S correct?')
    state.observe_user('yes', 'four')
    state.observe_assistant('Your email is nila43@example.test. Is this correct?')
    assert state.pending_slug == 'email_confirmation'
    state.observe_user('ம் correct தான் confirm.', 'five')
    assert state.entities['email_confirmed'] == 'yes'


def test_spoken_preferred_name_does_not_store_the_instruction_as_part_of_the_name():
    state = CallState()
    state.observe_user('என் பேர் அபி அப்படின்னு போட்டுக்கோங்க.', 'one')
    assert state.entities['name'] == 'அபி'


def test_caller_can_choose_a_short_name_during_name_readback_without_changing_email():
    state = CallState(entities={'name':'Abinash', 'email':'nila43@example.test', 'email_confirmed':'yes'})
    state.set_pending('name_confirmation', 'Is Abinash correct?')
    state.observe_user('Abilash இல்லங்க Abhi. Abhi-ன்னு போட்டுக்கோங்க.', 'one')
    assert state.entities['name'] == 'Abhi'
    assert state.pending_slug == 'name_confirmation'
    assert state.entities['email_confirmed'] == 'yes'
    state.observe_user('ம் correct தான் confirm.', 'two')
    assert state.entities['name_confirmed'] == 'yes'


def test_contact_memory_has_exact_spelling_only_while_confirmation_is_needed():
    import json

    from gemini_live_runtime import memory_snapshot
    state = CallState()
    state.observe_user('n.i_la43@example.test', 'one')
    snapshot = json.loads(memory_snapshot(state))
    assert snapshot['email_readback'] == 'n dot i underscore l a 4 3 @ example.test'
    state.observe_user('yes', 'two')
    assert 'email_readback' not in json.loads(memory_snapshot(state))


async def test_native_booking_guard_is_an_error_not_a_successful_tool_result():
    from livekit.agents import llm
    from livekit.agents.llm.utils import prepare_function_arguments

    from gemini_live_runtime import GeminiRuntime
    from tools import AppointmentTools
    state = CallState()
    state.observe_user('nila43@example.test', 'one')
    ctx = NS(room=NS(name='offline'), add_shutdown_callback=Mock())
    state.tool_state['booking'] = 'confirmed:PRIOR-RECEIPT'
    owner = AppointmentTools(ctx, 'synthetic-phone', call_state=state)
    log = Mock()
    runtime = GeminiRuntime(ctx=ctx, profile={'metadata':{'voiceRuntime':{'engine':'gemini-live'}}},
        system_prompt='SYNTHETIC', state=state, owner=owner, tools=[owner.book_appointment],
        keys={'google':'synthetic'}, language_state=None, route=None, log=log, vad=None, carrier_pattern=None)
    runtime.ready.set()
    args, kwargs = prepare_function_arguments(fnc=runtime.tools[0], json_arguments={
        'name':'Nila','date':'2026-12-01','time':'11:00','service':'Consultation','email':'nila43@example.test'})
    try:
        with pytest.raises(llm.ToolError, match='BOOKING_NOT_CONFIRMED') as blocked:
            await runtime.tools[0](*args, **kwargs)
        assert 'Preserve any earlier verified booking' in str(blocked.value)
        assert state.tool_state['booking'] == 'confirmed:PRIOR-RECEIPT'
        assert any(c.args[0] == 'native_tool_result' and c.kwargs['status'] == 'not_confirmed'
                   for c in log.call_args_list)
        assert not owner._last_booking_id
    finally:
        await runtime.close()


@pytest.mark.parametrize('approval', ['ம் correct தான் confirm.', 'Correct super.'])
async def test_repaired_contact_books_once_and_emails_only_the_confirmed_lowercase_recipient(monkeypatch, approval):
    import asyncio

    import notify
    import tools
    from tools import AppointmentTools, BookingReceipt
    state = CallState(entities={'name':'Nila'})
    state.observe_user('old@example.test', 'one')
    state.observe_user('My correct email is N I L A four three at example dot test', 'two')
    state.observe_user(approval, 'three')
    owner = AppointmentTools(NS(room=NS(name='offline')), 'synthetic-phone', call_state=state)
    monkeypatch.setattr(tools, 'calcom_enabled', lambda: True)
    monkeypatch.setattr(tools, 'calcom_slot_free', AsyncMock(return_value=True))
    calendar = AsyncMock(return_value={'success':True,'uid':'CAL-TEST'})
    monkeypatch.setattr(tools, 'calcom_book', calendar)
    monkeypatch.setattr(tools.db, 'find_booked_appointment', AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, 'find_booked_slot', AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, 'check_slot', AsyncMock(return_value=True))
    insert = AsyncMock(return_value='LOCAL-TEST')
    monkeypatch.setattr(tools.db, 'insert_appointment', insert)
    sender = Mock(return_value=True)
    monkeypatch.setattr(notify, 'send_booking_confirmation_email', sender)
    result = await owner.book_appointment('Nila','2026-12-01','11:00','Consultation','NILA43@EXAMPLE.TEST')
    assert isinstance(result, BookingReceipt)
    assert result.booking_id == 'LOCAL-TEST'
    await asyncio.gather(*owner._bg_tasks)
    assert state.entities['email_delivery'] == 'sent'
    assert calendar.await_args.args[1] == 'nila43@example.test'
    assert insert.await_args.kwargs['email'] == 'nila43@example.test'
    assert sender.call_args.args[0] == 'nila43@example.test'
    duplicate = await owner.book_appointment('Nila','2026-12-01','11:00','Consultation','NILA43@EXAMPLE.TEST')
    assert isinstance(duplicate, BookingReceipt)
    calendar.assert_awaited_once()
    insert.assert_awaited_once()
    sender.assert_called_once()


def test_crm_export_never_promotes_an_unapproved_email_guess_to_a_contact():
    from contact_corrections import confirmed_contact_email
    state = CallState()
    state.observe_user('nila43@example.test', 'one')
    assert confirmed_contact_email(state) == ''
    state.observe_user('ம் correct தான் confirm.', 'two')
    assert confirmed_contact_email(state) == 'nila43@example.test'
    state.observe_user('My email is wrong', 'three')
    assert confirmed_contact_email(state) == ''
    assert confirmed_contact_email(None) == ''


async def test_booking_sender_reads_saved_smtp_settings_and_masks_the_password(monkeypatch):
    import smtplib

    import db
    import tools
    state = CallState(entities={'email':'nila43@example.test', 'email_confirmed':'yes'})
    owner = tools.AppointmentTools(NS(room=NS(name='offline')), 'synthetic-phone', call_state=state)
    owner._last_booking_id = 'LOCAL-TEST'
    owner._last_booking_name = 'Nila'
    owner._last_booking_time = '2026-12-01T11:00:00+05:30'
    owner._last_booking_service = 'Consultation'
    monkeypatch.setenv('SMTP_PASSWORD','old-env-secret')
    monkeypatch.setenv('RESEND_API_KEY','')
    pool = AsyncMock()
    pool.fetch.return_value = [{'key':'SMTP_HOST','value':'smtp.example.test'},
        {'key':'SMTP_USER','value':'sender@example.test'}, {'key':'SMTP_PASSWORD','value':'new-saved-secret'},
        {'key':'SMTP_PORT','value':'587'}]
    monkeypatch.setattr(db,'_pool',pool)
    server = Mock()
    smtp = Mock()
    smtp.return_value.__enter__ = Mock(return_value=server)
    smtp.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(smtplib,'SMTP',smtp)
    assert await owner._send_confirmation_email('nila43@example.test')
    server.login.assert_called_once_with('sender@example.test','new-saved-secret')
    assert server.send_message.call_args.args[0]['To'] == 'nila43@example.test'
    assert state.entities['email_delivery'] == 'sent'
    masked = await db.get_all_settings()
    assert masked['SMTP_PASSWORD']['value'] == ''
    assert masked['SMTP_PASSWORD']['configured'] is True


async def test_recipient_rejection_during_settings_lookup_cannot_start_email(monkeypatch):
    import notify
    import tools
    state = CallState(entities={'email':'nila43@example.test','email_confirmed':'yes'})
    owner = tools.AppointmentTools(NS(room=NS(name='offline')), 'synthetic-phone', call_state=state)
    async def changed():
        state.observe_user('My email is wrong', 'one')
        return {}
    monkeypatch.setattr(tools.db,'booking_email_settings',changed)
    sender = Mock()
    monkeypatch.setattr(notify,'send_booking_confirmation_email',sender)
    assert not await owner._send_confirmation_email('nila43@example.test')
    sender.assert_not_called()
