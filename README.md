# JillJill Voice

Inbound, outbound and browser voice assistants built with **LiveKit Agents 1.8.4**, **Next.js 16 / React 19**, FastAPI and Postgres. Each assistant owns its saved identity, prompt, knowledge, voice engine, model, voice and call controls. Gemini Live audio and the existing cascaded STT → LLM → TTS path share the same call lifecycle and business tools. Gemini phone calls can use the explicitly enabled Sarvam text-input mode described below; its STT is metered separately, while Gemini still produces the saved voice.

## Contact confirmation and booking continuation (12 November 2026, v54)

Email capture and readback now share complete-address normalization; explicit phonetic examples, same-turn spelling and unique letter corrections retain the caller's existing details. Name correction no longer derives a name from an email username. Confirmed email resumes the current request, while unresolved names/recipients remain blocked from booking. Models, voices and the existing call architecture are unchanged.

**1,183 backend tests passed, 1 skipped**. One authorized **11.703-second Gemini 3.1 Flash Live / Despina** synthetic text session retained the name, corrected an email letter and accepted one approval without SDK errors. Mocked booking/email tests verify exactly one action to the corrected lowercase recipient. The original worker was reloaded on build `2026-11-12-contact-confirmation-continuation-v54`. Real SMTP authentication still returns **535**, so actual inbox delivery and a new handset booking remain unverified. [Diagnosis, evidence and remaining acceptance](docs/reports/v54-contact-confirmation-continuation.md).

## Editor viewport and Privacy overlap repair (12 November 2026, v53)

The editor now fits its measured visible viewport, including scaled desktop layouts, so card bottoms and the System Prompt footer remain visible. Privacy messages edit within their own row instead of covering forwarding; compact Knowledge headers leave more content space. The prompt dialog keeps its Done button in a reserved footer. Saved configuration and the voice backend are unchanged. [Reproduction and changes](docs/reports/v53-editor-viewport-privacy.md).

## Assistant editor spacing follow-up (12 November 2026, v52)

Voice/Speech now align above compact Privacy and forwarding rows, with Knowledge filling the area below. The editor uses its actual header height and available width, greetings fit their text, and the full System Prompt can be scrolled or expanded. Inbound/Outbound/Demo/All calls are visible options again. Saved assistant configuration and the voice backend are unchanged. [UI changes and browser verification](docs/reports/v52-assistant-layout-followup.md).

## Dashboard layout and Gemini provenance (12 November 2026, v51)

The assistant editor now groups compact controls above a wider Knowledge panel, with a single desktop viewport and a mobile layout that keeps all settings reachable. Overview retains the daily spend graph without its repeated table; Call history owns the full list, while Demo shows its latest result and links to that history. A read-only runtime audit traced Gemini to the worker's server key matching `voice-service/.env`, ending `cYpA`, at Google's direct Gemini API endpoint. The owning Google project and actual credit deductions remain unverified; dashboard costs are usage/rate estimates. [Changes, provenance, validation and limits](docs/reports/v51-dashboard-layout-billing-origin.md).

## Gemini 2.5 phone spelling and reply recovery (12 November 2026, v50)

The latest supplied call used Gemini 2.5 Native / Despina for output and the existing Sarvam phone STT for input. A spelling request was heard as billing; a blocked booking was spoken as successful; interruption was followed by repeated reply timeouts. Phone-only fixes now serialize append-only context, coalesce overlapping hooks without losing words, finish completed generation channels, give exact spelling-turn guidance with tool execution rejected, clarify isolated billing ambiguity once, distinguish blocked task completion from booking receipts, and wait for pending caller context before the first reply trigger. Saved models/voices, business prompts, call routing and integrations remain unchanged.

Validation: **1,156 backend tests passed, 1 skipped**, with scoped lint/whitespace checks and authenticated Playwright recording/log-route checks. Three approved 20-second caller excerpts were transcribed once each. One approved 21.644-second Gemini 2.5 synthetic session recovered after interruption and read the corrected test address, but also logged one reply timeout and one harness callback exception. The startup ordering defect was then reproduced/fixed offline; the final guard was not paid-live-retested. The original worker is on build `2026-11-12-phone-native-spelling-recovery-v50`. No new phone call, booking or email was initiated. [Evidence, changes and validation limits](docs/reports/v50-gemini25-phone-spelling.md).

## Recording timeline and email spelling repair (12 November 2026, v49)

The supplied phone call exposed overlapping same-speaker recording frames, an unheard generated tail in interrupted audio, and shutdown silence appended to the file. Local recording now preserves sequential PCM and uses LiveKit room-playback progress for Gemini audio, discarding unplayed tails and freezing the recording boundary at hangup. The supplied original carrier WAV was linked as a byte-for-byte recovery of that one call; its damaged original remains preserved. Billable duration and cost records were not changed.

