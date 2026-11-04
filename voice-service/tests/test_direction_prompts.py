import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
import assistant_prompts
import prompt_generation as generation


def test_legacy_prompts_and_malformed_metadata_are_safe():
    for metadata in (None, 'bad json', [], {'directionPrompts': []}):
        assert assistant_prompts.outbound_prompt(metadata) is None
    profile = {'system_prompt': 'Original', 'model': 'unchanged'}
    assert assistant_prompts.profile_for_direction(profile, 'OUTBOUND')['system_prompt'] == 'Original'
    assert profile == {'system_prompt': 'Original', 'model': 'unchanged'}


def test_selected_direction_uses_only_its_saved_prompt():
    metadata = json.dumps({'directionPrompts': {'outbound': 'Outbound: explain why you called.'}})
    profile = {'system_prompt': 'Inbound: ask why the caller called.',
               'outbound_system_prompt': assistant_prompts.outbound_prompt(metadata)}
    assert assistant_prompts.profile_for_direction(profile, 'INBOUND')['system_prompt'].startswith('Inbound:')
    assert assistant_prompts.profile_for_direction(profile, 'OUTBOUND')['system_prompt'].startswith('Outbound:')
    profile['outbound_system_prompt'] = ' '
    assert assistant_prompts.profile_for_direction(profile, 'OUTBOUND')['system_prompt'].startswith('Inbound:')


@pytest.mark.parametrize('brief,direction', [('', 'INBOUND'), (42, 'INBOUND'), ('x'*2001, 'INBOUND'), ('Synthetic business', 'SIDEWAYS')])
async def test_generation_validates_before_contacting_a_provider(brief, direction):
    with pytest.raises(ValueError):
        await generation.draft_prompt(brief, direction)


@pytest.mark.parametrize('finish_reason', ['stop', 'length'])
async def test_generator_sends_direction_uses_longer_budget_and_rejects_truncation(monkeypatch, finish_reason):
    monkeypatch.setenv('SYNTHETIC_KEY', 'not-a-real-key')
    monkeypatch.setattr(generation, '_providers', lambda: [('synthetic', 'SYNTHETIC_KEY', None, 'synthetic-model')])
    calls = []
    async def create(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='A complete synthetic prompt. '*20), finish_reason=finish_reason)])
    class Client:
        def __init__(self, **kwargs):
            assert kwargs['max_retries'] == 0
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=create))
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(generation.openai, 'AsyncOpenAI', Client)
    if finish_reason == 'length':
        with pytest.raises(generation.GenerationUnavailable):
            await generation.draft_prompt('Synthetic booking business', 'OUTBOUND')
    else:
        result = await generation.draft_prompt('Synthetic booking business', 'OUTBOUND')
        assert result['direction'] == 'OUTBOUND'
    assert 'CALL DIRECTION: OUTBOUND' in calls[0]['messages'][1]['content']
    assert calls[0]['max_tokens'] >= 2000


async def test_generator_failure_does_not_return_a_fake_template_or_provider_secrets(monkeypatch):
    monkeypatch.setenv('SYNTHETIC_KEY', 'not-a-real-key')
    monkeypatch.setattr(generation, '_providers', lambda: [('synthetic', 'SYNTHETIC_KEY', None, 'model')])
    class Client:
        def __init__(self, **kwargs):
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(side_effect=RuntimeError('private provider details'))))
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(generation.openai, 'AsyncOpenAI', Client)
    with pytest.raises(generation.GenerationUnavailable, match='saved prompts have not changed') as exc:
        await generation.draft_prompt('Synthetic business', 'INBOUND')
    assert 'private provider details' not in str(exc.value)


def test_generated_business_draft_cannot_assign_booking_tool_to_cancellation():
    draft = 'EDGE CASES\nUse book_appointment to cancel the consultation.\nKeep Example Studio details.'
    prompt = generation.complete_prompt(draft, 'INBOUND')
    rules, business = prompt.split('BUSINESS INSTRUCTIONS\n')
    assert 'book_appointment' not in business
    assert 'Example Studio' in business
    assert 'it NEVER cancels or reschedules an existing booking' in rules
    assert 'No cancellation/rescheduling tool is assumed' in rules
    assert 'Match the caller' in rules
    assert prompt.startswith('INBOUND: the customer called you.')
    assert generation.complete_prompt('Synthetic business', 'OUTBOUND').startswith('OUTBOUND: you called the customer.')
