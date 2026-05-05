# OutboundAI + InboundAI — Unified Voice Calling Platform

**Status:** Draft for review
**Date:** 2026-05-05
**Authors:** Vimal (product owner), Claude (architect)
**Approval:** Architecture approved by user 2026-05-05

---

## 1. Goals & Non-Goals

### Goals

- Build one production-grade voice calling platform that handles **inbound calls**, **outbound single calls**, and **outbound bulk campaigns** with the same agent runtime.
- Merge three sources into one cohesive product with **zero feature loss**:
  1. The user's existing `LIvekitAIVoice-main` Python outbound agent + Next.js dashboard with a 15-model Prisma schema on Neon DB.
  2. The **InboundAIVoice** GitHub repository (`toprmrproducer/InboundAIVoice`) which adds inbound handling, multi-language presets, recording, transcripts, sentiment, cost estimation, rate limiting, calendar integrations, multi-channel notifications, and a FastAPI HTML dashboard.
  3. The user's **OutboundAI build specification** (Gemini Live realtime, named agent profiles, contact memory with Gemini Flash compression, APScheduler campaigns, 9 LLM tools, BYOK settings, single-page dashboard).
- Use **Neon DB (PostgreSQL)** as the single source of truth.
- Deploy split: **Vercel** for the Next.js dashboard, **Hostinger VPS + Coolify + Docker** for the Python voice service.
- Ship to international standard: pinned dependencies, multi-stage Dockerfile, supervisord, healthchecks, Sentry tracing, Prometheus metrics, structured logs, runbook docs.

### Non-Goals

- No SQLite anywhere. Production-only persistence is Neon.
- No on-prem self-hosted LiveKit. Use LiveKit Cloud.
- No multi-tenant SaaS billing in this phase (the schema supports it; UI/billing comes later).
- No mobile apps. Web dashboard only.
- No Supabase. Substitutions: Neon DB for Postgres, Cloudflare R2 for object storage (recordings).

---

## 2. Architecture

### Topology

```
┌────────────────────────────────────────────────────────────────────────┐
│  VERCEL  (Next.js dashboard, app.yourdomain.com)                       │
│  ─ React UI: CRM, calendar, campaigns, agents, settings, logs, charts  │
│  ─ API routes: CRUD via Prisma → Neon                                  │
│  ─ Forwards dispatch/bulk requests to Hostinger voice service          │
└─────────────────┬──────────────────────────────────────────────────────┘
                  │ HTTPS REST (signed bearer token)
                  ↓
┌────────────────────────────────────────────────────────────────────────┐
│  HOSTINGER VPS  (Coolify + Docker, voice.yourdomain.com)               │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │ Python LiveKit Agent Worker     │  │ FastAPI service             │  │
│  │ agent.py (inbound + outbound)   │  │ server.py                   │  │
│  │ port: registers w/ LiveKit Cloud│  │ port: 8000                  │  │
│  └─────────────────────────────────┘  └─────────────────────────────┘  │
│              ▲                                  ▲                      │
│              │ supervisord runs both in one container                  │
└──────────────┼──────────────────────────────────┼──────────────────────┘
               │                                  │
               │ asyncpg                          │ asyncpg
               ▼                                  ▼
┌────────────────────────────────────────────────────────────────────────┐
│  NEON DB  (single source of truth, pooled + unpooled endpoints)        │
└────────────────────────────────────────────────────────────────────────┘

External: LiveKit Cloud (SIP) · Vobiz (PSTN) · Gemini Live · Gemini Flash ·
          Cal.com · Google Calendar · Twilio (SMS+WhatsApp) · Telegram ·
          n8n webhooks · Cloudflare R2 (recordings) · Sentry · Prometheus
```

### Why this split

- **LiveKit agent workers must be long-lived** and maintain WebSocket connections to LiveKit Cloud. Vercel's serverless model cannot host them.
- **Next.js + Vercel** is the lowest-friction modern dashboard stack. The Next.js + Prisma scaffold already exists in `dashboard/`.
- **Hostinger VPS + Coolify** gives the user a Git-driven deploy with env management, healthchecks, and auto-restart for the Python service without DevOps burden.
- **Neon DB** is the shared single source of truth — no message bus, no replication, no eventual consistency to reason about.

---

## 3. Tech Stack (pinned)

### Voice service (Python)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Python 3.11-slim | InboundAI uses 3.11; LiveKit Agents requires ≥3.10 |
| Voice framework | `livekit-agents>=1.0`, `livekit-api>=1.0`, `livekit-protocol>=1.0` | InboundAI's pinned range |
| Realtime LLM (default) | Gemini Live `gemini-3.1-flash-live-preview` via `livekit-plugins-google>=1.0` | New spec mandates |
| Pipeline LLM fallback | OpenAI `gpt-4o-mini` / Groq `llama-3.3-70b-versatile` / Claude Haiku 3.5 via `livekit-plugins-openai>=1.4` | InboundAI multi-LLM |
| STT (pipeline mode) | Deepgram `nova-3` `multi` / Sarvam `saaras:v3` | InboundAI defaults |
| TTS (pipeline mode) | Sarvam `bulbul:v3` / ElevenLabs `eleven_turbo_v2_5` / Cartesia `sonic-2` / OpenAI / Google | All providers from InboundAI + your config |
| VAD | Silero | Standard |
| Noise cancellation | `livekit-plugins-noise-cancellation` (BVCTelephony) | InboundAI |
| Web framework | FastAPI 0.110+ + Uvicorn 0.29+ | New spec |
| DB driver | `asyncpg` 0.29+ with `pgbouncer`-aware pool | Neon supports both pooled and unpooled |
| Scheduler | APScheduler 3.10+ (in-process) | New spec |
| HTTP client | httpx 0.28+ | InboundAI |
| Notifications | `requests` (Telegram), Twilio SDK 8+, httpx (n8n + WhatsApp) | InboundAI + new spec |
| Calendar | `google-api-python-client` 2.100+, httpx (Cal.com) | InboundAI |
| Observability | `sentry-sdk[fastapi]`, `prometheus-client`, structlog | InboundAI + new spec |
| Memory compression | `google-generativeai` (Gemini Flash 2.0) | New spec |
| Testing | pytest 8+, pytest-asyncio, httpx-mock | Standard |
| Process supervisor | supervisord 4.2+ (apt) | InboundAI |

### Dashboard (Next.js)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) — already scaffolded |
| TypeScript | strict mode |
| ORM | Prisma 6.19 — already installed |
| DB | Neon DB Postgres (pooled = `DATABASE_URL`, unpooled = `DATABASE_URL_UNPOOLED`) |
| UI | React 19, Tailwind CSS, shadcn/ui components |
| Charts | Chart.js (via `react-chartjs-2`) |
| Realtime UI | LiveKit JS SDK for browser demo call; SSE for live logs |
| Forms | react-hook-form + zod |
| Auth | NextAuth.js with credentials provider (single-tenant admin) — Phase 9 |
| Testing | Vitest + Playwright |

