# Assistant page → voice runtime — 03 November 2026

> Historical v13 snapshot. November 4's actual call exposed confidence-provenance and preview-invalidation bugs missed by these tests. See the [v14 diagnosis, fixes and current model/settings](VOICE_CALL_1014_REPAIR.md) for the latest evidence and remaining limits.

**The selected assistant's saved prompts and controls now reach the existing voice runtime. Inbound/outbound instructions are saved, configured-model checks passed, and worker v13 is registered. Following the user's explicit approval, real configured business actions are now enabled for subsequent calls. No customer call or message was initiated to verify this change.**

**What was wrong**

- Pipeline turn handling ignored saved sensitivity and interruption duration, imposed an 850 ms default floor even on explicitly saved pause values, and fixed interruption at 500 ms.
- Saved temperature/max tokens were loaded from DB but not passed to the model constructors. OpenRouter silently used 0.2 temperature and 512 tokens instead.
- The hallucination-guard checkbox was loaded but did not control its promised optional prompt clause. Saved silence/max-duration controls were not enforcing their described call limits.
- A generic business block injected the platform software/content service list into custom roles. A hidden greeting replacement could also change an operator's saved first message/persona. These conflicted with assistant-page authority.
- The SDK's high-level transcript event omits confidence. Looking only at it cannot enforce a confidence setting. Raw STT events are now checked where a real probability exists; absent metadata is not fabricated as a low score.

**Current read-back: actual saved settings, not old report values**

| Setting | Saved / effective behavior |
| --- | --- |
| Assistant | `cmuv65lxx0013v7f4thzf2qtv`, Appointment Booker |
| Model | OpenRouter `meta-llama/llama-3.3-70b-instruct`; existing fallback preserved |
| Temperature / max output | **0.7 / 250** passed to supported primary/fallback constructors |
| STT / TTS / voice | Sarvam `saaras:v4` / `bulbul:v3` / `kavya` |
| Sensitivity | **MEDIUM**, 1000 ms silence wait |
| Min pause | **350 ms**; effective SDK floor is **max(1000, 350) = 1000 ms** |
| Adaptive endpointing | Dynamic, minimum **1.0 s**, maximum **3.0 s**; preparation can overlap the endpoint wait |
| Interruption threshold | **700 ms**, passed as SDK `min_duration=0.7`; not a handset stop-time guarantee |
| Continuous silence timeout | **25 s** mutual inactivity; closes the SIP room via the existing SDK away event when no reply is pending |
| Maximum duration | **1800 s**, counted after answer; normal shutdown hooks retained |
| Confidence threshold | **65%** saved; **Sarvam does not supply the required probability**, so numeric gating is unavailable for this provider. No accuracy percentage is inferred. UI hint and logs disclose this. |
| Hallucination guard / recording | **Enabled / enabled**; actual-action truth checks remain independent of optional guidance |
| Preemptive generation | Enabled; speculative TTS disabled; existing state/action safety retained |
| Live action mode | **`VOICE_TEST_READ_ONLY=false`** in worker PID 7979, enabled after explicit user approval; configured booking/calendar/email/SMS/custom actions may execute when caller requests and tool preconditions are satisfied |

The assistant row backup confirms MEDIUM/700 ms/65%/25 s/250 were already saved before the prompt update and were preserved. An intermediate commentary referring to LOW came from the older report snapshot; the table above is the current DB/SDK read-back.

**How saved choices apply**

- Save changes applies to the **next new call**. The active call retains its snapshot and confirmed state; a prompt edit does not restart an ongoing conversation. No worker restart is needed for later ordinary assistant-page edits.
- Sensitivity waits: LOW **2 s**, MEDIUM **1 s**, HIGH **0.4 s**. The effective floor is the larger of sensitivity and Min pause. Legacy profiles without saved controls keep the deployment default; explicit saved values take precedence over that default.
- Min pause is a minimum turn wait, not total STT→LLM→TTS latency. VAD/STT, model preparation, synthesis and transport still take time. The current 1 s floor does not prove a 1 s meaningful handset answer.
- Provider availability, supported SDK/provider capabilities, verified action outcomes and test-mode restrictions still apply. A prompt cannot turn a missing probability into an accuracy measurement or turn a queued email into delivered mail.

