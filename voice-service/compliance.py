# voice-service/compliance.py
"""Compliance checks: DND list and quiet-hours enforcement.

Both checks run at dispatch time. The agent re-checks DND just before
SIP dial to close the race window between dispatch and call placement.

The organization columns ``quietHoursStart`` / ``quietHoursEnd`` store the
**allowed** call window (e.g. "09:00" / "21:00" means calls are permitted
between 09:00 and 21:00 in the org or contact timezone). Dispatches are
rejected when the current local time falls outside that window.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import db


@dataclass
class ComplianceResult:
    allowed: bool
    reason: str = ""
    code: int = 200
    next_allowed_at: datetime | None = None


def _parse_hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def _in_allowed_window(now_local: datetime, start: str, end: str) -> bool:
    """Return True if ``now_local``'s time falls within the allowed call window [start, end].

    Handles wrap-around (e.g., 21:00 -> 09:00 means "from 21:00 today
    through 09:00 tomorrow" is the allowed window).
    """
    s = _parse_hhmm(start)
    e = _parse_hhmm(end)
    t = now_local.time()
    if s <= e:
        return s <= t <= e
    return t >= s or t <= e


def _next_allowed(now_local: datetime, start: str, end: str) -> datetime:
    """Return the next datetime when the allowed window opens.

    Used when a dispatch is rejected because we are outside the allowed window;
    tells the scheduler when it may retry.
    """
    s = _parse_hhmm(start)
    today_start = now_local.replace(
        hour=s.hour, minute=s.minute, second=0, microsecond=0
    )
    if now_local <= today_start:
        return today_start
    e = _parse_hhmm(end)
    if s <= e:
        return today_start + timedelta(days=1)
    return today_start


async def check_dispatch_allowed(
    org_id: str, phone_e164: str, contact_tz: str | None
) -> ComplianceResult:
    if await db.is_on_dnd(org_id, phone_e164):
        return ComplianceResult(allowed=False, reason="DND", code=403)
    qh = await db.get_org_quiet_hours(org_id)
    if not qh:
        return ComplianceResult(allowed=True)
    tz_name = contact_tz or qh["tz"]
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("Asia/Kolkata")
    now_local = datetime.now(tz)
    in_allowed = _in_allowed_window(now_local, qh["start"], qh["end"])
    if in_allowed:
        return ComplianceResult(allowed=True)
    return ComplianceResult(
        allowed=False,
        reason="OUTSIDE_QUIET_HOURS",
        code=429,
        next_allowed_at=_next_allowed(now_local, qh["start"], qh["end"]),
    )
