# Email loop and call direction repair — 03 November 2026

> Later v13 work saved revised inbound/outbound prompts and verified both directions with the real configured model. Current settings, worker and remaining live-action limits: [assistant page runtime report](ASSISTANT_PAGE_RUNTIME_REPORT.md). The v12 measurements and failed outbound sample below remain historical evidence.

**Email confirmation loop reproduced and repaired at the state/tool boundary. Inbound direction passed the configured-model check. Worker v12 is registered and ready on +91 8065481576. The final revised outbound prompt still needs a real-model/phone retest; one-second voice latency is not achieved.**

**Recording and trace evidence**

- Supplied WAV: `917397075913_918065481576_2026-11-03-11-57-23.wav`, stereo, 8 kHz, **813.32 seconds**; inspected locally without uploading it.
- Associated application trace, based on number/time/dialogue: call `3d828c3a-5ec1-40fd-a2a1-0a76e7669f72`, room `inbound-_917397075913_r9A2EwaD76JE`, build `2026-11-03-conversation-v11`, assistant `cmuv65lxx0013v7f4thzf2qtv`; approximately **17:13:49–17:27:03 IST**.
- Evidence below uses existing live STT, assistant text, tool/state events and exact TTS-input logs. This is **not** an independently verified verbatim transcription/listening assessment of the supplied WAV. No new customer-audio upload was made. Its duration differs from the 793-second app recording. A whole-call energy-envelope comparison was weak (`0.1832` correlation), so it does not establish exact waveform/word alignment or handset timing.

**எதனால் email திரும்பத் திரும்பக் கேட்கப்பட்டது?**

At 17:25:20 IST, caller text was “ம் சரியா இருக்கு அனுப்புங்க email அனுப்புங்க.” The model called `update_call_details` with the existing email value but without recording approval. The tool's old branch automatically said **“[email] சரியான email தானே?”** whenever an email was unconfirmed, even when its value had not changed. Similar tool-generated read-backs recur after “சரியான email தான்…” and “perfect-ஆ இருக்கு…” through 17:25:59. Only a later plain “Correct.” cleared the pending state around 17:26:07.

The failure involved caller-meaning interpretation **and a deterministic tool response that forced the loop**. Changing only the model's wording would leave that branch intact. Local regressions reproduced the exact forced speech before repair.

Other confirmed gaps:

- Repeating an already approved email could reopen `email_confirmation`; a later assistant email question could also rearm it.
- After “இல்ல தப்பு”, the model could restore a rejected/unsupported address from history without new caller spelling.
- `latest_email` removed spaces around every full stop; sentence punctuation could become part of the next address, e.g. `.nila@example.test`.
- The profile selection log already said **INBOUND**. However, transport direction was not carried into the call state/effective prompt, so “ஏன் phone பண்ணியிருக்கீங்க?” got a generic reception answer. This was not proof the SIP call was classified as outbound.
- No separate outbound prompt had been saved. The user subsequently selected **existing enquiry/appointment follow-up** as its purpose.
- The existing success-claim speech guard missed Tamil past-tense forms such as “appointment ஏற்பாடு செய்துள்ளேன்” and “புக் செய்து விட்டோம்”. These are now covered without changing the action architecture.

**Exact changes**

| File | Change |
| --- | --- |
| `callstate.py` | Preserve approved email/pending status on unchanged values; suppress rearming an approved email; reject unsupported replacement/restoration without current address/spelling evidence; clarify confirm vs update vs question; retain runtime call direction in existing per-call state. |
| `tools.py` | An unchanged email update no longer queues an automatic read-back. Existing `update_call_details` explicitly distinguishes read-back approval from a new value. In read-only mode, recorded approval gets a short truthful acknowledgement rather than another model round that can invent a send/booking. |
| `contact_corrections.py` | Normalize domain punctuation without joining a preceding sentence's full stop into the local part. |
| `prompts.py`, `agent.py` | Pass actual transport direction into prompt assembly/state; give explicit inbound/outbound semantics at the existing final phone-rules seam. No keyword classifier or extra AI layer was added. Completed email approval disables the old repeated-repair fallback. Build becomes `2026-11-03-email-direction-v12`. |
| `assistant_prompts.py` | The newly configured follow-up prompt gets an outbound follow-up opening. Inbound opening and unrelated assistants' greetings are preserved. |
| Assistant metadata | Save **only** `metadata.directionPrompts.outbound` for the selected assistant, using the user-approved follow-up purpose. Inbound prompt and other metadata verified unchanged. No credentials changed. |
| Existing speech guard | Add the two observed Tamil booking-success forms to verified-result checks. Ordinary streaming answers remain covered by existing regressions. |
| Verification/restart helpers | Add synthetic regression/replay evidence; distinguish worker root from SDK children; check occupied LiveKit rooms before graceful worker restart; record source hashes and fresh registration separately. |

**Verification: what actually passed and what did not**

