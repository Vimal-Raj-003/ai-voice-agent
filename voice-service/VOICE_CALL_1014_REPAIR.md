# 04 November 2026 — 10:14 WhatsApp recording: diagnosis and v14 repair

இந்தப் புதிய recording-ல் latency மற்றும் தவறான பதில்கள் இரண்டும் உண்மையாக உள்ளன. முந்தைய local tests live-call quality-ஐ நிரூபிக்கவில்லை. குறிப்பாக v13 confidence handling-ல் தவறான assumption இருந்தது; இந்த repair அதை actual installed SDK வழியாக reproduce செய்து சரிசெய்கிறது. **அனைத்து சூழல்களிலும் perfect output அல்லது 1-second handset answer அடைந்ததாக இந்த report கூறவில்லை.**

**ஆதாரம்**

- Attachment: `WhatsApp Audio 2026-11-04 at 10.14.00 AM.aac`, mono 8 kHz, **210.944 s**. User approval-க்குப் பிறகு existing Sarvam `saaras:v4`, `codemix`, language `unknown` மூலம் **9 batch segments**, no retries; cap 24. Customer recording-க்கு புதிய LLM requests இல்லை.
- Content matches the morning inbound conversation: call ID **`93696562-8d30-4ccb-a63f-a9a0d677938a`**, assistant `cmuv65lxx0013v7f4thzf2qtv`, build v13, approximately **10:00:02–10:03:52 IST**. Role-attributed live transcripts and stage logs were compared with the batch transcript.
- Batch transcription is not human-verified verbatim audio. No diarization or verified word timestamps. Local stereo recording is 228.87 s; mono envelope comparison correlation **0.3771** is too weak to prove a precise alignment. Content correspondence supports the call association; exact waveform/handset alignment is unverified.

**என்ன தவறு நடந்தது; என்ன மாற்றப்பட்டது**

| Issue | Actual evidence | Repair / remaining limit |
| --- | --- | --- |
| Clear speech rejected as unclear | `Hello.` got confidence `.001`; four `assistant_confidence_clarification` events. Audio repeats “கடைசியா சொன்ன விவரம் தெளிவா வரலை”. | Installed Sarvam plugin maps **language_probability** into `SpeechData.confidence`. v13 mistakenly treated it as transcription accuracy. `stt_node` and diagnostics now treat Sarvam transcript-accuracy probability as unavailable; genuine accuracy scores from other providers still work. Actual node regression failed before and passed after. |
| Prepared answer discarded and restarted | Same question had preview request and a new committed request. Long-history SDK regression reproduced **two model calls** for unchanged text. | History is bounded/filtered on a **copy sent to the model**, consistently for preview and committed requests. Commit hook no longer trims/mutates SDK history just to enforce prompt size. Regression now needs **one** request; changed transcript/context/resumed speech still invalidate preparation and speculative tools still cannot run before commitment. |
| Model timeout and unhelpful fallback | Three pre-output primary timeouts plus one failure after partial output. Services question answered “விவரிக்க முடியும்”; final booking request ended “நான் உங்களுக்கு ம”. | Actual configured-model comparison completed before switching. Saved primary is now **Qwen3 30B A3B Instruct 2507**; prior 70B primary is fallback, replacing the weak 8B fallback. Only these two model columns and `updatedAt` changed. No hidden model override. Timeouts and partial-output handling remain risks if either provider stalls; a successful later synthetic answer does not prove elimination. |
| Relevant English knowledge missed | All **13** logged lookups had zero hits, despite an uploaded business digest. | If vector search yields no accepted hit, existing keyword retrieval is now tried. Latin/Tamil token runs are separated, preserving `hospital` and `service` in code-mixed text. Removed arbitrary unrelated documents from the no-match keyword fallback; failures now log their exception type. Warm, exact-query probes found **2 service / 4 hospital chunks** in the actual selected assistant's knowledge. Cold probes initially returned zero, so this is bounded retrieval evidence, not universal live coverage. |
| STT changed the meaning | Batch audio transcript: “கை கால்லாம் வலிக்குது”; live STT: “ear canal வலிக்குது”. | This remains a real recognition error. No unverified automatic rewrite was added. Sarvam has no transcript-accuracy probability for applying the numeric slider here. Correct text and real synthetic STT were tested separately; new phone recognition still requires verification. |
| Hospital-software question became medical intake | “Hospital-ல ... என்ன செய்றீங்க?” → “மருத்துவத்துறையில் உங்களுக்கு என்ன விதமான உதவி தேவைப்படுகிறது...” | Qwen's actual tested replies distinguish hospital software from treatment, rather than offering clinical service. Existing knowledge/state/action truth guards retained. One test still appended an unnecessary service follow-up; universal human-flow quality is not proven. |
| Direction instruction leaked into unrelated answers | Initial Qwen synthetic reply began “நீங்க எங்களுக்கு call பண்ணியிருக்கீங்க” before answering a software question. | Inbound directive now says direction is background and should be mentioned **only** when the current question asks who initiated/why the agent called. Final real-model retest omitted the direction preamble. Its Tamil wording still had an unsupported “சாதனைகள் தயாரிக்கிறோம்” phrase before saying software services; that remaining quality issue is disclosed below. No deterministic replacement of the user's question. |

