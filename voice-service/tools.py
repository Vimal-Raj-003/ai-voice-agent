"""LLM function tools the agent can invoke during a call."""

from __future__ import annotations

import asyncio
import os
import time

from livekit import agents, api
from livekit.agents import llm

import db
from observability import get_logger

logger = get_logger("tools")


class AppointmentTools(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: str | None = None, lead_name: str | None = None):
        super().__init__(tools=[])
        self.ctx                  = ctx
        self.phone_number         = phone_number
        self.lead_name            = lead_name
        self._call_start_time     = time.time()
        self._sip_domain          = os.getenv("VOBIZ_SIP_DOMAIN", "")
        self.recording_url: str | None = None
        self._closed_outcome: str | None = None
        self._closed_reason: str | None = None
        self.interrupt_count      = 0
        self._bg_tasks: set = set()

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
            await asyncio.to_thread(client.messages.create, body=message, from_=frm, to=phone)
            return f"SMS sent to {phone}."
        except Exception as exc:
            logger.warning("sms_failed", error=str(exc))
            return "SMS delivery failed, but booking is confirmed."

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
                    ts = c.get("createdAt") or c.get("created_at") or ""
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
                task = asyncio.create_task(self._compress_memories())
                self._bg_tasks.add(task)
                task.add_done_callback(self._bg_tasks.discard)
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
            resp = await asyncio.to_thread(model.generate_content, prompt)
            txt = (resp.text or "").strip()
            if txt:
                await db.compress_contact_memory(self.phone_number or "", txt)
        except Exception as exc:
            logger.warning("memory_compression_failed", error=str(exc))

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

            import pytz
            naive = _dt.strptime(f"{date} {start_time}", "%Y-%m-%d %H:%M")
            local_tz = pytz.timezone(tz)
            local_dt = local_tz.localize(naive)
            start_iso = local_dt.astimezone(pytz.UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")
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
        """Cancel a Cal.com booking by UID."""
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