Email collection now handles separately spoken domains, ASR sentence punctuation inside spelled chunks, explicit spelling offers, disputed-position corrections followed by full respelling, and requests to hear spelling. Partial replacement memory no longer exposes the old candidate as a usable address. Canonical lowercase recipients and complete-readback approval remain required; uncertain ASR letters still need clarification. Saved model/voice, phone-input architecture and business prompts remain unchanged.

Validation: **1,146 backend tests passed, 1 skipped**; scoped lint and whitespace checks passed. Playwright CLI verified restored recording metadata, two-channel WAV decoding, seekable HTTP 206 ranges, muted playback and pause. Five approved 25-second caller excerpts were transcribed once each; no new call, booking, email or Gemini audio generation was initiated. The original local worker is running build `2026-11-12-recording-email-turns-v49`. [Evidence, changes and acceptance check](docs/reports/v49-recording-email-repair.md).

## Global theme, daily spending and Live models (12 November 2026, v48)

Theme controls now share a persistent preference across routes, reloads and tabs. Cost views show each call's priced total and average per minute (`subtotal × 60 / actual seconds`) using the existing global USD/INR choice; incomplete charges remain labelled. The Overview call-type section includes a daily Demo/Inbound/Outbound graph grouped by India calendar date. Light/dark surfaces, chart categories, native controls and gauge tracks use theme-appropriate tokens.

Assistant Live models come from a cached, read-only Google account listing instead of a two-name dropdown. The current key lists eight streaming models: six conversational candidates and two visible, disabled transcription/translation workflows. Saved selections stay unchanged. Billing uses the server `GOOGLE_API_KEY` matching `voice-service/.env`; the associated project's credits/invoice are viewed in Google AI Studio, not inferred from estimated call totals. No audio engine, voice, prompt, booking flow or database schema was replaced. [Scope, model list, evidence and limitations](docs/reports/v48-theme-spend-models.md).

Validation: **1,133 backend tests passed, 1 skipped; 37 dashboard tests passed**; TypeScript and scoped ESLint passed. Playwright CLI verified theme navigation/reload, global INR costs, all eight listed model choices with capability fences, unsaved selection preservation and desktop/mobile layouts. Build `2026-11-12-theme-spend-model-catalog-v48` is loaded in the original local worker. No new paid voice test, real booking or email was initiated.

## Fragmented phone email and memory repair (12 November 2026, v47)

The latest ten-minute phone call exposed local-part truncation across speech chunks, approval without a complete spoken email readback, unsupported model recipient replacements, and reply-before-memory timing. Active email capture now retains literal chunks; native approval requires the actual complete readback; phone replies await the current compact memory. Contact repair preserves the existing appointment instead of creating another booking at a different time. Model, voice, STT/audio transport and database schema remain unchanged.

**1,130 backend tests passed, 1 skipped**, including real installed-SDK protocol tests with mocked providers. Five authorized 25-second caller excerpts were transcribed once each; no new real call, booking or outgoing email was started. The recorded call actually created two appointments, and both confirmation attempts failed with Amazon SES SMTP **535**. Correct the ap-south-1 SES SMTP credentials in Settings → Integrations, then verify one deliberate phone booking and inbox delivery. [Evidence, fixes and acceptance steps](docs/reports/v47-fragmented-email-memory.md).

Build `2026-11-12-fragmented-email-memory-v47` is loaded in the original local WSL worker and registered with LiveKit; worker/API/dashboard health checks returned HTTP 200. No production deployment or Git push was performed for this repair.

## Email approval and spoken details (12 November 2026, v46)

The latest supplied call stored canonical lowercase email candidates correctly, but rejected the caller's “Correct super” approval. Both booking attempts were blocked, so no appointment or confirmation-email task was created. That exact approval now succeeds without accepting questions or refusals. Email readback no longer inserts commas; SMTP accepts only a single canonical address. English date/time readbacks and double/triple phone-digit grouping are presentation hints only and preserve the actual booking/contact values. Appointment Booker's saved greeting now uses the full **Vims Enterprises** business identity.

The effective SMTP credentials still fail authentication with **535**. Fix and save them in Settings → Integrations before testing inbox delivery. **1,115 backend tests passed, 1 skipped**; scoped Python lint passed. Build `2026-11-12-email-spoken-details-v46` was reloaded in the original idle WSL worker and registered with LiveKit; worker/API/dashboard health checks returned HTTP 200. No old booking was recreated and no email or paid voice test was sent. Models, voices and the existing call architecture were preserved. [Findings, changes and acceptance steps](docs/reports/v46-email-readback.md).

## IVR destinations and LiveKit task review (12 November 2026, v45)

The IVR assistant now has four enabled, user-specified destinations: Software (Tamil), Sales & Marketing (Tamil), Content (Tamil), and Other (Tamil / English). Only that assistant's forwarding rows were changed; prompts, metadata, model, voice and inbound number assignment were preserved. The existing inbound number remains assigned to Appointment Booker. Select IVR Assistant in Phone Numbers before a deliberate real IVR test; selecting it in browser Demo does not reassign a phone number.

