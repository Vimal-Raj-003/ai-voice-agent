# Voice Service Implementation Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade Python LiveKit voice agent service that handles inbound calls, outbound single calls, and bulk campaigns with Gemini Live as default and a multi-provider fallback chain (OpenAI/Groq/Claude/Sarvam/Deepgram/ElevenLabs/Cartesia).

**Architecture:** Two processes in one Docker container under supervisord — (a) `agent.py` LiveKit worker registers with LiveKit Cloud and joins rooms; (b) `server.py` FastAPI exposes dispatch, scheduler, healthcheck, and webhook endpoints. Both share a Neon Postgres connection pool via `asyncpg`. APScheduler runs in-process inside `server.py` for campaign cron scheduling.

**Tech Stack:** Python 3.11, livekit-agents 1.x, livekit-plugins-google (Gemini Live), FastAPI, Uvicorn, asyncpg, APScheduler, structlog, Sentry, Prometheus, supervisord.

**Spec reference:** `docs/superpowers/specs/2026-05-05-outboundai-build-design.md`

**Plan scope:** Phases 0–6 from the spec. Produces a deployable Docker image at the end.

**Plans 2 & 3:**
- `2026-05-05-dashboard.md` covers Next.js dashboard (phases 7–9)
- `2026-05-05-deployment-docs.md` covers Hostinger/Vercel deploy + docs (phases 10–11)

---

## File Structure (created/modified by this plan)

```
LIvekitAIVoice-main/
├── dashboard/prisma/schema.prisma              ← MODIFIED (Phase 0)
├── dashboard/prisma/seed.ts                    ← CREATED (Phase 0)
├── voice-service/                              ← CREATED entire tree
│   ├── agent.py
│   ├── server.py
│   ├── prompts.py
│   ├── tools.py
│   ├── db.py
│   ├── config.py
│   ├── language_presets.py
│   ├── calendar_tools.py
│   ├── notify.py
│   ├── make_call.py
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
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   ├── .env.example
│   ├── .dockerignore
│   ├── pyproject.toml
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py
│       ├── test_db.py
│       ├── test_tools.py
│       ├── test_prompts.py
│       ├── test_calendar_tools.py
│       ├── test_notify.py
│       └── test_agent_flow.py
```

---

## Phase 0 — Schema reconciliation

### Task 0.1: Add new enums to schema.prisma

**Files:**
- Modify: `dashboard/prisma/schema.prisma` (append at the end of the file)

- [ ] **Step 1: Append the new enum definitions**

```prisma
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

enum AppointmentStatus {
  BOOKED
  CANCELLED
  COMPLETED
  NO_SHOW
}

enum ScheduleType {
  ONCE
  DAILY
  WEEKDAYS
}

enum ErrorLevel {
  INFO
  WARNING
  ERROR
  CRITICAL
}
```

- [ ] **Step 2: Commit**

```bash
cd dashboard && git add prisma/schema.prisma && git commit -m "feat(schema): add CallOutcome, AppointmentStatus, ScheduleType, ErrorLevel enums"
```

---

### Task 0.2: Extend Call model

**Files:**
- Modify: `dashboard/prisma/schema.prisma` — locate the existing `model Call { ... }` block

- [ ] **Step 1: Add new optional fields to Call model**

Inside the existing `model Call` block, add these fields just before the closing `}`:

```prisma
  outcome              CallOutcome?
  reason               String?
  sentiment            String?       // positive | neutral | negative | frustrated
  interruptCount       Int           @default(0) @map("interrupt_count")
  costUsd              Decimal?      @db.Decimal(10, 6) @map("cost_usd")
  wasBooked            Boolean       @default(false) @map("was_booked")
  notes                String?
  callerHistoryLoaded  Boolean       @default(false) @map("caller_history_loaded")
```

(If `recordingUrl` is not already in the model, add `recordingUrl String? @map("recording_url")` too. If a `phoneNumber` field doesn't exist, add `phoneNumber String? @map("phone_number")`.)

Add this index inside the `model Call`:

```prisma
  @@index([phoneNumber, createdAt])
```

- [ ] **Step 2: Commit**

```bash
cd dashboard && git add prisma/schema.prisma && git commit -m "feat(schema): extend Call with outcome/sentiment/cost/notes"
```

---

### Task 0.3: Add AgentProfile model

**Files:**
- Modify: `dashboard/prisma/schema.prisma`

- [ ] **Step 1: Append the AgentProfile model**

```prisma
model AgentProfile {
  id            String   @id @default(cuid())
  name          String
  voice         String   @default("Aoede")
  model         String   @default("gemini-3.1-flash-live-preview")
  systemPrompt  String?  @map("system_prompt")
  enabledTools  String   @default("[]") @map("enabled_tools")
  isDefault     Boolean  @default(false) @map("is_default")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([isDefault])
  @@map("agent_profiles")
}
```

- [ ] **Step 2: Commit**

```bash
cd dashboard && git add prisma/schema.prisma && git commit -m "feat(schema): add AgentProfile model"
```

---

### Task 0.4: Add Contact + ContactMemory + Appointment models

**Files:**
- Modify: `dashboard/prisma/schema.prisma`

- [ ] **Step 1: Append models**

```prisma
model Contact {
  id            String   @id @default(cuid())
  phoneNumber   String   @unique @map("phone_number")
  name          String?
  email         String?
  notes         String?
  tags          String   @default("[]")
  totalCalls    Int      @default(0) @map("total_calls")
  lastCallAt    DateTime? @map("last_call_at")
  lastOutcome   String?  @map("last_outcome")
  isBooked      Boolean  @default(false) @map("is_booked")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  memory        ContactMemory[]
  appointments  Appointment[]

  @@map("contacts")
}

model ContactMemory {
  id            String   @id @default(cuid())
  phoneNumber   String   @map("phone_number")
  insight       String
  createdAt     DateTime @default(now()) @map("created_at")

  contact       Contact? @relation(fields: [phoneNumber], references: [phoneNumber], onDelete: Cascade)

  @@index([phoneNumber, createdAt])
  @@map("contact_memory")
}

model Appointment {
  id                String            @id @default(cuid())
  bookingId         String            @unique @map("booking_id")
  name              String
  phoneNumber       String            @map("phone_number")
  email             String?
  date              String
  time              String
  service           String
  status            AppointmentStatus @default(BOOKED)
  calcomBookingUid  String?           @map("calcom_booking_uid")
  gcalEventId       String?           @map("gcal_event_id")
  notes             String?
  createdAt         DateTime          @default(now()) @map("created_at")

  contact           Contact? @relation(fields: [phoneNumber], references: [phoneNumber])

  @@index([date, time])
  @@index([phoneNumber])
  @@map("appointments")
}
```

- [ ] **Step 2: Commit**

```bash
cd dashboard && git add prisma/schema.prisma && git commit -m "feat(schema): add Contact, ContactMemory, Appointment models"
```

---

### Task 0.5: Add Setting + ErrorLog + ActiveCall models

**Files:**
- Modify: `dashboard/prisma/schema.prisma`

- [ ] **Step 1: Append models**

```prisma
model Setting {
  key         String   @id
  value       String
  isSensitive Boolean  @default(false) @map("is_sensitive")
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@map("settings")
}

model ErrorLog {
  id        String     @id @default(cuid())
  source    String
  level     ErrorLevel @default(ERROR)
  message   String
  detail    String?
  timestamp DateTime   @default(now())

  @@index([timestamp])
  @@index([source, level])
  @@map("error_logs")
}

model ActiveCall {
  roomId       String   @id @map("room_id")
  phoneNumber  String?  @map("phone_number")
  callerName   String?  @map("caller_name")
  status       String   @default("ringing")
  startedAt    DateTime @default(now()) @map("started_at")
  lastUpdated  DateTime @default(now()) @updatedAt @map("last_updated")

  @@map("active_calls")
}
```

- [ ] **Step 2: Commit**

```bash
cd dashboard && git add prisma/schema.prisma && git commit -m "feat(schema): add Setting, ErrorLog, ActiveCall models"
```

---

### Task 0.6: Run Prisma migration to Neon

**Files:**
- Created: `dashboard/prisma/migrations/<timestamp>_outboundai_unified/migration.sql` (auto-generated)

- [ ] **Step 1: Generate and apply migration**

```bash
cd dashboard
npx prisma migrate dev --name outboundai_unified
```

Expected output: "✔ Applied migration", new files in `prisma/migrations/`, regenerated Prisma client.

- [ ] **Step 2: Verify schema in Neon**

```bash
npx prisma db execute --stdin <<'EOF'
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
EOF
```

Expected: `agent_profiles`, `appointments`, `contacts`, `contact_memory`, `settings`, `error_logs`, `active_calls` are all present alongside the existing tables (`calls`, `transcript_messages`, `campaigns`, etc.).

- [ ] **Step 3: Commit**

```bash
git add prisma/migrations/ && git commit -m "feat(db): apply outboundai_unified migration to Neon"
```

---

### Task 0.7: Seed default AgentProfile and example settings

**Files:**
- Create: `dashboard/prisma/seed.ts`
- Modify: `dashboard/package.json` — add `prisma.seed` field

- [ ] **Step 1: Create seed script**

```typescript
// dashboard/prisma/seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.agentProfile.findFirst({ where: { isDefault: true } });
  if (!existing) {
    await prisma.agentProfile.create({
      data: {
        name: "Priya — Default Booker",
        voice: "Aoede",
        model: "gemini-3.1-flash-live-preview",
        systemPrompt: null,  // null = use prompts.py default template
        enabledTools: JSON.stringify([
          "check_availability", "book_appointment", "end_call",
          "transfer_to_human", "send_sms_confirmation", "lookup_contact",
          "remember_details",
        ]),
        isDefault: true,
      },
    });
    console.log("✓ Seeded default AgentProfile");
  }

  await prisma.setting.upsert({
    where: { key: "ENVIRONMENT" },
    update: {},
    create: { key: "ENVIRONMENT", value: "development", isSensitive: false },
  });
  console.log("✓ Seeded ENVIRONMENT setting");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Wire seed into package.json**

Add this top-level key to `dashboard/package.json`:

```json
"prisma": {
  "seed": "tsx prisma/seed.ts"
}
```

Install `tsx` as a dev dependency:

```bash
cd dashboard && npm install -D tsx
```

- [ ] **Step 3: Run seed**

```bash
cd dashboard && npx prisma db seed
```

Expected output: `✓ Seeded default AgentProfile`, `✓ Seeded ENVIRONMENT setting`.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts package.json package-lock.json && git commit -m "feat(db): seed default AgentProfile and ENVIRONMENT setting"
```

---

## Phase 1 — Voice service foundation

### Task 1.1: Create voice-service directory scaffold

**Files:**
- Create: `voice-service/` directory and empty `__init__.py` files where needed

- [ ] **Step 1: Create directories**

```bash
mkdir -p voice-service/sip voice-service/configs voice-service/tests
touch voice-service/sip/__init__.py voice-service/tests/__init__.py
```

- [ ] **Step 2: Commit (empty markers)**

```bash
git add voice-service/ && git commit -m "chore(voice-service): scaffold directory tree"
```

---

### Task 1.2: Create requirements.txt

**Files:**
- Create: `voice-service/requirements.txt`

- [ ] **Step 1: Write requirements**

```
# LiveKit
livekit-agents>=1.4,<2.0
livekit-api>=1.1,<2.0
livekit-protocol>=1.1,<2.0
livekit-plugins-google>=1.4,<2.0
livekit-plugins-openai>=1.4,<2.0
livekit-plugins-deepgram>=1.4,<2.0
livekit-plugins-cartesia>=1.4,<2.0
livekit-plugins-elevenlabs>=1.4,<2.0
livekit-plugins-sarvam>=1.4,<2.0
livekit-plugins-silero>=1.4,<2.0
livekit-plugins-noise-cancellation>=0.2,<1.0

# Web framework
fastapi>=0.110,<1.0
uvicorn[standard]>=0.29,<1.0
python-multipart>=0.0.9,<1.0
sse-starlette>=2.0,<3.0
slowapi>=0.1.9,<1.0

# Database
asyncpg>=0.29,<1.0

# Scheduler
APScheduler>=3.10,<4.0

# AI providers
google-generativeai>=0.8,<1.0
openai>=1.40,<3.0
anthropic>=0.34,<1.0

# HTTP / utilities
httpx>=0.27,<1.0
python-dotenv>=1.0,<2.0
certifi>=2024.0
pytz>=2024.1
tiktoken>=0.7

# Calendar
google-api-python-client>=2.100,<3.0
google-auth>=2.30,<3.0
google-auth-httplib2>=0.2,<1.0

# Notifications
twilio>=8.0,<10.0

# Storage (Cloudflare R2 via boto3)
boto3>=1.34,<2.0

# Observability
sentry-sdk[fastapi]>=2.0,<3.0
prometheus-client>=0.20,<1.0
structlog>=24.0,<26.0

# Testing
pytest>=8.0,<9.0
pytest-asyncio>=0.23,<1.0
pytest-mock>=3.12,<4.0
respx>=0.21,<1.0
```

- [ ] **Step 2: Verify install in a throwaway venv**

```bash
cd voice-service
python -m venv .venv-check
source .venv-check/Scripts/activate    # Windows Git Bash
pip install --upgrade pip
pip install -r requirements.txt
deactivate
rm -rf .venv-check
```

Expected: install succeeds, no resolution errors.

- [ ] **Step 3: Commit**

```bash
git add voice-service/requirements.txt && git commit -m "feat(voice-service): pin Python dependencies"
```

---

### Task 1.3: Create pyproject.toml for pytest config

**Files:**
- Create: `voice-service/pyproject.toml`

- [ ] **Step 1: Write file**

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-v --tb=short"
filterwarnings = [
  "ignore::DeprecationWarning:livekit.*",
  "ignore::DeprecationWarning:google.*",
]

[tool.ruff]
line-length = 110
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "W", "I", "B", "UP"]
ignore = ["E501"]
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/pyproject.toml && git commit -m "chore(voice-service): pytest + ruff config"
```

---

### Task 1.4: Create .env.example

**Files:**
- Create: `voice-service/.env.example`

- [ ] **Step 1: Write file**

```bash
# ── Neon DB ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgres://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require
DATABASE_URL_UNPOOLED=postgres://USER:PASS@HOST.neon.tech/DBNAME?sslmode=require

# ── Cross-service auth ──────────────────────────────────────────────────────
VOICE_SERVICE_TOKEN=replace-with-secure-random-32-bytes-base64

# ── LiveKit Cloud ───────────────────────────────────────────────────────────
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
LIVEKIT_WEBHOOK_SECRET=

# ── Google Gemini ───────────────────────────────────────────────────────────
GOOGLE_API_KEY=
GEMINI_MODEL=gemini-3.1-flash-live-preview
GEMINI_TTS_VOICE=Aoede
USE_GEMINI_REALTIME=true

# ── LLM fallbacks ───────────────────────────────────────────────────────────
OPENAI_API_KEY=
GROQ_API_KEY=
ANTHROPIC_API_KEY=

# ── STT/TTS providers (optional) ────────────────────────────────────────────
DEEPGRAM_API_KEY=
SARVAM_API_KEY=
ELEVENLABS_API_KEY=
CARTESIA_API_KEY=

