"""Bounded real-LLM differential replay. Synthetic callers, no external writes.

Uses the selected inbound profile and real llm_node, prompt assembly, history
hook and AppointmentTools. Only knowledge fixtures and external action I/O are
mocked. Text timings are NOT voice timings. Artifacts contain synthetic text.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv
load_dotenv(ROOT / '.env')

CASES = [
    dict(id='email_confirmation', pending='email_confirmation',
         question='nila@example.test தான் சரியான email தானே?',
         text='ஆமாங்க, நீங்க இப்ப சொன்ன mail ID தான் சரி. அதுக்கே confirmation அனுப்புங்க.',
         booking=True, expected='Confirm existing address; update existing booking, never rebook.'),
    dict(id='explicit_name_repair', pending='time', question='எந்த நேரம் வேண்டும்?',
         text='என் பெயர் spelling தப்பு. என் பெயர் Nila.',
         expected='Keep Nila, date, service and email; no request to spell the entire name again.'),
    dict(id='presence_with_question', pending='email', question='உங்க email சொல்லுங்க?',
         text='ஹலோ, e-commerce website-க்கு maintenance கிடைக்குமா?',
         expected='Answer the maintenance question using knowledge, rather than merely confirming presence.'),
    dict(id='domain_only_not_cancel', pending='email_confirmation',
         question='nila@old.example தான் சரியான email தானே?', email='nila@old.example',
         text='Booking-ஐ cancel பண்ணாதீங்க. mail domain மட்டும் தவறு; domain is example.test',
         expected='Keep local part nila, replace domain, ask one confirmation; do not cancel/send/rebook.'),
    dict(id='noon_correction', pending='confirm', question='November 6, காலை 11:00 AM சரிதானே?',
         text="தேதி அதே November six தான். நேரம் மட்டும் noon twelve-க்கு மாற்றுங்க, midnight வேண்டாம்.",
         expected='Keep date/name/service/email; use 12:00 noon, no midnight, no repeated intake.'),
]
HOLDOUTS = [
    dict(id='heldout_noon', pending='confirm', question='November 6, 11:00 AM சரிதானே?',
         text='அதே நாள்தான். காலை பதினொண்ணு வேண்டாம், மதியம் பன்னிரண்டு மணி வச்சுக்கலாம். Name, mail எல்லாம் அதேதான்.',
         expected='Change only requested time to 12:00 noon. Preserve date/name/service/email; no new booking.'),
    dict(id='heldout_confirmation', pending='email_confirmation', booking=True,
         question='nila@example.test தானே?',
         text='Mail சரியா இருக்கு; நீங்க சொன்ன அந்த address-க்கே அனுப்பிடுங்க.',
         expected='Understand this unseen confirmation; verify recipient update and say queued, not sent.'),
    dict(id='heldout_name_letter', pending='name_confirmation', question='Mila தானே உங்க பேர்?',
         name='Mila', text='முதல் எழுத்து N தான், M இல்லை. Nila-ன்னு எழுதுங்க.',
         expected='Correct only the name to Nila; preserve email/date/service; ask one name read-back if needed.'),
]
KNOWLEDGE = '[VERIFIED SYNTHETIC KNOWLEDGE]\nThe demo software company builds e-commerce websites and provides ongoing maintenance. Maintenance price depends on scope; no price is specified. It does not provide medical appointments.'


async def profile():
    import db
    pool = await db.get_pool()
    row = await pool.fetchrow('SELECT "assistantId" FROM phone_numbers WHERE "isActive" = true AND "assistantId" IS NOT NULL ORDER BY id LIMIT 1')
    result = await db.get_assistant_as_profile(row['assistantId'])
    await db.close_pool()
    return result


async def collect(source):
    started = time.monotonic()
    result = dict(reply='', tool_calls=[], first_model_event_ms=None, first_released_text_ms=None, usage=[])
    async for chunk in source:
        if isinstance(chunk, str):
            content = chunk
        else:
            delta = getattr(chunk, 'delta', None)
            content = getattr(delta, 'content', '') or ''
            for call in getattr(delta, 'tool_calls', None) or []:
                result['tool_calls'].append(dict(name=call.name, arguments=call.arguments, call_id=call.call_id))
            if (content or result['tool_calls']) and result['first_model_event_ms'] is None:
                result['first_model_event_ms'] = round(1000 * (time.monotonic()-started), 1)
            usage = getattr(chunk, 'usage', None)
            if usage:
                result['usage'].append(usage.model_dump() if hasattr(usage, 'model_dump') else str(usage))
        if content:
            if result['first_released_text_ms'] is None:
                result['first_released_text_ms'] = round(1000 * (time.monotonic()-started), 1)
            result['reply'] += content
    result['total_ms'] = round(1000 * (time.monotonic()-started), 1)
    return result


async def run_case(case, prof, mode, model_override=None, *, tts=None, output_sink=None,
                   budget_file=None, request_limit=60, stt=None, vad=None, audio_input=None,
                   test_read_only=False):
    import agent
    import llm_routing
    from callstate import CallState
    from lang import LanguageState
    from tools import AppointmentTools
    from prompts import build_prompt
    from livekit.agents import llm
    from livekit.agents.types import APIConnectOptions, NOT_GIVEN
    route = llm_routing.resolve_route(prof)
    if model_override:
        route.primary_model = model_override
    model = llm_routing.build_llm(route.primary_provider, route.primary_model, profile=prof)
    original_chat = model.chat
    budget_path = Path(budget_file) if budget_file else ROOT / 'output' / 'verify' / 'understanding-request-budget.json'
    budget_path.parent.mkdir(parents=True, exist_ok=True)
    def budgeted_chat(**kwargs):
        if budget_path.exists():
            budget = json.loads(budget_path.read_text())
        else:
            previous = 0
            for artifact in ([] if budget_file else budget_path.parent.glob('understanding-*.json')):
                try:
                    data = json.loads(artifact.read_text(encoding='utf-8'))
                    previous += sum(len(r.get('rounds', [])) for r in data.get('results', []))
                    previous += len(data.get('agent', {}).get('rounds', []))
                except (ValueError, TypeError):
                    pass
            budget = dict(limit=request_limit, requests=previous, note='Bounded replay; SDK chat attempts counted before sending. Prior repair budgets are preserved.')
        if budget['requests'] >= budget['limit']:
            raise RuntimeError('Bounded replay request limit reached; no additional model call sent')
        budget['requests'] += 1
        budget_path.write_text(json.dumps(budget, indent=2), encoding='utf-8')
        return original_chat(**kwargs)
    model.chat = budgeted_chat
    state = CallState(role=case.get('role', 'appointment'), language='ta', intent=case.get('intent', 'appointment_booking'),
                      direction=prof.get('prompt_direction'))
    state.entities.update(name=case.get('name', 'Nila'), service='e-commerce', date='2026-11-06', time='11:00',
                          email=case.get('email', 'nila@example.test'), email_confirmed='no')
    if 'seed_entities' in case:
        state.entities = dict(case['seed_entities'])
    if case['id'] == 'presence_with_question':
        state.entities.pop('email')
    state.set_pending(case['pending'], case['question'])
    before = state.snapshot()
    ctx = SimpleNamespace(room=SimpleNamespace(name='synthetic-replay', metadata=''), api=None)
    tools_owner = AppointmentTools(ctx, phone_number='synthetic-replay', call_state=state)
    tools = [tools_owner.remember_details, tools_owner.check_availability, tools_owner.book_appointment,
             tools_owner.update_call_details]
    if test_read_only:
        tools_owner._test_read_only = True
        tools = tools_owner.build_tool_list(['check_availability', 'update_call_details'])
    if case.get('booking'):
        tools_owner._last_booking_id = 'SYNTHETIC-BOOKING'
        tools_owner._last_booking_email = state.entities['email']
        state.set_tool_fact('booking', state='confirmed:SYNTHETIC-BOOKING')
    instructions = build_prompt(custom_prompt=prof.get('system_prompt'), business_name='Synthetic software company',
                                call_direction=prof.get('prompt_direction'),
                                hallucination_guard=prof.get('hallucination_guard', True))
    history = llm.ChatContext()
    history.add_message(role='system', content=instructions)
    if case.get('history'):
        for role, text in case['history']:
            history.add_message(role=role, content=text)
            if role == 'user':
                state.observe_user(text)
            elif role == 'assistant':
                state.observe_assistant(text)
        state.set_pending(case['pending'], case['question'])
        before = state.snapshot()
    else:
        history.add_message(role='user', content='e-commerce consultation வேணும். என் பெயர் '+state.entities.get('name', '')+'. November 6, 11 AM. email '+state.entities.get('email', 'தருகிறேன்'))
    if case.get('booking'):
        history.add_message(role='assistant', content='Booking SYNTHETIC-BOOKING உறுதி செய்யப்பட்டது. Email confirmation pending.')
    history.add_message(role='assistant', content=case['question'])
    message = history.add_message(role='user', content=case['text'])
    external = []
    async def save(*args, **kwargs):
        external.append(dict(action='mock_verified_recipient_update', args=args, kwargs=kwargs))
        return True
    async def memory(*args, **kwargs):
        external.append(dict(action='mock_memory_write', args=args, kwargs=kwargs))
    def queue(email):
        external.append(dict(action='mock_queue_email', email=email))
        state.entities['email_delivery'] = 'queued'
        return True
    async def deny(*args, **kwargs):
        external.append(dict(action='mock_external_booking_blocked', args=args))
        return 'Synthetic replay: no new booking submitted or confirmed.'
    language = LanguageState(initial='ta')
    language.strict_lock = True
    language.established = True
    owner = agent.BoundedAgent(instructions=instructions, tools=tools, call_state=state,
                              lang_state=language, llm_route=route,
                              assistant_id='synthetic-replay', room_id='synthetic-replay')
    owner._test_read_only = test_read_only
    if mode != 'session':
        owner._get_activity_or_raise = lambda: SimpleNamespace(llm=model)
    # Production retrieval filtering runs; only the store/search boundary is synthetic.
    fixture_knowledge = case.get('knowledge', KNOWLEDGE)
    with patch.object(agent.knowledge, 'has_knowledge', AsyncMock(return_value=True)), \
         patch.object(agent.knowledge, 'search', AsyncMock(return_value=[dict(text=fixture_knowledge, url='https://example.test', similarity=1.0)])), \
         patch.object(agent.knowledge, 'build_context', lambda hits: fixture_knowledge), \
         patch.object(tools_owner, '_queue_confirmation_email', queue), \
         patch('tools.db.update_confirmation_email', save), \
         patch('tools.db.add_contact_memory', memory), \
         patch('tools.db.get_contact_memory', AsyncMock(return_value=[])), \
         patch('tools.calcom_enabled', return_value=False), \
         patch('tools.db.check_slot', AsyncMock(return_value=True)), \
         patch.object(tools_owner, '_book_appointment', deny), \
         patch('tools.db.get_pool', side_effect=RuntimeError('Unexpected DB access blocked in synthetic replay')):
        if mode == 'direct':
            history.add_message(role='system', content=fixture_knowledge)
            async def source():
                async with model.chat(chat_ctx=history, tools=tools, conn_options=APIConnectOptions(max_retry=0, timeout=15)) as stream:
                    async for chunk in stream:
                        yield chunk
            rounds = [await asyncio.wait_for(collect(source()), 35)]
        elif mode == 'session':
            from livekit.agents import AgentSession
            original_node = owner.llm_node
            rounds = []
            async def traced_node(chat_ctx, tools, model_settings):
                if not rounds and audio_input is None:
                    latest = next(i for i in reversed(chat_ctx.items) if getattr(i, 'role', '') == 'user')
                    from livekit.agents import StopResponse
                    try:
                        await owner.on_user_turn_completed(chat_ctx, latest)
                    except StopResponse:
                        return  # Direct committed control reply, as in live audio.
                row = dict(reply='', tool_calls=[], first_released_text_ms=None, usage=[])
                rounds.append(row)
                started = time.monotonic()
                try:
                    async for chunk in original_node(chat_ctx, tools, model_settings):
                        delta = getattr(chunk, 'delta', None)
                        content = chunk if isinstance(chunk, str) else (getattr(delta, 'content', '') or '')
                        if content:
                            if row['first_released_text_ms'] is None:
                                row['first_released_text_ms'] = round((time.monotonic()-started)*1000, 1)
                            row['reply'] += content
                        for call in getattr(delta, 'tool_calls', None) or []:
                            row['tool_calls'].append(dict(name=call.name, arguments=call.arguments, call_id=call.call_id))
                        usage = getattr(chunk, 'usage', None)
                        if usage:
                            row['usage'].append(usage.model_dump())
                        yield chunk
                finally:
                    row['total_ms'] = round((time.monotonic()-started)*1000, 1)
            owner.llm_node = traced_node
            owner._chat_ctx = history.copy()
            owner._chat_ctx.items.pop()  # SDK adds the current input with its own message id.
            owner._chat_ctx.items[:] = [i for i in owner._chat_ctx.items if getattr(i, 'role', '') != 'system']
            from turn_policy import voice_turn_options
            session = AgentSession(llm=model, tools=tools, **({'tts': tts} if tts else {}),
                                   **({'stt': stt, 'vad': vad, 'turn_handling': voice_turn_options(prof)} if audio_input else {}))
            session.on('speech_created', lambda ev: owner._track_preparation(ev.speech_handle))
            completed = asyncio.Event()
            if audio_input:
                session.input.audio = audio_input
                @session.on('user_input_transcribed')
                def transcript(ev):
                    if ev.is_final:
                        external.append(dict(action='real_stt_final', text=ev.transcript, at_mono=time.monotonic()))
                        owner._voice_stage('final_stt_transcript', turn_id=state.user_turn_id+1)
                @session.on('user_state_changed')
                def user_changed(ev):
                    if ev.new_state == 'speaking':
                        owner._discard_preparation_on_speech()
                        owner._response_timing.speech_started()
                    elif ev.old_state == 'speaking':
                        owner._response_timing.speech_stopped()
            if output_sink:
                session.output.audio = output_sink
                session._jj_tts = tts
                session._jj_tts_provider = 'sarvam'
            tools_owner._session = session
            @session.on('function_tools_executed')
            def executed(event):
                for call, output in zip(event.function_calls, event.function_call_outputs):
                    external.append(dict(action='sdk_tool_result', name=call.name, arguments=call.arguments,
                                         output=output.output, state_after=state.snapshot()))
            @session.on('conversation_item_added')
            def spoken(event):
                if getattr(event.item, 'role', '') == 'assistant':
                    external.append(dict(action='sdk_spoken_reply', text=event.item.text_content,
                                         state_after=state.snapshot()))
                    completed.set()
            try:
                await session.start(owner)
                if output_sink:
                    output_sink.agent_input_at = time.monotonic()
                if audio_input:
                    await asyncio.wait_for(completed.wait(), 50)
                else:
                    await asyncio.wait_for(session.run(user_input=case['text']), 40)
                    if not rounds and not completed.is_set():
                        # A control reply is queued by the committed hook,
                        # separately from the empty model speech handle.
                        await asyncio.wait_for(completed.wait(), 15)
            finally:
                await session.aclose()
        else:
            await owner.on_user_turn_completed(history, message)
            rounds = [await asyncio.wait_for(collect(owner.llm_node(history, tools, SimpleNamespace(tool_choice=NOT_GIVEN))), 35)]
            for _ in range(3):
                if not rounds[-1]['tool_calls']:
                    break
                for call in rounds[-1]['tool_calls'][:2]:
                    arguments = json.loads(call['arguments'])
                    target = {t.info.name: t for t in tools}[call['name']]
                    from livekit.agents.llm.utils import validated_arguments
                    output = await target(**validated_arguments(target, arguments))
                    external.append(dict(action='actual_tool_result', name=call['name'], arguments=arguments, output=output,
                                         state_after=state.snapshot()))
                    history.items.extend([llm.FunctionCall(call_id=call['call_id'], name=call['name'], arguments=call['arguments']),
                                          llm.FunctionCallOutput(call_id=call['call_id'], name=call['name'], output=str(output), is_error=False)])
                rounds.append(await asyncio.wait_for(collect(owner.llm_node(history, tools, SimpleNamespace(tool_choice=NOT_GIVEN))), 35))
    await model.aclose()
    return dict(id=case['id'], mode=mode, model=route.primary_model, text=case['text'], expected=case['expected'],
                before=before, after=state.snapshot(), rounds=rounds, external_actions=external,
                stages=getattr(owner, '_stage_events', []),
                voice_timing_measured=False)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--label', required=True)
    parser.add_argument('--case', action='append')
    parser.add_argument('--model')
    parser.add_argument('--holdouts', action='store_true')
    parser.add_argument('--mode', choices=['direct', 'agent', 'session', 'both'], default='both')
    parser.add_argument('--budget-file')
    parser.add_argument('--request-limit', type=int, default=12)
    args = parser.parse_args()
    selected = [c for c in (HOLDOUTS if args.holdouts else CASES) if not args.case or c['id'] in args.case]
    prof = await profile()
    dest = ROOT / 'output' / 'verify' / ('understanding-'+args.label+'.json')
    result = dict(label=args.label, synthetic=True, external_actions_mocked=True, results=[])
    for case in selected:
        for mode in (['direct', 'agent'] if args.mode == 'both' else [args.mode]):
            try:
                row = await run_case(case, prof, mode, args.model,
                                     budget_file=args.budget_file, request_limit=args.request_limit)
            except Exception as exc:
                row = dict(id=case['id'], mode=mode, error=type(exc).__name__+': '+str(exc)[:180])
            result['results'].append(row)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(row, ensure_ascii=False), flush=True)
    print('ARTIFACT '+str(dest), flush=True)


if __name__ == '__main__':
    asyncio.run(main())