Phone transfer blocks a destination matching the current caller, including Indian national/E.164 forms. Demo rehearsal reads saved team labels and category IDs but never dials the saved numbers; assistants without destinations retain explicitly labelled demo fixtures. Explicit spoken `dot`, `underscore`, `dash`, `hyphen`, `plus` and digit spelling retain the complete email local part and lowercase normalization.

`GetNameTask` and `GetEmailTask` are already installed in LiveKit Agents 1.8.4. They were instantiated and inspected offline, **not enabled as native Gemini session handoffs**: the installed Google plugin advertises `manual_function_calls=False` and `mutable_tools=False`, changing tools marks a reconnect, and plain tasks lack the existing phone text-input/recording hooks. Enabling that handoff without an adapter and an approved real audio test could regress the working call. Existing contact guards remain active. No new dependency, provider or model was added. [Task findings and test steps](docs/reports/v45-ivr-livekit-tasks.md).

Validation: **1,089 backend tests passed, 1 skipped**; TypeScript, changed Demo UI ESLint and new-test/undefined-name Python lint passed. Saved destinations were verified through the actual resolver and authenticated Playwright settings UI. Build `2026-11-12-ivr-contact-safety-v45` was reloaded in the existing WSL worker after checking there were no live rooms. No real transfer, booking, email or paid model session was initiated for v45. This supersedes v44's earlier observation that IVR had no destinations.

## Contact and booking repair (12 November 2026, v44)

An analysed 471-second inbound call reached the booking tool four times but never reached calendar submission: email/name correction state kept approval unresolved. No appointment or confirmation email was created, despite a spoken success claim. v44 normalizes email case before comparison, accepts clear Tamil/Tanglish readback approval, preserves complete spoken letters/numbers and explicit short-name corrections, and restores email confirmation after a name repair. Unapproved email guesses are no longer exported to Contacts.

Production booking results now carry verified receipts; a blocked booking becomes an SDK tool error with `native_tool_result.status=not_confirmed`. A provider-held booking with pending local sync remains distinct. Cal.com requests include the configured required title. Booking email delivery reads saved SMTP overrides, rechecks recipient approval after that lookup, and retains queued/sent/failed tracking. Shutdown notifications do not send a second confirmation email.

Configure **Settings → Integrations → SMTP host / port / username / password / sender**. Saved mail overrides take effect on the next delivery without restarting the worker. Passwords stay masked. The read-only provider check found Cal.com account/event-type access working, but the environment SMTP credentials were rejected; updating credentials and completing a real inbound booking/inbox check remain necessary. SMTP acceptance alone does not prove inbox delivery.

The IVR assistant has a **Test transfer** link to its selected browser Demo. Its expandable instructions list sandbox routes, and simulated handoffs produce `demo_transfer_simulated` logs. No human is called or connected. Real IVR forwarding still requires approved saved destinations; none were configured for the audited IVR assistant.

Validation: **1,080 backend tests passed, 1 skipped; 31 dashboard tests passed; TypeScript and scoped frontend ESLint passed.** Tests mock calendar, database and email writes. Playwright CLI checked authenticated call/Contacts/settings pages and the IVR link, idle state, help, desktop and mobile layout. The local worker was reloaded with build `2026-11-12-contact-booking-repair-v44` and registered with LiveKit; local API and dashboard returned HTTP 200. No new real call, booking, email or paid Gemini session was run for v44. [Detailed findings and feature status](docs/reports/v44-contact-booking-audit.md).

## Current assistant runtime

The verified local worker runs in WSL/Linux with Python 3.14.4. Dashboard and FastAPI run on Windows; reuse the original WSL worker instead of starting a duplicate Windows worker. `voice-service/requirements.txt` pins the runtime libraries and `requirements.lock.txt` records the existing environment. Docker and CI still specify Python 3.11; validate those environments separately before production rollout.

```text
Browser Demo                         Inbound / outbound phone
  selected assistant ID               number assignment / dispatch metadata
          |                                      |
Next.js authenticated proxy              LiveKit Cloud + Vobiz SIP
          |                                      |
FastAPI dispatch + server-minted token -----------+
                                                 |
                                  Existing LiveKit voice worker
                                                 |
                       saved assistant + prompt + knowledge + controls
                                                 |
                       +-------------------------+----------------+
                       |                                          |
               Gemini Live audio output                 existing STT / LLM / TTS
           (native audio or phone STT text)
                       |                                          |
                       +------------ CallState + tools -----------+
                                                 |
                     calendar / contact memory / approved human destinations
                                                 |
                     Postgres calls, transcripts, usage receipts, live logs
                     local stereo WAV (R2/carrier recording readers retained)
```

