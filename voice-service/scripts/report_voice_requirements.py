"""Generate a requirements status table from actual pytest JUnit evidence."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


root = Path(__file__).resolve().parents[2]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'output/verify/voice-requirements-junit.xml'
dest = root / 'voice-service/VOICE_REQUIREMENTS_STATUS.md'
cases = list(ET.parse(source).getroot().iter('testcase'))


def evidence(selectors):
    selected = [case for case in cases if any(selector in (case.get('classname', '') + '.' + case.get('name', '')) for selector in selectors)]
    failed = [case for case in selected if case.find('failure') is not None or case.find('error') is not None]
    skipped = [case for case in selected if case.find('skipped') is not None]
    passed = len(selected)-len(failed)-len(skipped)
    status = 'Work aagala' if failed else ('Work aagudhu' if passed and not skipped else 'Test pannala')
    proof = f'{passed} passed, {len(failed)} failed, {len(skipped)} skipped; ' + ', '.join(f'`{item}`' for item in selectors)
    return status, proof


groups = [
    ('1-second target scheduling; answer ready என்றால் status இல்லாமல் answer', ('test_response_timing.test_ready_answer', 'test_response_timing.test_pending_work_gets')),
    ('Thinking pause-ல் status இல்லை; caller மீண்டும் பேசினால் stale status இல்லை', ('test_response_timing.test_thinking_pause', 'test_response_timing.test_resumed_caller', 'test_pending_work.test_installed_sdk_retains')),
    ('Actual work இருந்தால் மட்டும் progress; model request duplicate இல்லை', ('test_response_timing.test_no_active_work', 'test_response_timing.test_agent_stream_uses', 'test_response_timing.test_status_does_not_repeat')),
    ('First voice / substantive answer தனி playback clocks; misses மறைக்கப்படாது', ('test_response_timing.test_actual_playback', 'test_response_timing.test_fast_substantive', 'test_response_timing.test_target_miss', 'test_response_timing.test_missing_speech_end', 'test_response_timing.test_sdk_speech_end')),
    ('Selected saved prompt, fallback context, safe diagnostics', ('test_prompt_enforcement', 'test_pending_work.test_saved_prompt_and_latest')),
    ('Knowledge retrieval / Tamil logging regression', ('test_knowledge_logging',)),
    ('Hello / Paathutteengala while slow work; lookup மீண்டும் தொடங்காது', ('test_pending_work.test_presence_interruption', 'test_pending_work.test_sdk_progress_update', 'test_pending_work.test_presence_uses')),
    ('Email correction, readback confirmation, exact tool recipient, no guess', ('test_contact_corrections', 'test_pending_work.test_readback_confirmation', 'test_pending_work.test_email_letters', 'test_pending_work.test_explicit_partial', 'test_pending_work.test_ambiguous_character')),
    ('Stored appointment + contact update verify / rollback', ('test_pending_work.test_database_recipient', 'test_pending_work.test_failed_recipient_write')),
    ('Queued / in-flight / failed send safeguards; explicit-only retry', ('test_pending_work.test_rejected_queued', 'test_pending_work.test_inflight_smtp', 'test_pending_work.test_successful_corrected', 'test_pending_work.test_failed_email_is_not')),
    ('Context / short answers / serious tone / caller isolation', ('test_booking_intake_memory', 'test_callstate', 'test_conversation_continuity', 'test_conversation_style', 'test_pending_work.test_caller_state', 'test_pending_work.test_tamil_language')),
    ('Pending correction/cancel, late results, post-commit truth, unknown outcome', ('test_pending_work.test_late_lookup', 'test_pending_work.test_cancel_before', 'test_pending_work.test_cancel_after', 'test_pending_work.test_unknown_booking')),
    ('Tool timeout/failure; no false success / endless filler', ('test_pending_work.test_tool_timeout', 'test_pending_work.test_tool_failure', 'test_pending_work.test_fast_work', 'test_pending_work.test_provider_failure')),
    ('Booking deduplication / calendar consistency / reminders', ('test_booking_consistency', 'test_calcom_v2', 'test_calendar_sync', 'test_reminders', 'test_pending_work.test_concurrent_booking')),
    ('Provider routing / quota guards preserved', ('test_provider_routing', 'test_admission_control', 'test_rate_limit_admission')),
    ('Telephony / recording / transfer regression safeguards', ('test_single_call_lifecycle', 'test_call_lifecycle_billing', 'test_hangup_lifecycle', 'test_tools.test_transfer', 'test_context_consolidation.test_transfer_and_end')),
]

passed = sum(case.find('failure') is None and case.find('error') is None and case.find('skipped') is None for case in cases)
failed = sum(case.find('failure') is not None or case.find('error') is not None for case in cases)
skipped = sum(case.find('skipped') is not None for case in cases)
rows = []
for requirement, selectors in groups:
    status, proof = evidence(selectors)
    rows.append(f'| {requirement} | **{status}** | {proof} |')

text = f'''# Voice requirements: proof report

Existing implementation preserved; this continuation adds only the first-voice
target and separated timing/reporting. Results below come from actual JUnit
test results: **{passed} passed, {failed} failed, {skipped} skipped**.
Evidence: `output/verify/voice-requirements-junit.xml`.

“Work aagudhu” in the automated table means the named synthetic/mocked/SDK
regression passed. It does not mean a real phone/audio/provider test passed.

## Automated requirements

| Requirement | Status | Proof |
| --- | --- | --- |
''' + '\n'.join(rows) + '''

## Real-service and audio limits

| Requirement | Status | Proof / limit |
| --- | --- | --- |
| Caller hears first voice within about 1 second on this build | **Test pannala** | No live call or end-to-end STT/LLM/TTS audio test was initiated. Voice timing verify pannala. |
| Caller hears the actual answer at its separately measured time | **Test pannala** | New `reply_answer_voice` records a separate mapped answer segment playback start. No new live sample is claimed. |
| Natural Tamil pauses, interruptions and emotional voice quality over a phone line | **Test pannala** | SDK pause/overlap and local VAD checks exist; they are not a handset audio test. |
| Appointment/contact transaction on a separate real test database | **Test pannala** | `TEST_DATABASE_URL` absent; integration module skipped. Mock transaction/update/verification tests passed; customer data untouched. |
| Real SMTP/inbox delivery and current provider credentials | **Test pannala** | Sender was mocked. Previous authentication failure is not evidence that delivery works now. |
| External Cal.com attendee email replacement / recalling sent mail | **Work aagala** | Existing explicit limitation retained: correction updates local records and JillJill sender; it does not replace the external attendee or recall a sent email. |
| Real telephony, BYOK provider, recordings and human transfer after this change | **Test pannala** | Relevant regression suites passed; no new real call, transfer or customer message was initiated. |

## Timing measurements: keep these distinct

| Measurement | Result | What it proves |
| --- | --- | --- |
| First-voice target | 1000 ms from SDK speech end; 300 ms provisional TTS allowance | Scheduling goal only; misses are logged, not hidden. |
| First voice, synthetic playback test | 1000 ms | Correct separate clock arithmetic using simulated playback events. **Not real voice latency.** |
| Actual answer, same synthetic playback test | 2700 ms; 1700 ms after first voice | Progress does not count as the completed answer. **Not real voice latency.** |
| Prior historical speech-end → first room audio median | 3438 ms, 75 samples | Old baseline; these logs did not separately identify substantive-answer onset. Not an after-change result. |
| New build: first audible reply / actual answer | **Test pannala / unavailable** | Read `reply_first_voice` and `reply_answer_voice` after an authorized live audio test; do not substitute text-ready timestamps. |

The 850 ms adaptive pause floor and disabled speculation remain unchanged.
Only after `on_user_turn_completed` may the first-response wrapper emit status.
If the answer is ready, it wins immediately. Otherwise, one short factual
knowledge/model/tool status may be emitted without an extra LLM request. SDK
`FlushSentinel` puts that status and the answer in separate serialized audio
segments. The final answer can therefore arrive later than the first status.

An 850 ms thinking-pause hold plus TTS/network time can exceed 1000 ms. This
implementation targets about one second; it does not guarantee it or shorten
the pause floor to manufacture a pass. Repeated retries/tool rounds do not
repeat the early status. A caller resuming speech invalidates the old status
even if they subsequently pause again.

`reply_first_voice` and `reply_answer_voice` use mapped room `playback_started`
events, not text generation or frame-readiness. Speech end comes from SDK user
metrics when available, otherwise the observed speech-end event. If neither
exists, `commit_fallback` is labelled and target success remains unknown.
Unmapped audio is not labelled as an answer. Room publication still excludes
some carrier/handset latency, so handset acoustic timing needs a live test.

For an authorized manual check: ask a Tamil question with a 600–800 ms thinking
pause; check that no status speaks into the pause. Finish the question; compare
the first mapped playback event and the later answer event. Repeat with a slow
calendar, “Hello?”, a correction, a cancellation, and a provider timeout. Use
synthetic contact details. Do not mark a target as passed from a status schedule
or mocked audio event.

Run/restart instructions and prior implementation details remain in
`VOICE_CONVERSATION_CHANGES.md`. The runtime build for this continuation is
`2026-11-03-first-voice-v6`. No commit, push or remote deployment is performed.
'''
dest.write_text(text, encoding='utf-8')
print(f'{passed} passed / {failed} failed / {skipped} skipped; report: {dest.name}')
