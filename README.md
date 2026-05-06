# OutboundAI — Rapid X AI Voice Platform

Production-grade outbound + inbound voice calling platform built on **LiveKit Agents 1.x** with a **Next.js 16** admin dashboard. Multi-provider STT/TTS (Deepgram, Sarvam, ElevenLabs, Cartesia), multi-LLM (Gemini Live default, OpenAI / Groq / Anthropic fallback), SIP telephony via Vobiz, NeonDB Postgres, Cal.com + Google Calendar appointment booking, Telegram + WhatsApp notifications, Cloudflare R2 for recordings, Sentry + structlog observability.

## Architecture

```
┌──────────────────────────────────────┐        ┌────────────────────────────────────┐
│  Dashboard (Next.js 16)              │        │  voice-service (Python 3.11)        │
│  Vercel deploy                       │        │  Hostinger Coolify (Docker)         │
│                                      │        │                                    │
│  • App Router + Server Actions       │        │  • LiveKit worker  (agent.py)      │
│  • Prisma 6 → Neon Postgres          │ HTTPS  │  • FastAPI server  (server.py)     │
│  • livekit-client demo widget        │ ─────▶ │      ├─ /api/dispatch/single|bulk  │
│  • SSE log viewer                    │ Bearer │      ├─ /api/demo/token            │
│  • Assistants/Campaigns/Calls/etc CRUD│        │      ├─ /api/campaigns/*          │
└──────────────────────────────────────┘        │      ├─ /api/logs/stream  (SSE)   │
                  │                              │      ├─ /api/webhook/livekit (HMAC)│
                  ▼                              │      └─ /metrics  (Prometheus)    │
        Neon DB (Postgres)  ◀────── asyncpg ─────┤                                    │
        22 tables                                │  • supervisord runs both procs    │
                                                 └────────────────────────────────────┘
                                                           │
                                                           ▼
                                                   LiveKit Cloud + Vobiz SIP
```

The dashboard reads NeonDB directly via Prisma. **All call dispatches go through the voice-service REST API** with `Authorization: Bearer ${VOICE_SERVICE_TOKEN}`. The browser never holds the LiveKit API secret — JWTs are minted by the voice-service and proxied by the Next API route.

## Repo layout

```
.
├── voice-service/          # Python 3.11 LiveKit worker + FastAPI
│   ├── agent.py            # LiveKit worker entrypoint
│   ├── server.py           # FastAPI: dispatch / scheduler / SSE / webhook
│   ├── tools.py            # 9 LLM function-tools (book, transfer, sms, lookup…)
│   ├── db.py               # asyncpg pool + 30+ DB helpers
│   ├── prompts.py          # Priya appointment-booker template
│   ├── calendar_tools.py   # Cal.com + Google Calendar booking
│   ├── notify.py           # Telegram + WhatsApp + webhook delivery
│   ├── language_presets.py # 11 Indian-language presets
│   ├── observability.py    # Sentry + structlog + Prometheus
│   ├── config.py           # Static defaults
│   ├── sip/                # SIP trunk admin scripts
│   ├── configs/            # Per-client JSON overrides (default.json)
│   ├── tests/              # pytest-asyncio (34+ tests)
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

### 1 · Voice service

```bash
cd voice-service
python3.11 -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
cp .env.example .env             # fill in NeonDB + LiveKit + provider keys
pytest -q                        # ≥ 34 tests must pass
./start.sh                       # runs uvicorn + agent.py via dev script
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

## Deploying

### Dashboard → Vercel

1. **Import** the repo into Vercel; set the project **root directory** to `dashboard`.
2. Set environment variables (under *Project Settings → Environment Variables*):
   - `DATABASE_URL` — pooled Neon DSN (`?sslmode=require`)
   - `DATABASE_URL_UNPOOLED` — direct DSN for migrations
   - `VOICE_SERVICE_URL` — the public Hostinger URL (e.g. `https://voice.example.com`)
   - `VOICE_SERVICE_TOKEN` — same value as the voice-service container holds
   - `NEXT_PUBLIC_LIVEKIT_URL` — LiveKit Cloud WSS URL (used by the demo widget)