- **Demo selection:** the assistant ID is validated against the authenticated organization before dispatch. Its saved prompt, voice and knowledge are used. Browser booking, transfer and message tools remain simulated. Gemini demos wait for microphone audio before opening the paid session and have a 180-second cap.
- **Phone selection:** inbound uses the number's assigned assistant; outbound dispatch/campaign metadata selects its assistant. Demo selection does not reassign a phone number. Real calls obey saved limits and the operator's read-only setting.
- **Prompt and knowledge:** saved business instructions remain first. Direction, current IST time, assistant-scoped knowledge and speech-reference style supplement them. Role presets cover receptionist, support, sales, outreach, appointment booking, academy, clinic and conversational IVR. Sample catalogs are labelled examples, never verified business offerings.
- **Memory and consent:** understood details, corrections, refusals and tool receipts remain in per-call state. A model state update cannot turn a refusal into booking permission. Known details should not be collected repeatedly. Booking/email/transfer claims require matching successful tool results. Interrupting speech does not authorize repeating a committed action.
- **IVR:** callers describe the person/team and language they need without a keypad menu. The tool selects an enabled saved destination. Dummy doctor/team/language examples do not create real forwarding numbers; configure approved destinations before a real transfer test.
- **Speech and intelligence:** everyday Tamil/Tanglish, clear word boundaries, concise answers and appropriate warmth guide delivery. Local policy tracks context, emotion cues, recovery, correction, quality and outcomes. Instructions do not guarantee recognition or a particular accent. Knowledge recordings provide reviewed style guidance after provider analysis; they do not clone a speaker. Existing previews play only on a user click.

## Audio continuity and cost controls (v40)

Recent demo logs identified SDK subtitle speaking-rate FFT work blocking the audio event loop for 167–1,013 ms. Both Gemini browser and phone entrypoints now use `GeminiRuntime.start` with `sync_transcription=False`. Audio and transcripts remain enabled; text arrives without estimated word-by-word audio timing. This avoids that measured CPU path without replacing the saved model/voice or adding a playback delay. Transcript timing is not proof of the last word heard during an interruption.

Recoverable SDK errors retain the browser session during the existing bounded recovery policy; terminal errors still end it. Saved LOW/MEDIUM/HIGH end-of-speech sensitivity maps to 650/450/250 ms minimum endpoint silence, respecting larger saved pauses. This controls turn boundaries rather than model generation speed.

The saved prompt stays in initial setup. Tool replies append compact memory, including booking holds, corrections and receipts, instead of long repeated procedural text. Context compression now triggers at 8,192 tokens with a 4,096-token target (previously 16,000 / 8,000). The provider controls exact retention; durable application facts remain available. Memory sync is deferred while thinking or playing. These changes reduce avoidable input overhead, not establish a flat tariff or guarantee recall of arbitrary old conversation.

The v40 native wrapper uses 282 words instead of 465 in browser setup, preserving operator-authored saved prompts verbatim. Complete memory snapshots omit empty/default fields: an initial Tamil snapshot is 72 characters instead of 472. Setup explicitly defines absent fields as reset, not inherited; populated contacts, corrections, consent holds and verified receipts remain intact. These are measured payload-size reductions, **not measured percentages of billed savings**. Model, voice, tool schemas, compression thresholds and the v39 audio continuity policy are retained. No new paid audio comparison was run for v40.

### Phone listening and transcript corrections (v41)

An 84.16-second carrier recording showed a real recognition mismatch: the caller asked in Tamil what assistance was available, while Gemini's input transcript contained an unrelated Spanish sentence and the answer assumed a strategy appointment. With permission, a four-segment Sarvam comparison recognized the first question in Tamil; a very short last fragment remained uncertain. This is evidence of a mismatch, not a perfect reference transcript of the entire call.

Gemini demo and phone language hints now derive from the saved greeting's native script before the legacy STT language. A Tamil greeting no longer starts with an English application-memory hint merely because a former STT setting says English. This seeds the conversation, rather than forcing a response-language API parameter or disabling caller language changes. The phone wrapper explicitly prioritizes current caller questions over historical notes, treats carrier announcements as non-requests, and asks for clarification instead of inferring booking intent from the assistant role.

Shared native transcript sanitation excludes internal application snapshots and carrier announcements from both demo artifacts and phone persistence; user quotations of application labels remain user speech. Existing historical transcripts are preserved. Agent noise-filter logs now distinguish their scope from upstream trunk processing. The current inbound trunk already has Krisp enabled; the agent's explicit disable override is retained to avoid stacking filters. Paid voice isolation has not been enabled. Real handset recognition/playback must be checked after reload; offline checks cannot certify carrier quality.

### Authorized phone input mode (v43 protocol repair)

After the listening-policy fix, one authorized 45-second direct Gemini replay of the first 24 seconds of caller audio still produced an unrelated Korean input transcription and assumed a booking. It did **not** validate the phone fix. The user then explicitly authorized phone-only Sarvam input while retaining the Gemini model/voice and browser native audio.

