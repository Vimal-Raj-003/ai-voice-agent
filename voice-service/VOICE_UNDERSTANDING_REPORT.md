# Tamil/Tanglish understanding repair: evidence, 3 November 2026

Existing architecture, saved assistant prompt, selected model, credentials and prior fixes were preserved. Runtime build: `2026-11-03-understanding-v7`. OpenRouter sampling is now explicitly 0.2 rather than an endpoint default. No deployment, customer call, SMS, customer recording upload or real email/database write was made by these tests.

This is a partial verification report, not a claim that all conversations now work perfectly. The one-second audio target was missed. The configured model also failed some correct-text cases. Read the remaining failures below.

## What failed, and which stage changed

1. **Confirmation was not persisted.** The model understood natural Tamil agreement, but finite keyword rules left `email_confirmed=no`. The action tool rejected the update, prompting another confirmation or an invented success. Natural replies to an earlier contact read-back now use a small model-driven state tool, with the current caller turn bound by the runtime. No additional classifier/provider was added. A freshly confirmed current-call recipient drives the existing verified update workflow, even if the model omits the address from a free-text insight.
2. **Corrections destroyed useful information.** “spelling/correct” was treated as rejection; a supplied replacement name could be discarded, and a domain-only correction erased the known local part. Rejection is now narrower than a request to change something. Explicit replacement names and unchanged email parts survive. Unchanged name/service/date/email fields are preserved. Valid replacements also survive an inconsistent model confirmation flag; changed email still requires read-back.
3. **Rules overrode the current question.** A Tamil “ஹலோ” substring installed a presence-only instruction over a maintenance question. The booking hint commanded the next missing field on every turn. Presence checks now require a complete presence utterance. Intake is subordinate to the current question/correction. Current call state is injected once, after static workflow/language instructions.
4. **Old questions became pending again.** Tool follow-ups could re-observe an answered assistant question. Caller and assistant message identity now distinguish duplicate processing from a fresh turn. A new caller message with identical words remains a new turn.
5. **Spoken answers and state diverged.** The model could say “12 noon” but leave state at 11:00. Unparsed change requests now enter semantic state resolution before continuing. The final live run extracted `field=time,value=12:00` correctly but also set `confirmed=true`; the state tool rejected that name/email-only flag. The final fix ignores that flag for non-contact fields and retains the valid correction. This last normalization was replayed locally with the exact captured model arguments; it was **not rerun against the live model after the request cap**.
6. **Read results became fabricated writes.** The model turned `available` into “booked and email sent,” and a rejected recipient update into “sent.” Availability and recipient-update outcomes now use verified tool-result speech and SDK `ToolResult(reply_required=False)`. Local correction acknowledgements explicitly distinguish call memory from an external booking update. Other model-authored claims still require further live coverage; the tests do not establish universal honesty for every tool.
7. **Generic filler inflated apparent speed.** Automatic “preparing the answer” and ordinary knowledge-lookup announcements were removed. Only real active work can produce a short status. Model chunks still release before full completion; source closure on cancellation now releases the generator and records cancellation rather than an unanswered completed turn. First voice and answer playback clocks remain separate.
8. **Examples contaminated dates.** Runtime language/date examples contained “tomorrow” and a sample appointment time. They were replaced with instructions to preserve the actual calendar date/time. No saved assistant prompt was rewritten. Removing the examples alone did not cure model hallucinations, so tool-result verification was also necessary.

## Real-model comparison

Five synthetic cases used the real saved inbound assistant configuration: natural email agreement, an explicit name repair, presence plus a maintenance question, domain-only repair with negated cancellation, and a noon correction. External actions were mocked. Two further Tamil paraphrases tested generalization beyond the original cases.

| Input / stage | Observed before | Observed after / evidence limit |
|---|---|---|
| Correct maintenance text directly to configured model + relevant history/knowledge | Answered that maintenance was available. | Establishes that the text was understandable to this model. [Baseline artifact](output/verify/understanding-before.json). |
| Same text through actual agent | “பதிலைத் தயார் பண்றேன்…” followed by booking recap/email request; maintenance question skipped. | “ஆமா, e-commerce website maintenance கிடைக்கும். உங்க email சொல்லுங்க?” No injected filler. [SDK replay](output/verify/understanding-final-session.json), [speech replay](output/verify/understanding-speech.json). |
| Natural Tamil email confirmation | State stayed `email_confirmed=no`; actual tool refused the unconfirmed recipient. | Held-out “Mail சரியா இருக்கு; நீங்க சொன்ன அந்த address-க்கே அனுப்பிடுங்க.” produced `email_confirmed=yes`, preserved booking/name/date/time, and invoked a verified recipient update with `nila@example.test`. Mock queue became `queued`. Spoken result explicitly said delivery was unconfirmed. [Held-out evidence](output/verify/understanding-final-heldout.json). |
| Name spelling correction | Supplied `Nila` disappeared and `name_spelling` became pending. | Explicit name retained. Held-out “முதல் எழுத்து N தான், M இல்லை. Nila-ன்னு எழுதுங்க.” extracted and persisted `Mila → Nila`, preserving other fields. The model still added an unnecessary booking recap in that run; final name acknowledgement now comes from the state tool. [Real extraction/state evidence](output/verify/understanding-name-repair-final.json); final acknowledgement covered locally. |
| Domain-only correction; “do not cancel booking” | Whole address removed. | `nila@old.example → nila@example.test`; booking was not cancelled, unrelated fields retained, one address confirmation requested. [SDK evidence](output/verify/understanding-final-session.json). |
| Noon correction | Some runs chose `check_availability(date=2026-11-06,time=12:00)`; other runs merely spoke noon and left state stale. | Correct model extraction is recorded, but the final flag-normalization and direct local acknowledgement have local regression proof only. **Final live path: Test pannala.** [Last live failure](output/verify/understanding-noon-final.json), [regression seam](tests/test_understanding_replay.py). |