**Prompts prepared and saved**

- [Inbound prompt](assistant_templates/appointment_inbound.txt): Juli, caller-initiated reception, current-question priority, neutral Tamil/Tanglish, contextual tone, durable call context, field-only corrections, no forced intake/fillers, actual availability/booking results, one email approval and no duplicate sends.
- [Outbound prompt](assistant_templates/appointment_outbound.txt): the user-approved **existing enquiry/appointment follow-up** purpose, correct business identity, no invented prior appointment, no intake appended to a reason-for-calling answer, same memory/contact/action rules.
- Saved common greeting: **“வணக்கம், {business_name}-லிருந்து Juli பேசுறேன்.”** It works in either direction and is no longer silently replaced. Later greeting edits on the page are honored with supported placeholder substitution.
- Saved prompt text remains first and unmodified except supported placeholders. Shared conversational defaults no longer import a different business's service list or replace the saved role. Actual call direction, caller corrections, confirmed memory and tool outcomes remain authoritative facts.
- Only inbound text, outbound metadata text and the greeting were changed in the selected assistant row. Providers, timing/accuracy controls, tool selections and unrelated metadata were preserved. A local backup exists in `output/verify/assistant-controls-before.json`.

**Proof from the actual configured model**

Six text conversations and one synthetic-audio path used **8 of 12 permitted chat attempts**, with the selected real model. Prior exhausted repair budgets were not reset. Business actions were simulated and fail-closed guards prevented real SQL, SMTP, notifications and non-LLM HTTP.

| Case | Actual reply / observed result |
| --- | --- |
| Inbound “ஏன் கால் பண்ணீங்க?” | “நீங்க எங்களுக்கு call பண்ணியிருக்கீங்க. நான் உங்களுக்கு எப்படி உதவி செய்ய முடியும்?” |
| Outbound “இந்த அழைப்பு எதுக்காக?” | Identified the synthetic business and said “Enquiry அல்லது appointment follow-up தொடர்பாக அழைக்கிறேன்.” No extra service-intake question. |
| One natural email approval | Actual model called `update_call_details` with `field=email, confirmed=true`, then `remember_details`. State became `email_confirmed=yes`; the simulated existing-recipient update and simulated queue each ran **once**. Date/time/name/service were unchanged. No new booking. |
| Spoken email result | “Email address save ஆயிடுச்சு. Confirmation email queue-ல இருக்கு; இன்னும் delivery உறுதி ஆகலை.” This is simulated queue proof, **not real mail delivery**. |
| Original issue after history growth | Recalled the existing slow website and maintenance request; did not restart email collection or change to a new-site requirement. |
| Changed operator role | An ephemeral bicycle-repair prompt/knowledge probe answered bicycle repair/tune-ups and **9 AM** opening in both direct-model and actual-agent paths. The real saved Juli/VIMS prompts were not replaced by that probe. |

Synthetic voice used **real Sarvam STT → configured LLM → actual SDK agent → real Sarvam TTS**. STT recognized the natural Tamil approval; recipient became confirmed and no confirmation loop occurred. Text submission→first generated PCM was **2267.8 ms**, batch STT **336.6 ms**. This local sink excludes live endpoint waiting, SIP, room playback and handset timing. It is not a controlled speedup comparison against earlier samples or a one-second result.

**Verification status**

