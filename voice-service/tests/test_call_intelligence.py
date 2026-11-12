"""Conversation intelligence contracts; no network, audio sessions or business writes."""
import json
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

import pytest

from call_intelligence import CallIntelligence, IntelligencePolicy, business_outcome
from callstate import CallState


def test_assistant_policy_decodes_json_and_preserves_explicit_false():
    policy = IntelligencePolicy.from_profile({'metadata': json.dumps({'intelligence': {'emotion': False}})})
    assert not policy.emotion and policy.memory and policy.recovery
    assert '[REPAIR]' not in CallState().to_directive()


def test_emotion_is_tentative_context_and_can_recover_from_negative_mood():
    state = CallState(language='ta')
    state.observe_user('எனக்கு ரொம்ப கவலையா இருக்கு', '1')
    assert state.response_tone == 'serious'
    assert 'tentative' in state.to_directive()
    state.observe_user('இப்போ சரியாயிடுச்சு, நல்ல செய்தி சொல்லணும்', '2')
    assert state.response_tone == 'positive'
    assert 'diagnos' not in state.intelligence.report(state)['emotion']['current']


def test_memory_keeps_service_and_negative_requirement_through_long_intake():
    state = CallState(language='en')
    state.observe_user('My existing website is slow; do not create a new website.', '0')
    for i in range(35):
        state.observe_user(f'This is another harmless conversation sentence number {i}.', str(i+1))
    assert 'existing website' in state.to_directive()
    assert len(state.intelligence.anchors) <= 6
    assert len(state.intelligence.recent) <= 4
    preview = state.preparation_copy()
    preview.observe_user('I am frustrated by this answer.', 'preview')
    assert state.intelligence.counters != preview.intelligence.counters


def test_caller_correction_requests_repair_without_mutating_verified_booking():
    state = CallState(language='en')
    state.set_tool_fact('booking', state='confirmed:synthetic', entities={'date': '2026-11-20'})
    state.observe_user('That is not what I asked. You already asked me that.', '1')
    assert 'REPAIR' in state.to_directive()
    assert state.entities['date'] == '2026-11-20'
    assert state.intelligence.counters['caller_repairs'] == 1


def test_transient_recovery_is_bounded_and_permanent_errors_fail_closed():
    intelligence = CallIntelligence()
    assert intelligence.recover(NS(recoverable=True, status_code=503))
    assert intelligence.recover(NS(recoverable=True, status_code=503))
    assert not intelligence.recover(NS(recoverable=True, status_code=503))
    other = CallIntelligence()
    assert not other.recover(NS(recoverable=True, status_code=401))
    assert other.counters['recovery_attempts'] == 0


def test_quality_excludes_greeting_and_labels_room_measurement_boundaries():
    state = CallState()
    intel = state.intelligence
    intel.playback(0, now=1)
    intel.speech_end(now=2)
    state.observe_user('What services do you offer?', '1')
    intel.playback(state.user_turn_id, now=2.75)
    intel.playback(state.user_turn_id, now=3)
    report = intel.report(state)
    assert report['quality']['response_samples'] == 1
    assert report['quality']['room_response_p95_ms'] == 750
    assert report['quality']['handset_timing_verified'] is False
    assert 'score' not in report['quality']


def test_booking_and_email_outcomes_need_receipts_not_spoken_claims():
    state = CallState()
    state.observe_assistant('Your appointment is confirmed and the email was sent.')
    assert business_outcome(state, NS(_last_booking_id=None, _deliveries={}))['booking'] == 'unverified'
    state.set_tool_fact('booking', state='confirmed:synthetic')
    owner = NS(_last_booking_id='synthetic', _deliveries={('synthetic','synthetic@example.test'):'queued'})
    result = business_outcome(state, owner)
    assert result['booking'] == 'confirmed' and result['email'] == 'queued'
    assert 'example.test' not in json.dumps(result)


async def test_quality_metadata_merge_does_not_replace_dispatch_or_provider_metadata(monkeypatch):
    import db
    execute = AsyncMock(return_value='UPDATE 1')
    monkeypatch.setattr(db, 'get_pool', AsyncMock(return_value=NS(execute=execute)))
    report = CallState().intelligence.report(CallState())
    await db.save_call_intelligence('synthetic-call', report)
    sql, ident, payload = execute.call_args.args
    assert "COALESCE(metadata" in sql and '||' in sql
    assert ident == 'synthetic-call'
    assert json.loads(payload)['callIntelligence']['version'] == 1