# ── Telephony / SIP (Vobiz) ─────────────────────────────────────────────────
VOBIZ_SIP_DOMAIN=
VOBIZ_USERNAME=
VOBIZ_PASSWORD=
VOBIZ_OUTBOUND_NUMBER=+91XXXXXXXXXX
OUTBOUND_TRUNK_ID=
INBOUND_TRUNK_ID=
DEFAULT_TRANSFER_NUMBER=

# ── Cloudflare R2 (recordings) ──────────────────────────────────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=call-recordings
R2_ENDPOINT=https://YOUR_ACCOUNT.r2.cloudflarestorage.com

# ── Cal.com (optional) ──────────────────────────────────────────────────────
CALCOM_API_KEY=
CALCOM_EVENT_TYPE_ID=
CALCOM_TIMEZONE=Asia/Kolkata

# ── Google Calendar (optional) ──────────────────────────────────────────────
GOOGLE_CALENDAR_ID=
GOOGLE_SERVICE_ACCOUNT_FILE=/app/google_creds.json

# ── Twilio (optional) ───────────────────────────────────────────────────────
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
TWILIO_WHATSAPP_NUMBER=

# ── Telegram (optional) ─────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=

# ── Webhooks (optional) ─────────────────────────────────────────────────────
N8N_WEBHOOK_URL=

# ── Observability ───────────────────────────────────────────────────────────
SENTRY_DSN=
ENVIRONMENT=development
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/.env.example && git commit -m "feat(voice-service): document all env vars"
```

---

### Task 1.5: Create config.py (port from existing)

**Files:**
- Create: `voice-service/config.py`

- [ ] **Step 1: Write the file**

```python
"""Static defaults and helpers. Anything mutable lives in Neon `settings` table."""

import os

# ── Telephony defaults ────────────────────────────────────────────────────────
DEFAULT_TRANSFER_NUMBER = os.getenv("DEFAULT_TRANSFER_NUMBER", "")
SIP_DOMAIN              = os.getenv("VOBIZ_SIP_DOMAIN", "")
OUTBOUND_TRUNK_ID       = os.getenv("OUTBOUND_TRUNK_ID", "")
INBOUND_TRUNK_ID        = os.getenv("INBOUND_TRUNK_ID", "")

# ── Gemini Live defaults ──────────────────────────────────────────────────────
GEMINI_MODEL            = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
GEMINI_TTS_VOICE        = os.getenv("GEMINI_TTS_VOICE", "Aoede")
USE_GEMINI_REALTIME     = os.getenv("USE_GEMINI_REALTIME", "true").lower() != "false"

# ── Pipeline-mode fallbacks ───────────────────────────────────────────────────
DEFAULT_LLM_PROVIDER    = "openai"   # openai | groq | claude
DEFAULT_LLM_MODEL       = "gpt-4o-mini"
GROQ_MODEL              = "llama-3.3-70b-versatile"
GROQ_TEMPERATURE        = 0.7

DEFAULT_STT_PROVIDER    = "deepgram"  # deepgram | sarvam
STT_MODEL               = "nova-3"
STT_LANGUAGE            = "multi"

DEFAULT_TTS_PROVIDER    = "sarvam"    # sarvam | elevenlabs | cartesia | openai | google
SARVAM_MODEL            = "bulbul:v3"
SARVAM_LANGUAGE         = "hi-IN"
CARTESIA_MODEL          = "sonic-2"
CARTESIA_VOICE          = "f786b574-daa5-4673-aa0c-cbe3e8534c02"

# ── Limits ────────────────────────────────────────────────────────────────────
MAX_TURNS_PER_CALL      = int(os.getenv("MAX_TURNS_PER_CALL", "25"))
RATE_LIMIT_CALLS_PER_HOUR = int(os.getenv("RATE_LIMIT_CALLS_PER_HOUR", "5"))
RATE_LIMIT_WINDOW       = 3600  # seconds

# ── Recording ─────────────────────────────────────────────────────────────────
R2_BUCKET               = os.getenv("R2_BUCKET", "call-recordings")
R2_ENDPOINT             = os.getenv("R2_ENDPOINT", "")

# ── Misc ──────────────────────────────────────────────────────────────────────
ENVIRONMENT             = os.getenv("ENVIRONMENT", "development")
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/config.py && git commit -m "feat(voice-service): config.py with static defaults"
```

---

### Task 1.6: Create language_presets.py

**Files:**
- Create: `voice-service/language_presets.py`

- [ ] **Step 1: Write file**

```python
"""Language presets for multilingual TTS/STT directives — ported from InboundAI."""

LANGUAGE_PRESETS: dict[str, dict[str, str]] = {
    "hinglish":     {"label": "Hinglish (Hindi+English)", "tts_language": "hi-IN", "tts_voice": "kavya",
                     "instruction": "Speak in natural Hinglish — mix Hindi and English like educated Indians do. Default to Hindi but use English words when more natural."},
    "hindi":        {"label": "Hindi",                    "tts_language": "hi-IN", "tts_voice": "ritu",
                     "instruction": "Speak only in pure Hindi. Avoid English words wherever a Hindi equivalent exists."},
    "english":      {"label": "English (India)",          "tts_language": "en-IN", "tts_voice": "dev",
                     "instruction": "Speak only in Indian English with a warm, professional tone."},
    "tamil":        {"label": "Tamil",                    "tts_language": "ta-IN", "tts_voice": "priya",
                     "instruction": "Speak only in Tamil. Use standard spoken Tamil for a professional context."},
    "telugu":       {"label": "Telugu",                   "tts_language": "te-IN", "tts_voice": "kavya",
                     "instruction": "Speak only in Telugu. Use clear, polite spoken Telugu."},
    "gujarati":     {"label": "Gujarati",                 "tts_language": "gu-IN", "tts_voice": "rohan",
                     "instruction": "Speak only in Gujarati. Use polite, professional Gujarati."},
    "bengali":      {"label": "Bengali",                  "tts_language": "bn-IN", "tts_voice": "neha",
                     "instruction": "Speak only in Bengali (Bangla). Use standard, polite spoken Bengali."},
    "marathi":      {"label": "Marathi",                  "tts_language": "mr-IN", "tts_voice": "shubh",
                     "instruction": "Speak only in Marathi. Use polite, standard spoken Marathi."},
    "kannada":      {"label": "Kannada",                  "tts_language": "kn-IN", "tts_voice": "rahul",
                     "instruction": "Speak only in Kannada. Use clear, professional spoken Kannada."},
    "malayalam":    {"label": "Malayalam",                "tts_language": "ml-IN", "tts_voice": "ritu",
                     "instruction": "Speak only in Malayalam. Use polite, professional spoken Malayalam."},
    "multilingual": {"label": "Multilingual (Auto)",      "tts_language": "hi-IN", "tts_voice": "kavya",
                     "instruction": "Detect the caller's language from their first message and reply in that SAME language for the entire call. Supported: Hindi, Hinglish, English, Tamil, Telugu, Gujarati, Bengali, Marathi, Kannada, Malayalam. Switch if caller switches."},
}


def get_language_directive(preset: str) -> str:
    """Return a system-prompt block enforcing the chosen language."""
    p = LANGUAGE_PRESETS.get(preset, LANGUAGE_PRESETS["multilingual"])
    return f"\n\n[LANGUAGE DIRECTIVE]\n{p['instruction']}"


def get_preset_voice(preset: str) -> tuple[str, str]:
    """Return (tts_language, tts_voice) tuple for a preset."""
    p = LANGUAGE_PRESETS.get(preset, LANGUAGE_PRESETS["multilingual"])
    return p["tts_language"], p["tts_voice"]
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/language_presets.py && git commit -m "feat(voice-service): 11 language presets"
```

---

### Task 1.7: Create db.py with asyncpg pool — Settings + ErrorLog

**Files:**
- Create: `voice-service/db.py`
- Create: `voice-service/tests/test_db.py`

- [ ] **Step 1: Write the failing test for connection pool**

```python
# voice-service/tests/test_db.py
import os
import pytest
from unittest.mock import AsyncMock, patch

import db


@pytest.mark.asyncio
async def test_get_pool_returns_singleton():
    db._pool = None  # reset
    fake_pool = AsyncMock()
    with patch("db.asyncpg.create_pool", return_value=fake_pool) as create:
        a = await db.get_pool()
        b = await db.get_pool()
        assert a is b
        create.assert_called_once()


@pytest.mark.asyncio
async def test_close_pool_resets_singleton():
    db._pool = AsyncMock()
    await db.close_pool()
    assert db._pool is None
```

- [ ] **Step 2: Run test — verify FAIL (db module doesn't exist)**

```bash
cd voice-service && pytest tests/test_db.py -v
```

Expected: `ModuleNotFoundError: No module named 'db'`.

- [ ] **Step 3: Write minimal db.py with pool**

```python
# voice-service/db.py
"""Neon DB layer — asyncpg pool + async functions matching the spec API surface."""

from __future__ import annotations

import json
import os
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg

# ── Pool lifecycle ────────────────────────────────────────────────────────────

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        dsn = os.environ["DATABASE_URL"]
        _pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=2,
            max_size=10,
            command_timeout=30,
            statement_cache_size=0,  # Neon pgbouncer doesn't support prepared statements
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd voice-service && pytest tests/test_db.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Add settings + error log functions to db.py**

Append to `voice-service/db.py`:

```python
# ── Constants ─────────────────────────────────────────────────────────────────
SENSITIVE_KEYS = {
    "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_WEBHOOK_SECRET",
    "GOOGLE_API_KEY", "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
    "DEEPGRAM_API_KEY", "SARVAM_API_KEY", "ELEVENLABS_API_KEY", "CARTESIA_API_KEY",
    "VOBIZ_PASSWORD", "TWILIO_AUTH_TOKEN",
    "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
    "CALCOM_API_KEY", "TELEGRAM_BOT_TOKEN", "VOICE_SERVICE_TOKEN",
}

KNOWN_SETTING_KEYS = [
    "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_WEBHOOK_SECRET",
    "GOOGLE_API_KEY", "GEMINI_MODEL", "GEMINI_TTS_VOICE", "USE_GEMINI_REALTIME",
    "OPENAI_API_KEY", "GROQ_API_KEY", "ANTHROPIC_API_KEY",
    "DEEPGRAM_API_KEY", "SARVAM_API_KEY", "ELEVENLABS_API_KEY", "CARTESIA_API_KEY",
    "VOBIZ_SIP_DOMAIN", "VOBIZ_USERNAME", "VOBIZ_PASSWORD", "VOBIZ_OUTBOUND_NUMBER",
    "OUTBOUND_TRUNK_ID", "INBOUND_TRUNK_ID", "DEFAULT_TRANSFER_NUMBER",
    "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT",
    "CALCOM_API_KEY", "CALCOM_EVENT_TYPE_ID", "CALCOM_TIMEZONE",
    "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "TWILIO_WHATSAPP_NUMBER",
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
    "N8N_WEBHOOK_URL", "ENABLED_TOOLS",
]


# ── Settings ──────────────────────────────────────────────────────────────────

async def get_all_settings() -> dict[str, dict[str, Any]]:
    """Returns {key: {"value": str, "configured": bool}}. Sensitive values masked."""
    pool = await get_pool()
    out: dict[str, dict[str, Any]] = {}
    for k in KNOWN_SETTING_KEYS:
        env_val = os.getenv(k, "")
        if k in SENSITIVE_KEYS:
            out[k] = {"value": "", "configured": bool(env_val)}
        else:
            out[k] = {"value": env_val, "configured": bool(env_val)}
    rows = await pool.fetch("SELECT key, value FROM settings")
    for r in rows:
        k, v = r["key"], r["value"]
        if k in SENSITIVE_KEYS:
            out[k] = {"value": "", "configured": bool(v)}
        else:
            out[k] = {"value": v, "configured": bool(v)}
    return out


async def save_settings(data: dict[str, Any]) -> None:
    pool = await get_pool()
    rows = [(k, str(v), k in SENSITIVE_KEYS) for k, v in data.items() if v not in (None, "")]
    if not rows:
        return
    await pool.executemany(
        """INSERT INTO settings (key, value, is_sensitive, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        rows,
    )


async def get_setting(key: str, default: str = "") -> str:
    pool = await get_pool()
    val = await pool.fetchval("SELECT value FROM settings WHERE key = $1", key)
    return val or os.getenv(key, default)


async def set_setting(key: str, value: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO settings (key, value, is_sensitive, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()""",
        key, value, key in SENSITIVE_KEYS,
    )


async def get_enabled_tools() -> list[str]:
    raw = await get_setting("ENABLED_TOOLS", "")
    if not raw:
        return []
    try:
        result = json.loads(raw)
        return result if isinstance(result, list) else []
    except Exception:
        return []


# ── Error logs ────────────────────────────────────────────────────────────────

async def log_error(source: str, message: str, detail: str = "", level: str = "ERROR") -> None:
    try:
        pool = await get_pool()
        await pool.execute(
            """INSERT INTO error_logs (id, source, level, message, detail, timestamp)
               VALUES ($1, $2, $3::"ErrorLevel", $4, $5, now())""",
            str(uuid.uuid4()), source, level.upper(), message[:500], detail[:2000],
        )
    except Exception:
        pass  # never let logging break the caller


async def get_errors(limit: int = 100) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT $1", limit,
    )
    return [dict(r) for r in rows]


async def get_logs(level: Optional[str] = None, source: Optional[str] = None, limit: int = 200) -> list[dict]:
    pool = await get_pool()
    clauses = ["1 = 1"]
    args: list[Any] = []
    if level:
        args.append(level.upper())
        clauses.append(f'level = ${len(args)}::"ErrorLevel"')
    if source:
        args.append(source)
        clauses.append(f"source = ${len(args)}")
    args.append(limit)
    sql = f"SELECT * FROM error_logs WHERE {' AND '.join(clauses)} ORDER BY timestamp DESC LIMIT ${len(args)}"
    rows = await pool.fetch(sql, *args)
    return [dict(r) for r in rows]


async def clear_errors() -> None:
    pool = await get_pool()
    await pool.execute("DELETE FROM error_logs")
```

- [ ] **Step 6: Add settings tests**

Append to `voice-service/tests/test_db.py`:

```python
@pytest.mark.asyncio
async def test_get_all_settings_masks_sensitive(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setenv("LIVEKIT_URL", "wss://test")
    fake_pool = AsyncMock()
    fake_pool.fetch.return_value = []
    db._pool = fake_pool
    result = await db.get_all_settings()
    assert result["OPENAI_API_KEY"]["value"] == ""
    assert result["OPENAI_API_KEY"]["configured"] is True
    assert result["LIVEKIT_URL"]["value"] == "wss://test"
```

- [ ] **Step 7: Run all db tests**

```bash
cd voice-service && pytest tests/test_db.py -v
```

Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add voice-service/db.py voice-service/tests/test_db.py && git commit -m "feat(db): asyncpg pool + settings + error log functions"
```

---

### Task 1.8: Add Appointments + Calls + Contact Memory functions to db.py

**Files:**
- Modify: `voice-service/db.py`
- Modify: `voice-service/tests/test_db.py`

- [ ] **Step 1: Append appointment + call + memory functions to db.py**

```python
# ── Appointments ──────────────────────────────────────────────────────────────

