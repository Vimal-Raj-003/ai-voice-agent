# Conversation reliability changes, 3 November 2026

Latest continuation: [Tamil/Tanglish real-model evidence and remaining failures](VOICE_UNDERSTANDING_REPORT.md), build `2026-11-03-understanding-v7`. This supersedes the v6 automatic ordinary-question status behavior below: generic filler is removed. The one-second voice target is not achieved in the measured synthetic sample.

Continuation: the first-voice target and separate first/answer playback clocks
are now implemented in build `2026-11-03-first-voice-v6`. The existing changes
below are preserved. See [VOICE_REQUIREMENTS_STATUS.md](VOICE_REQUIREMENTS_STATUS.md)
for the latest **738 passed, 0 failed, 1 skipped** proof table and explicit
“Work aagudhu / Work aagala / Test pannala” results. No real voice timing was
verified in this continuation; the current audit has zero separate first-voice
and answer-voice samples. The one-second target is best effort and does not
shorten the existing adaptive pause floor.

Implemented in the existing pipeline, using its pinned LiveKit Agents 1.8.4 SDK.
No dashboard redesign, credential changes, migrations, commit, push, deployment,
real test calls or customer messages were performed for validation.

## Confirmed findings

1. A cancelled speech waiter cancelled a slow availability lookup. Repeating the
   request started another lookup. The synthetic reproduction performed **two**
   database reads before this change; it now performs **one**.
2. Rejecting an email after it was queued did not prevent its background send
   from starting. The reproduction passed the rejected address to the mocked
   sender. The new test verifies that the sender is never called in that case.
3. Existing booking deduplication stored completed results, leaving a window for
   simultaneous invocations. Task ownership now coalesces running calls too.
4. The recipient correction updated only the local appointment email, without
   verifying the contact record. The transaction now updates and verifies both,
   and refreshes an existing `Email:` entry in appointment notes.
5. The Tamil language directive prescribed sympathy catchphrases and claims of
   human feeling, conflicting with the contextual tone policy. That instruction
   was removed. Provider-failure replies also wrongly blamed unclear caller
   speech; they now describe the service failure.
6. Contact-memory compression hardcoded `gemini-2.0-flash`; prior runtime logs
   showed that auxiliary request failing with 404. It now uses
   `MEMORY_SUMMARY_MODEL`, or the configured Gemini text model. This is separate
   from the selected OpenRouter conversational model.
7. The correction detector also matched the confirmation word "correct".
   A red regression reproduced three confirmations clearing a valid email.
   Exact readback confirmations, including "yes, correct" and "ஆமா correct",
   are now distinct from instructions to correct a field.

The audit did **not** show the current inbound assistant losing its saved prompt.
Both active number routes resolve to assistant `cmuv65lxx0013v7f4thzf2qtv`, prompt
hash `7caf4b8414320db3`, 2,405 characters, saved prompt first. The selected stack
is OpenRouter Llama 3.3 70B, Sarvam STT, and Sarvam TTS. No prompt text, caller
recording, personal data or credentials are included in the audit output.

## Configuration and request trace

`dashboard/app/(admin)/assistants/actions.ts` saves the assistant's `systemPrompt`
and provider choices. Inbound `phone_numbers.assistantId` selects the assistant;
dispatch metadata supplies the selection for other call types. `agent.py`
loads it through `_resolve_profile` / `db.get_assistant_as_profile`, assembles
the saved prompt with `prompts.build_prompt`, and constructs `BoundedAgent`.

`_apply_language_directive` restores that agent's instructions if a recovered
context lacks them, then adds current call state, task status, language and tone.
Primary, retry and fallback attempts use this same context. A synthetic test
forces the primary to fail and inspects the actual fallback request, including
the saved prompt and corrected email. `llm_prompt_version` records assistant ID,
instruction hash, request-system hash and whether instructions are present;
it does not log prompt contents. Existing routing-fallback diagnostics remain.

Prompt/settings edits apply when a **new call** loads its profile. An active
call retains its loaded instructions and provider objects. Worker source edits
require a local worker restart; `agent.py start` does not hot reload.

## Architecture and behavior

- `call_tasks.py` owns work per call, independently of interruptible speech.
  It coalesces matching work, keeps inputs/status/results, bounds lookup waits,
  and rejects stale results using the caller-input revision. There is no global
  cross-caller task registry. SDK duplicate rejection provides an additional
  guard at tool dispatch.
- Slow tools use SDK `RunContext.update()` once after 1.2 seconds to release
  conversational control. Deferred final replies use the SDK's queue rather
  than creating an independent speaking loop. Fast tools produce no filler.
- During pending work, a presence/status check gets a brief, interruptible
  factual acknowledgement without another LLM request or restarted lookup.
  Completed results remain in the model context for natural rendering.
- Corrections/cancellation stop reads and preparation. Before a write is
  submitted, its revision is checked again. Submitted actions settle and report
  their actual outcome; cancelling speech does not claim to undo a booking.
  An ambiguous submitted booking blocks further creates for that call, even
  after the short lookup-cache interval expires.
