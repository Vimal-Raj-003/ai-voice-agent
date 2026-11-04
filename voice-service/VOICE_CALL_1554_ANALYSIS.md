# 03 Nov 2026 — 3:54 PM recording: analysis only

> Historical v10 diagnosis. Latest November 4 audio diagnosis, actual-model comparison and v14 repair: [current repair report](VOICE_CALL_1014_REPAIR.md). Saved-page controls: [v13 report](ASSISTANT_PAGE_RUNTIME_REPORT.md). Email loop: [v12 report](EMAIL_DIRECTION_REPAIR_REPORT.md). This original analysis remains baseline evidence.

இந்த call-ல் **STT பிழை, தவறான conversation-state capture, context நினைவிழப்பு, model/tool ஒத்திசைவின்மை, response delay** ஆகியவை சேர்ந்திருக்கின்றன. “ஐயா” என்ற வார்த்தையை மாற்றுவது மட்டும் இவற்றைத் தீர்க்காது. இந்த ஆய்வில் application code, settings, credentials அல்லது running services மாற்றப்படவில்லை.

**ஆய்வு செய்த ஆதாரங்கள்**

- Attachment: `WhatsApp Audio 2026-11-03 at 3.54.21 PM.aac`; 499.712 seconds, mono, original 8 kHz.
- உங்கள் explicit அனுமதியுடன் existing Sarvam `saaras:v4`, `codemix`, language `unknown` மூலம் 22 batch segments transcribe செய்யப்பட்டன; 24 requests cap; upload/transcription errors: 0; புதிய LLM requests: 0. ஒவ்வொரு segment-மும் அதிகபட்சம் 24 seconds; 0.3-second overlap.
- Call ID: `7b52a9b7-8f7f-4962-afd1-43c6dc905227`; worker build `2026-11-03-silence-v10`; assistant `cmuv65lxx0013v7f4thzf2qtv`.
- Call window சுமார் **15:44:49–15:53:18 IST**, 03 Nov 2026. Primary: OpenRouter `meta-llama/llama-3.3-70b-instruct`; observed fallback: `meta-llama/llama-3.1-8b-instruct`.
- Role-attributed live transcripts, state/tool events, model failures, generated-audio and room-playback events ஆகியவற்றுடன் batch transcript ஒப்பிடப்பட்டது. Batch transcription-மும் தவறக்கூடும்; அது மனிதர் கேட்டுச் சரிபார்த்த verbatim transcript அல்ல. Speaker diarization / word timestamps இல்லை. கீழே audio ranges approximate segment windows; log times பொதுவாக அந்த transcript பதிவு முடிந்த நேரம்.

**கண்டுபிடிப்புகள்**

