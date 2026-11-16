"""Offline replays of the 2.5 phone call's overlapping hooks and stalled output."""

import asyncio
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock, Mock

import pytest
from google.genai import types
from livekit.agents import StopResponse, llm

from call_tasks import CallTasks
from callstate import CallState
from gemini_live_runtime import GeminiRuntime
from phone_text_input import PhoneTextModel, PhoneTextSession


def runtime():
    state = CallState(language="ta")
    return GeminiRuntime(
        ctx=NS(room=NS(name="offline"), add_shutdown_callback=Mock()),
        profile={
            "metadata": {
                "voiceRuntime": {
                    "engine": "gemini-live",
                    "model": "gemini-2.5-flash-native-audio-latest",
                    "voice": "Despina",
                }
            }
        },
        system_prompt="Synthetic business",
        state=state,
        owner=NS(work=CallTasks(state)),
        tools=[],
        keys={"google": "synthetic"},
        language_state=None,
        route=None,
        log=Mock(),
        vad=None,
        carrier_pattern=None,
        input_stt=NS(model="synthetic", aclose=AsyncMock()),
    )


@pytest.mark.parametrize(
    "model_id", ["gemini-2.5-flash-native-audio-latest", "gemini-3.1-flash-live-preview"]
)
async def test_generation_complete_releases_phone_streams_before_delayed_turn_complete(monkeypatch, model_id):
    monkeypatch.setattr(PhoneTextSession, "_main_task", AsyncMock())
    model = PhoneTextModel(model=model_id, api_key="synthetic")
    session = model.session()
    session._send_client_event = Mock()
    session._active_session = NS()
    try:
        pending = session.generate_reply()
        session._start_new_generation()
        generation = session._current_generation
        assert pending.done()
        session._handle_server_content(
            types.LiveServerContent(
                output_transcription=types.Transcription(text="Synthetic reply."), generation_complete=True
            )
        )
        assert generation.function_ch.closed and generation.message_ch.closed
        assert generation._done
    finally:
        session._active_session = None
        await session.aclose()
        await model.aclose()


async def test_append_memory_does_not_remove_a_concurrently_committed_phone_message(monkeypatch):
    monkeypatch.setattr(PhoneTextSession, "_main_task", AsyncMock())
    model = PhoneTextModel(model="gemini-2.5-flash-native-audio-latest", api_key="synthetic")
    session = model.session()
    session._active_session = NS()
    session._send_client_event = Mock()
    context = llm.ChatContext.empty()
    context.add_message(role="user", content="N I L A", id="caller-fragment")
    try:
        await session.update_chat_ctx(context)
        stale = llm.ChatContext.empty()
        stale.add_message(role="assistant", content="[APPLICATION CALL MEMORY]\n{}", id="memory")
        await session.update_chat_ctx(stale)
        assert [m.id for m in session.chat_ctx.items] == ["caller-fragment", "memory"]
    finally:
        session._active_session = None
        await session.aclose()
        await model.aclose()


async def test_overlapping_phone_hooks_submit_all_words_once_with_only_latest_reply():
    voice = runtime()
    voice.session.generate_reply = Mock()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def sync(**kwargs):
        entered.set()
        await release.wait()

    voice._sync_instructions = sync
    first = llm.ChatContext().add_message(role="user", content="N I L A")
    second = llm.ChatContext().add_message(role="user", content="four three at example dot test")
    voice.state.set_pending("email", "Please say your email")

    async def hook(message):
        with pytest.raises(StopResponse):
            await voice.agent.on_user_turn_completed(None, message)

    try:
        old = asyncio.create_task(hook(first))
        await entered.wait()
        new = asyncio.create_task(hook(second))
        await asyncio.sleep(0)
        release.set()
        await asyncio.gather(old, new)
        voice.session.generate_reply.assert_called_once()
        submitted = voice.session.generate_reply.call_args.kwargs["user_input"]
        assert "N I L A" in submitted.text_content and "four three" in submitted.text_content
        assert voice.state.entities["email"] == "nila43@example.test"
    finally:
        await voice.close()


async def test_spelling_request_has_exact_character_guidance_and_cannot_schedule_booking():
    voice = runtime()
    voice.session.generate_reply = Mock()
    voice.state.set_pending("email", "Please say your email")
    voice.state.observe_user("nila43@example.test", "previous")
    message = llm.ChatContext().add_message(role="user", content="ஆ correct spelling சொல்லுங்க.")
    try:
        with pytest.raises(StopResponse):
            await voice.agent.on_user_turn_completed(None, message)
        options = voice.session.generate_reply.call_args.kwargs
        assert "n i l a 4 3 @ example.test" in options.get("instructions", "")
        assert options.get("tool_choice") == "none"
        assert voice.state.entities.get("email_confirmed") != "yes"
    finally:
        await voice.close()


