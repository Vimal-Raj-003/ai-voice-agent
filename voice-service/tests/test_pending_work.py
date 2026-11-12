"""Synthetic reproductions of interruption and recipient races; no external I/O."""
import asyncio
from unittest.mock import AsyncMock, MagicMock
import pytest
from callstate import CallState
from tools import AppointmentTools
from call_tasks import CallTasks
from contact_corrections import turn_intent
from types import SimpleNamespace


@pytest.mark.asyncio
async def test_presence_interruption_does_not_restart_slow_lookup(monkeypatch):
    import tools
    monkeypatch.setattr(tools, 'calcom_enabled', lambda: False)
    entered, finish = asyncio.Event(), asyncio.Event()
    async def lookup(*_):
        entered.set()
        await finish.wait()
        return True
    query = AsyncMock(side_effect=lookup)
    monkeypatch.setattr(tools.db, 'check_slot', query)
    state = CallState()
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    first = asyncio.create_task(owner.check_availability('2026-12-04', '11:00'))
    await entered.wait()
    first.cancel()  # the SDK interrupted a spoken turn, not the requested work
    await asyncio.gather(first, return_exceptions=True)
    state.observe_user('Hello?')
    second = asyncio.create_task(owner.check_availability('2026-12-04', '11:00'))
    finish.set()
    assert await second == 'available'
    assert query.await_count == 1


@pytest.mark.asyncio
async def test_rejected_queued_recipient_never_starts_smtp(monkeypatch):
    import notify
    state = CallState(entities={'email': 'old@example.test', 'email_confirmed': 'yes'})
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    owner._last_booking_id = 'BOOK1'
    sender = MagicMock(return_value=True)
    monkeypatch.setattr(notify, 'send_booking_confirmation_email', sender)
    owner._queue_confirmation_email('old@example.test')
    state.observe_user('Email spelling wrong')
    await asyncio.gather(*owner._bg_tasks)
    sender.assert_not_called()


@pytest.mark.asyncio
async def test_successful_corrected_confirmation_is_not_queued_again(monkeypatch):
    import tools
    import notify
    state = CallState(entities={'email': 'new@example.test', 'email_confirmed': 'yes'}, contact_repair=True)
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    owner._last_booking_id = 'BOOK1'
    monkeypatch.setattr(tools.db, 'update_confirmation_email', AsyncMock(return_value=True))
    monkeypatch.setattr(tools.db, 'add_contact_memory', AsyncMock())
    monkeypatch.setattr(tools.db, 'get_contact_memory', AsyncMock(return_value=[]))
    sender = MagicMock(return_value=True)
    monkeypatch.setattr(notify, 'send_booking_confirmation_email', sender)
    await owner.remember_details('new@example.test')
    await asyncio.gather(*owner._bg_tasks)
    await owner.remember_details('new@example.test')
    await asyncio.gather(*owner._bg_tasks)
    assert sender.call_count == 1


@pytest.mark.parametrize('text, expected', [
    ('Hello?', 'presence'), ('Paathutteengala?', 'status'),
    ('பாத்துட்டீங்களா?', 'status'), ('Spelling thappu', 'correction'),
    ('cancel pannunga', 'cancel'), ('cancel பண்ணுங்க', 'cancel'),
    ('What is your cancellation policy?', 'content'), ('yes correct', 'content'),
])
def test_presence_correction_and_cancellation_are_distinct(text, expected):
    assert turn_intent(text) == expected


@pytest.mark.asyncio
async def test_sdk_progress_update_is_once_and_actual_work_continues():
    state = CallState(language='ta')
    work = CallTasks(state)
    state.work = work
    work.progress_delay = .005
    finish = asyncio.Event()
    async def lookup():
        await finish.wait()
        return 'available'
    operation = AsyncMock(side_effect=lookup)
    context = SimpleNamespace(update=AsyncMock())
    first = asyncio.create_task(work.run('availability', {'date': '2026-12-04'}, operation, context))
    while not context.update.await_count:
        await asyncio.sleep(.002)
    second = asyncio.create_task(work.run('availability', {'date': '2026-12-04'}, operation, context))
    assert 'availability check' in work.acknowledgement('Hello?', 'ta')
    assert 'availability check' in work.acknowledgement('Paathutteengala?', 'ta')
    finish.set()
    assert await first == await second == 'available'
    operation.assert_awaited_once()
    context.update.assert_awaited_once()
    assert work.acknowledgement('Paathutteengala?', 'ta') is None
    assert 'available' in work.directive()