- Email corrections invalidate old candidates. Explicit part replacements retain
  clear components; ambiguous character substitutions are not guessed. Spelled
  local-part letters and the domain may arrive in separate turns. The address
  must be read back and confirmed before a booking/send uses it.
- Recipient persistence is caller/booking scoped and verified inside one database
  transaction. Failed verification rolls back. No email is queued on failure.
  Queued jobs recheck the recipient immediately before sending and snapshot
  their booking details. Repeated queued/in-flight/sent jobs are suppressed;
  failed sends require an explicit caller retry. An in-flight or already sent
  email cannot be recalled, and its outcome cannot mark a newer address sent.
- `turn_policy.py` uses SDK dynamic endpointing, initially holding an **850 ms**
  pause floor, respecting a larger saved `minPauseMs`/configured floor and
  adapting to the caller's observed pauses. Speculative generation is off by
  default. This intentionally adds some end-of-turn hold time to protect normal
  thinking pauses. VAD interruption duration and false-interruption resumption
  remain enabled. Gemini realtime retains its existing native turn controls.
- Tamil remains established through short English acknowledgements. Serious
  context persists outside trimmed history. Hospital guidance is calm and
  practical, disallows invented clinical advice, and follows the assistant's
  approved escalation/transfer rules; it does not invent a transfer destination.

## Measurements and validation

Final full suite: **724 passed, 1 skipped** (68.32 seconds). The skipped
integration module requires a separate `TEST_DATABASE_URL`; it was not pointed
at the customer database. Atomic-write behavior was tested with mocked database
connections, including verification failure/rollback. Selected-assistant SDK
session construction/closure also passed without starting audio or a call.

Local worker restart verified build `2026-11-03-pending-work-v5`, successful
LiveKit registration, and HTTP 200 for dashboard `/login`, backend `/health`,
and worker `/worker`. The old local worker was replaced. Startup embedding
warmup took about 5.9–6.2 seconds per child and emitted transient watchdog
warnings, including one 2.17-second event-loop block. Cold-start audio latency
is therefore still a limitation to validate; no claim is made that those
startup stalls or all provider latency have been eliminated.

Read-only historical aggregate, preceding these changes; samples overlap and
must not be added together as if they described the same turn:

| Stage | Samples | Median |
| --- | ---: | ---: |
| Provider-reported LLM first token | 95 | 1,252 ms |
| LLM request duration | 95 | 2,424 ms |
| TTS first audio | 80 | 274 ms |
| Speech end to STT final | 54 | 342 ms |
| STT final to LLM start | 66 | 735.5 ms |
| Released LLM first token to room first audio | 74 | 951.5 ms |
| Speech end to room first audio | 75 | 3,438 ms |

After-change **offline** benchmark: 10 interrupted/rejoined lookups with a
120 ms mocked delay performed one lookup each; total median 121.05 ms and
status-text readiness median 0.012 ms. These are logical timings, **not audible
latency**, provider performance, or evidence of real-call quality. Presence
checks avoid a fresh LLM request; requested speech still uses TTS.

The actual local VAD consumed the first 20 seconds of existing `bargein.wav`
(two start/end pairs) and `ta_conversation.wav` (one pair), without uploads.
SDK endpointing tests exercise 600/800 ms speech pauses and overlapping speech.
Full STT/LLM/TTS understanding, line noise, final transcript timing and audible
interruption quality remain unverified on a new live call.

New synthetic regression coverage is in `tests/test_pending_work.py`: slow
status checks, corrections and late results, cancellation before/after commit,
concurrent booking, tool timeout/failure, unknown booking outcome, email
readback/confirmation/arguments, atomic record verification, queued/in-flight/
failed delivery, caller isolation, persistent serious tone, actual fallback
context, and SDK pause policy. Existing booking/telephony/transfer suites remain.

Diagnostics retain the existing STT/LLM/TTS/audio latency stages and add task
duration/status/revision events. `task_ack_first_audio` correlates a known
acknowledgement speech ID to actual room playback, separately from general turn
first-audio timing. A scheduled acknowledgement is not recorded as audible.
No new real-call before/after audible-latency comparison is claimed.

## Remaining limits

- Recipient correction verifies the **local appointment and contact**, and the
  JillJill confirmation recipient. It does not replace Cal.com's external
  attendee or recall notifications already initiated by Cal.com. Tool results
  explicitly disclose that limit; no cancel/rebook workaround is attempted.
- The task ledger protects retries within a running call. It is not a durable
  distributed transaction across process crashes; existing booking reconciliation
  and database constraints remain the protections outside that lifetime.
- SMTP acceptance is not proof of inbox delivery. No real send was made to
  validate credentials. The previously observed SMTP authentication failure
  cannot be corrected by conversation state changes.
- No new live model, phone call or external audio transcription was performed.
  Text, mocked service, SDK policy, and local VAD tests do not establish complete
  real-call quality or equivalence to another conversational product.

## Exact local commands

Use the pinned WSL environment; the older Windows virtualenv is not the runtime
validated here. Run each service in its own terminal. Do not start a second
copy if these services are already running.

