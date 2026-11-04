# JillJill repair — 03 November 2026

> Newer v12 repair: [email loop, inbound/outbound direction, current worker and test limits](EMAIL_DIRECTION_REPAIR_REPORT.md). The v11 worker identifiers below are historical.

> Routing update, 17:07 IST: **+91 8065481576 is now the sole inbound/outbound number.** The old number is inactive in the app and unassigned from carrier/LiveKit routing. Current worker PID `5840`, registration `AW_R8NFCtUYwFoQ`; build unchanged. Earlier two-number mapping and PID references below are historical. See [current routing verification](SINGLE_NUMBER_ROUTING_REPORT.md).

**Worker ready; one-second voice latency இன்னும் நிரூபிக்கப்படவில்லை.** Report-ல் வந்த state/context/correction failures-க்கு கீழே உள்ள repairs implement செய்யப்பட்டுள்ளன. Local regressions pass; configured real model-லும் synthetic speech-லும் குறிப்பிட்ட paths verify செய்யப்பட்டுள்ளன. “எல்லா phone calls-லும் perfect / அதிகபட்சம் 1 second” என்று இந்த evidence வைத்து கூற முடியாது.

**இப்போது இயங்குவது**

- Build: `2026-11-03-conversation-v11`; WSL worker root PID `5421`.
- LiveKit worker `AW_WZWDi5qW25B5`, India South; registration **16:50:08 IST**, 03 Nov 2026. Worker health HTTP 200; active jobs 0 at readiness check.
- Same selected assistant: `cmuv65lxx0013v7f4thzf2qtv`; same LiveKit/Vobiz trunk and dispatch. Dashboard `/login` on 3000 and API `/health` on 8000 return 200. Only the worker was restarted.
- Existing dedicated inbound number: **+91 8065481576**. **+91 8065480036** also maps to the same assistant/worker and is labelled inbound & outbound. These are not separate repair versions.
- Read-only call test mode remains **true**. Real SIP, STT, LLM and TTS run; booking/calendar/email/SMS/contact-memory/custom HTTP actions are unavailable in this mode. Call logs and recordings remain enabled. No customer call/message was initiated by this repair.

**Exact changes**

