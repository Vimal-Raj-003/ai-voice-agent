"""Neon DB layer — asyncpg pool + async functions matching the spec API surface."""

from __future__ import annotations

import json
import os
import uuid
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
