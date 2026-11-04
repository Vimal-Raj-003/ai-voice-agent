"""Regression inputs from the failed call, with synthetic contact values."""
import pytest

from callstate import CallState
from contact_corrections import PRESENCE
from lang import LanguageState


@pytest.mark.parametrize('reply', ['எனக்கு நாளைக்கு.', 'நாளைக்கு மாலை நாலு மணிக்கு வேணும்.',
                                  'tomorrow afternoon', 'என் பெயர் எனக்கு நாளைக்கு'])
def test_scheduling_reply_cannot_be_saved_as_name(reply):
    state = CallState(entities={'service': 'existing website maintenance'})
    state.set_pending('name', 'உங்கள் பெயர் என்ன?')
    state.observe_user(reply)
    assert 'name' not in state.entities
    assert state.pending_slug == 'name'
    assert state.entities['service'] == 'existing website maintenance'


def test_original_problem_survives_contact_intake_and_history_trimming():
    from livekit.agents import llm
    state = CallState()
    original = 'எனக்கு ஏற்கனவே ஒரு e-commerce website இருக்கு. புதுசா website வேண்டாம்.'
    problem = 'என்னோட website ரொம்ப slow-வா இருக்கு. maintenance பண்ணுவீங்களா?'
    state.observe_user(original)
    state.observe_user(problem)
    for i in range(18):
        state.observe_user(f'மற்றொரு விவரம் பற்றி கேட்கிறேன் number {i}')
    history = llm.ChatContext()
    history.add_message(role='user', content=original)
    for i in range(20):
        history.add_message(role='user', content=f'later turn {i}')
    history.truncate(max_items=12)
    assert original not in ' '.join(i.text_content or '' for i in history.items)
    directive = state.to_directive()
    assert original in directive and problem in directive


@pytest.mark.parametrize('text', ['ம் கேக்குதா?', 'Hello நான் பேசுறது கேக்குதா?', 'நான் பேசுறது கேட்குதா?',
                                 'ஹலோ கேக்குதா?', 'hello can you hear me?'])
def test_natural_presence_checks_reuse_existing_control_path(text):
    assert PRESENCE.fullmatch(text)


@pytest.mark.parametrize('text', ['Hello maintenance பண்ணுவீங்களா?', 'கேக்குதா? என் website slow ஆக இருக்கு',
                                 'can you hear my appointment details?'])
def test_presence_question_with_real_content_stays_a_model_turn(text):
    assert not PRESENCE.fullmatch(text)


@pytest.mark.parametrize('detected,text', [('en-IN', "Don't call me Iya."),
                                        ('ml-IN', 'എനിക്ക് ഇന്ന് ചെയ്യാൻ പറ്റില്ല.')])
def test_established_tamil_does_not_flip_on_one_correction_or_stt_glitch(detected, text):
    state = LanguageState('ta')
    state.strict_lock = True
    state.observe('ta-IN', 'என்னோட website ரொம்ப slow ஆக இருக்கு')
    state.observe(detected, text)
    assert state.active == 'ta'
    state.observe('en-IN', 'Please speak in English', explicit='en')
    assert state.active == 'en'


def test_changed_email_is_not_confirmed_by_its_own_correction_turn():
    state = CallState()
    state.observe_user('wrong@example.test')
    state.observe_assistant('wrong@example.test சரியா?')
    state.observe_user('இல்ல தப்பு. nila@example.test')
    state.apply_understood_details(turn_id=state.user_turn_id, evidence=state._last_observed_user,
                                   values={'email': 'nila@example.test'}, confirmed_field='email')
    assert state.entities.get('email') == 'nila@example.test'
    assert state.entities.get('email_confirmed') != 'yes'


@pytest.mark.parametrize('candidate', ['unknown', 'Nila'])
def test_model_cannot_invent_a_name_from_a_scheduling_reply(candidate):
    state = CallState()
    state.set_pending('name', 'உங்கள் பெயர் என்ன?')
    state.observe_user('எனக்கு நாளைக்கு மதியம் நேரம் இருந்தா நல்லா இருக்கும்.')
    result = state.apply_understood_details(turn_id=state.user_turn_id, evidence=state._last_observed_user,
                                           values={'name': candidate})
    assert 'Rejected' in result and 'name' not in state.entities


@pytest.mark.asyncio
async def test_noon_tool_format_is_normalized_without_changing_other_fields():
    from types import SimpleNamespace
    from tools import AppointmentTools
    state = CallState(entities={'date': '2026-11-06', 'time': '16:00', 'name': 'Nila'})
    state.observe_user('தேதி அதே தான். மதியம் பன்னிரெண்டு மணிக்கு மாத்துங்க.')
    owner = AppointmentTools(SimpleNamespace(), call_state=state)
    await owner.update_call_details(turn_id=state.user_turn_id, field='time', value='12:00 PM')
    assert state.entities == {'date': '2026-11-06', 'time': '12:00', 'name': 'Nila'}


@pytest.mark.asyncio
async def test_inner_provider_error_cannot_close_session_while_router_owns_recovery():
    import time
    from types import SimpleNamespace
    from livekit.agents import llm, AgentSession, APIConnectionError
    from agent import BoundedAgent
    owner = BoundedAgent(instructions='Synthetic', call_state=CallState())
    owner._reply_phase = 'model'
    session = AgentSession()
    session.on('error', owner._handle_routed_model_error)
    for i in range(5):
        error = llm.LLMError(timestamp=time.time(), label='synthetic',
                             error=APIConnectionError('synthetic timeout'), recoverable=False)
        session.emit('error', SimpleNamespace(error=error))
        session._on_error(error)
        assert error.recoverable and session._closing_task is None
    await session.aclose()