### Infrastructure

- **Hostinger VPS:** KVM2 plan or higher (≥2 vCPU, 4 GB RAM, 100 GB SSD), Ubuntu 22.04, Docker, Coolify v4
- **Vercel:** Hobby plan acceptable for dashboard; upgrade to Pro for production analytics
- **Neon DB:** Free tier acceptable for development; Launch tier for production
- **Cloudflare R2:** Free tier (10 GB storage, $0 egress) for recordings
- **LiveKit Cloud:** existing project (`india-vbxta4so.livekit.cloud`)
- **Vobiz:** existing trunks (outbound `f300ac94-...`, inbound `dcb49c8b-...`, number `+918065480036`)

---

## 4. Database — Neon + Prisma

### Strategy

- `dashboard/prisma/schema.prisma` is the **single schema authority**.
- `prisma migrate dev` produces SQL migrations; the migration history is the source of truth for the schema.
- **Python uses `asyncpg`** with raw parameterized SQL against the same tables — no Python-side ORM. This:
  - Avoids needing two ORM definitions to stay in sync
  - Gives lowest latency (asyncpg is the fastest Python Postgres driver)
  - Keeps Python service deployment lightweight
- An `asyncpg.create_pool()` is created once at startup, sized to `min_size=2, max_size=10` (Neon free tier connection limit is 100; pooled endpoint multiplexes).

### Schema reconciliation (extending existing schema)

The existing `schema.prisma` has 15 models. The new spec adds 5 more concepts. Final reconciled model list:

**Tenancy & identity (existing — unchanged):**
- `Organization`, `User`, `ApiKey`

**Voice configuration:**
- `Assistant` (existing) — keeps full agent config
- `AgentProfile` (**new**) — named profile (voice + model + prompt + enabled_tools + is_default). Different from `Assistant` in that it's the spec's lightweight "pick-from-dropdown" object used at dispatch time.
- `Tool` (existing), `AssistantTool` (existing)

**Telephony:**
- `SipTrunk`, `PhoneNumber` (existing — unchanged)

**Calls (extended):**
- `Call` (existing) — central entity. Extended with: `recording_url`, `notes` (editable), `outcome` enum, `reason`, `sentiment`, `interrupt_count`, `cost_usd`, `was_booked`, `caller_history_loaded` flag.
- `TranscriptMessage` (existing) — per-turn transcript. Streaming inserts.
- `ActiveCall` (**new**) — short-lived row per ringing/in-progress call for live dashboard view.

**Campaigns:**
- `Campaign` (existing) — extended with: `schedule_type` (`once`/`daily`/`weekdays`), `schedule_time` (HH:MM IST), `call_delay_seconds`, `system_prompt`, `agent_profile_id` FK, `last_run_at`, `total_dispatched`, `total_failed`.
- `CampaignTarget` (existing) — unchanged.

**CRM & memory:**
- `Contact` (**new**) — real table, phone as natural key. Populated by upsert from `agent.py` shutdown hook on every `Call` insert; denormalized `total_calls`, `last_call_at`, `last_outcome`, `is_booked` are recomputed on each upsert. Holds editable `name`, `email`, `notes`, `tags` so the user can hand-edit CRM rows without those edits being overwritten by call writes (use `coalesce` semantics: keep existing edited fields if non-null).
- `ContactMemory` (**new**) — append-only insights. Compressed by Gemini Flash when ≥5 entries exist for a phone number.

**Booking:**
- `Appointment` (**new**) — name, phone, date, time, service, status, `calcom_booking_uid`, `gcal_event_id`. The new spec's bookings table.

**Configuration & ops:**
- `Setting` (**new**) — key/value table for runtime config (BYOK keys, feature flags). Sensitive values masked in API responses.
- `ErrorLog` (**new**) — source, level, message, detail, timestamp. `/api/logs` reads from this.
- `Webhook` (existing), `WebhookDelivery` (existing) — outbound event delivery.

### Required extensions on existing models

```prisma
model Call {
  // ... existing fields ...
  outcome              CallOutcome?
  reason               String?
  sentiment            String?       // positive | neutral | negative | frustrated
  interruptCount       Int           @default(0)
  costUsd              Decimal?      @db.Decimal(10, 6)
  wasBooked            Boolean       @default(false)
  notes                String?       // editable from CRM
  recordingUrl         String?
  callerHistoryLoaded  Boolean       @default(false)

  @@index([phoneNumber, createdAt])
}

enum CallOutcome {
  BOOKED
  NOT_INTERESTED
  WRONG_NUMBER
  VOICEMAIL
  NO_ANSWER
  CALLBACK_REQUESTED
  TRANSFERRED
  FAILED
  COMPLETED
}
```

### Recordings storage

LiveKit Egress writes to **Cloudflare R2** (S3-compatible). Recording URL pattern:
```
https://recordings.yourdomain.com/{room_name}.ogg
```
R2 bucket = `call-recordings`, region = `auto`, public read disabled, signed URLs (24h TTL) generated on demand.

---

## 5. File Tree (final)