@pytest.mark.asyncio
async def test_late_lookup_cannot_overwrite_a_correction(monkeypatch):
    import tools
    state = CallState(entities={'email': 'old@example.test'})
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    monkeypatch.setattr(tools, 'calcom_enabled', lambda: False)
    entered, finish = asyncio.Event(), asyncio.Event()
    async def ignores_cancellation(*_):
        entered.set()
        try:
            await finish.wait()
        except asyncio.CancelledError:
            await finish.wait()  # simulate a transport returning a late result
        return True
    monkeypatch.setattr(tools.db, 'check_slot', ignores_cancellation)
    pending = asyncio.create_task(owner.check_availability('2026-12-04', '11:00'))
    await entered.wait()
    state.observe_user('Email spelling thappu')
    finish.set()
    result = await pending
    assert 'stopped' in result
    assert 'availability' not in state.tool_state
    assert 'email' not in state.entities


@pytest.mark.asyncio
async def test_cancel_before_submission_stops_work_without_a_write():
    state = CallState()
    work = CallTasks(state)
    state.work = work
    entered, finish = asyncio.Event(), asyncio.Event()
    write = AsyncMock()
    async def booking():
        entered.set()
        await finish.wait()
        work.committing()
        await write()
        return 'booked'
    pending = asyncio.create_task(work.run('booking', {}, booking))
    await entered.wait()
    state.observe_user('cancel pannunga')
    finish.set()
    assert 'stopped' in await pending
    write.assert_not_awaited()


@pytest.mark.asyncio
async def test_cancel_after_submission_reports_committed_result_without_retry():
    state = CallState()
    work = CallTasks(state)
    state.work = work
    submitted, finish = asyncio.Event(), asyncio.Event()
    async def booking():
        work.committing()
        submitted.set()
        await finish.wait()
        return 'Booking reference TEST123 confirmed.'
    operation = AsyncMock(side_effect=booking)
    pending = asyncio.create_task(work.run('booking', {}, operation))
    await submitted.wait()
    state.observe_user('cancel pannunga')
    duplicate = await work.run('booking', {'service': 'different'}, operation)
    assert 'already been submitted' in duplicate
    finish.set()
    result = await pending
    assert 'TEST123' in result and 'after submission' in result
    operation.assert_awaited_once()


@pytest.mark.asyncio
async def test_tool_timeout_is_finite_and_does_not_claim_success():
    events = []
    work = CallTasks(CallState(), log=lambda event, **kw: events.append((event, kw)))
    work.read_timeout = .01
    result = await work.run('availability', {}, lambda: asyncio.sleep(10))
    assert 'timed out' in result and 'unknown' in result
    assert work.items[-1].status == 'timed_out'
    assert events[-1][1]['duration_ms'] < 300


@pytest.mark.asyncio
async def test_tool_failure_is_reported_without_success_or_retry():
    work = CallTasks(CallState())
    operation = AsyncMock(side_effect=RuntimeError('test provider failed'))
    assert 'failed' in await work.run('availability', {}, operation)
    operation.assert_awaited_once()
    assert work.items[-1].status == 'failed'


@pytest.mark.asyncio
async def test_fast_work_has_no_filler_or_extra_model_round():
    work = CallTasks(CallState())
    context = SimpleNamespace(update=AsyncMock())
    assert await work.run('availability', {}, AsyncMock(return_value='available'), context) == 'available'
    context.update.assert_not_awaited()


def test_caller_state_and_serious_context_survive_without_cross_call_leaks():
    first, second = CallState(language='ta'), CallState()
    first.observe_user('எனக்கு உடம்பு சரியில்லை')
    for n in range(20):
        first.observe_user(f'அடுத்த விஷயம் {n}')
    assert first.response_tone == 'serious'
    first.work = CallTasks(first)
    assert second.response_tone == 'neutral'
    assert second.work is None and second.entities == {}