| Requirement | Status | Proof / limit |
| --- | --- | --- |
| Unchanged-email tool update stops forcing the repeated question | **Work ஆகுது — local reproduction** | Regression was red before repair and green afterwards; actual tool/session `say` seam exercised. |
| Approved email remains approved, unrelated details preserved | **Work ஆகுது — local and bounded real-model cases** | Two natural Tamil approval variants resulted in `email_confirmed=yes`, `pending=null`; name/date/time/service unchanged. |
| Real STT→agent→TTS approval path | **Work ஆகுது — one synthetic sample** | Real Sarvam recognized “ம் சரியா இருக்கு அனுப்புங்க email அனுப்புங்க.”; configured LLM called `update_call_details` with `field=email`, `confirmed=true`; SDK state and generated answer audio captured. Customer audio was not uploaded. |
| Inbound why-did-you-call response | **Work ஆகுது — configured-model text sample** | After actual direction was pinned in state: “நான் ஜூலி, VIMS Enterprise இல் ஒரு ரிசெப்ஷனிஸ்ட். நீங்கள் எங்களுக்கு போன் செய்திருக்கிறீர்கள், உங்களுக்கு எப்படி உதவலாம்?” Phone/audio retest pending. |
| Outbound follow-up response quality | **Work ஆகலை in the last real-model sample; final prompt Test பண்ணலை** | Last tested draft still answered an appointment/intake line instead of clearly identifying the business and follow-up purpose. Removed inherited inbound intake instructions afterwards and saved a standalone follow-up prompt. The final revision was read back from DB but not sent to the model again. Do not count the saved prompt alone as a passed conversation. |
| Unsupported booking wording blocked | **Work ஆகுது — local streaming guard tests** | Both new past-tense phrases failed before and passed after; verified-action and ordinary-streaming regressions also pass. Not universal semantic coverage. |
| Existing architecture/regressions | **Work ஆகுது — local suite** | **835 passed, 1 skipped**, including state, booking, provider routing, language, preparation safety, interruptions, recordings and prompt/tool-schema budget checks. Test counts alone do not prove future call quality. |
| One-second meaningful voice | **Work ஆகலை / not established** | Synthetic approval took **4689.1 ms** from text submission to first generated PCM. This excludes live endpointing/SIP/handset playback. |
| Real v12 inbound/outbound phone result, interruption handset timing | **Test பண்ணலை** | No new phone call or customer message was initiated. Await user call. |

**Bounded real-model evidence**

- Actual configured model: OpenRouter `meta-llama/llama-3.3-70b-instruct`; no model switch. This task used **12/12 chat attempts**, across before/after variants, the newly specified outbound purpose and one synthetic-audio case. Prior repair budgets were not reset or increased. No further model calls were made after the final outbound prompt revision.
- Before-model sample did understand one approval (`confirmed=true`), but generated text falsely claimed booking/email success. The actual call shows other approvals taking the repeating tool branch. The repair does not claim the model failed every approval.
- After approval output: **“சரி, email உறுதிப்படுத்திக்கிட்டேன். இந்த test call-ல் email அனுப்ப முடியாது.”** This agrees with actual confirmed state and read-only action availability.
- Synthetic audio timings: batch STT **360.1 ms**; model/tool round **3565.3 ms**; text submission→first generated PCM **4689.1 ms**. First TTS input→first generated audio approximately **369 ms**. These are local pipeline measurements, not room or handset-audible response times. No generic status filler was added.
- Final function description was shortened to preserve the existing `<200` tool-schema token budget; detailed interpretation remains in the existing state directive. The final full regression suite passes that check.

**Effective runtime and readiness**

- Worker root PID **7061**, build **`2026-11-03-email-direction-v12`**, LiveKit SDK **1.8.4**.
- Fresh registration **`AW_7uWnx9brdhc3`**, India South, **17:54:36 IST**. Worker becomes available after prewarm; final root health 200, load approximately 0.019. Startup prewarm logged temporary event-loop/load warnings; availability recovered before readiness was reported.
- Dashboard `http://localhost:3000/login`, backend `http://localhost:8000/health`, worker `http://localhost:8081/worker`: **200**. Only the worker was restarted. Selected assistant mapping is verified in DB; its v12 per-call load event will be available when the user calls.
- Sole active number remains **+91 8065481576** / **08065481576** for inbound and outbound. Same SIP trunks/dispatch, Sarvam STT/TTS, BYOK, recordings, language lock and selected assistant preserved.
- Effective session reconstruction with worker overrides: dynamic endpointing **850–3000 ms**, preemptive generation **true**, preemptive TTS **false**, interruption minimum **500 ms**, Sarvam buffer **30**, max chunk **100**. Pause protection was not reduced. Useful-text timeout **4.5 s**, stream-idle timeout **4.0 s**.
- **Read-only business-action mode remains true.** Real SIP/STT/LLM/TTS run, but this call mode cannot book, change calendars, send email/SMS or perform external business writes. Logging/recordings remain enabled. No call/message, commit, push, deployment or credential rotation was performed.

**Next inbound test**

Call **08065481576**. Ask why the agent called; it should politely explain the inbound direction. Give a synthetic email, approve its read-back naturally (“சரிதான், அதுக்கே அனுப்புங்க”), then ask about the existing issue. Check that it does not request email approval again or claim it actually sent mail in this test mode. Recording/log correlation and handset timing for that new call remain pending.

**Artifacts**

- [Call trace extraction and recording metadata](output/verify/email-loop-call-analysis.json) — local personal speech; avoid sharing unredacted.
- [Local regression suite](output/verify/email-direction-v12-verified-tests.log)
- [Before configured-model samples](output/verify/email-loop-model-before.json), [initial after samples](output/verify/email-loop-model-after.json), [direction correction samples](output/verify/email-loop-model-direction-final.json), [last configured samples](output/verify/email-loop-model-final-configured.json)
- [Request budget](output/verify/email-loop-request-budget.json), [synthetic audio verification](output/verify/email-loop-audio-verification.json), [generated answer WAV](output/verify/email-loop-synthetic-answer.wav)
- [Outbound configuration read-back](output/verify/email-loop-outbound-config.json); private inbound/metadata backup kept locally in `output/verify/email-loop-prompt-backup.json`.
- [Runtime audit](output/verify/email-direction-v12-runtime.json), [restart/source hashes](output/verify/email-direction-v12-restart.json), [worker registration log](output/verify/email-direction-v12-worker.log), [number/environment readiness](output/verify/email-direction-v12-number-readiness.json), [localhost health](output/verify/email-direction-v12-local-health.json).
