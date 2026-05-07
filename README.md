# OutboundAI — Rapid X AI Voice Platform

Production-grade outbound + inbound voice calling platform built on **LiveKit Agents 1.x** with a **Next.js 16** admin dashboard. Multi-provider STT/TTS (Deepgram, Sarvam, ElevenLabs, Cartesia), multi-LLM (Gemini Live default, OpenAI / Groq / Anthropic fallback), SIP telephony via Vobiz, NeonDB Postgres, Cal.com + Google Calendar appointment booking, Telegram + WhatsApp notifications, Cloudflare R2 for recordings, Sentry + structlog observability.

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
        │   │ Next.js 16        │  │ Python 3.11          │
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

### Recordings (Cloudflare R2)

LiveKit Egress writes to R2 directly via S3-compatible credentials. Set `R2_*` vars in the root `.env`. The webhook receiver at `/api/webhook/livekit` updates `calls.recordingUrl` when an `egress_ended` event arrives. The dashboard's *Calls → detail* page renders an `<audio>` player from that URL.

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
- **9 LLM tools** — check_availability, book_appointment, end_call, transfer_to_human, send_sms_confirmation, lookup_contact, remember_details, book_calcom, cancel_calcom.
- **Per-call config overrides** — drop a `voice-service/configs/<phone>.json` to override language preset, voice, model.
- **11 Indian language presets** — hinglish (default), hindi, english, tamil, telugu, gujarati, bengali, marathi, kannada, malayalam, multilingual.

## Status

Plan 1 (voice-service): **34/34 tests passing, ruff clean, Dockerfile validated**. Plan 2 (dashboard): **`npm run build` clean, 17 routes**. Plan 3 (deployment + docs): you're reading it.

## License & credits

Authored as part of the Rapid X AI build. LiveKit, Next.js, Prisma, and all third-party SDKs retain their own licenses.