@pytest.mark.asyncio
async def test_tuned_tts_options_are_accepted_by_the_installed_sarvam_sdk():
    from livekit.plugins import sarvam
    import config
    tts = sarvam.TTS(api_key='synthetic-not-used', model=config.SARVAM_MODEL,
        min_buffer_size=config.SARVAM_MIN_BUFFER_SIZE, max_chunk_length=config.SARVAM_MAX_CHUNK_LENGTH)
    await tts.aclose()


@pytest.mark.asyncio
async def test_read_only_information_question_does_not_pay_a_noop_state_tool_round(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from livekit.agents import llm
    from livekit.agents.types import NOT_GIVEN
    import agent
    state = CallState(language='ta')
    owner = agent.BoundedAgent(instructions='Synthetic', call_state=state)
    owner._test_read_only = True
    context = llm.ChatContext()
    context.add_message(role='user', content='எங்க online store speed issue-க்கும் support தருவீங்களா?')
    monkeypatch.setattr(owner, '_knowledge_context', AsyncMock(return_value='Maintenance is supported.'))
    monkeypatch.setattr(owner, '_get_activity_or_raise', lambda: SimpleNamespace(llm=object()))
    choices = []
    async def stream(model, ctx, tools, choice, conn, result):
        choices.append(choice)
        result.update(status='ok')
        yield llm.ChatChunk(id='synthetic', delta=llm.ChoiceDelta(role='assistant', content='ஆமா, support தருவோம்.'))
    monkeypatch.setattr(agent, '_stream_gated', stream)
    output = [c async for c in owner.llm_node(context, [], SimpleNamespace(tool_choice=NOT_GIVEN))]
    assert output and choices == ['none']


@pytest.mark.parametrize('text', ['இல்ல தப்பு. N I L A. four three@example.test',
                                 'இல்ல தப்பு. API YSRI. four three@example.test'])
def test_split_spelling_is_not_reduced_to_domain_adjacent_fragment(text):
    state = CallState()
    state.observe_user('wrong@example.test')
    state.observe_assistant('wrong@example.test சரியா?')
    state.observe_user(text)
    assert state.entities.get('email') != 'three@example.test'
    assert state.entities.get('email_confirmed') != 'yes'


@pytest.mark.asyncio
@pytest.mark.parametrize('chunks', [
    ['ஐ', 'யா, உங்கள் appointment உறுதி ', 'செய்யப்பட்டுவிட்டது. Email sent.'],
    ['ஐயா, உங்கள் appointment உறுதி செய்யப்பட்டுவிட்டது. Email sent.'],
    ['Your appointment is confirmed, not cancelled. Email sent.'],
])
async def test_unverified_claims_cannot_reach_tts_even_when_split(chunks):
    from conversation_style import guard_verified_actions
    from agent import sanitize_spoken_text
    async def source():
        for c in chunks:
            yield c
    output = ''.join([c async for c in guard_verified_actions(source(), CallState(), read_only=True)])
    output = sanitize_spoken_text(output)
    assert 'ஐயா' not in output
    assert 'உறுதி செய்யப்பட்டுவிட்டது' not in output and 'Email sent' not in output
    assert 'Booking இன்னும் உறுதி செய்யலை' in output


@pytest.mark.asyncio
async def test_ordinary_answer_streams_before_its_source_finishes():
    import asyncio
    from conversation_style import guard_verified_actions
    release = asyncio.Event()
    async def source():
        yield 'ஆமா, website maintenance '
        await release.wait()
        yield 'செய்வோம்.'
    stream = guard_verified_actions(source(), CallState())
    assert await asyncio.wait_for(anext(stream), .1) == 'ஆமா, website maintenance '
    release.set()
    await stream.aclose()


@pytest.mark.asyncio
async def test_null_state_tool_argument_cannot_execute_a_business_action():
    from tools import AppointmentTools
    from types import SimpleNamespace
    from livekit.agents.llm.utils import validated_arguments
    state = CallState()
    state.observe_user('சரி okay.')
    owner = AppointmentTools(SimpleNamespace(), call_state=state)
    args = validated_arguments(owner.update_call_details,
        {'turn_id': str(state.user_turn_id), 'field': 'none', 'value': 'null', 'confirmed': 'null'})
    await owner.update_call_details(**args)
    assert not state.entities and not state.tool_state


@pytest.mark.asyncio
async def test_booking_hold_blocks_actual_write_boundary(monkeypatch):
    from unittest.mock import AsyncMock
    from types import SimpleNamespace
    import tools
    state = CallState()
    state.observe_user('இப்ப book பண்ணாதீங்க. முதல்ல details மட்டும் பேசலாம்.')
    owner = tools.AppointmentTools(SimpleNamespace(), call_state=state)
    submit = AsyncMock()
    monkeypatch.setattr(tools.db, 'create_booking', submit, raising=False)
    answer = await owner._book_appointment('Nila', '2026-11-06', '12:00', 'maintenance')
    assert 'No booking submitted' in answer
    submit.assert_not_awaited()
    state.observe_user('இப்போது book பண்ணுங்க.')
    state.apply_understood_details(turn_id=state.user_turn_id, evidence=state._last_observed_user,
                                   values={'booking_permission': 'allowed'})
    assert not state.booking_hold
