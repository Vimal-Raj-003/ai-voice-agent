"""Saved assistant controls must reach the actual runtime construction seams."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
import pytest
from turn_policy import voice_turn_options


@pytest.mark.parametrize('sensitivity,expected', [('LOW', 2.0), ('MEDIUM', 1.0), ('HIGH', .4)])
def test_saved_sensitivity_and_interruption_replace_hidden_defaults(sensitivity, expected, monkeypatch):
    monkeypatch.setenv('VOICE_PAUSE_FLOOR_MS', '850')
    options = voice_turn_options({'end_of_speech_sensitivity': sensitivity,
                                  'min_pause_ms': 200, 'interruption_threshold_ms': 175})
    assert options['endpointing']['min_delay'] == expected
    assert options['interruption']['min_duration'] == .175


def test_min_pause_is_a_floor_and_zero_is_not_treated_as_missing():
    assert voice_turn_options({'min_pause_ms': 0})['endpointing']['min_delay'] == 0
    assert voice_turn_options({'min_pause_ms': 2700, 'end_of_speech_sensitivity': 'HIGH'})['endpointing']['min_delay'] == 2.7


def test_saved_sampling_options_reach_provider_constructor(monkeypatch):
    import llm_routing as routing
    monkeypatch.setenv('OPENROUTER_API_KEY', 'synthetic-key')
    monkeypatch.setattr(routing, 'provider_available', lambda provider: (True, ''))
    monkeypatch.setattr(routing, '_openai_plugin', SimpleNamespace(LLM=lambda **kwargs: kwargs))
    result = routing.build_llm('openrouter', 'synthetic-model', profile={'temperature': .35, 'max_tokens': 160})
    assert result['temperature'] == .35
    assert result['max_completion_tokens'] == 160


def test_hallucination_checkbox_adds_only_its_optional_instruction():
    from prompts import build_prompt
    enabled = build_prompt(custom_prompt='Selected assistant role', hallucination_guard=True)
    disabled = build_prompt(custom_prompt='Selected assistant role', hallucination_guard=False)
    assert enabled.startswith('Selected assistant role') and disabled.startswith('Selected assistant role')
    assert '[HALLUCINATION GUARD]' in enabled and '[HALLUCINATION GUARD]' not in disabled


@pytest.mark.asyncio
async def test_low_confidence_is_clarified_without_overwriting_known_state(monkeypatch):
    import agent
    from callstate import CallState
    from livekit.agents import llm, StopResponse
    state = CallState(entities={'name': 'Nila', 'email': 'nila@example.test', 'email_confirmed': 'yes'})
    owner = agent.BoundedAgent(instructions='Selected role', call_state=state)
    owner._confidence_threshold_pct = 60
    owner._transcript_confidence = {'wrong@example.test': .25}
    session = SimpleNamespace(say=Mock())
    monkeypatch.setattr(agent.BoundedAgent, 'session', property(lambda self: session))
    history = llm.ChatContext()
    msg = history.add_message(role='user', content='wrong@example.test')
    before = state.snapshot()
    with pytest.raises(StopResponse):
        await owner.on_user_turn_completed(history, msg)
    assert state.snapshot() == before
    session.say.assert_called_once()
    assert not history.items


@pytest.mark.parametrize('score', [None, 0, .9])
def test_missing_provider_probability_is_not_fabricated_as_low_accuracy(score):
    import agent
    owner = agent.BoundedAgent(instructions='Selected role')
    owner._confidence_threshold_pct = 60
    owner._transcript_confidence = {'hello': score if score else None}
    assert not owner._needs_confidence_clarification('hello')


@pytest.mark.asyncio
async def test_duration_and_silence_limits_close_sip_room_once_and_cancel_timer():
    from assistant_controls import CallLimits
    ctx = SimpleNamespace(room=SimpleNamespace(name='synthetic-room'), shutdown=Mock(),
        api=SimpleNamespace(room=SimpleNamespace(delete_room=AsyncMock())))
    tools = SimpleNamespace()
    limits = CallLimits(ctx, tools, {'max_duration_seconds': 75}, Mock())
    assert limits.duration == 75
    limits.start()
    task = limits.task
    await limits.end('continuous silence timeout')
    await limits.end('maximum call duration reached')
    await limits.aclose()
    ctx.api.room.delete_room.assert_awaited_once()
    ctx.shutdown.assert_called_once_with(reason='continuous silence timeout')
    assert task.cancelled()


@pytest.mark.asyncio
async def test_installed_sdk_constructs_with_saved_turn_and_silence_controls():
    from livekit.agents import AgentSession
    options = voice_turn_options({'end_of_speech_sensitivity': 'MEDIUM', 'min_pause_ms': 1250,
                                  'interruption_threshold_ms': 230})
    session = AgentSession(turn_handling=options, user_away_timeout=47)
    assert session.options.endpointing['min_delay'] == 1.25
    assert session.options.interruption['min_duration'] == .23
    assert session.options.user_away_timeout == 47
    await session.aclose()