```
LIvekitAIVoice-main/
│
├── voice-service/                          ← Python service (Hostinger)
│   ├── agent.py
│   ├── server.py
│   ├── prompts.py
│   ├── tools.py
│   ├── db.py                               ← asyncpg
│   ├── config.py                           ← from your existing
│   ├── language_presets.py
│   ├── calendar_tools.py
│   ├── notify.py
│   ├── make_call.py                        ← CLI test (your existing)
│   ├── sip/
│   │   ├── __init__.py
│   │   ├── create_trunk.py
│   │   ├── list_trunks.py
│   │   └── setup_trunk.py
│   ├── configs/
│   │   ├── default.json
│   │   └── README.md
│   ├── start.sh
│   ├── supervisord.conf
│   ├── Dockerfile                          ← multi-stage
│   ├── docker-compose.yml                  ← local dev
│   ├── requirements.txt
│   ├── .env.example
│   ├── .dockerignore
│   └── tests/
│       ├── conftest.py
│       ├── test_db.py
│       ├── test_tools.py
│       ├── test_prompts.py
│       ├── test_calendar_tools.py
│       ├── test_notify.py
│       └── test_agent_flow.py
│
├── dashboard/                              ← Next.js (Vercel)
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                        ← stats home
│   │   ├── globals.css
│   │   ├── login/page.tsx
│   │   ├── campaigns/
│   │   │   ├── page.tsx                    ← list + create
│   │   │   └── [id]/page.tsx               ← detail + edit
│   │   ├── calls/
│   │   │   ├── page.tsx                    ← log list + filters
│   │   │   └── [id]/page.tsx               ← detail + transcript
│   │   ├── contacts/
│   │   │   ├── page.tsx                    ← CRM list
│   │   │   └── [phone]/page.tsx            ← per-contact history + memory + notes
│   │   ├── calendar/page.tsx               ← booking calendar
│   │   ├── assistants/
│   │   │   ├── page.tsx                    ← agent profiles list
│   │   │   └── [id]/page.tsx               ← prompt editor + voice picker
│   │   ├── settings/
│   │   │   ├── page.tsx
│   │   │   ├── credentials/page.tsx        ← BYOK
│   │   │   └── integrations/page.tsx
│   │   ├── demo/page.tsx                   ← browser-based demo call
│   │   ├── logs/page.tsx                   ← live error logs (SSE)
│   │   └── api/
│   │       ├── dispatch/route.ts           ← forwards to FastAPI
│   │       ├── queue/route.ts              ← forwards to FastAPI bulk
│   │       ├── campaigns/[...]/route.ts
│   │       ├── contacts/[...]/route.ts
│   │       ├── calls/[...]/route.ts
│   │       ├── assistants/[...]/route.ts
│   │       ├── appointments/[...]/route.ts
│   │       ├── agent-profiles/[...]/route.ts
│   │       ├── settings/route.ts
│   │       ├── stats/route.ts
│   │       ├── demo-token/route.ts
│   │       └── webhook/livekit/route.ts    ← inbound LiveKit events
│   ├── components/
│   │   ├── CallDispatcher.tsx              ← refactored existing
│   │   ├── BulkDialer.tsx                  ← refactored existing
│   │   ├── CampaignForm.tsx
│   │   ├── ContactsTable.tsx
│   │   ├── ContactDetailDrawer.tsx
│   │   ├── BookingCalendar.tsx
│   │   ├── PromptEditor.tsx
│   │   ├── AgentProfileForm.tsx
│   │   ├── CallLogTable.tsx
│   │   ├── TranscriptViewer.tsx
│   │   ├── StatsCharts.tsx
│   │   ├── LiveLogsConsole.tsx
│   │   ├── DemoCallButton.tsx
│   │   ├── SettingsForm.tsx
│   │   ├── BYOKField.tsx
│   │   └── ui/                             ← shadcn primitives
│   ├── lib/
│   │   ├── prisma.ts                       ← existing
│   │   ├── voice-service.ts                ← signed HTTP client
│   │   ├── server-utils.ts                 ← existing
│   │   ├── auth.ts
│   │   └── validators.ts                   ← zod schemas
│   ├── prisma/
│   │   ├── schema.prisma                   ← extended
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── public/
│   ├── tests/
│   │   ├── e2e/
│   │   └── unit/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── next.config.ts
│   ├── eslint.config.mjs
│   ├── postcss.config.js
│   └── .env.example
│
├── docs/
│   ├── superpowers/specs/2026-05-05-outboundai-build-design.md   ← this file
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT_HOSTINGER.md
│   ├── DEPLOYMENT_VERCEL.md
│   ├── ENV_VARS.md
│   ├── RUNBOOK.md
│   └── API.md
│
├── .gitignore
├── .editorconfig
├── README.md                               ← rewritten at end
└── LICENSE
```

---

## 6. Voice Service (Python)

### 6.1 `agent.py` — entrypoint contract

**Responsibilities:**
- LiveKit worker registration with agent_name `voice-agent`. This **replaces** both `outbound-caller` from your existing project and InboundAI's `outbound-caller`. Required updates: `dashboard/app/api/dispatch/route.ts` and `dashboard/app/api/queue/route.ts` must change their `agent_name` from `"outbound-caller"` to `"voice-agent"`. Existing rooms in flight at the time of cutover will fail; deploy during a low-traffic window.
- Detect call direction at runtime by inspecting metadata + remote participants:
  - **Outbound:** `ctx.job.metadata` or `ctx.room.metadata` contains `phone_number`. No SIP participant present yet. Agent calls `ctx.api.sip.create_sip_participant()` to dial out.
  - **Inbound:** SIP participant already in room (LiveKit dispatched the agent in response to inbound SIP INVITE). No metadata required.
- Apply silence-prevention config (Gemini Live mandatory):
  - `RealtimeInputConfig` with `END_SENSITIVITY_LOW`, 2000ms silence_duration, 200ms prefix_padding
  - `SessionResumptionConfig(transparent=True)`
  - `ContextWindowCompressionConfig` with sliding window 25600/12800
- Detect language preset → inject language directive into system prompt.
- Inject IST time context.
- Load caller history (last call summary + memory) for known phone numbers.
- Inject business_name, lead_name, service_type into system prompt template (per-call).
- Spawn `AppointmentTools(ctx, phone_number, lead_name)` and pass tool list to agent.
- Start LiveKit Egress (recording → R2) on session start.
- Hook `participant_disconnected` → unified shutdown.
- Shutdown hook performs:
  1. Stop egress, compute recording URL
  2. Build full transcript from `chat_ctx.messages`
  3. Run sentiment classification (Gemini Flash 2.0)
  4. Estimate cost (LLM tokens × $0.0001 + STT mins × $0.002 + TTS chars × $0.003)
  5. Update `Call` row with outcome, sentiment, cost, recording_url, transcript, was_booked, interrupt_count, duration
  6. Mark `ActiveCall` as completed (or delete row)
  7. Fire all configured webhooks (n8n, Telegram, Twilio WhatsApp, generic)
  8. Compress contact memory if ≥5 insights stored
  9. Sync booking to Cal.com / Google Calendar if applicable
- Catch all uncaught exceptions → Sentry + `error_logs` table.

### 6.2 `server.py` — FastAPI endpoints

```
GET  /health                          → {"status":"ok","service":"voice-service","timestamp":"..."}
GET  /metrics                         → Prometheus exposition

# Auth: all /api/* below require Bearer VOICE_SERVICE_TOKEN
POST /api/dispatch/single             → dispatch one outbound call
POST /api/dispatch/bulk               → dispatch bulk; returns batch_id + per-number results
GET  /api/dispatch/{room_name}/status → live status of a dispatched call

POST /api/campaigns/{id}/run-now      → fire campaign immediately (overrides schedule)
GET  /api/campaigns/scheduler/status  → current APScheduler jobs

POST /api/demo/token                  → mint LiveKit access token + dispatch demo agent
POST /api/webhook/livekit             → LiveKit egress + agent webhooks (HMAC verified)
POST /internal/record-call            → agent.py reports call completion (Prometheus counters)

GET  /api/logs/stream                 → SSE — tail error_logs
```

