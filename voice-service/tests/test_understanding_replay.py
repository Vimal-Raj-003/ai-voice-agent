"""Regression seams found by real-model differential replay, not canned replies."""
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from callstate import CallState
from tools import AppointmentTools


def test_supplied_correct_name_is_not_discarded_by_spelling_keyword():
    state = CallState(entities={'name': 'Wrong', 'date': '2026-11-06'})
    state.observe_user('என் பெயர் spelling தப்பு. என் பெயர் Nila.')
    assert state.entities['name'] == 'Nila'
    assert state.entities['date'] == '2026-11-06'
    assert state.pending_slug == 'name_confirmation'


def test_domain_only_correction_retains_known_local_part():
    state = CallState(entities={'email': 'nila@old.example', 'service': 'e-commerce'})
    state.set_pending('email_confirmation', 'Is this address correct?')
    state.observe_user('Booking-ஐ cancel பண்ணாதீங்க. mail domain மட்டும் தவறு; domain is example.test')
    assert state.entities['email'] == 'nila@example.test'
    assert not state.cancel_requested
    assert state.entities['service'] == 'e-commerce'


def test_ordinary_correct_spelling_phrase_does_not_erase_email():
    state = CallState(entities={'email': 'nila@example.test', 'email_confirmed': 'no'})
    state.set_pending('email_confirmation', 'Is this address correct?')
    state.observe_user("Yes, that's the correct spelling of my email")
    assert state.entities['email'] == 'nila@example.test'


def test_presence_prefix_does_not_override_substantive_question():
    import agent
    from livekit.agents import llm
    state = CallState(intent='appointment_booking', entities={'name': 'Nila'})
    ctx = llm.ChatContext()
    ctx.add_message(role='assistant', content='உங்க email சொல்லுங்க?')
    ctx.add_message(role='user', content='ஹலோ, e-commerce website-க்கு maintenance கிடைக்குமா?')
    owner = agent.BoundedAgent(instructions='Demo', call_state=state)
    result = owner._apply_language_directive(ctx)
    system = '\n'.join(x.text_content or '' for x in result.items if getattr(x, 'role', '') == 'system')
    assert '[MID-CALL PRESENCE CHECK DETECTED]' not in system
    assert 'Answer the current question before resuming intake' in system


@pytest.mark.asyncio
async def test_semantic_confirmation_persists_without_external_write_and_stale_patch_rejected():
    state = CallState(entities={'email': 'nila@example.test', 'email_confirmed': 'no', 'date': '2026-11-06'})
    state.set_pending('email_confirmation', 'nila@example.test சரிதானே?')
    text = 'ஆமாங்க, நீங்க இப்ப சொன்ன mail ID தான் சரி. அதுக்கே confirmation அனுப்புங்க.'
    state.observe_user(text)
    owner = AppointmentTools(SimpleNamespace(), call_state=state)
    result = await owner.update_call_details(turn_id=state.user_turn_id,
                                            field='email', confirmed=True)
    assert state.entities['email_confirmed'] == 'yes'
    assert state.entities['date'] == '2026-11-06'
    assert 'local' in result.lower()
    old_turn = state.user_turn_id
    state.observe_user('இல்லை, email மாற்றணும்')
    result = await owner.update_call_details(turn_id=old_turn, field='email', confirmed=True)
    assert 'stale' in result.lower()


def test_ordinary_question_never_creates_generic_status():
    import agent
    owner = agent.BoundedAgent(instructions='Demo', call_state=CallState())
    for phase in ('knowledge', 'model'):
        owner._reply_phase = phase
        assert owner._first_voice_status() is None


def test_answered_readback_is_not_restored_on_a_tool_followup():
    import agent
    from livekit.agents import llm
    state = CallState(entities={'email': 'nila@example.test', 'email_confirmed': 'no'})
    state.set_pending('email_confirmation', 'nila@example.test சரிதானே?')
    owner = agent.BoundedAgent(instructions='Demo', call_state=state)
    ctx = llm.ChatContext()
    ctx.add_message(role='assistant', content='nila@example.test சரிதானே?')
    ctx.add_message(role='user', content='ஆமாங்க, அதுதான் சரியான mail ID.')
    owner._apply_language_directive(ctx)
    state.apply_understood_details(turn_id=state.user_turn_id, evidence=state._last_observed_user,
                                   values={}, confirmed_field='email')
    owner._apply_language_directive(ctx)
    assert state.pending_slug is None
    assert state.entities['email_confirmed'] == 'yes'


def test_identical_words_on_a_new_sdk_message_are_a_new_turn():
    state = CallState()
    state.observe_user('Hello?', message_id='one')
    state.observe_user('Hello?', message_id='one')
    assert state.user_turn_id == 1
    state.observe_user('Hello?', message_id='two')
    assert state.user_turn_id == 2


def test_valid_email_replacement_survives_an_overconfident_model_flag():
    state = CallState(entities={'email': 'old@example.test', 'email_confirmed': 'no', 'name': 'Nila'})
    state.set_pending('email_confirmation', 'Is old@example.test correct?')
    state.observe_user('Use new@example.test instead')
    # Reset to the previous read-back to exercise an unparsed semantic patch.
    state.entities['email'] = 'old@example.test'
    result = state.apply_understood_details(turn_id=state.user_turn_id, evidence=state._last_observed_user,
                                            values={'email': 'new@example.test'}, confirmed_field='email')
    assert state.entities['email'] == 'new@example.test'
    assert state.entities['email_confirmed'] == 'no'
    assert 'Read back only that field' in result
    assert state.entities['name'] == 'Nila'


