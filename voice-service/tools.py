"""LLM function tools the agent can invoke during a call."""

from __future__ import annotations

import asyncio
import os
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytz
from livekit import agents, api
from livekit.agents import llm

import config
import db
from observability import get_logger

logger = get_logger("tools")

# ── Cal.com (v1) calendar integration ───────────────────────────────────────
# Single source of external calendar truth for the live booking flow. The DB
# mirrors every confirmed booking so the dashboard calendar keeps working and
# the two systems stay in sync. Timezone defaults to Asia/Kolkata end-to-end.
CALCOM_BASE = "https://api.cal.com/v2"

# Cal.com API v1 was DECOMMISSIONED: every v1 call now returns HTTP 410
# {"message":"API v1 has been decommissioned. Please migrate to API v2"}.
# These are the per-endpoint versions required by the v2 reference; each
# endpoint pins its own, and sending the wrong value silently falls back to an
# older response shape.
CALCOM_V_SLOTS = "2024-09-04"
CALCOM_V_BOOKINGS = "2026-02-25"


def _calcom_headers(version: str) -> dict:
    """Bearer auth plus the endpoint's pinned version. v1 passed the key as a
    query parameter; v2 requires the Authorization header."""
    return {
        "Authorization": f"Bearer {_calcom_cfg()['api_key']}",
        "cal-api-version": version,
        "Content-Type": "application/json",
    }


def _calcom_cfg() -> dict:
    return {
        "api_key":  os.getenv("CALCOM_API_KEY", ""),
        "event_id": os.getenv("CALCOM_EVENT_TYPE_ID", ""),
        "tz":       os.getenv("CALCOM_TIMEZONE", "Asia/Kolkata"),
    }


def calcom_enabled() -> bool:
    """True only when both the API key and an event-type id are configured."""
    c = _calcom_cfg()
    return bool(c["api_key"] and c["event_id"])


def _phone_digits(phone: str) -> str:
    return "".join(ch for ch in (phone or "") if ch.isdigit()) or "unknown"


def _valid_date(date: str) -> bool:
    try:
        datetime.strptime(date, "%Y-%m-%d")
        return True
    except (ValueError, TypeError):
        return False


def _valid_time(t: str) -> bool:
    try:
        datetime.strptime(t, "%H:%M")
        return True
    except (ValueError, TypeError):
        return False


async def calcom_slot_free(date: str, time: str, call_id: str = "") -> bool | None:
    """Return True if Cal.com offers the given IST slot, False if it does not,
    and None on any API/transport error (caller must treat None as 'unknown',
    never as 'available')."""
    c = _calcom_cfg()
    if not calcom_enabled():
        return None
    tz = pytz.timezone(c["tz"])
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{CALCOM_BASE}/slots",
                headers=_calcom_headers(CALCOM_V_SLOTS),
                params={
                    "eventTypeId": int(c["event_id"]),
                    # v2 renamed startTime/endTime to start/end.
                    "start": date,
                    "end": date,
                    "timeZone": c["tz"],
                },
            )
        if resp.status_code != 200:
            logger.error("CALCOM_AVAILABILITY_FAILED", status=resp.status_code,
                         body=resp.text[:200], call_id=call_id)
            return None
        # v1: data.slots[date][].time   v2: data[date][] as {"start": ...}
        # (or a bare ISO string, depending on `format`).
        slots = resp.json().get("data", {}).get(date, [])
        free: set[str] = set()
        for slot in slots:
            raw = slot.get("start") if isinstance(slot, dict) else slot
            try:
                dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(tz)
                free.add(dt.strftime("%H:%M"))
            except Exception:
                continue
        return time in free
    except Exception as exc:
        logger.error("CALCOM_AVAILABILITY_FAILED", error=str(exc), call_id=call_id)
        return None