async def insert_appointment(name: str, phone: str, date: str, time: str, service: str) -> str:
    booking_id = str(uuid.uuid4())[:8].upper()
    full_id    = str(uuid.uuid4())
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO appointments (id, booking_id, name, phone_number, date, time, service, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'BOOKED'::"AppointmentStatus", now())""",
        full_id, booking_id, name, phone, date, time, service,
    )
    return booking_id


async def check_slot(date: str, time: str) -> bool:
    pool = await get_pool()
    existing = await pool.fetchval(
        """SELECT id FROM appointments
           WHERE date = $1 AND time = $2 AND status = 'BOOKED'::"AppointmentStatus" LIMIT 1""",
        date, time,
    )
    return existing is None


async def get_next_available(date: str, time: str) -> str:
    try:
        dt = datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")
    except ValueError:
        dt = datetime.now().replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    for _ in range(7 * 24):
        dt += timedelta(hours=1)
        if 9 <= dt.hour < 18:
            if await check_slot(dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")):
                return f"{dt.strftime('%Y-%m-%d')} at {dt.strftime('%H:%M')}"
    return "no open slots found in the next 7 days"


async def get_all_appointments(date_filter: Optional[str] = None) -> list[dict]:
    pool = await get_pool()
    if date_filter:
        rows = await pool.fetch(
            "SELECT * FROM appointments WHERE date = $1 ORDER BY date, time", date_filter,
        )
    else:
        rows = await pool.fetch("SELECT * FROM appointments ORDER BY date, time")
    return [dict(r) for r in rows]


async def cancel_appointment(appointment_id: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        """UPDATE appointments SET status = 'CANCELLED'::"AppointmentStatus"
           WHERE id = $1 AND status = 'BOOKED'::"AppointmentStatus" """,
        appointment_id,
    )
    return result.endswith(" 1")


async def get_appointments_by_phone(phone: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM appointments WHERE phone_number = $1 ORDER BY date DESC", phone,
    )
    return [dict(r) for r in rows]


# ── Calls ─────────────────────────────────────────────────────────────────────

async def log_call(
    phone_number: str, lead_name: Optional[str], outcome: str, reason: str,
    duration_seconds: int, recording_url: Optional[str] = None, notes: Optional[str] = None,
    sentiment: Optional[str] = None, cost_usd: Optional[float] = None,
    interrupt_count: int = 0, was_booked: bool = False, transcript: Optional[str] = None,
) -> str:
    """Insert a row into calls. Returns the call id."""
    pool = await get_pool()
    call_id = str(uuid.uuid4())
    await pool.execute(
        """INSERT INTO calls (
                id, phone_number, lead_name, outcome, reason, duration_seconds,
                recording_url, notes, sentiment, cost_usd, interrupt_count, was_booked,
                transcript, created_at, updated_at, status, direction
           ) VALUES (
                $1, $2, $3, $4::"CallOutcome", $5, $6, $7, $8, $9, $10, $11, $12,
                $13, now(), now(), 'COMPLETED'::"CallStatus", 'OUTBOUND'::"CallDirection"
           )""",
        call_id, phone_number, lead_name, outcome.upper(), reason, duration_seconds,
        recording_url, notes, sentiment, cost_usd, interrupt_count, was_booked, transcript,
    )
    # upsert contact
    await pool.execute(
        """INSERT INTO contacts (id, phone_number, name, total_calls, last_call_at, last_outcome, is_booked, created_at, updated_at)
           VALUES ($1, $2, $3, 1, now(), $4, $5, now(), now())
           ON CONFLICT (phone_number) DO UPDATE SET
             total_calls = contacts.total_calls + 1,
             last_call_at = now(),
             last_outcome = EXCLUDED.last_outcome,
             is_booked = contacts.is_booked OR EXCLUDED.is_booked,
             name = COALESCE(contacts.name, EXCLUDED.name),
             updated_at = now()""",
        str(uuid.uuid4()), phone_number, lead_name, outcome.upper(), was_booked,
    )
    return call_id


async def get_all_calls(page: int = 1, limit: int = 20) -> list[dict]:
    pool = await get_pool()
    offset = (page - 1) * limit
    rows = await pool.fetch(
        "SELECT * FROM calls ORDER BY created_at DESC LIMIT $1 OFFSET $2", limit, offset,
    )
    return [dict(r) for r in rows]


async def get_calls_by_phone(phone: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM calls WHERE phone_number = $1 ORDER BY created_at DESC", phone,
    )
    return [dict(r) for r in rows]


async def update_call_notes(call_id: str, notes: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        "UPDATE calls SET notes = $1, updated_at = now() WHERE id = $2", notes, call_id,
    )
    return result.endswith(" 1")


# ── Contact Memory ────────────────────────────────────────────────────────────

async def add_contact_memory(phone: str, insight: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO contact_memory (id, phone_number, insight, created_at)
           VALUES ($1, $2, $3, now())""",
        str(uuid.uuid4()), phone, insight[:1000],
    )


async def get_contact_memory(phone: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT insight, created_at FROM contact_memory
           WHERE phone_number = $1 ORDER BY created_at DESC LIMIT 20""",
        phone,
    )
    return [dict(r) for r in rows]


async def compress_contact_memory(phone: str, compressed: str) -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM contact_memory WHERE phone_number = $1", phone)
            await conn.execute(
                """INSERT INTO contact_memory (id, phone_number, insight, created_at)
                   VALUES ($1, $2, $3, now())""",
                str(uuid.uuid4()), phone, compressed[:2000],
            )


# ── Stats ─────────────────────────────────────────────────────────────────────

async def get_stats() -> dict:
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT outcome, duration_seconds, was_booked, created_at FROM calls
           WHERE created_at >= now() - interval '30 days'""",
    )
    rows = [dict(r) for r in rows]
    total = len(rows)
    booked = sum(1 for r in rows if r.get("was_booked"))
    not_int = sum(1 for r in rows if r.get("outcome") == "NOT_INTERESTED")
    durs = [r["duration_seconds"] for r in rows if r.get("duration_seconds")]
    avg = round(sum(durs) / len(durs), 1) if durs else 0
    rate = round((booked / total * 100), 1) if total else 0
    outcomes: dict[str, int] = {}
    for r in rows:
        o = r.get("outcome") or "UNKNOWN"
        outcomes[o] = outcomes.get(o, 0) + 1
    daily: dict[str, int] = defaultdict(int)
    for r in rows:
        ts = r["created_at"].date().isoformat() if r.get("created_at") else None
        if ts:
            daily[ts] += 1
    today = datetime.now(timezone.utc).date()
    timeline = [
        {"date": (today - timedelta(days=i)).isoformat(),
         "count": daily.get((today - timedelta(days=i)).isoformat(), 0)}
        for i in range(13, -1, -1)
    ]
    return {
        "total_calls": total, "booked": booked, "not_interested": not_int,
        "avg_duration_seconds": avg, "booking_rate_percent": rate,
        "outcomes": outcomes, "timeline": timeline,
    }


# ── Active calls ──────────────────────────────────────────────────────────────

async def upsert_active_call(room_id: str, phone: str, caller_name: str = "", status: str = "active") -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO active_calls (room_id, phone_number, caller_name, status, started_at, last_updated)
           VALUES ($1, $2, $3, $4, now(), now())
           ON CONFLICT (room_id) DO UPDATE SET
             status = EXCLUDED.status, last_updated = now()""",
        room_id, phone, caller_name, status,
    )


async def remove_active_call(room_id: str) -> None:
    pool = await get_pool()
    await pool.execute("DELETE FROM active_calls WHERE room_id = $1", room_id)


async def get_active_calls() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM active_calls ORDER BY started_at DESC")
    return [dict(r) for r in rows]


# ── Real-time transcript ──────────────────────────────────────────────────────

async def insert_transcript_message(call_id: str, room_name: str, role: str, content: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO transcript_messages (id, call_id, role, content, created_at)
           VALUES ($1, $2, $3::"TranscriptRole", $4, now())""",
        str(uuid.uuid4()), call_id, role.upper(), content,
    )


async def get_transcript(call_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM transcript_messages WHERE call_id = $1 ORDER BY created_at", call_id,
    )
    return [dict(r) for r in rows]


# ── Agent profiles ────────────────────────────────────────────────────────────

async def get_all_agent_profiles() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM agent_profiles ORDER BY is_default DESC, created_at")
    return [dict(r) for r in rows]


async def get_agent_profile(profile_id: str) -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM agent_profiles WHERE id = $1", profile_id)
    return dict(row) if row else None


async def get_default_agent_profile() -> Optional[dict]:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM agent_profiles WHERE is_default = true LIMIT 1",
    )
    return dict(row) if row else None
```

- [ ] **Step 2: Run tests — verify still pass (functions are pure additions)**

```bash
cd voice-service && pytest tests/test_db.py -v
```

Expected: 3 passed (existing tests unchanged).

- [ ] **Step 3: Commit**

```bash
git add voice-service/db.py voice-service/tests/test_db.py && git commit -m "feat(db): appointments, calls, contact memory, stats, active_calls, transcripts, agent profiles"
```

---

### Task 1.9: Add Sentry + structlog initialization

**Files:**
- Create: `voice-service/observability.py`

- [ ] **Step 1: Write file**

```python
"""Sentry + structlog init. Imported once at app start."""

import logging
import os
import sys

import sentry_sdk
import structlog
from sentry_sdk.integrations.asyncio import AsyncioIntegration