The initial baseline exercised the real `on_user_turn_completed`, `llm_node` and public tools with manual orchestration. Its availability helper was mocked and returned a fixed synthetic 12:00 result; that contradictory fixture output is **not evidence of calendar accuracy**. Later replays used actual room-free `AgentSession`, SDK argument validation and real availability logic with only DB/calendar I/O mocked. Knowledge search/store results were synthetic fixtures; production retrieval ranking was not benchmarked here.

Replays were capped at **60 model requests**, including tool rounds, primary replications, failed repair attempts and Qwen comparison. All completed attempt artifacts were retained. An early Qwen-labelled invocation accidentally used the primary model; it was renamed to [primary-repeat](output/verify/understanding-primary-repeat.json) and excluded from Qwen evidence. The actual Qwen artifact records its model identifier explicitly. [Request cap](output/verify/understanding-request-budget.json).

## Qwen availability, tools, latency and cost

`qwen/qwen3-30b-a3b-instruct-2507` was tested on the **same five direct-text cases**, with the same saved prompt, history, knowledge fixture and action schemas. No saved model selection was changed.

| Model | Available tool-capable endpoints observed | Published input/output USD per million tokens | Measured median request completion |
|---|---:|---|---:|
| `meta-llama/llama-3.3-70b-instruct` | 6 | Input $0.10–$0.72; output $0.32–$0.79, provider dependent | 1,501 ms over the five baseline direct cases |
| `qwen/qwen3-30b-a3b-instruct-2507` | 3 | Input $0.09–$0.10; output $0.30 | 3,669 ms over the same cases |

These completion timings include different output shapes: the primary often chose a tool, while Qwen spoke. They are **not equivalent end-to-end voice latency comparisons**. Endpoint metadata did not supply latency statistics. Prices exclude provider-specific cache effects and are not an invoice. [Availability/pricing/tool metadata](output/verify/model-availability.json).

Qwen's first case answered “அப்படியா, நல்லது! உங்க emailக்கு பாஸ்போர்ட் உள்ள போலியா இருக்கும்.” The domain correction case also gave an unrelated answer, and the name case switched to English. Although its endpoints advertise tool support, none of these five Qwen responses executed the required tool workflow. It was therefore **not selected**. [Actual same-case Qwen outputs and usage](output/verify/understanding-qwen-actual.json).

## Recorded synthetic speech and measured voice timing

One synthetic Tamil utterance, “ஹலோ, e-commerce website-க்கு maintenance கிடைக்குமா?”, was synthesized into a WAV using the configured Sarvam voice. Sarvam `saaras:v4`, `codemix`, `language=unknown` recognized:

> Hello, e-commerce website-க்கு maintenance கிடைக்குமா?

The transcript then went through the real SDK agent, real configured LLM and Sarvam streaming TTS into a local PCM capture sink. No customer recording was uploaded. **Batch WAV recognition was used, not the worker's live streaming STT/endpoint detector.**

| Measured boundary, latest synthetic sample | Time |
|---|---:|
| WAV upload start → final STT transcript | 398.9 ms |
| LLM node start → first useful model text released | 927.1 ms |
| Agent text submission → first generated reply PCM frame | **1,875.6 ms** |
| Agent text submission → first PCM frame of answer-bearing response | **1,875.6 ms**; same segment because no status/filler was emitted |
| WAV upload start → first reply/answer-response PCM | 3,930.1 ms, including fixture/SDK setup after STT |

The 927.1 ms model metric starts inside the LLM node, so it excludes some SDK preprocessing. The first-audio clock starts at `session.run` text submission and includes that preprocessing. The response text completed at 1,562.3 ms inside the node; useful text was released before the full response. Audio generation has its own remaining delay.

An earlier cold harness sample took 8,403.8 ms from WAV submission to PCM; it included agent fixture construction and provider variability. Two synthetic samples cannot establish percentiles or production latency. No handset acoustic timing, live caller pause behavior, real barge-in audio, word-level answer onset, or customer-recording transcription accuracy was verified.

Proof: [timing/transcript/agent trace](output/verify/understanding-speech.json), [synthetic caller WAV](output/verify/synthetic-tamil-caller.wav), [generated answer WAV](output/verify/synthetic-tamil-answer.wav). These prove provider audio generation, not human listening quality or PSTN delivery.

## Requirements status

“Work aagudhu” below is restricted to the stated proof scope.

Final full suite: **753 passed, 1 skipped**, zero failures/errors. [JUnit](output/verify/understanding-regression-junit.xml). The skipped test requires a real test database. Passing local tests does not establish universal model accuracy or live voice quality.