| பிரச்சனை | Recording / live-log ஆதாரம் | காரணம் அல்லது நிரூபிக்கப்பட்ட failing stage |
| --- | --- | --- |
| **Booking செய்யாதபோதும் செய்ததாகச் சொல்கிறது — மிக முக்கியம்** | Audio 71–95 s: “இப்ப book பண்ணாதீங்க; முதல்ல details மட்டும் பேசலாம்.” Audio 284–308 s / log 15:49:51: “நாளை மதியம் 12 மணிக்கு … appointment உறுதி செய்யப்பட்டுவிட்டது. … மின்னஞ்சல் அனுப்பப்படும்.” | Call read-only test mode-ல் இருந்தது. Exposed tools `end_call`, `update_call_details` மட்டும்; booking/email tools இல்லை. Post-call business callbacks skip ஆனதும் பதிவாகியுள்ளது. இது உண்மையான booking confirmation அல்ல; caller constraint மற்றும் actual tool capabilities-க்கு மாறான model claim. மேலும் caller திருத்திய Friday-க்கு பதிலாக “நாளை” என்று சொல்கிறது. |
| **பெயர் சரியாகப் பெறப்படவில்லை** | Audio 71–95 s / log 15:46:27: agent **“உங்கள் பெயர் என்ன?” என்று ஒருமுறை கேட்டுள்ளது**. அடுத்த பதில் “எனக்கு நாளைக்கு…”; 15:46:36 state-ல் `name=எனக்கு நாளைக்கு` என்று சேமிக்கப்பட்டது. | Pending name question-க்கு வந்த எந்த short statement-ஐயும் name என்று எடுத்துக்கொள்ளும் deterministic parser. அதே input-ஐ actual `CallState`-க்கு offline கொடுத்தும் இதே தவறு reproduce ஆனது. உண்மையான பெயர் கிடைக்கவில்லை; wrong value இருந்ததால் மீண்டும் கேட்காமலிருக்கும் existing rule-மும் recovery-ஐத் தடுக்கலாம். |
| **முன்னாடி சொன்ன website பிரச்சனை மறந்துவிடுகிறது** | Audio 24–71 s: existing e-commerce site maintenance, slow website. Live STT-யிலும் இந்த விவரம் சரியாக உள்ளது. Audio 308–356 s / 15:50:16: “நீங்கள் புதுசா website செய்ய வேண்டும் என்று சொன்னீங்க.” பின்னர் “என்ன பிரச்சனை … ஞாபகம் இல்லை” என்கிறது. | இது STT மட்டும் காரணமான failure அல்ல: correct text கிடைத்த பிறகும் history/model/state பாதையில் தவறுகிறது. Current parser-க்கு அந்த இரண்டு actual user turns கொடுத்த offline probe-ல் `entities={}`, `facts=0`; issue/“new website வேண்டாம்” constraint durable state-ல் capture ஆகவில்லை. History policy `MAX_HISTORY_ITEMS=12`; இந்த call window-ல் trimming entries உள்ளன. ஆனால் preemptive மற்றும் committed requests ஒவ்வொன்றுக்கும் சென்ற முழு prompt dump இல்லை; **history trimming ஒன்றே காரணம் என்று நிரூபிக்கப்படவில்லை**. |
| **“ஐயா” correction பின்பற்றப்படவில்லை** | Audio 379–403 s / 15:51:38: “ஐயான்னு கூப்பிடாதீங்க.” அடுத்த segment-லேயே “ஐயா…”; hospital பதிலிலும் மீண்டும். Live assistant transcript-ல் மொத்தம் 8 turns / 11 occurrences. | Caller address preference-ஐ persistent state-ல் பதிவு செய்யும் field/update path காணப்படவில்லை. Local slot updates name/email-ஐ வைத்தாலும் இந்த preference-ஐ வைத்திருக்கவில்லை. Model உடனடியான correction-ஐயும் தொடர்ச்சியாக மதிக்கவில்லை. இது caller male/female என்று கண்டறிந்ததற்கான ஆதாரம் அல்ல. |
| **நாள் / நேர correction தவறுகிறது** | Audio 118–142 s batch transcription: Friday, same 4 PM; பிறகு Friday **12 noon**, date மாற்றாமல் time மட்டும் மாற்றக் கோரிக்கை. Live STT: “நெல்லிக்காயில … ரெண்டு மணி…”; agent: **“மாலை 2 மணி”**. Caller மீண்டும் “மதியம் பன்னிரெண்டு” சொல்ல வேண்டியுள்ளது. | Live STT-ல் date/number recognition மற்றும் utterance fragmentation பிழை உள்ளது; model முரண்பட்ட நேரத்தை clarify செய்யாமல் ஏற்றுக்கொள்கிறது. பின்னர் spoken reply 12 noon ஆனாலும் actual date/time state update event இந்த extracted trace-ல் இல்லை. சரியாக state சேமித்தது எனச் சொல்ல முடியாது. Batch transcript-ஐ மட்டும் வைத்து exact intended date-ஐ database-ல் நிர்ணயிக்கக்கூடாது. |
| **Email spelling, stored value, spoken readback ஒத்துப்போகவில்லை** | Audio 213–284 s-ல் caller எழுத்துகளாக correction கொடுக்கிறார். Live parser ஒரு கட்டத்தில் local-part துண்டை இழந்து `[fragment]@gmail.com` என்று வைத்தது; spoken readback வேறு வடிவில் இருந்தது. 15:49:11-ல் tool email-ஐ confirmed செய்தது; actual caller “Correct ஆமா…” என்பது 15:49:31-ல் மட்டுமே. | STT letter/digit errors → partial-email parser capture → premature tool confirmation என்று ஒன்றுக்கு மேல் தோல்விகள். Caller spelling ambiguity தீராதபோது ஒரு focused clarification தேவை; guessed address-ஐ உறுதி செய்ததாக நடத்தக்கூடாது. Report-ல் personal email values redacted. |
| **Presence check-க்கும் தேவையில்லாத tool / greeting** | “ம் கேக்குதா?”, “Hello நான் பேசுறது கேக்குதா?” என்றபோது state tool error; பின்னர் agent மீண்டும் அறிமுகம் செய்கிறது. | Existing presence handler `Hello` / `கேக்குதா?`-க்கு பொருந்துகிறது; இந்த இரண்டு actual variants-க்கு பொருந்தவில்லை என்பதை actual regex-ல் offline உறுதி செய்தோம். அதனால் local presence path bypass ஆகி model-க்கு செல்கிறது. |
| **Invalid tool arguments** | 15:45:08 மற்றும் 15:52:49: `update_call_details` argument validation error. `confirmed` boolean-க்கு string `"null"` அனுப்பப்பட்டுள்ளது. | Model/schema boundary failure. அந்த tool calls execute ஆகவில்லை; அந்த attempts-ல் state மாற்றம் ஏற்பட்டதாகக் கருதக்கூடாது. Correction/confirmation interpretation மட்டும் அல்ல, tool argument correctness-மும் சரியாக இல்லை. |
| **Language drift** | Live STT “Okay-வா?” அருகில் Gujarati text; “எனக்கு இன்னைக்கு…” அருகில் Malayalam text. Persistent language `ta→en→ta`, பின்னர் `ta→ml→ta`. | Short code-mixed / misrecognized utterances-ஐ language state ஏற்றுக்கொள்கிறது. Single English correction-க்குப் பிறகு English apology வந்ததும் observable. Caller explicit language switch கேட்டார் என்பதற்கான ஆதாரம் இல்லை. |
| **உரையாடல் இயல்பாகத் தொடரவில்லை** | Audio 474–498 s: happy day பற்றி உரையாடிய பிறகு “அப்படியா! உங்களுக்கு என்ன வேணும்?” என்று intake-க்கு திரும்புகிறது. இதே மாதிரி repeated generic intake முன்னரும் வருகிறது. | Current topic-ஐத் தொடர்வதற்குப் பதிலாக booking/service workflow-க்கு model திரும்புகிறது. Literal text-ல் இந்த mismatch உறுதி; vocal warmth/emotion அல்லது perceived gender-ஐ transcript மட்டும் வைத்து மதிப்பிட்டதாகக் கூறவில்லை. |