def init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN", "")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=0.1,
            integrations=[AsyncioIntegration()],
            environment=os.getenv("ENVIRONMENT", "production"),
            release=os.getenv("RELEASE_SHA", "unknown"),
        )

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            timestamper,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
    )

    # Quiet noisy loggers
    for noisy in ("httpx", "httpcore", "hpack", "google.auth.transport", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.BoundLogger:
    return structlog.get_logger(name)
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/observability.py && git commit -m "feat(voice-service): Sentry + structlog initialization"
```

---

### Task 1.10: Create tests/conftest.py with mock pool fixture

**Files:**
- Create: `voice-service/tests/conftest.py`

- [ ] **Step 1: Write fixture**

```python
"""Shared pytest fixtures."""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock

import db


@pytest_asyncio.fixture
async def mock_pool(monkeypatch):
    """Replace the asyncpg pool with an AsyncMock for unit tests."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = None
    pool.fetchrow.return_value = None
    pool.execute.return_value = "INSERT 0 1"
    monkeypatch.setattr(db, "_pool", pool)
    yield pool


@pytest_asyncio.fixture(autouse=True)
async def isolate_db(monkeypatch):
    """Ensure each test starts with a fresh _pool=None unless mock_pool is used."""
    monkeypatch.setattr(db, "_pool", None)
```

- [ ] **Step 2: Run all tests — verify still pass**

```bash
cd voice-service && pytest tests/ -v
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add voice-service/tests/conftest.py && git commit -m "test(voice-service): pytest fixtures for mock pool"
```

---

## Phase 2 — Python agent core

### Task 2.1: Create prompts.py with DEFAULT_SYSTEM_PROMPT

**Files:**
- Create: `voice-service/prompts.py`
- Create: `voice-service/tests/test_prompts.py`

- [ ] **Step 1: Write the failing test**

```python
# voice-service/tests/test_prompts.py
import pytest

from prompts import build_prompt, DEFAULT_SYSTEM_PROMPT, count_tokens


def test_default_prompt_contains_priya_marker():
    assert "Priya" in DEFAULT_SYSTEM_PROMPT


def test_build_prompt_interpolates_lead_name():
    out = build_prompt(lead_name="Ravi", business_name="Acme Dental", service_type="cleaning")
    assert "Ravi" in out
    assert "Acme Dental" in out
    assert "cleaning" in out


def test_build_prompt_uses_custom_prompt():
    out = build_prompt(lead_name="X", custom_prompt="Hello {lead_name}!")
    assert out.startswith("Hello X!")


def test_build_prompt_silently_falls_back_on_keyerror():
    # custom prompt with placeholder we don't supply
    out = build_prompt(custom_prompt="Hello {unknown_field}!")
    assert "{unknown_field}" in out


def test_build_prompt_appends_language_directive():
    out = build_prompt(language_preset="hindi")
    assert "[LANGUAGE DIRECTIVE]" in out
    assert "Hindi" in out


def test_build_prompt_appends_ist_time_context():
    out = build_prompt()
    assert "[SYSTEM CONTEXT]" in out
    assert "IST" in out


def test_count_tokens_returns_positive_int():
    n = count_tokens("Hello world")
    assert isinstance(n, int)
    assert n > 0
```

- [ ] **Step 2: Run test — verify FAIL**

```bash
cd voice-service && pytest tests/test_prompts.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write prompts.py**

```python
# voice-service/prompts.py
"""System-prompt template + helpers. Combines new spec's Priya template, IST time context, and language directives."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytz

from language_presets import get_language_directive


DEFAULT_SYSTEM_PROMPT = """\
You are Priya, a sharp, warm, and professional appointment booking assistant calling on behalf of {business_name}.

Your single goal: book a {service_type} appointment for {lead_name}.

━━━ CRITICAL: SPEAK FIRST ━━━
The moment the call connects, you speak immediately. Do NOT wait for the lead to say anything.
Open with: "Hi, am I speaking with {lead_name}?"

━━━ CALL FLOW ━━━

STEP 1 — CONFIRM IDENTITY
"Hi, am I speaking with {lead_name}?"
• Wrong person  → apologise briefly → end_call(outcome='wrong_number', reason='wrong person answered')
• Voicemail/IVR → leave message: "Hi {lead_name}, this is Priya from {business_name} regarding your {service_type}. Please call us back — have a great day!" → end_call(outcome='voicemail', reason='left voicemail')
• No answer / silence for 5 s → end_call(outcome='no_answer', reason='no response')

STEP 2 — INTRODUCE
"Great! I'm Priya from {business_name}. We have some slots open this week for {service_type} and I wanted to get you booked in — takes less than a minute."

STEP 3 — QUALIFY INTEREST
Ask one short question. If yes → STEP 4.
If no → ask once if a different time works. Second refusal → end_call(outcome='not_interested', reason='lead declined twice').

STEP 4 — FIND A SLOT
Ask: "What day and time works best for you?"
ALWAYS call check_availability(date, time) before confirming anything.
If slot unavailable → "That one's taken — how about [next available]?"

STEP 5 — BOOK
Once lead verbally agrees to date + time:
1. Call book_appointment(name, phone, date, time, service)
2. Call send_sms_confirmation(phone, "Your {service_type} at {business_name} is confirmed for [date] at [time]. See you then!")

STEP 6 — CLOSE
"Perfect, you're all set for [date] at [time]! Is there anything else before I let you go?"
→ end_call(outcome='booked', reason='appointment confirmed')

━━━ OBJECTION HANDLING ━━━

"I'm busy right now"      → "Completely fine — I'll be quick. We have a slot tomorrow morning, would that work?"
"Not interested"          → "No worries at all. If anything changes, feel free to call us. Have a great day!" → end_call(outcome='not_interested')
"Who gave you my number?" → "We have you on file from a previous inquiry with {business_name}. Apologies if the timing is off."
"Stop calling"            → "Absolutely, I'll make a note right now. Sorry for the interruption!" → end_call(outcome='not_interested', reason='requested removal')
"Transfer to a human"     → transfer_to_human(reason='lead requested human agent')
"Are you a bot/AI?"       → "I'm a virtual assistant for {business_name} — I can still get you fully booked in though! Shall we find a time?"
"Call me later"           → "Of course — what time works best for a callback?" → remember_details("Requested callback") → end_call(outcome='callback_requested', reason='will call back')

━━━ STYLE RULES ━━━

• Maximum 1–2 short sentences per turn. Cut every filler word.
• NEVER start with "Certainly!", "Of course!", "Absolutely!" or any filler opener.
• NEVER say "As an AI" unless directly and persistently asked.
• Match the lead's language — Hindi/English code-switching is fine.
• If lead says "hold on" or goes quiet, wait silently — do not fill silence.
• Always sound like a real person: casual, warm, confident.
• Respond in under 10 words where possible.
• Use the lookup_contact tool at the start of every call to retrieve prior history.
• Use remember_details any time the lead shares something useful (preferences, objections, timing).

━━━ TOOL USAGE RULES ━━━

• lookup_contact  → call at call start ONLY (before any conversation)
• check_availability → ALWAYS before confirming a slot
• book_appointment → only after verbal confirmation
• end_call → ALWAYS call this at call end (never just hang up silently)
• remember_details → use freely throughout — more context = better future calls
"""


def get_ist_time_context() -> str:
    ist = pytz.timezone("Asia/Kolkata")
    now = datetime.now(ist)
    today = now.strftime("%A, %B %d, %Y")
    tstr = now.strftime("%I:%M %p")
    days = []
    for i in range(7):
        d = now + timedelta(days=i)
        label = "Today" if i == 0 else ("Tomorrow" if i == 1 else d.strftime("%A"))
        days.append(f"  {label}: {d.strftime('%A %d %B %Y')} → ISO {d.strftime('%Y-%m-%d')}")
    return (
        f"\n\n[SYSTEM CONTEXT]\n"
        f"Current date & time: {today} at {tstr} IST\n"
        f"Resolve ALL relative day references using this table:\n"
        + "\n".join(days)
        + "\nAlways use ISO dates when calling save_booking_intent. Appointments in IST (+05:30)."
    )


def count_tokens(text: str) -> int:
    try:
        import tiktoken
        return len(tiktoken.encoding_for_model("gpt-4o").encode(text))
    except Exception:
        return len(text.split())


def build_prompt(
    lead_name: str = "there",
    business_name: str = "our company",
    service_type: str = "our service",
    custom_prompt: str | None = None,
    language_preset: str = "multilingual",
    caller_history: str = "",
) -> str:
    template = custom_prompt if custom_prompt else DEFAULT_SYSTEM_PROMPT
    try:
        body = template.format(
            lead_name=lead_name,
            business_name=business_name,
            service_type=service_type,
        )
    except KeyError:
        body = template
    body += get_ist_time_context()
    body += get_language_directive(language_preset)
    if caller_history:
        body += f"\n\n[CALLER HISTORY]\n{caller_history}"
    return body
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd voice-service && pytest tests/test_prompts.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add voice-service/prompts.py voice-service/tests/test_prompts.py && git commit -m "feat(voice-service): prompts.py with Priya template + IST + language directive"
```

---

### Task 2.2: Create agent.py — SSL patch + imports + module skeleton

**Files:**
- Create: `voice-service/agent.py`

- [ ] **Step 1: Write skeleton**

```python
# voice-service/agent.py
"""LiveKit voice agent worker — handles inbound + outbound calls with Gemini Live default."""

from __future__ import annotations

import os
import ssl
from typing import Any

import certifi

# ── SSL patch (must happen before any networking imports) ────────────────────
_orig_ssl = ssl.create_default_context
def _certifi_ssl(purpose=ssl.Purpose.SERVER_AUTH, **kwargs):
    if not kwargs.get("cafile") and not kwargs.get("capath") and not kwargs.get("cadata"):
        kwargs["cafile"] = certifi.where()
    return _orig_ssl(purpose, **kwargs)
ssl.create_default_context = _certifi_ssl  # type: ignore[assignment]

import asyncio
import json
import re
import time
from collections import defaultdict
from datetime import datetime

from dotenv import load_dotenv
from livekit import agents, api
from livekit.agents import Agent, AgentSession, JobContext, RoomInputOptions, WorkerOptions, cli, llm
from livekit.plugins import noise_cancellation, silero

import config
import db
from observability import init_observability, get_logger
from prompts import build_prompt, count_tokens
from language_presets import LANGUAGE_PRESETS

load_dotenv(".env")
init_observability()
logger = get_logger("agent")

# ── Optional plugin imports ──────────────────────────────────────────────────
_google_realtime: Any = None
_google_beta_realtime: Any = None
_google_llm: Any = None
_google_tts: Any = None
try:
    from livekit.plugins import google as _gp  # noqa: WPS440
    _google_realtime = getattr(getattr(_gp, "realtime", None), "RealtimeModel", None)
    _google_beta_realtime = getattr(getattr(getattr(_gp, "beta", None), "realtime", None), "RealtimeModel", None)
    _google_llm = getattr(_gp, "LLM", None)
    _google_tts = getattr(_gp, "TTS", None)
except ImportError:
    logger.warning("livekit-plugins-google not installed")

_deepgram_stt: Any = None
try:
    from livekit.plugins import deepgram as _dg
    _deepgram_stt = _dg.STT
except ImportError:
    pass

_sarvam: Any = None
try:
    from livekit.plugins import sarvam as _sarvam_mod
    _sarvam = _sarvam_mod
except ImportError:
    pass

_elevenlabs: Any = None
try:
    from livekit.plugins import elevenlabs as _el
    _elevenlabs = _el
except ImportError:
    pass

_cartesia: Any = None
try:
    from livekit.plugins import cartesia as _ct
    _cartesia = _ct
except ImportError:
    pass

_openai_plugin: Any = None
try:
    from livekit.plugins import openai as _oai
    _openai_plugin = _oai
except ImportError:
    pass


# ── Rate limiting ────────────────────────────────────────────────────────────
_call_timestamps: dict[str, list[float]] = defaultdict(list)


def is_rate_limited(phone: str) -> bool:
    if phone in ("unknown", "demo"):
        return False
    now = time.time()
    _call_timestamps[phone] = [t for t in _call_timestamps[phone] if now - t < config.RATE_LIMIT_WINDOW]
    if len(_call_timestamps[phone]) >= config.RATE_LIMIT_CALLS_PER_HOUR:
        return True
    _call_timestamps[phone].append(now)
    return False
```

- [ ] **Step 2: Verify import works**

```bash
cd voice-service && python -c "import agent; print('ok')"
```

Expected: `ok` (or env-var related errors — that's fine; we just want imports to resolve).

- [ ] **Step 3: Commit**

```bash
git add voice-service/agent.py && git commit -m "feat(agent): SSL patch + plugin imports + rate limiter"
```

---

### Task 2.3: Add `_build_session` (Gemini Live + pipeline fallback) to agent.py

**Files:**
- Modify: `voice-service/agent.py`

- [ ] **Step 1: Append session factory**

```python
# ── Session factory ──────────────────────────────────────────────────────────

def _build_session(tools: list, system_prompt: str, profile: dict | None = None) -> AgentSession:
    """
    Build AgentSession with Gemini Live (default) or pipeline fallback.

    Silence-prevention config (mandatory for Gemini Live):
    1. SessionResumptionConfig(transparent=True) → auto-reconnect after timeout
    2. ContextWindowCompressionConfig → sliding window prevents token-limit freeze
    3. RealtimeInputConfig(END_SENSITIVITY_LOW) → 2s silence threshold

    EndSensitivity MUST use full string form: END_SENSITIVITY_LOW (not .LOW).
    """
    profile = profile or {}
    gemini_model = profile.get("model") or os.getenv("GEMINI_MODEL", config.GEMINI_MODEL)
    gemini_voice = profile.get("voice") or os.getenv("GEMINI_TTS_VOICE", config.GEMINI_TTS_VOICE)
    use_realtime = config.USE_GEMINI_REALTIME

    RealtimeClass = _google_realtime or (_google_beta_realtime if use_realtime else None)

    if use_realtime and RealtimeClass is not None:
        logger.info("session_mode_realtime", model=gemini_model, voice=gemini_voice)
        try:
            from google.genai import types as _gt
            realtime_input_cfg = _gt.RealtimeInputConfig(
                automatic_activity_detection=_gt.AutomaticActivityDetection(
                    end_of_speech_sensitivity=_gt.EndSensitivity.END_SENSITIVITY_LOW,
                    silence_duration_ms=2000,
                    prefix_padding_ms=200,
                ),
            )
            session_resumption_cfg = _gt.SessionResumptionConfig(transparent=True)
            ctx_compression_cfg = _gt.ContextWindowCompressionConfig(
                trigger_tokens=25600,
                sliding_window=_gt.SlidingWindow(target_tokens=12800),
            )
        except Exception as cfg_err:
            logger.warning("silence_prevention_config_failed", error=str(cfg_err))
            realtime_input_cfg = None
            session_resumption_cfg = None
            ctx_compression_cfg = None

        kwargs: dict[str, Any] = dict(
            model=gemini_model,
            voice=gemini_voice,
            instructions=system_prompt,
        )
        if realtime_input_cfg is not None:
            kwargs["realtime_input_config"]      = realtime_input_cfg
            kwargs["session_resumption"]         = session_resumption_cfg
            kwargs["context_window_compression"] = ctx_compression_cfg

        return AgentSession(llm=RealtimeClass(**kwargs), tools=tools)

    # ── Pipeline fallback (Deepgram STT → OpenAI/Groq/Claude LLM → Sarvam/ElevenLabs/Cartesia TTS)
    logger.info("session_mode_pipeline")

    stt = None
    if _deepgram_stt is not None:
        stt = _deepgram_stt(model=config.STT_MODEL, language=config.STT_LANGUAGE)
    elif _sarvam is not None:
        stt = _sarvam.STT(language="unknown", model="saaras:v3", mode="translate", flush_signal=True, sample_rate=16000)

    llm_obj = None
    if _openai_plugin is not None:
        llm_provider = (profile.get("llm_provider") or config.DEFAULT_LLM_PROVIDER).lower()
        if llm_provider == "groq":
            llm_obj = _openai_plugin.LLM.with_groq(model=config.GROQ_MODEL, max_completion_tokens=120)
        elif llm_provider == "claude":
            llm_obj = _openai_plugin.LLM(
                model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-3-5-latest"),
                base_url="https://api.anthropic.com/v1/",
                api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
                max_completion_tokens=120,
            )
        else:
            llm_obj = _openai_plugin.LLM(model=config.DEFAULT_LLM_MODEL, max_completion_tokens=120)

    tts = None
    tts_provider = (profile.get("tts_provider") or config.DEFAULT_TTS_PROVIDER).lower()
    if tts_provider == "sarvam" and _sarvam is not None:
        tts = _sarvam.TTS(target_language_code=config.SARVAM_LANGUAGE, model=config.SARVAM_MODEL,
                          speaker=profile.get("voice", "kavya"), speech_sample_rate=24000)
    elif tts_provider == "elevenlabs" and _elevenlabs is not None:
        tts = _elevenlabs.TTS(model="eleven_turbo_v2_5", voice_id=profile.get("voice", "21m00Tcm4TlvDq8ikWAM"))
    elif tts_provider == "cartesia" and _cartesia is not None:
        tts = _cartesia.TTS(model=config.CARTESIA_MODEL, voice=profile.get("voice", config.CARTESIA_VOICE))
    elif _google_tts is not None:
        tts = _google_tts()
    elif _openai_plugin is not None:
        tts = _openai_plugin.TTS(model="tts-1", voice=profile.get("voice", "alloy"))

    return AgentSession(stt=stt, llm=llm_obj, tts=tts, tools=tools)
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/agent.py && git commit -m "feat(agent): _build_session with realtime + pipeline modes"
```

---

### Task 2.4: Add `entrypoint` function — connect, parse metadata, detect direction

**Files:**
- Modify: `voice-service/agent.py`

- [ ] **Step 1: Append entrypoint**

```python
# ── Helpers ──────────────────────────────────────────────────────────────────

async def _load_caller_history(phone: str) -> str:
    if phone in ("unknown", "demo"):
        return ""
    try:
        memories = await db.get_contact_memory(phone)
        calls = await db.get_calls_by_phone(phone)
        if not memories and not calls:
            return ""
        bits: list[str] = []
        if memories:
            bits.append("Remembered notes: " + " | ".join(m["insight"] for m in memories[:5]))
        if calls:
            last = calls[0]
            bits.append(
                f"Last call ({(last['created_at'] or datetime.utcnow()).date().isoformat() if last.get('created_at') else 'recently'}): "
                f"{last.get('outcome', '?')} — {last.get('reason', '')}"
            )
        return "\n".join(bits)
    except Exception as exc:
        logger.warning("load_caller_history_failed", error=str(exc), phone=phone)
        return ""


async def _resolve_profile(profile_id: str | None) -> dict:
    if profile_id:
        prof = await db.get_agent_profile(profile_id)
        if prof:
            return prof
    prof = await db.get_default_agent_profile()
    return prof or {}


def _parse_metadata(ctx: JobContext) -> dict:
    out: dict = {}
    for src in (ctx.job.metadata, getattr(ctx.room, "metadata", None)):
        if src:
            try:
                out.update(json.loads(src))
            except Exception:
                pass
    return out


def _extract_caller_phone(ctx: JobContext, meta: dict) -> tuple[str, str]:
    """Returns (phone, name)."""
    phone = meta.get("phone_number") or "unknown"
    name = meta.get("lead_name") or ""
    for ident, p in ctx.room.remote_participants.items():
        if p.name and p.name not in ("", "Caller", "Unknown"):
            name = p.name
        if phone in ("unknown", ""):
            attrs = p.attributes or {}
            phone = attrs.get("sip.phoneNumber") or attrs.get("phoneNumber") or phone
            if phone in ("unknown", ""):
                m = re.search(r"\+\d{7,15}", ident)
                if m:
                    phone = m.group()
    return phone or "unknown", name


# ── Main entrypoint ──────────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    logger.info("room_connected", room=ctx.room.name)

    meta = _parse_metadata(ctx)
    phone, name = _extract_caller_phone(ctx, meta)

    if is_rate_limited(phone):
        logger.warning("rate_limited", phone=phone)
        await db.log_error("agent", f"rate-limit blocked {phone}")
        return

    profile = await _resolve_profile(meta.get("agent_profile_id"))
    history = await _load_caller_history(phone)

    system_prompt = build_prompt(
        lead_name=meta.get("lead_name") or name or "there",
        business_name=meta.get("business_name") or "our company",
        service_type=meta.get("service_type") or "our service",
        custom_prompt=profile.get("system_prompt"),
        language_preset=meta.get("language_preset") or "multilingual",
        caller_history=history,
    )
    tokens = count_tokens(system_prompt)
    logger.info("prompt_built", tokens=tokens)

    # Build tools placeholder — Phase 3 will wire AppointmentTools.
    from tools import AppointmentTools  # local import to avoid cycle at module load
    agent_tools = AppointmentTools(ctx, phone, name)
    enabled = json.loads(profile.get("enabled_tools") or "[]") if isinstance(profile.get("enabled_tools"), str) else (profile.get("enabled_tools") or [])
    tool_list = agent_tools.build_tool_list(enabled)

    agent = Agent(instructions=system_prompt, tools=tool_list)
    session = _build_session(tools=tool_list, system_prompt=system_prompt, profile=profile)

    room_input = RoomInputOptions(close_on_disconnect=False)
    try:
        room_input = RoomInputOptions(close_on_disconnect=False, noise_cancellation=noise_cancellation.BVCTelephony())
    except Exception:
        pass

    await session.start(room=ctx.room, agent=agent, room_input_options=room_input)
    await db.upsert_active_call(ctx.room.name, phone, name, "active")

    # Outbound dial-out branch
    user_in_room = any("sip_" in p.identity for p in ctx.room.remote_participants.values())
    if phone not in ("unknown", "demo") and not user_in_room:
        logger.info("dialing_out", phone=phone, trunk=config.OUTBOUND_TRUNK_ID)
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=config.OUTBOUND_TRUNK_ID,
                    sip_call_to=phone,
                    participant_identity=f"sip_{phone}",
                    wait_until_answered=True,
                )
            )
            logger.info("call_answered", phone=phone)
        except Exception as exc:
            logger.error("dial_out_failed", error=str(exc), phone=phone)
            await db.log_error("agent", "dial out failed", str(exc))
            await db.remove_active_call(ctx.room.name)
            return

    # Greet (the prompt instructs the agent to speak first)
    await session.generate_reply(instructions="Begin the call now per your system prompt.")

    # Shutdown handler — registered separately
    agent_tools._call_start_time = time.time()
    agent_tools._room_name = ctx.room.name
    agent_tools._session = session
    ctx.add_shutdown_callback(lambda: _shutdown_hook(ctx, agent_tools, session, profile, phone, name))