| Requirement | Status | Evidence / boundary |
|---|---|---|
| Existing fixes, state isolation, history trimming, routing/quota guards, cancellation/task settlement, calendar consistency | **Work aagudhu — local regressions** | Full suite JUnit; action I/O mocked except the separately skipped real DB integration. |
| Ordinary-question filler removal | **Work aagudhu** | Actual SDK maintenance response and synthetic speech contain no injected preparing/checking line. Slow-stream regression also covers this. |
| Contextual email confirmation and domain correction | **Work aagudhu — bounded synthetic cases** | Actual model/SDK state and tool arguments in linked traces. |
| Preserve unchanged details; semantic name correction | **Work aagudhu — bounded cases/local final speech** | Live extraction/state traces plus exact argument replays. |
| Time correction after inconsistent model confirmation flag | **Work aagudhu — local exact-argument replay; final live Test pannala** | Final model supplied 12:00; final state tool retains it and explicitly does not claim an external booking. Live cap reached before rerunning final handling. |
| Verified availability/recipient speech, failure cannot become “sent” in these tool paths | **Work aagudhu — local; recipient live SDK with mocked effects** | Real held-out recipient flow; success/failure and availability boundary tests. Final availability speech branch not exercised by a live model after its addition. |
| General model understanding and natural answers on every situation | **Work aagala — not established** | Correct-text failures, unnecessary recaps and hallucinated actions occurred during the study. Specific state/action boundaries were repaired; universal model reliability is not proved. |
| First useful voice within approximately one second | **Work aagala in measured synthetic sample** | 1,875.6 ms from text submission to generated PCM; live speech-end timing unverified. |
| Real phone speech-end → first voice and actual answer timing | **Test pannala** | No customer call; batch STT/local sink only. |
| Caller thinking pauses, actual interruptions, emotion/prosody | **Test pannala for live audio** | Local timing/state regressions pass; no live conversational audio validation. |
| Uploaded WhatsApp recordings through STT | **Test pannala** | Synthetic WAV used; private recordings were not uploaded. |
| Production knowledge ranking / production DB write verification / SMTP delivery | **Test pannala** | Search and effects mocked; no `TEST_DATABASE_URL`; no customer messages. |
| External Cal.com attendee replacement | **Work aagala / unchanged limitation** | Previous repair deliberately does not cancel/rebook to emulate an attendee edit. |

Local services were verified after reloading the final code: dashboard login on port 3000 and API health on port 8000 returned HTTP 200. One worker root, PID 5327, loaded build `2026-11-03-understanding-v7` and registered as `AW_AWVdEyc59Fz5` in India South. Worker health on port 8081 returned HTTP 200 with no active jobs. [Local readiness proof](output/verify/understanding-local-services.json). Startup embedder warmup still produced one 268 ms event-loop watchdog warning; no customer call was used to test its audio impact.

## Reproduce safely

Use the existing WSL Python environment from `voice-service`:

```text
/home/jilljill2023/venvs/jilljill-voice/bin/python -X utf8 -m pytest -q --junitxml=output/verify/understanding-regression-junit.xml
```

Real-provider scripts are [replay_understanding.py](scripts/replay_understanding.py) and [replay_synthetic_speech.py](scripts/replay_synthetic_speech.py). Their persisted model budget has been exhausted deliberately; no additional live requests are needed to inspect the captured results. External actions stay mocked. The full JUnit artifact and individual model responses, tool arguments and before/after state snapshots are under `output/verify`.

## 2026-11-03: preparation overlap repair, build `2026-11-03-preparation-v9`

This section supersedes the earlier running-configuration and readiness statements. **The repair is incomplete.** The noon state mismatch and speculative-state boundary were repaired, but the configured model still adds irrelevant intake/recaps in a real maintenance-question replay. No inbound phone test has occurred in this repair round. No commit, push, deployment, credential change, customer call or customer message was performed.

### Effective settings and exact changes

Installed `livekit-agents` is **1.8.4** in the existing WSL environment. The actual selected assistant is `cmuv65lxx0013v7f4thzf2qtv`, routed from both configured inbound numbers. Its saved prompt and model selection were preserved. It selects OpenRouter `meta-llama/llama-3.3-70b-instruct`, Sarvam `saaras:v4` STT and `bulbul:v3` TTS, voice `kavya`, pace 1.08. Recording remains enabled. Language locking and tenant credential resolution remain in the existing pipeline. Initial TTS language is en-IN; established Tamil routes to ta-IN.

The old report's `VOICE_PREEMPTIVE_GENERATION=false` is not the current setting: neither the current `.env` nor the inspected old worker's initial environment supplied that flag. The repaired default is true, and the restarted worker explicitly receives `VOICE_PREEMPTIVE_GENERATION=true` in its process environment. The saved assistant minimum pause is 350 ms, but the unchanged **850 ms floor** wins. Dynamic endpointing remains min 0.85 s, max 3 s, alpha 0.9. No faster-looking measurement was obtained by lowering the floor.

| File | Change and reason |
|---|---|
| `turn_policy.py` | Uses the existing SDK preemptive option, one speculative attempt, speculative TTS disabled. With the existing VAD present, VAD owns endpointing so Sarvam's first final transcript can start generation before commit. Sarvam emits FINAL then END; SDK STT endpointing did not permit the first-final overlap. Disabling the flag restores STT endpointing. |
| `callstate.py` | Isolated preparation copy of existing per-call state; confirmed entities and running operations cannot be mutated/cancelled by speculative prompt preparation. Removed the automatic next-missing-field directive that pushed intake after unrelated questions; retained known facts/pending state. |
| `agent.py` | Read-only language/state preparation; originating caller-turn binding for tool calls; public SDK speech handles/events for discarding parked preparation on resumed speech. SDK transcript/context comparison invalidates stale preparation. No new classifier or parallel conversation engine. |
| `agent.py`, `tools.py` | `update_call_details` binds SDK tool-call ID to its originating caller turn instead of trusting a guessed model turn number. Stale originating turns remain rejected. Previously the model spoke noon while the tool rejected its guessed turn ID and state stayed 11:00. |
| `agent.py`, `response_timing.py` | Removed automatic ordinary-turn dead-air ACK injection. Speculation cannot emit a previous committed turn's pending-work status. Existing genuinely pending operations retain their own truthful status path. |
| `agent.py` | Existing knowledge timeout now includes cache-miss `has_knowledge` lookup as well as retrieval. Current-question/short-answer guidance follows background booking state; history and verified entities are retained. |
| `prompts.py`, `tools.py` | Reduced duplicate platform guidance, removed a canned checking example, constrained remembering business facts as caller details. Platform guidance is 941 measured tokens, under the previous 975-token budget. These final prompt edits were not retested with a live model after the request cap was reached. |
| `agent.py` | Per-call/per-turn stage trace: final transcript, caller onset/end, preparation start, actual model request, first model text/released text, first TTS input/generated frame, commit and room playback. Removed misleading labels that equated agent speaking with model completion. Room progress/finish record the last reported played stretch separately from generation. |
| Tests/scripts | Added installed-SDK preparation/cancellation/state safety regressions and bounded real-provider replay/streaming/audio capture. Scheduling tests use controlled model chunks only to verify authorization/cancellation, never as understanding proof. |

