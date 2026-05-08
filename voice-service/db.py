"""Neon DB layer — asyncpg pool + async functions matching the spec API surface."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg

# ── Pool lifecycle ────────────────────────────────────────────────────────────

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        async with _pool_lock:
            if _pool is None:
                dsn = os.environ.get("DATABASE_URL")
                if not dsn:
                    raise RuntimeError("DATABASE_URL environment variable is not set")
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
            # Preserve env-detected configured state if present
            prior_configured = out.get(k, {}).get("configured", False)
            out[k] = {"value": "", "configured": bool(v) or prior_configured}
        else:
            out[k] = {"value": v, "configured": bool(v) or bool(out.get(k, {}).get("configured", False))}
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
    if val is not None:
        return val
    return os.getenv(key, default)


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


async def get_logs(level: str | None = None, source: str | None = None, limit: int = 200) -> list[dict]:
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


# ── Appointments ──────────────────────────────────────────────────────────────

async def insert_appointment(name: str, phone: str, date: str, time: str, service: str) -> str:
    """Book an appointment; ensures a contacts row exists first since
    appointments.phone_number FK-references contacts.phone_number."""
    booking_id = str(uuid.uuid4())[:8].upper()
    full_id    = str(uuid.uuid4())
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            # Upsert contact so the FK on appointments.phone_number is satisfied.
            # The agent typically calls book_appointment mid-call, BEFORE log_call's
            # contact upsert runs at shutdown.
            await conn.execute(
                """INSERT INTO contacts (id, phone_number, name, total_calls, created_at, updated_at)
                   VALUES ($1, $2, $3, 0, now(), now())
                   ON CONFLICT (phone_number) DO UPDATE SET
                     name = COALESCE(contacts.name, EXCLUDED.name),
                     updated_at = now()""",
                str(uuid.uuid4()), phone, name,
            )
            await conn.execute(
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


async def get_all_appointments(date_filter: str | None = None) -> list[dict]:
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

async def create_call_row(
    phone_number: str,
    lead_name: str | None,
    direction: str = "OUTBOUND",
    livekit_room_name: str | None = None,
    from_number: str | None = None,
) -> str:
    """Insert a placeholder call row at session start so transcript_messages can FK against it.

    Returns the new call id. The row is updated to its final state by ``complete_call`` when
    the session ends. The status is set to ``IN_PROGRESS`` immediately so the dashboard can
    surface live calls without waiting for shutdown.
    """
    pool = await get_pool()
    call_id = str(uuid.uuid4())
    org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
    from_num = from_number or os.environ.get("OUTBOUND_CALLER_ID", "") or ""
    await pool.execute(
        """INSERT INTO calls (
                id, "organizationId", "fromNumber", "toNumber", direction, status,
                "livekitRoomName", "createdAt", "updatedAt"
           ) VALUES (
                $1, $2, $3, $4, $5::"CallDirection", 'IN_PROGRESS'::"CallStatus",
                $6, now(), now()
           )""",
        call_id, org_id, from_num, phone_number, direction.upper(), livekit_room_name,
    )
    return call_id


async def complete_call(
    call_id: str,
    outcome: str,
    reason: str,
    duration_seconds: int,
    phone_number: str | None = None,
    lead_name: str | None = None,
    recording_url: str | None = None,
    sentiment: str | None = None,
    cost_usd: float | None = None,
    interrupt_count: int = 0,
    was_booked: bool = False,
    transcript: str | None = None,
    notes: str | None = None,
    # Usage breakdown — captured for live-rate cost recomputation in the
    # dashboard. All optional; missing fields just leave the column null.
    llm_input_tokens: int | None = None,
    llm_output_tokens: int | None = None,
    llm_provider_used: str | None = None,
    llm_sku_used: str | None = None,
    stt_seconds: int | None = None,
    stt_provider_used: str | None = None,
    stt_sku_used: str | None = None,
    tts_chars: int | None = None,
    tts_provider_used: str | None = None,
    tts_sku_used: str | None = None,
    telephony_provider: str | None = None,
) -> None:
    """Update an in-progress call to its final state and upsert the contact CRM row.

    Counterpart to ``create_call_row``. The transcript blob lives in ``calls.summary``
    because the schema has no dedicated transcript column.

    The usage columns let the dashboard recompute cost as
    ``usage × current ProviderRate`` whenever rates change, instead of being
    locked to the snapshot ``cost_usd`` baked in at the time of the call.
    """
    pool = await get_pool()
    await pool.execute(
        """UPDATE calls SET
             status              = 'COMPLETED'::"CallStatus",
             outcome             = $1::"CallOutcome",
             reason              = $2,
             "durationSeconds"   = $3,
             "recordingUrl"      = COALESCE($4, "recordingUrl"),
             notes               = COALESCE($5, notes),
             sentiment           = $6,
             "costUsd"           = $7,
             interrupt_count     = $8,
             was_booked          = $9,
             summary             = $10,
             llm_input_tokens    = $12,
             llm_output_tokens   = $13,
             llm_provider_used   = $14,
             llm_sku_used        = $15,
             stt_seconds         = $16,
             stt_provider_used   = $17,
             stt_sku_used        = $18,
             tts_chars           = $19,
             tts_provider_used   = $20,
             tts_sku_used        = $21,
             telephony_provider  = $22,
             "updatedAt"         = now()
           WHERE id = $11""",
        outcome.upper(), reason, duration_seconds, recording_url, notes,
        sentiment, cost_usd, interrupt_count, was_booked, transcript, call_id,
        llm_input_tokens, llm_output_tokens, llm_provider_used, llm_sku_used,
        stt_seconds, stt_provider_used, stt_sku_used,
        tts_chars, tts_provider_used, tts_sku_used,
        telephony_provider,
    )
    if phone_number:
        await pool.execute(
            """INSERT INTO contacts (id, phone_number, name, total_calls, last_call_at, last_outcome, is_booked, created_at, updated_at)
               VALUES ($1, $2, $3, 1, now(), $4, $5, now(), now())
               ON CONFLICT (phone_number) DO UPDATE SET
                 total_calls   = contacts.total_calls + 1,
                 last_call_at  = now(),
                 last_outcome  = EXCLUDED.last_outcome,
                 is_booked     = contacts.is_booked OR EXCLUDED.is_booked,
                 name          = COALESCE(contacts.name, EXCLUDED.name),
                 updated_at    = now()""",
            str(uuid.uuid4()), phone_number, lead_name, outcome.upper(), was_booked,
        )


async def log_call(
    phone_number: str, lead_name: str | None, outcome: str, reason: str,
    duration_seconds: int, recording_url: str | None = None, notes: str | None = None,
    sentiment: str | None = None, cost_usd: float | None = None,
    interrupt_count: int = 0, was_booked: bool = False, transcript: str | None = None,
    from_number: str | None = None, direction: str = "OUTBOUND",
) -> str:
    """Insert a row into calls (camelCase Prisma columns). Returns the call id.

    Required NOT NULL columns: organizationId, fromNumber, toNumber, direction.
    The transcript blob is stored in the `summary` column (calls.summary @db.Text)
    because the schema has no dedicated transcript column.
    """
    pool = await get_pool()
    call_id = str(uuid.uuid4())
    org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
    from_num = from_number or os.environ.get("OUTBOUND_CALLER_ID", "") or ""
    await pool.execute(
        """INSERT INTO calls (
                id, "organizationId", "fromNumber", "toNumber", direction, status,
                outcome, reason, "durationSeconds", "recordingUrl", notes, sentiment,
                "costUsd", interrupt_count, was_booked, summary,
                "createdAt", "updatedAt"
           ) VALUES (
                $1, $2, $3, $4, $5::"CallDirection", $6::"CallStatus",
                $7::"CallOutcome", $8, $9, $10, $11, $12,
                $13, $14, $15, $16, now(), now()
           )""",
        call_id, org_id, from_num, phone_number, direction.upper(), "COMPLETED",
        outcome.upper(), reason, duration_seconds, recording_url, notes, sentiment,
        cost_usd, interrupt_count, was_booked, transcript,
    )
    # upsert contact (contacts table is snake_case @mapped — unchanged)
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
        'SELECT * FROM calls ORDER BY "createdAt" DESC LIMIT $1 OFFSET $2', limit, offset,
    )
    return [dict(r) for r in rows]


async def get_calls_by_phone(phone: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        'SELECT * FROM calls WHERE "toNumber" = $1 OR "fromNumber" = $1 ORDER BY "createdAt" DESC',
        phone,
    )
    return [dict(r) for r in rows]


async def update_call_notes(call_id: str, notes: str) -> bool:
    pool = await get_pool()
    result = await pool.execute(
        'UPDATE calls SET notes = $1, "updatedAt" = now() WHERE id = $2', notes, call_id,
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
        """SELECT outcome, "durationSeconds" AS duration_seconds, was_booked,
                  "createdAt" AS created_at
             FROM calls
            WHERE "createdAt" >= now() - interval '30 days'""",
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
    today = datetime.now(UTC).date()
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

async def insert_transcript_message(call_id: str, role: str, content: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """INSERT INTO transcript_messages (id, "callId", role, content, "timestamp")
           VALUES ($1, $2, $3::"TranscriptRole", $4, now())""",
        str(uuid.uuid4()), call_id, role.upper(), content,
    )


async def get_transcript(call_id: str) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        'SELECT * FROM transcript_messages WHERE "callId" = $1 ORDER BY "timestamp"', call_id,
    )
    return [dict(r) for r in rows]


# ── Agent profiles ────────────────────────────────────────────────────────────

async def get_all_agent_profiles() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM agent_profiles ORDER BY is_default DESC, created_at")
    return [dict(r) for r in rows]


async def get_agent_profile(profile_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM agent_profiles WHERE id = $1", profile_id)
    return dict(row) if row else None


async def get_default_agent_profile() -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM agent_profiles WHERE is_default = true LIMIT 1",
    )
    return dict(row) if row else None


# ── Inbound routing (Feature Pack 3 / Task 2) ────────────────────────────────

async def get_phone_number_routing(dialed_number: str) -> dict | None:
    """Return the PhoneNumber row for this dialed number, or None.

    Inbound only — agent.py calls this to discover which assistant should
    handle the call. Inactive rows return None (treated as no routing).
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT id, number, "assistantId", "isActive", label
             FROM phone_numbers
            WHERE number = $1 AND "isActive" = true
            LIMIT 1''',
        dialed_number,
    )
    return dict(row) if row else None


async def get_assistant_as_profile(assistant_id: str) -> dict | None:
    """Load an Assistant row and shape it as the profile dict the agent expects.

    Maps Prisma camelCase columns onto the snake_case keys agent.py reads.
    Falls back to None if the assistant is missing or inactive.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT id, name,
                  "systemPrompt", "firstMessage", "endCallMessage",
                  "llmProvider", "llmModel", temperature, "maxTokens",
                  "sttProvider", "sttModel", "sttLanguage",
                  "ttsProvider", "ttsModel", "voiceId",
                  "silenceTimeoutSeconds", "maxDurationSeconds",
                  "endOfSpeechSensitivity", "interruptionThresholdMs",
                  "backgroundDenoising", "voicemailDetection",
                  "voicemailMessage", "confidenceThresholdPct",
                  "hallucinationGuard", "minPauseMs",
                  "recordingEnabled", "isActive"
             FROM assistants
            WHERE id = $1 AND "isActive" = true
            LIMIT 1''',
        assistant_id,
    )
    if not row:
        return None
    r = dict(row)
    return {
        "id": r["id"],
        "name": r["name"],
        "system_prompt": r["systemPrompt"],
        "first_message": r["firstMessage"],
        "end_call_message": r["endCallMessage"],
        "llm_provider": (r["llmProvider"] or "OPENAI").lower(),
        "model": r["llmModel"],
        "temperature": float(r["temperature"]) if r["temperature"] is not None else 0.7,
        "max_tokens": r["maxTokens"],
        "stt_provider": (r["sttProvider"] or "DEEPGRAM").lower(),
        "stt_model": r["sttModel"],
        "stt_language": r["sttLanguage"],
        "tts_provider": (r["ttsProvider"] or "DEEPGRAM").lower(),
        "tts_model": r["ttsModel"],
        "voice": r["voiceId"],
        "silence_timeout_seconds": r["silenceTimeoutSeconds"],
        "max_duration_seconds": r["maxDurationSeconds"],
        "end_of_speech_sensitivity": (r["endOfSpeechSensitivity"] or "LOW").upper()
        if r["endOfSpeechSensitivity"]
        else "LOW",
        "interruption_threshold_ms": r["interruptionThresholdMs"],
        "background_denoising": bool(r["backgroundDenoising"]),
        "voicemail_detection": bool(r["voicemailDetection"]),
        "voicemail_message": r["voicemailMessage"] or "",
        "confidence_threshold_pct": r["confidenceThresholdPct"],
        "hallucination_guard": bool(r["hallucinationGuard"]),
        "min_pause_ms": r["minPauseMs"],
        "recording_enabled": bool(r["recordingEnabled"]),
        "enabled_tools": "[]",  # populated by get_assistant_tools later
    }