# ── Shutdown hook ────────────────────────────────────────────────────────────

async def _shutdown_hook(ctx: JobContext, agent_tools, session, profile: dict, phone: str, name: str) -> None:
    duration = int(time.time() - agent_tools._call_start_time)
    transcript = ""
    try:
        msgs = session.history.items if hasattr(session, "history") else []
        if callable(msgs):
            msgs = msgs()
        lines = []
        for m in msgs:
            role = getattr(m, "role", None)
            content = getattr(m, "content", "")
            if isinstance(content, list):
                content = " ".join(str(c) for c in content if isinstance(c, str))
            if role and content:
                lines.append(f"[{role.upper()}] {content}")
        transcript = "\n".join(lines)
    except Exception as exc:
        logger.warning("transcript_read_failed", error=str(exc))

    sentiment = None
    if transcript and os.getenv("OPENAI_API_KEY"):
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
            resp = await client.chat.completions.create(
                model="gpt-4o-mini", max_tokens=5,
                messages=[{"role": "user", "content":
                    f"Classify this call as one word: positive, neutral, negative, or frustrated.\n\n{transcript[:800]}"}],
            )
            sentiment = (resp.choices[0].message.content or "").strip().lower()[:32]
        except Exception as exc:
            logger.warning("sentiment_failed", error=str(exc))

    cost_usd = round(
        (duration / 60) * 0.002 + (duration / 60) * 0.006
        + (len(transcript) / 1000) * 0.003 + (len(transcript) / 4000) * 0.0001,
        5,
    )

    outcome = (agent_tools._closed_outcome or "COMPLETED").upper()
    reason = agent_tools._closed_reason or "session ended"
    was_booked = outcome == "BOOKED"

    try:
        call_id = await db.log_call(
            phone_number=phone, lead_name=name or agent_tools.lead_name,
            outcome=outcome, reason=reason, duration_seconds=duration,
            recording_url=getattr(agent_tools, "recording_url", None),
            sentiment=sentiment, cost_usd=cost_usd,
            interrupt_count=getattr(agent_tools, "interrupt_count", 0),
            was_booked=was_booked, transcript=transcript,
        )
        logger.info("call_logged", call_id=call_id, duration=duration, outcome=outcome)
    except Exception as exc:
        logger.error("log_call_failed", error=str(exc))
        await db.log_error("agent", "log_call failed", str(exc))

    await db.remove_active_call(ctx.room.name)

    # Fire optional webhooks (n8n etc) — Phase 5 will fully wire notify.py
    try:
        from notify import send_webhook
        n8n_url = os.getenv("N8N_WEBHOOK_URL")
        if n8n_url:
            await send_webhook(n8n_url, "call_completed", {
                "phone": phone, "lead_name": name or agent_tools.lead_name,
                "duration": duration, "outcome": outcome, "reason": reason,
                "sentiment": sentiment, "cost_usd": cost_usd, "was_booked": was_booked,
            })
    except Exception:
        pass


# ── Worker entry ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voice-agent"))
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/agent.py && git commit -m "feat(agent): entrypoint with metadata parse, profile resolve, dial-out, shutdown hook"
```

---

### Task 2.5: Add agent flow integration test

**Files:**
- Create: `voice-service/tests/test_agent_flow.py`

- [ ] **Step 1: Write failing test**

```python
# voice-service/tests/test_agent_flow.py
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import agent


@pytest.mark.asyncio
async def test_parse_metadata_merges_job_and_room():
    ctx = MagicMock()
    ctx.job.metadata = json.dumps({"phone_number": "+91111", "lead_name": "Job"})
    ctx.room.metadata = json.dumps({"lead_name": "Room", "business_name": "Acme"})
    out = agent._parse_metadata(ctx)
    assert out["phone_number"] == "+91111"
    assert out["lead_name"] == "Room"  # room overrides
    assert out["business_name"] == "Acme"


@pytest.mark.asyncio
async def test_extract_caller_phone_from_participant_identity():
    ctx = MagicMock()
    p = MagicMock(name="ParticipantMock")
    p.name = ""
    p.attributes = {}
    ctx.room.remote_participants = {"sip_+918065480036": p}
    phone, name = agent._extract_caller_phone(ctx, {})
    assert phone == "+918065480036"


@pytest.mark.asyncio
async def test_is_rate_limited_blocks_after_threshold(monkeypatch):
    monkeypatch.setattr(agent.config, "RATE_LIMIT_CALLS_PER_HOUR", 2)
    agent._call_timestamps.clear()
    assert agent.is_rate_limited("+919999") is False
    assert agent.is_rate_limited("+919999") is False
    assert agent.is_rate_limited("+919999") is True


@pytest.mark.asyncio
async def test_load_caller_history_returns_empty_for_unknown(mock_pool):
    out = await agent._load_caller_history("unknown")
    assert out == ""
```

- [ ] **Step 2: Run tests — verify PASS**

```bash
cd voice-service && pytest tests/test_agent_flow.py -v
```

Expected: 4 passed.

- [ ] **Step 3: Commit**

```bash
git add voice-service/tests/test_agent_flow.py && git commit -m "test(agent): metadata parse, phone extraction, rate limit, caller history"
```

---

## Phase 3 — Tools

### Task 3.1: Create tools.py with AppointmentTools class skeleton + build_tool_list

**Files:**
- Create: `voice-service/tools.py`
- Create: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Write failing test**

```python
# voice-service/tests/test_tools.py
import pytest
from unittest.mock import MagicMock

from tools import AppointmentTools


def test_build_tool_list_returns_all_when_empty():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list([])
    names = {fn.__name__ for fn in out}
    assert {"check_availability", "book_appointment", "end_call",
            "transfer_to_human", "send_sms_confirmation", "lookup_contact",
            "remember_details", "book_calcom", "cancel_calcom"} <= names


def test_build_tool_list_filters_by_enabled():
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = t.build_tool_list(["check_availability", "end_call"])
    names = {fn.__name__ for fn in out}
    assert names == {"check_availability", "end_call"}