Sarvam documents `language_probability` as confidence in the detected language, not word accuracy. LiveKit also documents that changing context in the commit hook invalidates preemptive generation. These match the installed source and the reproduced failures. [Sarvam STT reference](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe), [LiveKit speech/preemptive generation](https://docs.livekit.io/agents/multimodality/audio/).

**Original call latency — SDK-estimated speech end → room response start**

| Caller question | Commit | First model text | First TTS input | First generated audio | Room response start |
| --- | ---: | ---: | ---: | ---: | ---: |
| Turn 4: what services? | 2609 ms | 7488 ms | 7539 ms | 7918 ms | **7924 ms** |
| Turn 7: what do you do for hospitals? | 2316 ms | 5695 ms | 9588 ms | 13580 ms | **13590 ms** |
| Turn 9: speak clearly; I want an appointment | 2029 ms | 4263 ms | 5186 ms | 9485 ms | **9490 ms**, incomplete answer |

These are correlated committed-turn events, not handset-audible first meaningful word measurements. The services turn incurred primary timeout and fallback. The hospital turn shows significant model-text release and TTS buffering as well. The final turn waited for a provider that stalled after output. **TTS alone was not the cause.** Generated audio and first nonempty text do not themselves prove semantic usefulness.

**Bounded actual-model comparison**

Same synthetic cases, saved prompt, corresponding relevant knowledge, mocked business actions and an actual SDK session. Direct comparisons expose first model tool/text decisions; direct tool-only rounds are not falsely marked as completed spoken answers. Request cap **14**, shared with voice verification; no earlier repair budget was reset.

| Case | Existing 70B | Qwen |
| --- | --- | --- |
| Services: direct model | Chose `remember_details` instead of immediately answering | Named relevant services; first text 2782 ms |
| Services: actual SDK agent | Useful-output deadline expired; local failure reply at 4506 ms | Named services; first released text 2692 ms; appended an unnecessary follow-up |
| Hospital treatment versus software: direct | Chose `remember_details` | “Software-தான் செய்கிறோம்...” first text 1744 ms |
| Same question: actual SDK agent | Correct distinction, first released text 4339 ms | Correct distinction, first released text 2430 ms |
| Noon-only correction: actual SDK tools | `update_call_details(field=time,value=12:00,confirmed=true)`; date/name/email/service unchanged | Same correct field-only update and preserved values |

Both noon cases produced the existing direct tool speech: “சரி, கேட்ட நேரம் 12:00 PM-னு பதிவுபண்ணிக்கிட்டேன். Booking இன்னும் உறுதி செய்யலை.” This was requested-time state, not a new or rescheduled external appointment.

OpenRouter endpoint availability and tool support were read before the saved-model switch. Listed Qwen endpoints support tools and forced function choice. Advertised pricing at this check: **$0.09–$0.10 / million input tokens; $0.30 / million output tokens**, depending on endpoint. Public recent endpoint latency fields were null; measured test latency is the evidence used here. Requests now specify `provider.sort=latency` and `require_parameters=true`, keeping provider fallbacks and the operator-selected model. This may choose a higher-priced endpoint; it is not a response-time guarantee. [Live endpoint read-back](https://openrouter.ai/api/v1/models/qwen/qwen3-30b-a3b-instruct-2507/endpoints), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

**Real synthetic audio measurement**

Real Sarvam-generated input → real batch STT → configured model / actual agent → real Sarvam TTS; all business writes mocked. Recognized question: “Hospital-க்கு என்ன பண்ணுவீங்கன்னுதான் கேட்டேன். Treatment தருவீங்களா? Software பண்ணுவீங்களா?” Batch STT took **1103.6 ms**.

| Model / configuration | Text submission → first generated PCM |
| --- | ---: |
| 70B, new latency routing | **10497.5 ms**; extra memory-tool round before the answer |
| Qwen, new latency routing | **1251.4 ms**; direct hospital-software answer |
| Qwen, final direction-instruction refinement | **2685.1 ms**; one model round, no repeated direction preamble; wording quality remains imperfect |

This is a same-case comparison, not a statistical latency benchmark. It excludes batch STT, live endpoint waiting, room output and handset transport. It is **not speech-end → useful handset voice**, and it is **not ≤1 second**. Final retest answered “சிகிச்சை தருவதில்லை. Software தயாரிப்பு சேவைகள் உள்ளது”, but also used the unsupported phrase “மருத்துவமனைக்கு சாதனைகள் தயாரிக்கிறோம்”. It therefore does **not** prove fully grounded or consistently natural Tamil. Faster generation alone is insufficient. The fixed **14/14** model-request budget is exhausted; it was not extended to chase a nicer answer. Final prompt retest is in `call-1014-qwen-final-voice.json`.

**Effective settings / preservation**

- Assistant remains `cmuv65lxx0013v7f4thzf2qtv`. Current operator-saved prompts, greeting, inbound/outbound metadata, temperature **0.7**, max tokens **250**, Sarvam STT/TTS, voice **kavya**, BYOK, recordings, language lock, SIP and confirmed state remain.
- Current saved values: MEDIUM; min pause **350 ms**; effective dynamic endpoint wait **1.0–3.0 s**; interruption **500 ms**; silence **25 s**; max duration **1800 s**; confidence setting **65%** (not applicable as word accuracy for Sarvam).
- The 500 ms interruption value was already saved this morning. The earlier 700 ms report is historical. Pause protection was not reduced to manufacture speed.
- With a **1 s minimum turn wait** and speculative TTS disabled, audio still needs synthesis/playback time after commitment even when LLM preparation overlaps. A universal **1 s maximum** speech-end-to-audio guarantee is incompatible with these effective settings; an additional key alone cannot remove that floor. Dynamic waiting was 2.0–2.6 s in the failed call. Changing this tradeoff must be an explicit settings decision, not a hidden speed fix.
- Preemptive generation enabled; speculative TTS disabled. No extra classifier/model layer, key, architecture migration or dependency installation was needed.
- Approved **live business-action mode preserved**. Verification used mocked writes; no customer calls/messages were initiated. No commit, push, deployment or credential change.

**Verification status**

| Area | Status | Scope |
| --- | --- | --- |
| Confidence provenance / unchanged preview reuse | **Work ஆகுது** | Actual node/installed SDK regressions fail before, pass after; resumed speech and speculative action safety retained |
| Exact-query knowledge fallback | **Work ஆகுது — bounded probes** | Actual selected KB, initialized DB; unrelated fallback blocked by regression |
| Noon correction and preserving other fields | **Work ஆகுது — bounded actual-model cases** | Both models used the actual state tool and preserved unchanged fields |
| Consistently grounded, natural Tamil answers | **Work ஆகலை — not fully repaired** | Most Qwen domain answers were relevant; the final unsupported noun and an earlier unsolicited follow-up remain. More quality verification is needed before claiming completion |
| Backend regressions | **854 passed, 1 skipped** | Full suite after core changes; final prompt refinement additionally passed **36** relevant regressions |
| Strict ≤1 s meaningful phone answer | **Work ஆகலை / not established** | Initial Qwen local generated PCM was 1.25 s excluding live endpoint/STT/SIP |
| All original live STT errors eliminated | **Test பண்ணலை** | Recorded word substitution remains evidence; no new caller phone test |
| v14 phone interruption onset → last audible handset audio | **Test பண்ணலை** | Existing interruption regressions pass; no new correlated handset test |
| Real booking/mail delivery after this repair | **Test பண்ணலை** | Live mode retained, verification actions mocked |

**Runtime readiness**

Build `2026-11-04-understanding-v14`, installed SDK 1.8.4. Only the worker was restarted. Final root PID **2343**, cloud registration **`AW_vYWeuRBgPqKZ`**, India South, **10:50:30 IST**, 04 November 2026. Readiness checks passed with one root and `VOICE_TEST_READ_ONLY=false`. Windows localhost dashboard/login, API `/health`, worker `/worker` returned 200. The WSL audit itself could not reach the Windows-only API through its own `127.0.0.1:8000` and records `URLError`; that is distinct from the successful Windows health check. The inspected worker/tool configuration has no localhost:8000 dependency; this is not proof of every possible custom integration path.

Number remains **08065481576 / +918065481576**, inbound and outbound. The user can place the next inbound call; no call was initiated here. A registered/listening worker is readiness proof, not phone-quality proof. The remaining live checks are Tamil recognition, fully grounded phrasing, speech-end-to-meaningful handset audio, thinking pauses, and audible interruption cutoff. No new key was needed for these repairs; a stronger latency/quality guarantee remains unverified.

**Artifacts / exact changes**

- Code: `agent.py` (confidence provenance, copied bounded context, conditional inbound guidance, v14 build), `knowledge.py` (safe lexical fallback), `llm_routing.py` (latency/parameter-aware OpenRouter endpoints).
- Tests: `tests/test_call_1014_repair.py`, extended `tests/test_preparation_safety.py`; [full regression log](output/verify/call-1014-final-regressions.log).
- [Authorized attachment transcript](output/verify/call-1014-audio-transcript.json) (private speech), [extracted call events](output/verify/call-1014-events.json), [stage measurements](output/verify/call-1014-analysis.json), [retrieval probes](output/verify/call-1014-retrieval-probe.json).
- [Real model comparison](output/verify/call-1014-model-comparison.json), [synthetic voice comparison](output/verify/call-1014-audio-verification.json), [final Qwen voice retest](output/verify/call-1014-qwen-final-voice.json), [request ledger](output/verify/call-1014-request-budget.json), [final focused regressions](output/verify/call-1014-final-focused-tests.log).
- [Saved model read-back](output/verify/call-1014-model-readback.json), [runtime audit](output/verify/call-1014-v14-final-runtime.json), [restart/source hashes](output/verify/call-1014-v14-final-restart.json), [registration log](output/verify/call-1014-v14-final-worker.log), [number/mode readiness](output/verify/call-1014-v14-final-number-readiness.json).
- Readiness helper now recognizes values loaded from unchanged checkout `.env` after process startup; Linux initial environment alone did not contain the outbound number. No routing setting was changed by that check.