Current interruption configuration is enabled, minimum duration **500 ms**, minimum words **0** with VAD, false-interruption resume enabled, timeout 2 s. Existing SDK playback clear/cancellation remains responsible for stopping speech. The preparation-discard hook uses public `session.interrupt()` for uncommitted parked speech and does not cancel independently committed business tasks. Local regressions cover this separation. Actual audible interruption latency remains unmeasured.

Runtime proof: [read-only settings and cloud route audit](output/verify/preparation-runtime.json). Audit construction is a preflight using the selected DB profile; the actual call's profile-loaded event must still confirm selection when a call arrives. Older DB build events inside the audit are historical, not proof of the current process build.

### Real-model evidence: before, after and failures

This round used **12 actual model requests total**, including retries and tool rounds, with synthetic data and mocked external effects. The earlier 60-request budget was preserved separately. [Request ledger](output/verify/overlap-request-budget.json). No additional calls were made after this round's cap.

| Case | Before | After / remaining failure |
|---|---|---|
| Maintenance question with existing appointment history | Correct first clause, then `remember_details` stored a business fact and the model resumed intake. | Still fails concise relevance: one later reply recaps November 6, 11 AM and availability after answering maintenance. No claim that keyword/prompt changes solved this model behavior. |
| “Date stays November six; change only time to noon twelve, not midnight” | Model supplied `turn_id=2` while current turn was 1. Tool rejected it; speech claimed noon while state stayed 11:00. | Actual configured model called `update_call_details` with `field=time`, `value=12:00`, `confirmed=true`; state became 12:00 and name/date/service/email were preserved. Spoken result explicitly says the booking is not yet confirmed. |
| Held-out Tamil noon paraphrase: “அதே நாள்தான். காலை பதினொண்ணு வேண்டாம், மதியம் பன்னிரண்டு மணி வச்சுக்கலாம். Name, mail எல்லாம் அதேதான்.” | Not used as a hardcoded correction rule. | Actual state became 12:00 with other fields unchanged. However, the model unnecessarily called availability; one provider attempt timed out and retried. The availability reply was based on a mocked calendar, not a verified live slot. |
| Streaming recorded synthetic speech | Real Sarvam transcript retained the substantive maintenance question. | Actual agent answered maintenance first, then wrongly asked for email. STT recognized the question; the remaining irrelevant intake occurs downstream in model/context behavior. |

Proof includes exact text, before/after snapshots, model output, tool arguments and results:
[baseline](output/verify/understanding-overlap-baseline.json),
[correction after repair](output/verify/understanding-overlap-after.json),
[remaining maintenance failure](output/verify/understanding-overlap-final-question.json),
[held-out noon](output/verify/understanding-overlap-noon-holdout.json),
[real streaming speech](output/verify/overlap-streaming.json).

The selected saved prompt contains a competing instruction to react with emotion **before anything else**, exact illness/celebration scripts, and an unconditional booking-step instruction to say email was sent. The existing runtime verified-tool policy overrides the success claim. The emotional script remains a model-reliability risk: the alternative below copied the illness script even though the caller only asked about website maintenance. The saved prompt was not silently rewritten. Removing an intake-driving runtime directive reduced conflicting content but did not establish that the current model will consistently follow the remaining priorities.