```

- [ ] **Step 2: Run — verify FAIL**

```bash
cd voice-service && pytest tests/test_tools.py -v
```

Expected: ImportError.

- [ ] **Step 3: Write tools.py skeleton**

```python
# voice-service/tools.py
"""LLM function tools the agent can invoke during a call."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Optional

from livekit import agents, api
from livekit.agents import llm

import db
from observability import get_logger

logger = get_logger("tools")


class AppointmentTools(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: Optional[str] = None, lead_name: Optional[str] = None):
        super().__init__(tools=[])
        self.ctx                  = ctx
        self.phone_number         = phone_number
        self.lead_name            = lead_name
        self._call_start_time     = time.time()
        self._sip_domain          = os.getenv("VOBIZ_SIP_DOMAIN", "")
        self.recording_url: Optional[str] = None
        self._closed_outcome: Optional[str] = None
        self._closed_reason: Optional[str] = None
        self.interrupt_count      = 0

    def build_tool_list(self, enabled: list[str]) -> list:
        all_methods = [
            self.check_availability, self.book_appointment, self.end_call,
            self.transfer_to_human, self.send_sms_confirmation, self.lookup_contact,
            self.remember_details, self.book_calcom, self.cancel_calcom,
        ]
        if not enabled:
            return all_methods
        name_map = {m.__name__: m for m in all_methods}
        return [name_map[n] for n in enabled if n in name_map]

    # ── Tool stubs (implemented in subsequent tasks) ─────────────────────────

    @llm.function_tool
    async def check_availability(self, date: str, time: str) -> str:
        raise NotImplementedError

    @llm.function_tool
    async def book_appointment(self, name: str, phone: str, date: str, time: str, service: str) -> str:
        raise NotImplementedError

    @llm.function_tool
    async def end_call(self, outcome: str, reason: str = "") -> str:
        raise NotImplementedError

    @llm.function_tool
    async def transfer_to_human(self, reason: str) -> str:
        raise NotImplementedError

    @llm.function_tool
    async def send_sms_confirmation(self, phone: str, message: str) -> str:
        raise NotImplementedError

    @llm.function_tool
    async def lookup_contact(self, phone: str) -> str:
        raise NotImplementedError

    @llm.function_tool
    async def remember_details(self, insight: str) -> str:
        raise NotImplementedError

    @llm.function_tool
    async def book_calcom(self, name: str, email: str, date: str, start_time: str, notes: str = "") -> str:
        raise NotImplementedError

    @llm.function_tool
    async def cancel_calcom(self, booking_uid: str, reason: str = "") -> str:
        raise NotImplementedError
```

- [ ] **Step 4: Run tests — verify PASS**

```bash
cd voice-service && pytest tests/test_tools.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): AppointmentTools skeleton + build_tool_list"
```

---

### Task 3.2: Implement check_availability + book_appointment

**Files:**
- Modify: `voice-service/tools.py`
- Modify: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Add tests**

Append to `tests/test_tools.py`:

```python
@pytest.mark.asyncio
async def test_check_availability_returns_available(mock_pool):
    mock_pool.fetchval.return_value = None
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.check_availability("2026-06-01", "10:00")
    assert out == "available"


@pytest.mark.asyncio
async def test_check_availability_returns_next_when_booked(mock_pool):
    mock_pool.fetchval.return_value = "existing-uuid"
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.check_availability("2026-06-01", "10:00")
    assert out.startswith("unavailable: next available slot is")


@pytest.mark.asyncio
async def test_book_appointment_returns_confirmation(mock_pool, monkeypatch):
    async def fake_insert(name, phone, date, time, service):
        return "ABC12345"
    monkeypatch.setattr(db, "insert_appointment", fake_insert)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.book_appointment("Ravi", "+91111", "2026-06-01", "10:00", "consultation")
    assert "ABC12345" in out
    assert "2026-06-01" in out
```

- [ ] **Step 2: Replace check_availability and book_appointment in tools.py**

```python
    @llm.function_tool
    async def check_availability(self, date: str, time: str) -> str:
        """Check whether a date/time slot is available. date=YYYY-MM-DD, time=HH:MM (24h).
        Returns 'available' or 'unavailable: next available slot is <slot>'."""
        try:
            if await db.check_slot(date, time):
                return "available"
            nxt = await db.get_next_available(date, time)
            return f"unavailable: next available slot is {nxt}"
        except Exception as exc:
            logger.error("check_availability_failed", error=str(exc))
            return "Unable to check availability right now — please suggest a date and I will confirm."

    @llm.function_tool
    async def book_appointment(self, name: str, phone: str, date: str, time: str, service: str) -> str:
        """Book an appointment after the lead has verbally confirmed all details."""
        try:
            booking_id = await db.insert_appointment(name, phone, date, time, service)
            return f"Confirmed! Booking ID: {booking_id}. See you on {date} at {time} for {service}."
        except Exception as exc:
            logger.error("book_appointment_failed", error=str(exc))
            return "Technical issue saving the booking. Our team will confirm shortly."
```

- [ ] **Step 3: Run tests**

```bash
cd voice-service && pytest tests/test_tools.py -v
```

Expected: 5 passed.

- [ ] **Step 4: Commit**

```bash
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): check_availability + book_appointment"
```

---

### Task 3.3: Implement end_call

**Files:**
- Modify: `voice-service/tools.py`
- Modify: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Add test**

```python
@pytest.mark.asyncio
async def test_end_call_records_outcome():
    ctx = MagicMock()
    ctx.room.disconnect = AsyncMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.end_call("booked", "appointment confirmed")
    assert "Call ended" in out
    assert t._closed_outcome == "booked"
    assert t._closed_reason == "appointment confirmed"
    ctx.room.disconnect.assert_awaited_once()
```

(Also at the top of `test_tools.py`: `from unittest.mock import AsyncMock` if not already.)

- [ ] **Step 2: Replace end_call in tools.py**

```python
    @llm.function_tool
    async def end_call(self, outcome: str, reason: str = "") -> str:
        """End the call and tag the outcome.
        outcome ∈ {booked, not_interested, wrong_number, voicemail, no_answer, callback_requested}."""
        self._closed_outcome = outcome
        self._closed_reason  = reason
        try:
            await self.ctx.room.disconnect()
        except Exception as exc:
            logger.warning("disconnect_failed", error=str(exc))
        return "Call ended."
```

- [ ] **Step 3: Run tests + commit**

```bash
cd voice-service && pytest tests/test_tools.py -v
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): end_call records outcome and disconnects"
```

Expected: 6 passed.

---

### Task 3.4: Implement transfer_to_human

**Files:**
- Modify: `voice-service/tools.py`
- Modify: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Add test**

```python
@pytest.mark.asyncio
async def test_transfer_to_human_when_unconfigured(monkeypatch):
    monkeypatch.delenv("DEFAULT_TRANSFER_NUMBER", raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.transfer_to_human("complex query")
    assert "no fallback number" in out
```

- [ ] **Step 2: Replace transfer_to_human**

```python
    @llm.function_tool
    async def transfer_to_human(self, reason: str) -> str:
        """SIP REFER the call to DEFAULT_TRANSFER_NUMBER."""
        destination = os.getenv("DEFAULT_TRANSFER_NUMBER", "")
        if not destination:
            return "Transfer unavailable: no fallback number configured."
        if "@" not in destination:
            clean = destination.replace("tel:", "").replace("sip:", "")
            destination = f"sip:{clean}@{self._sip_domain}" if self._sip_domain else f"tel:{clean}"
        elif not destination.startswith("sip:"):
            destination = f"sip:{destination}"

        identity = f"sip_{self.phone_number}" if self.phone_number not in (None, "unknown") else None
        if not identity:
            for p in self.ctx.room.remote_participants.values():
                identity = p.identity
                break
        if not identity:
            return "Transfer failed: could not identify caller."

        try:
            await self.ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=self.ctx.room.name,
                    participant_identity=identity,
                    transfer_to=destination,
                    play_dialtone=False,
                ),
            )
            return "Transferring you to a human agent now. Please hold."
        except Exception as exc:
            logger.error("transfer_failed", error=str(exc))
            return "Transfer failed. Please call us back directly."
```

- [ ] **Step 3: Test + commit**

```bash
cd voice-service && pytest tests/test_tools.py -v
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): transfer_to_human via SIP REFER"
```

Expected: 7 passed.

---

### Task 3.5: Implement send_sms_confirmation

**Files:**
- Modify: `voice-service/tools.py`
- Modify: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Add test**

```python
@pytest.mark.asyncio
async def test_send_sms_skip_when_unconfigured(monkeypatch):
    for v in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"):
        monkeypatch.delenv(v, raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.send_sms_confirmation("+91111", "test")
    assert "Twilio not configured" in out
```

- [ ] **Step 2: Replace send_sms_confirmation**

```python
    @llm.function_tool
    async def send_sms_confirmation(self, phone: str, message: str) -> str:
        """Twilio SMS confirmation. No-ops if Twilio not configured."""
        sid   = os.getenv("TWILIO_ACCOUNT_SID", "")
        token = os.getenv("TWILIO_AUTH_TOKEN", "")
        frm   = os.getenv("TWILIO_FROM_NUMBER", "")
        if not (sid and token and frm):
            return "SMS skipped: Twilio not configured."
        try:
            from twilio.rest import Client
            client = Client(sid, token)
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: client.messages.create(body=message, from_=frm, to=phone))
            return f"SMS sent to {phone}."
        except Exception as exc:
            logger.warning("sms_failed", error=str(exc))
            return "SMS delivery failed, but booking is confirmed."
```

- [ ] **Step 3: Test + commit**

```bash
cd voice-service && pytest tests/test_tools.py -v
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): send_sms_confirmation via Twilio"
```

Expected: 8 passed.

---

### Task 3.6: Implement lookup_contact + remember_details + memory compression

**Files:**
- Modify: `voice-service/tools.py`
- Modify: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Add tests**

```python
@pytest.mark.asyncio
async def test_lookup_contact_returns_no_history(monkeypatch):
    async def fake(_): return []
    monkeypatch.setattr(db, "get_calls_by_phone", fake)
    monkeypatch.setattr(db, "get_appointments_by_phone", fake)
    monkeypatch.setattr(db, "get_contact_memory", fake)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.lookup_contact("+91111")
    assert "First-time contact" in out


@pytest.mark.asyncio
async def test_remember_details_inserts_memory(monkeypatch):
    inserted: list[str] = []
    async def fake_add(p, ins): inserted.append(ins)
    async def fake_get(_): return []
    monkeypatch.setattr(db, "add_contact_memory", fake_add)
    monkeypatch.setattr(db, "get_contact_memory", fake_get)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.remember_details("Prefers morning")
    assert "Remembered: Prefers morning" in out
    assert inserted == ["Prefers morning"]
```

- [ ] **Step 2: Replace tool stubs**

```python
    @llm.function_tool
    async def lookup_contact(self, phone: str) -> str:
        """Pull caller history + appointments + memory at call start."""
        try:
            calls   = await db.get_calls_by_phone(phone)
            appts   = await db.get_appointments_by_phone(phone)
            mems    = await db.get_contact_memory(phone)
            if not calls and not appts and not mems:
                return f"No history for {phone}. First-time contact."
            lines = [f"Contact history for {phone}:"]
            if mems:
                lines.append(f"\nREMEMBERED ({len(mems)}):")
                for m in mems[:10]:
                    lines.append(f"  • {m['insight']}")
            if calls:
                lines.append(f"\nCALL HISTORY ({len(calls)}):")
                for c in calls[:5]:
                    ts = (c.get("created_at") or "")
                    ts = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)[:16]
                    lines.append(f"  • {ts} — {c.get('outcome', '?')}: {c.get('reason', '')}")
            if appts:
                lines.append(f"\nAPPOINTMENTS ({len(appts)}):")
                for a in appts[:3]:
                    lines.append(f"  • {a.get('date')} {a.get('time')} — {a.get('service')} [{a.get('status')}]")
            return "\n".join(lines)
        except Exception as exc:
            logger.error("lookup_contact_failed", error=str(exc))
            return "Unable to retrieve contact history."

    @llm.function_tool
    async def remember_details(self, insight: str) -> str:
        """Store an insight about the lead. Triggers Gemini Flash compression at ≥5 entries."""
        if not self.phone_number or self.phone_number == "unknown":
            return "Cannot remember — no phone number for this call."
        try:
            await db.add_contact_memory(self.phone_number, insight)
            mems = await db.get_contact_memory(self.phone_number)
            if len(mems) >= 5:
                asyncio.create_task(self._compress_memories())
            return f"Remembered: {insight}"
        except Exception as exc:
            logger.error("remember_details_failed", error=str(exc))
            return "Could not save detail."

    async def _compress_memories(self) -> None:
        try:
            mems = await db.get_contact_memory(self.phone_number or "")
            if len(mems) < 5:
                return
            api_key = os.getenv("GOOGLE_API_KEY", "")
            if not api_key:
                return
            import google.generativeai as genai
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel("gemini-2.0-flash")
            bullets = "\n".join(f"- {m['insight']}" for m in mems)
            prompt = f"Compress these notes about a sales contact into 3-5 concise bullets. Keep all key facts.\n\n{bullets}"
            loop = asyncio.get_event_loop()
            resp = await loop.run_in_executor(None, lambda: model.generate_content(prompt))
            txt = (resp.text or "").strip()
            if txt:
                await db.compress_contact_memory(self.phone_number or "", txt)
        except Exception as exc:
            logger.warning("memory_compression_failed", error=str(exc))
```

- [ ] **Step 3: Test + commit**

```bash
cd voice-service && pytest tests/test_tools.py -v
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): lookup_contact + remember_details with Gemini Flash compression"
```

Expected: 10 passed.

---

### Task 3.7: Implement book_calcom + cancel_calcom

**Files:**
- Modify: `voice-service/tools.py`
- Modify: `voice-service/tests/test_tools.py`

- [ ] **Step 1: Add tests**

```python
@pytest.mark.asyncio
async def test_book_calcom_skip_when_unconfigured(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    monkeypatch.delenv("CALCOM_EVENT_TYPE_ID", raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.book_calcom("Ravi", "ravi@x.com", "2026-06-01", "10:00")
    assert "Cal.com not configured" in out


@pytest.mark.asyncio
async def test_cancel_calcom_skip_when_unconfigured(monkeypatch):
    monkeypatch.delenv("CALCOM_API_KEY", raising=False)
    ctx = MagicMock()
    t = AppointmentTools(ctx, "+91111", "Ravi")
    out = await t.cancel_calcom("uid-123")
    assert "Cal.com not configured" in out
```

- [ ] **Step 2: Replace tool stubs**

```python
    @llm.function_tool
    async def book_calcom(self, name: str, email: str, date: str, start_time: str, notes: str = "") -> str:
        """Mirror the in-DB appointment to Cal.com."""
        api_key  = os.getenv("CALCOM_API_KEY", "")
        event_id = os.getenv("CALCOM_EVENT_TYPE_ID", "")
        tz       = os.getenv("CALCOM_TIMEZONE", "Asia/Kolkata")
        if not api_key or not event_id:
            return "Cal.com not configured — skipping."
        try:
            from datetime import datetime as _dt
            start_dt = _dt.strptime(f"{date} {start_time}", "%Y-%m-%d %H:%M")
            start_iso = start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    "https://api.cal.com/v1/bookings",
                    headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                    json={
                        "eventTypeId": int(event_id),
                        "start": start_iso,
                        "timeZone": tz,
                        "responses": {"name": name, "email": email, "notes": notes},
                        "metadata": {"source": "OutboundAI"},
                        "language": "en",
                    },
                )
            data = resp.json()
            if resp.status_code not in (200, 201):
                return f"Cal.com booking failed: {data.get('message') or resp.text[:120]}"
            return f"Cal.com booked. UID: {data.get('uid', '')}"
        except Exception as exc:
            logger.error("calcom_book_failed", error=str(exc))
            return f"Cal.com booking failed: {exc}"

    @llm.function_tool
    async def cancel_calcom(self, booking_uid: str, reason: str = "") -> str:
        api_key = os.getenv("CALCOM_API_KEY", "")
        if not api_key:
            return "Cal.com not configured."
        try:
            import httpx
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.delete(
                    f"https://api.cal.com/v1/bookings/{booking_uid}",
                    headers={"Authorization": f"Bearer {api_key}"},
                    params={"reason": reason} if reason else {},
                )
            if resp.status_code not in (200, 204):
                return f"Cancellation failed: HTTP {resp.status_code}"
            return f"Cancelled Cal.com booking {booking_uid}."
        except Exception as exc:
            logger.error("calcom_cancel_failed", error=str(exc))
            return f"Cancellation failed: {exc}"
```

- [ ] **Step 3: Test + commit**

```bash
cd voice-service && pytest tests/test_tools.py -v
git add voice-service/tools.py voice-service/tests/test_tools.py && git commit -m "feat(tools): book_calcom + cancel_calcom"
```

Expected: 12 passed.

---

## Phase 4 — FastAPI server

### Task 4.1: server.py skeleton + healthcheck + Prometheus

**Files:**
- Create: `voice-service/server.py`

- [ ] **Step 1: Write skeleton**

```python
# voice-service/server.py
"""FastAPI service: dispatch, scheduler, healthcheck, metrics, webhooks, log stream."""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import Response, JSONResponse
from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST

import db
from observability import init_observability, get_logger

load_dotenv()
init_observability()
logger = get_logger("server")

app = FastAPI(title="OutboundAI Voice Service", version="1.0.0")

# ── Prometheus ────────────────────────────────────────────────────────────────
voice_calls_total       = Counter("voice_calls_total", "Total calls handled", ["outcome"])
voice_calls_active      = Gauge("voice_calls_active", "Currently active calls")
voice_call_duration     = Histogram("voice_call_duration_seconds", "Call duration",
                                    buckets=[10, 30, 60, 120, 300, 600, 1200])
voice_calls_booked      = Counter("voice_calls_booked_total", "Calls converted to bookings")
voice_dispatch_failures = Counter("voice_dispatch_failures_total", "Dispatch failures")


# ── Auth ──────────────────────────────────────────────────────────────────────
async def require_token(request: Request) -> None:
    expected = os.environ.get("VOICE_SERVICE_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Service token not configured")
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer ") or auth[7:] != expected:
        raise HTTPException(401, "Invalid bearer token")


# ── Lifespan: open/close DB pool ──────────────────────────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    await db.get_pool()
    logger.info("server_started")


@app.on_event("shutdown")
async def _shutdown() -> None:
    await db.close_pool()


# ── Public endpoints ──────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict:
    """Healthcheck for Coolify. Returns 200 only if DB pool is reachable."""
    try:
        pool = await db.get_pool()
        await pool.fetchval("SELECT 1")
        return {"status": "ok", "service": "voice-service"}
    except Exception as exc:
        return JSONResponse({"status": "degraded", "error": str(exc)}, status_code=503)


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
```

- [ ] **Step 2: Smoke test locally**

```bash
cd voice-service && uvicorn server:app --port 8000 &
sleep 2
curl -s http://localhost:8000/health
curl -s http://localhost:8000/metrics | head -5
kill %1 2>/dev/null || true
```

Expected: `/health` returns JSON (may be `degraded` if no Neon DB), `/metrics` returns Prometheus text.

- [ ] **Step 3: Commit**

```bash
git add voice-service/server.py && git commit -m "feat(server): FastAPI skeleton with /health and /metrics"
```

---

### Task 4.2: Add /api/dispatch/single + /api/dispatch/bulk

**Files:**
- Modify: `voice-service/server.py`

- [ ] **Step 1: Append routes**

```python
# ── Dispatch ──────────────────────────────────────────────────────────────────

import json
import random

from livekit import api as lkapi


def _lk_client() -> lkapi.LiveKitAPI:
    return lkapi.LiveKitAPI(
        url=os.environ["LIVEKIT_URL"],
        api_key=os.environ["LIVEKIT_API_KEY"],
        api_secret=os.environ["LIVEKIT_API_SECRET"],
    )


@app.post("/api/dispatch/single", dependencies=[Depends(require_token)])
async def dispatch_single(request: Request) -> dict:
    body = await request.json()
    phone = (body.get("phone") or "").strip()
    if not phone.startswith("+"):
        raise HTTPException(400, "Phone must start with + and country code")

    metadata = {
        "phone_number":     phone,
        "agent_profile_id": body.get("agent_profile_id"),
        "lead_name":        body.get("lead_name"),
        "business_name":    body.get("business_name"),
        "service_type":     body.get("service_type"),
        "campaign_id":      body.get("campaign_id"),
        "language_preset":  body.get("language_preset", "multilingual"),
    }

    room_name = f"call-{phone.replace('+', '')}-{random.randint(1000, 9999)}"
    lk = _lk_client()
    try:
        dispatch = await lk.agent_dispatch.create_dispatch(
            lkapi.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room_name,
                metadata=json.dumps(metadata),
            ),
        )
        logger.info("dispatched", phone=phone, room=room_name, dispatch_id=dispatch.id)
        return {"status": "ok", "dispatch_id": dispatch.id, "room": room_name, "phone": phone}
    except Exception as exc:
        voice_dispatch_failures.inc()
        logger.error("dispatch_failed", error=str(exc), phone=phone)
        raise HTTPException(502, f"Dispatch failed: {exc}")
    finally:
        await lk.aclose()


@app.post("/api/dispatch/bulk", dependencies=[Depends(require_token)])
async def dispatch_bulk(request: Request) -> dict:
    body = await request.json()
    contacts = body.get("contacts") or []
    delay = float(body.get("delay_seconds", 3))
    profile_id = body.get("agent_profile_id")
    campaign_id = body.get("campaign_id")
    if not contacts:
        raise HTTPException(400, "contacts required")

    import asyncio
    batch_id = f"BATCH_{random.randint(100000, 999999)}"
    results = []
    lk = _lk_client()
    try:
        for c in contacts:
            phone = (c.get("phone") or "").strip()
            if not phone.startswith("+"):
                results.append({"phone": phone, "status": "error", "message": "Must start with +"})
                continue
            try:
                room = f"call-{phone.replace('+', '')}-{random.randint(1000, 9999)}"
                d = await lk.agent_dispatch.create_dispatch(
                    lkapi.CreateAgentDispatchRequest(
                        agent_name="voice-agent",
                        room=room,
                        metadata=json.dumps({
                            "phone_number": phone, "lead_name": c.get("lead_name"),
                            "agent_profile_id": profile_id, "campaign_id": campaign_id,
                            "business_name": c.get("business_name"), "service_type": c.get("service_type"),
                        }),
                    ),
                )
                results.append({"phone": phone, "status": "ok", "dispatch_id": d.id, "room": room})
                await asyncio.sleep(delay)
            except Exception as exc:
                voice_dispatch_failures.inc()
                results.append({"phone": phone, "status": "error", "message": str(exc)})
        return {"batch_id": batch_id, "total": len(contacts), "results": results}
    finally:
        await lk.aclose()
```

- [ ] **Step 2: Verify import**

```bash
cd voice-service && python -c "import server; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add voice-service/server.py && git commit -m "feat(server): /api/dispatch/single and /api/dispatch/bulk"
```

---

### Task 4.3: Add /api/demo/token + /internal/record-call

**Files:**
- Modify: `voice-service/server.py`

- [ ] **Step 1: Append routes**

```python
# ── Demo + internal ───────────────────────────────────────────────────────────

@app.post("/api/demo/token", dependencies=[Depends(require_token)])
async def demo_token() -> dict:
    """Mint a LiveKit JWT for browser-based demo + dispatch a demo agent into the room."""
    from livekit.api import AccessToken, VideoGrants
    api_key    = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]
    livekit_url = os.environ["LIVEKIT_URL"]
    room_name = f"demo-{random.randint(10000, 99999)}"
    token = (
        AccessToken(api_key, api_secret)
        .with_identity("demo-user")
        .with_name("Demo Caller")
        .with_grants(VideoGrants(room_join=True, room=room_name))
        .with_ttl(3600)
        .to_jwt()
    )
    lk = _lk_client()
    try:
        await lk.agent_dispatch.create_dispatch(
            lkapi.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room_name,
                metadata=json.dumps({"phone_number": "demo", "is_demo": True}),
            ),
        )
    finally:
        await lk.aclose()
    return {"token": token, "room": room_name, "url": livekit_url}


@app.post("/internal/record-call")
async def record_call_metric(request: Request) -> dict:
    """Called by agent.py at shutdown to update Prometheus counters."""
    data = await request.json()
    voice_calls_total.labels(outcome=(data.get("outcome") or "unknown").lower()).inc()
    if data.get("booked"):
        voice_calls_booked.inc()
    if data.get("duration"):
        voice_call_duration.observe(float(data["duration"]))
    return {"ok": True}
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/server.py && git commit -m "feat(server): /api/demo/token and /internal/record-call"
```

---

### Task 4.4: Add /api/campaigns/{id}/run-now + APScheduler

**Files:**
- Modify: `voice-service/server.py`

- [ ] **Step 1: Append scheduler + route**

```python
# ── Scheduler ─────────────────────────────────────────────────────────────────

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import pytz

_scheduler: AsyncIOScheduler | None = None


def _ist():
    return pytz.timezone("Asia/Kolkata")


async def _run_campaign_internal(campaign_id: str) -> None:
    pool = await db.get_pool()
    row = await pool.fetchrow("SELECT * FROM campaigns WHERE id = $1", campaign_id)
    if not row or row["status"] not in ("active", "scheduled"):
        return
    targets = await pool.fetch(
        """SELECT * FROM campaign_targets WHERE campaign_id = $1 AND status = 'PENDING'""",
        campaign_id,
    )
    delay = float(row.get("call_delay_seconds") or 3)
    profile_id = row.get("agent_profile_id")
    dispatched = 0
    failed = 0
    lk = _lk_client()
    import asyncio
    try:
        for t in targets:
            phone = (t.get("phone_number") or "").strip()
            if not phone.startswith("+"):
                failed += 1
                continue
            try:
                room = f"call-{phone.replace('+', '')}-{random.randint(1000, 9999)}"
                d = await lk.agent_dispatch.create_dispatch(
                    lkapi.CreateAgentDispatchRequest(
                        agent_name="voice-agent",
                        room=room,
                        metadata=json.dumps({
                            "phone_number": phone, "lead_name": t.get("lead_name"),
                            "agent_profile_id": profile_id, "campaign_id": campaign_id,
                        }),
                    ),
                )
                await pool.execute(
                    """UPDATE campaign_targets
                       SET status = 'DISPATCHED'::"CampaignTargetStatus",
                           dispatched_at = now(), dispatch_id = $1
                       WHERE id = $2""",
                    d.id, t["id"],
                )
                dispatched += 1
                await asyncio.sleep(delay)
            except Exception as exc:
                logger.warning("campaign_target_failed", error=str(exc), phone=phone)
                await pool.execute(
                    """UPDATE campaign_targets
                       SET status = 'FAILED'::"CampaignTargetStatus", error_message = $1
                       WHERE id = $2""",
                    str(exc), t["id"],
                )
                failed += 1
    finally:
        await lk.aclose()

    await pool.execute(
        """UPDATE campaigns SET last_run_at = now(),
                                total_dispatched = total_dispatched + $1,
                                total_failed     = total_failed + $2,
                                status = CASE WHEN schedule_type = 'ONCE' THEN 'completed' ELSE 'active' END
           WHERE id = $3""",
        dispatched, failed, campaign_id,
    )


async def _reload_scheduled_campaigns() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.remove_all_jobs()
    pool = await db.get_pool()
    rows = await pool.fetch(
        """SELECT id, schedule_type, schedule_time FROM campaigns
           WHERE status = 'active' AND schedule_type IN ('DAILY', 'WEEKDAYS')""",
    )
    for r in rows:
        try:
            hh, mm = (r["schedule_time"] or "09:00").split(":")
            day = "mon-fri" if r["schedule_type"] == "WEEKDAYS" else "*"
            _scheduler.add_job(
                _run_campaign_internal,
                CronTrigger(day_of_week=day, hour=int(hh), minute=int(mm), timezone=_ist()),
                args=[r["id"]],
                id=f"campaign-{r['id']}",
                replace_existing=True,
            )
        except Exception as exc:
            logger.warning("scheduler_load_failed", id=r["id"], error=str(exc))


@app.on_event("startup")
async def _start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone=_ist())
    _scheduler.start()
    await _reload_scheduled_campaigns()


@app.on_event("shutdown")
async def _stop_scheduler() -> None:
    if _scheduler:
        _scheduler.shutdown()


@app.post("/api/campaigns/{campaign_id}/run-now", dependencies=[Depends(require_token)])
async def campaign_run_now(campaign_id: str) -> dict:
    import asyncio
    asyncio.create_task(_run_campaign_internal(campaign_id))
    return {"status": "started", "campaign_id": campaign_id}


@app.post("/api/campaigns/scheduler/reload", dependencies=[Depends(require_token)])
async def campaign_reload() -> dict:
    await _reload_scheduled_campaigns()
    return {"status": "reloaded"}


@app.get("/api/campaigns/scheduler/status", dependencies=[Depends(require_token)])
async def campaign_status() -> dict:
    if not _scheduler:
        return {"running": False, "jobs": []}
    return {
        "running": _scheduler.running,
        "jobs": [
            {"id": j.id, "next_run": j.next_run_time.isoformat() if j.next_run_time else None}
            for j in _scheduler.get_jobs()
        ],
    }
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/server.py && git commit -m "feat(server): APScheduler + campaign run-now + reload"
```

---

### Task 4.5: Add /api/logs/stream SSE + /api/webhook/livekit

**Files:**
- Modify: `voice-service/server.py`

- [ ] **Step 1: Append routes**

```python
# ── SSE log stream ────────────────────────────────────────────────────────────

import asyncio as _aio

from sse_starlette.sse import EventSourceResponse


@app.get("/api/logs/stream", dependencies=[Depends(require_token)])
async def logs_stream(request: Request, level: str | None = None, source: str | None = None):
    async def event_gen():
        last_seen: str | None = None
        while True:
            if await request.is_disconnected():
                break
            try:
                rows = await db.get_logs(level=level, source=source, limit=20)
                rows.reverse()
                for r in rows:
                    ts = r.get("timestamp")
                    ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
                    if last_seen is not None and ts_iso <= last_seen:
                        continue
                    last_seen = ts_iso
                    yield {"event": "log", "data": json.dumps({
                        "id": r.get("id"), "source": r.get("source"),
                        "level": r.get("level"), "message": r.get("message"),
                        "detail": r.get("detail"), "timestamp": ts_iso,
                    })}
            except Exception as exc:
                yield {"event": "error", "data": str(exc)}
            await _aio.sleep(2)
    return EventSourceResponse(event_gen())


# ── LiveKit webhook receiver ──────────────────────────────────────────────────

import hashlib
import hmac


def _verify_livekit_sig(body: bytes, signature: str) -> bool:
    secret = os.environ.get("LIVEKIT_WEBHOOK_SECRET", "")
    if not secret:
        return False
    mac = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature)


@app.post("/api/webhook/livekit")
async def livekit_webhook(request: Request) -> dict:
    body = await request.body()
    sig = request.headers.get("X-Signature", "")
    if not _verify_livekit_sig(body, sig):
        raise HTTPException(401, "invalid signature")
    try:
        data = json.loads(body)
        evt = data.get("event")
        logger.info("livekit_webhook", event=evt)
        # Egress completion → update recording_url on calls table
        if evt == "egress_ended" and data.get("egressInfo", {}).get("status") == "EGRESS_COMPLETE":
            file_url = data.get("egressInfo", {}).get("file", {}).get("location") or ""
            room = data.get("egressInfo", {}).get("roomName", "")
            if room and file_url:
                pool = await db.get_pool()
                await pool.execute(
                    """UPDATE calls SET recording_url = $1, updated_at = now()
                       WHERE livekit_room_name = $2""",
                    file_url, room,
                )
        return {"ok": True}
    except Exception as exc:
        logger.error("webhook_error", error=str(exc))
        raise HTTPException(500, str(exc))
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/server.py && git commit -m "feat(server): SSE log stream + LiveKit webhook (HMAC)"
```

---

## Phase 5 — Auxiliary modules

### Task 5.1: Create calendar_tools.py

**Files:**
- Create: `voice-service/calendar_tools.py`
- Create: `voice-service/tests/test_calendar_tools.py`

- [ ] **Step 1: Write test**

```python
# voice-service/tests/test_calendar_tools.py
import pytest
import respx
import httpx

import calendar_tools


@pytest.mark.asyncio
async def test_calcom_book_returns_uid(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "k")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", "1")
    with respx.mock:
        respx.post("https://api.cal.com/v2/bookings").mock(
            return_value=httpx.Response(200, json={"data": {"uid": "uid-xyz"}}),
        )
        out = await calendar_tools.async_create_booking(
            "2026-06-01T10:00:00+05:30", "Ravi", "+91111", "first visit",
        )
    assert out["success"] is True
    assert out["booking_id"] == "uid-xyz"


@pytest.mark.asyncio
async def test_get_available_slots_returns_empty_on_failure(monkeypatch):
    monkeypatch.setenv("CALCOM_API_KEY", "k")
    monkeypatch.setenv("CALCOM_EVENT_TYPE_ID", "1")
    with respx.mock:
        respx.get("https://api.cal.com/v1/slots").mock(
            return_value=httpx.Response(500, text="boom"),
        )
        slots = calendar_tools.get_available_slots("2026-06-01")
    assert slots == []
```

- [ ] **Step 2: Write calendar_tools.py**

```python
# voice-service/calendar_tools.py
"""Cal.com + Google Calendar booking integration."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Optional

