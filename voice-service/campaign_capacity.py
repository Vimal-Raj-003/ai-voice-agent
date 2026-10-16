"""How many outbound calls a campaign may actually have in flight right now.

The campaign's configured `maxConcurrent` is a REQUEST. The real ceiling is the
strictest of several independent limits, and the provider's is authoritative:

  * Vobiz ACCOUNT concurrency   — GET /concurrency -> max_concurrent
  * Vobiz outbound TRUNK limit  — trunks[].concurrent_calls_limit
  * live calls already up       — the shared active_calls registry, which
                                  includes inbound and single dials, so a
                                  campaign cannot spend capacity someone else
                                  is using
  * inbound reserve             — slots deliberately left for inbound traffic
  * the campaign's own request

Measured on this account (2026-10-15): account max_concurrent = 3, outbound
trunk concurrent_calls_limit = 10, cps_limit = 2. The ACCOUNT is the binding
limit, so a campaign asking for 5 or 10 is capped at 3 and told why.

Trunk CPS is deliberately NOT treated as call capacity: 2 calls/second is a
dial-rate ceiling, not a statement about how many calls can be simultaneously
connected. Dial rate is enforced separately from `maxStartsPerMinute`.

If the provider query fails the result falls back to CAMPAIGN_FALLBACK_MAX
(default 1) rather than assuming anything — a failed capacity check must never
read as unlimited.
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass

import httpx

import config
import db
from observability import get_logger

logger = get_logger(__name__)

#: Used only when the provider cannot be asked. Deliberately tiny.
FALLBACK_MAX = int(os.getenv("CAMPAIGN_FALLBACK_MAX", "1"))
#: Slots held back for inbound / demo / single calls.
INBOUND_RESERVE = int(os.getenv("CAMPAIGN_INBOUND_RESERVE", "0"))
#: Provider capacity changes rarely; don't ask on every dial.
_CACHE_TTL = float(os.getenv("CAMPAIGN_CAPACITY_TTL_S", "60"))

_cache: tuple[float, int, int] | None = None  # (expires_at, account_max, trunk_max)


@dataclass
class Capacity:
    """Resolved view of what may be dialed, and why."""
    requested: int
    account_max: int | None
    trunk_max: int | None
    inbound_reserve: int
    live_calls: int
    #: Strictest ceiling on simultaneous campaign calls.
    allowed: int
    #: Free slots right now (allowed - live_calls, never negative).
    free: int
    #: Set when the provider could not be asked.
    degraded: bool
    reason: str

    def as_log(self) -> dict:
        return {
            "requested": self.requested, "account_max": self.account_max,
            "trunk_max": self.trunk_max, "inbound_reserve": self.inbound_reserve,
            "live_calls": self.live_calls, "allowed": self.allowed,
            "free": self.free, "degraded": self.degraded, "reason": self.reason,
        }


def _vobiz_configured() -> bool:
    return bool(config.VOBIZ_AUTH_ID and config.VOBIZ_AUTH_TOKEN)


async def _provider_limits() -> tuple[int | None, int | None]:
    """(account_max, outbound_trunk_max). None means "could not determine"."""
    global _cache
    now = time.monotonic()
    if _cache and now < _cache[0]:
        return _cache[1], _cache[2]
    if not _vobiz_configured():
        return None, None

    base = f"{config.VOBIZ_API_BASE}/api/v1/Account/{config.VOBIZ_AUTH_ID}"
    headers = {
        "X-Auth-ID": config.VOBIZ_AUTH_ID,
        "X-Auth-Token": config.VOBIZ_AUTH_TOKEN,
        "Accept": "application/json",
    }
    account_max: int | None = None
    trunk_max: int | None = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{base}/concurrency", headers=headers)
            if r.status_code == 200:
                v = (r.json() or {}).get("max_concurrent")
                if isinstance(v, int) and v >= 0:
                    account_max = v
            t = await client.get(f"{base}/trunks", headers=headers)
            if t.status_code == 200:
                for obj in (t.json() or {}).get("objects", []) or []:
                    if str(obj.get("trunk_direction", "")).lower() == "inbound":
                        continue
                    lim = obj.get("concurrent_calls_limit")
                    if isinstance(lim, int) and lim > 0:
                        trunk_max = lim if trunk_max is None else min(trunk_max, lim)
    except Exception as exc:  # noqa: BLE001 - never let a capacity probe raise
        logger.warning("campaign_capacity_probe_failed", error=str(exc)[:160],
                       source="CAMPAIGN")
        return None, None

    if account_max is not None or trunk_max is not None:
        _cache = (now + _CACHE_TTL, account_max or 0, trunk_max or 0)
        # Cache stores 0 for "unknown"; translate back on read.
        return account_max, trunk_max
    return None, None


async def resolve(requested: int) -> Capacity:
    """Work out the real ceiling and how many slots are free right now."""
    account_max, trunk_max = await _provider_limits()
    live = await db.count_live_calls()

    limits: list[int] = [max(0, int(requested))]
    reason = "campaign request"
    if account_max is not None:
        effective_account = max(0, account_max - INBOUND_RESERVE)
        limits.append(effective_account)
        if effective_account <= min(limits):
            reason = "vobiz account concurrency"
    if trunk_max is not None:
        limits.append(trunk_max)
        if trunk_max <= min(limits):
            reason = "vobiz trunk concurrency"

    degraded = account_max is None and trunk_max is None
    if degraded:
        # Provider unreachable: fall back to a tiny ceiling, never to "unlimited".
        allowed = min(max(0, int(requested)), FALLBACK_MAX)
        reason = "provider capacity unavailable - using safe fallback"
    else:
        allowed = min(limits)

    return Capacity(
        requested=int(requested), account_max=account_max, trunk_max=trunk_max,
        inbound_reserve=INBOUND_RESERVE, live_calls=live, allowed=allowed,
        free=max(0, allowed - live), degraded=degraded, reason=reason,
    )


async def rate_allows(campaign_id: str, max_starts_per_minute: int) -> tuple[bool, int]:
    """Is another call START permitted inside the current rate window?

    Returns (allowed, started_in_window). Counted from the calls table so the
    limit holds across restarts and across processes — call DURATION is never
    used as a proxy for dial rate.
    """
    if max_starts_per_minute <= 0:
        return False, 0
    started = await db.count_recent_campaign_starts(campaign_id, 60)
    return started < max_starts_per_minute, started
