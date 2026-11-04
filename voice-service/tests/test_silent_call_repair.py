"""The observed inbound failure: local boundary regressions, no provider I/O."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, MagicMock, PropertyMock, patch

import pytest
from livekit.agents import llm, StopResponse
from livekit.agents.types import APIConnectOptions, NOT_GIVEN

import agent
import lang
from callstate import CallState


@pytest.mark.parametrize('text,detected', [('हलो।', 'hi-IN'), ('हेलो', 'hi-IN'),
    ('ஹலோ', 'ta-IN'), ('ഹലോ', 'ml-IN'), ('హలో', 'te-IN')])
def test_hello_cannot_establish_or_switch_language(text, detected):
    state = lang.LanguageState('ta')
    assert not state.observe(detected, text)
    assert state.active == 'ta' and not state.established


@pytest.mark.asyncio
async def test_useful_prefix_deadline_survives_whitespace_trickle(monkeypatch):
    monkeypatch.setenv('VOICE_USEFUL_TEXT_TIMEOUT_S', '.03')
    class Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def __aiter__(self):
            yield llm.ChatChunk(id='probe', delta=llm.ChoiceDelta(role='assistant', content='ஆம்'))
            while True:
                await asyncio.sleep(.005)
                yield llm.ChatChunk(id='probe', delta=llm.ChoiceDelta(role='assistant', content=' '))
    model = SimpleNamespace(chat=lambda **kwargs: Stream())
    result = {}
    async def collect():
        return [c async for c in agent._stream_gated(model, llm.ChatContext(), [], 'none',
                      APIConnectOptions(timeout=.01, max_retry=0), result)]
    output = await asyncio.wait_for(collect(), .2)
    assert not output and isinstance(result['err'], TimeoutError)
    assert result['timeout_phase'] == 'useful_prefix'


def context(text='हलो।'):
    ctx = llm.ChatContext()
    ctx.add_message(role='assistant', content='How can I help?')
    ctx.add_message(role='user', content=text)
    return ctx


@pytest.mark.asyncio
@pytest.mark.parametrize('text', ['Hello.', 'हलो।', 'ஹலோ?', 'கேக்குதா?'])
async def test_presence_answers_directly_without_model_or_state_tool_round(monkeypatch, text):
    owner = agent.BoundedAgent(instructions='Synthetic business', call_state=CallState())
    monkeypatch.setattr(owner, '_knowledge_context', AsyncMock(return_value=''))
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=object()))
    choices = []
    async def stream(model, ctx, tools, choice, conn, result):
        choices.append(choice)
        result.update(status='ok')
        yield llm.ChatChunk(id='probe', delta=llm.ChoiceDelta(role='assistant', content='I can hear you.'))
    monkeypatch.setattr(agent, '_stream_gated', stream)
    say = Mock()
    with patch.object(agent.BoundedAgent, 'session', new_callable=PropertyMock,
                      return_value=SimpleNamespace(say=say)):
        with pytest.raises(StopResponse):
            await owner.on_user_turn_completed(context(text), context(text).items[-1])
        output = [c async for c in owner.llm_node(context(text), [], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert not output and not choices
    say.assert_called_once()


def continuation():
    ctx = context('Hello.')
    ctx.items.extend([llm.FunctionCall(call_id='local', name='update_call_details', arguments='{}'),
                      llm.FunctionCallOutput(call_id='local', name='update_call_details', output='No changes.', is_error=False)])
    return ctx


def test_committed_tool_continuation_is_not_speculative():
    owner = SimpleNamespace(session=SimpleNamespace(options=SimpleNamespace(preemptive_generation={'enabled': True})))
    assert not agent.BoundedAgent._is_uncommitted_generation(owner, continuation())


def test_tool_continuation_keeps_original_caller_turn():
    state = CallState()
    state.observe_user('Hello.', message_id='committed-id')
    owner = agent.BoundedAgent(instructions='Synthetic', call_state=state)
    owner._apply_language_directive(continuation())
    assert state.user_turn_id == 1


@pytest.mark.asyncio
async def test_carrier_announcement_resumes_only_unspoken_greeting_once():
    state = CallState()
    owner = agent.BoundedAgent(instructions='Synthetic', call_state=state)
    owner._greeting_text = 'Welcome to Example. How can I help?'
    owner._greeting_handle = SimpleNamespace(interrupted=True)
    say = Mock()
    ctx = llm.ChatContext()
    ctx.add_message(role='assistant', content='Welcome to Example.')
    announcement = llm.ChatMessage(role='user', content=['Is now being recorded.'])
    with patch.object(agent.BoundedAgent, 'session', new_callable=PropertyMock,
                      return_value=SimpleNamespace(say=say)):
        for _ in range(2):
            with pytest.raises(StopResponse):
                await owner.on_user_turn_completed(ctx, announcement)
    assert state.user_turn_id == 0 and not state.entities
    say.assert_called_once_with('How can I help?', allow_interruptions=True, add_to_chat_ctx=True)


def test_read_only_tools_cannot_expose_booking_memory_transfer_or_custom_writes():
    from tools import AppointmentTools
    owner = AppointmentTools(SimpleNamespace())
    owner._test_read_only = True
    names = {t.info.name for t in owner.build_tool_list(['book_appointment', 'remember_details', 'transfer_to_human'])}
    assert names == {'update_call_details'}


@pytest.mark.asyncio
async def test_cancelled_silent_turn_is_reported_unanswered():
    from response_timing import ResponseTiming, with_first_voice_target
    events = []
    clock = ResponseTiming(log=lambda name, **data: events.append((name, data)))
    clock.commit()
    owner = SimpleNamespace(_response_timing=clock, _first_voice_status=lambda: None)
    @with_first_voice_target
    async def node(owner):
        await asyncio.sleep(30)
        yield 'unreachable'
    task = asyncio.create_task(anext(node(owner)))
    await asyncio.sleep(.01)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    outcome = next(data for name, data in events if name == 'llm_turn_outcome')
    assert outcome['unanswered'] and outcome['outcome'] == 'cancelled'


@pytest.mark.asyncio
async def test_carrier_preparation_does_not_request_a_model(monkeypatch):
    owner = agent.BoundedAgent(instructions='Synthetic', call_state=CallState())
    knowledge = AsyncMock(return_value='')
    monkeypatch.setattr(owner, '_knowledge_context', knowledge)
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=object()))
    calls = []
    async def stream(*args):
        calls.append(1)
        args[-1].update(status='ok')
        if False: yield
    monkeypatch.setattr(agent, '_stream_gated', stream)
    assert not [x async for x in owner.llm_node(context('Is now being recorded.'), [], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert not calls
    knowledge.assert_not_awaited()


@pytest.mark.asyncio
async def test_stalled_primary_moves_to_fallback_once_without_duplicate_retry(monkeypatch):
    monkeypatch.setenv('VOICE_USEFUL_TEXT_TIMEOUT_S', '.03')
    calls = []
    class Stream:
        def __init__(self, name): self.name = name
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def __aiter__(self):
            if self.name == 'primary':
                await asyncio.sleep(30)
            yield llm.ChatChunk(id='probe', delta=llm.ChoiceDelta(role='assistant', content='Verified synthetic response.'))
    def model(name):
        def chat(**kwargs):
            calls.append(name)
            return Stream(name)
        return SimpleNamespace(chat=chat)
    owner = agent.BoundedAgent(instructions='Synthetic', call_state=CallState(),
                               fallback_llm=model('fallback'), fallback_label='groq/test-fallback')
    monkeypatch.setattr(owner, '_knowledge_context', AsyncMock(return_value=''))
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=model('primary')))
    result = [x async for x in owner.llm_node(context('Synthetic information question'), [], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert calls == ['primary', 'fallback']
    assert ''.join(x.delta.content or '' for x in result) == 'Verified synthetic response.'


@pytest.mark.asyncio
async def test_streaming_releases_safe_text_before_generation_finishes(monkeypatch):
    monkeypatch.setenv('VOICE_USEFUL_TEXT_TIMEOUT_S', '.02')
    monkeypatch.setenv('VOICE_STREAM_IDLE_TIMEOUT_S', '.02')
    class Stream:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): return False
        async def __aiter__(self):
            yield llm.ChatChunk(id='probe', delta=llm.ChoiceDelta(role='assistant', content='A complete useful answer.'))
            await asyncio.sleep(30)
    result = {}
    stream = agent._stream_gated(SimpleNamespace(chat=lambda **kw: Stream()), context(), [], 'none',
                                APIConnectOptions(), result)
    assert (await anext(stream)).delta.content == 'A complete useful answer.'
    assert not [x async for x in stream]
    assert result['status'] == 'error_after_output' and result['timeout_phase'] == 'stream_idle'


@pytest.mark.asyncio
async def test_read_only_shutdown_keeps_call_log_but_sends_nothing(monkeypatch, mock_pool):
    import notify
    import time
    complete = AsyncMock(return_value='synthetic-call')
    remove = AsyncMock()
    close = AsyncMock()
    hooks = AsyncMock(return_value=[])
    settle = AsyncMock(return_value=False)
    monkeypatch.setattr(agent.db, 'complete_call', complete)
    monkeypatch.setattr(agent.db, 'remove_active_call', remove)
    monkeypatch.setattr(agent.db, 'get_active_webhooks_for_event', hooks)
    monkeypatch.setattr(agent.db, 'settle_campaign_target', settle)
    monkeypatch.setattr(agent, '_close_job_db', close)
    booking, no_booking, webhook = Mock(), Mock(), AsyncMock()
    monkeypatch.setattr(notify, 'notify_booking_confirmed', booking)
    monkeypatch.setattr(notify, 'notify_call_no_booking', no_booking)
    monkeypatch.setattr(notify, 'send_webhook', webhook)
    monkeypatch.setenv('N8N_WEBHOOK_URL', 'https://example.invalid/test-only')
    ctx = MagicMock()
    ctx.room.name = 'synthetic-room'
    tools = MagicMock()
    tools._test_read_only = True
    tools._call_id = 'synthetic-call'
    tools._call_start_time = time.time()-5
    tools._closed_outcome = 'COMPLETED'
    tools._closed_reason = 'synthetic test'
    tools.recording_url = None
    session = MagicMock()
    session.chat_ctx = context()
    await agent._shutdown_hook(ctx, tools, session, {}, 'synthetic-phone', 'Synthetic')
    complete.assert_awaited_once()
    remove.assert_awaited_once()
    close.assert_awaited_once()
    booking.assert_not_called()
    no_booking.assert_not_called()
    webhook.assert_not_awaited()
    hooks.assert_not_awaited()
    settle.assert_not_awaited()


def test_test_mode_exposes_no_calendar_or_business_write_tools_by_default():
    from tools import AppointmentTools
    owner = AppointmentTools(SimpleNamespace())
    owner._test_read_only = True
    assert {t.info.name for t in owner.build_tool_list([])} == {'end_call', 'update_call_details'}


def test_presence_shortcut_cannot_swallow_a_real_question():
    owner = agent.BoundedAgent(instructions='Synthetic')
    assert not owner._skip_model_context(context('Hello, e-commerce maintenance கிடைக்குமா?'))
