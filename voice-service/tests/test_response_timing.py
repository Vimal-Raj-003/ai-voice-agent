"""First-voice target and independent playback clocks; synthetic audio events only."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from livekit.agents.types import FlushSentinel
from response_timing import ResponseTiming


@pytest.mark.asyncio
async def test_ready_answer_streams_immediately_without_a_status_or_extra_wait():
    clock = ResponseTiming(target_ms=1000)
    clock.speech_stopped()
    clock.commit()
    async def answer():
        yield 'The slot is available.'
    status = lambda: pytest.fail('No status when answer is already ready')
    output = [chunk async for chunk in clock.stream(answer(), status)]
    assert output == ['The slot is available.']
    assert not clock.turn.progress_sent


@pytest.mark.asyncio
async def test_pending_work_gets_one_truthful_status_then_separate_answer_segment():
    events = []
    clock = ResponseTiming(target_ms=25, tts_budget_ms=10, log=lambda event, **kw: events.append((event, kw)))
    clock.speech_stopped()
    clock.commit()
    async def answer():
        await asyncio.sleep(.04)
        yield 'Actual result.'
    output = [chunk async for chunk in clock.stream(answer(), lambda: 'Checking availability.')]
    assert output[0] == 'Checking availability.'
    assert isinstance(output[1], FlushSentinel)
    assert output[2] == 'Actual result.'
    assert [name for name, _ in events].count('reply_progress_text_ready') == 1
    assert not any(name in ('reply_first_voice', 'reply_answer_voice') for name, _ in events)


@pytest.mark.asyncio
async def test_thinking_pause_does_not_commit_or_emit_progress():
    clock = ResponseTiming(target_ms=10, tts_budget_ms=5)
    clock.speech_started()
    clock.speech_stopped()  # natural pause, no on_user_turn_completed callback
    async def answer():
        await asyncio.sleep(.02)
        yield 'unchanged'
    assert [x async for x in clock.stream(answer(), lambda: 'must not speak')] == ['unchanged']
    assert clock.turn is None


@pytest.mark.asyncio
async def test_resumed_caller_invalidates_old_status_even_after_they_pause_again():
    clock = ResponseTiming(target_ms=30, tts_budget_ms=10)
    clock.speech_stopped()
    clock.commit()
    async def answer():
        await asyncio.sleep(.04)
        yield 'result'
    async def resumes():
        await asyncio.sleep(.005)
        clock.speech_started()
        clock.speech_stopped()  # old reply must not speak into this new thinking pause
    resumed = asyncio.create_task(resumes())
    output = [x async for x in clock.stream(answer(), lambda: 'must not speak')]
    await resumed
    assert output == ['result']
    assert not clock.turn.progress_sent


def test_actual_playback_clocks_first_voice_and_answer_independently():
    at, events = [10.], []
    clock = ResponseTiming(now=lambda: at[0], log=lambda event, **kw: events.append((event, kw)))
    clock.speech_stopped()
    at[0] = 10.85
    clock.commit()
    clock.bind_segment('S1', 'progress')
    clock.bind_segment('S1', 'answer')
    at[0] = 11.
    clock.playback_started('S1')
    at[0] = 12.7
    clock.playback_started('S1')
    first = next(data for event, data in events if event == 'reply_first_voice')
    answer = next(data for event, data in events if event == 'reply_answer_voice')
    assert first['speech_end_to_first_voice_ms'] == 1000
    assert first['target_met']
    assert answer['speech_end_to_answer_voice_ms'] == 2700
    assert answer['first_voice_to_answer_voice_ms'] == 1700


def test_fast_substantive_audio_is_both_first_reply_and_actual_answer():
    at, events = [10.], []
    clock = ResponseTiming(now=lambda: at[0], log=lambda event, **kw: events.append((event, kw)))
    clock.speech_stopped()
    clock.commit()
    clock.bind_segment('S1', 'answer')
    at[0] = 10.9
    clock.playback_started('S1')
    assert clock.turn.first_voice == clock.turn.answer_voice == 10.9
    assert [name for name, _ in events][-2:] == ['reply_first_voice', 'reply_answer_voice']


def test_target_miss_is_reported_from_speech_end_not_reset_at_commit():
    at, events = [1.], []
    clock = ResponseTiming(now=lambda: at[0], log=lambda event, **kw: events.append((event, kw)))
    clock.speech_stopped()
    at[0] = 2.1  # slow STT/endpointing already consumed more than one second
    clock.commit()
    clock.bind_segment('S1', 'answer')
    at[0] = 2.4
    clock.playback_started('S1')
    first = next(data for event, data in events if event == 'reply_first_voice')
    assert first['speech_end_to_first_voice_ms'] == 1400
    assert not first['target_met']


def test_missing_speech_end_does_not_claim_one_second_voice_target_verified():
    events = []
    clock = ResponseTiming(log=lambda event, **kw: events.append((event, kw)))
    clock.commit()
    clock.bind_segment('S1', 'answer')
    clock.playback_started('S1')
    first = next(data for event, data in events if event == 'reply_first_voice')
    assert first['anchor'] == 'commit_fallback' and first['target_met'] is None


def test_sdk_speech_end_anchor_includes_endpointing_and_stt_delay():
    at, events = [10.85], []
    clock = ResponseTiming(now=lambda: at[0], wall_now=lambda: 100., log=lambda event, **kw: events.append((event, kw)))
    clock.commit(stopped_speaking_at=99.15)
    assert clock.turn.anchor == 'sdk_speech_end'
    clock.bind_segment('S1', 'answer')
    at[0] = 11.2
    clock.playback_started('S1')
    first = next(data for event, data in events if event == 'reply_first_voice')
    assert first['speech_end_to_first_voice_ms'] == 1200
    assert first['commit_to_first_voice_ms'] == 350
    assert not first['target_met']


@pytest.mark.asyncio
async def test_no_active_work_means_no_invented_progress():
    clock = ResponseTiming(target_ms=1, tts_budget_ms=0)
    clock.speech_stopped()
    clock.commit()
    async def answer():
        await asyncio.sleep(.01)
        yield 'result'
    assert [x async for x in clock.stream(answer(), lambda: None)] == ['result']


@pytest.mark.asyncio
async def test_status_does_not_repeat_on_model_retry_or_tool_round():
    clock = ResponseTiming(target_ms=1, tts_budget_ms=0)
    clock.speech_stopped()
    clock.commit()
    async def answer():
        await asyncio.sleep(.01)
        yield 'result'
    first = [x async for x in clock.stream(answer(), lambda: 'Preparing answer.')]
    second = [x async for x in clock.stream(answer(), lambda: 'Preparing answer.')]
    assert any(isinstance(x, FlushSentinel) for x in first)
    assert second == ['result']


@pytest.mark.asyncio
async def test_cancelled_wait_cleans_up_without_background_generation_or_late_status():
    clock = ResponseTiming(target_ms=1000)
    clock.speech_stopped()
    clock.commit()
    closed = asyncio.Event()
    async def answer():
        try:
            await asyncio.sleep(30)
            yield 'late'
        finally:
            closed.set()
    task = asyncio.create_task(anext(clock.stream(answer(), lambda: 'must not speak')))
    await asyncio.sleep(.005)
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)
    assert closed.is_set() and not clock.turn.progress_sent


def test_pending_tool_status_is_not_counted_as_a_completed_answer():
    clock = ResponseTiming()
    clock.commit()
    assert clock.classify('Still checking.', pending_work=True) == 'progress'
    assert clock.classify('Service unavailable.', failure=True) == 'failure'
    assert clock.classify('Available.') == 'answer'


@pytest.mark.asyncio
async def test_agent_stream_uses_existing_model_once_without_ordinary_filler(monkeypatch):
    import agent
    from callstate import CallState
    from livekit.agents import llm
    from livekit.agents.types import NOT_GIVEN
    owner = agent.BoundedAgent(instructions='Synthetic assistant', call_state=CallState())
    owner._response_timing.target_ms = 10
    owner._response_timing.tts_budget_ms = 0
    owner._response_timing.speech_stopped()
    owner._response_timing.commit()
    monkeypatch.setattr(owner, '_knowledge_context', AsyncMock(return_value=''))
    invoked = []
    async def fake_stream(*args):
        invoked.append(1)
        await asyncio.sleep(.03)
        args[-1].update(status='ok', text='Synthetic result.')
        yield SimpleNamespace(delta=SimpleNamespace(content='Synthetic result.', tool_calls=None))
    monkeypatch.setattr(agent, '_stream_gated', fake_stream)
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=object()))
    context = llm.ChatContext()
    context.add_message(role='user', content='Synthetic question')
    output = [x async for x in owner.llm_node(context, [], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert len(invoked) == 1
    assert not any(isinstance(x, FlushSentinel) for x in output)
    assert not any(isinstance(x, str) and 'preparing' in x.lower() for x in output)
    assert output[0].delta.content == 'Synthetic result.'
