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

import db
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


def send_sms(to_phone: str, message: str) -> bool:
    sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    tok = os.environ.get("TWILIO_AUTH_TOKEN", "")
    frm = os.environ.get("TWILIO_FROM_NUMBER", "")
    if not sid or not tok or not frm:
        return False
    try:
        r = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, tok), data={"From": frm, "To": to_phone, "Body": message}, timeout=8.0,
        )
        r.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("sms_failed", error=str(exc))
        return False


def send_booking_confirmation_email(
    to_email: str,
    caller_name: str,
    booking_time_iso: str,
    booking_id: str,
    service: str = "",
    business_name: str = "VIMS Enterprise",
) -> bool:
    """Send a booking confirmation email via standard SMTP or Resend API.
    
    Reads credentials from env:
      - SMTP: SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD/SMTP_PASS, SMTP_FROM
      - Resend: RESEND_API_KEY
    """
    clean_email = (to_email or "").strip().lower()
    if not clean_email or "@" not in clean_email or "." not in clean_email.split("@")[-1]:
        return False

    try:
        dt = datetime.fromisoformat(booking_time_iso)
        readable = dt.strftime("%A, %d %B %Y at %I:%M %p IST")
    except Exception:
        readable = booking_time_iso

    smtp_host = os.environ.get("SMTP_HOST", "").strip()
    smtp_port_raw = os.environ.get("SMTP_PORT", "587").strip()
    smtp_port = int(smtp_port_raw) if smtp_port_raw.isdigit() else 587
    smtp_user = os.environ.get("SMTP_USER", "").strip()
    smtp_pass = os.environ.get("SMTP_PASSWORD", os.environ.get("SMTP_PASS", "")).strip()
    smtp_from = os.environ.get("SMTP_FROM", smtp_user or f"bookings@{business_name.lower().replace(' ', '')}.com").strip()
    resend_key = os.environ.get("RESEND_API_KEY", "").strip()

    subject = f"Appointment Confirmed: {business_name} [Booking ID: {booking_id}]"

    html_content = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; padding: 24px 0; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 28px 24px; text-align: center; color: #ffffff;">
      <h1 style="margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.025em;">Appointment Confirmed!</h1>
      <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">{business_name}</p>
    </div>
    <div style="padding: 28px 24px; color: #334155;">
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.5;">
        Dear <strong>{caller_name or 'Valued Customer'}</strong>,
      </p>
      <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.5;">
        Your appointment has been successfully booked with <strong>{business_name}</strong>. Here are your booking details:
      </p>
      <div style="background: #f1f5f9; border-radius: 8px; padding: 18px 20px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b; width: 130px;">Booking ID:</td>
            <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">{booking_id}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Service:</td>
            <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">{service or 'Consultation'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Date & Time:</td>
            <td style="padding: 6px 0; font-weight: 600; color: #2563eb;">{readable}</td>
          </tr>
        </table>
      </div>
      <p style="margin: 0 0 8px; font-size: 14px; color: #64748b; line-height: 1.5;">
        If you need to reschedule or have any questions, feel free to reply to this email or call our desk anytime.
      </p>
    </div>
    <div style="background: #f8fafc; padding: 16px 24px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #94a3b8;">
      &copy; {datetime.now(UTC).year} {business_name}. All rights reserved.
    </div>
  </div>