@pytest.mark.asyncio
@pytest.mark.parametrize('saved', [True, False])
async def test_recipient_result_is_spoken_from_verified_tool_outcome(monkeypatch, saved):
    import tools as module
    from livekit.agents import llm
    from unittest.mock import Mock
    state = CallState(language='ta', entities={'email': 'nila@example.test', 'email_confirmed': 'no'})
    state.set_pending('email_confirmation', 'Is the address correct?')
    state.observe_user('That is the address I want you to use.')
    owner = AppointmentTools(SimpleNamespace(), phone_number='synthetic-replay', call_state=state)
    owner._last_booking_id = 'SYNTHETIC'
    await owner.update_call_details(turn_id=state.user_turn_id, field='email', confirmed=True)
    update = AsyncMock(return_value=saved)
    monkeypatch.setattr(module.db, 'update_confirmation_email', update)
    queue = Mock(return_value=True)
    monkeypatch.setattr(owner, '_queue_confirmation_email', queue)
    say = Mock()
    result = await owner.remember_details('confirmation requested', context=SimpleNamespace(session=SimpleNamespace(say=say)))
    assert isinstance(result, llm.ToolResult) and not result.reply_required
    update.assert_awaited_once_with('SYNTHETIC', 'synthetic-replay', 'nila@example.test')
    assert say.call_count == 1
    if saved:
        queue.assert_called_once_with('nila@example.test')
        assert 'queue' in say.call_args.args[0]
    else:
        queue.assert_not_called()
        assert 'அனுப்பலை' in say.call_args.args[0]


@pytest.mark.asyncio
async def test_availability_is_spoken_as_a_check_not_a_booking(monkeypatch):
    import tools as module
    from unittest.mock import Mock
    from livekit.agents import llm
    state = CallState(language='ta', entities={'name': 'Nila', 'date': '2026-11-06', 'time': '11:00'})
    owner = AppointmentTools(SimpleNamespace(), call_state=state)
    monkeypatch.setattr(module, 'calcom_enabled', lambda: False)
    monkeypatch.setattr(module.db, 'check_slot', AsyncMock(return_value=True))
    say = Mock()
    result = await owner.check_availability('2026-11-06', '12:00', context=SimpleNamespace(session=SimpleNamespace(say=say)))
    assert isinstance(result, llm.ToolResult) and not result.reply_required
    assert '12:00 PM' in say.call_args.args[0]
    assert 'booking எதுவும் செய்யலை' in say.call_args.args[0]
    assert state.entities['time'] == '12:00'
    assert 'booking' not in state.tool_state


@pytest.mark.asyncio
async def test_unparsed_time_correction_is_routed_to_state_even_if_old_question_is_reobserved(monkeypatch):
    import agent
    from livekit.agents import llm
    from livekit.agents.types import NOT_GIVEN
    state = CallState(entities={'date': '2026-11-06', 'time': '11:00'})
    state.set_pending('confirm', 'November 6, 11 AM சரிதானே?')
    tools = AppointmentTools(SimpleNamespace(), call_state=state)
    owner = agent.BoundedAgent(instructions='Demo', call_state=state)
    ctx = llm.ChatContext()
    ctx.add_message(role='assistant', content='November 6, 11 AM சரிதானே?')
    msg = ctx.add_message(role='user', content='தேதி அதே தான். நேரம் மட்டும் noon twelve-க்கு மாற்றுங்க.')
    await owner.on_user_turn_completed(ctx, msg)
    choices = []
    async def stream(model, context, tools, choice, conn, result):
        choices.append(choice)
        result.update(status='ok')
        yield SimpleNamespace(delta=SimpleNamespace(content='', tool_calls=[SimpleNamespace(name='update_call_details')]))
    monkeypatch.setattr(agent, '_stream_gated', stream)
    monkeypatch.setattr(owner, '_knowledge_context', AsyncMock(return_value=''))
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=object()))
    _ = [x async for x in owner.llm_node(ctx, [tools.update_call_details], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert choices[0]['function']['name'] == 'update_call_details'


@pytest.mark.asyncio
async def test_real_model_time_arguments_keep_valid_correction_despite_confirmation_flag():
    from unittest.mock import Mock
    from livekit.agents import llm
    state = CallState(language='ta', entities={'time': '11:00', 'date': '2026-11-06', 'name': 'Nila'})
    state.observe_user('நேரம் மட்டும் noon twelve-க்கு மாற்றுங்க.')
    owner = AppointmentTools(SimpleNamespace(), call_state=state)
    say = Mock()
    # Exact argument shape captured from the real configured model replay.
    result = await owner.update_call_details(turn_id=1, field='time', value='12:00', confirmed=True,
                                             context=SimpleNamespace(session=SimpleNamespace(say=say)))
    assert state.entities['time'] == '12:00'
    assert state.entities['date'] == '2026-11-06'
    assert state.entities['name'] == 'Nila'
    assert isinstance(result, llm.ToolResult) and not result.reply_required
    assert '12:00 PM' in say.call_args.args[0]
    assert 'Booking இன்னும் உறுதி செய்யலை' in say.call_args.args[0]


@pytest.mark.asyncio
async def test_closed_agent_stream_releases_source_and_is_traced_as_cancelled():
    from response_timing import ResponseTiming, with_first_voice_target
    events = []
    closed = []
    class Owner:
        _response_timing = ResponseTiming(log=lambda event, **fields: events.append((event, fields)))
        _first_voice_status = staticmethod(lambda: None)
        @with_first_voice_target
        async def node(self):
            try:
                yield SimpleNamespace(delta=SimpleNamespace(content='Useful answer.', tool_calls=[]))
            finally:
                closed.append(True)
    stream = Owner().node()
    await anext(stream)
    await stream.aclose()
    assert closed == [True]
    assert events[-1][1]['outcome'] == 'cancelled'
