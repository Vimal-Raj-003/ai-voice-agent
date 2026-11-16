"""Phone contact replays with synthetic recipients and no network requests."""
import pytest
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

from callstate import CallState


def collecting():
    state = CallState(entities={"name": "Nila", "service": "Software", "date": "2026-12-03", "time": "11:00"})
    state.require_email_readback = True
    state.set_pending("email", "Your email address?")
    return state


@pytest.mark.parametrize("readback", [
    "Nila T 43@example.test, இது சரியா?",
    "Nila T forty three at example dot test, இது சரியா?",
    "Your email is Nila T 43 at example dot test. Is that correct?",
])
def test_complete_natural_readback_accepts_one_approval_without_restarting_intake(readback):
    state = collecting()
    state.observe_user("Nila T 43@example.test.", "email")
    assert state.entities["email"] == "nilat43@example.test"
    state.observe_assistant(readback)
    state.observe_user("Correct super.", "approval")
    assert state.entities["email_confirmed"] == "yes"
    assert state.pending_slug is None
    assert state.entities["name"] == "Nila"
    assert state.entities["date"] == "2026-12-03"


@pytest.mark.parametrize("readback", [
    "Other Nila T 43@example.test, correct?",
    "T 43@example.test, correct?",
    "Nila T 34@example.test, correct?",
])
def test_different_or_suffix_only_readback_cannot_approve_recipient(readback):
    state = collecting()
    state.observe_user("Nila T 43@example.test", "email")
    state.observe_assistant(readback)
    state.observe_user("Correct.", "approval")
    assert state.entities["email_confirmed"] != "yes"


def test_phonetic_letters_continue_the_same_draft_without_example_words():
    state = collecting()
    state.observe_user("N for November, I for India", "first")
    assert state.email_spelled_local == "ni"
    state.observe_user("L for Lima, A for Apple, forty three at example dot test", "rest")
    assert state.entities["email"] == "nila43@example.test"
    assert state.entities["email_confirmed"] == "no"


def test_one_conflicting_phonetic_letter_does_not_store_a_guessed_recipient():
    state = collecting()
    state.observe_user("B for Delhi at example dot test", "unclear")
    assert not state.entities.get("email")


def test_spelling_offer_with_letters_in_same_turn_does_not_discard_the_letters():
    state = collecting()
    state.observe_user("old@example.test", "old")
    state.observe_user("I'll spell it: N I L A four three at example dot test", "replacement")
    assert state.entities["email"] == "nila43@example.test"
    assert state.entities["email_confirmed"] == "no"


def test_repeating_the_complete_spelled_draft_does_not_double_it():
    state = collecting()
    state.observe_user("N I", "first")
    state.observe_user("L A", "second")
    state.observe_user("N I L A", "repeat")
    state.observe_user("four three at example dot test", "domain")
    assert state.entities["email"] == "nila43@example.test"


def test_explicit_double_letter_is_still_kept():
    state = collecting()
    state.observe_user("N I double L A four three at example dot test", "email")
    assert state.entities["email"] == "nilla43@example.test"


def test_name_question_during_email_confirmation_does_not_append_name_to_email():
    state = collecting()
    state.entities.pop("name")
    state.observe_user("nila43@example.test", "email")
    state.observe_assistant("உங்க name என்ன?")
    state.observe_user("Malarvizhi", "name")
    assert state.entities["name"] == "Malarvizhi"
    assert state.entities["email"] == "nila43@example.test"
    assert not state.email_spelled_local


@pytest.mark.parametrize("answer, expected", [
    ("Malarvizhi", "Malarvizhi"),
    ("M A L A R", "MALAR"),
    ("M for Mumbai, A for Apple, L for Lima, A for Apple, R for Rose", "MALAR"),
])
def test_replacement_name_is_kept_in_name_confirmation(answer, expected):
    state = collecting()
    state.set_pending("name_confirmation", "Is Nila your name?")
    state.observe_user(answer, "correction")
    assert state.entities["name"] == expected
    assert state.pending_slug == "name_confirmation"


@pytest.mark.parametrize("answer", ["B for Delhi", "B as in Delhi"])
def test_conflicting_phonetic_example_is_not_saved_as_a_person_name(answer):
    state = collecting()
    state.set_pending("name_confirmation", "Is Nila your name?")
    state.observe_user(answer, "unclear")
    assert state.entities["name"] == "Nila"
    assert state.pending_slug == "name_confirmation"


def test_model_cannot_extract_contact_name_from_an_email_username():
    state = collecting()
    state.entities.pop("name")
    state.observe_user("Nila43@example.test", "email")
    result = state.apply_understood_details(turn_id=state.user_turn_id,
        evidence=state._last_observed_user, values={"name": "Nila"})
    assert "Rejected" in result
    assert not state.entities.get("name")