Set `GEMINI_PHONE_INPUT=sarvam` in the voice-service environment to enable this mode for Gemini inbound/outbound calls. The repository example defaults to `native` for existing installations; this local installation is explicitly set to `sarvam`. The factory resolves the configured organization/server Sarvam credential, uses `saaras:v4` with `codemix` and 16 kHz streaming, and fails visibly if the credential/configuration is missing. It never silently falls back to the failing recognition path. Browser demos continue to use native Gemini input and output.

`phone_text_input.py` adapts the installed LiveKit Google realtime session: caller PCM forwarding and audio commits are suppressed and Google automatic input VAD/transcription is disabled. The phone agent explicitly submits each recognized STT message through `generate_reply(user_input=...)` inside `on_user_turn_completed`, then raises `StopResponse` to suppress the SDK's empty automatic reply. This is necessary because installed Agents 1.8.4 discards external STT text for realtime models after that hook. Recreated user message IDs are reconciled so one utterance updates call memory once; genuinely repeated utterances remain separate turns.

The text adapter also suppresses audio `ActivityStart` notifications. Without this, a local VAD interruption opens an empty audio activity, and the next reply emits `ActivityEnd` despite sending no caller audio. The v42 phone call closed with `1007 / Precondition check failed` after its first recognized turn. The SDK's generic “context exhausted” label did not establish context exhaustion. Local playback still stops on barge-in; the next client-content turn interrupts remaining server generation. Existing tools, their verified outcomes, recording and native output voice remain in use. Carrier announcements are stopped before generation. Sarvam receives phone audio; Google receives its transcript and normal business context. Emotion in this mode is inferred principally from words, not incoming vocal prosody. [LiveKit hybrid-input issue](https://github.com/livekit/agents/issues/5408), [Google client-content contract](https://googleapis.github.io/js-genai/release_docs/interfaces/types.LiveClientContent.html).

Phone text-input RoomIO now requests **16 kHz / 10 ms** frames: this matches Sarvam and the SDK gain-control processor's documented 10 ms contract, replacing its 24 kHz / 50 ms defaults for this path only. The failed call also had a separate native `liblivekit_ffi.so` SIGSEGV before greeting and was redispatched about 21 seconds later. Isolated resampling, concurrent cold-start and AGC probes did not reproduce that crash; the frame correction is not proof that its native root cause is eliminated. Worker children now enable fault stacks to capture the processing call if it recurs. Trunk noise processing, agent BVC override, demo media settings and carrier routing remain as configured.