Service பற்றி “எந்த service?” என்று மீண்டும் கேட்காதது மட்டும் இங்கே தவறு அல்ல. Caller ஏற்கனவே **existing website maintenance / speed issue** என்று கூறியுள்ளார். அதை சரியாக நினைவில் வைத்து பயன்படுத்த வேண்டுமே தவிர புதிதாக மீண்டும் கேட்பது தேவையில்லை. Name-க்கு நிலை வேறு: அது சரியாகக் கிடைக்கவே இல்லை.

**தாமதம்: இந்த call-ல் அளந்தவை**

Times below are milliseconds after the **SDK-estimated caller speech end**, correlated by caller turn ID. `First model text` என்பது first non-empty text event; அதன் semantic usefulness-ஐ event மட்டும் உறுதி செய்யாது. Room start என்பது அந்த response-ன் output playback event; handset-ல் முதல் meaningful word கேட்ட நேரத்துக்கு word-level measurement இல்லை.

| Caller turn / கேள்வி | Final STT | LLM request start | First model text | First TTS input | First generated audio | Room response start |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 — Existing website maintenance? | 798 | 1,071 | 2,303 | 2,632 | 3,627 | **3,632** |
| 5 — Slow website சரி செய்வீர்களா? | 760 | 925 | 2,385 | 3,014 | 4,556 | **4,558** |
| 30 — Company services? | 785 | 1,765 | 2,858 | 2,962 | 3,959 | **3,961** |

