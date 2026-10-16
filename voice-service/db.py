from __future__ import annotations

import asyncio
import hashlib
import json
import os
import threading
import uuid
import weakref
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg

from observability import get_logger

import config
import provider_registry

# ── Pool lifecycle ────────────────────────────────────────────────────────────
#
# An asyncpg pool is bound to the event loop that created it. The LiveKit worker
# runs each job on its OWN event loop (often its own thread) inside a single
# process, and several jobs can be live at once. A single shared pool therefore
# handed connections created on loop A to coroutines running on loop B, raising
# "got Future attached to a different loop" / "another operation is in progress".
#
# Fix: keep one pool PER event loop in a registry. Each loop creates its pool
# once and never touches another loop's pool. A WeakKeyDictionary lets a loop's
# pool entry disappear automatically once that loop is gone, so finished jobs do
# not leak pools. `_pool` is retained as an explicit override the test-suite
# injects (db._pool = <mock/real>); when set it wins, preserving existing tests.

_pool: asyncpg.Pool | None = None  # legacy/test override; None in production
_pools: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncpg.Pool]" = (
    weakref.WeakKeyDictionary()
)
_pool_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = (
    weakref.WeakKeyDictionary()
)
# Guards only the tiny registry get-or-create bookkeeping across job threads —
# held for microseconds, never around create_pool() or a query, so it does NOT
# serialize concurrent database calls.
_registry_lock = threading.Lock()


def _loop_lock(loop: asyncio.AbstractEventLoop) -> asyncio.Lock:
    """Get-or-create this loop's pool-creation lock (thread-safe registry access)."""
    with _registry_lock:
        lock = _pool_locks.get(loop)
        if lock is None:
            lock = asyncio.Lock()
            _pool_locks[loop] = lock
        return lock


async def get_pool() -> asyncpg.Pool:
    """Return the asyncpg pool for the CURRENT running loop, creating it once.

    Pools are keyed per loop so concurrent LiveKit jobs never share a pool or
    hand a connection from one loop to another. An explicitly injected module
    `_pool` (used by the test-suite) takes precedence when present.
    """
    # Explicit override (tests inject a mock/real pool via db._pool).
    if _pool is not None:
        return _pool

    loop = asyncio.get_running_loop()
    with _registry_lock:
        pool = _pools.get(loop)
    if pool is not None:
        return pool

    # Create under this loop's lock (double-checked to avoid a race between two
    # coroutines on the SAME loop calling get_pool concurrently).
    async with _loop_lock(loop):
        with _registry_lock:
            pool = _pools.get(loop)
        if pool is None:
            dsn = os.environ.get("DATABASE_URL")
            if not dsn:
                raise RuntimeError("DATABASE_URL environment variable is not set")
            pool = await asyncpg.create_pool(
                dsn=dsn,
                min_size=2,
                max_size=10,
                command_timeout=30,
                statement_cache_size=0,  # Neon pgbouncer doesn't support prepared statements
            )
            with _registry_lock:
                _pools[loop] = pool
        return pool


async def close_pool() -> None:
    """Close the pool belonging to the CURRENT loop (and the legacy/test override
    if set). Only ever closes a pool on the loop that owns it — never another
    active job's pool."""
    global _pool
    if _pool is not None:
        try:
            await _pool.close()
        except Exception:
            pass
        _pool = None

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    with _registry_lock:
        pool = _pools.pop(loop, None)
        _pool_locks.pop(loop, None)
    if isinstance(pool, asyncpg.Pool):
        await pool.close()


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
    "RECORDING_BACKEND", "RECORDINGS_DIR",
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

_log = get_logger("db")

async def log_error(source: str, message: str, detail: str = "", level: str = "ERROR") -> bool:
    """Persist an error row. NEVER raises — logging must not break the caller.

    Returns True only when the INSERT actually committed. That return value
    matters: callers which need to know whether the audit landed (see
    record_calcom_orphan) previously wrapped this in try/except and set a
    success flag in the try body. Because this function swallows every
    exception, that flag was ALWAYS true and a failed insert looked like a
    successful one, so a durable fallback could never trigger. The contract is
    now "never raises, but tells you the truth"."""
    try:
        pool = await get_pool()
        await pool.execute(
            """INSERT INTO error_logs (id, source, level, message, detail, timestamp)
               VALUES ($1, $2, $3::"ErrorLevel", $4, $5, now())""",
            str(uuid.uuid4()), source, level.upper(), message[:500], detail[:2000],
        )
        return True
    except Exception:
        return False  # never let logging break the caller


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


async def log_events_batch(rows: list[dict]) -> None:
    """Batch-insert Live Logs rows produced by the observability bridge.

    Best-effort: swallows all errors so a logging/DB hiccup can never surface
    into — or add latency to — a live call. Each row is {id, source, level,
    message, detail, timestamp} already normalized by observability.py."""
    if not rows:
        return
    try:
        pool = await get_pool()
        await pool.executemany(
            """INSERT INTO error_logs (id, source, level, message, detail, timestamp)
               VALUES ($1, $2, $3::"ErrorLevel", $4, $5, $6)""",
            [
                (
                    r["id"], r["source"], r["level"],
                    (r.get("message") or "")[:500],
                    (r.get("detail") or None),
                    r["timestamp"],
                )
                for r in rows
            ],
        )
    except Exception:
        pass  # never let logging break the caller


# ── Appointments ──────────────────────────────────────────────────────────────

