"""Vobiz REST API client + post-call recording resolution.

Vobiz records the PSTN leg itself (real carrier audio, stereo, 8 kHz), which is
cleaner than the locally mixed WAV. After a call completes we locate that
recording and point the dashboard at it; the local recorder stays as FALLBACK.

Why this lives in voice-service and not the dashboard
-----------------------------------------------------
The Auth ID / Auth Token are configured here (VOBIZ_AUTH_ID / VOBIZ_AUTH_TOKEN),
and Vobiz's `recording_url` is NOT a public link — fetching it needs those
headers. Keeping both the lookup and the audio proxy in this process means the
dashboard never holds a Vobiz credential, and the browser certainly never does.
The dashboard proxies audio through /api/recordings/vobiz/{call_id} exactly the
way it already proxies local recordings.

Endpoints used — these are the ones the LIVE API actually serves (probed
2026-10-15 against account MA_I0S5YYVA):

    GET {base}/api/v1/Account/{auth_id}/Recording/          → list (limit/offset)
    GET {base}/api/v1/Account/{auth_id}/Recording/{id}/     → one recording

IMPORTANT — the published OpenAPI spec disagrees with the live API
---------------------------------------------------------------
https://vobiz.ai/openapi.json documents `GET /api/v1/Account/{auth_id}/cdr`
with a `sip_call_id` query filter, which would have given a clean
SIP-Call-ID → call_uuid mapping. **That endpoint returns 404 on the live API**
(every casing/prefix variant was tried; /auth/me and /Recording/ on the same
credentials return 200, so this is not an auth problem). Neither the Recording
object nor the live Call object carries a `sip_call_id` field either.

So the only possible deterministic link is whether the trunk provider's SIP
Call-ID (LiveKit's `sip.callIDFull`, stored in calls."sipCallId") equals or
contains Vobiz's own `call_uuid` / `recording_id`. match_recording() tests
exactly that.

Deliberately NOT implemented: a phone-number + timestamp fallback. It was
measured against 10 real recordings and is unsafe here — the gap between a
recording's `add_time` and the matching call ranged from 6s to 45 minutes, and
three different recordings mapped onto the same call. Guessing would attach the
wrong audio to a call, so when there is no deterministic match this module
records PENDING/FAILED and logs the candidates instead of picking one.

Other spec facts that shape the code:
  * The Recording LIST endpoint accepts ONLY limit/offset — no call_uuid filter
    — so a lookup means bounded paging plus a client-side match.
  * The live list caps at 20 rows per page regardless of a larger `limit`.
  * There is NO download endpoint, so audio comes from `recording_url`.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

import config
import db
from observability import get_logger

logger = get_logger(__name__)

# Bounded paging over the unfilterable Recording list. A recording for a call
# that just ended sits at the top; walking an account's entire history would be
# a denial of service against ourselves. The live API caps a page at 20 rows
# however large `limit` is, so asking for more silently returns 20.
_PAGE_SIZE = 20
_MAX_PAGES = 5
_TIMEOUT = httpx.Timeout(15.0, connect=8.0)


def configured() -> bool:
    """True when the account API credentials are present."""
    return bool(config.VOBIZ_AUTH_ID and config.VOBIZ_AUTH_TOKEN)


def _headers() -> dict[str, str]:
    """Auth headers. Never logged — see _safe_err before putting text in a log."""
    return {
        "X-Auth-ID": config.VOBIZ_AUTH_ID,
        "X-Auth-Token": config.VOBIZ_AUTH_TOKEN,
        "Accept": "application/json",
    }


def _safe_err(exc: object) -> str:
    """Error text with any credential value scrubbed out."""
    msg = str(exc)
    for secret in (config.VOBIZ_AUTH_TOKEN, config.VOBIZ_AUTH_ID):
        if secret:
            msg = msg.replace(secret, "[redacted]")
    return msg[:300]


def _account_path(suffix: str) -> str:
    return f"{config.VOBIZ_API_BASE}/api/v1/Account/{config.VOBIZ_AUTH_ID}{suffix}"


async def _get_json(client: httpx.AsyncClient, url: str, params: dict | None = None) -> Any:
    resp = await client.get(url, params=params, headers=_headers())
    if resp.status_code != 200:
        # Status only: a provider error body can echo request context.
        raise RuntimeError(f"vobiz HTTP {resp.status_code} for {url.split('?')[0]}")
    return resp.json()


def sip_id_variants(sip_call_id: str) -> set[str]:
    """Candidate forms of a SIP Call-ID to compare against a Vobiz call_uuid.

    A Call-ID header is often "<token>@<host>", so we compare the whole value
    and the user-part. Comparison is case-sensitive: these ids are base62, so
    case carries meaning.
    """
    raw = (sip_call_id or "").strip()
    if not raw:
        return set()
    out = {raw}
    if "@" in raw:
        out.add(raw.split("@", 1)[0].strip())
    return {v for v in out if v}


def match_recording(recs: list[dict], sip_call_id: str) -> dict | None:
    """Find the recording belonging to this SIP Call-ID, or None.

    Deterministic only: a recording is accepted when its `call_uuid` or
    `recording_id` equals one of the Call-ID forms, or when a Call-ID form
    contains that id (covering a "<call_uuid>@host" style header). Nothing else
    matches - see the module docstring for why number/time guessing is refused.
    """
    variants = sip_id_variants(sip_call_id)
    if not variants:
        return None
    for rec in recs:
        ids = {str(rec.get("call_uuid") or ""), str(rec.get("recording_id") or "")}
        ids.discard("")
        if ids & variants:
            return rec
        for ident in ids:
            if len(ident) >= 12 and any(ident in v for v in variants):
                return rec
    return None


async def list_recent_recordings(max_pages: int = _MAX_PAGES) -> list[dict]:
    """Newest-first recordings, bounded paging (the list cannot be filtered)."""
    out: list[dict] = []
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for page in range(max_pages):
            body = await _get_json(
                client, _account_path("/Recording/"),
                {"limit": _PAGE_SIZE, "offset": page * _PAGE_SIZE},
            )
            rows = []
            if isinstance(body, dict):
                rows = body.get("objects") or body.get("data") or []
            if not isinstance(rows, list) or not rows:
                break
            out.extend(r for r in rows if isinstance(r, dict))
            if len(rows) < _PAGE_SIZE:
                break
    return out


async def get_recording(recording_id: str) -> dict | None:
    """Retrieve the authoritative record for one recording id."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        body = await _get_json(
            client, _account_path(f"/Recording/{recording_id}/"),
        )
    return body if isinstance(body, dict) else None