### 6.3 `tools.py` — 9 LLM tools

All tools defined as `@llm.function_tool` decorated coroutines on `AppointmentTools(llm.ToolContext)`:

1. **`check_availability(date, time)`** — checks `appointments` table; returns `available` or `unavailable: next available slot is <slot>`.
2. **`book_appointment(name, phone, date, time, service)`** — inserts into `appointments`, returns confirmation with booking ID.
3. **`end_call(outcome, reason)`** — logs call to `calls` + `call_logs`, disconnects room.
4. **`transfer_to_human(reason)`** — SIP REFER to `DEFAULT_TRANSFER_NUMBER`.
5. **`send_sms_confirmation(phone, message)`** — Twilio SMS, no-op if not configured.
6. **`lookup_contact(phone)`** — returns past calls + appointments + memory.
7. **`remember_details(insight)`** — inserts into `contact_memory`; triggers async compression at 5+ entries.
8. **`book_calcom(name, email, date, start_time, notes)`** — Cal.com v2 API booking.
9. **`cancel_calcom(booking_uid, reason)`** — Cal.com v2 API cancellation.

`build_tool_list(enabled: list[str])` filters by enabled list per agent profile. Empty list = all enabled.

### 6.4 `db.py` — asyncpg layer

Single `asyncpg.Pool` initialized at FastAPI startup and at agent worker first job. Replaces InboundAI's Supabase client and the spec's `supabase-py` calls.

API surface mirrors the spec's `db.py` 1:1 — same async function names + signatures — so the rest of the code is portable:

```python
# Pool lifecycle
async def get_pool() -> asyncpg.Pool
async def close_pool() -> None

# Settings (BYOK)
async def get_all_settings() -> dict
async def save_settings(data: dict) -> None
async def get_setting(key, default="") -> str
async def set_setting(key, value) -> None
async def get_enabled_tools() -> list[str]

# Error logs
async def log_error(source, message, detail="", level="error") -> None
async def get_errors(limit=100) -> list[dict]
async def get_logs(level=None, source=None, limit=200) -> list[dict]
async def clear_errors() -> None

# Appointments
async def insert_appointment(name, phone, date, time, service) -> str
async def check_slot(date, time) -> bool
async def get_next_available(date, time) -> str
async def get_all_appointments(date_filter=None) -> list[dict]
async def cancel_appointment(appointment_id) -> bool
async def get_appointments_by_phone(phone) -> list[dict]

# Calls
async def log_call(phone_number, lead_name, outcome, reason, duration_seconds, recording_url=None, notes=None) -> None
async def get_all_calls(page=1, limit=20) -> list[dict]
async def get_calls_by_phone(phone) -> list[dict]
async def update_call_notes(call_id, notes) -> bool
async def get_contacts() -> list[dict]
async def get_stats() -> dict

# Campaigns
async def create_campaign(name, contacts_json, schedule_type, schedule_time, call_delay_seconds, system_prompt=None, agent_profile_id=None) -> str
async def get_all_campaigns() -> list[dict]
async def get_campaign(campaign_id) -> dict | None
async def update_campaign_status(campaign_id, status) -> bool
async def update_campaign_run_stats(campaign_id, dispatched, failed) -> None
async def delete_campaign(campaign_id) -> bool

# Contact memory
async def add_contact_memory(phone, insight) -> None
async def get_contact_memory(phone) -> list[dict]
async def compress_contact_memory(phone, compressed) -> None

# Agent profiles
async def get_all_agent_profiles() -> list[dict]
async def get_agent_profile(profile_id) -> dict | None
async def create_agent_profile(name, voice, model, system_prompt, enabled_tools, is_default) -> str
async def update_agent_profile(profile_id, updates) -> bool
async def delete_agent_profile(profile_id) -> bool
async def set_default_agent_profile(profile_id) -> None

# Active calls (live dashboard view)
async def upsert_active_call(room_id, phone, caller_name, status) -> None
async def get_active_calls() -> list[dict]
async def remove_active_call(room_id) -> None

# Real-time transcript
async def insert_transcript_message(call_room_id, phone, role, content) -> None
async def get_transcript(call_room_id) -> list[dict]
```

### 6.5 `calendar_tools.py`

Verbatim port from InboundAI with one change: replaces the `from db import save_call_log` reference with the new asyncpg-backed equivalent. Functions retained:

- `get_available_slots(date_str)` — Cal.com first; Google Calendar fallback if `GOOGLE_CALENDAR_ID` + service account file are present.
- `_get_slots_calcom(date_str)`, `_get_slots_gcal(date_str, calendar_id, creds_file)`
- `create_booking(...)`, `async_create_booking(...)`, `_create_booking_calcom`, `_create_booking_gcal`
- `cancel_booking(booking_id, reason)`

Free-slot computation logic (10:00–19:00 IST, 30-minute slots) preserved.

### 6.6 `notify.py`

Verbatim port from InboundAI. Functions retained:

- `send_telegram(message)`, `send_whatsapp(to_phone, message)`, `send_whatsapp_booking_confirmation(...)`
- `notify_booking_confirmed(...)`, `notify_booking_cancelled(...)`, `notify_call_no_booking(...)`, `notify_agent_error(...)`
- `send_webhook(webhook_url, event_type, payload)` — generic webhook delivery for n8n / CRM integrations

### 6.7 `prompts.py`

Combines:
- New spec's `DEFAULT_SYSTEM_PROMPT` (Priya appointment-booker template with explicit STEP 1–6 flow + objection handling + style rules + tool usage rules)
- Your existing `config.py` `SYSTEM_PROMPT` (school receptionist) — kept as `SCHOOL_RECEPTIONIST_PROMPT` constant for reference / one of the seed agent profiles
- InboundAI's `LANGUAGE_PRESETS` dict — moved to `language_presets.py`, imported here
- InboundAI's `get_ist_time_context()` — kept here

`build_prompt(lead_name, business_name, service_type, custom_prompt=None, language_preset="multilingual")`:
1. Use `custom_prompt` if provided, else `DEFAULT_SYSTEM_PROMPT`
2. Format with `{lead_name}`, `{business_name}`, `{service_type}` (silently fall back if KeyError)
3. Append IST time context block
4. Append language directive based on preset
5. Append `[CALLER HISTORY: ...]` block if loaded
6. Token-count and warn (not fail) if >600 tokens

---

## 7. Dashboard (Next.js on Vercel)

### 7.1 Pages (App Router)