async def insert_appointment(
    name: str,
    phone: str,
    date: str,
    time: str,
    service: str,
    calcom_uid: str | None = None,
    email: str | None = None,
    notes: str | None = None,
    reminder_at: datetime | None = None,
    reminder_channel: str = "whatsapp",
) -> str:
    """Book an appointment; ensures a contacts row exists first since
    appointments.phone_number FK-references contacts.phone_number.

    `calcom_uid` persists the external Cal.com booking id so the two systems
    stay linked (used for cancellation sync). Pass None for local-only bookings.

    When `reminder_at` is a future timestamp a PENDING reminder row is created
    in the SAME transaction (atomic with the booking), so a persistent poller
    can send the customer a reminder before the appointment. Exactly one
    reminder row is created per appointment.
    """
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
                """INSERT INTO appointments
                       (id, booking_id, name, phone_number, email, date, time, service,
                        status, calcom_booking_uid, notes, created_at)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                        'BOOKED'::"AppointmentStatus", $9, $10, now())""",
                full_id, booking_id, name, phone, email, date, time, service,
                calcom_uid, notes,
            )
            if reminder_at is not None and reminder_at > datetime.now(UTC):
                await conn.execute(
                    """INSERT INTO appointment_reminders
                           (id, appointment_id, customer_phone, reminder_at, channel,
                            status, retry_count, created_at)
                       VALUES ($1, $2, $3, $4, $5, 'PENDING'::"ReminderStatus", 0, now())""",
                    str(uuid.uuid4()), full_id, phone, reminder_at, reminder_channel,
                )
    return booking_id