def recording_seconds(rec: dict) -> int | None:
    """Duration in whole seconds, preferring the precise millisecond field."""
    try:
        ms = float(rec.get("recording_duration_ms") or 0)
        if ms > 0:
            return int(round(ms / 1000.0))
    except (TypeError, ValueError):
        pass
    rounded = rec.get("rounded_recording_duration")
    if isinstance(rounded, (int, float)) and rounded > 0:
        return int(rounded)
    return None


async def resolve_for_call(call_id: str, sip_call_id: str,
                           provider_call_id: str | None = None) -> tuple[str, str]:
    """One resolution attempt for a finished call.

    Returns (status, detail) where status is:
        READY      - recording found and stored
        PENDING    - not available yet, or no deterministic match; may retry
        SKIPPED    - cannot be attempted (no credentials / no join key)

    Never raises: a provider outage must not disturb anything else, and the
    local recording stays usable throughout.
    """
    if not configured():
        return "SKIPPED", "vobiz api credentials not configured"
    if not sip_call_id and not provider_call_id:
        # No join key. Refusing is deliberate: matching on number+timestamp was
        # measured to mis-associate recordings (see the module docstring).
        return "SKIPPED", "no sipCallId captured - cannot match deterministically"

    try:
        recs = await list_recent_recordings()
        if not recs:
            return "PENDING", "no recordings listed yet"

        rec = None
        how = ""
        # Already know the provider's call id (from an earlier attempt).
        if provider_call_id:
            rec = next((r for r in recs
                        if str(r.get("call_uuid")) == provider_call_id
                        or str(r.get("recording_id")) == provider_call_id), None)
            how = "providerCallId"
        if rec is None and sip_call_id:
            rec = match_recording(recs, sip_call_id)
            how = "sipCallId==call_uuid"

        if rec is None:
            # Log the evidence needed to tell whether these id spaces relate at
            # all, instead of silently falling back to a guess.
            logger.info(
                "vobiz_no_deterministic_match", call_id=call_id,
                sip_call_id=sip_call_id,
                sip_variants=sorted(sip_id_variants(sip_call_id)),
                candidate_call_uuids=[str(r.get("call_uuid")) for r in recs[:5]],
                recordings_scanned=len(recs), source="VOBIZ")
            return "PENDING", "no recording matches this SIP Call-ID"

        # Re-read the authoritative record, then store it.
        rec_id = str(rec.get("recording_id") or "")
        full = await get_recording(rec_id) or rec
        url = full.get("recording_url")
        if not url:
            return "PENDING", "recording has no url yet"

        call_uuid = str(full.get("call_uuid") or rec_id)
        await db.set_vobiz_recording(
            call_id,
            provider_call_id=call_uuid,
            provider_recording_id=rec_id,
            provider_recording_url=str(url),
            provider_recording_status="READY",
            recording_source="VOBIZ",
            duration_seconds=recording_seconds(full),
        )
        logger.info("vobiz_recording_ready", call_id=call_id, recording_id=rec_id,
                    call_uuid=call_uuid, matched_by=how,
                    duration_s=recording_seconds(full),
                    fmt=str(full.get("recording_format")),
                    rec_type=str(full.get("recording_type")), source="VOBIZ")
        return "READY", rec_id
    except Exception as exc:  # noqa: BLE001 - never propagate to the caller
        logger.warning("vobiz_resolve_failed", call_id=call_id,
                       error=_safe_err(exc), source="VOBIZ")
        return "PENDING", _safe_err(exc)


