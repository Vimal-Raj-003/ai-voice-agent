"""Telegram + Twilio WhatsApp + n8n / generic webhook delivery."""

from __future__ import annotations

import hashlib
import hmac
import json as _json
import os
import time
from datetime import UTC, datetime

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
        f"\U0001f464 *Name:* {caller_name}\n"
        f"\U0001f4de *Phone:* `{caller_phone}`\n"
        f"\U0001f4c5 *When:* {readable}\n"
        f"\U0001f516 *ID:* `{booking_id}`\n"
        f"\U0001f4dd *Notes:* {notes or '—'}\n"
        f"\U0001f399️ *Voice:* {tts_voice or '—'}\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n_OutboundAI_"
    )
    sent = send_telegram(msg)
    send_whatsapp(caller_phone, f"✅ Hi {caller_name}, your appointment is confirmed for {readable}.")
    return sent


def notify_call_no_booking(caller_name: str, caller_phone: str, call_summary: str = "",
                           tts_voice: str = "", duration_seconds: int = 0) -> bool:
    msg = (
        f"\U0001f4f5 *Call ended — no booking*\n"
        f"\U0001f464 {caller_name or 'Unknown'} | \U0001f4de `{caller_phone}` | ⏱ {duration_seconds}s\n"
        f"\U0001f4ac {call_summary[:300]}"
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
                json={"event": event_type, "timestamp": datetime.now(UTC).isoformat(), "data": payload},
                headers={"Content-Type": "application/json"},
            )
            return r.status_code < 300
    except Exception as exc:
        logger.warning("webhook_failed", error=str(exc))
        return False


async def send_signed_webhook(
    url: str,
    secret: str,
    event_type: str,
    payload: dict,
) -> tuple[int | None, str]:
    """Sign and POST a webhook. Returns (status_code, body[:500]).

    Adds these headers (HMAC-SHA256 over <ts>.<canonical_body>):
      X-JJV-Event:     CALL_ENDED
      X-JJV-Timestamp: <unix seconds>
      X-JJV-Signature: sha256=<hex>

    Receivers verify by recomputing hmac(secret, ts + "." + body).
    Backward-compatible — receivers that ignore unknown headers see plain JSON.
    """
    body_bytes = _json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    ts = str(int(time.time()))
    msg = ts.encode() + b"." + body_bytes
    sig = hmac.new(
        (secret or "").encode(), msg, hashlib.sha256
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "JilljillVoice/1.0",
        "X-JJV-Event": event_type,
        "X-JJV-Timestamp": ts,
        "X-JJV-Signature": f"sha256={sig}",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(url, content=body_bytes, headers=headers)
            return r.status_code, (r.text or "")[:500]
    except Exception as exc:
        return None, str(exc)[:500]