import httpx
import pytz
import requests

from observability import get_logger

logger = get_logger("calendar")
CAL_BASE = "https://api.cal.com/v1"


def _creds() -> dict:
    return {
        "api_key": os.environ.get("CALCOM_API_KEY", ""),
        "event_id": int(os.environ.get("CALCOM_EVENT_TYPE_ID", "0") or "0"),
    }


def get_available_slots(date_str: str) -> list[dict]:
    gcal_id = os.environ.get("GOOGLE_CALENDAR_ID", "")
    gcal_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
    if gcal_id and gcal_creds and os.path.exists(gcal_creds):
        try:
            return _slots_gcal(date_str, gcal_id, gcal_creds)
        except Exception as exc:
            logger.warning("gcal_fallback", error=str(exc))
    return _slots_calcom(date_str)


def _slots_calcom(date_str: str) -> list[dict]:
    c = _creds()
    if not c["api_key"]:
        return []
    try:
        resp = requests.get(
            f"{CAL_BASE}/slots",
            headers={"Content-Type": "application/json"},
            params={
                "apiKey": c["api_key"], "eventTypeId": c["event_id"],
                "startTime": f"{date_str}T00:00:00.000Z",
                "endTime":   f"{date_str}T23:59:59.000Z",
            },
            timeout=8,
        )
        resp.raise_for_status()
        raw = resp.json().get("data", {}).get("slots", {}).get(date_str, [])
        out: list[dict] = []
        for s in raw:
            dt = datetime.fromisoformat(s["time"])
            out.append({"time": s["time"], "label": dt.strftime("%I:%M %p")})
        return out
    except Exception as exc:
        logger.error("calcom_slots_failed", error=str(exc))
        return []


def _slots_gcal(date_str: str, calendar_id: str, creds_file: str) -> list[dict]:
    from googleapiclient.discovery import build
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(
        creds_file, scopes=["https://www.googleapis.com/auth/calendar.readonly"],
    )
    svc = build("calendar", "v3", credentials=creds)
    start = f"{date_str}T00:00:00+05:30"
    end   = f"{date_str}T23:59:59+05:30"
    busy = (
        svc.freebusy().query(body={"timeMin": start, "timeMax": end, "items": [{"id": calendar_id}]}).execute()
        .get("calendars", {}).get(calendar_id, {}).get("busy", [])
    )
    ist = pytz.timezone("Asia/Kolkata")
    day_start = ist.localize(datetime.strptime(f"{date_str} 10:00", "%Y-%m-%d %H:%M"))
    day_end   = ist.localize(datetime.strptime(f"{date_str} 19:00", "%Y-%m-%d %H:%M"))
    busy_ranges = [
        (datetime.fromisoformat(b["start"]).astimezone(ist),
         datetime.fromisoformat(b["end"]).astimezone(ist))
        for b in busy
    ]
    out: list[dict] = []
    slot = day_start
    while slot < day_end:
        is_busy = any(bs <= slot < be for bs, be in busy_ranges)
        if not is_busy:
            out.append({"time": slot.isoformat(), "label": slot.strftime("%I:%M %p")})
        slot += timedelta(minutes=30)
    return out


async def async_create_booking(start_time: str, caller_name: str, caller_phone: str, notes: str = "") -> dict:
    gcal_id = os.environ.get("GOOGLE_CALENDAR_ID", "")
    gcal_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
    if gcal_id and gcal_creds and os.path.exists(gcal_creds):
        return await _gcal_book(start_time, caller_name, caller_phone, notes, gcal_id, gcal_creds)
    return await _calcom_book(start_time, caller_name, caller_phone, notes)