| Area | Status | Evidence / limits |
| --- | --- | --- |
| Page save → DB payload / direction metadata / numeric bounds | **Work ஆகுது** | Existing real server action exercised with DB/navigation mocked; chosen values, valid zero, empty defaults and range boundaries asserted; metadata preserved. |
| DB → SDK timing/silence/interruption and generation settings | **Work ஆகுது — construction / local tests** | Current selected profile read-back, installed SDK session options and provider constructor arguments checked. Phone timing still pending. |
| Saved role, both directions, context and one-time approval | **Work ஆகுது — bounded configured-model cases** | Actual replies/state/tool arguments above; all external business actions mocked. Not universal Tamil/Tanglish coverage. |
| Raw low-confidence clarification without corrupting known fields | **Work ஆகுது — local tests where probability exists** | Missing metadata does not trigger a fake low score; speculative generation does not update uncertain state. Sarvam probability gating remains unavailable. |
| Full voice regressions | **849 passed, 1 skipped** | Existing state, streaming, interruptions, SIP pre-dial lifecycle, recordings, providers and action idempotency included. Counts alone do not prove live quality. |
| Dashboard checks | **Work ஆகுது** | TypeScript `--noEmit` passed; five dashboard direction/save tests passed. Two existing typed-array annotations were narrowed to `ArrayBuffer` to resolve the type-check blocker without changing monitor audio behavior. No browser click-through was performed. |
| Real customer mail delivery | **Test பண்ணலை / live mode enabled** | Email transport configuration is present; SMTP/Resend authentication and mailbox receipt were not tested. Enabling actions is not delivery proof. |
| v13 SIP call / handset latency / audible interruption stop | **Test பண்ணலை** | User's own next call is required; no customer call/message was initiated. |

Automatic approval initially rejected the synthetic action verification because `test_read_only=False` alone did not prove safe mocking. Added and locally tested fail-closed business-I/O guards; the reviewed retry was then allowed and passed. No rejected operation was bypassed and no actual business message was sent.

**Worker ready**

- Build **`2026-11-03-assistant-controls-v13`**, SDK **1.8.4**, one root worker PID **7979**.
- Fresh registration **`AW_ygbjFhfCnMFf`**, India South, **18:26:05 IST**, 03 November 2026. Worker health 200, readiness-check load approximately 0.015.
- Sole inbound/outbound number remains **+91 8065481576** / **08065481576**; same assistant, LiveKit/Vobiz SIP trunks/dispatch, BYOK, language lock and recording paths.
- Dashboard 3000/login, FastAPI 8000/health and worker 8081/worker all returned **200**. Only the worker was restarted. No commit, push, deployment or credential change.

**Live-action mode approved and enabled**

After reviewing the completed implementation, the user explicitly answered “ஆம், real actions enable செய்யலாம்”. Only the worker was restarted with `--business-mode live`; its actual process environment now contains `VOICE_TEST_READ_ONLY=false`. Fresh cloud registration, one worker, number routing and all three localhost services were verified. The restart helper now preserves the existing mode by default instead of unconditionally restoring test mode. The application's existing default is also live when no override exists; credentials were unchanged.

Configured booking/calendar/email/SMS/custom actions can now run on subsequent calls. A caller's single natural email approval can progress to the existing confirmation action when its required booking/state conditions are met; this does not mean a message has already been sent. The configured-model and synthetic-audio evidence above still used mocked business actions. No real customer delivery, outbound call or new inbound phone test was performed after enabling live mode.

**Artifacts**

- [Prompt/config read-back](output/verify/assistant-controls-prompt-readback.json), [current live-mode runtime settings](output/verify/assistant-controls-v13-live-runtime.json)
- [Configured-model replies, state and tool arguments](output/verify/assistant-controls-real-model.json), [request budget](output/verify/assistant-controls-request-budget.json)
- [Synthetic speech verification](output/verify/assistant-controls-audio-verification.json), [answer WAV](output/verify/assistant-controls-synthetic-answer.wav)
- [Final regression log](output/verify/assistant-controls-v13-final-tests.log), [sandbox guard tests](tests/test_verification_sandbox.py), [assistant control tests](tests/test_assistant_controls.py)
- [Worker source hashes/live restart](output/verify/assistant-controls-v13-live-restart.json), [registration log](output/verify/assistant-controls-v13-live-worker.log), [number/live-mode readiness](output/verify/assistant-controls-v13-live-number-readiness.json), [localhost health](output/verify/assistant-controls-v13-live-local-health.json)
- Earlier `assistant-controls-v13-*` runtime/restart/readiness artifacts without `-live` document the preceding read-only verification; they are historical snapshots.
