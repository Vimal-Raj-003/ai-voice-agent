"""FastAPI service: dispatch, scheduler, healthcheck, metrics, webhooks, log stream."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import random

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from livekit import api as lkapi
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sse_starlette.sse import EventSourceResponse

import db
import idempotency
import notify
from compliance import check_dispatch_allowed
from observability import get_logger, init_observability

load_dotenv()
init_observability()
logger = get_logger("server")

app = FastAPI(title="OutboundAI Voice Service", version="1.0.0")

# ── Rate limiting (Feature Pack 3 / Task 4) ──────────────────────────────────
# Per-IP, in-process — sufficient for single-tenant deployments. Move to Redis
# storage if/when we run multiple voice-service replicas.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Prometheus ────────────────────────────────────────────────────────────────
voice_calls_total       = Counter("voice_calls_total", "Total calls handled", ["outcome"])
voice_calls_active      = Gauge("voice_calls_active", "Currently active calls")
voice_call_duration     = Histogram("voice_call_duration_seconds", "Call duration",
                                    buckets=[10, 30, 60, 120, 300, 600, 1200])
voice_calls_booked      = Counter("voice_calls_booked_total", "Calls converted to bookings")
voice_dispatch_failures = Counter("voice_dispatch_failures_total", "Dispatch failures")


# ── Auth ──────────────────────────────────────────────────────────────────────
async def require_token(request: Request) -> None:
    """Two auth paths:
      1. Shared service token (dashboard ↔ voice-service via VOICE_SERVICE_TOKEN).
      2. Per-customer API key issued from the dashboard, hashed and stored in
         api_keys. Bearer must start with the "jjv_" prefix to take this path.
    """
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    presented = auth[7:]

    expected = os.environ.get("VOICE_SERVICE_TOKEN", "")
    # Constant-time compare: short-circuiting on the first byte difference would
    # leak token length / prefix to a timing attacker. Token is high-entropy in
    # practice so this is hygiene more than active threat-mitigation.
    if expected and hmac.compare_digest(presented, expected):
        return

    if presented.startswith("jjv_"):
        try:
            row = await db.verify_api_key(presented)
        except Exception:
            row = None
        if row:
            return

    raise HTTPException(401, "Invalid bearer token")


# ── Lifespan: open/close DB pool ──────────────────────────────────────────────
@app.on_event("startup")
async def _startup_db() -> None:
    await db.get_pool()
    logger.info("server_started")


@app.on_event("shutdown")
async def _shutdown_db() -> None:
    await db.close_pool()


# ── Public endpoints ──────────────────────────────────────────────────────────
@app.get("/health", response_model=None)
async def health() -> dict | JSONResponse:
    """Healthcheck for Coolify. Returns 200 only if DB pool is reachable."""
    try:
        pool = await db.get_pool()
        await pool.fetchval("SELECT 1")
        return {"status": "ok", "service": "voice-service"}
    except Exception as exc:
        return JSONResponse({"status": "degraded", "error": str(exc)}, status_code=503)


@app.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ── Settings inspection (admin) ───────────────────────────────────────────────
# Surface the merged env + DB-stored settings to the dashboard so the admin
# Settings page can show "configured via env" vs "stored in DB" vs "unset"
# per known key. Sensitive values are masked by db.get_all_settings().
@app.get("/api/settings", dependencies=[Depends(require_token)])
async def get_settings() -> dict:
    return await db.get_all_settings()


# ── Dispatch ──────────────────────────────────────────────────────────────────

def _lk_client() -> lkapi.LiveKitAPI:
    return lkapi.LiveKitAPI(
        url=os.environ["LIVEKIT_URL"],
        api_key=os.environ["LIVEKIT_API_KEY"],
        api_secret=os.environ["LIVEKIT_API_SECRET"],
    )


@app.post("/api/dispatch/single", dependencies=[Depends(require_token)])
@limiter.limit("100/minute")
async def dispatch_single(request: Request) -> dict:
    raw = await request.body()
    # Cache body bytes on request so idempotency.check's second read is a no-op
    request._body = raw  # noqa: SLF001  (Starlette internal cache)
    body = json.loads(raw or b"{}")
    phone = (body.get("phone") or "").strip()
    if not phone.startswith("+"):
        raise HTTPException(400, "Phone must start with + and country code")

    # ── Idempotency (Feature Pack 4 / Task 15) ────────────────────────────────
    org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
    key, cached = await idempotency.check(request, "dispatch.single", org_id)
    if cached:
        resp = JSONResponse(status_code=cached["status"], content=cached["body"])
        resp.headers["Idempotency-Replayed"] = "true"
        return resp

    # ── Compliance check (Feature Pack 4 / Task 8) ────────────────────────────
    compliance = await check_dispatch_allowed(org_id, phone, contact_tz=None)
    if not compliance.allowed:
        return JSONResponse(
            status_code=compliance.code,
            content={
                "error": compliance.reason,
                **(
                    {"next_allowed_at": compliance.next_allowed_at.isoformat()}
                    if compliance.next_allowed_at
                    else {}
                ),
            },
        )

    metadata = {
        "phone_number":     phone,
        "agent_profile_id": body.get("agent_profile_id"),
        "lead_name":        body.get("lead_name"),
        "business_name":    body.get("business_name"),
        "service_type":     body.get("service_type"),
        "campaign_id":      body.get("campaign_id"),
        "language_preset":  body.get("language_preset", "multilingual"),
    }

    room_name = f"call-{phone.replace('+', '')}-{random.randint(1000, 9999)}"
    lk = _lk_client()
    try:
        dispatch = await lk.agent_dispatch.create_dispatch(
            lkapi.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room_name,
                metadata=json.dumps(metadata),
            ),
        )
        logger.info("dispatched", phone=phone, room=room_name, dispatch_id=dispatch.id)
        result_body = {"status": "ok", "dispatch_id": dispatch.id, "room": room_name, "phone": phone}
        if key:
            await idempotency.record(request, "dispatch.single", org_id, key, 200, result_body)
        return result_body
    except Exception as exc:
        voice_dispatch_failures.inc()
        logger.error("dispatch_failed", error=str(exc), phone=phone)
        raise HTTPException(502, f"Dispatch failed: {exc}") from exc
    finally:
        await lk.aclose()


@app.post("/api/dispatch/bulk", dependencies=[Depends(require_token)])
@limiter.limit("100/minute")
async def dispatch_bulk(request: Request) -> dict:
    raw = await request.body()
    # Cache body bytes on request so idempotency.check's second read is a no-op
    request._body = raw  # noqa: SLF001  (Starlette internal cache)
    body = json.loads(raw or b"{}")
    contacts = body.get("contacts") or []
    delay = float(body.get("delay_seconds", 3))
    profile_id = body.get("agent_profile_id")
    campaign_id = body.get("campaign_id")
    if not contacts:
        raise HTTPException(400, "contacts required")

    # ── Idempotency (Feature Pack 4 / Task 15) ────────────────────────────────
    org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
    key, cached = await idempotency.check(request, "dispatch.bulk", org_id)
    if cached:
        resp = JSONResponse(status_code=cached["status"], content=cached["body"])
        resp.headers["Idempotency-Replayed"] = "true"
        return resp

    batch_id = f"BATCH_{random.randint(100000, 999999)}"
    results = []
    blocked = 0
    deferred = 0
    # ── Compliance org_id (Feature Pack 4 / Task 8) ───────────────────────────
    lk = _lk_client()
    try:
        for c in contacts:
            phone = (c.get("phone") or "").strip()
            if not phone.startswith("+"):
                results.append({"phone": phone, "status": "error", "message": "Must start with +"})
                continue

            # Compliance check before dispatch
            decision = await check_dispatch_allowed(org_id, phone, c.get("contact_tz"))
            if not decision.allowed:
                if decision.reason == "DND":
                    results.append({"phone": phone, "status": "blocked", "message": "On DND list"})
                    blocked += 1
                else:
                    naa = decision.next_allowed_at.isoformat() if decision.next_allowed_at else None
                    results.append({"phone": phone, "status": "deferred", "next_allowed_at": naa})
                    deferred += 1
                continue

            try:
                room = f"call-{phone.replace('+', '')}-{random.randint(1000, 9999)}"
                d = await lk.agent_dispatch.create_dispatch(
                    lkapi.CreateAgentDispatchRequest(
                        agent_name="voice-agent",
                        room=room,
                        metadata=json.dumps({
                            "phone_number": phone, "lead_name": c.get("lead_name"),
                            "agent_profile_id": profile_id, "campaign_id": campaign_id,
                            "business_name": c.get("business_name"), "service_type": c.get("service_type"),
                        }),
                    ),
                )
                results.append({"phone": phone, "status": "ok", "dispatch_id": d.id, "room": room})
                await asyncio.sleep(delay)
            except Exception as exc:
                voice_dispatch_failures.inc()
                results.append({"phone": phone, "status": "error", "message": str(exc)})
        result_body = {
            "batch_id": batch_id,
            "total": len(contacts),
            "results": results,
            "blocked": blocked,
            "deferred": deferred,
        }
        if key:
            await idempotency.record(request, "dispatch.bulk", org_id, key, 200, result_body)
        return result_body
    finally:
        await lk.aclose()


# ── Demo + internal ───────────────────────────────────────────────────────────

@app.post("/api/demo/token", dependencies=[Depends(require_token)])
async def demo_token() -> dict:
    """Mint a LiveKit JWT for browser-based demo + dispatch a demo agent into the room."""
    from livekit.api import AccessToken, VideoGrants
    api_key    = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]
    livekit_url = os.environ["LIVEKIT_URL"]
    room_name = f"demo-{random.randint(10000, 99999)}"
    token = (
        AccessToken(api_key, api_secret)
        .with_identity("demo-user")
        .with_name("Demo Caller")
        .with_grants(VideoGrants(room_join=True, room=room_name))
        .with_ttl(3600)
        .to_jwt()
    )
    lk = _lk_client()
    try:
        await lk.agent_dispatch.create_dispatch(
            lkapi.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room_name,
                metadata=json.dumps({"phone_number": "demo", "is_demo": True}),
            ),
        )
    finally:
        await lk.aclose()
    return {"token": token, "room": room_name, "url": livekit_url}


@app.post("/internal/record-call")
async def record_call_metric(request: Request) -> dict:
    """Called by agent.py at shutdown to update Prometheus counters."""
    data = await request.json()
    voice_calls_total.labels(outcome=(data.get("outcome") or "unknown").lower()).inc()
    if data.get("booked"):
        voice_calls_booked.inc()
    if data.get("duration"):
        voice_call_duration.observe(float(data["duration"]))
    return {"ok": True}


# ── Scheduler ─────────────────────────────────────────────────────────────────

_scheduler: AsyncIOScheduler | None = None
_bg_tasks: set[asyncio.Task] = set()


def _ist():
    return pytz.timezone("Asia/Kolkata")


async def _run_campaign_internal(campaign_id: str) -> None:
    pool = await db.get_pool()
    row = await pool.fetchrow(
        'SELECT id, status, "callDelaySeconds", "agentProfileId" FROM campaigns WHERE id = $1',
        campaign_id,
    )
    if not row or row["status"] not in ("RUNNING", "DRAFT"):
        return
    targets = await pool.fetch(
        """SELECT id, "phoneNumber", "leadName" FROM campaign_targets
            WHERE "campaignId" = $1 AND status = 'PENDING'::"CampaignTargetStatus" """,
        campaign_id,
    )
    delay = float(row["callDelaySeconds"] or 3)
    profile_id = row["agentProfileId"]
    dispatched = 0
    failed = 0
    blocked = 0
    deferred = 0
    # ── Compliance org_id (Feature Pack 4 / Task 8) ───────────────────────────
    campaign_org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
    lk = _lk_client()
    try:
        for t in targets:
            phone = (t["phoneNumber"] or "").strip()
            if not phone.startswith("+"):
                failed += 1
                continue

            # Compliance check: DND + quiet-hours before any SIP dispatch
            decision = await check_dispatch_allowed(campaign_org_id, phone, None)
            if not decision.allowed:
                if decision.reason == "DND":
                    await pool.execute(
                        """UPDATE campaign_targets
                              SET status = 'BLOCKED'::"CampaignTargetStatus",
                                  "lastError" = 'On DND list',
                                  "updatedAt" = now()
                            WHERE id = $1""",
                        t["id"],
                    )
                    blocked += 1
                else:
                    await pool.execute(
                        """UPDATE campaign_targets
                              SET status = 'DEFERRED'::"CampaignTargetStatus",
                                  "dispatchAfter" = $1,
                                  "updatedAt" = now()
                            WHERE id = $2""",
                        decision.next_allowed_at, t["id"],
                    )
                    deferred += 1
                continue

            try:
                room = f"call-{phone.replace('+', '')}-{random.randint(1000, 9999)}"
                d = await lk.agent_dispatch.create_dispatch(
                    lkapi.CreateAgentDispatchRequest(
                        agent_name="voice-agent",
                        room=room,
                        metadata=json.dumps({
                            "phone_number": phone, "lead_name": t["leadName"],
                            "agent_profile_id": profile_id, "campaign_id": campaign_id,
                        }),
                    ),
                )
                await pool.execute(
                    """UPDATE campaign_targets
                          SET status = 'DISPATCHED'::"CampaignTargetStatus",
                              "dispatchedAt" = now(),
                              "dispatchId" = $1,
                              "updatedAt" = now()
                        WHERE id = $2""",
                    d.id, t["id"],
                )
                dispatched += 1
                await asyncio.sleep(delay)
            except Exception as exc:
                logger.warning("campaign_target_failed", error=str(exc), phone=phone)
                await pool.execute(
                    """UPDATE campaign_targets
                          SET status = 'FAILED'::"CampaignTargetStatus",
                              "lastError" = $1,
                              "updatedAt" = now()
                        WHERE id = $2""",
                    str(exc), t["id"],
                )
                failed += 1
    finally:
        await lk.aclose()

    await pool.execute(
        """UPDATE campaigns
              SET "lastRunAt" = now(),
                  "dispatchedTargets" = "dispatchedTargets" + $1,
                  "failedTargets"     = "failedTargets" + $2,
                  status = CASE WHEN "scheduleType" = 'ONCE'::"ScheduleType"
                                THEN 'COMPLETED'::"CampaignStatus"
                                ELSE 'RUNNING'::"CampaignStatus"
                           END,
                  "updatedAt" = now()
            WHERE id = $3""",
        dispatched, failed, campaign_id,
    )
    if blocked or deferred:
        logger.info(
            "campaign_compliance_summary",
            campaign_id=campaign_id,
            blocked=blocked,
            deferred=deferred,
        )


async def _reload_scheduled_campaigns() -> None:
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.remove_all_jobs()
    pool = await db.get_pool()
    rows = await pool.fetch(
        """SELECT id, "scheduleType", "scheduleTime" FROM campaigns
            WHERE status = 'RUNNING'::"CampaignStatus"
              AND "scheduleType" IN ('DAILY'::"ScheduleType", 'WEEKDAYS'::"ScheduleType")""",
    )
    for r in rows:
        try:
            hh, mm = (r["scheduleTime"] or "09:00").split(":")
            day = "mon-fri" if r["scheduleType"] == "WEEKDAYS" else "*"
            _scheduler.add_job(
                _run_campaign_internal,
                CronTrigger(day_of_week=day, hour=int(hh), minute=int(mm), timezone=_ist()),
                args=[r["id"]],
                id=f"campaign-{r['id']}",
                replace_existing=True,
            )
        except Exception as exc:
            logger.warning("scheduler_load_failed", id=r["id"], error=str(exc))


async def _refresh_rates_safely() -> None:
    """Wrap provider_rates.refresh_llm_rates in a try/except so a transient
    OpenRouter outage can't crash the scheduler."""
    import provider_rates  # local import keeps the module out of the cold path
    try:
        result = await provider_rates.refresh_llm_rates()
        logger.info("provider_rates_refresh_done", **result)
    except Exception as exc:
        logger.error("provider_rates_refresh_failed", error=str(exc))