async def cancel_appointment_by_calcom_uid(calcom_uid: str) -> bool:
    """Mark the local appointment linked to a Cal.com booking as CANCELLED and
    cancel any PENDING reminder for it, so a cancelled appointment never fires a
    reminder. Both updates run in one transaction."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """UPDATE appointments SET status = 'CANCELLED'::"AppointmentStatus"
                   WHERE calcom_booking_uid = $1 AND status = 'BOOKED'::"AppointmentStatus"
                   RETURNING id""",
                calcom_uid,
            )
            if row is None:
                return False
            await conn.execute(
                """UPDATE appointment_reminders SET status = 'CANCELLED'::"ReminderStatus"
                   WHERE appointment_id = $1 AND status = 'PENDING'::"ReminderStatus" """,
                row["id"],
            )
    return True


# ── Appointment reminders ───────────────────────────────────────────────────

async def due_reminders(limit: int = 50) -> list[dict]:
    """PENDING reminders whose time has arrived, whose appointment is still
    BOOKED. Returns the data needed to send and mark the reminder."""
    pool = await get_pool()
    rows = await pool.fetch(
        """SELECT r.id AS reminder_id, r.customer_phone, r.channel, r.retry_count,
                  a.name, a.date, a.time, a.service
             FROM appointment_reminders r
             JOIN appointments a ON a.id = r.appointment_id
            WHERE r.status = 'PENDING'::"ReminderStatus"
              AND r.reminder_at <= now()
              AND a.status = 'BOOKED'::"AppointmentStatus"
            ORDER BY r.reminder_at ASC
            LIMIT $1""",
        limit,
    )
    return [dict(r) for r in rows]


async def mark_reminder_sent(reminder_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        """UPDATE appointment_reminders
              SET status = 'SENT'::"ReminderStatus", sent_at = now()
            WHERE id = $1""",
        reminder_id,
    )


async def mark_reminder_failed(reminder_id: str, error: str, max_retries: int) -> None:
    """Increment retry_count; keep PENDING for another attempt until the retry
    ceiling is hit, then mark FAILED. Error text is truncated and safe to store."""
    pool = await get_pool()
    await pool.execute(
        """UPDATE appointment_reminders
              SET retry_count = retry_count + 1,
                  last_error = $2,
                  status = CASE WHEN retry_count + 1 >= $3
                                THEN 'FAILED'::"ReminderStatus"
                                ELSE 'PENDING'::"ReminderStatus" END
            WHERE id = $1""",
        reminder_id, (error or "")[:300], max_retries,
    )


async def check_slot(date: str, time: str) -> bool:
    pool = await get_pool()
    existing = await pool.fetchval(
        """SELECT id FROM appointments
           WHERE date = $1 AND time = $2 AND status = 'BOOKED'::"AppointmentStatus" LIMIT 1""",
        date, time,
    )
    return existing is None


async def find_booked_appointment(
    phone: str, date: str, time: str, service: str
) -> str | None:
    """Cross-call duplicate guard: return the booking_id of an existing BOOKED
    appointment for the same customer phone + date + time + service, or None.
    Unlike the per-call in-memory dedup, this catches a repeat booking across
    separate calls / worker restarts so the tool firing twice can't create two
    identical rows."""
    pool = await get_pool()
    return await pool.fetchval(
        """SELECT booking_id FROM appointments
           WHERE phone_number = $1 AND date = $2 AND time = $3 AND service = $4
             AND status = 'BOOKED'::"AppointmentStatus" LIMIT 1""",
        phone, date, time, service,
    )


async def find_booked_slot(phone: str, date: str, time: str) -> dict | None:
    """Return the customer's existing BOOKED appointment in this SLOT, or None.

    Deliberately service-agnostic, unlike find_booked_appointment: the database
    guard `appointments_active_customer_slot_idx` is unique on
    (phone_number, date, time) WHERE status = 'BOOKED', with no service column.
    A booking for the same slot under a DIFFERENT service therefore passes the
    service-aware pre-check and then violates the index at insert time. This
    lets the caller ask what actually exists instead of guessing why the write
    failed."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT booking_id, service, calcom_booking_uid FROM appointments
           WHERE phone_number = $1 AND date = $2 AND time = $3
             AND status = 'BOOKED'::"AppointmentStatus" LIMIT 1""",
        phone, date, time,
    )
    return dict(row) if row else None


async def attach_calcom_uid(booking_id: str, calcom_uid: str) -> bool:
    """Link a Cal.com booking to an existing local appointment that has none.

    COALESCE-style first-write-wins: an appointment that already carries a uid
    is left alone, so reconciliation can never overwrite a good link or create
    a second association."""
    pool = await get_pool()
    res = await pool.execute(
        """UPDATE appointments SET calcom_booking_uid = $2
            WHERE booking_id = $1 AND calcom_booking_uid IS NULL""",
        booking_id, calcom_uid,
    )
    return res.endswith("1")


async def find_appointment_by_calcom_uid(calcom_uid: str) -> dict | None:
    """Idempotency key for reconciliation: has this Cal.com booking already
    been persisted locally? Prevents a retry creating a second row."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """SELECT booking_id, status, phone_number, date, time
             FROM appointments WHERE calcom_booking_uid = $1 LIMIT 1""",
        calcom_uid,
    )
    return dict(row) if row else None


async def record_calcom_orphan(calcom_uid: str, phone: str, date: str, time: str,
                               service: str, name: str, reason: str) -> bool:
    """Durably record a Cal.com booking that exists externally but has no local
    appointment, so it can be reconciled later.

    TWO sinks, because one of them is not trustworthy here:

      1. error_logs in Neon — queryable, but it is the SAME database whose
         failure usually caused the orphan. When Neon is fully unavailable this
         write fails too, which would lose the only record of a real booking.
      2. An append-only JSONL file on local disk — survives the process, needs
         no database, and is what makes recovery possible in exactly the case
         that matters.

    DURABILITY CAVEAT — read before relying on sink 2. fsync() guarantees the
    bytes reached the filesystem; it does NOT guarantee that filesystem
    outlives the container. In voice-service/docker-compose.yml the only
    mounted volume is `./configs:/app/configs:ro`, and with WORKDIR=/app the
    default path below resolves to /output/logs/ — the image's ephemeral
    writable layer, which is discarded on redeploy. For this fallback to be
    durable in a container, set CALCOM_ORPHAN_LOG to a path on a MOUNTED,
    writable volume. On a bare-metal/dev host the default is already durable.

    MULTI-PROCESS: the worker runs several processes that may append
    concurrently. Each record is a single short line written in O_APPEND mode,
    which keeps individual lines intact; this is not a substitute for a real
    queue if the volume of orphans ever becomes non-trivial.

    The file is written whenever the database write does not succeed. Returns
    True if at least one sink captured the record. Never raises: the booking is
    real and already confirmed to the caller, so losing the audit trail must
    not turn into an exception on the call.
    """
    payload = {
        "calcom_uid": calcom_uid, "phone_number": phone, "date": date,
        "time": time, "service": service, "name": name, "reason": reason[:300],
        "recorded_at": datetime.now(UTC).isoformat(),
    }
    # log_error never raises, so its RETURN VALUE is the only honest signal of
    # whether the row committed. The try/except is belt-and-braces for a future
    # change to that contract.
    db_ok = False
    try:
        db_ok = bool(await log_error("calcom_sync", "ORPHANED_CALCOM_BOOKING",
                                     detail=json.dumps(payload), level="ERROR"))
    except Exception:
        db_ok = False

    file_ok = False
    if not db_ok:
        try:
            path = os.getenv("CALCOM_ORPHAN_LOG") or os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "output", "logs", "calcom_orphans.jsonl")
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(payload) + chr(10))
                fh.flush()
                os.fsync(fh.fileno())   # survive an abrupt process kill
            file_ok = True
        except Exception:
            file_ok = False

    if not (db_ok or file_ok):
        # BOTH durable paths failed. The external booking is real and the
        # caller has been told their slot is held, but nothing anywhere now
        # records it. Emit the full detail on stderr as the last resort, and
        # tell the caller so it can raise an unresolved-recovery risk.
        _log.error("CALCOM_ORPHAN_UNRECOVERABLE", calcom_uid=calcom_uid,
                   date=date, time=time, service=service,
                   impact="external booking exists with no durable local record")
    return db_ok or file_ok


"""Neon DB layer — asyncpg pool + async functions matching the spec API surface."""
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
    assistant_id: str | None = None,
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
                "livekitRoomName", "assistantId", "createdAt", "updatedAt"
           ) VALUES (
                $1, $2, $3, $4, $5::"CallDirection", 'IN_PROGRESS'::"CallStatus",
                $6, $7, now(), now()
           )""",
        call_id, org_id, from_num, phone_number, direction.upper(), livekit_room_name,
        assistant_id,
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
    # Carrier-aligned lifecycle stamps. answered_at is the instant the call was
    # PICKED UP (outbound: create_sip_participant(wait_until_answered=True)
    # returning; inbound: the SIP leg already present at job start). ended_at is
    # the hangup itself, passed in rather than defaulted to now(), because the
    # shutdown hook can run later than the hangup. Both are COALESCEd so a retry
    # cannot move a timestamp that is already recorded.
    answered_at: "datetime | None" = None,
    ended_at: "datetime | None" = None,
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
             -- The call has just ended, so stamp it. This column existed but was
             -- never written (0 of 150 historical rows had it), which left the
             -- post-call Vobiz recording lookup and the "processing" window in
             -- the UI with no notion of when a call finished. COALESCE keeps a
             -- value already set, so a retry cannot move the end time.
             "answeredAt"        = COALESCE("answeredAt", $23),
             "endedAt"           = COALESCE("endedAt", $24, now()),
             "updatedAt"         = now()
           WHERE id = $11""",
        outcome.upper(), reason, duration_seconds, recording_url, notes,
        sentiment, cost_usd, interrupt_count, was_booked, transcript, call_id,
        llm_input_tokens, llm_output_tokens, llm_provider_used, llm_sku_used,
        stt_seconds, stt_provider_used, stt_sku_used,
        tts_chars, tts_provider_used, tts_sku_used,
        telephony_provider,
        answered_at,
        ended_at,
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


async def delete_active_calls(room_ids: list[str], older_than: datetime | None = None) -> int:
    """Delete specific active_calls rows by room id.

    Takes an explicit list rather than a predicate on purpose: the caller must
    have verified each room against LiveKit first (see
    /api/active-calls/reconcile). There is deliberately no "delete everything
    older than X" here, because age alone cannot distinguish a long call from
    an orphan.

    `older_than` closes a time-of-check/time-of-use race. Between listing the
    LiveKit rooms and running this delete, a NEW call can start and upsert a
    row — and room ids are `call-<phone>-<4 digits>`, so the same id can recur
    for the same caller. Deleting purely by id would then remove a LIVE call's
    registry row and under-count capacity, letting the dispatcher over-dial.
    Re-asserting the age predicate inside the DELETE makes the check and the
    write atomic, so a freshly recreated row is never removed."""
    if not room_ids:
        return 0
    pool = await get_pool()
    if older_than is not None:
        res = await pool.execute(
            "DELETE FROM active_calls WHERE room_id = ANY($1::text[]) AND started_at < $2",
            room_ids, older_than)
    else:
        res = await pool.execute(
            "DELETE FROM active_calls WHERE room_id = ANY($1::text[])", room_ids)
    try:
        return int(res.split()[-1])
    except Exception:
        return 0


async def get_active_calls() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM active_calls ORDER BY started_at DESC")
    return [dict(r) for r in rows]


async def set_recording_status(
    room: str,
    status: str | None = None,
    egress_id: str | None = None,
    object_key: str | None = None,
    duration_seconds: int | None = None,
    error: str | None = None,
    url: str | None = None,
) -> None:
    """Update the recording fields on the call row matched by LiveKit room name.

    Only non-None arguments are written, so a later partial update (e.g. the
    egress_ended webhook setting duration + status) never clobbers the object
    key stored at egress start. No secrets are stored — only the object key,
    egress id, status, duration and a safe error string.
    """
    sets: list[str] = []
    args: list[object] = []
    def add(col: str, val: object) -> None:
        args.append(val)
        sets.append(f'"{col}" = ${len(args)}')
    if status is not None: add("recordingStatus", status)
    if egress_id is not None: add("recordingEgressId", egress_id)
    if object_key is not None: add("recordingObjectKey", object_key)
    if duration_seconds is not None: add("recordingDurationSeconds", duration_seconds)
    if error is not None: add("recordingError", error)
    if url is not None: add("recordingUrl", url)
    if not sets:
        return
    args.append(room)
    pool = await get_pool()
    await pool.execute(
        f'UPDATE calls SET {", ".join(sets)}, "updatedAt" = now() WHERE "livekitRoomName" = ${len(args)}',
        *args,
    )


async def set_sip_call_identity(
    room: str,
    sip_call_id: str | None = None,
    provider_call_id: str | None = None,
) -> None:
    """Persist the telephony-provider identifiers for the call in ``room``.

    ``sip_call_id`` is LiveKit's ``sip.callIDFull`` — the trunk provider's SIP
    Call-ID. It is the deterministic join key used after the call to find the
    Vobiz recording (``GET /cdr?sip_call_id=…`` → ``uuid`` → the recording), so
    it has to be captured WHILE the call is up: it is not recoverable later, and
    without it a call can only be matched by number + timestamp.

    Writes are best-effort and only ever touch these two columns, so this can
    never interfere with the recording columns or the live call. ``sipCallId``
    is UNIQUE, so a repeat value is swallowed rather than raised.
    """
    sets: list[str] = []
    args: list[object] = []
    def add(col: str, val: object) -> None:
        args.append(val)
        # COALESCE => first write wins. The same id can be offered more than
        # once (the post-answer sweep and the attributes-changed handler both
        # report it), so this makes repeat calls genuinely idempotent instead of
        # rewriting a column that is already correct.
        sets.append(f'"{col}" = COALESCE("{col}", ${len(args)})')
    if sip_call_id: add("sipCallId", sip_call_id)
    if provider_call_id: add("providerCallId", provider_call_id)
    if not sets:
        return
    args.append(room)
    pool = await get_pool()
    try:
        await pool.execute(
            f'UPDATE calls SET {", ".join(sets)}, "updatedAt" = now() '
            f'WHERE "livekitRoomName" = ${len(args)}',
            *args,
        )
    except Exception:
        # A unique violation on a retried/duplicated SIP id must not surface:
        # the identifiers are post-call bookkeeping, the call itself is live.
        pass  # never let logging break the caller


async def set_vobiz_recording(
    call_id: str,
    provider_call_id: str | None = None,
    provider_recording_id: str | None = None,
    provider_recording_url: str | None = None,
    provider_recording_status: str | None = None,
    recording_source: str | None = None,
    duration_seconds: int | None = None,
) -> None:
    """Store the telephony-provider recording fields on a call, by call id.

    Only non-None arguments are written, so a partial update (e.g. recording the
    call_uuid before the recording itself exists) never clobbers a later one.
    Durations are only overwritten when the provider supplies one, so a good
    local duration is never replaced with a null.
    """
    sets: list[str] = []
    args: list[object] = []
    def add(col: str, val: object) -> None:
        args.append(val)
        sets.append(f'"{col}" = ${len(args)}')
    if provider_call_id is not None:          add("providerCallId", provider_call_id)
    if provider_recording_id is not None:     add("providerRecordingId", provider_recording_id)
    if provider_recording_url is not None:    add("providerRecordingUrl", provider_recording_url)
    if provider_recording_status is not None: add("providerRecordingStatus", provider_recording_status)
    if recording_source is not None:          add("recordingSource", recording_source)
    if duration_seconds is not None:          add("recordingDurationSeconds", duration_seconds)
    if not sets:
        return
    args.append(call_id)
    pool = await get_pool()
    await pool.execute(
        f'UPDATE calls SET {", ".join(sets)}, "updatedAt" = now() WHERE id = ${len(args)}',
        *args,
    )


async def get_calls_awaiting_vobiz_recording(
    window_minutes: int = 30,
    limit: int = 20,
) -> list[dict]:
    """Completed Vobiz calls that still need their provider recording resolved.

    The gate is deliberately strict so nothing is ever guessed at:
      * the call has reached a TERMINAL status (polling is post-call only — a
        live call is never touched)
      * it ran over the Vobiz trunk
      * it is not already READY or terminally FAILED
      * it finished within the window, so old calls are never re-polled forever

    Note on the time column: `endedAt` is only written from the day this shipped
    onward, so COALESCE falls back to `updatedAt` (which complete_call has always
    stamped) and finally `createdAt`. Without that fallback the sweeper would
    silently never match anything.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        f'''SELECT id, "sipCallId", "providerCallId",
                   "toNumber", "durationSeconds",
                   COALESCE("endedAt", "updatedAt", "createdAt") AS finished_at
              FROM calls
             WHERE status IN ('COMPLETED'::"CallStatus", 'FAILED'::"CallStatus",
                              'NO_ANSWER'::"CallStatus", 'BUSY'::"CallStatus")
               AND COALESCE("endedAt", "updatedAt", "createdAt")
                     > NOW() - INTERVAL '{int(window_minutes)} minutes'
               AND lower(COALESCE(telephony_provider, '')) = 'vobiz'
               -- The deterministic join key. Calls from before sipCallId capture
               -- shipped have none and are intentionally left on their local
               -- recording rather than matched by number + timestamp.
               AND "sipCallId" IS NOT NULL
               AND COALESCE("providerRecordingStatus", '') NOT IN ('READY', 'FAILED')
             ORDER BY COALESCE("endedAt", "updatedAt", "createdAt") DESC
             LIMIT {int(limit)}''',
    )
    return [dict(r) for r in rows]