| Route | Purpose | Source |
|---|---|---|
| `/` | Stats overview, recent calls | New |
| `/login` | Single-admin auth (NextAuth) | New (Phase 9) |
| `/campaigns` | Campaign list + create modal | New |
| `/campaigns/[id]` | Campaign detail, contacts, schedule, run-now | New |
| `/calls` | Call log list with filters (outcome, phone, date) | New |
| `/calls/[id]` | Call detail, transcript, recording playback, notes editor | New |
| `/contacts` | CRM contacts list | New |
| `/contacts/[phone]` | Per-contact history + memory + editable notes | New |
| `/calendar` | Booking calendar (month/week view, click day = bookings list modal) | InboundAI port |
| `/assistants` | Agent profile list | New |
| `/assistants/[id]` | Prompt editor (Monaco/CodeMirror), voice picker, model picker, tool toggles | New |
| `/settings` | Tabs: General, Credentials (BYOK), Integrations | New |
| `/settings/credentials` | BYOK fields for all keys (sensitive shown masked) | New |
| `/settings/integrations` | Cal.com, Google Calendar, Telegram, Twilio, n8n setup | New |
| `/demo` | Browser-based demo call (LiveKit JS SDK) | InboundAI port |
| `/logs` | Live error logs console with filters (SSE-driven) | New |

### 7.2 API routes (Next.js Edge/Node runtime)

CRUD endpoints all hit Neon directly via Prisma:

```
GET    /api/stats                     → dashboard stats
GET    /api/campaigns                 → list
POST   /api/campaigns                 → create
GET    /api/campaigns/[id]            → detail
PATCH  /api/campaigns/[id]            → update
DELETE /api/campaigns/[id]            → delete
POST   /api/campaigns/[id]/run        → forwards to FastAPI /api/campaigns/[id]/run-now

GET    /api/calls                     → list (paginated)
GET    /api/calls/[id]                → detail with transcript
PATCH  /api/calls/[id]                → update notes

GET    /api/contacts                  → list (deduped from calls)
GET    /api/contacts/[phone]          → detail + memory + appointments
PATCH  /api/contacts/[phone]          → update name/email/notes/tags

GET    /api/appointments              → list with date filter
POST   /api/appointments              → create (manual)
DELETE /api/appointments/[id]         → cancel

GET    /api/agent-profiles            → list
POST   /api/agent-profiles            → create
PATCH  /api/agent-profiles/[id]       → update
DELETE /api/agent-profiles/[id]       → delete
POST   /api/agent-profiles/[id]/default → set default

GET    /api/assistants                → list (existing schema)
POST   /api/assistants                → create
… etc

GET    /api/settings                  → all settings (sensitive masked)
PATCH  /api/settings                  → upsert subset

POST   /api/dispatch                  → forwards to FastAPI /api/dispatch/single
POST   /api/queue                     → forwards to FastAPI /api/dispatch/bulk
POST   /api/demo-token                → forwards to FastAPI /api/demo/token

POST   /api/webhook/livekit           → receives LiveKit webhooks (signature-verified)
GET    /api/logs/stream               → SSE proxy to FastAPI /api/logs/stream
```

### 7.3 Components

Each page composes from focused components in `components/`:
- Forms use react-hook-form + zod
- Tables paginated, sortable, filterable
- All sensitive fields masked (`••••••••••`) until "Reveal" clicked
- Charts: Chart.js wrapped in `StatsCharts.tsx` (calls timeline, outcomes pie, duration histogram, booking-rate line)

---

## 8. Service Contracts (HTTP)

### Vercel ↔ Hostinger auth

- `VOICE_SERVICE_TOKEN` is a single shared bearer token (Vercel env var, also set on Hostinger).
- Every request from Next.js to FastAPI sends `Authorization: Bearer ${VOICE_SERVICE_TOKEN}`.
- FastAPI middleware rejects missing/wrong tokens with 401.
- Public endpoints (`/health`, `/metrics`, `/api/webhook/*`) skip the auth middleware.
- Webhook auth: HMAC-SHA256 over the request body using `LIVEKIT_WEBHOOK_SECRET` (LiveKit) or per-integration shared secrets.

### Dispatch payload (Vercel → Hostinger)

```json
POST /api/dispatch/single
{
  "phone": "+919876543210",
  "agent_profile_id": "uuid-or-null",     // null = use default profile
  "lead_name": "Ravi",
  "business_name": "Acme Dental",
  "service_type": "consultation",
  "campaign_id": "uuid-or-null",
  "metadata": { ... arbitrary ... }
}
→ 200 OK
{
  "status": "ok",
  "dispatch_id": "AGT_xxx",
  "room": "call-919876543210-7421",
  "phone": "+919876543210"
}
```

### Bulk payload

```json
POST /api/dispatch/bulk
{
  "campaign_id": "uuid",
  "contacts": [
    {"phone": "+91...", "lead_name": "Ravi"},
    {"phone": "+91...", "lead_name": "Priya"}
  ],
  "agent_profile_id": "uuid",
  "delay_seconds": 3
}
→ 200 OK
{
  "batch_id": "BATCH_xxx",
  "total": 2,
  "results": [
    {"phone": "+91...", "status": "ok",    "dispatch_id": "AGT_..."},
    {"phone": "+91...", "status": "error", "message": "..."}
  ]
}
```

---

## 9. Key Flows

### 9.1 Inbound call

1. PSTN call hits Vobiz inbound trunk → SIP INVITE to LiveKit Cloud.
2. LiveKit Cloud creates a room, dispatches `voice-agent` worker (registered by `agent.py`).
3. `agent.py` `entrypoint(ctx)`:
   - Detects SIP participant already in room → mode = inbound
   - Extracts `caller_phone` from participant attributes (`sip.phoneNumber`)
   - Loads caller history + memory from Neon
   - Builds session with default `AgentProfile` (or one matched by `phone_number → routing` rule, future)
   - Starts session, agent generates first greeting
   - Conversation runs; tools fire; transcript streams
4. On disconnect, shutdown hook updates Neon, fires webhooks, compresses memory.

### 9.2 Outbound single call

1. User clicks "Dispatch" in Next.js `CallDispatcher.tsx`.
2. Next.js `/api/dispatch/route.ts` validates phone, attaches default `agent_profile_id`, forwards to FastAPI.
3. FastAPI `/api/dispatch/single`:
   - Validates token + payload
   - Mints unique room name `call-{e164}-{rand}`
   - Calls `agent_dispatch.create_dispatch` with metadata `{phone_number, agent_profile_id, lead_name, business_name, service_type, campaign_id}`
   - Inserts a `Call` row with `status=QUEUED`
   - Returns dispatch_id
4. LiveKit Cloud creates the room, dispatches the `voice-agent` worker.
5. `agent.py` `entrypoint(ctx)`:
   - Reads metadata → mode = outbound
   - Loads `AgentProfile` from Neon
   - Builds session
   - Calls `ctx.api.sip.create_sip_participant(wait_until_answered=True)`
   - On answer, agent speaks first greeting (per spec STEP 1)