இந்த மூன்று responses-ன் text கேள்விக்குத் தொடர்புடையது. ஆனால் room response தொடங்கும் நேரமே 3.6–4.6 seconds; approximately 1-second target அடையவில்லை. Model first text-க்குப் பிறகும் generated audio வர **1.1–2.2 seconds** ஆகிறது. Slow-website turn-ல் text-release buffering சுமார் 0.63 s; TTS first input→first audio சுமார் 1.54 s. எனவே TTS மட்டும் அல்லது pause threshold மட்டும் காரணம் அல்ல.

Time-related turn 8-ல் room response **12.58 s**; correction turn 11-ல் **15.25 s**, அதுவும் தவறான “மாலை 2 மணி” பதில். இந்த call-ல் **4 primary timeout failures**, **3 completed fallback recoveries** பதிவாகியுள்ளன. இவை rate-limit failures என்று பதிவாகவில்லை. ஒரு SDK error `recoverable=False` என்றும் shutdown trigger என்றும் log ஆனாலும் அதன் பிறகும் call தொடர்ந்துள்ளது; அந்த marker-ஐ மட்டும் வைத்து worker முழுவதும் crash ஆனது என்று சொல்ல முடியாது.

Existing preemptive generation முற்றிலும் வேலை செய்யவில்லை என்பதும் சரியல்ல. Turn 5-ல் request start speech end+925 ms; turn commit+1,458 ms — generation **533 ms முன்பே** தொடங்கியுள்ளது. அந்த overlap இருந்தும் overall response தாமதம் உள்ளது. Multiple transcript fragments/speculative attempts உள்ள turns-க்கு பழைய first event-ஐ latest turn end-உடன் கழித்தால் negative / misleading timings வரும்; மேலே அத்தகைய turns பயன்படுத்தப்படவில்லை.

**Interruption: limited evidence**

Speech IDs பொருத்திப் பார்த்த மூன்று interruptions-ல் SDK-estimated caller onset→last published room audio **515 ms, 503 ms, 573 ms**. Caller-speech-state event-இலிருந்து அளந்தால் **226 ms, 213 ms, 284 ms**. இரண்டும் வேறு measurement boundaries. இவை room output frames; handset-ல் கடைசியாகக் கேட்ட agent audio எப்போது நின்றது என்பது verify செய்யப்படவில்லை. Queued generation அனைத்தும் எல்லா interruption-லும் discard ஆனது, thinking pause ஒருமுறையும் தவறாக interrupt ஆகவில்லை என்று இந்த samples மூலம் கூற முடியாது.

**எது வேலை செய்தது / எது செய்யவில்லை / எது அளக்கப்படவில்லை**