async def get_call_vobiz_recording(call_id: str) -> dict | None:
    """The stored Vobiz recording pointer for one call (for the audio proxy)."""
    pool = await get_pool()
    row = await pool.fetchrow(
        'SELECT id, "providerRecordingUrl", "providerRecordingId", '
        '"providerRecordingStatus", "recordingSource" FROM calls WHERE id = $1',
        call_id,
    )
    return dict(row) if row else None


# ── Parallel campaign dialing ────────────────────────────────────────────────
# Slot accounting and target claiming live in the DATABASE, not in process
# memory: the API can run more than one worker, and an in-process semaphore
# would let each one dial up to the limit independently.

#: A claim older than this is treated as abandoned (dispatcher crashed), so the
#: target becomes dialable again. Must comfortably exceed the time from claim to
#: the call appearing in active_calls.
CLAIM_RECLAIM_SECONDS = 180

#: active_calls rows are removed when a call ends, but a killed job leaves one
#: behind. Anything older than this is not counted as occupying a slot.
#: (Measured on this install: the table held 20 rows, all stale, none within 30
#: minutes — counting them naively would report the system permanently full.)
ACTIVE_CALL_STALE_SECONDS = 1800


async def claim_campaign_target(campaign_id: str, attempt_id: str) -> dict | None:
    """Atomically take ONE dialable target for this campaign, or None.

    FOR UPDATE SKIP LOCKED is what makes concurrent dispatchers safe: each one
    locks a different row instead of all reading the same PENDING row and
    dialing the same customer. The claim is recorded on the row itself, so it
    survives a process restart.

    A row is dialable when it is PENDING, its optional dispatchAfter has passed,
    and it is either unclaimed or its claim has expired.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        'UPDATE campaign_targets t '
        '   SET "claimedAt" = now(), "attemptId" = $2, '
        '       attempts = t.attempts + 1, "updatedAt" = now() '
        ' WHERE t.id = ('
        '       SELECT c.id FROM campaign_targets c '
        '        WHERE c."campaignId" = $1 '
        '          AND c.status = \'PENDING\'::"CampaignTargetStatus" '
        '          AND (c."dispatchAfter" IS NULL OR c."dispatchAfter" <= now()) '
        '          AND (c."claimedAt" IS NULL OR c."claimedAt" < now() - '
        f'              interval \'{int(CLAIM_RECLAIM_SECONDS)} seconds\') '
        '        ORDER BY c.id FOR UPDATE SKIP LOCKED LIMIT 1) '
        'RETURNING t.id, t."phoneNumber", t."leadName", t.attempts, t."attemptId"',
        campaign_id, attempt_id,
    )
    return dict(row) if row else None


async def release_campaign_claim(target_id: str, status: str | None = None,
                                 error: str | None = None) -> None:
    """Hand a claimed target back.

    `status` None returns it to the queue (claim cleared) — used when capacity
    or compliance blocked the dial, so nothing was actually attempted. A
    terminal status records the outcome instead.
    """
    pool = await get_pool()
    if status is None:
        await pool.execute(
            'UPDATE campaign_targets SET "claimedAt" = NULL, "updatedAt" = now() '
            'WHERE id = $1',
            target_id,
        )
        return
    await pool.execute(
        'UPDATE campaign_targets '
        '   SET status = $2::"CampaignTargetStatus", '
        '       "lastError" = COALESCE($3, "lastError"), "updatedAt" = now() '
        ' WHERE id = $1',
        target_id, status.upper(), error,
    )


async def mark_campaign_target_dispatched(target_id: str, room: str,
                                          dispatch_id: str | None = None) -> None:
    """Record a successful dial. The slot is now held by the live call."""
    pool = await get_pool()
    await pool.execute(
        'UPDATE campaign_targets '
        '   SET status = \'DISPATCHED\'::"CampaignTargetStatus", '
        '       "callId" = $2, "dispatchId" = COALESCE($3, "dispatchId"), '
        '       "dispatchedAt" = now(), "updatedAt" = now() '
        ' WHERE id = $1',
        target_id, room, dispatch_id,
    )


async def settle_campaign_target(room: str, *, status: str,
                                 error: str | None = None) -> bool:
    """Close out a dispatched campaign target once its call has ENDED.

    WHY THIS EXISTS: every other campaign_targets writer runs in the dispatcher,
    before or at dial time — FAILED (bad number / dial threw), BLOCKED (DND),
    DEFERRED (outside the window) and DISPATCHED (the dial API accepted). After
    a successful dial nothing ever wrote the row again, so a target stayed
    DISPATCHED forever no matter what happened on the call, and the campaign's
    completedTargets/failedTargets counters stayed at 0 while it was marked
    COMPLETED. DISPATCHED therefore meant only "the dial API returned 200",
    which is exactly what must never be presented as a successful call.

    Keyed on the room name, which mark_campaign_target_dispatched stored in
    "callId". Scoped to status = 'DISPATCHED' so it is idempotent (a retried
    shutdown hook cannot overwrite a settled row) and so it can never disturb a
    target the dispatcher already resolved. Returns True when a row was settled.
    """
    if not room:
        return False
    pool = await get_pool()
    tag = await pool.execute(
        'UPDATE campaign_targets '
        '   SET status = $2::"CampaignTargetStatus", '
        '       "lastError" = COALESCE($3, "lastError"), "updatedAt" = now() '
        ' WHERE "callId" = $1 '
        '   AND status = \'DISPATCHED\'::"CampaignTargetStatus"',
        room, status.upper(), error,
    )
    return tag.rsplit(" ", 1)[-1] not in ("0", "")


async def refresh_campaign_counters(room: str) -> None:
    """Recompute a campaign's completed/failed counters from its targets.

    Derived from the rows rather than incremented, so it is safe to call more
    than once and self-heals counters that drifted while targets were never
    being settled.
    """
    if not room:
        return
    pool = await get_pool()
    await pool.execute(
        'UPDATE campaigns c SET '
        '  "completedTargets" = s.done, "failedTargets" = s.failed, '
        '  "updatedAt" = now() '
        'FROM ( '
        '  SELECT t."campaignId" cid, '
        '         COUNT(*) FILTER (WHERE t.status = \'COMPLETED\') done, '
        '         COUNT(*) FILTER (WHERE t.status IN (\'FAILED\',\'BLOCKED\')) failed '
        '    FROM campaign_targets t '
        '   WHERE t."campaignId" = ( '
        '           SELECT "campaignId" FROM campaign_targets WHERE "callId" = $1 LIMIT 1) '
        '   GROUP BY t."campaignId") s '
        'WHERE c.id = s.cid',
        room,
    )


async def count_live_calls() -> int:
    """Calls currently occupying provider capacity, across ALL sources.

    Counts the shared active_calls registry (the worker adds a row when a call
    connects and removes it when it ends), so campaign calls, single dials and
    inbound traffic are all included — a campaign must not spend capacity that
    another call already holds.

    Stale rows from killed jobs are excluded by age.
    """
    pool = await get_pool()
    return int(await pool.fetchval(
        'SELECT COUNT(*) FROM active_calls WHERE started_at > now() - '
        f'interval \'{int(ACTIVE_CALL_STALE_SECONDS)} seconds\'',
    ) or 0)


async def count_recent_campaign_starts(campaign_id: str, window_seconds: int = 60) -> int:
    """Calls this campaign has STARTED inside the rate window.

    Read from the calls table rather than an in-memory counter, so the dial rate
    stays enforced after a restart and across processes.
    """
    pool = await get_pool()
    return int(await pool.fetchval(
        'SELECT COUNT(*) FROM calls WHERE "campaignId" = $1 AND "createdAt" > now() - '
        f'interval \'{int(window_seconds)} seconds\'',
        campaign_id,
    ) or 0)


async def get_campaign_dispatch_config(campaign_id: str) -> dict | None:
    """Status plus the campaign's requested concurrency and dial rate."""
    pool = await get_pool()
    row = await pool.fetchrow(
        'SELECT id, status::text AS status, "maxConcurrent", "maxStartsPerMinute", '
        '       "callDelaySeconds", "agentProfileId", "assistantId" '
        '  FROM campaigns WHERE id = $1',
        campaign_id,
    )
    return dict(row) if row else None