async def _calcom_book(start_time: str, name: str, phone: str, notes: str) -> dict:
    c = _creds()
    if not c["api_key"]:
        return {"success": False, "booking_id": None, "message": "Cal.com not configured"}
    payload = {
        "eventTypeId": c["event_id"], "start": start_time,
        "attendee": {
            "name": name,
            "email": f"{phone.replace('+','').replace(' ','')}@voiceagent.placeholder",
            "phoneNumber": phone, "timeZone": "Asia/Kolkata", "language": "en",
        },
        "bookingFieldsResponses": {"notes": notes or f"Booked via AI voice agent. Phone: {phone}"},
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.cal.com/v2/bookings",
                headers={
                    "Authorization": f"Bearer {c['api_key']}",
                    "cal-api-version": "2024-08-13", "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code not in (200, 201):
            return {"success": False, "booking_id": None, "message": resp.text[:200]}
        uid = resp.json().get("data", {}).get("uid", "unknown")
        return {"success": True, "booking_id": uid, "message": "Booking confirmed"}
    except Exception as exc:
        return {"success": False, "booking_id": None, "message": str(exc)}


async def _gcal_book(start_time: str, name: str, phone: str, notes: str, calendar_id: str, creds_file: str) -> dict:
    try:
        from googleapiclient.discovery import build
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(
            creds_file, scopes=["https://www.googleapis.com/auth/calendar"],
        )
        svc = build("calendar", "v3", credentials=creds)
        dt_start = datetime.fromisoformat(start_time)
        dt_end   = dt_start + timedelta(minutes=30)
        event = {
            "summary": f"Appointment — {name}",
            "description": f"Phone: {phone}\nNotes: {notes}",
            "start": {"dateTime": dt_start.isoformat(), "timeZone": "Asia/Kolkata"},
            "end":   {"dateTime": dt_end.isoformat(),   "timeZone": "Asia/Kolkata"},
        }
        created = svc.events().insert(calendarId=calendar_id, body=event).execute()
        return {"success": True, "booking_id": created.get("id"), "message": "GCal event created"}
    except Exception as exc:
        return {"success": False, "booking_id": None, "message": str(exc)}


def cancel_booking(booking_id: str, reason: str = "Cancelled by caller") -> dict:
    c = _creds()
    if not c["api_key"]:
        return {"success": False, "message": "Cal.com not configured"}
    try:
        resp = requests.delete(
            f"{CAL_BASE}/bookings/{booking_id}/cancel?apiKey={c['api_key']}",
            headers={"Content-Type": "application/json"},
            json={"reason": reason},
            timeout=8,
        )
        resp.raise_for_status()
        return {"success": True, "message": "Cancelled"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}
```

- [ ] **Step 3: Run tests + commit**

```bash
cd voice-service && pytest tests/test_calendar_tools.py -v
git add voice-service/calendar_tools.py voice-service/tests/test_calendar_tools.py && git commit -m "feat(voice-service): calendar_tools.py (Cal.com + Google Calendar)"
```

Expected: 2 passed.

---

### Task 5.2: Create notify.py

**Files:**
- Create: `voice-service/notify.py`
- Create: `voice-service/tests/test_notify.py`

- [ ] **Step 1: Write test**

```python
# voice-service/tests/test_notify.py
import pytest
import respx
import httpx

import notify


def test_send_telegram_skip_when_unconfigured(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    assert notify.send_telegram("hi") is False


@pytest.mark.asyncio
async def test_send_webhook_returns_true_on_2xx():
    with respx.mock:
        respx.post("https://example.com/hook").mock(return_value=httpx.Response(200, text="ok"))
        ok = await notify.send_webhook("https://example.com/hook", "test", {"x": 1})
    assert ok is True


@pytest.mark.asyncio
async def test_send_webhook_no_url():
    assert await notify.send_webhook("", "test", {}) is False
```

- [ ] **Step 2: Write notify.py**

```python
# voice-service/notify.py
"""Telegram + Twilio WhatsApp + n8n / generic webhook delivery."""

from __future__ import annotations

import os
from datetime import datetime, timezone

import httpx
import requests

from observability import get_logger

logger = get_logger("notify")


def _telegram_url() -> str | None:
    tok = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    return f"https://api.telegram.org/bot{tok}/sendMessage" if tok else None


def send_telegram(message: str) -> bool:
    url = _telegram_url()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    if not url or not chat_id:
        return False
    try:
        r = requests.post(url, json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown"}, timeout=5)
        r.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("telegram_failed", error=str(exc))
        return False


def send_whatsapp(to_phone: str, message: str) -> bool:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "")
    frm = os.environ.get("TWILIO_WHATSAPP_NUMBER", "whatsapp:+14155238886")
    if not sid or not tok:
        return False
    to = f"whatsapp:{to_phone}" if not to_phone.startswith("whatsapp:") else to_phone
    try:
        r = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, tok), data={"From": frm, "To": to, "Body": message}, timeout=8.0,
        )
        r.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("whatsapp_failed", error=str(exc))
        return False


def notify_booking_confirmed(caller_name: str, caller_phone: str, booking_time_iso: str,
                             booking_id: str, notes: str = "", tts_voice: str = "") -> bool:
    try:
        dt = datetime.fromisoformat(booking_time_iso)
        readable = dt.strftime("%A, %d %B %Y at %I:%M %p IST")
    except Exception:
        readable = booking_time_iso
    msg = (
        f"✅ *Booking Confirmed*\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 *Name:* {caller_name}\n"
        f"📞 *Phone:* `{caller_phone}`\n"
        f"📅 *When:* {readable}\n"
        f"🔖 *ID:* `{booking_id}`\n"
        f"📝 *Notes:* {notes or '—'}\n"
        f"🎙️ *Voice:* {tts_voice or '—'}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n_OutboundAI_"
    )
    sent = send_telegram(msg)
    send_whatsapp(caller_phone, f"✅ Hi {caller_name}, your appointment is confirmed for {readable}.")
    return sent


def notify_call_no_booking(caller_name: str, caller_phone: str, call_summary: str = "",
                           tts_voice: str = "", duration_seconds: int = 0) -> bool:
    msg = (
        f"📵 *Call ended — no booking*\n"
        f"👤 {caller_name or 'Unknown'} | 📞 `{caller_phone}` | ⏱ {duration_seconds}s\n"
        f"💬 {call_summary[:300]}"
    )
    return send_telegram(msg)


def notify_agent_error(caller_phone: str, error: str) -> bool:
    return send_telegram(f"⚠️ *Agent error* `{caller_phone}`: `{error[:200]}`")


async def send_webhook(webhook_url: str, event_type: str, payload: dict) -> bool:
    if not webhook_url:
        return False
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.post(
                webhook_url,
                json={"event": event_type, "timestamp": datetime.now(timezone.utc).isoformat(), "data": payload},
                headers={"Content-Type": "application/json"},
            )
            return r.status_code < 300
    except Exception as exc:
        logger.warning("webhook_failed", error=str(exc))
        return False
```

- [ ] **Step 3: Run tests + commit**

```bash
cd voice-service && pytest tests/test_notify.py -v
git add voice-service/notify.py voice-service/tests/test_notify.py && git commit -m "feat(voice-service): notify.py (Telegram + WhatsApp + webhooks)"
```

Expected: 3 passed.

---

### Task 5.3: Port SIP utilities (create_trunk, list_trunks, setup_trunk)

**Files:**
- Create: `voice-service/sip/create_trunk.py`
- Create: `voice-service/sip/list_trunks.py`
- Create: `voice-service/sip/setup_trunk.py`

- [ ] **Step 1: Copy + adapt your existing files**

```bash
cp LIvekitAIVoice-main/create_trunk.py voice-service/sip/create_trunk.py
cp LIvekitAIVoice-main/list_trunks.py  voice-service/sip/list_trunks.py
cp LIvekitAIVoice-main/setup_trunk.py  voice-service/sip/setup_trunk.py
```

Verify each script still uses `load_dotenv(".env")` (relative). If any of them use `from livekit.protocol.sip import ...`, that path is unchanged in v1 — leave as-is.

- [ ] **Step 2: Smoke each one (dry import)**

```bash
cd voice-service && python -c "from sip import create_trunk, list_trunks, setup_trunk; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add voice-service/sip/ && git commit -m "feat(sip): port create_trunk, list_trunks, setup_trunk utilities"
```

---

### Task 5.4: Copy make_call.py CLI

**Files:**
- Create: `voice-service/make_call.py` — bumped to dispatch with `voice-agent` agent name

- [ ] **Step 1: Write file**

```python
# voice-service/make_call.py
"""CLI test harness — dispatch a single outbound call locally."""

import argparse
import asyncio
import json
import os
import random

from dotenv import load_dotenv
from livekit import api

load_dotenv(".env")


async def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--to", required=True, help="Phone number e.g. +919999999999")
    p.add_argument("--lead-name", default="there")
    p.add_argument("--business-name", default="our company")
    p.add_argument("--service-type", default="our service")
    p.add_argument("--profile-id", default=None)
    args = p.parse_args()

    if not args.to.startswith("+"):
        print("Phone must start with + and country code")
        return

    url = os.environ["LIVEKIT_URL"]
    key = os.environ["LIVEKIT_API_KEY"]
    secret = os.environ["LIVEKIT_API_SECRET"]
    lk = api.LiveKitAPI(url=url, api_key=key, api_secret=secret)
    try:
        room = f"call-{args.to.replace('+','')}-{random.randint(1000,9999)}"
        d = await lk.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room,
                metadata=json.dumps({
                    "phone_number": args.to, "lead_name": args.lead_name,
                    "business_name": args.business_name, "service_type": args.service_type,
                    "agent_profile_id": args.profile_id,
                }),
            ),
        )
        print(f"✅ Dispatched. Room={room} ID={d.id}")
    finally:
        await lk.aclose()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/make_call.py && git commit -m "feat(voice-service): make_call.py CLI bumped to voice-agent dispatcher"
```

---

### Task 5.5: Add a default per-client config

**Files:**
- Create: `voice-service/configs/default.json`
- Create: `voice-service/configs/README.md`

- [ ] **Step 1: Write files**

`configs/default.json`:

```json
{
  "language_preset": "multilingual",
  "stt_min_endpointing_delay": 0.05,
  "llm_provider": "openai",
  "llm_model": "gpt-4o-mini",
  "tts_provider": "sarvam",
  "tts_voice": "kavya",
  "tts_language": "hi-IN",
  "max_turns": 25
}
```

`configs/README.md`:

```markdown
# Per-client config overrides

Place files named `<phone-no-plus>.json` here (e.g. `919876543210.json`). The agent loads `configs/<phone>.json` first, falling back to `configs/default.json`. Overrides any field shipped in `default.json`.
```

- [ ] **Step 2: Commit**

```bash
git add voice-service/configs/ && git commit -m "feat(voice-service): default per-client config"
```

---

## Phase 6 — Docker + supervisord

### Task 6.1: Create Dockerfile (multi-stage)

**Files:**
- Create: `voice-service/Dockerfile`

- [ ] **Step 1: Write file**

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
    supervisor libsndfile1 libgomp1 ca-certificates curl && \
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

- [ ] **Step 2: Commit**

```bash
git add voice-service/Dockerfile && git commit -m "feat(docker): multi-stage Dockerfile with healthcheck"
```

---

### Task 6.2: Create supervisord.conf + start.sh + .dockerignore + docker-compose.yml

**Files:**
- Create: `voice-service/supervisord.conf`, `voice-service/start.sh`, `voice-service/.dockerignore`, `voice-service/docker-compose.yml`

- [ ] **Step 1: supervisord.conf**

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

- [ ] **Step 2: start.sh (for local dev — supervisord handles prod)**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

uvicorn server:app --host 0.0.0.0 --port 8000 --reload &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

python agent.py start
```

```bash
chmod +x voice-service/start.sh
```

- [ ] **Step 3: .dockerignore**

```
.venv
.venv-check
__pycache__/
*.pyc
*.pyo
.pytest_cache
tests/
.env
.git
*.log
configs/[!d]*.json
```

- [ ] **Step 4: docker-compose.yml (local dev)**

```yaml
services:
  voice-service:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "8000:8000"
    volumes:
      - ./configs:/app/configs:ro
```

- [ ] **Step 5: Smoke build**

```bash
cd voice-service && docker build -t outboundai-voice:dev .
docker run --rm -p 8000:8000 --env-file .env -d --name outboundai-test outboundai-voice:dev
sleep 8
curl -fs http://localhost:8000/health || echo "(degraded is OK if no DATABASE_URL in .env)"
docker stop outboundai-test
```

Expected: build succeeds; container starts; `/health` returns either `ok` or `degraded` JSON.

- [ ] **Step 6: Commit**

```bash
git add voice-service/supervisord.conf voice-service/start.sh voice-service/.dockerignore voice-service/docker-compose.yml && \
git commit -m "feat(docker): supervisord, start.sh, dockerignore, compose for local dev"
```

---

### Task 6.3: Verify the full test suite passes

- [ ] **Step 1: Run all tests**

```bash
cd voice-service && pytest tests/ -v
```

Expected: all tests pass (≥ 25 tests across `test_db.py`, `test_prompts.py`, `test_tools.py`, `test_calendar_tools.py`, `test_notify.py`, `test_agent_flow.py`).

- [ ] **Step 2: Lint**

```bash
cd voice-service && python -m ruff check .
```

Fix any reported issues.

- [ ] **Step 3: Commit any lint fixes**

```bash
git add -u && git commit -m "chore: ruff lint fixes" || true
```

---

## Self-Review

### Spec coverage check (Plan 1)

- ✅ Schema reconciliation (Phase 0): Tasks 0.1–0.7
- ✅ Voice service foundation (Phase 1): Tasks 1.1–1.10 (config, db, observability, requirements, .env.example, tests fixtures)
- ✅ Python agent core (Phase 2): Tasks 2.1–2.5 (prompts, agent.py with realtime + pipeline, entrypoint, shutdown hook, dial-out, integration tests)
- ✅ 9 LLM tools (Phase 3): Tasks 3.1–3.7 (each tool with TDD)
- ✅ FastAPI server (Phase 4): Tasks 4.1–4.5 (healthcheck, metrics, dispatch, demo, scheduler, SSE log stream, LiveKit webhook)
- ✅ Auxiliary modules (Phase 5): Tasks 5.1–5.5 (calendar_tools, notify, SIP utilities, make_call CLI, default config)
- ✅ Docker + supervisord (Phase 6): Tasks 6.1–6.3 (Dockerfile, supervisord, .dockerignore, compose, smoke build)

### Placeholder scan

No `TBD`, `TODO`, "implement later", or unspecified error handling. All code blocks contain real implementations. Test code is concrete with assertions.

### Type consistency

- `db.log_call` signature in Task 1.8 matches what `agent.py` `_shutdown_hook` calls in Task 2.4.
- `AppointmentTools` constructor signature in Task 3.1 matches its instantiation in `agent.py` Task 2.4.
- All tool method names listed in `build_tool_list` (Task 3.1) match their `@llm.function_tool` definitions in Tasks 3.2–3.7.
- Agent `agent_name="voice-agent"` is consistent across `agent.py` (Task 2.4), `make_call.py` (Task 5.4), and `server.py` dispatch routes (Tasks 4.2 & 4.4).

### Coverage gaps from the spec

- The spec also mentions LiveKit Egress to Cloudflare R2 with signed URLs. **Plan 2 or 3 will handle that** — it requires the dashboard UI to surface signed URLs and may rely on environment vars only confirmed at deploy time. Logged here as a known follow-up: agent.py's recording start can land as a small task in Plan 3 alongside the actual R2 setup, since R2 credentials will be set in Hostinger Coolify env, not in this codebase.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-05-voice-service.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Once Plan 1 is complete, I will write Plan 2 (`2026-05-05-dashboard.md`) and Plan 3 (`2026-05-05-deployment-docs.md`).

**Which approach for Plan 1 — Subagent-Driven or Inline?**
