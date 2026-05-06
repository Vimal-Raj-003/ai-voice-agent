"""LLM function tools the agent can invoke during a call."""

from __future__ import annotations

import os
import time

from livekit import agents
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
