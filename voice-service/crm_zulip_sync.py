"""Isolated, non-blocking Twenty CRM (https://20.jilljill.in) + Zulip (https://team.jilljill.in)
sync for completed calls, missed/failed calls, call recordings, and voice-booked appointments.

100% additive: never raises into the caller or blocks real-time voice execution.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
import json
import os
from pathlib import Path
import re
from typing import Any
from dotenv import load_dotenv
import pytz
import httpx

load_dotenv(Path(__file__).with_name(".env"), override=False)

from observability import get_logger

logger = get_logger("crm_zulip_sync")

IST = pytz.timezone("Asia/Kolkata")


def _ist_now() -> str:
    return datetime.now(IST).strftime("%d %b %Y, %I:%M:%S %p IST")


def _clean_phone10(phone: str | None) -> str:
    digits = re.sub(r"\D", "", str(phone or ""))
    return digits[-10:] if len(digits) >= 10 else digits


def _split_name(full_name: str | None) -> tuple[str, str]:
    parts = (full_name or "Caller").strip().split()
    if not parts:
        return "Caller", ""
    return parts[0], " ".join(parts[1:])


async def _send_zulip(topic: str, markdown: str) -> None:
    zulip_url = os.environ.get("ZULIP_URL", "https://team.jilljill.in").rstrip("/")
    bot_email = os.environ.get("ZULIP_BOT_EMAIL", "lead-alert-bot@team.jilljill.in").strip()
    bot_key = os.environ.get("ZULIP_BOT_API_KEY", "").strip()
    if not bot_key or not bot_email:
        return

    dm_ids = [
        int(x.strip())
        for x in os.environ.get("ZULIP_DIRECT_USER_IDS", "8,10,11").split(",")
        if x.strip().isdigit()
    ]
    stream_name = os.environ.get("ZULIP_STREAM", "WINs").strip()

    async with httpx.AsyncClient(timeout=5.0) as client:
        if dm_ids:
            try:
                await client.post(
                    f"{zulip_url}/api/v1/messages",
                    auth=(bot_email, bot_key),
                    data={"type": "direct", "to": json.dumps(dm_ids), "content": markdown},
                )
            except Exception as exc:
                logger.warning("zulip_dm_failed", error=str(exc)[:120])

        if stream_name:
            try:
                await client.post(
                    f"{zulip_url}/api/v1/messages",
                    auth=(bot_email, bot_key),
                    data={"type": "stream", "to": stream_name, "topic": topic, "content": markdown},
                )
            except Exception as exc:
                logger.warning("zulip_stream_failed", error=str(exc)[:120])


async def _twenty_req(
    client: httpx.AsyncClient,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    token = os.environ.get("TWENTY_API_TOKEN", "").strip()
    base = os.environ.get("TWENTY_CRM_URL", "https://20.jilljill.in").rstrip("/")
    if not token:
        return None
    try:
        resp = await client.request(
            method,
            f"{base}{path}",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
        if resp.status_code >= 400:
            return None
        return resp.json()
    except Exception:
        return None


async def _ensure_company(client: httpx.AsyncClient, business_name: str | None) -> str | None:
    clean = (business_name or "").strip()
    if not clean:
        return None
    data = await _twenty_req(client, "GET", "/rest/companies?limit=60")
    for comp in (data or {}).get("data", {}).get("companies", []) or []:
        if str(comp.get("name") or "").strip().lower() == clean.lower():
            return str(comp["id"])
    created = await _twenty_req(client, "POST", "/rest/companies", {"name": clean})
    d = (created or {}).get("data") or {}
    return (d.get("createCompany") or d.get("company") or {}).get("id")


async def _ensure_person(
    client: httpx.AsyncClient,
    full_name: str | None,
    phone: str | None,
    email: str | None = None,
    job_title: str | None = None,
    company_id: str | None = None,
) -> str | None:
    email_clean = (email or "").strip().lower()
    digits10 = _clean_phone10(phone)
    data = await _twenty_req(client, "GET", "/rest/people?limit=100")
    for p in (data or {}).get("data", {}).get("people", []) or []:
        p_email = str((p.get("emails") or {}).get("primaryEmail") or "").strip().lower()
        p_phone = _clean_phone10(str((p.get("phones") or {}).get("primaryPhoneNumber") or ""))
        if (email_clean and p_email == email_clean) or (digits10 and p_phone == digits10):
            return str(p["id"])

    first_name, last_name = _split_name(full_name)
    body: dict[str, Any] = {"name": {"firstName": first_name, "lastName": last_name}}
    if email_clean:
        body["emails"] = {"primaryEmail": email_clean}
    if digits10:
        body["phones"] = {
            "primaryPhoneNumber": digits10,
            "primaryPhoneCountryCode": "IN",
            "primaryPhoneCallingCode": "+91",
        }
    if job_title:
        body["jobTitle"] = job_title[:80]
    if company_id:
        body["companyId"] = company_id

    created = await _twenty_req(client, "POST", "/rest/people", body)
    d = (created or {}).get("data") or {}
    return (d.get("createPerson") or d.get("person") or {}).get("id")


async def _attach_note(
    client: httpx.AsyncClient,
    title: str,
    markdown: str,
    person_id: str | None = None,
    company_id: str | None = None,
) -> None:
    created = await _twenty_req(
        client,
        "POST",
        "/rest/notes",
        {"title": title[:140], "bodyV2": {"markdown": markdown}},
    )
    d = (created or {}).get("data") or {}
    note_id = (d.get("createNote") or d.get("note") or {}).get("id")
    if note_id and (person_id or company_id):
        target: dict[str, Any] = {"noteId": note_id}
        if person_id:
            target["targetPersonId"] = person_id
        if company_id:
            target["targetCompanyId"] = company_id
        await _twenty_req(client, "POST", "/rest/noteTargets", target)


async def _create_followup_task(
    client: httpx.AsyncClient,
    title: str,
    markdown: str,
    person_id: str | None = None,
    company_id: str | None = None,
) -> None:
    created = await _twenty_req(
        client,
        "POST",
        "/rest/tasks",
        {"title": title[:140], "bodyV2": {"markdown": markdown}, "status": "TODO"},
    )
    d = (created or {}).get("data") or {}
    task_id = (d.get("createTask") or d.get("task") or {}).get("id")
    if task_id and (person_id or company_id):
        target: dict[str, Any] = {"taskId": task_id}
        if person_id:
            target["targetPersonId"] = person_id
        if company_id:
            target["targetCompanyId"] = company_id
        await _twenty_req(client, "POST", "/rest/taskTargets", target)


async def sync_call_to_crm_and_zulip(
    *,
    call_id: str | None,
    room_name: str | None,
    call_kind: str,  # "DEMO" | "INBOUND" | "OUTBOUND"
    status: str,     # "COMPLETED" | "FAILED" | "NO_ANSWER" | "BUSY" | "MISSED"
    caller_name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
    business_name: str | None = None,
    assistant_name: str | None = None,
    duration_seconds: int | float | None = None,
    recording_ready: bool = False,
    summary_or_transcript: str | None = None,
    was_booked: bool = False,
) -> None:
    """Sync any completed OR missed/unattended call + recording link to Twenty CRM & Zulip."""
    try:
        norm_status = (status or "COMPLETED").upper()
        dur = int(duration_seconds or 0)
        is_missed_or_failed = norm_status in {"FAILED", "NO_ANSWER", "BUSY", "MISSED", "UNANSWERED", "CANCELLED"} or (
            norm_status != "COMPLETED" and dur == 0
        )

        # Look up DB Call ID by room_name if needed so the direct audio recording link works
        resolved_call_id = call_id
        if (not resolved_call_id or resolved_call_id == room_name) and room_name:
            try:
                import db
                pool = await db.get_pool()
                row = await pool.fetchrow(
                    'SELECT id, "recordingStatus" FROM calls WHERE "livekitRoomName" = $1 ORDER BY "createdAt" DESC LIMIT 1',
                    room_name,
                )
                if row:
                    resolved_call_id = str(row["id"])
                    if str(row["recordingStatus"] or "").upper() == "READY":
                        recording_ready = True
            except Exception:
                pass

        base_app = os.environ.get("NEXT_PUBLIC_BASE_URL", "https://voice.jilljill.in").rstrip("/")
        rec_stream_url = (
            f"{base_app}/api/calls/{resolved_call_id}/recording/stream"
            if resolved_call_id and recording_ready
            else f"{base_app}/contacts?section=calls"
        )
        calls_dash_url = f"{base_app}/contacts?section=calls"

        icon = "⚠️" if is_missed_or_failed else "📞"
        headline = (
            f"{icon} **Missed / Unattended {call_kind.title()} Call Alert!**"
            if is_missed_or_failed
            else f"{icon} **{call_kind.title()} Call Completed — Recording Saved!**"
        )
        snippet = (summary_or_transcript or "").strip()
        if len(snippet) > 500:
            snippet = snippet[:500] + "..."

        lines = [
            headline,
            f"- **Caller:** {caller_name or 'Visitor'}",
            f"- **Phone:** {phone or 'Browser Demo'}",
            f"- **Email:** {email}" if email else "",
            f"- **Business:** {business_name}" if business_name else "",
            f"- **Voice Agent:** {assistant_name or 'AI Specialist'}",
            f"- **Status:** `{norm_status}` | **Duration:** `{dur}s`",
            f"- **Appointment Booked:** {'Yes ✅' if was_booked else 'No'}",
            f"- **Audio Recording:** [Listen / Download Recording]({rec_stream_url})" if not is_missed_or_failed else f"- **Call Log:** [View in Dashboard]({calls_dash_url})",
            f"- **Time (IST):** {_ist_now()}",
            f"\n**Conversation Excerpt / Summary:**\n> {snippet}" if snippet else "",
        ]
        md = "\n".join(x for x in lines if x)

        async with httpx.AsyncClient(timeout=5.5) as client:
            company_id = await _ensure_company(client, business_name)
            person_id = await _ensure_person(
                client,
                full_name=caller_name or phone or "Demo Caller",
                phone=phone,
                email=email,
                job_title=f"{call_kind.title()} Caller",
                company_id=company_id,
            )
            note_title = (
                f"Missed/Failed {call_kind} Call ({assistant_name or 'Agent'})"
                if is_missed_or_failed
                else f"{call_kind} Call ({dur}s) — {assistant_name or 'Agent'}"
            )
            await _attach_note(client, note_title, md, person_id=person_id, company_id=company_id)

            if is_missed_or_failed:
                await _create_followup_task(
                    client,
                    f"Follow up missed/failed call: {caller_name or phone or 'Caller'}",
                    md,
                    person_id=person_id,
                    company_id=company_id,
                )

        topic = "JillJill Missed Calls" if is_missed_or_failed else "JillJill Call Recordings"
        await _send_zulip(topic, md)
    except Exception as exc:
        logger.warning("crm_call_sync_failed", error=str(exc)[:160])


async def sync_voice_booking_to_crm_and_zulip(
    *,
    booking_id: str,
    caller_name: str,
    phone: str,
    email: str | None,
    date: str,
    time_str: str,
    service: str,
    meeting_url: str | None = None,
) -> None:
    """Sync an appointment booked during a live voice call to Twenty CRM & Zulip."""
    try:
        lines = [
            "📅 **Appointment Booked via AI Voice Agent!**",
            f"- **Customer:** {caller_name}",
            f"- **Phone:** {phone}",
            f"- **Email:** {email}" if email else "",
            f"- **Service:** {service}",
            f"- **Date & Time:** {date} at {time_str} IST",
            f"- **Booking ID:** `{booking_id}`",
            f"- **Video Meeting Link:** {meeting_url}" if meeting_url else "",
            f"- **Booked At (IST):** {_ist_now()}",
        ]
        md = "\n".join(x for x in lines if x)

        async with httpx.AsyncClient(timeout=5.5) as client:
            person_id = await _ensure_person(
                client,
                full_name=caller_name,
                phone=phone,
                email=email,
                job_title=f"Booked: {service}",
            )
            await _twenty_req(
                client,
                "POST",
                "/rest/opportunities",
                {
                    "name": f"Voice Booking: {caller_name} ({service})",
                    "stage": "MEETING",
                    **({"pointOfContactId": person_id} if person_id else {}),
                },
            )
            await _attach_note(
                client,
                f"Voice Appointment Booked: {service} ({date} {time_str})",
                md,
                person_id=person_id,
            )

        await _send_zulip("JillJill Appointments", md)
    except Exception as exc:
        logger.warning("crm_booking_sync_failed", error=str(exc)[:160])


def fire_and_forget(coro) -> None:
    """Schedule an async CRM/Zulip sync safely without awaiting or leaking exceptions."""
    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(coro)
        task.add_done_callback(lambda t: t.exception() if not t.cancelled() else None)
    except Exception:
        pass