async def _prune_idempotency() -> None:
    """APScheduler job: delete idempotency_keys older than 24 hours (daily at 03:00 IST)."""
    try:
        n = await db.prune_idempotency_keys()
        logger.info("idempotency_pruned", deleted=n)
    except Exception as exc:
        logger.error("idempotency_prune_failed", error=str(exc))


async def _poll_webhook_retries() -> None:
    """APScheduler job: retry RETRY_SCHEDULED webhook deliveries (60s interval)."""
    try:
        rows = await db.fetch_pending_retries(limit=50)
    except Exception as exc:
        logger.warning("webhook_retry_fetch_failed", error=str(exc))
        return
    for r in rows:
        try:
            await notify.send_existing_delivery(
                r["id"], r["url"], r["secret"], r["event"], r["payload"]
            )
        except Exception as exc:
            logger.warning("webhook_retry_failed", id=r["id"], error=str(exc))
            await db.schedule_webhook_retry(r["id"], str(exc))


@app.on_event("startup")
async def _start_scheduler() -> None:
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone=_ist())
    _scheduler.start()
    await _reload_scheduled_campaigns()
    # 3-hourly LLM rate refresh from OpenRouter. Run once at startup so the
    # rates table is fresh from boot — then every 3 hours on the wall clock.
    # coalesce=True collapses missed runs into one (e.g. if the boot run is
    # still going when the cron fires, only one runs). max_instances=1
    # prevents two concurrent refreshes racing the same UPDATE.
    _scheduler.add_job(
        _refresh_rates_safely,
        CronTrigger(hour="*/3", minute=0, timezone=_ist()),
        id="provider-rates-refresh",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    # Webhook retry poller — runs every 60 s, picks up RETRY_SCHEDULED rows
    # whose nextAttemptAt has passed, and re-POSTs up to 50 per tick.
    # coalesce=True + max_instances=1 prevents concurrent runs from racing
    # the same delivery rows (the SQL also uses SKIP LOCKED as a safety net).
    _scheduler.add_job(
        _poll_webhook_retries,
        "interval",
        seconds=60,
        id="webhook_retry_poll",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    # Daily idempotency key prune — removes entries older than 24 hours.
    # Runs at 03:00 IST; coalesce+max_instances=1 prevents overlap.
    _scheduler.add_job(
        _prune_idempotency,
        CronTrigger(hour=3, minute=0, timezone=_ist()),
        id="idempotency_prune",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
    )
    # Retain the boot task in _bg_tasks so it isn't GC'd before completing
    # (Python 3.11+ otherwise drops the reference and may cancel mid-fetch).
    boot_task = asyncio.create_task(_refresh_rates_safely())
    _bg_tasks.add(boot_task)
    boot_task.add_done_callback(_bg_tasks.discard)


@app.on_event("shutdown")
async def _stop_scheduler() -> None:
    if _scheduler:
        _scheduler.shutdown()


@app.post("/api/campaigns/{campaign_id}/run-now", dependencies=[Depends(require_token)])
async def campaign_run_now(campaign_id: str) -> dict:
    task = asyncio.create_task(_run_campaign_internal(campaign_id))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return {"status": "started", "campaign_id": campaign_id}


@app.post("/api/campaigns/scheduler/reload", dependencies=[Depends(require_token)])
async def campaign_reload() -> dict:
    await _reload_scheduled_campaigns()
    return {"status": "reloaded"}


@app.get("/api/rates", dependencies=[Depends(require_token)])
async def list_rates() -> list[dict]:
    """Read all provider rates for the dashboard — costs are computed
    client-side as Call.usage × these rates."""
    import provider_rates
    return await provider_rates.get_all_rates()


@app.post("/api/rates/refresh", dependencies=[Depends(require_token)])
async def refresh_rates() -> dict:
    """Manual refresh — same OpenRouter fetch the cron runs every 3 hours."""
    import provider_rates
    return await provider_rates.refresh_llm_rates()


@app.get("/api/campaigns/scheduler/status", dependencies=[Depends(require_token)])
async def campaign_status() -> dict:
    if not _scheduler:
        return {"running": False, "jobs": []}
    return {
        "running": _scheduler.running,
        "jobs": [
            {"id": j.id, "next_run": j.next_run_time.isoformat() if j.next_run_time else None}
            for j in _scheduler.get_jobs()
        ],
    }


# ── SSE log stream ────────────────────────────────────────────────────────────

@app.get("/api/logs/stream", dependencies=[Depends(require_token)])
async def logs_stream(request: Request, level: str | None = None, source: str | None = None):
    async def event_gen():
        last_seen: str | None = None
        while True:
            if await request.is_disconnected():
                break
            try:
                rows = await db.get_logs(level=level, source=source, limit=20)
                rows.reverse()
                for r in rows:
                    ts = r.get("timestamp")
                    ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
                    if last_seen is not None and ts_iso <= last_seen:
                        continue
                    last_seen = ts_iso
                    yield {"event": "log", "data": json.dumps({
                        "id": r.get("id"), "source": r.get("source"),
                        "level": r.get("level"), "message": r.get("message"),
                        "detail": r.get("detail"), "timestamp": ts_iso,
                    })}
            except Exception as exc:
                yield {"event": "error", "data": str(exc)}
            await asyncio.sleep(2)
    return EventSourceResponse(event_gen())


# ── AI prompt generator ───────────────────────────────────────────────────────
# Generates a complete system prompt from a 1-3 sentence description so users
# don't have to write voice-AI prompts from scratch. We use the same OpenAI
# key the agent already uses; falls back to Groq if OPENAI_API_KEY is missing.
_PROMPT_GENERATOR_META = """You are an expert prompt engineer specialising in voice AI agents for telephony — sales, support, booking, surveys. Given a 1-3 sentence description of what an assistant should do, write a complete production-quality system prompt that includes:

1. Role + persona name + business context. Use placeholders {lead_name}, {business_name}, {service_type} where appropriate so the prompt is reusable across campaigns.
2. The primary goal of the call.
3. Step-by-step conversation flow as a numbered list (4-7 steps). Include explicit branches (e.g. "If wrong person, end_call('WRONG_NUMBER')").
4. Objection handling for the 2-3 most likely objections.
5. Style rules: short sentences, one question at a time, no monologuing, never invent information you don't have.
6. Tool usage rules if applicable: book_appointment, check_availability, transfer_to_human, send_sms_confirmation, end_call, lookup_contact, remember_details.

Output ONLY the system prompt body. No preamble, no markdown headings, no quotes around it. Plain text the agent will read verbatim."""


@app.post("/api/assistants/generate-prompt", dependencies=[Depends(require_token)])
async def generate_prompt(request: Request) -> dict:
    body = await request.json()
    description = (body.get("description") or "").strip()
    if not description:
        raise HTTPException(400, "description is required")
    if len(description) > 2000:
        raise HTTPException(400, "description too long (max 2000 chars)")

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            503,
            "Neither OPENAI_API_KEY nor GROQ_API_KEY is configured — the AI "
            "generator needs at least one.",
        )
    use_groq = not os.environ.get("OPENAI_API_KEY")

    try:
        import openai
        client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1" if use_groq else None,
        )
        model = "llama-3.3-70b-versatile" if use_groq else "gpt-4o-mini"
        resp = await client.chat.completions.create(
            model=model,
            max_tokens=1500,
            temperature=0.4,
            messages=[
                {"role": "system", "content": _PROMPT_GENERATOR_META},
                {"role": "user", "content": description},
            ],
        )
        prompt = (resp.choices[0].message.content or "").strip()
        # Strip any leading/trailing quotes the model occasionally adds.
        for q in ('"""', "'''", '"', "'"):
            if prompt.startswith(q) and prompt.endswith(q):
                prompt = prompt[len(q):-len(q)].strip()
                break
        return {"prompt": prompt, "model": model}
    except Exception as exc:
        logger.error("generate_prompt_failed", error=str(exc))
        raise HTTPException(500, f"prompt generation failed: {exc}") from exc