async def count_campaign_targets_by_status(campaign_id: str) -> dict[str, int]:
    """Queue depth per status, for the campaign progress panel."""
    pool = await get_pool()
    rows = await pool.fetch(
        'SELECT status::text AS s, COUNT(*) AS n FROM campaign_targets '
        ' WHERE "campaignId" = $1 GROUP BY 1',
        campaign_id,
    )
    return {r["s"]: int(r["n"]) for r in rows}


# ── Real-time transcript ──────────────────────────────────────────────────────

async def insert_transcript_message(
    call_id: str,
    role: str,
    content: str,
    content_redacted: str | None = None,
    has_pii: bool = False,
) -> None:
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO transcript_messages
             (id, "callId", role, content, "contentRedacted", "hasPii", "timestamp")
           VALUES ($1, $2, $3::"TranscriptRole", $4, $5, $6, now())''',
        str(uuid.uuid4()), call_id, role.upper(), content, content_redacted, has_pii,
    )


async def mark_call_has_pii(call_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        '''UPDATE calls SET "transcriptHasPii" = true WHERE id = $1''',
        call_id,
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


def _shape_agent_profile(row) -> dict:
    """agent_profiles row -> the profile dict the agent reads.

    `agent_profiles.model` is the GEMINI REALTIME model id (config.GEMINI_MODEL,
    e.g. "gemini-3.1-flash-live-preview") — the table predates the pipeline path
    and has no llm_provider or chat-model column at all. Returning it as "model"
    made the pipeline hand a Gemini realtime id to the selected chat provider,
    which answered 404 `model_not_found` on every turn. It is exposed as
    `realtime_model` so only the realtime path can consume it; the pipeline gets
    no chat-model selection from this table and uses the provider's default.
    """
    d = dict(row)
    d["realtime_model"] = d.pop("model", None)
    d["model"] = None
    d["model_source"] = "agent_profiles (realtime only; no chat-model selection)"
    return d


async def get_agent_profile(profile_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM agent_profiles WHERE id = $1", profile_id)
    return _shape_agent_profile(row) if row else None


async def get_default_agent_profile() -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM agent_profiles WHERE is_default = true LIMIT 1",
    )
    return _shape_agent_profile(row) if row else None


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


async def get_provider_credentials(org_id: str) -> list[dict]:
    """Ciphertext rows for one organisation's BYOK provider credentials.

    Returns ciphertext only — decryption belongs to provider_credentials.py, so
    this layer never holds a plaintext key. Ordered by provider for stable logs.
    """
    pool = await get_pool()
    rows = await pool.fetch(
        '''SELECT provider, ciphertext
             FROM provider_credentials
            WHERE organization_id = $1
            ORDER BY provider''',
        org_id,
    )
    return [dict(r) for r in rows]


async def record_credential_check(org_id: str, provider: str, status: str,
                                  error: str | None = None) -> None:
    """Store the outcome of a REAL vendor validation call.

    Kept separate from the dashboard's own write path so the worker can also
    mark a credential bad when a live call gets a 401 from the vendor.
    """
    pool = await get_pool()
    await pool.execute(
        '''UPDATE provider_credentials
              SET last_status = $3, last_error = $4, last_checked_at = NOW()
            WHERE organization_id = $1 AND provider = $2''',
        org_id, provider.lower(), status, (error or None),
    )


# ── Human call forwarding ─────────────────────────────────────────────────────
# The four supported categories. The LLM only ever selects one of these names;
# it never sees or supplies a phone number.
HUMAN_TRANSFER_CATEGORIES = ("software", "marketing", "content", "other")
HUMAN_TRANSFER_LABELS = {
    "software": "Software",
    "marketing": "Marketing",
    "content": "Content",
    "other": "Other / General",
}


async def get_human_transfer_targets(assistant_id: str) -> dict[str, dict]:
    """Forwarding destinations for one assistant, keyed by category.

    Returns only ENABLED rows that actually have a number, because a row with
    neither is indistinguishable from "not configured" at call time. Ordered by
    priority so the caller-facing resolution is deterministic.
    """
    if not assistant_id:
        return {}
    pool = await get_pool()
    rows = await pool.fetch(
        '''SELECT category, label, phone_e164, enabled, priority
             FROM human_transfer_targets
            WHERE assistant_id = $1
            ORDER BY priority ASC, category ASC''',
        assistant_id,
    )
    out: dict[str, dict] = {}
    for r in rows:
        cat = (r["category"] or "").strip().lower()
        if cat not in HUMAN_TRANSFER_CATEGORIES:
            continue
        if not r["enabled"] or not (r["phone_e164"] or "").strip():
            continue
        out[cat] = {
            "category": cat,
            "label": (r["label"] or HUMAN_TRANSFER_LABELS.get(cat, cat)).strip(),
            "phone": r["phone_e164"].strip(),
            "priority": int(r["priority"] or 100),
        }
    return out


def _resolve_tts_provider(stored: str | None) -> str:
    """Map the stored TtsProvider value onto a registry provider id.

    Returns the operator's choice whenever the registry has a TTS row for it.
    Only an empty value, or a name the registry has never heard of, falls back
    to the platform default — and that is a genuine "nothing was chosen", not a
    substitution of one working provider for another.
    """
    name = (stored or "").strip().lower()
    if not name:
        return config.DEFAULT_TTS_PROVIDER
    if provider_registry.get(name, "TTS") is not None:
        return name
    return config.DEFAULT_TTS_PROVIDER


async def get_assistant_as_profile(assistant_id: str) -> dict | None:
    """Load an Assistant row and shape it as the profile dict the agent expects.

    Maps Prisma camelCase columns onto the snake_case keys agent.py reads.
    Falls back to None if the assistant is missing or inactive.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT id, name, "organizationId",
                  "systemPrompt", "firstMessage", "endCallMessage",
                  "llmProvider", "llmModel", "llm_fallback_model", temperature, "maxTokens",
                  "sttProvider", "sttModel", "sttLanguage",
                  "ttsProvider", "ttsModel", "voiceId",
                  "silenceTimeoutSeconds", "maxDurationSeconds",
                  "endOfSpeechSensitivity", "interruptionThresholdMs",
                  "backgroundDenoising", "voicemailDetection",
                  "voicemailMessage", "confidenceThresholdPct",
                  "hallucinationGuard", "minPauseMs",
                  "recordingEnabled", "recordingConsentMessage",
                  "redactionEnabled", "isActive"
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
        # Whose BYOK provider credentials apply to this call.
        "organization_id": r["organizationId"],
        "system_prompt": r["systemPrompt"],
        "first_message": r["firstMessage"],
        "end_call_message": r["endCallMessage"],
        "llm_provider": (r["llmProvider"] or "OPENAI").lower(),
        "model": r["llmModel"],
        # Operator-chosen fallback model. None = use the provider's default.
        "fallback_model": r["llm_fallback_model"],
        "temperature": float(r["temperature"]) if r["temperature"] is not None else 0.7,
        "max_tokens": r["maxTokens"],
        "stt_provider": (r["sttProvider"] or "DEEPGRAM").lower(),
        "stt_model": r["sttModel"],
        "stt_language": r["sttLanguage"],
        # Honour whatever the operator chose, as long as the registry knows it.
        # This used to be a four-name whitelist that rewrote everything else to
        # the platform default — a silent substitution that made Deepgram,
        # Gemini, Rumik and Murf unselectable no matter what the UI showed.
        # Validity is now the registry's call; whether the provider can actually
        # carry a call (adapter + credential) is decided in agent.py, which logs
        # and explains any fallback instead of hiding it here.
        "tts_provider": _resolve_tts_provider(r["ttsProvider"]),
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
        "recording_consent_message": r["recordingConsentMessage"],
        "redaction_enabled": bool(r["redactionEnabled"]),
        "enabled_tools": "[]",  # populated by get_assistant_tools later
        # Marks that this profile's `id` is a real assistants.id (valid FK for
        # calls.assistantId). agent_profiles/default profiles omit this so the
        # call row's assistantId stays NULL rather than violating the FK.
        "_profile_source": "assistant",
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


# ── Compliance helpers (Feature Pack 4 / Task 7) ──────────────────────────────

async def is_on_dnd(org_id: str, phone_e164: str) -> bool:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT 1 FROM dnd_numbers
           WHERE "organizationId" = $1 AND "phoneE164" = $2''',
        org_id,
        phone_e164,
    )
    return row is not None


