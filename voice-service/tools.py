"""LLM function tools the agent can invoke during a call."""

from __future__ import annotations

import os
import time

from livekit import agents
from livekit.agents import llm

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