6. Same shutdown flow as inbound.

### 9.3 Bulk campaign

1. User creates campaign in `/campaigns/new`:
   - Uploads CSV (phone, lead_name, optional fields)
   - Picks `AgentProfile`
   - Picks schedule: `once` (run now or at scheduled time), `daily` (HH:MM IST), `weekdays` (HH:MM IST Mon-Fri)
2. Next.js `/api/campaigns POST` writes `Campaign` + `CampaignTarget` rows to Neon.
3. Next.js `/api/campaigns/[id]/run` forwards to FastAPI `/api/campaigns/[id]/run-now`.
4. FastAPI runs in background:
   - For each `CampaignTarget` with status=`PENDING`:
     - Calls `dispatch_single()` internally
     - Updates target status to `DISPATCHED` or `FAILED`
     - Sleeps `call_delay_seconds`
   - Updates campaign `last_run_at`, `total_dispatched`, `total_failed`, `status=completed`
5. APScheduler runs in the same FastAPI process. On startup, loads active campaigns with `schedule_type` ≠ `once` and registers cron jobs that fire `run-now` at the scheduled IST time. Reload jobs on every campaign mutation via in-memory event.

---

## 10. Environment Variables

### Voice service (Hostinger)

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled URL |
| `DATABASE_URL_UNPOOLED` | yes | Neon unpooled URL (admin queries) |
| `VOICE_SERVICE_TOKEN` | yes | Shared bearer for Vercel ↔ Hostinger |
| `LIVEKIT_URL` | yes | wss://...livekit.cloud |
| `LIVEKIT_API_KEY` | yes | |
| `LIVEKIT_API_SECRET` | yes | |
| `LIVEKIT_WEBHOOK_SECRET` | yes | HMAC for inbound webhooks |
| `GOOGLE_API_KEY` | yes | Gemini Live + Flash |
| `GEMINI_MODEL` | no | default `gemini-3.1-flash-live-preview` |
| `GEMINI_TTS_VOICE` | no | default `Aoede` |
| `USE_GEMINI_REALTIME` | no | default `true` |
| `OPENAI_API_KEY` | no | LLM fallback / sentiment analysis |
| `GROQ_API_KEY` | no | LLM fallback |
| `ANTHROPIC_API_KEY` | no | Claude fallback |
| `DEEPGRAM_API_KEY` | no | STT (pipeline mode) |
| `SARVAM_API_KEY` | no | Sarvam STT/TTS |
| `ELEVENLABS_API_KEY` | no | ElevenLabs TTS |
| `CARTESIA_API_KEY` | no | Cartesia TTS |
| `VOBIZ_SIP_DOMAIN` | yes | |
| `VOBIZ_USERNAME` | yes | |
| `VOBIZ_PASSWORD` | yes | |
| `VOBIZ_OUTBOUND_NUMBER` | yes | |
| `OUTBOUND_TRUNK_ID` | yes | LiveKit trunk ID |
| `INBOUND_TRUNK_ID` | yes | LiveKit trunk ID |
| `DEFAULT_TRANSFER_NUMBER` | no | Human transfer fallback |
| `R2_ACCOUNT_ID` | yes | Cloudflare R2 |
| `R2_ACCESS_KEY_ID` | yes | |
| `R2_SECRET_ACCESS_KEY` | yes | |
| `R2_BUCKET` | yes | `call-recordings` |
| `R2_ENDPOINT` | yes | `https://{account}.r2.cloudflarestorage.com` |
| `CALCOM_API_KEY` | no | Cal.com booking |
| `CALCOM_EVENT_TYPE_ID` | no | |
| `CALCOM_TIMEZONE` | no | default `Asia/Kolkata` |
| `GOOGLE_CALENDAR_ID` | no | |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | no | path to JSON inside container |
| `TWILIO_ACCOUNT_SID` | no | SMS + WhatsApp |
| `TWILIO_AUTH_TOKEN` | no | |
| `TWILIO_FROM_NUMBER` | no | SMS sender |
| `TWILIO_WHATSAPP_NUMBER` | no | WhatsApp sender |
| `TELEGRAM_BOT_TOKEN` | no | |
| `TELEGRAM_CHAT_ID` | no | |
| `N8N_WEBHOOK_URL` | no | Generic event delivery |
| `SENTRY_DSN` | no | Error tracking |
| `ENVIRONMENT` | no | `production` / `staging` / `development` |

### Dashboard (Vercel)

| Var | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Neon pooled |
| `DATABASE_URL_UNPOOLED` | yes | Neon unpooled (Prisma migrations) |
| `VOICE_SERVICE_URL` | yes | `https://voice.yourdomain.com` |
| `VOICE_SERVICE_TOKEN` | yes | Shared bearer |
| `LIVEKIT_URL` | yes | For browser demo |
| `LIVEKIT_API_KEY` | yes | For browser demo token mint |
| `LIVEKIT_API_SECRET` | yes | |
| `NEXTAUTH_URL` | yes | Vercel URL |
| `NEXTAUTH_SECRET` | yes | session encryption |
| `ADMIN_EMAIL` | yes | single-admin auth |
| `ADMIN_PASSWORD_HASH` | yes | bcrypt hash |
| `SENTRY_DSN` | no | |

---

## 11. Deployment

### 11.1 Hostinger VPS (Coolify + Docker)

**One-time setup:**
1. Provision Hostinger KVM2 VPS (Ubuntu 22.04, ≥4 GB RAM)
2. Install Docker: `curl -fsSL https://get.docker.com | sh`
3. Install Coolify: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash`
4. Open ports 80, 443, 8000, 8081 in Hostinger firewall
5. Point `voice.yourdomain.com` A record to VPS IP

**Per-deploy:**
1. Coolify → New Resource → Public Repository → select `LIvekitAIVoice-main`
2. Build Pack: Docker; Context: `voice-service/`; Dockerfile: `Dockerfile`
3. Ports: expose 8000:8000
4. Domain: `voice.yourdomain.com`, force HTTPS, Let's Encrypt
5. Healthcheck: `GET /health` every 30s, fail after 3 consecutive
6. Env vars: paste from `voice-service/.env` (excluding `DATABASE_URL_UNPOOLED` if not needed at runtime)
7. Resource limits: 2 CPU, 3 GB RAM (leaves room for ~30 concurrent calls per InboundAI's analysis)
8. Deploy → watch logs for `livekit.agents:registered worker`

### 11.2 Vercel (Next.js)

**One-time setup:**
1. Install Vercel CLI; `vercel login`
2. Connect GitHub repo to Vercel
3. Project root: `dashboard/`
4. Framework preset: Next.js (auto-detected)

**Per-deploy:**
1. Push to `main` → preview deploy on every PR; production deploy on merge
2. Env vars (Production + Preview):
   - `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
   - `VOICE_SERVICE_URL=https://voice.yourdomain.com`
   - `VOICE_SERVICE_TOKEN`
   - `LIVEKIT_*`, `NEXTAUTH_*`, `ADMIN_*`