| பகுதி | நிலை | ஆதாரம் |
| --- | --- | --- |
| Inbound connection, STT→LLM→TTS அடிப்படை flow | Work ஆகுது — இந்த call அளவில் | இருபுற உரையாடலும் recording-மும் உள்ளன; greeting-க்குப் பிறகும் பல answers வந்துள்ளன. |
| சில company/service answers | Work ஆகுது — வரையறுக்கப்பட்ட அளவில் | Maintenance, company services, software-company/hospital distinction பதில்கள் தொடர்புடையவை. எல்லா KB entries-மும் tested அல்ல. |
| External business writes block | Work ஆகுது — இந்த call mode | Read-only exposed-tool list; post-call callback skip event. |
| Booking success உண்மையா பேசுவது | Work ஆகலை | Booking இல்லாமல் confirmation claim. |
| Name capture, context retention, title correction, time/email correction | Work ஆகலை | மேலே actual dialogue/state evidence. |
| சுமார் 1-second relevant voice response | Work ஆகலை — காட்டிய measured turns | Room response 3.63 / 4.56 / 3.96 s. |
| Interruption அனைத்துச் சூழல்களிலும் சரியா? | Test பண்ணலை — samples மட்டும் அளந்தோம் | மூன்று correlated room-frame measurements; full coverage இல்லை. |
| Handset-audible first useful word / last audible interruption audio | Test பண்ணலை | Attachment-க்கு verified word timing, diarization, room-to-handset clock alignment இல்லை. |
| Human-like prosody, gender identification, அனைத்து emotion scenarios | Test பண்ணலை | Text/log analysis இவற்றை நிரூபிக்காது. |

**பிறகு மாற்றும்போது முன்னுரிமை பெற வேண்டியவை — இப்போது implement செய்யவில்லை**

1. Verified tool result இல்லாமல் booking/email success பேசுவதைத் தடுக்க வேண்டும்; “இப்ப book பண்ணாதீங்க” போன்ற caller constraints நிலைத்திருக்க வேண்டும்.
2. Name question-க்கு time/date answer வந்தால் wrong slot-ல் save செய்யாமல், தெரிந்த time/date-ஐப் பாதுகாத்து name மட்டும் கேட்க வேண்டும். Existing website issue, negated requirements, address preference போன்ற context-ஐ existing per-call state-ல் வைத்திருக்க வேண்டும்.
3. STT time/letter corrections-ஐ ambiguity உடன் கையாள வேண்டும்; understood correction மட்டும் update செய்து, readback agreement பிறகே confirmed ஆக்க வேண்டும். Spoken readback current state-க்கு ஒத்திருக்க வேண்டும்.
4. Presence variants, short acknowledgements, language drift, forced state-tool calls மற்றும் invalid arguments ஆகியவற்றை actual failed turns வழியாக சரிபார்க்க வேண்டும்.
5. Caller விருப்பம் தெரிந்தால் Sir/Ma’am அல்லது பெயர் பயன்படுத்தலாம். தெரியாவிட்டால் “நீங்க/நீங்கள்” என்ற neutral address; குரலை வைத்து gender ஊகிக்கத் தேவையில்லை. “ஐயா வேண்டாம்” என்ற explicit preference அடுத்த turns-லும் மதிக்கப்பட வேண்டும்.
6. Prompt/history paths, model timeouts, useful-text release buffer, TTS delay ஆகியவற்றை தனித்தனியாகச் சரி செய்ய வேண்டும். இந்த evidence மட்டும் model மாற்றமே தீர்வு என்று நிரூபிக்கவில்லை.

**Reproducible evidence**

- [Transcription metadata and segment transcript](output/verify/call-1554-audio-transcript.json) — contains personal speech; report examples redacted.
- [Call-scoped extracted logs](output/verify/call-1554-events.json).
- [Timing measurements and offline parser probes](output/verify/call-1554-analysis.json).
- Offline-only reproduction: `output/verify/summarize_1554_evidence.py`, run with the existing WSL Python; no network/model calls. Wrong-name reproduction: `pending=name` + `எனக்கு நாளைக்கு.` → `entities.name=எனக்கு நாளைக்கு`; natural presence variants → `False`.
- Source seams: `callstate.py` (`observe_user`, `resolve_short_reply`, `set_pending`), `contact_corrections.py` (`PRESENCE`, email parser), `agent.py` (`llm_node`, `_apply_language_directive`, `on_user_turn_completed`).

இந்த deliverable diagnosis/report மட்டும். Existing repairs preserve செய்யப்பட்டுள்ளன; புதிய repair, live-model comparison அல்லது new phone test நடத்தப்படவில்லை.