STT duration is measured from audio frames forwarded to the STT node, not room lifetime; its source is saved as `voiceUsage.speechInput.source=forwarded_audio_frames`. Native call rate receipts also freeze the available Sarvam rate. Cost calculation includes this STT line once, with no extra TTS line or duplicate microphone stream to Gemini. Official Sarvam PAYG pricing checked 11 November 2026 is **₹0.49/minute**; the missing `saaras:v4` rate was added as a list estimate in USD using the app's FX feed, preserving all existing rate rows. Account discounts, taxes and actual invoices still require reconciliation. Gemini's retained generated-audio context can still incur input usage; this mode does not guarantee zero audio-input tokens or a fixed overall rupee/minute saving. [Sarvam pricing](https://www.sarvam.ai/api-pricing).

To roll back, set `GEMINI_PHONE_INPUT=native` and reload the single worker only when idle. Changes do not alter phone number assignment, assistant records or booking configuration. An authorized single synthetic Gemini session completed three text turns with audio and no 1007 failure; text-commit-to-first-audio measured 727–856 ms. It did not include live STT or carrier delay. It also exposed unnecessary appointment follow-ups; the platform wrapper was subsequently corrected to ask only details needed for the current request. This prompt change has offline coverage, not another paid conversational acceptance test. New logs distinguish client-VAD boundaries from native model turn proxies and expose `phone_text_turn_committed` / `phone_text_to_first_audio`; the latter explicitly excludes STT and carrier playback. An end-to-end handset call, including recognition, interruptions, startup and actual booking, remains the final acceptance check. Do not infer perfect phone fluency or a production-readiness guarantee from offline tests.

### Call cost calculation

The known model subtotal is the sum of each provider-reported audio/text input/output token count, divided by one million, multiplied by that modality's stored rate. Standard list rates checked 11 November 2026 for `gemini-3.1-flash-live-preview` are text input **$0.75/M**, audio input **$3/M**, text output **$4.50/M**, audio output **$12/M**. [Official pricing](https://aistudio.google.com/docs/pricing#gemini-3.8-live).

Input conversation history can be billed again on later responses, so audio seconds alone do not predict the total. Repeated metrics for one request replace its receipt; different generations accumulate. Native rate snapshots preserve available call-time rates. Demo shows each call's total separately from its average per minute; spending also splits Demo / Inbound / Outbound. Browser demos receive no carrier or additional native STT/TTS charge. USD is the accounting basis; the shared INR preference uses the displayed exchange-rate source throughout the app.

Unclassified tokens, cached usage without a reconciled tariff, missing media/storage rates, tax, credits and discounts prevent an exact invoice total. Missing usage is marked incomplete. Historical evidence is not rewritten to create apparent savings. Compare matched conversations and the provider billing export before claiming a reduction. ZenVoice's public calculator showed ₹4.25/minute on 11 November 2026 and notes variable telephony/voice requirements; its private costs, contracts and margins have not been verified. [Public calculator](https://voice.zenxai.io/#price).

The reported 148-second IVR demo has a known Gemini subtotal of $0.127026: audio input $0.059469, text input $0.039657, audio output $0.027900. At the UI's ₹93.955805/USD this is ₹11.9348 total, averaging ₹4.84/minute. These counts include repeated conversation context across model generations; they are not raw microphone seconds. Its 6,336 unclassified tokens and unpriced LiveKit/storage usage remain excluded. New recordings currently use local stereo WAV files, without a per-call cloud-recording export API; disk/host capacity still costs money. For inbound, reconcile the actual SIP tariff, LiveKit account plan and hosting/storage bill separately. A missing rate is not a zero rate. Do not change stored unit prices or hide items to manufacture a budget target.

### Demo and inbound acceptance

1. Verify dashboard `/login`, API `/health`, and the worker's build marker **and cloud registration**. Check Windows and WSL for duplicates; a listening port alone is insufficient.
2. In Demo, select an assistant and start the call yourself. Check its business identity, answers, a correction, refusal, interruption and previously answered details. Actions here are simulated.
3. End the demo and inspect its own **View logs / Cost breakdown** and recording. Look for event-loop blocks, recovery, unexpected interruptions and early termination. Room timing alone does not prove a useful audible answer.
4. For a real inbound booking, first verify number assignment, calendar configuration and time zone. Supply the required details and agree to the readback; verify the resulting appointment in Calendar/Calls and the calendar integration, not only a spoken claim.
5. Real forwarding, outbound campaigns, messages and bookings create external effects. Use approved test destinations deliberately. Passing unit/navigation checks does not constitute a real phone or booking test.

After worker-code changes, reload only the existing worker when no active rooms/calls or running campaigns would be interrupted. `agent.py start` does not hot-reload. Keep `.env`, server credentials and participant tokens private. Preserve assistant records and number assignments.

Latest phone evidence: `voice-service/output/verify/v42-phone-quality-report.txt`; cost evidence: `voice-service/output/verify/v40-cost-optimization-report.txt`; prior audio/readiness evidence: `voice-service/output/verify/v39-production-readiness-report.txt` (ignored local artifacts). They separate measured payload reductions and successful checks from unperformed handset and deployment checks. No deployment or Git push is automatic.

## Architecture

```
                    Internet (HTTPS)
                          │
                          ▼
        ┌───────────────────────────────────┐
        │  VPS (KVM, self-hosted via Docker) │
        │                                    │
        │   Caddy ── auto-HTTPS reverse proxy│
        │     ├─ ${APP_HOSTNAME}   →┐        │
        │     └─ ${VOICE_HOSTNAME}  →┤        │
        │                            │        │
        │   ┌──────────────────┐  ┌──▼──────────────────┐
        │   │ dashboard         │  │ voice-service        │
        │   │ Next.js 16        │  │ Python worker        │
        │   │ • App Router      │  │ • LiveKit worker     │
        │   │ • Prisma 6        │  │ • FastAPI server     │
        │   │ • Demo widget     │  │   ├─ /api/dispatch/* │
        │   │ • SSE log viewer  │  │   ├─ /api/demo/token │
        │   └────────┬──────────┘  │   ├─ /api/campaigns/*│
        │            │              │   ├─ /api/logs/stream│
        │            │ HTTP+Bearer  │   ├─ /api/webhook/livekit
        │            └─────────────▶│   └─ /metrics        │
        │                            └──────────────────────┘
        └────────────┬─────────────────────────┘
                     │ asyncpg + Prisma
                     ▼
              Neon Postgres (managed, off-VPS)
                     │
                     ▼
           LiveKit Cloud + Vobiz SIP

DNS: Vercel (or any registrar) — A records → VPS IP. Vercel is NOT used for hosting.
```

The dashboard reads NeonDB directly via Prisma. **All call dispatches go through the voice-service REST API** with `Authorization: Bearer ${VOICE_SERVICE_TOKEN}`. The browser never holds the LiveKit API secret — JWTs are minted by the voice-service and proxied by the Next API route. Inter-service traffic on the VPS uses the internal `web` Docker network; Caddy is the only container with public ports.

## Repo layout

```
.
├── voice-service/          # Python 3.11 LiveKit worker + FastAPI
│   ├── agent.py            # LiveKit worker entrypoint
│   ├── server.py           # FastAPI: dispatch / scheduler / SSE / webhook
│   ├── tools.py            # Guarded booking, transfer, contact and message tools
│   ├── gemini_live_runtime.py # Assistant-scoped native audio, memory and usage
│   ├── native_voice.py     # Saved engine/model/voice selection
│   ├── assistant_presets.py # Role prompts and conversation policies
│   ├── caller_consent.py   # Refusal and explicit call-ending guards
│   ├── voice_usage.py      # Demo ledger, evidence and rate snapshots
│   ├── recorder.py         # Local caller-left / agent-right stereo WAV
│   ├── db.py               # asyncpg pool + 30+ DB helpers
│   ├── prompts.py          # Saved-prompt assembly, identity, time and knowledge
│   ├── calendar_tools.py   # Cal.com + Google Calendar booking
│   ├── notify.py           # Telegram + WhatsApp + webhook delivery
│   ├── language_presets.py # 11 Indian-language presets
│   ├── observability.py    # Sentry + structlog + Prometheus
│   ├── config.py           # Static defaults
│   ├── sip/                # SIP trunk admin scripts
│   ├── configs/            # Per-client JSON overrides (default.json)
│   ├── tests/              # Offline regression tests; integration is opt-in
│   ├── requirements.txt
│   ├── Dockerfile          # Multi-stage build
│   ├── supervisord.conf    # Runs agent + uvicorn together
│   └── docker-compose.yml  # Local dev
│
├── dashboard/              # Next.js 16 + React 19 + Prisma 6
│   ├── app/(admin)/        # Sidebar layout: Overview / Assistants / Campaigns / Contacts / Calls / Live Logs / Demo / Settings
│   ├── app/api/{logs,demo}/proxy/  # Voice-service proxies (server-only)
│   ├── components/         # Sidebar, AssistantForm, CampaignForm, LiveLogs, DemoWidget, …
│   ├── lib/voice-service.ts# Typed REST client to voice-service
│   ├── lib/org.ts          # Default-organization helper
│   ├── lib/prisma.ts
│   └── prisma/schema.prisma# 22-model schema (campaigns, calls, assistants, contacts, …)
│
└── docs/superpowers/
    ├── specs/              # Architecture spec (2026-05-05-outboundai-build-design.md)
    └── plans/              # Implementation plans (Phases 0-9)
```

## Local development

### Existing Windows + WSL workstation

Check existing processes first. These are three separate services in this setup;
do not run an additional Linux API or Windows voice worker alongside them.

| Service | Directory/runtime | Command when it is not already running |
| --- | --- | --- |
| Dashboard | `dashboard`, Windows | `npm.cmd run dev -- --hostname 127.0.0.1 --port 3000` |
| API | `voice-service`, existing Windows venv | `.venv\Scripts\python.exe -X utf8 -m uvicorn server:app --host 127.0.0.1 --port 8000` |
| Worker | `voice-service`, original WSL venv | `/home/jilljill2023/venvs/jilljill-voice/bin/python -X utf8 agent.py start` |

The worker's WSL directory is the same checkout under `/mnt/c/Users/CT/Voice Agent/ai-voice-agent/voice-service`.
Keep dashboard `VOICE_SERVICE_URL=http://127.0.0.1:8000` in its private environment.
Use an existing managed worker's normal start mechanism and preserve its private
environment when reloading. The following installation examples are for a new
environment; never overwrite an existing private `.env` or reseed a working database.

### 1 · Voice service

```bash
cd voice-service
# New Linux/WSL environment only; reuse the existing worker venv if present.
python3.14 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env             # fill in NeonDB + LiveKit + provider keys
pytest -q                        # excludes real-DB integration by default
python agent.py start             # use the managed original worker when present
```

In a second terminal:

```bash
curl http://localhost:8000/health
```

### 2 · Dashboard

```bash
cd dashboard
cp .env.example .env.local
# fill in DATABASE_URL, VOICE_SERVICE_URL, VOICE_SERVICE_TOKEN
npm install
npx prisma generate
npx prisma migrate deploy        # applies migrations to NeonDB
npx prisma db seed               # seeds default org + agent profile
npm run dev                      # http://localhost:3000
```

The seed prints the default organization id; the same value is mirrored into the `settings.DEFAULT_ORG_ID` row so the voice-service can read it without a hardcoded constant.

## Deploying — single VPS via Docker Compose

The full stack runs on **one VPS** as three containers (`caddy`, `dashboard`, `voice-service`) orchestrated by `docker-compose.yml` at the repo root. Caddy terminates TLS with auto-issued Let's Encrypt certificates and reverse-proxies both subdomains. Vercel (or any other registrar) is used **only for DNS**.

**Step-by-step VPS deployment guide:** see [`deploy/README.md`](deploy/README.md).

In short:

```bash
# 1. SSH to your VPS (Ubuntu 22.04+)
curl -fsSL https://get.docker.com | sh
apt-get install -y docker-compose-plugin git

# 2. Clone + configure
git clone https://github.com/Vimal-Raj-003/ai-voice-agent.git /opt/outboundai
cd /opt/outboundai
cp .env.example .env       # fill in DATABASE_URL, LIVEKIT_*, GOOGLE_API_KEY, hostnames…

# 3. Point DNS A records ${APP_HOSTNAME} and ${VOICE_HOSTNAME} → VPS IP

# 4. Migrate + seed Neon (one-time)
docker compose run --rm --entrypoint sh dashboard \
  -c "npx prisma migrate deploy && npx prisma db seed"

# 5. Boot the stack
docker compose up -d --build
```

Caddy gets HTTPS certs automatically once DNS resolves. Verify with `curl https://voice.yourdomain.com/health`.

### Updates

```bash
cd /opt/outboundai && ./deploy/update.sh
```

Pulls latest `main`, rebuilds changed images, applies new Prisma migrations, rolls containers.

### Recordings

New worker recordings use `recorder.py` to write local stereo WAVs with caller audio on the left and agent audio on the right. Persist and protect the configured recordings directory on the worker/API host. Existing carrier/R2 recording lookup and playback paths remain available; historical files are not migrated automatically. Egress/R2 installations still require their own storage credentials. Browser demos attach their recording and redacted transcript to their own call row after finishing.

## Testing

```bash
# voice-service — unit (mocked pool)
cd voice-service && pytest -q
cd voice-service && python -m ruff check .

# voice-service — integration (real Postgres; opt-in)
cd voice-service && TEST_DATABASE_URL="postgres://..." pytest -m integration

# dashboard
cd dashboard && npx tsc --noEmit
cd dashboard && npm run build
```

Unit tests mock the asyncpg pool — fast, no network. Integration tests hit a real Postgres at `TEST_DATABASE_URL` (use a dedicated [Neon branch](https://neon.tech/docs/guides/branching)). They isolate themselves with a per-session test Organization and `+9999000…` phone-prefix cleanup, so they're safe to run against any DB you own. The integration suite is opt-in (registered as a marker and excluded from the default `pytest` invocation); `pytest -m integration` runs it explicitly.

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

- **voice-service** — `ruff check`, unit tests (mocked), and integration tests (real Neon DB)
- **dashboard** — `tsc --noEmit` and `npm run build`

To enable the integration leg, add a repo secret named `TEST_DATABASE_URL` (Settings → Secrets and variables → Actions) pointing at a dedicated Neon test branch — branching off `main` in the Neon console takes seconds and is free. Without the secret, the unit/lint/build legs still run and the integration step posts a skip warning. External-fork PRs never see secrets, so they skip cleanly too.

## Key features

- **Inbound + outbound** — single agent process handles both directions; trunk type drives the metadata.
- **Bulk dialing** — Campaigns model with CSV uploader; APScheduler runs DAILY/WEEKDAYS schedules in IST.
- **Demo widget** — browser-based call to the AI without a phone number; mints LiveKit JWTs server-side.
- **Live log stream** — SSE feed of `error_logs` rows, viewable in the dashboard.
- **Guarded business tools** — availability, booking, contact memory, approved human transfer, messaging and enabled calendar integrations; exposure follows the assistant and call mode.
- **Per-call config overrides** — drop a `voice-service/configs/<phone>.json` to override language preset, voice, model.
- **11 Indian language presets** — hinglish (default), hindi, english, tamil, telugu, gujarati, bengali, marathi, kannada, malayalam, multilingual.

## Status

Local validation on 11 November 2026: **1,024 backend tests passed, 1 skipped**, with offline tests guarded against real database connections; **30 dashboard tests passed**; TypeScript and scoped recording-route ESLint passed; isolated Next.js production compilation (webpack, placeholder credentials) passed. Playwright CLI audited 13 authenticated routes, assistant selection/search/preview, cost receipts/logs, INR and mobile overflow. Recording Range playback returned 206 with the requested bytes.

One explicitly approved 45-second synthetic Gemini 3.1 Flash Live test completed, with no provider error and no decoded-frame arrival gap above 100 ms (maximum 19 ms). Its 42-second provider-session receipt had a **$0.02699625 known model subtotal**, about **₹2.54 total / ₹3.62 per minute** at the checked display FX; 1,749 unclassified tokens and unmetered services mean this is not an invoice total. It is not a matched before/after savings benchmark. No real booking or telephone call was made. Docker/CI, load, real phone audio and provider invoice reconciliation require separate acceptance evidence; localhost checks do not certify them.

## License & credits

Authored as part of the Rapid X AI build. LiveKit, Next.js, Prisma, and all third-party SDKs retain their own licenses.