# ── API key verification (Feature Pack 3 / Task 3) ────────────────────────────

async def verify_api_key(plaintext_key: str) -> dict | None:
    """Hash the key and look it up. Returns the row dict if active, else None.

    Updates lastUsedAt asynchronously so the hot path stays fast — the auth
    decision returns before the timestamp lands.
    """
    if not plaintext_key.startswith("jjv_"):
        return None
    h = hashlib.sha256(plaintext_key.encode()).hexdigest()
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT id, "organizationId", name, "lastUsedAt", "revokedAt"
             FROM api_keys
            WHERE "keyHash" = $1 AND "revokedAt" IS NULL
            LIMIT 1''',
        h,
    )
    if not row:
        return None
    asyncio.create_task(_touch_api_key(row["id"]))
    return dict(row)


async def _touch_api_key(api_key_id: str) -> None:
    try:
        pool = await get_pool()
        await pool.execute(
            'UPDATE api_keys SET "lastUsedAt" = $1 WHERE id = $2',
            datetime.now(UTC).replace(tzinfo=None),
            api_key_id,
        )
    except Exception:
        # Don't crash auth for a missed timestamp update.
        pass


# ── Webhook delivery (Feature Pack 3 / Task 4) ────────────────────────────────

async def get_active_webhooks_for_event(org_id: str, event: str) -> list[dict]:
    """Return webhook rows that should fire for this event in this org.

    The events column is a Postgres enum array (WebhookEvent[]); we cast to
    text[] for the membership check so the query works with any of the
    enum values without us hard-coding them here.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        '''SELECT id, url, secret, events
             FROM webhooks
            WHERE "organizationId" = $1 AND "isActive" = true
              AND $2 = ANY(events::text[])''',
        org_id, event,
    )
    return [dict(r) for r in rows]


async def get_assistant_tools(assistant_id: str) -> list[dict]:
    """Active Tool rows bound to this assistant via assistant_tools."""
    pool = await get_pool()
    rows = await pool.fetch(
        '''SELECT t.id, t.name, t.description, t.parameters AS "parametersJson",
                  t.kind, t."httpMethod", t."httpUrl", t."httpHeaders",
                  t."timeoutSeconds", t."isActive"
             FROM tools t
             JOIN assistant_tools at ON at."toolId" = t.id
            WHERE at."assistantId" = $1 AND t."isActive" = true''',
        assistant_id,
    )
    out = []
    for r in rows:
        d = dict(r)
        # parameters comes back as JSON-as-text — coerce to dict for jsonschema
        if isinstance(d.get("parametersJson"), str):
            try:
                d["parametersJson"] = json.loads(d["parametersJson"])
            except Exception:
                d["parametersJson"] = {"type": "object", "properties": {}}
        if isinstance(d.get("httpHeaders"), str):
            try:
                d["httpHeaders"] = json.loads(d["httpHeaders"])
            except Exception:
                d["httpHeaders"] = {}
        out.append(d)
    return out


async def record_webhook_delivery(
    webhook_id: str,
    event: str,
    payload: dict,
    response_code: int | None,
    response_body: str,
    succeeded_at,
    call_id: str | None = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO webhook_deliveries
             (id, "webhookId", "callId", event, payload, "responseCode",
              "responseBody", attempts, "succeededAt", "createdAt")
           VALUES ($1, $2, $3, $4::"WebhookEvent", $5::jsonb, $6, $7, 1, $8, now())''',
        str(uuid.uuid4()), webhook_id, call_id, event,
        json.dumps(payload), response_code,
        response_body, succeeded_at,
    )
