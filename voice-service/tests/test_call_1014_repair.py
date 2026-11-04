"""Regressions from the November 4 call; no provider requests or actions."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import asyncio
import pytest


@pytest.mark.asyncio
async def test_sarvam_language_probability_never_rejects_a_clear_transcript(monkeypatch):
    import agent
    from livekit.agents import stt
    owner = agent.BoundedAgent(instructions='Tamil support')
    owner._confidence_threshold_pct = 65
    session = SimpleNamespace(_jj_stt_provider='sarvam')
    monkeypatch.setattr(agent.BoundedAgent, 'session', property(lambda self: session))
    event = stt.SpeechEvent(type=stt.SpeechEventType.FINAL_TRANSCRIPT,
        alternatives=[stt.SpeechData(language='en', text='Hello.', confidence=.001)])
    async def raw(*args):
        yield event
    monkeypatch.setattr(agent.Agent.default, 'stt_node', raw)
    assert [item async for item in owner.stt_node(None, None)] == [event]
    assert not owner._needs_confidence_clarification('Hello.')
    assert owner._transcript_confidence['Hello.'] is None


@pytest.mark.asyncio
async def test_ordinary_answer_prefix_is_not_held_until_the_next_word():
    from conversation_style import guard_verified_actions
    gate = asyncio.Event()
    async def text():
        yield 'மருத்துவத்துறையில் '
        await gate.wait()
        yield 'software உதவி தருகிறோம்.'
    stream = guard_verified_actions(text(), None)
    task = asyncio.create_task(anext(stream))
    try:
        await asyncio.sleep(.01)
        assert task.done(), 'Ordinary complete word was buffered behind the next model token'
        assert task.result() == 'மருத்துவத்துறையில் '
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        await stream.aclose()


@pytest.mark.asyncio
async def test_keyword_retrieval_does_not_supply_unrelated_documents(monkeypatch):
    import knowledge
    pool = SimpleNamespace(fetch=AsyncMock(return_value=[dict(
        id='k1', source_id='s1', metadata={}, url='https://example.test',
        title='Bakery', content='Wedding cakes and pastries.')]))
    monkeypatch.setattr(knowledge.db, 'get_pool', AsyncMock(return_value=pool))
    assert await knowledge._keyword_fallback_search('synthetic', 'hospital software') == []


def test_openrouter_uses_latency_routing_with_required_parameter_support(monkeypatch):
    import llm_routing
    monkeypatch.setenv('OPENROUTER_API_KEY', 'synthetic-key')
    monkeypatch.setattr(llm_routing, 'provider_available', lambda _: (True, ''))
    monkeypatch.setattr(llm_routing, '_openai_plugin', SimpleNamespace(LLM=lambda **kw: kw))
    args = llm_routing.build_llm('openrouter', 'synthetic-model')
    assert args['extra_body']['provider'] == {'sort': 'latency', 'require_parameters': True}