| Area | Repair | Evidence / limit |
| --- | --- | --- |
| Caller address | Shared prompt and final spoken-text sanitization remove gender/family titles including ஐயா, அய்யா, சார், மேடம், sir, madam, ma'am. Use நீங்க/நீங்கள். No gender classifier added. | Split-token speech guard tests; configured-model memory reply used நீங்க. Full future phone-call coverage pending. |
| Original problem / constraints | Reuse `CallState.known_facts` for bounded verbatim caller evidence outside rolling history. Keep the initial three significant statements and a bounded recent tail; inject original plus recent evidence, explicitly giving later corrections priority. | Original website/slow-site evidence survives actual SDK history truncation. Real selected-model session remembered existing slow website and the “no new site” constraint. Not unlimited or cross-call memory. |
| Wrong name | Reject scheduling/sentence-shaped name candidates and unknown/null placeholders. Model-written names must be supported by current caller evidence; stale updates remain rejected. Preserve the pending name question when the answer is scheduling information. | Original “எனக்கு நாளைக்கு” regression now passes. A real-model intermediate run invented `name=unknown`; runtime rejection was added. Final synthetic speech test stored a date and **no name**. Conservative shape checking is not a universal proper-name recognizer. |
| Email spelling | Stop capturing the last `three@…` fragment as a complete address when spaced spoken-number spelling precedes it. Keep the existing correction/readback workflow; a newly supplied candidate cannot confirm itself in the same caller turn. | Both explicit spaced-letter and `API YSRI. four three@…` regressions pass. Exact spelling from noisy real phone audio is still an STT accuracy limitation; ask clarification when unclear. |
| Noon correction | Normalize `12:00 PM` tool arguments to backend `12:00` before validation. Changed local time is spoken from the actual saved state, preserving other fields and saying booking remains unconfirmed. | Real selected model and Qwen sessions both updated `16:00→12:00`; date/name/email/service unchanged. |
| Booking constraint | Persist `booking_hold`; block the actual booking boundary until explicit permission. Hold changes invalidate unsubmitted work; submitted operations keep their existing independent ownership. | Write-boundary test checks that the submit function is not called. Existing committed-operation/interruption regressions pass. |
| Unsupported success claims | Existing TTS path now checks action-sensitive clauses against actual verified booking/email state. In read-only mode it cannot allow the observed “appointment confirmed / email sent” claims. It streams ordinary words without collecting the complete answer. | Chunk-boundary, multi-sentence and misleading-negation regressions pass. This is a guard for recognized action claims, not proof of arbitrary model factual accuracy. |
| Presence / invalid tool arguments | Extend the existing anchored presence matcher to natural connectivity-only variants. Real questions with a hello prefix remain model turns. Safely interpret the observed literal `"null"` confirmation sentinel as false; it cannot authorize a write. | Actual failed variants plus substantive-question counterexamples; actual SDK argument validation test. |
| Language | The running worker explicitly enables strict established Indic-language lock. Short acknowledgement / English correction / spurious other-script text cannot flip Tamil; explicit caller language requests still unlock it. Generic multilingual `LanguageState` behavior remains available outside strict mode. | Language-lock and existing multilingual regressions pass. Sarvam streaming STT stays `unknown/codemix`; this is output-language protection, not an STT accuracy guarantee. |
| Tone / current question | Add neutral-address and original-context priorities to existing instructions; positive-topic guidance discourages unrelated intake. No new AI/classifier service. | Context tests and bounded real replies; human-perceived warmth/prosody still needs phone listening. |
| Serial latency | Release a safe two-word model prefix at 12 characters instead of 25; Sarvam text buffer 50→30 and max chunk 150→100. Remove the repeated primary timeout retry. Ordinary information questions in read-only mode do not invoke the memory tool; verified new-date updates can speak directly without a second model continuation. | Streaming and no-op-tool-choice tests pass; SDK accepts the constructor settings. The last information-question/date-continuation optimizations landed **after** the real-audio measurements below; no measured speedup is claimed for them yet. |
| Calls closing during fallback | Inner pipeline model errors are marked recoverable while the existing custom node owns recovery, so SDK session error counting does not independently close the call during router fallback. Original provider failures remain logged. | Actual installed SDK event/session test injects five provider errors without closing the session. Real failure-injection phone test not performed. |

Application seams: `agent.py`, `callstate.py`, `contact_corrections.py`, `conversation_style.py`, `tools.py`, `lang.py`, `config.py`, `call_tasks.py`. `.env.example` documents the new settings; actual credentials and `.env` were not changed. Existing dashboard/UI changes and prior repairs were preserved.

**Before → after, using real model evidence**

1. **Original website problem:** failed recording: agent said the caller wanted a new website. Repaired selected-model session: “நீங்க ஏற்கனவே இருக்கிற website slow-வா இருக்கு என்று சொன்னீங்க. புதுசா website வேண்டாம், அதை சரி செய்யணும் என்றும் சொன்னீங்க. புதுசா கட்டணும் என்று கேட்கவில்லை.” This was a real configured Llama response, not a mocked answer.
2. **Name versus scheduling:** failed recording/state: `name=எனக்கு நாளைக்கு`. Intermediate real-model run: `name=unknown` — also a failure, used to strengthen validation. Synthetic recording → real Sarvam STT: “எனக்கு நாளைக்கு மதியம் நேரம் இருந்தால் நல்லா இருக்கும்.” Actual agent stored `date=2026-11-04`, retained pending name, and saved **no name**. Its reply asked which afternoon time; the final direct-date reply optimization now retains the missing-name question without a second model trip, but that final reply path has local verification only.
3. **Noon correction:** synthetic caller: “வெள்ளிக்கிழமை அப்படியே இருக்கட்டும். நாலு மணி வேண்டாம், மதியம் பன்னிரண்டு மணிக்கு மட்டும் மாத்துங்க.” Selected model tool arguments: `{"field":"time","value":"12:00","confirmed":true,"turn_id":5}`. Runtime saved `time=12:00`, retained date `2026-11-06`, name `Nila`, service and `nila@example.test`. Spoken tool result: “சரி, கேட்ட நேரம் 12:00 PM-னு பதிவுபண்ணிக்கிட்டேன். Booking இன்னும் உறுதி செய்யலை.” `confirmed` here never confirms an external appointment.