async def test_end_call_cannot_mark_booked_without_a_real_booking_receipt():
    from tools import AppointmentTools
    ctx = NS(room=NS(name='synthetic', disconnect=AsyncMock()))
    state = CallState()
    owner = AppointmentTools(ctx, 'synthetic', call_state=state)
    result = await owner.end_call(outcome='booked')
    assert 'not verified' in result.lower()
    ctx.room.disconnect.assert_not_awaited()
    state.set_tool_fact('booking', state='confirmed:synthetic')
    state.observe_user('Thanks, bye.','closing')
    await owner.end_call(outcome='booked')
    ctx.room.disconnect.assert_awaited_once()


def test_disabling_optional_features_keeps_core_state_and_suppresses_optional_report():
    state = CallState()
    settings = {key: False for key in IntelligencePolicy.__dataclass_fields__}
    state.intelligence.configure({'metadata': {'intelligence': settings}})
    state.observe_user('My name is Arun', '1')
    assert state.entities['name'] == 'Arun'
    assert state.intelligence.anchors == []
    assert set(state.intelligence.report(state)) == {'version', 'features'}


@pytest.mark.parametrize('final_before_speech_end', [True, False])
def test_room_latency_handles_both_sdk_transcript_event_orders(final_before_speech_end):
    state = CallState()
    state.intelligence.speech_start()
    if final_before_speech_end:
        state.observe_user('What services do you offer?', '1')
    state.intelligence.speech_end(now=10)
    if not final_before_speech_end:
        state.observe_user('What services do you offer?', '1')
    state.intelligence.playback(1, now=11)
    assert state.intelligence.room_response_ms == [1000]


@pytest.mark.parametrize('enabled', [True, False])
async def test_actual_native_error_handler_preserves_context_and_only_allows_sdk_recovery(enabled):
    from unittest.mock import Mock
    from gemini_live_runtime import GeminiRuntime
    from call_tasks import CallTasks
    state = CallState()
    state.observe_user('My existing website is slow; do not book yet.', '1')
    ctx = NS(room=NS(name='synthetic'), add_shutdown_callback=Mock(), shutdown=Mock())
    runtime = GeminiRuntime(ctx=ctx, profile={'metadata': {'voiceRuntime': {'engine': 'gemini-live'},
        'intelligence': {'recovery': enabled}}}, system_prompt='SAVED POLICY', state=state,
        owner=NS(work=CallTasks(state)), tools=[], keys={'google': 'synthetic'}, language_state=None,
        route=None, log=Mock(), vad=None, carrier_pattern=None)
    try:
        before = state.snapshot()
        runtime.error(NS(error=NS(recoverable=True, status_code=503)))
        assert state.snapshot() == before
        assert runtime.voice._opts.conn_options.max_retry == (2 if enabled else 0)
        assert ctx.shutdown.called is not enabled
        if enabled:
            runtime.state.intelligence.playback(0)
            assert state.intelligence.counters['recoveries'] == 1
    finally:
        await runtime.close()


async def test_invalid_native_tool_arguments_never_submit_an_action():
    from unittest.mock import Mock
    from livekit.agents import llm
    from gemini_live_runtime import GeminiRuntime
    from call_tasks import CallTasks
    writes = []

    @llm.function_tool
    async def synthetic_action(confirmed: bool) -> str:
        """Synthetic action; no external operation."""
        writes.append(confirmed)
        return 'Done'

    state = CallState()
    runtime = GeminiRuntime(ctx=NS(room=NS(name='synthetic'), add_shutdown_callback=Mock()),
        profile={'metadata': {'voiceRuntime': {'engine': 'gemini-live'}}}, system_prompt='SAVED', state=state,
        owner=NS(work=CallTasks(state)), tools=[synthetic_action], keys={'google':'synthetic'},
        language_state=None, route=None, log=Mock(), vad=None, carrier_pattern=None)
    runtime.ready.set()
    try:
        from livekit.agents.llm.utils import prepare_function_arguments
        args, kwargs = prepare_function_arguments(fnc=runtime.tools[0], json_arguments={'confirmed': 'null'})
        result = await runtime.tools[0](*args, **kwargs)
        assert writes == []
        assert 'no action was submitted' in result
        assert state.intelligence.counters['invalid_tool_arguments'] == 1
        state.intelligence.recover(NS(recoverable=True, status_code=503))
        args, kwargs = prepare_function_arguments(fnc=runtime.tools[0], json_arguments={'confirmed': True})
        await runtime.tools[0](*args, **kwargs)
        assert writes == [True]
        assert state.intelligence.recovering  # A settled business action is not a restored voice connection.
        runtime.metrics(NS(metrics=NS(type='realtime_model_metrics', request_id='synthetic-resumed',
                                      input_tokens=0, output_tokens=0)))
        assert not state.intelligence.recovering
        assert state.intelligence.counters['recoveries'] == 1
    finally:
        await runtime.close()
