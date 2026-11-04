from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock
import asyncio
import time

import pytest
from livekit.agents import llm
from callstate import CallState
from lang import LanguageState
import agent


def test_speculative_prompt_does_not_change_confirmed_fields_or_cancel_work():
    state = CallState(entities={'name': 'Nila', 'time': '11:00', 'date': '2026-11-06'})
    state.work = SimpleNamespace(invalidate=Mock(), directive=lambda: '[WORK: none]')
    state.set_pending('time', 'Which time?')
    language = LanguageState('en')
    owner = agent.BoundedAgent(instructions='Synthetic business', call_state=state, lang_state=language)
    before = deepcopy(state.snapshot())
    ctx = llm.ChatContext()
    ctx.add_message(role='user', content='நேரத்தை மட்டும் 12:00 PM-க்கு மாத்துங்க.')
    prepared = owner._apply_language_directive(ctx, preview=True)
    assert state.snapshot() == before
    assert not language.established
    state.work.invalidate.assert_not_called()
    system = '\n'.join(i.text_content or '' for i in prepared.items if i.role == 'system')
    assert '[CURRENT CALLER TURN: 1]' in system
    assert prepared.items[0].text_content == ctx.items[0].text_content


def test_preparation_keeps_saved_pause_floor_and_has_one_attempt_without_speculative_tts(monkeypatch):
    from turn_policy import voice_turn_options
    monkeypatch.delenv('VOICE_PREEMPTIVE_GENERATION', raising=False)
    options = voice_turn_options({'min_pause_ms': 350}, has_vad=True)
    assert options['endpointing']['min_delay'] == .35
    assert voice_turn_options()['endpointing']['min_delay'] >= .85
    assert options['preemptive_generation'] == {'enabled': True, 'preemptive_tts': False, 'max_retries': 1}
    assert options['turn_detection'] == 'vad'


@pytest.mark.asyncio
async def test_state_tool_uses_originating_call_id_not_model_guessed_turn_number():
    from tools import AppointmentTools
    state = CallState(entities={'time': '11:00', 'name': 'Nila'})
    state.observe_user('Change only the time to noon')
    state._model_tool_turns['synthetic-call'] = (state.user_turn_id, state._last_observed_user)
    tools = AppointmentTools(SimpleNamespace(), call_state=state)
    context = SimpleNamespace(function_call=SimpleNamespace(call_id='synthetic-call'), session=SimpleNamespace(say=Mock()))
    await tools.update_call_details(turn_id=999, field='time', value='12:00', confirmed=True, context=context)
    assert state.entities == {'time': '12:00', 'name': 'Nila'}
    state.observe_user('Actually, I meant 1 PM')
    result = await tools.update_call_details(turn_id=state.user_turn_id, field='time', value='12:00', context=context)
    assert 'stale' in result.lower()


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['none', 'bounded_history', 'transcript', 'context', 'resumed_speech'])
async def test_installed_sdk_prepares_before_commit_and_never_executes_a_speculative_action(monkeypatch, change):
    from livekit.agents import AgentSession
    from livekit.agents.voice.audio_recognition import _PreemptiveGenerationInfo, _EndOfTurnInfo, _EndOfTurnMetrics
    from turn_policy import voice_turn_options
    class Model(llm.LLM):
        def chat(self, **kwargs):
            raise AssertionError('No provider calls allowed in scheduling regression')
    calls, actions = [], []
    @llm.function_tool
    async def action():
        actions.append('committed')
        return llm.ToolResult('Verified synthetic action', reply_required=False)
    async def streamed(model, ctx, tools, choice, conn, result):
        calls.append(next(i.text_content for i in reversed(ctx.items) if getattr(i, 'role', '') == 'user'))
        result['status'] = 'ok'
        yield llm.ChatChunk(id='synthetic', delta=llm.ChoiceDelta(role='assistant', tool_calls=[
            {'call_id': f'fake-{len(calls)}', 'name': 'action', 'arguments': '{}', 'type': 'function'}]))
    monkeypatch.setattr(agent, '_stream_gated', streamed)
    state = CallState(entities={'name': 'Nila', 'time': '11:00'})
    owner = agent.BoundedAgent(instructions='Synthetic', call_state=state, tools=[action])
    if change == 'bounded_history':
        for index in range(16):
            owner._chat_ctx.add_message(role='user' if index % 2 == 0 else 'assistant',
                                        content=f'Established synthetic detail {index}')
    model = Model()
    session = AgentSession(llm=model, turn_handling=voice_turn_options())
    session.on('speech_created', lambda ev: owner._track_preparation(ev.speech_handle))
    monkeypatch.setattr(owner, '_knowledge_context', lambda ctx: asyncio.sleep(0, result=''))
    try:
        await session.start(owner)
        activity = session._activity
        activity.on_preemptive_generation(_PreemptiveGenerationInfo(new_transcript='Explain maintenance', transcript_confidence=1, started_speaking_at=time.time()))
        for _ in range(50):
            if calls: break
            await asyncio.sleep(.01)
        assert calls == ['Explain maintenance']  # actual llm_node ran before commit
        assert not actions and state.user_turn_id == 0
        final = 'Explain maintenance'
        if change == 'transcript':
            final += ' for an online shop'
            activity.on_preemptive_generation(_PreemptiveGenerationInfo(new_transcript=final, transcript_confidence=1, started_speaking_at=time.time()))
        elif change == 'context':
            owner._chat_ctx.add_message(role='assistant', content='New verified context')
        elif change == 'resumed_speech':
            owner._discard_preparation_on_speech()
            await asyncio.sleep(.01)
            assert activity._preemptive_generation is None
        now = time.time()
        activity.on_end_of_turn(_EndOfTurnInfo(skip_reply=False, new_transcript=final, transcript_confidence=1,
            metrics=_EndOfTurnMetrics(started_speaking_at=now-1, stopped_speaking_at=now, transcription_delay=0., end_of_turn_delay=.85)))
        for _ in range(100):
            if actions: break
            await asyncio.sleep(.01)
        assert actions == ['committed']
        assert len(calls) == (1 if change in ('none', 'bounded_history') else 2)
        assert calls[-1] == final
        assert state.user_turn_id == 1
    finally:
        await session.aclose()
        await model.aclose()


@pytest.mark.asyncio
async def test_preparation_never_emits_previous_turn_pending_work_status():
    from response_timing import ResponseTiming, with_first_voice_target
    class Owner:
        _response_timing = ResponseTiming(target_ms=1)
        _is_uncommitted_generation = staticmethod(lambda ctx: True)
        _first_voice_status = staticmethod(lambda: 'Checking an older booking')
        @with_first_voice_target
        async def node(self, ctx):
            await asyncio.sleep(.02)
            yield 'Actual answer'
    owner = Owner()
    owner._response_timing.commit()
    assert [chunk async for chunk in owner.node(llm.ChatContext())] == ['Actual answer']