</body>
</html>"""

    text_content = (
        f"Appointment Confirmed!\n\n"
        f"Dear {caller_name or 'Valued Customer'},\n\n"
        f"Your appointment with {business_name} has been confirmed.\n\n"
        f"• Booking ID: {booking_id}\n"
        f"• Service: {service or 'Consultation'}\n"
        f"• Date & Time: {readable}\n\n"
        f"Thank you for choosing {business_name}."
    )

    # 1. Try Resend if configured
    if resend_key:
        try:
            r = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {resend_key}"},
                json={
                    "from": smtp_from or "onboarding@resend.dev",
                    "to": [clean_email],
                    "subject": subject,
                    "html": html_content,
                    "text": text_content,
                },
                timeout=10.0,
            )
            if r.status_code < 300:
                logger.info("booking_email_sent_resend", to=clean_email, booking_id=booking_id)
                return True
            else:
                logger.warning("resend_email_failed", status=r.status_code, body=r.text[:200])
        except Exception as exc:
            logger.warning("resend_email_exception", error=str(exc))

    # 2. Try SMTP if configured
    if smtp_host and smtp_user and smtp_pass:
        try:
            import smtplib
            from email.message import EmailMessage

            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = clean_email
            msg.set_content(text_content)
            msg.add_alternative(html_content, subtype="html")

            if smtp_port == 465:
                with smtplib.SMTP_SSL(smtp_host, smtp_port, timeout=12) as server:
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)
            else:
                with smtplib.SMTP(smtp_host, smtp_port, timeout=12) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_pass)
                    server.send_message(msg)

            logger.info("booking_email_sent_smtp", to=clean_email, booking_id=booking_id, host=smtp_host)
            return True
        except Exception as exc:
            logger.warning("smtp_email_failed", error=str(exc), to=clean_email, host=smtp_host)
            return False

    # 3. Neither SMTP nor Resend configured
    logger.info("booking_email_skipped_no_smtp", to=clean_email, booking_id=booking_id,
                detail="Neither SMTP (SMTP_HOST/SMTP_USER/SMTP_PASSWORD) nor RESEND_API_KEY is configured in .env")
    return False


def notify_booking_confirmed(caller_name: str, caller_phone: str, booking_time_iso: str,
                             booking_id: str, notes: str = "", tts_voice: str = "",
                             caller_email: str = "", service: str = "") -> bool:
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
    wa_ok = send_whatsapp(caller_phone, f"✅ Hi {caller_name}, your appointment is confirmed for {readable}.")
    if not wa_ok:
        send_sms(caller_phone, f"Hi {caller_name}, your appointment is confirmed for {readable} with VIMS Enterprise.")
    if caller_email:
        send_booking_confirmation_email(
            to_email=caller_email,
            caller_name=caller_name,
            booking_time_iso=booking_time_iso,
            booking_id=booking_id,
            service=service,
        )
    return sent


def notify_appointment_reminder(customer_phone: str, customer_name: str,
                                business: str, when_readable: str) -> bool:
    """Send the appointment reminder to the CUSTOMER (WhatsApp). Returns True
    only when the message was accepted by the provider."""
    name = customer_name or "there"
    msg = (
        f"Hello {name}, this is a reminder for your appointment with {business} "
        f"on {when_readable}. Please contact us if you need to make any changes."
    )
    return send_whatsapp(customer_phone, msg)


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
    *,
    webhook_id: str | None = None,
    call_id: str | None = None,
) -> tuple[int | None, str]:
    """Sign and POST a webhook. Returns (status_code, body[:500]).

    Adds these headers (HMAC-SHA256 over <ts>.<canonical_body>):
      X-JJV-Event:     CALL_ENDED
      X-JJV-Timestamp: <unix seconds>
      X-JJV-Signature: sha256=<hex>

    Receivers verify by recomputing hmac(secret, ts + "." + body).
    Backward-compatible — receivers that ignore unknown headers see plain JSON.

    If ``webhook_id`` is provided, a WebhookDelivery row is created (PENDING)
    before the POST and updated to SUCCESS or RETRY_SCHEDULED on outcome.
    The delivery row id is NOT returned here to preserve backward-compat; use
    ``send_existing_delivery`` for retry replays that need the id.
    """
    # Pre-insert delivery row when webhook_id is supplied (new integrated path).
    delivery_id: str | None = None
    if webhook_id:
        try:
            delivery_id = await db.create_webhook_delivery_pending(
                webhook_id, event_type, payload, call_id=call_id
            )
        except Exception as exc:
            logger.warning("webhook_delivery_create_failed", error=str(exc))

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
        status_code: int | None = r.status_code
        body_text = (r.text or "")[:500]
    except Exception as exc:
        status_code = None
        body_text = str(exc)[:500]

    # Update delivery row state when running the integrated path.
    if delivery_id:
        try:
            if status_code is not None and 200 <= status_code < 300:
                await db.mark_webhook_succeeded(delivery_id, status_code, body_text)
            else:
                error_msg = (
                    f"HTTP {status_code}: {body_text}"
                    if status_code is not None
                    else body_text
                )
                await db.schedule_webhook_retry(delivery_id, error_msg)
        except Exception as exc:
            logger.warning("webhook_delivery_update_failed", error=str(exc))

    return status_code, body_text


async def send_existing_delivery(
    delivery_id: str, url: str, secret: str, event: str, payload: dict
) -> None:
    """Replay a webhook delivery row. Updates the row on outcome."""
    body = _json.dumps(payload, separators=(",", ":"), sort_keys=True)
    ts = str(int(time.time()))
    sig = hmac.new(
        (secret or "").encode(),
        f"{ts}.{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    headers = {
        "Content-Type": "application/json",
        "X-JJV-Event": event,
        "X-JJV-Timestamp": ts,
        "X-JJV-Signature": sig,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(url, content=body, headers=headers)
    if 200 <= resp.status_code < 300:
        await db.mark_webhook_succeeded(delivery_id, resp.status_code, resp.text)
    else:
        await db.schedule_webhook_retry(
            delivery_id, f"HTTP {resp.status_code}: {resp.text[:200]}"
        )
