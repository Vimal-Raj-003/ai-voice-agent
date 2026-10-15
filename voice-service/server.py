"""FastAPI service: dispatch, scheduler, healthcheck, metrics, webhooks, log stream."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import random
from pathlib import Path
from datetime import datetime, timedelta

import pytz
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
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

# .env MUST be loaded BEFORE `import config`. config.py resolves every
# os.getenv(...) at IMPORT time, so loading afterwards leaves it frozen on the
# code defaults — which is why the API reported GROQ_MODEL=llama-3.3-70b-versatile
# while .env said qwen/qwen3.8-27b. Explicit path so it works from any cwd.
load_dotenv(Path(__file__).with_name(".env"))

import config  # noqa: E402
import db  # noqa: E402
import idempotency  # noqa: E402
import knowledge  # noqa: E402
import model_catalog  # noqa: E402
import notify  # noqa: E402
import provider_registry  # noqa: E402
from compliance import check_dispatch_allowed  # noqa: E402
from observability import (  # noqa: E402
    get_logger,
    init_observability,
    start_log_drain,
)

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
    # .strip() both sides: a CRLF .env sourced by bash appends "\r" to the token
    # in the server's env, while the dashboard (Node dotenv strips CRLF) sends the
    # clean token → hmac compare fails → 401 → Live Logs SSE falls back to DB-poll
    # only and the UI reads as DISCONNECTED. Stripping makes the compare robust to
    # stray whitespace/CR without weakening it (tokens never have edge whitespace).
    presented = auth[7:].strip()

    expected = os.environ.get("VOICE_SERVICE_TOKEN", "").strip()
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
    # Start the Live Logs drain on the FastAPI loop so server-side structlog
    # events reach the error_logs table / dashboard SSE stream.
    start_log_drain()
    logger.info("server_started", source="API")


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


# ── LLM model discovery ───────────────────────────────────────────────────────
# The model dropdown is populated from the PROVIDER'S OWN models endpoint, so a
# model the vendor adds or retires appears/disappears with no code change. The
# provider is named by the caller and never inferred from a model id.
@app.get("/api/llm/models", dependencies=[Depends(require_token)])
async def llm_models(provider: str, refresh: bool = False) -> dict:
    return await model_catalog.list_models(provider, force_refresh=refresh)


# ── Provider registry ─────────────────────────────────────────────────────────
# THE source of truth for STT/TTS providers. The dashboard renders its dropdowns
# and badges from this, so there is exactly one place a provider is declared.
@app.get("/api/providers/registry", dependencies=[Depends(require_token)])
async def providers_registry(capability: str | None = None,
                             byok: str | None = None) -> dict:
    """The provider registry, optionally resolved against one tenant's keys.

    `byok` is a comma-separated list of provider ids this organisation has
    stored their own credential for. Provider NAMES are not secrets and no
    credential is sent or returned; passing them lets the registry derive
    `status` / `canRunCalls` in ONE place rather than having the dashboard
    re-implement that logic over its own database.
    """
    tenant = {p.strip().lower() for p in (byok or "").split(",") if p.strip()}
    return {"providers": provider_registry.serialize(capability, tenant or None),
            "capabilities": ["STT", "TTS"]}


# ── Knowledge (URL Setup) ─────────────────────────────────────────────────────
# Per-assistant website knowledge. Every route is scoped by assistant_id so one
# assistant can never read, sync or delete another's sources.
@app.get("/api/knowledge/{assistant_id}/sources", dependencies=[Depends(require_token)])
async def knowledge_list(assistant_id: str) -> dict:
    return {"sources": await knowledge.list_sources(assistant_id)}


@app.post("/api/knowledge/{assistant_id}/sources", dependencies=[Depends(require_token)])
async def knowledge_add(assistant_id: str, request: Request) -> dict:
    body = json.loads(await request.body() or b"{}")
    res = await knowledge.add_source(assistant_id, body.get("url") or "")
    if not res.get("ok"):
        raise HTTPException(400, res.get("error") or "invalid url")
    # Crawling takes seconds to minutes; run it in the background and let the UI
    # poll the source status rather than holding the request open.
    asyncio.create_task(knowledge.sync_source(res["id"]))
    return res


@app.post("/api/knowledge/{assistant_id}/files", dependencies=[Depends(require_token)])
async def knowledge_upload(assistant_id: str, request: Request) -> dict:
    """Accept one or more files for THIS assistant and index them in background.

    Reads the multipart body rather than using UploadFile so no extra dependency
    is required; each file is validated (extension + content type + size) before
    anything is written to disk.
    """
    form = await request.form()
    uploads = form.getlist("files") or ([form["file"]] if "file" in form else [])
    if not uploads:
        raise HTTPException(400, "no files were uploaded")
    accepted, rejected = [], []
    for up in uploads:
        name = getattr(up, "filename", "") or ""
        mime = getattr(up, "content_type", "") or ""
        data = await up.read() if hasattr(up, "read") else b""
        res = await knowledge.add_file(assistant_id, name, mime, data)
        if res.get("ok"):
            accepted.append(res)
            asyncio.create_task(knowledge.sync_source(res["id"]))
        else:
            rejected.append({"fileName": name, "error": res.get("error")})
    if not accepted and rejected:
        raise HTTPException(400, rejected[0]["error"] or "upload rejected")
    return {"ok": True, "accepted": accepted, "rejected": rejected}


@app.post("/api/knowledge/{assistant_id}/sources/{source_id}/sync",
          dependencies=[Depends(require_token)])
async def knowledge_sync(assistant_id: str, source_id: str) -> dict:
    pool = await db.get_pool()
    owned = await pool.fetchval(
        "SELECT 1 FROM knowledge_sources WHERE id=$1 AND assistant_id=$2", source_id, assistant_id)
    if not owned:
        raise HTTPException(404, "source not found for this assistant")
    asyncio.create_task(knowledge.sync_source(source_id))
    return {"ok": True, "status": "CRAWLING"}


@app.delete("/api/knowledge/{assistant_id}/sources/{source_id}",
            dependencies=[Depends(require_token)])
async def knowledge_delete(assistant_id: str, source_id: str) -> dict:
    return await knowledge.delete_source(assistant_id, source_id)


_GROUNDED_ANSWER_RULES = (
    "You are previewing what a phone assistant would say. Answer the question "
    "USING ONLY the business information provided. Do not add anything that is "
    "not stated there, and do not use general knowledge. If the information "
    "does not cover the question, reply exactly: "
    "I don't have that confirmed. "
    "Answer in two or three short sentences, the way someone would say it out "
    "loud on a phone call. Do not mention documents, chunks, sources or that "
    "you were given any information."
)


async def _grounded_answer(question: str, hits: list[dict]) -> dict:
    """Draft an answer from retrieved chunks ONLY.

    Runs in the API process, never the worker, so it cannot touch a live call's
    event loop. Reuses the same key/client arrangement as /api/prompt/generate
    rather than introducing another LLM path, and reuses knowledge.build_context
    so the grounding block is byte-for-byte what a real call would receive.

    Any failure returns a reason instead of raising: the retrieved chunks are
    the important part of the preview and must still render.
    """
    if not hits:
        return {"answer": "", "status": "no_knowledge", "model": "", "note": ""}

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("GROQ_API_KEY")
    if not api_key:
        return {"answer": "", "status": "unavailable", "model": "",
                "note": ("No LLM key is configured (OPENAI_API_KEY or "
                         "GROQ_API_KEY), so the answer preview cannot be drafted. "
                         "The retrieved knowledge below is still exactly what a "
                         "call would use.")}
    use_groq = not os.environ.get("OPENAI_API_KEY")
    try:
        import openai
        client = openai.AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.groq.com/openai/v1" if use_groq else None,
        )
        # Use the model this deployment is actually configured for. A
        # hardcoded literal here 404s on an account that does not carry it,
        # which is exactly what happened with llama-3.3-70b-versatile.
        model = config.GROQ_MODEL if use_groq else config.DEFAULT_LLM_MODEL
        resp = await asyncio.wait_for(
            client.chat.completions.create(
                model=model, max_tokens=320, temperature=0.2,
                messages=[
                    {"role": "system", "content": _GROUNDED_ANSWER_RULES},
                    {"role": "user", "content": knowledge.build_context(hits)},
                    {"role": "user", "content": question},
                ],
            ),
            timeout=20.0,
        )
        return {"answer": (resp.choices[0].message.content or "").strip(),
                "status": "ok", "model": model, "note": ""}
    except TimeoutError:
        return {"answer": "", "status": "failed", "model": "",
                "note": "The answer preview timed out after 20s."}
    except Exception as exc:  # noqa: BLE001 - the chunks below still render
        logger.warning("knowledge_answer_preview_failed", error=str(exc)[:200],
                       source="KNOWLEDGE")
        return {"answer": "", "status": "failed", "model": "",
                "note": f"The answer preview could not be generated: {str(exc)[:160]}"}


@app.post("/api/knowledge/{assistant_id}/search", dependencies=[Depends(require_token)])
async def knowledge_search(assistant_id: str, request: Request) -> dict:
    body = json.loads(await request.body() or b"{}")
    query = (body.get("query") or "").strip()
    hits = await knowledge.search(assistant_id, query,
                                  int(body.get("top_k") or 4))
    # The same figures the retrieval used, so the preview can explain WHY a
    # chunk was or was not returned instead of just showing a number.
    #
    # retrievalAvailable matters: search() swallows embedding failures and
    # returns [] so a live call degrades gracefully. Without this flag an
    # operator could not tell "nothing matched your question" from "this
    # process cannot embed anything", and the preview would quietly lie.
    emb = knowledge.embedder_status()
    out = {"hits": hits, "minSimilarity": knowledge.MIN_SIMILARITY,
           "embeddingModel": knowledge.EMBED_MODEL,
           "embeddingDimensions": knowledge.EMBED_DIM,
           "retrievalAvailable": emb["available"],
           "retrievalNote": emb["note"]}
    # The grounded answer is opt-in so the plain retrieval endpoint stays cheap
    # for anything else that calls it.
    if body.get("answer"):
        out["answerPreview"] = await _grounded_answer(query, hits)
    return out


# ── Knowledge inspection (READ-ONLY) ─────────────────────────────────────────
# "View Indexed Data": shows exactly what was extracted and stored. Every route
# is scoped by assistant_id AND source_id, so a source id belonging to another
# assistant returns 404 rather than its content.

@app.get("/api/knowledge/{assistant_id}/sources/{source_id}",
         dependencies=[Depends(require_token)])
async def knowledge_source_detail(assistant_id: str, source_id: str) -> dict:
    out = await knowledge.source_detail(assistant_id, source_id)
    if out is None:
        raise HTTPException(404, "source not found for this assistant")
    return out


@app.get("/api/knowledge/{assistant_id}/sources/{source_id}/pages",
         dependencies=[Depends(require_token)])
async def knowledge_source_pages(assistant_id: str, source_id: str) -> dict:
    out = await knowledge.source_pages(assistant_id, source_id)
    if out is None:
        raise HTTPException(404, "source not found for this assistant")
    return out


@app.get("/api/knowledge/{assistant_id}/sources/{source_id}/chunks",
         dependencies=[Depends(require_token)])
async def knowledge_source_chunks(assistant_id: str, source_id: str,
                                  offset: int = 0, limit: int = 20,
                                  q: str = "") -> dict:
    out = await knowledge.source_chunks(assistant_id, source_id,
                                        offset=offset, limit=limit, q=q)
    if out is None:
        raise HTTPException(404, "source not found for this assistant")
    return out


@app.get("/api/knowledge/{assistant_id}/sources/{source_id}/chunks/{chunk_id}/vector",
         dependencies=[Depends(require_token)])
async def knowledge_chunk_vector(assistant_id: str, source_id: str,
                                 chunk_id: str) -> dict:
    out = await knowledge.chunk_vector(assistant_id, source_id, chunk_id)
    if out is None:
        raise HTTPException(404, "no embedding for that chunk")
    return out


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
    logger.info("demo_token_requested", source="API")
    api_key    = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]
    livekit_url = os.environ["LIVEKIT_URL"]
    room_name = f"demo-{random.randint(10000, 99999)}"
    token = (
        AccessToken(api_key, api_secret)
        .with_identity("demo-user")
        .with_name("Demo Caller")
        .with_grants(VideoGrants(room_join=True, room=room_name))
        .with_ttl(timedelta(hours=1))  # SDK requires a timedelta, not an int
        .to_jwt()
    )
    logger.info("demo_token_created", room=room_name, source="API")
    lk = _lk_client()
    try:
        await lk.agent_dispatch.create_dispatch(
            lkapi.CreateAgentDispatchRequest(
                agent_name="voice-agent",
                room=room_name,
                metadata=json.dumps({"phone_number": "demo", "is_demo": True}),
            ),
        )
        logger.info("agent_dispatch_created", room=room_name, agent="voice-agent", source="LIVEKIT")
    finally:
        await lk.aclose()
    return {"token": token, "room": room_name, "url": livekit_url}


@app.post("/api/calls/monitor-token", dependencies=[Depends(require_token)])
async def monitor_token(request: Request) -> dict:
    """Mint a READ-ONLY LiveKit JWT so the dashboard can join an EXISTING call
    room as a passive listener — to show live call state (SIP participant status)
    and the mic/agent audio monitor. Does NOT dispatch an agent or publish audio;
    purely subscribes. Used by the Calls-page phone dialer."""
    body = await request.json()
    room = (body.get("room") or "").strip()
    if not room:
        raise HTTPException(400, "room is required")
    from livekit.api import AccessToken, VideoGrants
    token = (
        AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(f"monitor-{random.randint(10000, 99999)}")
        .with_name("Dashboard Monitor")
        .with_grants(VideoGrants(
            room_join=True, room=room, can_subscribe=True, can_publish=False,
        ))
        .with_ttl(timedelta(hours=2))
        .to_jwt()
    )
    return {"token": token, "room": room, "url": os.environ["LIVEKIT_URL"]}


@app.post("/api/calls/end", dependencies=[Depends(require_token)])
async def end_call_room(request: Request) -> dict:
    """End an in-progress outbound call by deleting its LiveKit room (drops the
    SIP leg + agent). The agent's existing shutdown hook still persists the call
    record. Used by the Calls-page 'End call' button."""
    body = await request.json()
    room = (body.get("room") or "").strip()
    if not room:
        raise HTTPException(400, "room is required")
    lk = _lk_client()
    try:
        await lk.room.delete_room(lkapi.DeleteRoomRequest(room=room))
        logger.info("call_ended_by_dashboard", room=room, source="API")
    finally:
        await lk.aclose()
    return {"ok": True, "room": room}


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


# Campaign scheduler jobs are namespaced with this prefix so they can be
# managed without touching global system jobs (reminder poller, webhook retry,
# rate refresh, idempotency prune).
CAMPAIGN_JOB_PREFIX = "campaign-"


async def _reload_scheduled_campaigns() -> None:
    global _scheduler
    if _scheduler is None:
        return
    # Remove ONLY campaign jobs — never remove_all_jobs(), which would also drop
    # the global system jobs (appointment_reminder_poll, webhook_retry_poll,
    # provider-rates-refresh, idempotency_prune) and delay reminders until the
    # next restart. Re-adding only RUNNING campaigns below also drops jobs for
    # campaigns that are no longer RUNNING / were deleted.
    for job in _scheduler.get_jobs():
        if job.id.startswith(CAMPAIGN_JOB_PREFIX):
            _scheduler.remove_job(job.id)
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
                id=f"{CAMPAIGN_JOB_PREFIX}{r['id']}",
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


async def _poll_reminders() -> None:
    """APScheduler job (60s): send due customer appointment reminders.

    Reminders live in the DB (appointment_reminders), so they survive restarts.
    Each PENDING row whose time has arrived and whose appointment is still BOOKED
    is sent to the customer over WhatsApp, then marked SENT; failures increment
    retry_count and only become FAILED after the retry ceiling. Selecting only
    PENDING + marking SENT on success means a reminder is sent at most once."""
    if not config.APPOINTMENT_REMINDER_ENABLED:
        return
    try:
        rows = await db.due_reminders(limit=50)
    except Exception as exc:
        logger.warning("reminder_fetch_failed", error=str(exc))
        return
    for r in rows:
        rid = r["reminder_id"]
        try:
            try:
                dt = datetime.strptime(f"{r['date']} {r['time']}", "%Y-%m-%d %H:%M")
                readable = dt.strftime("%A, %d %B %Y at %I:%M %p IST")
            except ValueError:
                readable = f"{r['date']} at {r['time']}"
            sent = await asyncio.to_thread(
                notify.notify_appointment_reminder,
                r["customer_phone"], r.get("name") or "", config.BUSINESS_NAME, readable,
            )
            if sent:
                await db.mark_reminder_sent(rid)
                logger.info("CUSTOMER_REMINDER_SENT", reminder_id=rid, channel=r["channel"])
            else:
                await db.mark_reminder_failed(rid, "provider rejected or not configured",
                                              config.APPOINTMENT_REMINDER_MAX_RETRIES)
                logger.warning("CUSTOMER_REMINDER_FAILED", reminder_id=rid)
        except Exception as exc:
            try:
                await db.mark_reminder_failed(rid, str(exc), config.APPOINTMENT_REMINDER_MAX_RETRIES)
            except Exception:
                pass
            logger.warning("CUSTOMER_REMINDER_FAILED", reminder_id=rid, error=str(exc))


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
    # Customer appointment-reminder poller — runs every 60 s, sends due PENDING
    # reminders over WhatsApp. DB-backed so it survives restarts. coalesce +
    # max_instances=1 keeps a reminder from being sent twice by overlapping runs.
    if config.APPOINTMENT_REMINDER_ENABLED:
        _scheduler.add_job(
            _poll_reminders,
            "interval",
            seconds=60,
            id="appointment_reminder_poll",
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


# ── Self-hosted call recordings ───────────────────────────────────────────────
# The worker and this API run in the SAME container (supervisord), so recordings
# written to RECORDINGS_DIR are readable here. The dashboard lives in a separate
# container and therefore PROXIES these endpoints — the files are never exposed
# publicly and every request is bearer-protected (dashboard session-gates first).
def _recording_file(key: str):
    import recorder
    return recorder.resolve_recording_path(key)


@app.get("/api/recordings/{key:path}", dependencies=[Depends(require_token)])
async def get_recording(key: str, request: Request):
    """Stream a recording with HTTP Range support (needed for seeking)."""
    path = _recording_file(key)
    if not path:
        raise HTTPException(404, "recording not found")
    size = os.path.getsize(path)
    rng = request.headers.get("range") or request.headers.get("Range")
    start, end = 0, size - 1
    status = 200
    if rng and rng.startswith("bytes="):
        try:
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else 0
            end = int(b) if b else size - 1
            start = max(0, min(start, size - 1))
            end = max(start, min(end, size - 1))
            status = 206
        except Exception:
            start, end, status = 0, size - 1, 200
    length = end - start + 1

    def _iter():
        with open(path, "rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(64 * 1024, left))
                if not chunk:
                    break
                left -= len(chunk)
                yield chunk

    headers = {
        "Content-Length": str(length),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
    }
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(_iter(), status_code=status, media_type="audio/wav", headers=headers)


@app.delete("/api/recordings/{key:path}", dependencies=[Depends(require_token)])
async def delete_recording(key: str):
    """Delete ONE recording file from disk. The caller (dashboard) updates the DB."""
    path = _recording_file(key)
    if not path:
        return {"deleted": False, "reason": "not found"}
    try:
        os.remove(path)
        logger.info("recording_deleted", object_key=key, source="RECORDING")
        return {"deleted": True}
    except Exception as exc:
        logger.warning("recording_delete_failed", object_key=key, error=str(exc)[:200],
                       source="RECORDING")
        raise HTTPException(500, "delete failed") from exc


# ── Provider diagnostics ──────────────────────────────────────────────────────
# Card-click in the Providers dashboard runs ONE real, safe, side-effect-free
# probe against the provider (free list/health endpoint) and returns the full
# request→response→result. Events also flow to Live Logs via the structlog bridge
# (traffic_type="diagnostic"). Chargeable/external actions are NOT done here.
@app.post("/api/diagnostics/{provider}", dependencies=[Depends(require_token)])
async def run_provider_diagnostic(provider: str, request: Request):
    import diagnostics
    action = "safe"
    try:
        body = await request.json()
        if isinstance(body, dict) and body.get("action"):
            action = str(body["action"])
    except Exception:
        pass
    result = await diagnostics.run_diagnostic(provider, action)
    return result


@app.get("/api/diagnostics", dependencies=[Depends(require_token)])
async def list_diagnostics():
    import diagnostics
    return {"supported": diagnostics.SUPPORTED}


# ── SSE log stream ────────────────────────────────────────────────────────────

@app.get("/api/logs/stream", dependencies=[Depends(require_token)])
async def logs_stream(request: Request, level: str | None = None,
                      source: str | None = None, since: str | None = None):
    # `since` (ISO timestamp) = server-side live-session cursor: the stream starts
    # from NOW and never replays rows at/before it, so a fresh Live Logs session
    # does not get flooded with historical events (req 14). Omitted → the old
    # behaviour (seed from the latest existing row so only genuinely-new rows flow).
    async def event_gen():
        last_seen: str | None = (since.strip() if since else None)
        seeded = last_seen is not None
        hb_ticks = 0
        # Immediate heartbeat so the client gets `open` + first bytes right away
        # (confirms CONNECTED fast and lets the proxy flush headers without delay).
        yield {"event": "heartbeat", "data": json.dumps(
            {"ts": datetime.utcnow().isoformat(), "hello": True})}
        while True:
            if await request.is_disconnected():
                break
            try:
                rows = await db.get_logs(level=level, source=source, limit=20)
                rows.reverse()
                # Without an explicit `since`, seed the cursor from the newest
                # existing row on the FIRST tick so we don't replay history.
                if not seeded:
                    seeded = True
                    if rows:
                        newest = rows[-1].get("timestamp")
                        last_seen = newest.isoformat() if hasattr(newest, "isoformat") else str(newest)
                sent = 0
                for r in rows:
                    ts = r.get("timestamp")
                    ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else str(ts)
                    if last_seen is not None and ts_iso <= last_seen:
                        continue
                    last_seen = ts_iso
                    sent += 1
                    yield {"event": "log", "data": json.dumps({
                        "id": r.get("id"), "source": r.get("source"),
                        "level": r.get("level"), "message": r.get("message"),
                        "detail": r.get("detail"), "timestamp": ts_iso,
                    })}
                # Heartbeat every ~12s (6 ticks × 2s) of quiet so the dashboard can
                # show CONNECTED + "last event age" and detect a stalled socket.
                hb_ticks = 0 if sent else hb_ticks + 1
                if hb_ticks >= 6:
                    hb_ticks = 0
                    yield {"event": "heartbeat", "data": json.dumps(
                        {"ts": datetime.utcnow().isoformat()})}
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

        info = data.get("egressInfo", {}) or {}
        status = info.get("status", "")
        room = info.get("roomName", "") or info.get("room_name", "")
        egress_id = info.get("egressId", "") or info.get("egress_id", "")

        # Pull the file result (newer LiveKit → fileResults[], older → file).
        results = info.get("fileResults") or info.get("file_results") or []
        file_res = (results[0] if results else None) or info.get("file") or {}
        file_url = file_res.get("location") or ""
        object_key = file_res.get("filename") or file_res.get("filepath") or ""

        # Duration (seconds): prefer the file's own duration (ns), else
        # endedAt-startedAt (unix ns). Both are strings/ints in the webhook.
        def _ns(v: object) -> int:
            try:
                return int(v)  # type: ignore[arg-type]
            except Exception:
                return 0
        dur_ns = _ns(file_res.get("duration"))
        if not dur_ns:
            dur_ns = max(0, _ns(info.get("endedAt") or info.get("ended_at")) - _ns(info.get("startedAt") or info.get("started_at")))
        duration_seconds = round(dur_ns / 1_000_000_000) if dur_ns else None

        if evt == "egress_ended" and room:
            if status == "EGRESS_COMPLETE":
                # Do NOT overwrite recordingObjectKey here — the deterministic key
                # set at egress start is authoritative. Only fall back to the
                # webhook's filename if the start-time persistence was missed.
                await db.set_recording_status(
                    room, status="READY", egress_id=egress_id or None,
                    object_key=None, duration_seconds=duration_seconds,
                    url=file_url or None,
                )
                if object_key:
                    # Best-effort fallback: fill the key only when it is still null.
                    try:
                        pool = await db.get_pool()
                        await pool.execute(
                            'UPDATE calls SET "recordingObjectKey" = $1 WHERE "livekitRoomName" = $2 AND "recordingObjectKey" IS NULL',
                            object_key, room,
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("recording_key_backfill_failed", error=str(exc))
                logger.info("recording_ready", room=room, call_id=room, egress_id=egress_id,
                            object_key=object_key, duration_seconds=duration_seconds, source="LIVEKIT")
            else:
                # EGRESS_FAILED / EGRESS_ABORTED / EGRESS_LIMIT_REACHED …
                reason = (info.get("error") or status or "egress ended without a completed file")
                await db.set_recording_status(room, status="FAILED", egress_id=egress_id or None, error=str(reason)[:500])
                logger.error("recording_failed", room=room, call_id=room, egress_id=egress_id,
                             stage="egress", error=str(reason)[:500], source="LIVEKIT")
        elif evt == "egress_updated" and room and status in ("EGRESS_ENDING",):
            await db.set_recording_status(room, status="PROCESSING", egress_id=egress_id or None)
            logger.info("recording_processing", room=room, call_id=room, egress_id=egress_id, source="LIVEKIT")
        return {"ok": True}
    except Exception as exc:
        logger.error("webhook_error", error=str(exc))
        raise HTTPException(500, str(exc)) from exc