async def test_concurrent_context_updates_preserve_the_already_sent_caller_turn(monkeypatch):
    monkeypatch.setattr(PhoneTextSession, "_main_task", AsyncMock())
    model = PhoneTextModel(model="gemini-2.5-flash-native-audio-latest", api_key="synthetic")
    session = model.session()
    session._active_session = NS()
    session._send_client_event = Mock()
    caller = llm.ChatContext.empty()
    caller.add_message(role="user", content="N I L A", id="caller")
    memory = llm.ChatContext.empty()
    memory.add_message(role="assistant", content="memory", id="memory")
    try:
        async with session._session_lock:
            first = asyncio.create_task(session.update_chat_ctx(caller))
            second = asyncio.create_task(session.update_chat_ctx(memory))
            await asyncio.sleep(0)
        await asyncio.gather(first, second)
        assert [item.id for item in session.chat_ctx.items] == ["caller", "memory"]
    finally:
        session._active_session = None
        await session.aclose()
        await model.aclose()


async def test_blocked_booking_memory_does_not_describe_a_completed_task_as_a_booking():
    import json

    from gemini_live_runtime import memory_snapshot

    voice = runtime()
    voice.state.work = voice.owner.work

    async def blocked():
        return "Read back the email and get approval before booking."

    try:
        await voice.owner.work.run("booking", {"date": "2026-12-03"}, blocked)
        snapshot = json.loads(memory_snapshot(voice.state))
        assert snapshot.get("booking_action_status") == "NOT_SUBMITTED_NO_BOOKING_RECEIPT"
    finally:
        await voice.close()


async def test_a_corrected_literal_email_and_spelling_request_use_the_new_candidate():
    voice = runtime()
    voice.session.generate_reply = Mock()
    voice.state.set_pending("email", "Email?")
    voice.state.observe_user("old43@example.test", "old")
    message = llm.ChatContext().add_message(
        role="user", content="My email is nila45@example.test. spelling சொல்லுங்க."
    )
    try:
        with pytest.raises(StopResponse):
            await voice.agent.on_user_turn_completed(None, message)
        assert voice.state.entities["email"] == "nila45@example.test"
        assert "n i l a 4 5 @ example.test" in voice.session.generate_reply.call_args.kwargs["instructions"]
    finally:
        await voice.close()


async def test_first_reply_waits_for_pending_caller_context_to_be_sent(monkeypatch):
    monkeypatch.setattr(PhoneTextSession, "_main_task", AsyncMock())
    model = PhoneTextModel(model="gemini-2.5-flash-native-audio-latest", api_key="synthetic")
    session = model.session()
    session._send_client_event = Mock()
    context = llm.ChatContext.empty()
    context.add_message(role="user", content="My name is Nila.")
    pending = None
    try:
        await session.update_chat_ctx(context)
        pending = session.generate_reply()
        await asyncio.sleep(0)
        assert not session._send_client_event.called
        async with session._session_lock:
            initial, session._pending_chat_ctx = session._pending_chat_ctx, None
            session._active_session = NS()
            session._sync_chat_ctx(initial)
        await asyncio.sleep(0.03)
        events = [call.args[0] for call in session._send_client_event.call_args_list]
        assert events[0].turns[0].parts[0].text == "My name is Nila."
        assert events[-1].turn_complete is True
    finally:
        if pending is not None:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
        session._active_session = None
        await session.aclose()
        await model.aclose()


async def test_short_billing_ambiguity_is_clarified_once_and_explicit_billing_is_allowed():
    voice = runtime()
    voice.state.set_pending("email", "Email?")
    voice.state.observe_user("nila43@example.test", "one")
    try:
        voice.state.observe_user("Billing சொல்லுங்க.", "two")
        options = voice.phone_reply_options("Billing சொல்லுங்க.")
        assert options["tool_choice"] == "none"
        assert "spelling or billing" in options["instructions"]
        voice.state.observe_user("Billing சொல்லுங்க.", "three")
        assert voice.phone_reply_options("Billing சொல்லுங்க.") == {}
        assert voice.phone_reply_options("Billing details and consultation fees please.") == {}
    finally:
        await voice.close()


async def test_fresh_email_candidate_gets_one_exact_readback_before_any_booking_tool():
    voice = runtime()
    voice.state.set_pending('email', 'Email?')
    voice.state.observe_user('Nila I forty three at example dot test', 'email')
    try:
        options = voice.phone_reply_options(voice.state._last_observed_user)
        assert options['tool_choice'] == 'none'
        assert 'n i l a i 4 3 @ example.test' in options['instructions']
        voice.state.observe_assistant('Nila I 43@example.test, இது சரியா?')
        voice.state.observe_user('Correct.', 'approval')
        assert voice.state.entities['email_confirmed'] == 'yes'
        assert voice.phone_reply_options('Correct.') == {}
    finally:
        await voice.close()