async def calcom_book(name: str, email: str, phone: str, date: str, time: str,
                      service: str, notes: str = "", call_id: str = "") -> dict:
    """Create a Cal.com booking for the given IST date/time. Returns
    {success, uid, message}. Never raises."""
    c = _calcom_cfg()
    if not calcom_enabled():
        return {"success": False, "uid": None, "message": "Cal.com not configured"}
    tz = pytz.timezone(c["tz"])
    local_dt = tz.localize(datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M"))
    start_iso = local_dt.astimezone(pytz.UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    logger.info("CALCOM_BOOKING_REQUEST", date=date, time=time, call_id=call_id)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{CALCOM_BASE}/bookings",
                headers=_calcom_headers(CALCOM_V_BOOKINGS),
                json={
                    "eventTypeId": int(c["event_id"]),
                    "start": start_iso,
                    # v2 replaced the flat `responses` blob with a typed
                    # `attendee` object; timeZone and language moved inside it.
                    "attendee": {
                        "name": name,
                        "email": email or f"{_phone_digits(phone)}@voiceagent.placeholder",
                        "timeZone": c["tz"],
                        "language": "en",
                    },
                    "bookingFieldsResponses": {
                        "notes": notes or f"Booked via AI voice agent. Phone: {phone}. Service: {service}",
                    },
                    "metadata": {"source": "JillJillVoice"},
                },
            )
        try:
            data = resp.json()
        except Exception:
            data = {}
        if resp.status_code not in (200, 201):
            msg = str(data.get("message") or resp.text[:150])
            logger.error("CALCOM_BOOKING_FAILED", status=resp.status_code, message=msg, call_id=call_id)
            return {"success": False, "uid": None, "message": msg}
        uid = (data.get("uid")
               or data.get("booking", {}).get("uid")
               or data.get("data", {}).get("uid")
               or "")
        logger.info("CALCOM_BOOKING_SUCCESS", uid=uid, call_id=call_id)
        return {"success": True, "uid": uid, "message": "ok", "start_iso": local_dt.isoformat()}
    except Exception as exc:
        logger.error("CALCOM_BOOKING_FAILED", error=str(exc), call_id=call_id)
        return {"success": False, "uid": None, "message": str(exc)}


async def calcom_cancel(uid: str, reason: str = "", call_id: str = "") -> dict:
    """Cancel a Cal.com booking by uid. Returns {success, message}. Never raises."""
    c = _calcom_cfg()
    if not c["api_key"]:
        return {"success": False, "message": "Cal.com not configured"}
    logger.info("CALENDAR_CANCEL_REQUEST", uid=uid, call_id=call_id)
    try:
        # v1: DELETE .../cancel?reason=   v2: POST .../cancel with a JSON body.
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{CALCOM_BASE}/bookings/{uid}/cancel",
                headers=_calcom_headers(CALCOM_V_BOOKINGS),
                json={"cancellationReason": reason} if reason else {},
            )
        if resp.status_code not in (200, 201, 204):
            logger.error("CALENDAR_CANCEL_FAILED", status=resp.status_code, uid=uid, call_id=call_id)
            return {"success": False, "message": f"HTTP {resp.status_code}"}
        logger.info("CALENDAR_CANCEL_SUCCESS", uid=uid, call_id=call_id)
        return {"success": True, "message": "cancelled"}
    except Exception as exc:
        logger.error("CALENDAR_CANCEL_FAILED", error=str(exc), uid=uid, call_id=call_id)
        return {"success": False, "message": str(exc)}