```powershell
cd 'C:\Users\CT\Voice Agent\ai-voice-agent\dashboard'
npm.cmd run dev -- --hostname 127.0.0.1 --port 3000
```

```powershell
wsl.exe -d Ubuntu --cd 'C:\Users\CT\Voice Agent\ai-voice-agent\voice-service' -- /home/jilljill2023/venvs/jilljill-voice/bin/python -X utf8 -m uvicorn server:app --host 0.0.0.0 --port 8000
```

```powershell
wsl.exe -d Ubuntu --cd 'C:\Users\CT\Voice Agent\ai-voice-agent\voice-service' -- /home/jilljill2023/venvs/jilljill-voice/bin/python -X utf8 agent.py start
```

For a worker restart, first inspect `http://127.0.0.1:8081/worker` for active
jobs and verify the exact process with:

```powershell
wsl.exe -d Ubuntu -- bash -c "ps -eo pid,args | grep 'agent.py start'"
```

Wait for active calls to finish, then send TERM to that verified PID (replace
`<pid>`), and rerun the worker command above:

```powershell
wsl.exe -d Ubuntu -- bash -c 'kill -TERM <pid>'
```

Verify `VOICE_WORKER_BUILD=2026-11-03-first-voice-v6`, cloud registration,
dashboard `/login` on 3000, API `/health` on 8000, and worker `/worker` on 8081.
Systemd-managed installations should use their existing service manager instead
of creating a manual duplicate. No remote deployment is required for local use.

Run checks from `voice-service` in the WSL environment:

```bash
python -X utf8 -m pytest -q -p no:cacheprovider --disable-warnings
python -X utf8 scripts/audit_voice_runtime.py
python -X utf8 scripts/benchmark_pending_work.py
```

Optional overrides, set before starting the worker: `VOICE_PAUSE_FLOOR_MS=850`,
`VOICE_PREEMPTIVE_GENERATION=false`, `MEMORY_SUMMARY_MODEL=<valid Gemini text model>`.
Do not enable speculation or lower the pause floor without audio/quota checks.

## Manual live-audio script, NOT YET VERIFIED

1. Request an appointment in Tamil/Tanglish, pausing 600–800 ms mid-sentence.
   Confirm the agent waits and retains service/name/date/time without repetition.
2. During an intentionally slow test calendar lookup, say “Hello?” and
   “Paathutteengala?” Confirm a contextual acknowledgement, one lookup, and a
   later substantive result. Compare task/ack/turn audio timing events.
3. Give a synthetic email, reject one character, spell only that part, then
   confirm the readback. In an isolated test booking, inspect appointment/contact
   email and captured notification arguments; never test with customer addresses.
4. Correct or cancel before submission, and separately after submission in an
   isolated test service. Confirm stale results cannot replace newer details,
   and an already committed action is not reported as undone.
5. Simulate calendar timeout and SMTP failure with test services. Confirm one
   failure report, no success claim, no endless filler or automatic duplicate send.
6. Use a synthetic urgent hospital concern. Confirm calm language, established
   Tamil, and only the approved escalation/transfer path. Repeat with a second
   caller and verify no details or task results carry across calls.

## 2026-11-03 — controlled inbound repair (`silence-v10`)

The recorded v9 greeting/silence failure is documented with its call ID and
stage timings in [VOICE_UNDERSTANDING_REPORT.md](VOICE_UNDERSTANDING_REPORT.md).
The repaired worker is now running in temporary conversation-only mode.

* Neutral Hello variants cannot establish Hindi/Tamil/another language by
  themselves; the exact `हलो।` failure is covered by a regression.
* Pure presence checks use the existing committed control path, without an
  LLM/tool round. Compound business questions still use the configured model.
* Recording announcements cannot mutate confirmed state. An interrupted
  configured greeting can resume only its known unspoken tail, once.
* Tool continuations keep their caller turn. Useful model output has a 4.5 s
  per-attempt deadline; post-output idle waits are bounded at 4 s. Existing
  fallback and committed-operation ownership are retained.
* `VOICE_TEST_READ_ONLY=true` exposes local state updates/end-call only and
  suppresses custom HTTP tools and worker post-call business callbacks.
  New call logs and recordings remain enabled. Credentials/.env were not edited.

Final regressions: **792 passed, 1 skipped**. Real Sarvam generated the direct
Tamil presence answer in **496.9 ms from text submission**, excluding STT,
endpointing, SIP and handset timing. The bounded real-model checks still found
irrelevant intake/availability behavior on general questions. Those are
remaining failures; neither a universal understanding repair nor one-second
handset answers are claimed.

Current worker: PID 3881, build `2026-11-03-silence-v10`, LiveKit registration
`AW_efGEStVM7q6r` in India South. Worker-only restart; dashboard/API stayed up.
Use **+91 80654 81576** for the user's controlled test. Both existing numbers
share this worker and its test restriction. No real booking/email/SMS should
be expected from that test. Ask “கேக்குதா?”, then a normal maintenance question,
and interrupt once. Correlate the resulting call and turn IDs before reporting
the actual outcome. Full artifacts and limitations are in the linked report.