# ── LiveKit webhook receiver ──────────────────────────────────────────────────

def _verify_livekit_sig(body: bytes, signature: str) -> bool:
    secret = os.environ.get("LIVEKIT_WEBHOOK_SECRET", "")
    if not secret:
        return False
    mac = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(mac, signature)


@app.post("/api/webhook/livekit")
async def livekit_webhook(request: Request) -> dict:
    body = await request.body()
    sig = request.headers.get("X-Signature", "")
    if not _verify_livekit_sig(body, sig):
        raise HTTPException(401, "invalid signature")
    try:
        data = json.loads(body)
        evt = data.get("event")
        logger.info("livekit_webhook", event=evt)
        if evt == "egress_ended" and data.get("egressInfo", {}).get("status") == "EGRESS_COMPLETE":
            file_url = data.get("egressInfo", {}).get("file", {}).get("location") or ""
            room = data.get("egressInfo", {}).get("roomName", "")
            if room and file_url:
                pool = await db.get_pool()
                await pool.execute(
                    """UPDATE calls SET "recordingUrl" = $1, "updatedAt" = now()
                       WHERE "livekitRoomName" = $2""",
                    file_url, room,
                )
        return {"ok": True}
    except Exception as exc:
        logger.error("webhook_error", error=str(exc))
        raise HTTPException(500, str(exc)) from exc