One bounded alternative probe used `google/gemini-2.5-flash-lite` on the same maintenance text/history/tools. It was available with tool-capable endpoints; published standard input/output rates were $0.10/$0.40 per million tokens (flex $0.05/$0.20; priority $0.18/$0.72). [Observed endpoint metadata](output/verify/overlap-alternative-availability.json), [provider model page](https://openrouter.ai/google/gemini-2.5-flash-lite). Its measured first released text was **1,634.5 ms**, not a demonstrated improvement over the sampled primary request. Its full reply invented illness sympathy and restarted the introduction. **Rejected; no model switch.** An earlier progress update called it concise before the full reply was reviewed; that assessment was incorrect. [Full alternative failure](output/verify/understanding-overlap-alternative.json). The previous Qwen comparison and its poor same-case outputs above still apply; Qwen was not selected either. These probes do not establish a quality-preserving faster replacement.

### Measured streaming timing

This is one paced synthetic WAV streamed through **real Sarvam STT, the actual SDK agent, the selected real LLM and real Sarvam TTS**, captured locally. External business actions/knowledge fixture were mocked. It is not SIP, room playback, handset audio, a caller-recording accuracy test, or a percentile benchmark. It used an intermediate preparation build before the final hook/prompt refinements; do not present it as a final-build latency validation.

| Boundary | Measured |
|---|---:|
| Caller speech end → final STT transcript | 675.5 ms |
| Final STT transcript → preparation node start | 5.1 ms |
| Preparation node start → actual LLM request | 1.4 ms |
| Caller speech end → confirmed turn | 852.7 ms |
| LLM request started **before** confirmed turn | **170.7 ms overlap** |
| LLM request → first raw model text | 1,625.2 ms |
| First raw model text → first safely released text | 96.9 ms |
| First released text → first TTS input | 2.4 ms |
| First TTS input → first generated PCM | 666.0 ms |
| Speech end → first generated answer-response PCM | **3,072.5 ms** |
| Speech end → first local capture PCM | **3,072.9 ms** |
| Speech end → first actual room playback | **Not measured** |
| Speech end → first handset-audible meaningful words | **Not measured** |

The first response starts with the relevant maintenance answer and has no injected status/filler. First voice and answer-response PCM therefore coincide at the capture sink. Word-level semantic/acoustic onset has not been aligned. The model's irrelevant email question later in the same response is still a failure. First audio arrived before the full model response finished, so this path does stream. Request-to-first-text and TTS generation both materially contributed; blaming only TTS would contradict the trace. Approximately one second to useful speech was **not achieved**.

The installed SDK test and real streaming trace establish eligible generation before turn commitment; the SDK discards changed transcript/context. One speculative attempt plus no speculative TTS bounds waste. In the local audio harness, the sink lacks pause support, so its false-interruption-resume warning prevents using it to validate actual barge-in. The harness also printed a nonfatal FFI deallocation assertion at process exit. Neither event is evidence of handset playback quality.

Artifacts: [stage timestamps, transcript and output](output/verify/overlap-streaming.json), [synthetic caller](output/verify/synthetic-tamil-caller.wav), [generated response](output/verify/overlap-streaming-answer.wav).

### Status and inbound-test blocker

| Requirement | Verdict and proof scope |
|---|---|
| Preparation overlap, protected pause, no speculative action/state mutation | **Work aagudhu — installed-SDK safety tests and one real streaming trace.** Transcript/context/continued-speech invalidation cases are local scheduling tests. |
| Noon correction and unchanged confirmed details | **Work aagudhu — bounded real-model cases with mocked external effects.** Exact local state/tool proof linked above. |
| Ordinary injected checking/preparing filler removed | **Work aagudhu in inspected code and replay.** Does not prove all possible model wording. |
| Relevant, brief responses consistently prioritized over intake | **Work aagala.** Maintenance replay still adds unrelated intake/recaps. |
| Approximately one second to useful speech | **Work aagala in measured sample.** 3.07 s to locally generated/captured response audio. |
| Interruption onset → last audible room/handset audio | **Test pannala.** Existing SDK cancellation/committed-task regressions pass; no real acoustic barge-in measurement. |
| Final-build real caller understanding, pause protection and SIP audio | **Test pannala.** User has not placed the inbound test call. |
| Real business writes isolated in existing sandbox | **Not verified; blocks declaring the phone test ready.** No existing sandbox/test organization was identified. |

The existing dedicated inbound number is **+91 80654 81576**. **+91 80654 80036** also routes to the same assistant. LiveKit trunk `ST_mKsscodyJixr` contains both numbers; dispatch rule `SDR_TyoQ4D9sGqxY` targets `voice-agent`. These were read from actual DB/cloud configuration, not copied from an old report.

Do not place the test call yet: real assistants currently resolve an empty tool allowlist as the default enabled tool set, and post-call notifications/custom hooks can also write/send. The dispatch `dry_run` flag only prevents outbound dialing and does not sandbox an inbound call. An existing test organization/assistant or explicitly selected read-only test setup must be established before claiming safe business-write isolation. The user was asked for this missing configuration; no credentials were requested. Provider calls in local verification were real, while external business effects were mocked. The worker being registered/healthy does not by itself resolve this blocker.

After the user's inbound call, correlate `call_id` plus logical `turn_id`, SDK speech IDs, tool records and recording references. Use caller end → first room playback and caller interruption onset → last reported room audio separately from generated PCM. Local generated-audio recordings may include speech that was cancelled before playback. A carrier/handset recording is needed for handset-audible timing; server events alone cannot establish it. No call ID, actual caller transcript, room latency or handset result is available for this unperformed test.

Final regressions on this source: **771 passed, 1 skipped**, zero failures/errors, 47.44 s. The skipped test requires a real test DB; provider understanding and acoustic timing are supported only by the separate artifacts above. [Final JUnit](output/verify/preparation-regressions.xml), [computed timing boundaries](output/verify/preparation-measurements.json).

Only the idle worker was restarted after those checks. Current WSL root PID **2522**, build **`2026-11-03-preparation-v9`** verified in prewarm logs, LiveKit worker **`AW_uoXFSfWhXJ7M`**, registered **2026-11-03 09:24:55 UTC / 14:54:55 IST**, region **India South**. No duplicate Windows worker was found. Worker `/` and `/worker` returned HTTP 200; active jobs 0. Dashboard `/login` on 3000 and API `/health` on 8000 returned 200 and were not restarted. [Startup build/registration log](output/verify/preparation-worker-start.log), [local service checks](output/verify/preparation-local-services.json), [effective runtime audit](output/verify/preparation-runtime.json). PowerShell formats some native stderr INFO lines as `NativeCommandError`; the same log contains successful initialization and cloud registration. One 271 ms event-loop warning occurred during startup embedder warmup; its call-time audio impact has not been tested.

## Actual inbound failure: 2026-11-03, approximately 15:02 IST

**Verdict: Work aagala.** DB call ID `d233a673-762d-4f65-9f63-0d4f9f906b03`, room suffix `6vxB6MF2fPAq`, build `2026-11-03-preparation-v9`. The user's exported 50 live-log events start at 09:32:31 UTC and omit the earlier greeting/first-Hello sequence. The retained worker log supplies that missing context. There was a partial response after the greeting; the last caller turn then received no room reply before hangup.

| IST time / SDK caller turn | What actually happened |
|---|---|
| 15:02:13.856 / greeting | Sarvam generated greeting audio and room playback began. |
| 15:02:18–20 / turn 1 | STT returned **“Is now being recorded.”** The greeting was already interrupted, with room playback position 4.617 s. The carrier-announcement filter logged `carrier_announcement_ignored` only after interruption/turn commitment. Filtering the transcript did not undo the earlier VAD interruption. The origin of this recording announcement is inferred from its text and the filter event; it is not an intentional business question. |
| 15:02:24.267 / turn 2 | STT returned **“Hello.”** Presence was correctly detected, but the real model first called `update_call_details`; the recorded update contained **zero fields**. The first model request took about 2.46 s, then a second model request took about 3.42 s before its stream completed. |
| 15:02:30.336–30.342 / turn 2 | First generated response PCM, then room playback. **STT final → generated PCM 6,068.2 ms; STT final → room playback 6,074.4 ms.** Actual caller speech-end metrics for this Hello are missing, so these are not speech-end measurements. The room/history records only **“Yes, I'm”** before interruption. |
| 15:02:30.123–31.239 / turn 3 | Caller spoke again; STT returned **“हलो।”**, labelled Hindi. Language changed from unestablished English to **Hindi** at 15:02:31.245. This is a language-lock defect: Latin `Hello` is an inert short acknowledgement, but the equivalent Devanagari greeting is not in that acknowledgement set. Hindi is also missing from `script_lang`, so the weak detection-seeding branch establishes Hindi from this single word. |
| 15:02:31.338 / turn 2 response | Interruption completion callback; the last reported room-audio endpoint is 15:02:30.635, and the SDK transcript is the truncated “Yes, I'm”. Using SDK-derived caller onset 15:02:30.123 gives **511.7 ms to last reported room audio**. This is room-level evidence, not handset acoustic timing. A state-change event arrives later than the SDK's estimated acoustic onset and must not be substituted for it. |
| 15:02:31.691–45.276 / turn 3 | Actual model request began; first raw model text event at **15:02:35.487**. There was **no first-released-text, TTS-input, generated-audio or new room-playback event** for this response. The stream was cancelled when the caller left at 15:02:45.262, after about **13.58 s of request lifetime**. |

### Why the final answer was silent

The demonstrated failing boundary is **LLM stream → safely released text**, before TTS. The code holds a prefix until 25 characters, a recognized sentence terminator, or a tool call. The final turn produced raw model text but never reached the released-text marker. The gate/router has no overall deadline for obtaining a useful releasable prefix. Its fallback/retry runs only when the stream finishes/fails; it did neither before hangup. Installed SDK request timeout is applied as `httpx.Timeout(conn_options.timeout)`, a per-I/O timeout, not a total useful-output deadline. Comments calling it only a connect timeout are inaccurate. Trickle/keepalive traffic can prevent a read timeout while the caller still hears nothing.

**Uncertainty:** raw chunk content and upstream provider identity beneath OpenRouter were not captured. The trace cannot distinguish a short incomplete prefix, whitespace/trickle, or another provider/body stall with certainty. It does establish that TTS was never handed this response; a TTS-generation failure is not the observed final-turn failure. No 429 or provider exception appears in this call trace. A 3,795 ms model first-text delay, followed by no released answer, must not be reported as a 3,795 ms spoken reply.

Two offline counterexamples reproduce the code weaknesses without a provider request:

```text
python -X utf8 scripts/inspect_silent_call.py --probe
exit 1 (expected failure signal)
हलो। -> treated_as_short_ack=false; switched=true; resulting_language=hi
simulated short prefix + whitespace -> 0 released chunks; still waiting after 201.7 ms
```

The stream probe deliberately uses a 50 ms nominal connection setting and a 200 ms observation window to expose the missing useful-output deadline. It does **not** claim the real provider emitted those simulated tokens or prove model understanding. [Offline failure artifact](output/verify/silent-call-offline-probe.json), [inspection script](scripts/inspect_silent_call.py), [extracted actual worker events](output/verify/silent-call-worker-trace.json).

### State, telemetry and recording limits

No booking detail changed in the observed empty-field state update; the erroneous established language **hi** is the material state change. There was no booking request to evaluate. The tool continuation is incorrectly labelled `preview=true`, logical turn 3 while caller turn 2 is still active; this is a separate context/turn-accounting defect to address before trusting continuation timing. The provider-attempt counter and caller-turn counter must remain distinct.

`llm_turn_outcome` reports `cancelled`, zero released text and zero tools, yet `unanswered=false`. That boolean only detects completed empty streams and misses a silent turn ended by hangup. Similarly, call outcome `COMPLETED` describes telephony termination, not a successful conversational response. Both can conceal this failure in a dashboard.

The supplied AAC was decoded **locally**, 32.768 s, mono, 8 kHz. The matching log's local dual-channel recording is 35.710 s. Neither file was uploaded to STT or an LLM. The AAC was not independently transcribed or semantically listened to by a model. Cross-correlation against local caller/generated-agent tracks was weak (0.0495/0.0561), so waveform alignment was **not established** and cannot prove handset timing. Exact quoted words above come from the actual STT and SDK conversation events. The local right-channel recording contains generated frames, including cancelled/unplayed audio; its 18.1 s of generated agent audio does not mean the caller heard 18.1 s. [Local audio audit](output/verify/silent-call-audio-audit.json).

Final-turn speech end → first meaningful generated/room/handset audio: **no answer occurred before hangup**, so there is no successful latency sample. From the last reported response-room audio to hangup was about **14.63 s**. Server events locate the failure; handset-audible answer and interruption timing remain unverified. The earlier sandbox blocker remains unresolved. This diagnostic round made no provider request, business action, message, runtime-code change or worker restart.

Repair priorities supported by this evidence: bound the wait for useful releasable model output and recover without discarding safe streaming; avoid a semantic-state tool round for a contextually clear presence check; keep greeting/short acknowledgements language-neutral across scripts; handle the recording announcement without losing the greeting; correct continuation IDs and cancelled-silent-turn reporting. These are identified repairs, not claimed fixes in this diagnostic round.

## Repair applied: `2026-11-03-silence-v10` — controlled inbound test ready

This section supersedes the preceding worker/sandbox readiness status. **The worker is ready for a conversation-only inbound test. General model understanding is still not repaired reliably.** No final-build inbound call has been performed yet; the actual call result above is the earlier v9 failure.

### What changed

* `lang.py` recognizes neutral Hello equivalents across Tamil, Hindi, Telugu and Malayalam. Devanagari danda is separated as punctuation rather than included in a word. The exact observed `हलो।` no longer seeds Hindi. A real Tamil/English utterance or explicit language switch retains its existing routing behavior.
* `contact_corrections.py` supplies one shared anchored presence pattern, reused by `agent.py` and pending-work intent handling. `Hello, maintenance கிடைக்குமா?` does not match it. `CallState.observe_user` preserves confirmed fields/pending intake on a pure presence check.
* Pure presence checks now use the **existing committed conversation-control path**. If there is genuine pending work, its truthful status still wins; otherwise the agent directly says, in the active language, e.g. **“ஆமா, கேக்குது. சொல்லுங்க.”** Generation does not start before commit, does not execute a tool and does not require a model request. This is a direct answer to a connectivity question, not an automatic filler attached to ordinary questions. It is **not evidence that the model understood a business question**.
* Recording announcements are ignored before confirmed state/turn updates. If the configured greeting was interrupted by an announcement, its known unspoken text tail is resumed once with interruptions enabled. A verified prefix match is required; already-spoken words are not guessed/replayed. Normal caller interruptions remain enabled. This recovery is locally tested, not yet verified on a new handset call.
* Authorized tool-result continuations remain on the existing caller turn; they are not speculative new caller turns and do not re-observe the same user text under a retained SDK message ID.
* `_stream_gated` bounds time to a useful releasable prefix independently of HTTP/SSE activity. Effective first-useful-output deadline is **4.5 s per model attempt**, with **4 s stream-idle timeout** after output starts. A prefix timeout skips the redundant retry of that same primary and follows the existing configured fallback route. Once output/tool calls are released, a later failure does not replay actions through a fallback. Streaming continues immediately after a safe prefix; it does not await the full reply.
* The initial 3 s useful-prefix setting was too tight for observed provider first-text delays up to 3.795 s. It was raised to 4.5 s before the worker restart. This bounds a stall without treating normal measured provider latency as an immediate failure. It does not establish one-second answers or a global end-to-end deadline.
* `response_timing.py` counts actual recovery strings while excluding tracked status messages, and reports cancelled empty model turns as unanswered. Direct control replies/ignored announcements do not create misleading empty-model outcomes.

No model, credentials, saved assistant prompt or call-number routing was changed. The SDK, SIP, provider pipeline, language locking, confirmed state, recordings and pause floor remain in place. The existing CallTasks tests cover preserving submitted work across speech cancellation.

### Temporary business-write isolation

An existing provider sandbox was not discovered. The authorized test setup instead reuses the existing tool allowlist with a temporary **`VOICE_TEST_READ_ONLY=true` worker-process flag**. It applies to both routed numbers on this worker:

* Only `update_call_details` (local per-call memory) and `end_call` are exposed. Booking, calendar integrations, contact-memory writes, email/SMS and human transfer tools are absent. Custom HTTP tools are not loaded.
* Actual call rows, transcripts, cost diagnostics and recordings remain enabled.
* Post-call campaign mutations, notifications, n8n/business webhooks, signed DB webhooks and optional sentiment-model calls are skipped. The actual shutdown function was exercised with senders intercepted, proving that call-log completion/cleanup still runs while business callbacks do not.
* The model receives a test limitation directive. This capability restriction proves writes are unavailable, **not that the model will always explain the limitation correctly**. Do not treat a spoken booking claim as a real booking in this mode.

Normal tool capabilities are unchanged when the flag is false. `.env`/credentials were not edited; test mode is explicit in the running worker environment. This is a temporary conversation test mode, not a provider sandbox or a production-write verification.

### Verification and remaining model failure

The initial local reproduction was red: **13 failures** exposed language establishment, useful-output timeout, unnecessary presence tools, continuation accounting, announcement recovery, write-tool exposure and cancelled-silent-turn reporting. The final full suite is **792 passed, 1 skipped**, zero failures/errors, 45.93 s. The skipped test needs a real test DB. The final focused repair suite also passed **21/21** after selecting the effective 4.5 s setting. [Final JUnit](output/verify/silence-repair-regressions.xml), [boundary tests](tests/test_silent_call_repair.py).

This repair used **8 actual configured-model requests**, including intermediate attempts and tool rounds; the previous budgets were preserved, not reset. An attempted follow-up at the exhausted cap was refused before the provider call. No customer recording was uploaded, and business actions/retrieval stores were mocked in synthetic model tests. [Request ledger](output/verify/silence-repair-request-budget.json).

| Test | Actual evidence / verdict |
|---|---|
| Model-only pure presence, intermediate | “கேட்குதா?” produced a booking recap even with tools disabled. Text submission → local generated PCM **5,345.9 ms**. **Failed**; this caused the move to committed direct control handling. |
| Final direct presence path, real SDK/Sarvam TTS | `हलो।` and `கேட்குதா?` both produced **“ஆமா, கேக்குது. சொல்லுங்க.”**, no model request/tool call; confirmed name/date/time/email preserved and language stayed Tamil in the established-Tamil fixture. Text submission → first generated PCM **496.9 ms**. **Works within this local scope.** |
| Held-out noon, actual model in intermediate test | Time changed **11:00 → 12:00** while name/date/service/email stayed unchanged. Model also unnecessarily checked availability and spoke a mocked slot result. **State update works; conversational behavior fails.** Final stricter test mode removes the calendar tool; this exact final-mode model path was not rerun. |
| Maintenance paraphrase, actual model in intermediate test | “எங்க online store-க்கு regular maintenance support இருக்கா?” incorrectly invoked availability and spoke a slot result. **Fails general understanding/relevance.** Removing calendar capability in final test mode is not claimed to repair semantic understanding. |
| Test booking request, final 4.5 s setting | Real model recorded the previously supplied email as confirmed, with other details unchanged. The subsequent model turn hit the fixed request cap before sending, so it produced recovery text. **Write isolation works; a correct final spoken test-limitation answer was not verified.** This budget refusal must not be misreported as an upstream provider outage. |
| Stalled generation / output streaming / committed operations | Local fault injection proves bounded no-output wait, exactly one move to fallback without duplicate primary retry, safe text before generation completion, and no replay after partial output. Existing operation/correction/interruption regressions pass. **Not proof of provider quality or handset latency.** |
| Announcement recovery and audible barge-in on final build | Prefix/tail and cancellation behavior pass locally. **New inbound audio test still pending.** |

Artifacts: [intermediate real-model failures](output/verify/silence-repair-model.json), [direct presence and real TTS](output/verify/silence-repair-after.json), [final bounded booking check](output/verify/silence-repair-final.json), [generated presence WAV](output/verify/silence-repair-presence-answer.wav). The audio harness uses a local sink without pause support, so its warning about false-interruption resume precludes using it as live barge-in proof. PowerShell wraps native stderr INFO/deprecation output as `NativeCommandError`, causing some wrapper command exit statuses to be 1 despite a written result artifact; those artifacts and the test process exits are reported separately, not treated as blanket success.

The **496.9 ms** result starts at text submission. It excludes real streaming STT, endpoint waiting, room publication and PSTN/handset delivery. It is not speech-end-to-meaningful-handset audio and does not establish the one-second target. No final-build room or handset answer/interruption timing has been measured. The earlier v9 failed call's room timing remains the actual phone evidence until the next call.

### Running worker and user test

Only the idle worker was restarted. Root PID **3881**, build **`2026-11-03-silence-v10`**, registered worker **`AW_efGEStVM7q6r`**, region **India South**, registered **10:08:56 UTC / 15:38:56 IST**. Health `/` and `/worker` return 200, active jobs 0 at readiness verification; no duplicate Windows worker was found. Dashboard 3000 and API 8000 remain 200 and were not restarted. The worker loaded the intended build in prewarm; each next inbound call must still confirm actual assistant/profile and `call_test_mode` tool exposure from its job logs.

Effective process settings: `VOICE_TEST_READ_ONLY=true`, `VOICE_PREEMPTIVE_GENERATION=true`, `VOICE_USEFUL_TEXT_TIMEOUT_S=4.5`, `VOICE_STREAM_IDLE_TIMEOUT_S=4.0`. Endpointing remains dynamic **0.85–3 s**, alpha 0.9; speculative TTS is false and speculative attempt cap is 1. Interruption minimum remains **500 ms**, VAD-based, with false-interruption resume enabled. Selected model remains OpenRouter Llama 3.3 70B; Sarvam STT `saaras:v4`, TTS `bulbul:v3`, voice `kavya`.

Proof: [runtime/route/flag audit](output/verify/silence-repair-runtime.json), [worker build/registration log](output/verify/silence-repair-worker-start.log), [dashboard/API check](output/verify/silence-repair-local-services.json). The runtime audit's `business_sandbox_verified=false` refers to the still-absent provider sandbox; `read_only_test_mode.all_worker_roots_enabled=true` verifies the temporary isolation configuration. Startup produced a 291 ms embedder-warmup watchdog warning; its live-call impact is unverified.

The user can now place a **controlled conversation test** to **+91 80654 81576**. The other number, +91 80654 80036, uses the same assistant/worker and the same current test restrictions. No call has been initiated by this repair.

Suggested test: let the greeting finish, ask **“கேக்குதா?”**, then ask **“e-commerce website maintenance support இருக்கா?”**. Interrupt once while the agent speaks. Hang up normally and report that the call is finished. Do not expect a real appointment/email/SMS from this test. Correlate the new call/turn IDs, STT transcript, actual state/tool results, generated audio and room progress; report the remaining model failure if it recurs. Handset-audible timing needs an aligned recording and remains distinct from server playback events.
