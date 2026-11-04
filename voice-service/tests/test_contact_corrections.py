from types import SimpleNamespace
from unittest.mock import MagicMock, AsyncMock
import asyncio
import pytest

from callstate import CallState
from contact_corrections import latest_email
from tools import AppointmentTools


def test_caller_rejects_address_then_spells_and_confirms_a_replacement():
    state = CallState()
    state.observe_user("My email is old@example.test")
    state.observe_user("என்னோட email ID நீங்க தப்பா சொல்றீங்க. spelling சொல்லட்டுமா?")
    assert "email" not in state.entities
    assert state.pending_slug == "email"
    state.observe_user("My email is A B I L A S R I at gmail dot com")
    assert state.entities["email"] == "abilasri@gmail.com"
    assert state.entities["email_confirmed"] == "no"
    state.observe_user("yes")
    assert state.entities["email_confirmed"] == "yes"
    assert "ONLY when email_delivery=sent" in state.to_directive()


def test_explicit_current_call_name_replaces_prior_unconfirmed_name():
    state = CallState(entities={"name": "Old Name"})
    state.observe_user("என் பேர் அபி உன் பேர் என்ன?")
    assert state.entities["name"] == "அபி"


def test_latest_email_wins_over_old_transcript_and_assistant_guesses():
    tools = AppointmentTools(MagicMock(), "+910000000000", "Test")
    tools._session = SimpleNamespace(chat_ctx=SimpleNamespace(items=[
        SimpleNamespace(role="user", text_content="old@example.test"),
        SimpleNamespace(role="assistant", text_content="wrong@example.test"),
        SimpleNamespace(role="user", text_content="My correct email is new@example.test"),
    ]))
    assert tools._extract_caller_details()[0] == "new@example.test"


def test_spelling_normalization_does_not_join_ordinary_words_into_an_email():
    assert latest_email("my email is A B I at gmail dot com") == "abi@gmail.com"
    assert latest_email("LASRI") == ""
    assert latest_email("old@example.test, no, new@example.test") == "new@example.test"


@pytest.mark.asyncio
async def test_confirmed_correction_updates_recipient_without_creating_a_booking(monkeypatch):
    import tools as module
    import notify
    state = CallState()
    state.observe_user("My email is old@example.test")
    state.observe_user("My email is wrong. Correct email is new@example.test")
    state.observe_user("yes")
    tools = AppointmentTools(MagicMock(), "+910000000000", "Test", call_state=state)
    tools._last_booking_id = "BOOK1"
    tools._last_booking_name = "Test"
    tools._last_booking_time = "2026-11-05T11:00:00+05:30"
    saved = AsyncMock(return_value=True)
    booking = AsyncMock()
    monkeypatch.setattr(module.db, "update_confirmation_email", saved)
    monkeypatch.setattr(module.db, "insert_appointment", booking)
    sender = MagicMock(return_value=False)
    monkeypatch.setattr(notify, "send_booking_confirmation_email", sender)
    result = await tools.remember_details("Correct confirmation email: new@example.test")
    assert "queued, not yet sent" in result
    await asyncio.gather(*tools._bg_tasks)
    saved.assert_awaited_once_with("BOOK1", "+910000000000", "new@example.test")
    booking.assert_not_awaited()
    assert state.entities["email_delivery"] == "failed"


@pytest.mark.asyncio
async def test_unconfirmed_email_is_not_sent_or_written(monkeypatch):
    import tools as module
    state = CallState()
    state.observe_user("My correct email is new@example.test")
    tools = AppointmentTools(MagicMock(), "+910000000000", "Test", call_state=state)
    tools._last_booking_id = "BOOK1"
    saved = AsyncMock()
    monkeypatch.setattr(module.db, "update_confirmation_email", saved)
    result = await tools.remember_details("new@example.test")
    assert "Confirm the complete corrected email" in result
    saved.assert_not_awaited()


@pytest.mark.asyncio
async def test_old_email_task_cannot_mark_corrected_address_as_sent(monkeypatch):
    import notify
    state = CallState(entities={"email": "new@example.test", "email_delivery": "not_sent_to_corrected_address"})
    tools = AppointmentTools(MagicMock(), "+910000000000", "Test", call_state=state)
    monkeypatch.setattr(notify, "send_booking_confirmation_email", MagicMock(return_value=True))
    await tools._send_confirmation_email("old@example.test")
    assert state.entities["email_delivery"] == "not_sent_to_corrected_address"


@pytest.mark.asyncio
async def test_repeated_correction_answer_is_replaced_but_a_new_answer_streams():
    from contact_corrections import guard_repeated_repair
    previous = "We already sent the email to the address you gave us. What do you want now?"
    async def repeated():
        yield previous[:20]
        yield previous[20:]
    assert "".join([s async for s in guard_repeated_repair(repeated(), previous, "Please confirm the corrected spelling.")]) == "Please confirm the corrected spelling."
    async def fresh():
        yield "The new address is recorded."
    assert "".join([s async for s in guard_repeated_repair(fresh(), previous, "repair")]) == "The new address is recorded."


def test_latest_correction_is_injected_into_the_actual_llm_context():
    import agent
    from livekit.agents import llm
    state = CallState()
    state.observe_user("old@example.test")
    ctx = llm.ChatContext()
    ctx.add_message(role="user", content="No, my correct email is new@example.test")
    owner = SimpleNamespace(_lang_state=None, _call_state=state, _llm_turn=2)
    result = agent.BoundedAgent._apply_language_directive(owner, ctx)
    directive = "\n".join(item.text_content or "" for item in result.items if item.role == "system")
    assert "email=new@example.test" in directive
    assert "email=old@example.test" not in directive
    assert "Do not repeat the previous answer" in directive


@pytest.mark.asyncio
async def test_email_correction_does_not_wait_for_irrelevant_knowledge_search(monkeypatch):
    import agent
    from livekit.agents import llm
    query = AsyncMock()
    monkeypatch.setattr(agent.knowledge, "has_knowledge", query)
    ctx = llm.ChatContext()
    ctx.add_message(role="user", content="My email spelling is wrong. It is new@example.test")
    assert await agent.BoundedAgent._knowledge_context(SimpleNamespace(_assistant_id="test"), ctx) == ""
    query.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_queued_corrected_email_is_not_sent_twice(monkeypatch):
    import tools as module
    state = CallState(entities={"email": "new@example.test", "email_confirmed": "yes", "email_delivery": "queued"}, contact_repair=True)
    tools = AppointmentTools(MagicMock(), "+910000000000", "Test", call_state=state)
    tools._last_booking_id = "BOOK1"
    tools._last_booking_email = "new@example.test"
    saved = AsyncMock()
    monkeypatch.setattr(module.db, "update_confirmation_email", saved)
    result = await tools.remember_details("new@example.test")
    assert "already queued" in result
    saved.assert_not_awaited()
