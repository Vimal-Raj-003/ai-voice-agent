"""Cal.com + Google Calendar booking integration."""

from __future__ import annotations

import os
from datetime import datetime, timedelta

import httpx
import pytz
import requests

from observability import get_logger

logger = get_logger("calendar")
CAL_BASE = "https://api.cal.com/v1"


def _creds() -> dict:
    return {
        "api_key": os.environ.get("CALCOM_API_KEY", ""),
        "event_id": int(os.environ.get("CALCOM_EVENT_TYPE_ID", "0") or "0"),
    }


def get_available_slots(date_str: str) -> list[dict]:
    gcal_id = os.environ.get("GOOGLE_CALENDAR_ID", "")
    gcal_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
    if gcal_id and gcal_creds and os.path.exists(gcal_creds):
        try:
            return _slots_gcal(date_str, gcal_id, gcal_creds)
        except Exception as exc:
            logger.warning("gcal_fallback", error=str(exc))
    return _slots_calcom(date_str)


def _slots_calcom(date_str: str) -> list[dict]:
    c = _creds()
    if not c["api_key"]:
        return []
    try:
        resp = requests.get(
            f"{CAL_BASE}/slots",
            headers={"Content-Type": "application/json"},
            params={
                "apiKey": c["api_key"], "eventTypeId": c["event_id"],
                "startTime": f"{date_str}T00:00:00.000Z",
                "endTime":   f"{date_str}T23:59:59.000Z",
            },
            timeout=8,
        )
        resp.raise_for_status()
        raw = resp.json().get("data", {}).get("slots", {}).get(date_str, [])
        out: list[dict] = []
        for s in raw:
            dt = datetime.fromisoformat(s["time"])
            out.append({"time": s["time"], "label": dt.strftime("%I:%M %p")})
        return out
    except Exception as exc:
        logger.error("calcom_slots_failed", error=str(exc))
        return []


def _slots_gcal(date_str: str, calendar_id: str, creds_file: str) -> list[dict]:
    from googleapiclient.discovery import build
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(
        creds_file, scopes=["https://www.googleapis.com/auth/calendar.readonly"],
    )
    svc = build("calendar", "v3", credentials=creds)
    start = f"{date_str}T00:00:00+05:30"
    end   = f"{date_str}T23:59:59+05:30"
    busy = (
        svc.freebusy().query(body={"timeMin": start, "timeMax": end, "items": [{"id": calendar_id}]}).execute()
        .get("calendars", {}).get(calendar_id, {}).get("busy", [])
    )
    ist = pytz.timezone("Asia/Kolkata")
    day_start = ist.localize(datetime.strptime(f"{date_str} 10:00", "%Y-%m-%d %H:%M"))
    day_end   = ist.localize(datetime.strptime(f"{date_str} 19:00", "%Y-%m-%d %H:%M"))
    busy_ranges = [
        (datetime.fromisoformat(b["start"]).astimezone(ist),
         datetime.fromisoformat(b["end"]).astimezone(ist))
        for b in busy
    ]
    out: list[dict] = []
    slot = day_start
    while slot < day_end:
        is_busy = any(bs <= slot < be for bs, be in busy_ranges)
        if not is_busy:
            out.append({"time": slot.isoformat(), "label": slot.strftime("%I:%M %p")})
        slot += timedelta(minutes=30)
    return out


async def async_create_booking(start_time: str, caller_name: str, caller_phone: str, notes: str = "") -> dict:
    gcal_id = os.environ.get("GOOGLE_CALENDAR_ID", "")
    gcal_creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "")
    if gcal_id and gcal_creds and os.path.exists(gcal_creds):
        return await _gcal_book(start_time, caller_name, caller_phone, notes, gcal_id, gcal_creds)
    return await _calcom_book(start_time, caller_name, caller_phone, notes)


async def _calcom_book(start_time: str, name: str, phone: str, notes: str) -> dict:
    c = _creds()
    if not c["api_key"]:
        return {"success": False, "booking_id": None, "message": "Cal.com not configured"}
    payload = {
        "eventTypeId": c["event_id"], "start": start_time,
        "attendee": {
            "name": name,
            "email": f"{phone.replace('+','').replace(' ','')}@voiceagent.placeholder",
            "phoneNumber": phone, "timeZone": "Asia/Kolkata", "language": "en",
        },
        "bookingFieldsResponses": {"notes": notes or f"Booked via AI voice agent. Phone: {phone}"},
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.cal.com/v2/bookings",
                headers={
                    "Authorization": f"Bearer {c['api_key']}",
                    "cal-api-version": "2024-08-13", "Content-Type": "application/json",
                },
                json=payload,
            )
        if resp.status_code not in (200, 201):
            return {"success": False, "booking_id": None, "message": resp.text[:200]}
        uid = resp.json().get("data", {}).get("uid", "unknown")
        return {"success": True, "booking_id": uid, "message": "Booking confirmed"}
    except Exception as exc:
        return {"success": False, "booking_id": None, "message": str(exc)}


async def _gcal_book(start_time: str, name: str, phone: str, notes: str, calendar_id: str, creds_file: str) -> dict:
    try:
        from googleapiclient.discovery import build
        from google.oauth2 import service_account
        creds = service_account.Credentials.from_service_account_file(
            creds_file, scopes=["https://www.googleapis.com/auth/calendar"],
        )
        svc = build("calendar", "v3", credentials=creds)
        dt_start = datetime.fromisoformat(start_time)
        dt_end   = dt_start + timedelta(minutes=30)
        event = {
            "summary": f"Appointment — {name}",
            "description": f"Phone: {phone}\nNotes: {notes}",
            "start": {"dateTime": dt_start.isoformat(), "timeZone": "Asia/Kolkata"},
            "end":   {"dateTime": dt_end.isoformat(),   "timeZone": "Asia/Kolkata"},
        }
        created = svc.events().insert(calendarId=calendar_id, body=event).execute()
        return {"success": True, "booking_id": created.get("id"), "message": "GCal event created"}
    except Exception as exc:
        return {"success": False, "booking_id": None, "message": str(exc)}


def cancel_booking(booking_id: str, reason: str = "Cancelled by caller") -> dict:
    c = _creds()
    if not c["api_key"]:
        return {"success": False, "message": "Cal.com not configured"}
    try:
        resp = requests.delete(
            f"{CAL_BASE}/bookings/{booking_id}/cancel?apiKey={c['api_key']}",
            headers={"Content-Type": "application/json"},
            json={"reason": reason},
            timeout=8,
        )
        resp.raise_for_status()
        return {"success": True, "message": "Cancelled"}
    except Exception as exc:
        return {"success": False, "message": str(exc)}
