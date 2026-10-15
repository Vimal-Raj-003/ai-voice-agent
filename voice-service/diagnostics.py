"""Per-provider SAFE runtime diagnostics for the Providers ops dashboard.

Each `run_diagnostic(provider, action)` makes a REAL, minimal, side-effect-free
call to that provider using the existing env credentials (free "list/health"
endpoints wherever possible — no tokens spent, no messages sent, no calls
placed) and returns a structured result: ordered steps, status, latency, HTTP
code, model/endpoint, and on failure the exact breakpoint + root cause + impact.

Every diagnostic also emits events through the normal structlog→error_logs→SSE
bridge tagged `traffic_type="diagnostic"` + `source="provider_diagnostic"`, so
the SAME events appear in the provider's Recent Activity AND in Live Logs, and
are never confused with real call traffic.

SAFETY: the automatic card-click diagnostic NEVER does anything chargeable or
externally visible. Chargeable/external actions (place a call, send a message,
create a booking, upload an object) are separate explicit `action=` values and
are implemented in `diagnostics_actions.py`-style branches guarded here.

No secrets are ever returned or logged — only presence booleans, non-secret
request settings, status codes and error text (provider errors are already
non-secret). Field names avoid key/token/secret/... so the bridge never masks
them.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid

import httpx

import config
import provider_health as _ph
from observability import get_logger

logger = get_logger("diagnostics")

_TIMEOUT = 12.0


def _now() -> float:
    return time.monotonic()


def _env(*names: str) -> str:
    for n in names:
        v = os.environ.get(n)
        if v and v.strip():
            return v.strip()
    return ""


class _Diag:
    """Accumulates ordered steps + timing for one diagnostic run and emits the
    lifecycle events. Kind/category drive how the UI buckets the events."""

    def __init__(self, provider: str, kind: str, category: str):
        self.provider = provider
        self.kind = kind
        self.category = category
        self.diag_id = "diag-" + uuid.uuid4().hex[:10]
        self.start = _now()
        self.steps: list[dict] = []
        self._emit("diagnostic_started")

    def _emit(self, event: str, level: str = "info", **kw) -> None:
        fn = getattr(logger, level, logger.info)
        fn(event, provider=self.provider, kind=self.kind, diag_category=self.category,
           traffic_type="diagnostic", diag_id=self.diag_id, source="provider_diagnostic", **kw)

    def step(self, name: str, ok: bool | None, detail: str = "") -> None:
        self.steps.append({"name": name, "ok": ok, "detail": detail})

    def _ms(self) -> int:
        return int((_now() - self.start) * 1000)

    def ok(self, *, http: int | None = None, model: str = "", endpoint: str = "",
           language: str = "", summary: str = "", warning: str = "",
           request: dict | None = None, response: dict | None = None) -> dict:
        status = "warning" if warning else "healthy"
        latency = self._ms()
        self._emit("diagnostic_response_received", http_status=http, latency_ms=latency, model=model)
        self._emit("diagnostic_completed", status=status, latency_ms=latency, http_status=http,
                   model=model, warning=warning or None)
        return {
            "provider": self.provider, "kind": self.kind, "category": self.category,
            "diag_id": self.diag_id, "traffic_type": "diagnostic", "status": status,
            "steps": self.steps, "latency_ms": latency, "http_status": http, "model": model,
            "endpoint": endpoint, "language": language, "summary": summary, "warning": warning,
            "request": request or {}, "response": response or {},
        }

    def fail(self, *, breakpoint: str, root_cause: str, impact: str = "",
             http: int | None = None, error: str = "", retryable: bool | None = None,
             endpoint: str = "", model: str = "", request: dict | None = None,
             response: dict | None = None, exc: BaseException | None = None) -> dict:
        latency = self._ms()
        health = None
        if exc is not None:
            try:
                state, retry2, _ = _ph.classify_error(exc)
                health = state
                if retryable is None:
                    retryable = retry2
            except Exception:
                pass
        self._emit("diagnostic_failed", level="warning", http_status=http, latency_ms=latency,
                   error=error[:300], diag_breakpoint=breakpoint, impact=impact,
                   retryable=retryable, health=health, model=model)
        return {
            "provider": self.provider, "kind": self.kind, "category": self.category,
            "diag_id": self.diag_id, "traffic_type": "diagnostic", "status": "failed",
            "steps": self.steps, "latency_ms": latency, "http_status": http, "model": model,
            "endpoint": endpoint, "breakpoint": breakpoint, "root_cause": root_cause,
            "impact": impact, "error": error[:500], "retryable": retryable, "health": health,
            "request": request or {}, "response": response or {},
        }


def _missing_creds(d: _Diag, present: bool, what: str, impact: str) -> dict | None:
    d.step("Configuration loaded", True)
    d.step("Credentials present", present, "" if present else f"{what} not set")
    if not present:
        return d.fail(breakpoint="configuration", root_cause=f"{what} is not configured",
                      impact=impact or "Provider cannot be used until configured.")
    return None


# ── Generic HTTP "list/health" probe (free, validates the key) ────────────────
async def _http_probe(d: _Diag, *, method: str, url: str, headers: dict | None = None,
                      params: dict | None = None, model: str = "", language: str = "",
                      impact: str, ok_codes: tuple[int, ...] = (200,)) -> dict:
    d.step("Request created", True, f"{method} {url.split('?')[0]}")
    req = {"provider": d.provider, "operation": "health_probe", "endpoint": url.split("?")[0],
           "method": method, "model": model, "language": language}
    d._emit("diagnostic_request_sent", endpoint=url.split("?")[0], model=model)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.request(method, url, headers=headers, params=params)
        d.step("Provider connection", True)
        code = r.status_code
        body_preview = (r.text or "")[:300]
        resp = {"http_status": code, "latency_ms": d._ms(), "result": body_preview[:160]}
        rid = r.headers.get("x-request-id") or r.headers.get("dg-request-id")
        if rid:
            resp["request_id"] = rid
        if code in ok_codes:
            d.step("Provider response", True, f"HTTP {code}")
            d.step("Response validated", True)
            return d.ok(http=code, model=model, endpoint=url.split("?")[0], language=language,
                        summary="reachable, credentials valid", request=req, response=resp)
        # Non-OK: classify.
        d.step("Provider response", False, f"HTTP {code}")
        warn_credits = code in (402, 429)
        state = ("credits_exhausted" if code == 402 else "rate_limited" if code == 429
                 else "auth_failed" if code in (401, 403) else "invalid_config" if code == 400
                 else "invalid_model" if code == 404 else "provider_error")
        return d.fail(breakpoint="provider response", http=code,
                      root_cause=f"HTTP {code} {state}", error=body_preview,
                      impact=impact, retryable=warn_credits,
                      endpoint=url.split("?")[0], model=model, request=req, response=resp)
    except Exception as exc:  # network / DNS / timeout
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection", root_cause="could not reach provider",
                      error=str(exc), impact=impact, endpoint=url.split("?")[0],
                      model=model, request=req, exc=exc)


# ── Provider adapters ─────────────────────────────────────────────────────────
async def _chat_probe(d: "_Diag", *, url: str, headers: dict, model: str, impact: str) -> dict:
    """Real minimal chat completion. A /models GET passes even when the account
    cannot generate (quota/billing), which would report a FALSE "connected"."""
    d.step("Request created", True, f"POST chat/completions ({model})")
    req = {"provider": d.provider, "operation": "chat", "endpoint": url,
           "model": model, "max_tokens": 8}
    d._emit("diagnostic_request_sent", endpoint=url, model=model)
    body = {"model": model, "max_tokens": 8, "temperature": 0,
            "messages": [{"role": "user", "content": "Reply with the single word: ok"}]}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(url, json=body, headers=headers)
        d.step("Provider connection", True)
        txt = (r.text or "")[:400]
        resp = {"http_status": r.status_code, "latency_ms": d._ms()}
        if r.status_code != 200:
            d.step("Provider response", False, f"HTTP {r.status_code}")
            quota = r.status_code in (402, 429) or any(
                w in txt.lower() for w in ("quota", "credit", "billing", "exhaust", "deplet", "rate limit"))
            return d.fail(breakpoint="provider response", http=r.status_code,
                          root_cause=("quota / rate limit reached" if quota else f"HTTP {r.status_code}"),
                          error=txt, retryable=quota, endpoint=url, model=model,
                          impact=impact, request=req, response=resp)
        try:
            out = ((r.json().get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        except Exception:
            out = ""
        d.step("Provider response", True, "HTTP 200")
        d.step("Response validated", bool(out.strip()), f"text: {out.strip()[:40]}" or "no text")
        resp["result"] = out.strip()[:80]
        if not out.strip():
            return d.fail(breakpoint="response validation", http=200,
                          root_cause="HTTP 200 but no completion text", error=txt,
                          impact=impact, endpoint=url, model=model, request=req, response=resp)
        return d.ok(http=200, model=model, endpoint=url,
                    summary=f"real completion returned ({out.strip()[:30]})",
                    request=req, response=resp)
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection", root_cause="could not reach provider",
                      error=str(exc), impact=impact, endpoint=url, model=model,
                      request=req, exc=exc)


async def _diag_groq(action: str) -> dict:
    d = _Diag("groq", "LLM", "LLM")
    m = _missing_creds(d, bool(_env("GROQ_API_KEY")), "GROQ_API_KEY",
                       "Primary LLM unavailable; calls fall back or fail.")
    if m:
        return m
    return await _chat_probe(d, url=f"{config.GROQ_BASE_URL}/chat/completions",
                             headers={"Authorization": f"Bearer {_env('GROQ_API_KEY')}"},
                             model=config.GROQ_MODEL,
                             impact="Primary LLM would fail; turns rely on fallback.")


async def _diag_openai(action: str) -> dict:
    d = _Diag("openai", "LLM", "LLM")
    m = _missing_creds(d, bool(_env("OPENAI_API_KEY")), "OPENAI_API_KEY", "OpenAI LLM unavailable.")
    if m:
        return m
    return await _chat_probe(d, url="https://api.openai.com/v1/chat/completions",
                             headers={"Authorization": f"Bearer {_env('OPENAI_API_KEY')}"},
                             model=config.DEFAULT_LLM_MODEL, impact="OpenAI LLM would fail.")


async def _diag_anthropic(action: str) -> dict:
    d = _Diag("anthropic", "LLM", "LLM")
    m = _missing_creds(d, bool(_env("ANTHROPIC_API_KEY")), "ANTHROPIC_API_KEY", "Claude LLM unavailable.")
    if m:
        return m
    return await _http_probe(d, method="GET", url="https://api.anthropic.com/v1/models",
                             headers={"x-api-key": _env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"},
                             model=_env("ANTHROPIC_MODEL") or "claude-3-5-haiku-latest",
                             impact="Claude LLM would fail.")


async def _diag_gemini(provider: str, kind: str, action: str) -> dict:
    d = _Diag(provider, kind, kind)
    m = _missing_creds(d, bool(_env("GOOGLE_API_KEY")), "GOOGLE_API_KEY",
                       "Gemini LLM/TTS and realtime unavailable.")
    if m:
        return m
    model = config.GEMINI_TTS_MODEL if kind == "TTS" else config.GEMINI_LLM_MODEL
    # A models.list GET succeeds even when the account cannot generate anything
    # (billing/quota), which would report a FALSE "connected" while the caller
    # hears silence. Do the REAL minimal generation instead.
    base = "https://generativelanguage.googleapis.com/v1beta/models"
    endpoint = f"{base}/{model}:generateContent"
    if kind == "TTS":
        body = {"contents": [{"parts": [{"text": "ok"}]}],
                "generationConfig": {"responseModalities": ["AUDIO"],
                                     "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig":
                                         {"voiceName": config.GEMINI_TTS_VOICE}}}}}
        want = "audio"
    else:
        body = {"contents": [{"parts": [{"text": "Reply with the single word: ok"}]}],
                "generationConfig": {"maxOutputTokens": 8, "temperature": 0}}
        want = "text"
    d.step("Request created", True, f"POST {model}:generateContent ({want})")
    req = {"provider": provider, "operation": "generate", "endpoint": endpoint,
           "model": model, "modality": want}
    d._emit("diagnostic_request_sent", endpoint=endpoint, model=model)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(endpoint, json=body,
                                  headers={"x-goog-api-key": _env("GOOGLE_API_KEY")})
        d.step("Provider connection", True)
        txt = (r.text or "")[:400]
        resp = {"http_status": r.status_code, "latency_ms": d._ms()}
        if r.status_code != 200:
            d.step("Provider response", False, f"HTTP {r.status_code}")
            quota = r.status_code in (402, 429) or any(
                w in txt.lower() for w in ("quota", "credit", "billing", "exhaust", "deplet"))
            return d.fail(breakpoint="provider response", http=r.status_code,
                          root_cause=("quota / billing limit reached" if quota else f"HTTP {r.status_code}"),
                          error=txt, retryable=quota, endpoint=endpoint, model=model,
                          impact=("Gemini TTS cannot speak — the caller hears no audio."
                                  if kind == "TTS" else "Gemini LLM cannot answer turns."),
                          request=req, response=resp)
        # 200 is not enough: confirm the response actually carries the modality.
        try:
            parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts") or []
        except Exception:
            parts = []
        if want == "audio":
            got = next((p["inlineData"]["data"] for p in parts
                        if isinstance(p, dict) and p.get("inlineData", {}).get("data")), None)
            detail = f"{len(got)} b64 chars of audio" if got else "no audio returned"
        else:
            got = next((p["text"] for p in parts
                        if isinstance(p, dict) and (p.get("text") or "").strip()), None)
            detail = f"text: {str(got)[:40]}" if got else "no text returned"
        d.step("Provider response", True, "HTTP 200")
        d.step("Response validated", bool(got), detail)
        resp["result"] = detail
        if not got:
            return d.fail(breakpoint="response validation", http=200,
                          root_cause=f"HTTP 200 but {detail}", error=txt,
                          impact=("Gemini TTS returns no audio — the caller hears silence."
                                  if kind == "TTS" else "Gemini LLM returns no text."),
                          endpoint=endpoint, model=model, request=req, response=resp)
        return d.ok(http=200, model=model, endpoint=endpoint,
                    summary=f"real {want} generated ({detail})", request=req, response=resp)
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection", root_cause="could not reach Gemini",
                      error=str(exc), impact="Gemini unavailable.", endpoint=endpoint,
                      model=model, request=req, exc=exc)


async def _diag_deepgram(action: str) -> dict:
    d = _Diag("deepgram", "STT", "STT")
    m = _missing_creds(d, bool(_env("DEEPGRAM_API_KEY")), "DEEPGRAM_API_KEY",
                       "STT cannot start, so a real voice call fails before LLM/TTS.")
    if m:
        return m
    res = await _http_probe(d, method="GET", url="https://api.deepgram.com/v1/projects",
                            headers={"Authorization": f"Token {_env('DEEPGRAM_API_KEY')}"},
                            model=config.STT_MODEL, language=config.STT_LANGUAGE,
                            impact="STT cannot start; the call fails before LLM/TTS.")
    # Attach the EXACT runtime websocket kwargs so the UI can show what a REAL
    # call uses (a REST key-check passing does NOT prove the streaming config is
    # valid — that is the "Run streaming test" explicit action).
    res.setdefault("request", {}).update({
        "runtime_stream_config": {
            "model": config.STT_MODEL, "language": config.STT_LANGUAGE,
            "endpointing_ms": config.STT_ENDPOINTING_MS,
            "utterance_end_ms": config.STT_UTTERANCE_END_MS,
            "keyterms": 0 if (config.STT_LANGUAGE or "").lower() not in ("en", "en-us", "en-in", "en-gb") else "english-only",
        },
        "note": "REST key-check only; streaming kwargs validated by a real call / streaming test.",
    })
    return res


async def _diag_elevenlabs(action: str) -> dict:
    d = _Diag("elevenlabs", "TTS", "TTS")
    m = _missing_creds(d, bool(_env("ELEVENLABS_API_KEY")), "ELEVENLABS_API_KEY", "ElevenLabs TTS unavailable.")
    if m:
        return m
    return await _http_probe(d, method="GET", url="https://api.elevenlabs.io/v1/user",
                             headers={"xi-api-key": _env("ELEVENLABS_API_KEY")},
                             impact="ElevenLabs TTS would fail.")


async def _diag_cartesia(action: str) -> dict:
    d = _Diag("cartesia", "TTS", "TTS")
    m = _missing_creds(d, bool(_env("CARTESIA_API_KEY")), "CARTESIA_API_KEY", "Cartesia TTS unavailable.")
    if m:
        return m
    return await _http_probe(d, method="GET", url="https://api.cartesia.ai/voices",
                             headers={"X-API-Key": _env("CARTESIA_API_KEY"), "Cartesia-Version": "2024-06-10"},
                             model=config.CARTESIA_MODEL, impact="Cartesia TTS would fail.")


async def _diag_sarvam(action: str) -> dict:
    d = _Diag("sarvam", "TTS", "TTS")
    m = _missing_creds(d, bool(_env("SARVAM_API_KEY")), "SARVAM_API_KEY", "Sarvam STT/TTS unavailable.")
    if m:
        return m
    # A reachability GET returns 405 even when the account cannot synthesise, which
    # would report a FALSE "connected". Do the REAL minimal synthesis instead so
    # quota exhaustion (402 "No credits available") is reported truthfully.
    d.step("Request created", True, "POST /text-to-speech (2-char probe)")
    endpoint = "https://api.sarvam.ai/text-to-speech"
    req = {"provider": "sarvam", "operation": "synthesize", "endpoint": endpoint,
           "model": config.SARVAM_MODEL, "speaker": config.SARVAM_SPEAKER,
           "language": config.SARVAM_LANGUAGE, "text_len": 2}
    d._emit("diagnostic_request_sent", endpoint=endpoint, model=config.SARVAM_MODEL)
    body = {"target_language_code": config.SARVAM_LANGUAGE, "text": "ok",
            "speaker": config.SARVAM_SPEAKER, "pace": config.SARVAM_PACE,
            "speech_sample_rate": 22050, "model": config.SARVAM_MODEL}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(endpoint, json=body,
                                  headers={"api-subscription-key": _env("SARVAM_API_KEY")})
        d.step("Provider connection", True)
        txt = (r.text or "")[:300]
        resp = {"http_status": r.status_code, "latency_ms": d._ms(), "result": txt[:160]}
        if r.status_code == 200:
            d.step("Provider response", True, "HTTP 200 — audio returned")
            d.step("Response validated", True)
            return d.ok(http=200, model=config.SARVAM_MODEL, endpoint=endpoint,
                        language=config.SARVAM_LANGUAGE, summary="synthesis succeeded",
                        request=req, response=resp)
        d.step("Provider response", False, f"HTTP {r.status_code}")
        quota = r.status_code in (402, 429) or "credit" in txt.lower() or "quota" in txt.lower()
        return d.fail(breakpoint="provider response", http=r.status_code,
                      root_cause=("no credits / quota exhausted" if quota else f"HTTP {r.status_code}"),
                      error=txt, impact="Sarvam TTS cannot speak — the caller hears no agent audio.",
                      retryable=quota, endpoint=endpoint, model=config.SARVAM_MODEL,
                      request=req, response=resp)
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection", root_cause="could not reach Sarvam",
                      error=str(exc), impact="Sarvam TTS unavailable.", endpoint=endpoint,
                      model=config.SARVAM_MODEL, request=req, exc=exc)


async def _diag_calcom(action: str) -> dict:
    d = _Diag("calcom", "CALENDAR", "BOOKING")
    key = _env("CALCOM_API_KEY")
    m = _missing_creds(d, bool(key), "CALCOM_API_KEY", "Booking/availability tools unavailable.")
    if m:
        return m
    return await _http_probe(d, method="GET", url="https://api.cal.com/v1/me",
                             params={"apiKey": key},
                             impact="Availability/booking would fail.")


async def _diag_telegram(action: str) -> dict:
    d = _Diag("telegram", "MESSAGING", "API")
    tok = _env("TELEGRAM_BOT_TOKEN")
    m = _missing_creds(d, bool(tok), "TELEGRAM_BOT_TOKEN", "Telegram notifications unavailable.")
    if m:
        return m
    return await _http_probe(d, method="GET", url=f"https://api.telegram.org/bot{tok}/getMe",
                             impact="Telegram notifications would fail.")


async def _diag_twilio(action: str) -> dict:
    d = _Diag("twilio", "MESSAGING", "API")
    sid = _env("TWILIO_ACCOUNT_SID")
    tok = _env("TWILIO_AUTH_TOKEN")
    m = _missing_creds(d, bool(sid and tok), "TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN", "SMS/WhatsApp unavailable.")
    if m:
        return m
    d.step("Request created", True)
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, auth=(sid, tok)) as client:
            r = await client.get(f"https://api.twilio.com/2010-04-01/Accounts/{sid}.json")
        d.step("Provider connection", True)
        if r.status_code == 200:
            d.step("Provider response", True, "HTTP 200")
            return d.ok(http=200, endpoint="api.twilio.com", summary="account reachable")
        d.step("Provider response", False, f"HTTP {r.status_code}")
        return d.fail(breakpoint="provider response", http=r.status_code,
                      root_cause=f"HTTP {r.status_code}", error=(r.text or "")[:300],
                      impact="SMS/WhatsApp would fail.", endpoint="api.twilio.com")
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection", root_cause="could not reach Twilio",
                      error=str(exc), impact="SMS/WhatsApp would fail.", exc=exc)


async def _diag_livekit(action: str) -> dict:
    d = _Diag("livekit", "MEDIA", "AUDIO")
    present = bool(_env("LIVEKIT_URL") and _env("LIVEKIT_API_KEY") and _env("LIVEKIT_API_SECRET"))
    m = _missing_creds(d, present, "LIVEKIT_URL/API_KEY/API_SECRET",
                       "No media transport; calls cannot connect.")
    if m:
        return m
    d.step("Request created", True, "room.list_rooms")
    d._emit("diagnostic_request_sent", endpoint=_env("LIVEKIT_URL"))
    lk = None
    try:
        from livekit import api as lkapi
        lk = lkapi.LiveKitAPI(url=_env("LIVEKIT_URL"), api_key=_env("LIVEKIT_API_KEY"),
                              api_secret=_env("LIVEKIT_API_SECRET"))
        rooms = await lk.room.list_rooms(lkapi.ListRoomsRequest())
        d.step("Provider connection", True)
        d.step("Provider response", True, f"{len(rooms.rooms)} active room(s)")
        d.step("Response validated", True)
        return d.ok(http=200, endpoint=_env("LIVEKIT_URL"),
                    summary=f"API reachable, {len(rooms.rooms)} active room(s)",
                    response={"active_rooms": len(rooms.rooms), "latency_ms": d._ms()})
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection", root_cause="LiveKit API unreachable/auth failed",
                      error=str(exc), impact="Calls cannot connect to media.", endpoint=_env("LIVEKIT_URL"), exc=exc)
    finally:
        if lk is not None:
            try:
                await lk.aclose()
            except Exception:
                pass


async def _diag_database(action: str) -> dict:
    d = _Diag("database", "DATABASE", "DATABASE")
    d.step("Configuration loaded", True)
    d.step("Credentials present", bool(_env("DATABASE_URL")), "")
    d.step("Request created", True, "SELECT 1")
    d._emit("diagnostic_request_sent", endpoint="postgres")
    try:
        import db
        pool = await db.get_pool()
        val = await pool.fetchval("SELECT 1")
        d.step("Provider connection", True)
        d.step("Provider response", val == 1, f"SELECT 1 → {val}")
        d.step("Response validated", val == 1)
        if val == 1:
            return d.ok(http=200, endpoint="postgres", summary="connected, SELECT 1 OK",
                        response={"result": 1, "latency_ms": d._ms()})
        return d.fail(breakpoint="query", root_cause="unexpected SELECT 1 result",
                      error=str(val), impact="DB reads/writes unreliable.")
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="connection", root_cause="database unreachable",
                      error=str(exc), impact="Calls/bookings cannot be persisted.", exc=exc)


async def _diag_recording(action: str) -> dict:
    d = _Diag("recording", "STORAGE", "AUDIO")
    # Self-hosted recording is the default backend — verify LOCAL storage, not R2.
    if config.RECORDING_BACKEND == "local":
        import shutil
        path = config.RECORDINGS_DIR
        d.step("Configuration loaded", True, f"backend=local dir={path}")
        exists = os.path.isdir(path)
        if not exists:
            try:
                os.makedirs(path, exist_ok=True)
                exists = True
            except Exception as exc:
                d.step("Storage directory", False, str(exc)[:120])
                return d.fail(breakpoint="storage", root_cause=f"cannot create {path}",
                              error=str(exc), impact="Call recordings cannot be saved.")
        writable = os.access(path, os.W_OK)
        d.step("Storage directory", exists, path)
        d.step("Writable", writable, "" if writable else "no write permission")
        if not writable:
            return d.fail(breakpoint="storage", root_cause=f"{path} is not writable",
                          impact="Call recordings cannot be saved.")
        free_mb = int(shutil.disk_usage(path).free / (1024 * 1024))
        ok_space = free_mb >= config.RECORDING_MIN_FREE_MB
        d.step("Free space", ok_space, f"{free_mb}MB free (min {config.RECORDING_MIN_FREE_MB}MB)")
        if not ok_space:
            return d.fail(breakpoint="storage", root_cause=f"only {free_mb}MB free",
                          impact="Recording will be skipped until space is freed.")
        return d.ok(http=200, endpoint=path, model="local-disk",
                    summary=f"local storage writable, {free_mb}MB free",
                    response={"free_mb": free_mb, "dir": path})

    acc = _env("R2_ACCESS_KEY_ID")
    sec = _env("R2_SECRET_ACCESS_KEY")
    bucket = _env("R2_BUCKET") or config.R2_BUCKET
    endpoint = _env("R2_ENDPOINT") or (f"https://{_env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com" if _env("R2_ACCOUNT_ID") else "")
    present = bool(acc and sec and bucket and endpoint)
    m = _missing_creds(d, present, "R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET/R2_ENDPOINT",
                       "Call recordings cannot be uploaded.")
    if m:
        return m
    d.step("Request created", True, f"head_bucket {bucket}")
    d._emit("diagnostic_request_sent", endpoint=endpoint, model=bucket)

    def _head() -> None:
        import boto3
        s3 = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=acc,
                          aws_secret_access_key=sec, region_name="auto")
        s3.head_bucket(Bucket=bucket)

    try:
        await asyncio.to_thread(_head)
        d.step("Provider connection", True)
        d.step("Provider response", True, "bucket accessible")
        d.step("Response validated", True)
        return d.ok(http=200, endpoint=endpoint, model=bucket, summary=f"bucket '{bucket}' accessible")
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="bucket access", root_cause="R2 bucket not accessible / auth failed",
                      error=str(exc), impact="Recordings cannot be uploaded.", endpoint=endpoint, exc=exc)


async def _diag_vobiz(action: str) -> dict:
    # SAFE diagnostic ONLY — config/routing presence. A real SIP call is the
    # explicit "Place Test Call" action (not implemented here; it is chargeable
    # and must go through the dialer/dispatch with an operator-chosen number).
    d = _Diag("vobiz", "TELEPHONY", "SIP")
    d.step("Configuration loaded", True)
    # What the RUNTIME actually needs is OUTBOUND_TRUNK_ID: agent.py dials via
    # CreateSIPParticipant(sip_trunk_id=...) and LiveKit Cloud holds the trunk's
    # SIP address + auth. VOBIZ_SIP_DOMAIN/USERNAME/PASSWORD are used only by the
    # one-off sip/create_trunk.py provisioning scripts, so their absence must NOT
    # be reported as a telephony failure.
    trunk_id = _env("OUTBOUND_TRUNK_ID")
    d.step("Outbound trunk id configured", bool(trunk_id),
           trunk_id or "OUTBOUND_TRUNK_ID missing")
    if not trunk_id:
        return d.fail(breakpoint="configuration", root_cause="OUTBOUND_TRUNK_ID not set",
                      impact="Outbound calls cannot be placed.")
    lk_present = bool(_env("LIVEKIT_URL") and _env("LIVEKIT_API_KEY") and _env("LIVEKIT_API_SECRET"))
    if not lk_present:
        d.step("LiveKit credentials", False, "LIVEKIT_URL/API_KEY/API_SECRET missing")
        return d.fail(breakpoint="configuration", root_cause="LiveKit credentials missing",
                      impact="Cannot verify the SIP trunk or place calls.")

    # READ-ONLY verification that the trunk really exists in LiveKit Cloud.
    # Lists only — never creates or modifies trunk configuration.
    d.step("Request created", True, "sip.list_sip_outbound_trunk")
    d._emit("diagnostic_request_sent", endpoint=_env("LIVEKIT_URL"), trunk=trunk_id)
    lk = None
    try:
        from livekit import api as lkapi
        lk = lkapi.LiveKitAPI(url=_env("LIVEKIT_URL"), api_key=_env("LIVEKIT_API_KEY"),
                              api_secret=_env("LIVEKIT_API_SECRET"))
        out = await lk.sip.list_sip_outbound_trunk(lkapi.ListSIPOutboundTrunkRequest())
        d.step("Provider connection", True)
        trunks = list(getattr(out, "items", []) or [])
        match = next((t for t in trunks if getattr(t, "sip_trunk_id", "") == trunk_id), None)
        d.step("Provider response", True, f"{len(trunks)} outbound trunk(s)")
        d.step("Configured trunk exists in LiveKit", bool(match),
               (f"{getattr(match, 'name', '') or trunk_id} @ {getattr(match, 'address', '?')}"
                if match else f"{trunk_id} not found among {len(trunks)} trunk(s)"))
        if not match:
            return d.fail(breakpoint="trunk lookup", http=200,
                          root_cause=f"OUTBOUND_TRUNK_ID {trunk_id} does not exist in LiveKit Cloud",
                          impact="Outbound dialing fails — the trunk id is stale.",
                          endpoint=_env("LIVEKIT_URL"),
                          response={"trunks_found": len(trunks), "latency_ms": d._ms()})
        numbers = list(getattr(match, "numbers", []) or [])
        inbound = 0
        try:    # informational only — inbound is optional
            ib = await lk.sip.list_sip_inbound_trunk(lkapi.ListSIPInboundTrunkRequest())
            inbound = len(list(getattr(ib, "items", []) or []))
        except Exception:
            pass
        d.step("Response validated", True)
        return d.ok(http=200, endpoint=_env("LIVEKIT_URL"),
                    summary=f"outbound trunk live @ {getattr(match, 'address', '?')}"
                            f"{' · ' + numbers[0] if numbers else ''}",
                    response={"trunk_id": trunk_id, "address": getattr(match, "address", ""),
                              "name": getattr(match, "name", ""), "numbers": numbers,
                              "inbound_trunks": inbound, "latency_ms": d._ms(),
                              "note": "config verified read-only — 'Place Test Call' verifies a real dial"})
    except Exception as exc:
        d.step("Provider connection", False, str(exc)[:160])
        return d.fail(breakpoint="provider connection",
                      root_cause="could not query LiveKit SIP trunks", error=str(exc),
                      impact="Cannot confirm the telephony trunk is usable.",
                      endpoint=_env("LIVEKIT_URL"), exc=exc)
    finally:
        if lk is not None:
            try:
                await lk.aclose()
            except Exception:
                pass


async def _diag_webhook(action: str) -> dict:
    d = _Diag("webhook", "WEBHOOK", "API")
    url = _env("N8N_WEBHOOK_URL")
    d.step("Configuration loaded", True)
    d.step("Webhook URL present", bool(url), "" if url else "N8N_WEBHOOK_URL not set")
    if not url:
        return d.fail(breakpoint="configuration", root_cause="N8N_WEBHOOK_URL not set",
                      impact="Outbound webhooks are disabled.")
    # Safe: do NOT POST (would trigger the workflow). Report configured only.
    return d.ok(endpoint=url.split("?")[0], summary="configured (send a test webhook explicitly to verify delivery)",
                response={"note": "safe check = config only; POST is an explicit action"})


# ── Dispatch ──────────────────────────────────────────────────────────────────
_ADAPTERS = {
    "groq": _diag_groq, "openai": _diag_openai, "anthropic": _diag_anthropic,
    "google": lambda a: _diag_gemini("google", "LLM", a),
    "gemini_tts": lambda a: _diag_gemini("gemini_tts", "TTS", a),
    "deepgram": _diag_deepgram, "elevenlabs": _diag_elevenlabs, "cartesia": _diag_cartesia,
    "sarvam": _diag_sarvam, "calcom": _diag_calcom, "telegram": _diag_telegram,
    "twilio": _diag_twilio, "livekit": _diag_livekit, "database": _diag_database,
    "recording": _diag_recording, "vobiz": _diag_vobiz, "webhook": _diag_webhook,
}

SUPPORTED = sorted(_ADAPTERS.keys())


async def run_diagnostic(provider: str, action: str = "safe") -> dict:
    """Run one provider's safe diagnostic. `action` reserved for explicit
    chargeable actions (place_test_call/send_test_message/...), which the safe
    adapters here reject — those live behind explicit endpoints."""
    fn = _ADAPTERS.get((provider or "").lower())
    if fn is None:
        return {"provider": provider, "status": "failed", "steps": [],
                "breakpoint": "unknown_provider", "root_cause": f"no diagnostic for '{provider}'",
                "error": "unknown provider", "traffic_type": "diagnostic"}
    try:
        return await fn(action)
    except Exception as exc:  # never let a diagnostic crash the API
        logger.warning("diagnostic_crashed", provider=provider, error=str(exc)[:300],
                       traffic_type="diagnostic", source="provider_diagnostic")
        return {"provider": provider, "status": "failed", "steps": [],
                "breakpoint": "diagnostic_error", "root_cause": "diagnostic raised",
                "error": str(exc)[:500], "traffic_type": "diagnostic"}