def test_model_cannot_promote_the_suffix_of_unclear_phonetic_spelling():
    state = collecting()
    state.observe_user("B for Delhi at example dot test", "unclear")
    result = state.apply_understood_details(turn_id=state.user_turn_id,
        evidence=state._last_observed_user, values={"email": "delhi@example.test"})
    assert "Rejected" in result
    assert not state.entities.get("email")


@pytest.mark.parametrize("correction", ["T இல்லை I", "T வராது I for India"])
def test_one_disputed_letter_can_be_replaced_without_repeating_the_address(correction):
    state = collecting()
    state.observe_user("nilat43@example.test", "email")
    state.observe_user(correction, "letter")
    assert state.entities["email"] == "nilai43@example.test"
    assert state.entities["email_confirmed"] == "no"


@pytest.mark.parametrize("readback", [
    "n i l a 4 3 @ example.test, இது கரெக்ட்டா?",
    "n i l a 4 3 @ example.test, is this right?",
    "n i l a 4 3 @ example.test, right",
])
def test_natural_confirmation_wording_is_recognized(readback):
    state = collecting()
    state.observe_user("nila43@example.test", "email")
    state.observe_assistant(readback)
    state.observe_user("Correct.", "approval")
    assert state.entities["email_confirmed"] == "yes"


async def test_native_tool_does_not_book_using_a_name_guessed_from_email(monkeypatch):
    from livekit.agents import llm
    from livekit.agents.llm.utils import prepare_function_arguments
    from gemini_live_runtime import GeminiRuntime
    from tools import AppointmentTools

    state = collecting()
    state.entities.pop('name')
    state.observe_user('nila43@example.test', 'email')
    state.observe_assistant('Nila43@example.test, correct?')
    state.observe_user('Correct.', 'approval')
    ctx = NS(room=NS(name='offline'), add_shutdown_callback=Mock())
    owner = AppointmentTools(ctx, 'synthetic-phone', call_state=state)
    submitted = AsyncMock(side_effect=AssertionError('An email is not evidence of the caller name'))
    monkeypatch.setattr(owner, '_book_appointment', submitted)
    voice = GeminiRuntime(ctx=ctx,profile={'metadata':{'voiceRuntime':{'engine':'gemini-live'}}},
        system_prompt='Synthetic',state=state,owner=owner,tools=[owner.book_appointment],
        keys={'google':'synthetic'},language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    voice.ready.set()
    args, kwargs = prepare_function_arguments(fnc=voice.tools[0], json_arguments={
        'name':'Nila','date':'2026-12-03','time':'11:00','service':'Software','email':'nila43@example.test'})
    try:
        with pytest.raises(llm.ToolError, match='caller name'):
            await voice.tools[0](*args, **kwargs)
        submitted.assert_not_awaited()
        assert state.pending_slug == 'name'
        assert state.entities['email_confirmed'] == 'yes'
    finally:
        await voice.close()


async def test_corrected_spelling_then_one_approval_books_and_queues_exact_recipient_once(monkeypatch):
    import asyncio
    import notify
    import tools
    state = collecting()
    state.observe_user('nilat43@example.test', 'candidate')
    state.observe_user('T இல்லை I for India', 'correction')
    state.observe_assistant('Nila I forty three at example dot test, இது சரியா?')
    state.observe_user('Correct super.', 'approval')
    assert state.entities['email_confirmed'] == 'yes'
    owner = tools.AppointmentTools(NS(room=NS(name='offline')), 'synthetic-phone', call_state=state)
    monkeypatch.setattr(tools, 'calcom_enabled', lambda: True)
    monkeypatch.setattr(tools, 'calcom_slot_free', AsyncMock(return_value=True))
    calendar = AsyncMock(return_value={'success':True,'uid':'SYNTHETIC-CALENDAR'})
    monkeypatch.setattr(tools, 'calcom_book', calendar)
    monkeypatch.setattr(tools.db, 'find_booked_appointment', AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, 'find_booked_slot', AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, 'check_slot', AsyncMock(return_value=True))
    insert = AsyncMock(return_value='SYNTHETIC-BOOKING')
    monkeypatch.setattr(tools.db, 'insert_appointment', insert)
    sender = Mock(return_value=True)
    monkeypatch.setattr(notify, 'send_booking_confirmation_email', sender)
    receipt = await owner.book_appointment('Wrong model name', '2026-12-03','11:00','Software','NILAT43@EXAMPLE.TEST')
    assert isinstance(receipt, tools.BookingReceipt)
    await asyncio.gather(*owner._bg_tasks)
    assert calendar.await_args.args[:2] == ('Nila', 'nilai43@example.test')
    assert sender.call_args.args[0] == 'nilai43@example.test'
    assert state.entities['email_delivery'] == 'sent'
    await owner.book_appointment('Nila', '2026-12-03','11:00','Software','nilai43@example.test')
    calendar.assert_awaited_once()
    insert.assert_awaited_once()
    sender.assert_called_once()