def reminder_at_utc(date: str, time: str) -> datetime | None:
    """Return the UTC instant to remind the customer (appointment minus the
    configured lead time), or None when reminders are disabled or the
    appointment is too soon for a pre-reminder. Appointment time is IST."""
    if not config.APPOINTMENT_REMINDER_ENABLED:
        return None
    tz = pytz.timezone(os.getenv("CALCOM_TIMEZONE", "Asia/Kolkata"))
    try:
        appt_local = tz.localize(datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M"))
    except ValueError:
        return None
    ra = (appt_local - timedelta(minutes=config.APPOINTMENT_REMINDER_MINUTES_BEFORE)).astimezone(UTC)
    return ra if ra > datetime.now(UTC) else None


class AppointmentTools(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: str | None = None, lead_name: str | None = None, call_state: Any = None):
        super().__init__(tools=[])
        self.ctx                  = ctx
        self.phone_number         = phone_number
        self.lead_name            = lead_name
        # Deterministic structured CallState (Step B). Tools write CONFIRMED
        # facts into it; the LLM node injects it each turn. None in older callers.
        self.call_state           = call_state
        self._call_start_time     = time.time()
        self._sip_domain          = os.getenv("VOBIZ_SIP_DOMAIN", "")
        self.recording_url: str | None = None
        self._closed_outcome: str | None = None
        self._closed_reason: str | None = None
        self.interrupt_count      = 0
        self._bg_tasks: set = set()
        self._last_booking_id: str | None = None
        self._last_booking_time: str | None = None
        self._last_booking_name: str | None = None
        self._last_booking_service: str | None = None
        self._last_booking_notes: str | None = None
        # Duplicate-booking guard: maps an idempotency key (call + slot + phone)
        # to the confirmation string, so a repeated tool call in the same call
        # returns the first result instead of booking twice.
        self._booked_keys: dict[str, str] = {}
        # Human call forwarding. Destinations are loaded per assistant at call
        # start; the LLM only ever names a category.
        self.transfer_targets: dict[str, dict] = {}
        # Set once a transfer is accepted, so a second tool call cannot start
        # another REFER on a call that is already being handed over.
        self._transfer_started = False

    # ── CallState writers (Step B): record CONFIRMED tool facts safely ────────
    def _cs_tool(self, label: str, state: str, unresolved: str | None = None) -> None:
        if not self.call_state:
            return
        try:
            self.call_state.set_tool_fact(label, state=state)
            if unresolved:
                self.call_state.unresolved_item = unresolved
        except Exception:
            pass

    def _cs_book(self, booking_id: str, name: str, date: str, time: str, service: str) -> None:
        """A confirmed booking: lock the slot entities so the LLM can't mutate
        them, and record the booking in tool_state."""
        if not self.call_state:
            return
        try:
            self.call_state.set_tool_fact(
                "booking", state=f"confirmed:{booking_id}",
                entities={"name": name, "date": date, "time": time, "service": service},
            )
            self.call_state.set_phase("confirming")
            self.call_state.clear_pending()
        except Exception:
            pass

    def build_tool_list(self, enabled: list[str]) -> list:
        # Always-available core tools (all functional on this deployment).
        # lookup_contact is intentionally NOT in the default set: the caller's
        # prior history is already pre-loaded into the system prompt ([NOTES]) at
        # call start, so sending its schema on every turn only burns Groq input
        # tokens (ITPM). It can still be enabled explicitly per assistant.
        methods = [
            self.check_availability, self.book_appointment, self.end_call,
            self.transfer_to_human, self.remember_details,
        ]
        if "lookup_contact" in (enabled or []):
            methods.append(self.lookup_contact)
        # Integration tools are exposed ONLY when their backend is configured.
        # Each unused tool's JSON schema is sent to the LLM on every request and
        # just inflates INPUT tokens (Groq's ITPM rate limit) while being unable
        # to work — so Cal.com/Twilio tools are dropped when not configured.
        if calcom_enabled():
            # book_calcom is NOT exposed by default. It is the legacy path (its
            # own docstring says so): it books Cal.com WITHOUT writing the local
            # row, so a booking made through it is invisible to the local
            # calendar, the reminder scheduler and the orphan reconciliation.
            # book_appointment already does Cal.com AND the local DB as one
            # synchronised operation, so exposing both gave the model two ways
            # to book — one of which silently loses the booking locally — and
            # cost ~160 input tokens of schema on every single request.
            #
            # The method is retained and still reachable by naming it in the
            # assistant's enabled tools; only the default LLM-visible schema is
            # withdrawn. cancel_calcom stays: cancellation has no equivalent.
            methods.append(self.cancel_calcom)
            if "book_calcom" in (enabled or []):
                methods.append(self.book_calcom)
        if all(os.environ.get(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER")):
            methods.append(self.send_sms_confirmation)
        if not enabled:
            return methods
        name_map = {m.__name__: m for m in methods}
        return [name_map[n] for n in enabled if n in name_map]

    def _room_call_id(self) -> str:
        # agent.py assigns the DB call id onto the instance as `_call_id` (a str)
        # during setup; prefer it, and fall back to the LiveKit room name.
        cid = getattr(self, "_call_id", None)
        if isinstance(cid, str) and cid:
            return cid
        room = getattr(self.ctx, "room", None)
        rid = getattr(room, "name", "") if room is not None else ""
        return rid if isinstance(rid, str) else ""

    @llm.function_tool
    async def check_availability(self, date: str, time: str) -> str:
        """Check if a slot is free. date=YYYY-MM-DD, time=HH:MM (24h)."""
        call_id = self._room_call_id()
        logger.info("CALENDAR_AVAILABILITY_CHECK", date=date, time=time, call_id=call_id)
        if not _valid_date(date) or not _valid_time(time):
            return "Please give the date as YYYY-MM-DD and the time as HH:MM (24-hour)."
        try:
            # 1. Cal.com (external source of truth) — only when configured.
            if calcom_enabled():
                cal_free = await calcom_slot_free(date, time, call_id)
                if cal_free is None:
                    logger.error("CALENDAR_AVAILABILITY_PROVIDER_DOWN", date=date, time=time, call_id=call_id)
                    return ("I can't reach the calendar right now, so I can't confirm that slot. "
                            "Please hold a moment or suggest another time and I'll check again.")
                if not cal_free:
                    logger.info("CALENDAR_SLOT_UNAVAILABLE", source="calcom", date=date, time=time, call_id=call_id)
                    self._cs_tool("availability", f"unavailable:{date} {time}", unresolved="slot_unavailable")
                    return f"unavailable: {date} at {time} is already booked. Please suggest another time."
            # 2. Local JillJill DB — must also be free.
            if not await db.check_slot(date, time):
                nxt = await db.get_next_available(date, time)
                logger.info("CALENDAR_SLOT_UNAVAILABLE", source="local", date=date, time=time, call_id=call_id)
                self._cs_tool("availability", f"unavailable:{date} {time}", unresolved=f"next_free:{nxt}")
                return f"unavailable: next available slot is {nxt}"
            logger.info("CALENDAR_SLOT_AVAILABLE", date=date, time=time, call_id=call_id)
            # Record the requested slot (overridable) + the confirmed check result.
            if self.call_state:
                self.call_state.set_intent(self.call_state.intent or "appointment_booking")
                self.call_state.update_entity("date", date)
                self.call_state.update_entity("time", time)
            self._cs_tool("availability", f"free:{date} {time}")
            return "available"
        except Exception as exc:
            logger.error("check_availability_failed", error=str(exc), call_id=call_id)
            return "Unable to check availability right now — please suggest a date and I will confirm."

    @llm.function_tool
    async def book_appointment(self, name: str, date: str, time: str,
                               service: str) -> str:
        """Book the appointment after the caller confirms all details. date=YYYY-MM-DD, time=HH:MM (24h)."""
        call_id = self._room_call_id()
        # 1. Validate.
        if not _valid_date(date) or not _valid_time(time):
            return "That date or time wasn't clear. Please confirm the date (YYYY-MM-DD) and time (HH:MM)."
        # The caller's phone is already known from the call; email (if any) is
        # captured via remember_details — neither is a tool parameter, to keep
        # the schema (sent every turn) small.
        phone = self.phone_number or ""
        email = ""  # not collected over voice; kept for the calendar/DB calls below
        # Duplicate protection: if the voice runtime invokes the tool twice for
        # the same slot in this call, return the first confirmation unchanged.
        dedup_key = f"{call_id}:{date}:{time}:{phone}"
        if dedup_key in self._booked_keys:
            logger.info("BOOKING_DUPLICATE_SUPPRESSED", call_id=call_id, date=date, time=time)
            return self._booked_keys[dedup_key]
        # Cross-call duplicate guard: if this customer already has a BOOKED row
        # for the exact same slot + service, return that booking instead of
        # creating a second identical appointment (idempotent re-fire).
        try:
            existing_bid = await db.find_booked_appointment(phone, date, time, service)
        except Exception:
            existing_bid = None
        if existing_bid:
            logger.info("BOOKING_DUPLICATE_DB_SUPPRESSED", booking_id=existing_bid,
                        call_id=call_id, date=date, time=time)
            msg = (f"You're already booked for {service} on {date} at {time}. "
                   f"Booking ID: {existing_bid}.")
            self._booked_keys[dedup_key] = msg
            self._last_booking_id = existing_bid
            self._last_booking_time = f"{date}T{time}:00+05:30"
            self._last_booking_name = name
            self._last_booking_service = service
            self._cs_book(existing_bid, name, date, time, service)
            return msg
        # Slot-level guard, deliberately BEFORE any external call.
        #
        # find_booked_appointment above also matches on SERVICE, but the
        # database constraint (appointments_active_customer_slot_idx) is unique
        # on phone+date+time alone. A different service in the same slot
        # therefore slipped past the guard, reached Cal.com, created a SECOND
        # external booking, and only then failed locally — leaving a live
        # Cal.com booking that nothing tracked. Catching it here means the
        # duplicate external booking is never created in the first place.
        try:
            slot_row = await db.find_booked_slot(phone, date, time)
        except Exception:
            slot_row = None
        if slot_row:
            existing_bid = slot_row.get("booking_id")
            other = slot_row.get("service")
            logger.info("BOOKING_SLOT_ALREADY_TAKEN_BY_CUSTOMER",
                        booking_id=existing_bid, existing_service=other,
                        requested_service=service, call_id=call_id, date=date, time=time)
            if other and other != service:
                msg = (f"You already have a {other} booking on {date} at {time} "
                       f"(reference {existing_bid}). I can't put a second appointment "
                       f"in the same slot — would another time suit for the {service}?")
            else:
                msg = (f"You're already booked for {other or service} on {date} at "
                       f"{time}. Booking ID: {existing_bid}.")
            self._booked_keys[dedup_key] = msg
            self._last_booking_id = existing_bid
            self._last_booking_time = f"{date}T{time}:00+05:30"
            self._last_booking_name = name
            self._last_booking_service = other or service
            self._cs_book(str(existing_bid), name, date, time, other or service)
            return msg
        logger.info("CALENDAR_BOOKING_STARTED", date=date, time=time, call_id=call_id)
        try:
            calcom_uid: str | None = None
            if calcom_enabled():
                # 2. Re-check availability in BOTH systems right before booking.
                cal_free = await calcom_slot_free(date, time, call_id)
                if cal_free is None:
                    return ("I can't reach the calendar to confirm that booking right now. "
                            "Let's try again in a moment or pick another time.")
                if not cal_free:
                    return f"That slot ({date} at {time}) was just taken. Could you suggest another time?"
                if not await db.check_slot(date, time):
                    nxt = await db.get_next_available(date, time)
                    return f"That slot was just taken. The next available is {nxt}."
                # 3. Book Cal.com first — abort without a local write if it fails.
                res = await calcom_book(name, email, phone, date, time, service, "", call_id)
                if not res["success"]:
                    return ("I couldn't confirm that booking on our calendar. "
                            "Our team will follow up shortly to finalise it.")
                calcom_uid = res["uid"]

            # 4. Persist to the local DB + schedule the customer reminder
            #    atomically (with the Cal.com uid when present).
            reminder_at = reminder_at_utc(date, time)
            try:
                booking_id = await db.insert_appointment(
                    name, phone, date, time, service,
                    calcom_uid=calcom_uid, email=email or None, reminder_at=reminder_at,
                )
                logger.info("LOCAL_APPOINTMENT_SAVED", booking_id=booking_id,
                            calcom_uid=calcom_uid, call_id=call_id)
                if reminder_at is not None:
                    logger.info("REMINDER_SCHEDULED", booking_id=booking_id,
                                reminder_at=reminder_at.isoformat(), call_id=call_id)
            except Exception as exc:
                logger.error("LOCAL_BOOKING_SAVE_FAILED", error=str(exc),
                             calcom_uid=calcom_uid, call_id=call_id)

                # Do NOT assume the write was lost. The most common cause is the
                # slot-level unique index (appointments_active_customer_slot_idx,
                # unique on phone+date+time while BOOKED), which the pre-insert
                # guard cannot catch because that guard also matches on service.
                # Booking a DIFFERENT service in the same slot therefore reaches
                # the insert and fails — and the row it collided with is a real,
                # valid appointment. Ask the database what exists rather than
                # reporting a phantom sync failure.
                existing = None
                try:
                    existing = await db.find_booked_slot(phone, date, time)
                except Exception:
                    existing = None

                if existing:
                    existing_bid = existing.get("booking_id")
                    other = existing.get("service")
                    # DO NOT attach `calcom_uid` to this row. It is a booking we
                    # just created, for THIS request's service; the existing row
                    # is a different appointment that merely occupies the same
                    # slot. Linking them would make a later cancellation of the
                    # old appointment cancel the new external booking (or, if
                    # the row already had a uid, silently strand the new one).
                    # Record it instead so it is visible and reconcilable.
                    if calcom_uid:
                        logger.error("CALCOM_DUPLICATE_EXTERNAL_BOOKING",
                                     calcom_uid=calcom_uid, existing_booking_id=existing_bid,
                                     existing_service=other, requested_service=service,
                                     date=date, time=time, call_id=call_id)
                        try:
                            await db.record_calcom_orphan(
                                calcom_uid, phone, date, time, service, name,
                                f"slot already held locally by {existing_bid} "
                                f"(service={other}); external booking NOT attached",
                            )
                        except Exception:
                            logger.error("CALCOM_ORPHAN_RECORD_FAILED",
                                         calcom_uid=calcom_uid, call_id=call_id)
                    logger.info("BOOKING_ALREADY_PRESENT", booking_id=existing_bid,
                                date=date, time=time, call_id=call_id)
                    self._last_booking_id = existing_bid
                    self._last_booking_time = f"{date}T{time}:00+05:30"
                    self._last_booking_name = name
                    self._last_booking_service = other or service
                    self._cs_book(str(existing_bid), name, date, time, other or service)
                    if other and other != service:
                        return (f"You already have a {other} booking on {date} at {time} "
                                f"(reference {existing_bid}), so I couldn't add the "
                                f"{service} in the same slot. Shall we pick another time?")
                    return (f"You already have that slot on {date} at {time} — "
                            f"your booking reference is {existing_bid}.")

                if calcom_uid:
                    # A genuine split-brain: the Cal.com booking is real but our
                    # own record could not be written. Cal.com is the source of
                    # truth, so the booking is NOT cancelled and NOT re-created
                    # (a retry could double-book). Persist a recoverable record
                    # so reconciliation can finish the local write later.
                    logger.error("CALENDAR_SYNC_INCONSISTENT", calcom_uid=calcom_uid,
                                 date=date, time=time, phone=phone, call_id=call_id)
                    try:
                        await db.record_calcom_orphan(calcom_uid, phone, date, time,
                                                      service, name, str(exc))
                    except Exception:
                        # Defence in depth: the booking is real and already
                        # paid for by the caller's time. Losing the audit row
                        # must not lose the booking.
                        logger.error("CALCOM_ORPHAN_RECORD_FAILED",
                                     calcom_uid=calcom_uid, call_id=call_id)
                    self._last_booking_id = calcom_uid
                    self._last_booking_time = f"{date}T{time}:00+05:30"
                    self._last_booking_name = name
                    self._last_booking_service = service
                    # Deliberately does NOT claim our calendar is updated — it
                    # is not. It states only what is true: the slot is held with
                    # the provider, and our record is still being completed.
                    return (f"Your slot on {date} at {time} is held with our booking "
                            f"provider under reference {calcom_uid}. I could not finish "
                            f"writing it into our own system just now, so our team will "
                            f"confirm it shortly — your slot is not lost.")
                raise

            self._last_booking_id = booking_id
            self._last_booking_time = f"{date}T{time}:00+05:30"
            self._last_booking_name = name
            self._last_booking_service = service
            self._cs_book(str(booking_id), name, date, time, service)
            reminder_note = " We'll remind you before the appointment." if reminder_at else ""
            msg = (f"Confirmed! Booking ID: {booking_id}. "
                   f"See you on {date} at {time} for {service}.{reminder_note}")
            self._booked_keys[dedup_key] = msg
            return msg
        except Exception as exc:
            logger.error("book_appointment_failed", error=str(exc), call_id=call_id)
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

    # ── Human call forwarding ────────────────────────────────────────────────
    @staticmethod
    def _mask_phone(p: str) -> str:
        """Last 3 digits only. Every log line about a destination uses this."""
        d = "".join(c for c in (p or "") if c.isdigit())
        return f"***{d[-3:]}" if len(d) >= 3 else "***"

    def _resolve_transfer_target(self, category: str) -> tuple[dict | None, str]:
        """Pick the destination for a category. Returns (target, reason_if_none).

        The LLM supplies only a category name; the number comes from this
        assistant's stored configuration. An unknown or unconfigured category
        falls back to Other/General when that is configured, which is what the
        spec asks for — and when nothing is configured we say so rather than
        pretending a transfer is possible.
        """
        cat = (category or "").strip().lower()
        if cat not in db.HUMAN_TRANSFER_CATEGORIES:
            cat = "other"
        target = self.transfer_targets.get(cat)
        if target:
            return target, ""
        fallback = self.transfer_targets.get("other")
        if fallback:
            logger.info("transfer_category_fallback", requested=cat, used="other",
                        reason="no number configured for the requested category",
                        call_id=self._room_call_id(), source="TRANSFER")
            return fallback, ""
        return None, "no destination is configured"

    @llm.function_tool
    async def transfer_to_human(self, category: str, reason: str = "") -> str:
        """Hand the live call to a human team.

        `category` must be one of: software, marketing, content, other.
        Never pass a phone number — the correct number is configured per
        assistant and resolved here. Only call this once the category is known;
        if the caller has not said what it is about, ask them first.
        """
        cat = (category or "").strip().lower()
        logger.info("transfer_requested", requested_category=cat or "(none)",
                    reason=(reason or "")[:120], call_id=self._room_call_id(), source="TRANSFER")

        # No transfer loop: once a REFER has been accepted the call is leaving.
        if self._transfer_started:
            logger.info("transfer_already_started", call_id=self._room_call_id(), source="TRANSFER")
            return "A transfer is already in progress. Stay on the line."

        target, why = self._resolve_transfer_target(cat)
        if target is None:
            logger.warning("transfer_failed", stage="resolve", detail=why,
                           requested_category=cat, call_id=self._room_call_id(), source="TRANSFER")
            self._cs_tool("transfer", state="unavailable")
            return ("TRANSFER_UNAVAILABLE: no human destination is configured. Tell the "
                    "caller human support is unavailable right now and offer to help here.")

        logger.info("detected_category", category=target["category"],
                    destination_label=target["label"],
                    destination=self._mask_phone(target["phone"]),
                    call_id=self._room_call_id(), source="TRANSFER")

        destination = target["phone"]
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
            logger.warning("transfer_failed", stage="identity",
                           detail="could not identify the caller participant",
                           category=target["category"], call_id=self._room_call_id(), source="TRANSFER")
            return ("TRANSFER_FAILED: tell the caller you could not connect the team right "
                    "now and that you can still help here.")

        self._transfer_started = True
        logger.info("transfer_started", category=target["category"],
                    destination_label=target["label"],
                    destination=self._mask_phone(target["phone"]),
                    call_id=self._room_call_id(), source="TRANSFER")
        try:
            await self.ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=self.ctx.room.name,
                    participant_identity=identity,
                    transfer_to=destination,
                    play_dialtone=False,
                ),
            )
            logger.info("transfer_answered", category=target["category"],
                        destination_label=target["label"],
                        destination=self._mask_phone(target["phone"]),
                        call_id=self._room_call_id(), source="TRANSFER")
            self._cs_tool("transfer", state=f"connected:{target['category']}")
            self._closed_reason = f"transferred to {target['label']}"
            return (f"TRANSFER_OK: connected to {target['label']}. Say one short line that you "
                    f"are connecting them to the {target['label']} team, then stop talking.")
        except Exception as exc:
            # The REFER did not take, so the caller is still with us.
            self._transfer_started = False
            logger.error("transfer_failed", stage="refer", error=str(exc)[:200],
                         category=target["category"],
                         destination_label=target["label"],
                         destination=self._mask_phone(target["phone"]),
                         call_id=self._room_call_id(), source="TRANSFER")
            self._cs_tool("transfer", state="failed")
            return ("TRANSFER_FAILED: tell the caller you could not connect the team right "
                    "now and that you can still help here.")

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
            # Mirror into the per-call structured state (survives truncation);
            # generic acks are filtered inside add_fact.
            if self.call_state:
                try: self.call_state.add_fact(insight)
                except Exception: pass
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
        """Legacy: book Cal.com only (no local DB write). Prefer book_appointment,
        which books Cal.com AND the local DB as one synchronised operation. Kept
        for assistants explicitly configured to mirror an existing DB booking."""
        res = await calcom_book(name, email, self.phone_number or "", date, start_time,
                                "", notes, self._room_call_id())
        if not res["success"]:
            return f"Cal.com booking failed: {res['message']}"
        self._last_booking_id = res["uid"] or self._last_booking_id
        self._last_booking_time = res.get("start_iso") or self._last_booking_time
        self._last_booking_name = name
        self._last_booking_notes = notes
        return f"Cal.com booked. UID: {res['uid']}"

    @llm.function_tool
    async def cancel_calcom(self, booking_uid: str, reason: str = "") -> str:
        """Cancel a Cal.com booking by UID and sync the local DB. The local row
        is only marked CANCELLED after Cal.com confirms the cancellation."""
        call_id = self._room_call_id()
        res = await calcom_cancel(booking_uid, reason, call_id)
        if not res["success"]:
            return f"Cancellation failed: {res['message']}"
        try:
            await db.cancel_appointment_by_calcom_uid(booking_uid)
        except Exception as exc:
            logger.error("local_cancel_after_calcom_failed", error=str(exc),
                         uid=booking_uid, call_id=call_id)
        return f"Cancelled booking {booking_uid}."