@pytest.mark.asyncio
async def test_presence_uses_a_single_interruptible_reply_without_model_or_tool_restart():
    import agent
    state = CallState(language='ta')
    work = CallTasks(state)
    state.work = work
    entered, finish = asyncio.Event(), asyncio.Event()
    async def lookup():
        entered.set()
        await finish.wait()
        return 'available'
    operation = AsyncMock(side_effect=lookup)
    pending = asyncio.create_task(work.run('availability', {}, operation))
    await entered.wait()
    session = SimpleNamespace(say=MagicMock(return_value=SimpleNamespace(id='ACK1')))
    owner = SimpleNamespace(_call_state=state, _lang_state=SimpleNamespace(active='ta'), _room_id='synthetic', session=session)
    state.observe_user('Hello?')
    assert await agent.BoundedAgent._handle_work_turn(owner, 'Hello?')
    assert 'availability check' in session.say.call_args.args[0]
    assert session.say.call_args.kwargs['allow_interruptions'] is True
    assert work.last_ack['speech_id'] == 'ACK1'
    finish.set()
    await pending
    operation.assert_awaited_once()


@pytest.mark.parametrize('question,slot,reply', [
    ('சேவை எது வேணும்?', 'service', 'e-commerce'),
    ('தேதி என்ன?', 'date', 'November 6'),
    ('உங்க பேர் என்ன?', 'name', 'Abi'),
])
def test_actual_spoken_question_order_preserves_short_answers(question, slot, reply):
    state = CallState()
    state.observe_assistant(question)
    state.observe_user(reply)
    assert state.entities.get(slot) == reply


def test_explicit_partial_email_correction_preserves_clear_parts_and_confirms():
    state = CallState()
    state.observe_user('abhi@example.test')
    state.observe_user('email spelling thappu')
    state.observe_user('replace h with i')
    assert state.entities['email'] == 'abii@example.test'
    assert state.entities['email_confirmed'] == 'no'
    state.observe_user('yes')
    assert state.entities['email_confirmed'] == 'yes'


def test_ambiguous_character_correction_is_never_guessed():
    state = CallState()
    state.observe_user('aaba@example.test')
    state.observe_user('email spelling wrong')
    state.observe_user('replace a with e')
    assert 'email' not in state.entities


@pytest.mark.asyncio
async def test_concurrent_booking_waiters_make_one_database_write(monkeypatch):
    import tools
    monkeypatch.setattr(tools, 'calcom_enabled', lambda: False)
    monkeypatch.setattr(tools.db, 'find_booked_appointment', AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, 'find_booked_slot', AsyncMock(return_value=None))
    monkeypatch.setattr(tools.db, 'check_slot', AsyncMock(return_value=True))
    entered, finish = asyncio.Event(), asyncio.Event()
    async def save(*args, **kwargs):
        entered.set()
        await finish.wait()
        return 'SYNTH123'
    write = AsyncMock(side_effect=save)
    monkeypatch.setattr(tools.db, 'insert_appointment', write)
    owner = AppointmentTools(MagicMock(), '+910000000000')
    args = ('Synthetic', '2026-12-04', '11:00', 'demo')
    first = asyncio.create_task(owner.book_appointment(*args))
    await asyncio.wait_for(entered.wait(), 2)
    second = asyncio.create_task(owner.book_appointment(*args))
    finish.set()
    assert await first == await second
    write.assert_awaited_once()


@pytest.mark.asyncio
async def test_inflight_smtp_cannot_be_recalled_or_mark_new_address_delivered(monkeypatch):
    import notify
    import threading
    entered, finish = threading.Event(), threading.Event()
    def send(*args):
        entered.set()
        finish.wait(3)
        return True
    sender = MagicMock(side_effect=send)
    monkeypatch.setattr(notify, 'send_booking_confirmation_email', sender)
    state = CallState(entities={'email': 'old@example.test', 'email_confirmed': 'yes'})
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    owner._last_booking_id = 'SYNTH123'
    owner._queue_confirmation_email('old@example.test')
    await asyncio.to_thread(entered.wait, 2)
    assert state.entities['email_delivery'] == 'sending'
    state.observe_user('Wrong email, new@example.test')
    assert state.entities['email_previous_delivery'] == 'sending'
    finish.set()
    await asyncio.gather(*owner._bg_tasks)
    assert state.entities['email_previous_delivery'] == 'sent'
    assert state.entities['email_delivery'] != 'sent'
    sender.assert_called_once()


