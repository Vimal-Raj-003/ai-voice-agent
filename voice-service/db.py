"""Neon DB layer — asyncpg pool + async functions matching the spec API surface."""

from __future__ import annotations

import asyncio
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