3. Build command: `npx prisma generate && next build` (already in `package.json`)
4. Custom domain: `app.yourdomain.com`

### 11.3 Multi-stage Dockerfile

```dockerfile
# Stage 1: Builder
FROM python:3.11-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libsndfile1-dev libgomp1 curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    supervisor libsndfile1 libgomp1 ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /root/.local /root/.local
COPY . .
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf
ENV PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

**No `DB_PATH`. No `/data/*.db`. No SQLite leftovers.** Only port 8000 (FastAPI) is exposed; the LiveKit agent worker connects outbound to LiveKit Cloud over WSS and does not need an inbound port.

### 11.4 supervisord.conf

```ini
[supervisord]
nodaemon=true
logfile=/dev/null
logfile_maxbytes=0

[program:agent]
command=python agent.py start
directory=/app
autostart=true
autorestart=true
startretries=10
stopwaitsecs=30
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0

[program:server]
command=uvicorn server:app --host 0.0.0.0 --port 8000 --workers 1
directory=/app
autostart=true
autorestart=true
startretries=5
stopwaitsecs=15
stderr_logfile=/dev/stderr
stderr_logfile_maxbytes=0
stdout_logfile=/dev/stdout
stdout_logfile_maxbytes=0
```

`workers=1` because APScheduler is in-process and must not be duplicated.

---

## 12. Security

- All secrets injected as env vars; nothing in source.
- BYOK keys stored in Neon `settings` table with column `is_sensitive=true`; API responses mask sensitive values to empty string + `configured: true` boolean.
- `VOICE_SERVICE_TOKEN` is the only auth between Vercel and Hostinger; rotated quarterly.
- LiveKit webhooks HMAC-verified.
- HTTPS everywhere (Let's Encrypt via Coolify, Vercel automatic).
- NextAuth single-admin login for the dashboard. No public registration.
- Rate limiting at FastAPI level via `slowapi`: 100 req/min/IP for `/api/dispatch/*`, 1000 req/min/IP for read endpoints.
- Rate limiting per phone: 5 calls/hour (InboundAI's logic, kept) — enforced inside `agent.py` `entrypoint` before session start.
- SQL: parameterized only. asyncpg uses `$1, $2, ...` positional params.
- Recordings: R2 bucket private; signed URLs (24 h) only.
- CSP on dashboard: strict, allow-listed origins only.

---

## 13. Observability

### Logging

- structlog JSON format on Python service.
- Request-scoped fields: `request_id`, `room_name`, `phone`, `tenant_org_id`.
- Forwarded to stderr → Coolify aggregates → optionally to a log drain (Logtail / Datadog).
- Errors written to `error_logs` table with bounded message length (500 chars) + detail (2000 chars).

### Metrics (Prometheus)

Exposed at `/metrics` (FastAPI):
- `voice_calls_total{outcome="..."}`
- `voice_calls_active`
- `voice_call_duration_seconds` (histogram)
- `voice_calls_booked_total`
- `voice_dispatch_failures_total`
- `voice_egress_failures_total`
- Default Python process metrics

Optional Grafana on the same VPS via Coolify.

### Tracing

- Sentry SDK in both services, sample rate 10% in production.
- Browser: Sentry React in Next.js client.
- AsyncIO integration enabled.
- Releases tagged with git SHA.

### Healthchecks

- Coolify pings `GET /health` every 30 s. Fails restart container after 3 consecutive failures (Docker `HEALTHCHECK`).
- Vercel uses its built-in deployment checks.
- Optional: external uptime monitor (BetterStack / UptimeRobot) hitting both `https://voice.yourdomain.com/health` and `https://app.yourdomain.com/`.

---

## 14. Testing

### Voice service

- **pytest + pytest-asyncio** for unit tests.
- `tests/conftest.py` spins up an asyncpg pool against a separate test schema in Neon (or a local Postgres via testcontainers).
- `test_db.py` — every CRUD function exercised; transactions rolled back per test.
- `test_tools.py` — each LLM tool invoked with mocked dependencies (Cal.com, Twilio, asyncpg).
- `test_prompts.py` — `build_prompt()` interpolation, language injection, IST context.
- `test_calendar_tools.py` — Cal.com mocked via httpx-mock; gcal mocked via fake `googleapiclient`.
- `test_notify.py` — Telegram + WhatsApp + webhook all mocked.
- `test_agent_flow.py` — full inbound + outbound entrypoint with mocked LiveKit `JobContext`. Verifies dial-out, metadata parsing, language detection, recording start, shutdown hook.

### Dashboard

- **Vitest** for unit tests on lib/utils/components.
- **Playwright** for E2E:
  - Golden path 1: log in → create campaign → upload CSV → schedule → run-now → see dispatched count
  - Golden path 2: open contact → add note → see in CRM list
  - Golden path 3: open call log → play recording → download transcript
  - Golden path 4: settings → BYOK → save Cal.com key → verify masked on reload
  - Golden path 5: demo page → click start → assert LiveKit room connection (with stub LiveKit Cloud)

### CI

- GitHub Actions: lint (ruff + eslint), typecheck (mypy + tsc), unit tests, build dashboard, build Docker image, push to GHCR. Coolify auto-pulls latest tag.

---

## 15. Phased Implementation

The implementation plan generated by `superpowers:writing-plans` will follow this phasing:

| Phase | Title | Outputs |
|---|---|---|
| 0 | Schema reconciliation | Extended `schema.prisma`, Prisma migration applied to Neon, Prisma client regenerated, seed script with one default `AgentProfile` |
| 1 | Voice service foundation | `voice-service/` directory, `db.py` asyncpg pool, `config.py` (ported), env loading, Sentry init, structlog setup, `tests/conftest.py` |
| 2 | Python agent core | `agent.py` (Gemini Live entrypoint, dial-out, language presets, IST context, recording, shutdown hook), `language_presets.py`, `prompts.py` |
| 3 | Tools | `tools.py` with all 9 LLM tools, unit tests for each |
| 4 | FastAPI server | `server.py` with all endpoints, APScheduler integration, healthcheck, Prometheus, SSE log stream, webhook receivers |
| 5 | Auxiliary modules | `calendar_tools.py`, `notify.py` (verbatim ports + asyncpg refactor) |
| 6 | Docker + supervisord | Multi-stage Dockerfile, `supervisord.conf`, `start.sh`, `docker-compose.yml`, `.dockerignore`, `.env.example`, smoke test (build + run locally with stub LiveKit) |
| 7 | Dashboard pages — read | Stats, calls, contacts, calendar, logs (read-only screens) wired to Prisma |
| 8 | Dashboard pages — write | Campaigns CRUD, agent profiles CRUD, settings BYOK, prompt editor, integrations form |
| 9 | Dashboard auth + polish | NextAuth single admin, demo page (LiveKit JS), live logs SSE, Chart.js stats |
| 10 | Deployment | Hostinger Coolify deploy of voice-service, Vercel deploy of dashboard, end-to-end smoke test (1 inbound + 1 outbound + 1 bulk campaign of 3 numbers) |
| 11 | Documentation | `README.md` rewrite, `ARCHITECTURE.md`, `DEPLOYMENT_HOSTINGER.md`, `DEPLOYMENT_VERCEL.md`, `RUNBOOK.md`, `API.md`, `ENV_VARS.md` |

Each phase ends with a verification checklist that must pass before moving on.

---

## 16. Risks & Open Questions

### Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Gemini Live API is preview; behavior may change | Pipeline fallback (Deepgram + OpenAI/Groq + Sarvam TTS) is the second branch in `_build_session`. Toggle via `USE_GEMINI_REALTIME=false`. |
| R2 | Hostinger VPS clock drift breaks IST scheduling | `chronyd` enabled; APScheduler uses `pytz` IST timezone explicitly. |
| R3 | APScheduler in-process loses jobs on restart | Active campaigns reloaded on startup from Neon `campaigns` table. |
| R4 | Neon free tier has connection limit + cold start | `min_size=2, max_size=10` pool; pooled endpoint always; promote to Launch tier ($19/mo) before production. |
| R5 | Vercel cold start adds 1–2s to dashboard load | Acceptable for an admin dashboard (not customer-facing). |
| R6 | LiveKit Egress R2 upload fails silently | Healthcheck includes recent egress success rate; alert if 0 in last 100 calls. |
| R7 | Supervisord respawn loop on agent.py crash | `startretries=10`, `stopwaitsecs=30`. After 10 fails, supervisord stops trying — Coolify healthcheck will then mark the container unhealthy and restart it. |
| R8 | Bulk dispatch races with Vercel HTTP timeout (10s) | Vercel route returns 202 immediately and FastAPI runs the loop in a background task. Status polled via `/api/dispatch/{id}/status`. |
| R9 | Cost runaway from runaway loops | `max_turns=25` auto-close, rate limit 5/h/phone, hourly budget cap configurable (settings table). |

### Open questions (please confirm)

- **OQ1.** Single-admin auth (NextAuth) is sufficient for now, correct? Multi-tenant org/user UI lands in a future phase.
- **OQ2.** Recordings on Cloudflare R2 confirmed? (Alternatives: Backblaze B2, AWS S3, Wasabi.)
- **OQ3.** Domain plan: do you have one? If yes, what subdomains for `app.*` and `voice.*`? If not, the spec assumes `app.yourdomain.com` and `voice.yourdomain.com`.
- **OQ4.** Should the existing `transfer_call.md` documentation be folded into `docs/RUNBOOK.md`?
- **OQ5.** Should we keep your existing `school receptionist` system prompt as a seed `AgentProfile`, or only the spec's `Priya` template?

These are non-blocking — the implementation plan can pick reasonable defaults if you don't answer.

---

## 17. Appendix — Source Mapping

To prove **zero feature loss**, every feature from the three sources has a destination in this design:

| Source | File / Feature | Destination in unified design |
|---|---|---|
| Existing project | `agent.py` | Replaced wholesale; behavior absorbed into new `voice-service/agent.py` |
| Existing project | `config.py` | `voice-service/config.py` (kept) — schools prompt becomes seed agent profile |
| Existing project | `make_call.py` | `voice-service/make_call.py` (CLI utility, retained) |
| Existing project | `setup_trunk.py`, `create_trunk.py`, `list_trunks.py` | `voice-service/sip/*` |
| Existing project | `dashboard/` Next.js + Prisma | Kept, extended |
| Existing project | `BulkDialer.tsx`, `CallDispatcher.tsx` | Refactored, kept |
| Existing project | Prisma 15-model schema | Extended (5 new models) |
| Existing project | Docker + docker-compose | Replaced with multi-stage Dockerfile + supervisord |
| InboundAI | `agent.py` (851 lines) | All features absorbed: language presets, rate limiting, recording, sentiment, cost, transcript streaming, IST context, caller history, interrupt count, turn counter, shutdown hook, sentry, n8n webhook, prometheus |
| InboundAI | `db.py` | Replaced by asyncpg `db.py` (same API surface) |
| InboundAI | `calendar_tools.py` | Verbatim port |
| InboundAI | `notify.py` | Verbatim port |
| InboundAI | `ui_server.py` (FastAPI HTML dashboard) | Each section → Next.js page (CRM, Calendar, Logs, Demo, Settings, Models, Agent Settings, Prompt Editor, Outbound, Languages) |
| InboundAI | `Dockerfile` (multi-stage) | Adopted |
| InboundAI | `supervisord.conf` | Adopted |
| InboundAI | `supabase_*.sql` | Translated into Prisma schema migrations |
| InboundAI | `LANGUAGE_PRESETS` | `voice-service/language_presets.py` |
| InboundAI | Per-client config files (`configs/{phone}.json`) | `voice-service/configs/` |
| InboundAI | Sentry, Prometheus, healthcheck | All retained |
| InboundAI | Telegram + Twilio WhatsApp + n8n + custom webhook | `notify.py` |
| InboundAI | Browser demo page | `/demo` Next.js page |
| New spec | Gemini Live realtime | Default mode in `agent.py` |
| New spec | 9 LLM tools | `tools.py` |
| New spec | `prompts.py` Priya template + `build_prompt()` | `voice-service/prompts.py` |
| New spec | Named agent profiles | `AgentProfile` model + `/assistants/*` UI |
| New spec | Contact memory + Gemini Flash compression | `contact_memory` table + `_compress_memories()` |
| New spec | APScheduler campaigns | FastAPI in-process scheduler |
| New spec | BYOK settings | `settings` table + `/settings/credentials` UI |
| New spec | Live logs page | `/logs` Next.js + SSE from FastAPI |
| New spec | Chart.js stats | `StatsCharts.tsx` |
| New spec | Single-page dashboard | Next.js multi-page with same feature surface |
| New spec | Cal.com integration (book + cancel) | `book_calcom` + `cancel_calcom` tools |
| New spec | Twilio SMS confirmation tool | `send_sms_confirmation` tool |
| New spec | Coolify deployment | Documented in `DEPLOYMENT_HOSTINGER.md` |

---

**End of design document.**