3. Vercel detects Next.js automatically; the `package.json` `build` script runs `prisma generate && next build`.
4. Run `npx prisma migrate deploy` from your laptop (or a CI job) before each deploy that includes new migrations — Vercel does not run migrations during build.

### voice-service → Hostinger Coolify (Docker)

1. Create a new Coolify resource → *Application* → *Dockerfile* → point to the `voice-service/` subfolder.
2. Set environment variables from `voice-service/.env.example`. Required:
   - `DATABASE_URL` (NeonDB pooled), `DATABASE_URL_UNPOOLED`
   - `VOICE_SERVICE_TOKEN` (same as Vercel side)
   - `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_WEBHOOK_SECRET`
   - `GOOGLE_API_KEY` for Gemini Live
   - At least one fallback `OPENAI_API_KEY` / `GROQ_API_KEY` / `ANTHROPIC_API_KEY`
   - At least one TTS key: `DEEPGRAM_API_KEY` / `SARVAM_API_KEY` / `ELEVENLABS_API_KEY`
   - SIP: `VOBIZ_SIP_DOMAIN`, `VOBIZ_USERNAME`, `VOBIZ_PASSWORD`, `VOBIZ_OUTBOUND_NUMBER`, `OUTBOUND_TRUNK_ID`
3. Expose port `8000`; configure Coolify's Traefik to terminate TLS and forward to it. Set the public hostname (e.g. `voice.example.com`) and copy that into the dashboard's `VOICE_SERVICE_URL`.
4. Healthcheck: `GET /health` (Coolify auto-detects the Dockerfile `HEALTHCHECK` directive).
5. After first deploy, configure the **LiveKit webhook**:
   - LiveKit dashboard → *Settings → Webhooks* → add `${VOICE_SERVICE_URL}/api/webhook/livekit`
   - Copy the LiveKit-issued secret into `LIVEKIT_WEBHOOK_SECRET`
6. Configure SIP trunks (one-time per LiveKit project):
   ```bash
   docker exec -it voice-service python sip/create_trunk.py
   docker exec -it voice-service python sip/setup_trunk.py
   ```

### Recordings (Cloudflare R2)

LiveKit Egress writes to R2 directly via S3-compatible credentials. Set `R2_*` vars on the voice-service. The webhook receiver at `/api/webhook/livekit` updates `calls.recordingUrl` when an `egress_ended` event arrives. The dashboard's *Calls → detail* page renders an `<audio>` player from that URL.

## Testing

```bash
# voice-service
cd voice-service && pytest -q
cd voice-service && python -m ruff check .

# dashboard
cd dashboard && npx tsc --noEmit
cd dashboard && npm run build
```

Voice-service tests use a mocked asyncpg pool. Integration tests against a real Neon test branch are a Plan-3 follow-up; for now schema correctness is verified by the migrations themselves and the dashboard's strict TypeScript types against the generated Prisma client.

## Key features

- **Inbound + outbound** — single agent process handles both directions; trunk type drives the metadata.
- **Bulk dialing** — Campaigns model with CSV uploader; APScheduler runs DAILY/WEEKDAYS schedules in IST.
- **Demo widget** — browser-based call to the AI without a phone number; mints LiveKit JWTs server-side.
- **Live log stream** — SSE feed of `error_logs` rows, viewable in the dashboard.
- **9 LLM tools** — check_availability, book_appointment, end_call, transfer_to_human, send_sms_confirmation, lookup_contact, remember_details, book_calcom, cancel_calcom.
- **Per-call config overrides** — drop a `voice-service/configs/<phone>.json` to override language preset, voice, model.
- **11 Indian language presets** — hinglish (default), hindi, english, tamil, telugu, gujarati, bengali, marathi, kannada, malayalam, multilingual.

## Status

Plan 1 (voice-service): **34/34 tests passing, ruff clean, Dockerfile validated**. Plan 2 (dashboard): **`npm run build` clean, 17 routes**. Plan 3 (deployment + docs): you're reading it.

## License & credits

Authored as part of the Rapid X AI build. LiveKit, Next.js, Prisma, and all third-party SDKs retain their own licenses.