@pytest.mark.asyncio
async def test_failed_recipient_write_never_sends_or_claims_updated(monkeypatch):
    import tools
    state = CallState(entities={'email': 'new@example.test', 'email_confirmed': 'yes'}, contact_repair=True)
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    owner._last_booking_id = 'SYNTH123'
    monkeypatch.setattr(tools.db, 'update_confirmation_email', AsyncMock(return_value=False))
    owner._queue_confirmation_email = MagicMock()
    assert 'Could not update' in await owner.remember_details('new@example.test')
    owner._queue_confirmation_email.assert_not_called()


@pytest.mark.asyncio
async def test_saved_prompt_and_latest_correction_reach_actual_fallback_request(monkeypatch):
    import agent
    import llm_routing
    from livekit.agents import llm
    from livekit.agents.types import NOT_GIVEN
    saved = 'You are Synthetic Priya. Follow the approved hospital transfer policy.'
    class FakeLLM:
        def __init__(self, fail=False):
            self.fail, self.requests = fail, []
        def chat(self, *, chat_ctx, **kwargs):
            self.requests.append(chat_ctx)
            owner = self
            class Stream:
                async def __aenter__(self):
                    if owner.fail:
                        raise RuntimeError('synthetic rate limit 429')
                    return self
                async def __aexit__(self, *args):
                    pass
                def __aiter__(self):
                    return self
                async def __anext__(self):
                    if getattr(self, 'done', False):
                        raise StopAsyncIteration
                    self.done = True
                    return SimpleNamespace(delta=SimpleNamespace(content='Please confirm the corrected email.', tool_calls=None))
            return Stream()
    primary, fallback = FakeLLM(True), FakeLLM()
    route = llm_routing.LlmRoute(selected_provider='openrouter', primary_provider='openrouter', primary_model='synthetic-primary', fallback_provider='openrouter', fallback_model='synthetic-fallback')
    state = CallState()
    owner = agent.BoundedAgent(instructions=saved, call_state=state, assistant_id='synthetic-assistant', llm_route=route, fallback_llm=fallback, fallback_label='openrouter/synthetic-fallback')
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=primary))
    monkeypatch.setattr(owner, '_knowledge_context', AsyncMock(return_value=''))
    context = llm.ChatContext()
    # Even a recovered context without the original system message must regain it.
    context.add_message(role='user', content='Wrong email; new@example.test')
    output = [chunk async for chunk in owner.llm_node(context, [], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert output and len(fallback.requests) == 1
    for request in (primary.requests[0], fallback.requests[0]):
        messages = '\n'.join(item.text_content or '' for item in request.items)
        assert saved in messages
        assert 'email=new@example.test' in messages
    assert primary.requests[0] is fallback.requests[0]


@pytest.mark.asyncio
async def test_database_recipient_verifies_both_records_in_one_transaction(monkeypatch):
    import db
    from unittest.mock import Mock
    conn = SimpleNamespace(fetchrow=AsyncMock(return_value={'id': 'APPT1', 'email': 'new@example.test'}),
                           execute=AsyncMock(), fetchval=AsyncMock(return_value=True))
    class Transaction:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    conn.transaction = Mock(return_value=Transaction())
    class Acquire:
        async def __aenter__(self): return conn
        async def __aexit__(self, *args): pass
    monkeypatch.setattr(db, 'get_pool', AsyncMock(return_value=SimpleNamespace(acquire=Mock(return_value=Acquire()))))
    assert await db.update_confirmation_email('SYNTH123', '+910000000000', 'new@example.test')
    assert 'phone_number = $2' in conn.fetchrow.call_args.args[0]
    assert 'UPDATE contacts SET email' in conn.execute.call_args.args[0]
    assert 'a.email = $2 AND c.email = $2' in conn.fetchval.call_args.args[0]
    conn.fetchval.return_value = False
    with pytest.raises(RuntimeError, match='rolled back'):
        await db.update_confirmation_email('SYNTH123', '+910000000000', 'new@example.test')


def test_email_letters_and_domain_can_arrive_in_separate_turns():
    state = CallState()
    state.set_pending('email', 'What is your email?')
    state.observe_user('A B I')
    assert state.email_spelled_local == 'abi'
    assert 'email' not in state.entities
    state.observe_user('at example dot test')
    assert state.entities['email'] == 'abi@example.test'
    assert state.pending_slug == 'email_confirmation'
    assert state.entities['email_confirmed'] == 'no'


@pytest.mark.asyncio
async def test_unknown_booking_outcome_blocks_later_retries_even_after_cache_expiry():
    state = CallState()
    work = CallTasks(state)
    async def unknown():
        work.committing()
        work.uncertain()
        return 'The calendar result is unknown.'
    await work.run('booking', {}, unknown)
    work.items[-1].finished -= 60
    state.observe_user('book appointment again')
    write = AsyncMock()
    assert 'unknown outcome' in await work.run('booking', {'email': 'new@example.test'}, write)
    write.assert_not_awaited()


def test_tamil_language_rule_and_serious_policy_do_not_prescribe_stock_sympathy():
    import lang
    from conversation_style import TONE_POLICY
    directive = lang.llm_language_directive('ta')
    assert 'அச்சச்சோ' not in directive and 'truly care' not in directive
    assert 'do not' in directive.lower()
    assert 'clinical advice' in TONE_POLICY and 'approved escalation' in TONE_POLICY


@pytest.mark.asyncio
async def test_installed_sdk_retains_natural_pause_floor_without_speculative_generation(monkeypatch):
    from turn_policy import voice_turn_options
    from livekit.agents import AgentSession
    from livekit.agents.voice.endpointing import create_endpointing
    monkeypatch.setenv('VOICE_PREEMPTIVE_GENERATION', 'false')
    monkeypatch.delenv('VOICE_PAUSE_FLOOR_MS', raising=False)
    options = voice_turn_options({'min_pause_ms': 350, 'end_of_speech_sensitivity': 'MEDIUM'})
    session = AgentSession(turn_handling=options)
    assert not session.options.preemptive_generation['enabled']
    endpointing = create_endpointing(session.options.endpointing)
    # Synthetic speech events for one Tamil request interrupted by thinking pauses.
    endpointing.on_start_of_speech(0.)
    endpointing.on_end_of_speech(1.)
    endpointing.on_start_of_speech(1.6)  # 600ms within the held turn
    endpointing.on_end_of_speech(2.6)
    endpointing.on_start_of_speech(3.4)  # 800ms within the held turn
    endpointing.on_end_of_speech(4.)
    assert endpointing.min_delay == 1.0
    endpointing.on_start_of_agent_speech(5.)
    endpointing.on_start_of_speech(5.6, overlapping=True)
    assert endpointing.overlapping
    assert session.options.interruption['min_words'] == 0


def test_provider_failure_reply_does_not_blame_callers_hearing():
    import agent
    owner = SimpleNamespace(_lang_state=SimpleNamespace(active='en'), _consec_recovery=1)
    reply = agent.BoundedAgent._recovery_line(owner)
    assert 'could not complete' in reply
    assert 'repeat' not in reply and 'catch that' not in reply


@pytest.mark.asyncio
async def test_failed_email_is_not_automatically_retried_but_explicit_retry_is_allowed(monkeypatch):
    import tools
    import notify
    state = CallState(entities={'email': 'new@example.test', 'email_confirmed': 'yes'}, contact_repair=True)
    owner = AppointmentTools(MagicMock(), '+910000000000', call_state=state)
    owner._last_booking_id = 'SYNTH123'
    monkeypatch.setattr(tools.db, 'update_confirmation_email', AsyncMock(return_value=True))
    sender = MagicMock(return_value=False)
    monkeypatch.setattr(notify, 'send_booking_confirmation_email', sender)
    await owner.remember_details('new@example.test')
    await asyncio.gather(*owner._bg_tasks)
    # Different tool arguments must not accidentally bypass the per-recipient guard.
    assert 'No automatic resend' in await owner.remember_details('Correct email new@example.test')
    assert sender.call_count == 1
    state.observe_user('Please resend the email')
    await owner.remember_details('new@example.test')
    await asyncio.gather(*owner._bg_tasks)
    assert sender.call_count == 2
    assert not state.email_retry_requested


@pytest.mark.parametrize('confirmation', ['correct', 'yes correct', "that's correct", 'கரெக்ட்', 'yes, correct', 'ஆமா correct', 'that is correct'])
def test_readback_confirmation_is_not_misclassified_as_another_correction(confirmation):
    state = CallState()
    state.observe_user('synthetic@example.test')
    state.observe_user(confirmation)
    assert state.entities.get('email') == 'synthetic@example.test'
    assert state.entities.get('email_confirmed') == 'yes'