**Direct model versus actual agent versus STT path**

The run used synthetic/redacted histories and knowledge fixtures, the actual configured model and actual SDK agent/state/tool implementation. External business I/O was mocked. Production retrieval filtering ran, but knowledge-store results were synthetic fixtures: this does **not** prove every real knowledge document can be retrieved correctly.

| Case | Selected Llama direct, with correct history | Selected Llama actual SDK session | Qwen comparison |
| --- | --- | --- | --- |
| Recall existing slow website | Returned an unnecessary `update_call_details(field=none)` call, no spoken text in that first model round. | Correct remembered answer, first released text **1,710.5 ms** after node start; no action tool call. | Direct answer correct at **2,998.1 ms**; SDK answer correct at **2,733.8 ms**, with an unnecessary “நல்லா இருக்கு” ending. |
| Change time only to noon | Correct `field=time,value=12:00` tool call; first model event **7,541.7 ms** in this sample. No direct tool execution was performed. | Actual tool execution changed only time; deterministic spoken result matched saved state. | Direct reply claimed the time was changed without a tool in that direct round; actual SDK session correctly executed the time update and matched the saved state. |

Qwen `qwen/qwen3-30b-a3b-instruct-2507` availability and tool support were checked before this comparison. Listed endpoints included tool-capable providers; listed pricing was approximately **$0.09–$0.10 / million input tokens and $0.30 / million output tokens**, varying by endpoint. See [OpenRouter endpoint metadata](https://openrouter.ai/api/v1/models/qwen/qwen3-30b-a3b-instruct-2507/endpoints). These small samples did not show a quality/latency advantage sufficient to switch. **Configured Llama model remains unchanged.** Provider metadata had no usable latency statistics; the timing comparison above is from actual requests.

**Measured real audio — target not met**

Two synthetic Tamil recordings were synthesized, recognized by real Sarvam STT and sent through actual `AgentSession` and streaming Sarvam TTS. No customer recording was uploaded in this repair run. No SIP room or handset was involved in this bench test.

| Input | Batch upload→STT final | SDK text submission→first generated PCM | What actually happened |
| --- | ---: | ---: | --- |
| Online-store speed support question | 416.7 ms | **5,932.8 ms** | STT preserved the question; answer addressed speed support, but added a redundant support-intake question. An unnecessary state-tool round contributed to delay. |
| Tomorrow-afternoon preference while name pending | 299.8 ms | **5,303.8 ms** | No wrong name saved; a date was recorded, then the model asked for exact afternoon time. A second model continuation contributed to delay. |

These are **first generated response audio**, not speech-end→room playback, handset-audible timing, or word-aligned “first meaningful word” measurements. No automatic checking/preparing filler was injected. A separate content-aligned actual-answer start time was not measured. The later local changes remove those unnecessary trips in the relevant test-mode/date paths, but **their final STT→model→audio latency is not remeasured**: the bounded 20-chat-attempt budget is exhausted and was not reset or increased.

The original phone recording had room response starts of 3.63–4.56 s on several simple questions, and one incorrect time-correction answer at 15.25 s. Those room timings cannot be directly compared to this bench's text-submission→generated-PCM timings as a before/after speedup. The existing protected endpoint waiting, STT/VAD delays, provider TTFT and TTS startup all still matter. There is no evidence for a maximum one-second answer guarantee.

**Effective settings after restart**

| Setting | Effective value |
| --- | --- |
| Installed LiveKit agents | 1.8.4 |
| Selected assistant/model | Same assistant; OpenRouter `meta-llama/llama-3.3-70b-instruct` |
| Configured fallback | Same-provider `meta-llama/llama-3.1-8b-instruct` |
| STT | Sarvam `saaras:v4`, `codemix`, `unknown`, 16 kHz |
| TTS | Sarvam `bulbul:v3`, `kavya`, pace 1.08, linear16, 16 kHz |
| TTS buffer/chunk | 30 / 100 characters; supported installed SDK minimum is 30 |
| Turn detection | Existing VAD; dynamic endpointing min **850 ms**, max 3 s, alpha 0.9 |
| Saved assistant min pause | 350 ms; effective protected floor remains 850 ms |
| Preemptive generation | Enabled; preemptive TTS false; max speculative retries 1 |
| Interruption | Enabled; min duration 500 ms, min words 0, false-interruption resume true, timeout 2 s |
| Strict language lock | true |
| Useful-prefix / stream-idle deadlines | 4.5 s / 4.0 s; timeout retries no longer repeat the primary |
| Business write mode | read-only test |
| Recording | enabled |

Sarvam documents the buffering/latency tradeoff in its [production tuning guide](https://docs.sarvam.ai/api/integration/pipecat-production-guide). That guide includes another adapter's 20-character example; this repository's installed plugin rejected 20, so **30 was validated against the installed constructor**, not assumed from a web example.

**Proof and remaining work**

- Baseline reproduction: **13 failing cases**, including wrong-name capture, lost original context, natural presence variants, spelling truncation and language drift.
- Final complete suite: **822 passed, 1 skipped**, 43.67 s. [Full test output](output/verify/conversation-v11-verified-tests.log). Passing counts alone are not the understanding evidence; real replies/state/tool arguments above supply that evidence.
- Real-model budget: **20/20 chat attempts**, including intermediate failures, selected-model retests, Qwen comparison and synthetic-audio sessions. No hidden budget reset. [Budget](output/verify/call-1554-repair-request-budget.json).
- Existing SDK speculative-generation tests cover transcript/context changes and caller continuation. Existing task-ownership tests cover interruption without cancelling/duplicating submitted operations. New actual phone interruption latency was **not measured** after this repair.
- **Work ஆகுது — bounded evidence:** original context retrieval into prompts, correct real-model memory reply, no wrong name on tested scheduling replies, noon-only saved-state update, local neutral-address/action-claim guards, preserved task ownership, worker health/registration.
- **Work ஆகலை / target not met:** measured synthetic first generated audio was still 5.3–5.9 s before the last serial-trip optimizations. One-second maximum is not achieved or guaranteed by evidence.
- **Test பண்ணலை:** final build's fresh inbound handset timing; final serial-trip optimizations with a new real-model audio run; noisy-phone Friday/noon/letter recognition after changes; every emotion/prosody scenario; final room/handset barge-in timing; production business writes (intentionally unavailable during this test).

Next useful verification is your own inbound call to **+91 8065481576**. Give an existing-site problem, interrupt once, answer a name question with a time preference, correct 4 PM to 12 noon without changing the date, and ask what your original issue was. No exact script is required. After the call, use its **new call ID and caller turn IDs** to correlate transcript, saved state, tool arguments/results, recording and room playback. Your previous call ID is the diagnosis baseline, not evidence of the new build's phone behavior. Handset-audible timing needs a suitably aligned recording; generated/room audio alone will not be presented as ear timing.

Artifacts: [selected-model comparison](output/verify/call-1554-repair-comparison-selected.json), [Qwen comparison](output/verify/call-1554-repair-comparison-qwen.json), [real synthetic audio results](output/verify/call-1554-repair-audio.json), [running config and SIP mapping](output/verify/conversation-v11-running.json), [restart/source hashes](output/verify/conversation-v11-restart.json), [worker registration log](output/verify/conversation-v11-worker.log). The earlier [analysis report](VOICE_CALL_1554_ANALYSIS.md) is preserved as the baseline.