async def get_org_quiet_hours(org_id: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT "quietHoursStart" AS start, "quietHoursEnd" AS end_,
                  "quietHoursTimezone" AS tz
             FROM organizations WHERE id = $1''',
        org_id,
    )
    if not row:
        return None
    return {"start": row["start"], "end": row["end_"], "tz": row["tz"]}


async def add_dnd_caller_request(org_id: str, phone_e164: str) -> None:
    """Used by the agent when a caller says 'stop calling'."""
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO dnd_numbers
             (id, "organizationId", "phoneE164", source, "createdAt")
           VALUES ($1, $2, $3, 'CALLER_REQUEST', now())
           ON CONFLICT ("organizationId", "phoneE164") DO NOTHING''',
        str(uuid.uuid4()),
        org_id,
        phone_e164,
    )


# ── Webhook retry helpers (Feature Pack 4 / Tasks 12-13) ─────────────────────

RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 43200]  # 1m, 5m, 30m, 2h, 12h


async def create_webhook_delivery_pending(
    webhook_id: str,
    event: str,
    payload: dict,
    call_id: str | None = None,
) -> str:
    """Insert a delivery row with status PENDING, attempts=0. Returns the new id."""
    pool = await get_pool()
    delivery_id = str(uuid.uuid4())
    await pool.execute(
        '''INSERT INTO webhook_deliveries
             (id, "webhookId", "callId", event, payload, attempts, status, "createdAt")
           VALUES ($1, $2, $3, $4::"WebhookEvent", $5::jsonb, 0, 'PENDING', now())''',
        delivery_id, webhook_id, call_id, event,
        json.dumps(payload),
    )
    return delivery_id