async def open_audio_stream(recording_url: str, range_header: str | None):
    """Open a streaming GET for the recording audio, passing Range through.

    Returns (client, response); the caller must close both. Kept as a context-free
    pair so FastAPI can stream the body without buffering the whole file.
    """
    headers = {
        "X-Auth-ID": config.VOBIZ_AUTH_ID,
        "X-Auth-Token": config.VOBIZ_AUTH_TOKEN,
    }
    if range_header:
        headers["Range"] = range_header
    client = httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True)
    req = client.build_request("GET", recording_url, headers=headers)
    resp = await client.send(req, stream=True)
    return client, resp


# ── Post-call polling ────────────────────────────────────────────────────────
# Webhook-free synchronisation for local development: there is no public HTTPS
# domain yet, so Vobiz cannot call us back. Instead each completed call gets ONE
# bounded retry chain, started only AFTER the call has ended.
#
# This runs in the API process (uvicorn), never in the worker and never in the
# live voice event loop — the LiveKit job process is torn down when the call
# ends, so a 95-second chain could not survive there anyway.
#
# Delays are cumulative-bounded and terminal: the chain stops on READY, and
# after the last delay it gives up (PROCESSING inside the window, FAILED past
# it). There is no unbounded polling and no rescheduling after exhaustion.
RETRY_DELAYS = (5, 10, 20, 30, 30)  # seconds; ~95s total

# call_ids with a chain already running or finished in this process, so the
# sweeper starts exactly one chain per call.
_chains: set[str] = set()


async def poll_until_ready(call_id: str, sip_call_id: str,
                           provider_call_id: str | None = None) -> None:
    """Run the bounded retry chain for one finished call."""
    try:
        for attempt, delay in enumerate(RETRY_DELAYS, start=1):
            await asyncio.sleep(delay)
            status, detail = await resolve_for_call(call_id, sip_call_id, provider_call_id)
            logger.info("vobiz_poll_attempt", call_id=call_id, attempt=attempt,
                        of=len(RETRY_DELAYS), waited_s=delay, status=status,
                        detail=detail[:120], source="VOBIZ")
            if status == "READY":
                return
            if status == "SKIPPED":
                return  # misconfigured or unmatchable — retrying cannot help
        # Exhausted. Mark it so the UI stops saying "processing" forever; the
        # local recording (if any) continues to serve as the fallback.
        await db.set_vobiz_recording(call_id, provider_recording_status="FAILED")
        logger.warning("vobiz_poll_exhausted", call_id=call_id,
                       attempts=len(RETRY_DELAYS), source="VOBIZ")
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("vobiz_poll_chain_failed", call_id=call_id,
                       error=_safe_err(exc), source="VOBIZ")
    finally:
        _chains.discard(call_id)


async def sweep_completed_calls() -> int:
    """Start a retry chain for each newly-completed Vobiz call. Returns count.

    Called on a short scheduler tick. The tick itself does one indexed query;
    the actual waiting happens inside each call's own chain, so this is not a
    polling loop per call.
    """
    if not configured():
        return 0
    try:
        rows = await db.get_calls_awaiting_vobiz_recording()
    except Exception as exc:  # noqa: BLE001
        logger.warning("vobiz_sweep_query_failed", error=_safe_err(exc), source="VOBIZ")
        return 0

    started = 0
    for row in rows:
        call_id = row["id"]
        if call_id in _chains:
            continue
        _chains.add(call_id)
        logger.info("vobiz_poll_started", call_id=call_id,
                    sip_call_id=row.get("sipCallId"), source="VOBIZ")
        task = asyncio.create_task(
            poll_until_ready(call_id, row["sipCallId"], row.get("providerCallId"))
        )
        _TASKS.add(task)
        task.add_done_callback(_TASKS.discard)
        started += 1
    return started


# Strong refs so chains are not garbage-collected mid-flight.
_TASKS: set[asyncio.Task] = set()
