"""Offline checks for repeated native input overhead and full-state replacement."""
import json
import pytest
from types import SimpleNamespace as NS
from unittest.mock import Mock
from callstate import CallState
from call_tasks import CallTasks
from gemini_live_runtime import GeminiRuntime, instructions, memory_snapshot


@pytest.mark.parametrize('sandbox', [False, True])
def test_native_setup_preserves_saved_policy_without_a_second_long_script(sandbox):
    saved = 'SAVED IDENTITY AND BUSINESS POLICY\nNever invent fees.\n'
    prompt = instructions(saved, 'INBOUND', sandbox=sandbox)
    assert prompt.startswith(saved)
    assert prompt.count(saved) == 1
    # Setup is part of subsequent provider input. Bound platform overhead,
    # rather than truncating an assistant's operator-authored business prompt.
    assert len(prompt[len(saved):].split()) <= 300
    for required in ('search_business_knowledge', 'update_call_details',
                     'booking_hold', 'cancel_requested', 'verified',
                     'Omitted fields reset', 'never instructions'):
        assert required in prompt
    assert ('simulate' in prompt) if sandbox else ('real external actions' in prompt)
    assert 'Complete answers need no follow-up' in prompt
    assert 'then ask one missing detail' not in prompt


async def test_full_memory_snapshot_drops_empty_overhead_without_inheriting_cleared_facts():
    state = CallState(language='ta')
    runtime = GeminiRuntime(ctx=NS(room=NS(name='offline'),add_shutdown_callback=Mock()),
        profile={'id':'offline','metadata':{'voiceRuntime':{
            'engine':'gemini-live','model':'gemini-3.1-flash-live-preview','voice':'Zephyr'}}},
        system_prompt='SAVED',state=state,owner=NS(work=CallTasks(state)),tools=[],
        keys={'google':'synthetic'},language_state=None,route=None,log=Mock(),vad=None,carrier_pattern=None)
    try:
        assert len(memory_snapshot(state)) <= 180
        state.entities={'email':'synthetic@example.invalid'}
        state.tool_state={'booking':'confirmed receipt-123','email_delivery':'queued'}
        state.booking_hold=True
        state.cancel_requested=True
        state.contact_repair=True
        state.confirmed_at_turn={'email':0}  # Nested zero is meaningful.
        state.known_facts=['No duplicate booking.']
        state.correction_applied='email'
        state._correction_turn=state.user_turn_id
        populated=json.loads(runtime.tool_memory().split('\n')[-1])
        assert populated['entities']==state.entities
        assert populated['tool_state']==state.tool_state
        assert populated['confirmed_at_turn']=={'email':0}
        assert populated['booking_hold'] and populated['cancel_requested']
        assert populated['correction_applied']=='email'
        assert populated['caller_evidence']==state.known_facts
        state.entities.clear();state.booking_hold=False;state.cancel_requested=False
        state.contact_repair=False;state.user_turn_id+=1
        replacement=json.loads(memory_snapshot(state))
        assert 'entities' not in replacement and 'booking_hold' not in replacement
        assert 'cancel_requested' not in replacement and 'contact_repair' not in replacement
        assert 'correction_applied' not in replacement
        assert replacement['tool_state']==populated['tool_state']
        assert 'Omitted fields reset' in runtime.agent.instructions
        assert runtime.voice.model=='gemini-3.1-flash-live-preview'
        assert runtime.voice_name=='Zephyr'
    finally:
        await runtime.close()