async def schedule_webhook_retry(delivery_id: str, error: str) -> None:
    """Bump attemptsMade, schedule next attempt or dead-letter.

    Note: In Prisma the column is exposed as ``attemptsMade``; the underlying
    Postgres column is ``attempts`` (via @map). Raw SQL uses ``attempts``.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT "attempts" FROM webhook_deliveries WHERE id = $1''',
        delivery_id,
    )
    if not row:
        return
    next_attempt_idx = row["attempts"]  # 0-indexed: value is count of completed attempts
    if next_attempt_idx >= len(RETRY_SCHEDULE_SECONDS):
        await pool.execute(
            '''UPDATE webhook_deliveries
               SET status = 'DEAD_LETTER',
                   "attempts" = "attempts" + 1,
                   "lastError" = $2,
                   "nextAttemptAt" = NULL
               WHERE id = $1''',
            delivery_id, error[:1000],
        )
        return
    delay = RETRY_SCHEDULE_SECONDS[next_attempt_idx]
    await pool.execute(
        '''UPDATE webhook_deliveries
           SET status = 'RETRY_SCHEDULED',
               "attempts" = "attempts" + 1,
               "lastError" = $2,
               "nextAttemptAt" = now() + ($3 || ' seconds')::interval
           WHERE id = $1''',
        delivery_id, error[:1000], str(delay),
    )


async def mark_webhook_succeeded(delivery_id: str, status_code: int, body: str) -> None:
    pool = await get_pool()
    await pool.execute(
        '''UPDATE webhook_deliveries
           SET status = 'SUCCESS',
               "attempts" = "attempts" + 1,
               "responseCode" = $2,
               "responseBody" = $3,
               "succeededAt" = now(),
               "nextAttemptAt" = NULL
           WHERE id = $1''',
        delivery_id, status_code, (body or "")[:5000],
    )


async def fetch_pending_retries(limit: int = 50) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        '''SELECT d.id, d."webhookId", d.event::text AS event, d.payload,
                  w.url, w.secret
           FROM webhook_deliveries d
           JOIN webhooks w ON w.id = d."webhookId"
           WHERE d.status = 'RETRY_SCHEDULED' AND d."nextAttemptAt" <= now()
             AND w."isActive" = true
           ORDER BY d."nextAttemptAt" ASC
           LIMIT $1
           FOR UPDATE OF d SKIP LOCKED''',
        limit,
    )
    return [dict(r) for r in rows]


async def queue_immediate_retry(delivery_id: str) -> None:
    pool = await get_pool()
    await pool.execute(
        '''UPDATE webhook_deliveries
           SET status = 'RETRY_SCHEDULED', "nextAttemptAt" = now()
           WHERE id = $1''',
        delivery_id,
    )


# ── Idempotency helpers (Feature Pack 4 / Task 15) ────────────────────────────

async def get_idempotency(org_id: str, scope: str, key: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        '''SELECT "requestHash", "responseStatus", "responseBody"
             FROM idempotency_keys
             WHERE "organizationId" = $1 AND scope = $2 AND key = $3''',
        org_id, scope, key,
    )
    return dict(row) if row else None


async def record_idempotency(
    org_id: str, scope: str, key: str, request_hash: str,
    response_status: int, response_body: dict,
) -> None:
    pool = await get_pool()
    await pool.execute(
        '''INSERT INTO idempotency_keys
             (id, "organizationId", scope, key, "requestHash",
              "responseStatus", "responseBody", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
           ON CONFLICT ("organizationId", scope, key) DO NOTHING''',
        str(uuid.uuid4()), org_id, scope, key, request_hash,
        response_status, json.dumps(response_body),
    )


async def prune_idempotency_keys() -> int:
    pool = await get_pool()
    r = await pool.execute(
        '''DELETE FROM idempotency_keys
             WHERE "createdAt" < now() - interval '24 hours' '''
    )
    return int(r.split()[-1]) if r else 0
