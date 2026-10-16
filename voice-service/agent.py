"""LiveKit voice agent worker — handles inbound + outbound calls with Gemini Live default."""

from __future__ import annotations

import os
import ssl
from typing import Any

import certifi

# ── Local telemetry guard (must be set BEFORE livekit/opentelemetry import) ───
# LiveKit Cloud OTEL export was timing out (~10s read timeouts to the cloud OTLP
# endpoint) and spamming "Failed to export … batch" — non-essential telemetry
# that competes with the realtime path. Default it OFF locally so the OTel SDK
# becomes a no-op (no spans/logs/metrics export, no network stalls). Dashboard
# live logs are UNAFFECTED — they come from the structlog→error_logs DB bridge,
# not OTEL. Set OTEL_SDK_DISABLED=false in the environment to re-enable.
os.environ.setdefault("OTEL_SDK_DISABLED", "true")
os.environ.setdefault("OTEL_EXPORTER_OTLP_TIMEOUT", "2")  # belt-and-suspenders: fail fast if ever enabled

# ── SSL patch (must happen before any networking imports) ────────────────────
_orig_ssl = ssl.create_default_context
def _certifi_ssl(purpose=ssl.Purpose.SERVER_AUTH, **kwargs):
    if not kwargs.get("cafile") and not kwargs.get("capath") and not kwargs.get("cadata"):
        kwargs["cafile"] = certifi.where()
    return _orig_ssl(purpose, **kwargs)
ssl.create_default_context = _certifi_ssl  # type: ignore[assignment]

import asyncio  # noqa: E402
import json  # noqa: E402
import random  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402
from collections import defaultdict  # noqa: E402
from datetime import UTC, datetime  # noqa: E402

from pathlib import Path  # noqa: E402

from dotenv import load_dotenv  # noqa: E402
from livekit import agents, api, rtc  # noqa: E402, F401
from livekit.agents import (  # noqa: E402
    NOT_GIVEN,
    Agent,
    AgentSession,
    APIConnectOptions,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
    llm,  # noqa: F401
)
from livekit.agents.voice.agent_session import (  # noqa: E402
    SessionConnectOptions,
)
from livekit.plugins import noise_cancellation, silero  # noqa: E402, F401

# Load .env BEFORE importing local modules (config.py reads env vars at import
# time — e.g. USE_GEMINI_REALTIME — so the file must be loaded first).
load_dotenv(Path(__file__).with_name(".env"))   # absolute: independent of cwd

import config  # noqa: E402
import db  # noqa: E402
import lang  # noqa: E402
import knowledge  # noqa: E402
import provider_registry  # noqa: E402
import provider_credentials  # noqa: E402
import llm_routing  # noqa: E402
import local_clips as _clips  # noqa: E402
import notify  # noqa: E402
import provider_health as _ph  # noqa: E402
import recorder as _rec  # noqa: E402
import redactor  # noqa: E402
from language_presets import LANGUAGE_PRESETS  # noqa: E402, F401
from observability import get_logger, init_observability  # noqa: E402
from prompts import build_prompt, count_tokens, get_business_context  # noqa: E402
from voicemail import looks_like_voicemail  # noqa: E402

init_observability()
logger = get_logger("agent")

# Process-global provider-health registry (req 16). One per worker process so a
# PERMANENT failure (402 credits / 404 model / 400 config / 401 auth) on one call
# disables that provider for subsequent calls in the same worker instead of being
# retried into the same wall every turn; timed 429 cooldowns auto-recover. The
# session error handler feeds it; routing can consult `.usable(provider, kind)`.
PROVIDER_HEALTH = _ph.ProviderHealth(log=lambda ev, **kw: logger.warning(ev, **kw))

# Build marker logged at worker boot (_prewarm) and per job (entrypoint). Bump
# this string whenever agent.py changes so the live logs prove which code the
# running worker actually loaded. Absent from logs ⇒ worker not restarted.
AGENT_BUILD = "2026-10-07-initfix"

# The only languages allowed to drive the spoken reply language. Deepgram "multi"
# mis-maps Indian-accented / Tamil speech to unrelated languages (notably Spanish);
# anything outside this set is treated as uncertain and ignored for routing.
_ALLOWED_LANGS = {"en", "ta", "hi", "te"}

# Explicit "switch language now" instructions from the caller (Phase 6). These
# force the language immediately, overriding STT detection — e.g. "English la
# sollunga" / "Tamil la explain pannunga" / "in English". A bare question that
# merely mentions a language ("Do you know Tamil?", "Tamil theriyuma?") is NOT a
# switch instruction and must not match.
_RE_SWITCH_EN = re.compile(
    r"\benglish\s+la\b|\bin\s+english\b|\benglish\b\s+(sollung|pannung|speak|say)"
    r"|\bspeak\s+english\b|\b(again|back\s+to|switch\s+to)\s+english\b",
    re.I,
)
_RE_SWITCH_TA = re.compile(
    r"\btamil[\s-]*la+\b|\bin\s+tamil\b|\bspeak\s+tamil\b|\btamil\s+please\b"
    r"|\btamil\s+(pesu\w*|pannu\w*|sollu\w*|mathiri|la\w*)"
    r"|(\btamil\b|தமிழ்)\s+(sollung|pannung|pesung|explain)|தமிழ்\s*ல|\btanglish\b"
    r"|\b(again|back\s+to|switch\s+to)\s+tamil\b|தமிழ்\s*(ல|லேயே)?\s*(திரும்ப|மறுபடி)"
    r"|(திரும்ப|மறுபடி)\s*தமிழ்",
    re.I,
)

# Simple caller-frustration cues (Tamil + Tanglish + English). Matching one only
# EMITS a diagnostic (caller_frustration_detected); the actual "acknowledge
# first, don't restart" behaviour is handled by the prompt. Deliberately narrow
# to avoid false positives on ordinary speech.
_RE_FRUSTRATION = re.compile(
    r"already\s+(sonnen|solliten|told|said|சொன்ன|சொல்லி)|ஏற்கனவே\s*சொன்ன"
    r"|எத்தனை\s*(தடவை|முறை)|how\s+many\s+times|repeat\s+(aidu|pannur|again)"
    r"|again\s+kekkur|கேக்குதா|கேட்குதா|\bnee\s+kekkura\b"
    r"|why\s+(are\s+you\s+)?(repeat|chang)",
    re.I,
)

# Presence check (req 8): "hello?/are you there?/can you hear me?" MID-CALL means
# "are you still there?", not a new greeting. Detection emits presence_check_*;
# the quick "yes, I'm here" reply + "never re-greet" is handled by the prompt +
# the normal turn. The code value here is observability + COALESCING: a presence
# utterance arriving while a reply is already pending must NOT spawn another.
_RE_PRESENCE = re.compile(
    r"^\s*(hello+|hallo+|hi+|you\s+there|are\s+you\s+(there|still\s+there)"
    r"|can\s+you\s+hear\s+me|still\s+there|helo+)\s*[?.!]*\s*$"
    r"|கேக்குதா|கேட்குதா|இருக்கீ\w*|கேட்குதா|ஹலோ",
    re.I,
)

# Dead-air watchdog: if no agent audio has started this long after a finalized
# caller turn, log conversation_dead_air_detected (diagnostic only — no spoken
# filler, no fake delay). The real stall sources (Groq 429 round-trips) are
# handled by the cross-provider cooldown; this is the safety-net signal.
_DEAD_AIR_S = float(os.getenv("DEAD_AIR_SECONDS", "5"))

# ── Optional plugin imports ──────────────────────────────────────────────────
_google_realtime: Any = None
_google_beta_realtime: Any = None
_google_llm: Any = None
_google_tts: Any = None
try:
    from livekit.plugins import google as _gp
    _google_realtime = getattr(getattr(_gp, "realtime", None), "RealtimeModel", None)
    _google_beta_realtime = getattr(getattr(getattr(_gp, "beta", None), "realtime", None), "RealtimeModel", None)
    _google_llm = getattr(_gp, "LLM", None)
    _google_tts = getattr(_gp, "TTS", None)
    # Gemini-native TTS (uses GOOGLE_API_KEY) — the PRIMARY pipeline TTS.
    _gemini_tts = getattr(getattr(_gp, "beta", None), "GeminiTTS", None)
    try:
        from livekit.plugins.google.beta.gemini_tts import GEMINI_VOICES as _GEMINI_VOICES
    except Exception:
        _GEMINI_VOICES = ()
except ImportError:
    logger.warning("livekit-plugins-google not installed")
    _gemini_tts = None
    _GEMINI_VOICES = ()

# TTS fallback adapter (never leave the caller silent): tries the next TTS when
# one fails mid-synthesis. Optional — absent in very old agent versions.
try:
    from livekit.agents.tts import FallbackAdapter as _TTSFallbackAdapter
except Exception:
    _TTSFallbackAdapter = None

_deepgram_stt: Any = None
_deepgram_tts: Any = None
try:
    from livekit.plugins import deepgram as _dg
    _deepgram_stt = _dg.STT
    _deepgram_tts = getattr(_dg, "TTS", None)  # Aura — healthy fallback TTS
except ImportError:
    pass

_sarvam: Any = None
try:
    from livekit.plugins import sarvam as _sarvam_mod
    _sarvam = _sarvam_mod
except ImportError:
    pass

_elevenlabs: Any = None
try:
    from livekit.plugins import elevenlabs as _el
    _elevenlabs = _el
except ImportError:
    pass

_cartesia: Any = None
try:
    from livekit.plugins import cartesia as _ct
    _cartesia = _ct
except ImportError:
    pass

_openai_plugin: Any = None
try:
    from livekit.plugins import openai as _oai
    _openai_plugin = _oai
except ImportError:
    pass

# Rumik Silk (livekit-plugins-rumik) and Murf Falcon (livekit-plugins-murf).
# Both are TTS-only and both take a per-call api_key, which is what makes them
# usable with BYOK credentials.
_rumik: Any = None
try:
    from livekit.plugins import rumik as _rk
    _rumik = _rk
except ImportError:
    pass

_murf: Any = None
try:
    from livekit.plugins import murf as _mf
    _murf = _mf
except ImportError:
    pass

# LiveKit's wrapper that turns a NON-streaming STT (OpenAI, ElevenLabs Scribe)
# into a streaming one by segmenting audio with a VAD. Without it those two
# providers cannot be used in a live call at all.
_STTStreamAdapter: Any = None
try:
    from livekit.agents.stt import StreamAdapter as _STTStreamAdapter
except Exception:
    _STTStreamAdapter = None


# ── Rate limiting ────────────────────────────────────────────────────────────
_call_timestamps: dict[str, list[float]] = defaultdict(list)


def is_rate_limited(phone: str) -> bool:
    if phone in ("unknown", "demo"):
        return False
    now = time.time()
    _call_timestamps[phone] = [t for t in _call_timestamps[phone] if now - t < config.RATE_LIMIT_WINDOW]
    if len(_call_timestamps[phone]) >= config.RATE_LIMIT_CALLS_PER_HOUR:
        return True
    _call_timestamps[phone].append(now)
    return False


# ── Session factory ──────────────────────────────────────────────────────────

def _build_pipeline_llm(route: "llm_routing.LlmRoute"):
    """Build the PRIMARY pipeline LLM for an already-resolved route.

    The route decides the provider; this only instantiates it. There is no
    provider preference list any more: silently trying groq → gemini → openai →
    claude meant a user who selected OpenAI could be served (and billed) by Groq.
    """
    if not route.primary_provider:
        logger.error("primary_llm_unavailable", **route.log_fields(),
                     root_cause=route.reason, source="LLM",
                     impact="no LLM for this call — the agent cannot answer turns")
        return None
    llm_obj = llm_routing.build_llm(route.primary_provider, route.primary_model)
    if llm_obj is None:
        logger.error("primary_llm_build_failed", **route.log_fields(), source="LLM")
        return None
    logger.info("pipeline_llm_selected", provider=route.primary_provider,
                model=route.primary_model, **route.log_fields(), source="LLM")
    return llm_obj


# ── Runtime LLM fallback router (P0) ──────────────────────────────────────────
# Which models are used is decided by `llm_routing.resolve_route` from the
# SELECTED provider (per-provider fallback models live there, e.g.
# GROQ_FALLBACK_MODEL). A different model on the same provider is a separate
# rate-limit bucket, so it survives a 429 without leaving the provider.
#
# After the primary returns HTTP 429, skip it for this many seconds and route
# turns straight to the fallback — so a rate-limited window does not pay a
# failing round-trip on EVERY turn. Clamped to 30–60s.
# Hard cap on how long the greeting may stay uninterruptible when the first
# audio frame never arrives — so a broken output path can never mute the caller
# for the whole greeting.
GREETING_PROTECT_MAX_S = float(os.getenv("GREETING_PROTECT_MAX_SECONDS", "8"))

_GROQ_COOLDOWN_S = max(30.0, min(60.0, float(os.getenv("GROQ_COOLDOWN_SECONDS", "45"))))

# Input tokens-per-minute the LLM account is believed to allow. Used ONLY to
# warn: nothing is throttled or dropped on the strength of it.
#
# Why it exists: in the 08:21 incident the per-request input was ~3,400 tokens
# (2,764 of them the assembled system prompt) and the call ran at 5 requests a
# minute — about 17,000 ITPM against a free tier of roughly 7,000. The call was
# 2.4x over budget from its first minute, so the 429s were arithmetic, not a
# burst, a retry storm or concurrency. That was invisible: the measurement
# existed but carried no call id and was being redacted. This surfaces the
# arithmetic while the call is running, so the limit is a known constraint
# rather than something discovered through dropped turns.
#
# 8,000 is MEASURED, not assumed: Groq returns it per model in
# `x-ratelimit-limit-tokens` (gpt-oss-120b, gpt-oss-20b and qwen3.8-27b each
# report 8000, with independent remaining counts). The earlier 7000 here was a
# guess made before those headers were read.
_LLM_ITPM_BUDGET = int(os.getenv("LLM_INPUT_TOKENS_PER_MINUTE", "8000"))


def _build_fallback_llm(route: "llm_routing.LlmRoute") -> tuple[Any, str | None]:
    """Build the per-turn fallback LLM for an already-resolved route.

    By default this is a DIFFERENT MODEL ON THE SAME PROVIDER (a separate
    rate-limit bucket, no new credential, same bill). It only belongs to another
    vendor when ALLOW_CROSS_PROVIDER_FALLBACK=true, and `resolve_route` has
    already made and logged that decision.
    """
    if not route.fallback_provider or not route.fallback_model:
        logger.warning("fallback_llm_none", **route.log_fields(), root_cause=route.reason,
                       source="LLM", impact="a primary failure ends the turn with a repair line")
        return None, None
    llm_obj = llm_routing.build_llm(route.fallback_provider, route.fallback_model)
    if llm_obj is None:
        return None, None
    return llm_obj, f"{route.fallback_provider}/{route.fallback_model}"


def _classify_llm_error(err: BaseException | None) -> tuple[str, int | None]:
    """Map an LLM failure to (error_type, status_code) for diagnostics."""
    if err is None:
        return "incomplete_generation", None
    status = getattr(err, "status_code", None)
    msg = str(err).lower()
    if status == 429 or "429" in msg or "rate_limit" in msg or "rate limit" in msg:
        return "rate_limit", status or 429
    if isinstance(status, int) and 500 <= status < 600:
        return "server_error", status
    if isinstance(err, (asyncio.TimeoutError,)) or "timeout" in msg or "timed out" in msg:
        return "timeout", status
    if "connect" in msg or "connection" in msg:
        return "connection_error", status
    return "error", status


_RETRY_AFTER_RE = re.compile(r"try again in ([\d.]+)\s*(ms|s)\b", re.I)
_LIMIT_KIND_RE = re.compile(r"on (tokens|requests) per (minute|day|hour)", re.I)


def _rate_limit_hint(err: BaseException | None) -> tuple[float | None, str]:
    """(retry_after_seconds, limit_kind) read from a provider's 429.

    The cooldown used to be a fixed 30-60s guess. Groq states the real wait
    both in a `retry-after` header and in the message body, e.g.

        Rate limit reached for model `openai/gpt-oss-120b` ... on tokens per
        minute (TPM): Limit 6000, Used 5800, Requested 500.
        Please try again in 3.456s.

    Guessing high keeps the caller on a degraded model long after the window
    has actually reopened; guessing low walks straight back into the wall. Read
    whatever the provider states and fall back to the fixed window only when it
    states nothing. `limit_kind` ("tokens per minute" / "requests per minute")
    is surfaced in the logs because the remedy differs: TPM is fixed by sending
    fewer tokens per turn, RPM by sending fewer turns.
    """
    if err is None:
        return None, ""
    secs: float | None = None
    # 1. a real Retry-After header, wherever the SDK hung it.
    for holder in (getattr(err, "response", None), err):
        headers = getattr(holder, "headers", None)
        if not headers:
            continue
        try:
            for key in ("retry-after", "Retry-After",
                        "x-ratelimit-reset-tokens", "x-ratelimit-reset-requests"):
                raw = headers.get(key) if hasattr(headers, "get") else None
                if raw is None:
                    continue
                m = _RETRY_AFTER_RE.search(str(raw))
                if m:
                    secs = float(m.group(1)) / (1000 if m.group(2).lower() == "ms" else 1)
                else:
                    secs = float(str(raw).rstrip("s") or 0) or None
                if secs:
                    break
        except Exception:
            secs = None
        if secs:
            break
    # 2. otherwise the number the provider put in the message.
    msg = str(err)
    if secs is None:
        m = _RETRY_AFTER_RE.search(msg)
        if m:
            secs = float(m.group(1)) / (1000 if m.group(2).lower() == "ms" else 1)
    kind = ""
    k = _LIMIT_KIND_RE.search(msg)
    if k:
        kind = f"{k.group(1)} per {k.group(2)}".lower()
    # Never trust an absurd value from a provider into a caller-facing stall.
    if secs is not None:
        secs = max(0.0, min(secs, 120.0))
    return secs, kind


def _limit_is_account_wide(err: BaseException | None) -> bool:
    """True when a 429 constrains the whole ACCOUNT, not one model.

    Per-model cooldowns alone are not enough. Groq's per-minute token limits
    are per model — which is why, in the 08:21 incident, the fallback kept
    serving for ten turns after the primary was limited. But the DAILY limits
    are organisation-scoped: once tokens-per-day is exhausted, every model on
    the key is finished, and resting them one at a time just means each gets
    its own doomed request before the call gives up.

    Detected conservatively — only a stated per-day/per-hour limit, or an
    explicit account/organisation scope, counts. An unrecognised 429 stays
    per-model, which is the safer default: it never parks a model that might
    still be able to serve.
    """
    if err is None:
        return False
    msg = str(err).lower()
    if re.search(r"per (day|hour)\b", msg) or re.search(r"\b(tpd|rpd)\b", msg):
        return True
    return bool(re.search(r"(account|organization|organisation)[- ]?(wide|level|limit)", msg))


def _safe_to_release(text: str) -> bool:
    """A reply is safe to START speaking once it has a real sentence (a terminator
    or enough content). This lets a genuine short ack through ("Yes.", "I'm here.",
    "One moment, please.") but holds a bare fragment ("I'm", "Sure,", "I can") so
    it is never sent to TTS. "।" is the Devanagari/Hindi sentence end."""
    t = (text or "").strip()
    if not t:
        return False
    return len(t) >= 25 or any(p in t for p in (".", "!", "?", "\n", "।"))


async def _stream_gated(llm_obj: Any, chat_ctx: Any, tools: list, tool_choice: Any,
                        conn: APIConnectOptions, result: dict):
    """Stream an LLM reply but HOLD the first chunks until the reply reaches a safe
    prefix (a sentence boundary, enough text, or a tool call), then release the
    buffer and pass the rest through. Sets result["status"]:
      • "ok"                 → released + stream completed cleanly
      • "fragment"           → stream ended before a safe prefix (NOTHING yielded)
      • "error"              → failed before any release (NOTHING yielded)
      • "error_after_output" → failed after release (partial already spoken)
    A caller can safely fall back only when nothing was yielded ("fragment"/"error")."""
    buf: list = []
    released = False
    acc = ""
    result["status"], result["err"], result["text"] = "error", None, ""
    try:
        async with llm_obj.chat(chat_ctx=chat_ctx, tools=tools,
                                tool_choice=tool_choice, conn_options=conn) as stream:
            async for chunk in stream:
                if released:
                    yield chunk
                    continue
                d = getattr(chunk, "delta", None)
                buf.append(chunk)
                if d is not None and getattr(d, "tool_calls", None):
                    released = True
                    for c in buf:
                        yield c
                    buf = []
                    continue
                if d is not None and getattr(d, "content", None):
                    acc += d.content
                if _safe_to_release(acc):
                    released = True
                    for c in buf:
                        yield c
                    buf = []
        result["text"] = acc
        result["status"] = "ok" if released else "fragment"
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 — classified + handled by the router
        result["err"] = exc
        result["text"] = acc
        result["status"] = "error_after_output" if released else "error"


def _valid_gemini_voice(v: Any) -> str:  # noqa: ANN401
    """Return a Gemini voice name: the profile's if it is a real Gemini voice,
    else the configured default (Gemini voices are language-agnostic)."""
    return v if (v and _GEMINI_VOICES and v in _GEMINI_VOICES) else config.GEMINI_TTS_VOICE


def _build_gemini_tts(profile: dict | None):
    """Primary TTS: Gemini TTS via GOOGLE_API_KEY. Returns (tts, 'gemini') or
    (None, '')."""
    if _gemini_tts is None or not os.environ.get("GOOGLE_API_KEY"):
        return None, ""
    voice = _valid_gemini_voice((profile or {}).get("voice"))
    try:
        obj = _gemini_tts(model=config.GEMINI_TTS_MODEL, voice_name=voice,
                          api_key=os.environ["GOOGLE_API_KEY"],
                          instructions=config.GEMINI_TTS_INSTRUCTIONS)
        return obj, "gemini"
    except Exception as exc:
        logger.warning("gemini_tts_build_failed", error=str(exc))
        return None, ""


def _sarvam_safe_speakers() -> set[str]:
    """Speakers this deployment can actually use, from the central registry.

    The registry already holds the intersection of what the installed plugin
    will construct and what the live API will synthesise — names in only one of
    those lists either fail the constructor or return HTTP 400 mid-call.
    """
    d = provider_registry.get("sarvam", "TTS")
    return set(d.voices) if d else set()


def _build_sarvam_tts(profile: dict | None):
    """Optional Sarvam fallback TTS (only when SARVAM_API_KEY exists). Returns
    the TTS or None — Sarvam is NEVER required for the call to function."""
    if _sarvam is None or not os.environ.get("SARVAM_API_KEY"):
        return None
    # ONE voice identity for the whole call: the speaker is fixed and NEVER
    # changes when the language switches — only target_language_code is
    # re-routed per turn (see lang.tts_route / _lang_route).
    safe = _sarvam_safe_speakers()
    configured = ((profile or {}).get("voice") or "").strip()
    default_spk = config.SARVAM_SPEAKER if config.SARVAM_SPEAKER in safe else "ishita"

    # An assistant-level override is honoured ONLY when this provider can speak
    # it. A Gemini voice such as "Aoede" saved against Sarvam is rejected here
    # and reported, instead of silently becoming a different voice.
    if configured and configured not in safe:
        logger.warning("tts_voice_incompatible", provider="sarvam",
                       model=config.SARVAM_MODEL, configured_voice=configured,
                       using_voice=default_spk,
                       reason="voice is not a valid speaker for this provider/model",
                       impact="the assistant speaks with the provider default until the "
                              "voice is corrected on the assistant",
                       source="TTS")
        configured = ""

    for cand in (configured, default_spk, "ishita"):
        if not cand or cand not in safe:
            continue
        try:
            tts_obj = _sarvam.TTS(
                target_language_code=config.SARVAM_LANGUAGE,
                model=config.SARVAM_MODEL,
                speaker=cand,
                pace=config.SARVAM_PACE,
                speech_sample_rate=config.SARVAM_SAMPLE_RATE,
            )
            # Log the speaker ACTUALLY in use, so a stale value on the assistant
            # can never be mistaken for what the caller hears.
            logger.info("sarvam_tts_configured", provider="sarvam",
                        model=config.SARVAM_MODEL, speaker=cand,
                        requested_voice=((profile or {}).get("voice") or "") or cand,
                        seed_language_code=config.SARVAM_LANGUAGE,
                        pace=config.SARVAM_PACE, source="TTS")
            return tts_obj
        except Exception as exc:
            logger.warning("sarvam_tts_build_failed", speaker=cand, error=str(exc))
    return None
    # ONE voice identity for the whole call: the speaker is fixed and NEVER
    # changes when the language switches — only target_language_code is
    # re-routed per turn (see lang.tts_route / _lang_route). An assistant-level
    # voice override is honoured, but it must be a v3-compatible speaker.
    spk = (profile or {}).get("voice") or config.SARVAM_SPEAKER
    for cand in (spk, config.SARVAM_SPEAKER, "anushka"):
        if not cand:
            continue
        try:
            tts_obj = _sarvam.TTS(
                target_language_code=config.SARVAM_LANGUAGE,
                model=config.SARVAM_MODEL,
                speaker=cand,
                pace=config.SARVAM_PACE,
                speech_sample_rate=config.SARVAM_SAMPLE_RATE,
            )
            logger.info("sarvam_tts_configured", provider="sarvam",
                        model=config.SARVAM_MODEL, speaker=cand,
                        seed_language_code=config.SARVAM_LANGUAGE,
                        pace=config.SARVAM_PACE, source="TTS")
            return tts_obj
        except Exception as exc:
            logger.warning("sarvam_tts_build_failed", speaker=cand, error=str(exc))
    return None


def _build_deepgram_tts():
    """Deepgram Aura — the HEALTHY fallback TTS (uses the working DEEPGRAM_API_KEY).
    English-centric, but guarantees audible audio even when Gemini free tier 429s.
    Returns (tts, 'deepgram') or (None, '')."""
    if _deepgram_tts is None or not os.environ.get("DEEPGRAM_API_KEY"):
        return None, ""
    try:
        return _deepgram_tts(model=config.DEEPGRAM_TTS_MODEL), "deepgram"
    except Exception as exc:
        logger.warning("deepgram_tts_build_failed", error=str(exc))
        return None, ""


def _build_fallback_tts(profile: dict | None, primary_provider: str):
    """Build the HEALTHY fallback TTS for the never-silent path — LANGUAGE-AWARE.

    Deepgram Aura (`aura-2-andromeda-en`) is ENGLISH-ONLY: feeding it Tamil text
    produces gibberish. So for a non-English deployment (STT_LANGUAGE ∈ ta/hi/te…)
    Aura is NOT wired as the fallback — better to have no cloud fallback (and a
    local presence clip) than to synthesize broken Tamil with an English voice.
    Returns (tts, provider_label) or (None, '')."""
    want = (config.TTS_FALLBACK_PROVIDER or "none").lower()
    deployment_lang = lang.normalize_lang(config.STT_LANGUAGE) or "en"
    if want == primary_provider or want == "none":
        return None, ""
    if want == "deepgram":
        # English Aura is unsafe for a non-English deployment.
        if deployment_lang != "en":
            logger.info("tts_language_route", language=deployment_lang, primary=primary_provider,
                        fallback="none", reason="english_aura_unsafe_for_non_english", source="TTS")
            return None, ""
        return _build_deepgram_tts()
    if want == "sarvam" and config.SARVAM_TTS_FALLBACK:
        t = _build_sarvam_tts(profile)
        return (t, "sarvam") if t else (None, "")
    return None, ""


_VAD_SINGLETON: Any = None


def _shared_vad() -> Any:
    """One Silero VAD for the whole worker process, loaded on first use.

    Needed for two things: wrapping a non-streaming STT in StreamAdapter, and
    keeping barge-in responsive on an STT that emits no interim transcripts.

    An old comment in this file claimed Silero "runs slower than realtime on
    this host". Measured 2026-10-13 on this host: 37x realtime, 0.54ms per 20ms
    frame against a 20ms budget, 57ms to load. It keeps up comfortably, so that
    claim no longer blocks using it. Turn detection is still driven by the STT
    (`turn_detection="stt"`) — the VAD is only used for the two jobs above.
    """
    global _VAD_SINGLETON
    if _VAD_SINGLETON is None:
        try:
            _VAD_SINGLETON = silero.VAD.load()
            logger.info("vad_loaded", provider="silero",
                        purpose="stream_adapter_and_barge_in", source="STT")
        except Exception as exc:  # noqa: BLE001
            logger.error("vad_load_failed", error=str(exc)[:200], source="STT")
            _VAD_SINGLETON = False      # remember the failure, stop retrying
    return _VAD_SINGLETON or None


def _build_selected_stt(prof_stt: str, profile: dict,
                        tenant_keys: dict[str, str]) -> tuple[Any, str, str]:
    """Build the STT the operator actually selected.

    Returns (stt_or_None, credential_source, reason_if_unavailable). Deepgram is
    deliberately NOT handled here: it stays inline in _build_session as the
    default and the fallback, so this function can never affect a Deepgram call.

    Every provider here accepts a per-call credential, so a tenant's own key is
    used when they have stored one.
    """
    d = provider_registry.get(prof_stt, "STT")
    if d is None:
        return None, "", f"{prof_stt} is not a provider this build knows about"
    if not d.integrated:
        return None, "", f"no adapter exists for {d.name}"

    credential, source = provider_credentials.resolve(prof_stt, "STT", tenant_keys)
    if not credential:
        return None, "", (f"no credential for {d.name} — add one on the API keys "
                          f"page or set {d.credential_env}")

    try:
        cred_kwargs = provider_credentials.kwargs_for(prof_stt, credential)
    except ValueError as exc:
        return None, source, str(exc)

    lang = (profile.get("stt_language") or config.STT_LANGUAGE or "").strip()
    model = (profile.get("stt_model") or "").strip()
    engine: Any = None

    if prof_stt == "sarvam" and _sarvam is not None:
        # VERIFIED on real audio: saaras:v4 + codemix returns correct Tamil
        # script AND keeps English/brand tokens in Latin, which is what a
        # Tanglish caller actually says. Deepgram returns Devanagari for Tamil.
        engine = _sarvam.STT(language="unknown", model=model or config.SARVAM_STT_MODEL,
                             mode=config.SARVAM_STT_MODE, sample_rate=16000,
                             **cred_kwargs)
    elif prof_stt == "google" and _gp is not None:
        engine = getattr(_gp, "STT")(
            model=model or "latest_long",
            languages=[lang or "en-US"], interim_results=True, **cred_kwargs)
    elif prof_stt == "cartesia" and _cartesia is not None:
        engine = _cartesia.STT(model=model or "ink-whisper", **cred_kwargs)
    elif prof_stt == "openai" and _openai_plugin is not None:
        engine = _openai_plugin.STT(model=model or "gpt-4o-mini-transcribe",
                                    language=lang or "en", **cred_kwargs)
    elif prof_stt == "elevenlabs" and _elevenlabs is not None:
        engine = _elevenlabs.STT(model=model or "scribe_v1", **cred_kwargs)
    else:
        return None, source, f"the {d.name} plugin is not installed in this worker"

    # A non-streaming STT cannot drive a live call on its own: LiveKit needs a
    # VAD to decide where one utterance ends. Wrap it, or refuse honestly.
    if d.needs_vad:
        if _STTStreamAdapter is None:
            return None, source, (f"{d.name} is not a streaming API and this build has "
                                  "no StreamAdapter to wrap it")
        vad = _shared_vad()
        if vad is None:
            return None, source, (f"{d.name} is not a streaming API and the VAD needed "
                                  "to segment audio failed to load")
        engine = _STTStreamAdapter(stt=engine, vad=vad)
        logger.info("stt_stream_adapter_attached", provider=prof_stt,
                    reason="provider has no streaming API; audio is segmented by VAD",
                    impact="transcripts arrive only after the caller pauses",
                    source="STT")

    logger.info("stt_provider_initialized", provider=prof_stt,
                model=model or "(plugin default)", language=lang or "(plugin default)",
                credential_source=source, streaming=d.streaming,
                emits_interim=d.emits_interim, wrapped_in_vad=d.needs_vad,
                plugin_adapter=d.adapter, source="STT")
    return engine, source, ""


def _build_session(tools: list, system_prompt: str, profile: dict | None = None,
                   route: "llm_routing.LlmRoute | None" = None,
                   tenant_keys: dict[str, str] | None = None) -> AgentSession:
    """
    Build AgentSession with Gemini Live (default) or pipeline fallback.

    Silence-prevention config (mandatory for Gemini Live):
    1. SessionResumptionConfig(transparent=True) → auto-reconnect after timeout
    2. ContextWindowCompressionConfig → sliding window prevents token-limit freeze
    3. RealtimeInputConfig(END_SENSITIVITY_LOW) → 2s silence threshold

    EndSensitivity MUST use full string form: END_SENSITIVITY_LOW (not .LOW).
    """
    profile = profile or {}
    # `realtime_model` is agent_profiles.model — a Gemini REALTIME id. "model"
    # is the PIPELINE chat model and is not interchangeable with it.
    gemini_model = (profile.get("realtime_model")
                    or os.getenv("GEMINI_MODEL", config.GEMINI_MODEL))
    gemini_voice = profile.get("voice") or os.getenv("GEMINI_TTS_VOICE", config.GEMINI_TTS_VOICE)
    use_realtime = config.USE_GEMINI_REALTIME

    RealtimeClass = _google_realtime or (_google_beta_realtime if use_realtime else None)

    # Per-assistant call-accuracy knobs (see Assistant model). Each profile
    # passed to _build_session is a dict that may include these — read with
    # safe defaults so legacy assistants (no fields populated) still work.
    sensitivity = (profile.get("end_of_speech_sensitivity") or "LOW").upper()
    silence_ms_map = {"LOW": 2000, "MEDIUM": 1000, "HIGH": 400}
    silence_ms = silence_ms_map.get(sensitivity, 2000)
    prefix_padding_ms = int(profile.get("min_pause_ms") or 200)

    if use_realtime and RealtimeClass is not None:
        logger.info(
            "session_mode_realtime",
            model=gemini_model,
            voice=gemini_voice,
            sensitivity=sensitivity,
            silence_ms=silence_ms,
        )
        try:
            from google.genai import types as _gt
            sensitivity_enum = {
                "LOW": _gt.EndSensitivity.END_SENSITIVITY_LOW,
                "MEDIUM": _gt.EndSensitivity.END_SENSITIVITY_LOW,  # SDK only exposes LOW/HIGH
                "HIGH": _gt.EndSensitivity.END_SENSITIVITY_HIGH,
            }.get(sensitivity, _gt.EndSensitivity.END_SENSITIVITY_LOW)
            realtime_input_cfg = _gt.RealtimeInputConfig(
                automatic_activity_detection=_gt.AutomaticActivityDetection(
                    end_of_speech_sensitivity=sensitivity_enum,
                    silence_duration_ms=silence_ms,
                    prefix_padding_ms=prefix_padding_ms,
                ),
            )
            session_resumption_cfg = _gt.SessionResumptionConfig(transparent=True)
            ctx_compression_cfg = _gt.ContextWindowCompressionConfig(
                trigger_tokens=25600,
                sliding_window=_gt.SlidingWindow(target_tokens=12800),
            )
        except Exception as cfg_err:
            logger.error("silence_prevention_config_failed", error=str(cfg_err))
            try:
                import sentry_sdk
                sentry_sdk.capture_exception(cfg_err)
            except Exception:
                pass
            realtime_input_cfg = None
            session_resumption_cfg = None
            ctx_compression_cfg = None

        kwargs: dict[str, Any] = dict(
            model=gemini_model,
            voice=gemini_voice,
            instructions=system_prompt,
        )
        if realtime_input_cfg is not None:
            kwargs["realtime_input_config"]      = realtime_input_cfg
            kwargs["session_resumption"]         = session_resumption_cfg
            kwargs["context_window_compression"] = ctx_compression_cfg

        rt_session = AgentSession(llm=RealtimeClass(**kwargs), tools=tools)
        # Realtime (Gemini Live) handles language internally — no per-turn TTS routing.
        rt_session._jj_pipeline = False      # type: ignore[attr-defined]
        rt_session._jj_tts = None            # type: ignore[attr-defined]
        rt_session._jj_tts_provider = ""     # type: ignore[attr-defined]
        return rt_session

    # ── Pipeline fallback (Deepgram STT → OpenAI/Groq/Claude LLM → Sarvam/ElevenLabs/Cartesia TTS)
    logger.info("session_mode_pipeline")

    stt = None
    _tenant_keys = tenant_keys or {}
    # Which STT the operator chose. Deepgram remains the default and the
    # fallback; any other selection is built by _build_selected_stt, which uses
    # this tenant's own credential when they have stored one.
    prof_stt = (profile.get("stt_provider") or "deepgram").lower()
    # Tracks what is ACTUALLY used, so billing and logs never report the
    # selection when a fallback happened.
    stt_provider_actual = ""
    stt_credential_source = ""

    if prof_stt != "deepgram":
        try:
            stt, stt_credential_source, _why = _build_selected_stt(
                prof_stt, profile, _tenant_keys)
        except Exception as exc:  # noqa: BLE001 - never fail the call on a build error
            stt, stt_credential_source, _why = None, "", f"{type(exc).__name__}: {exc}"
            logger.error("stt_initialization_failed", provider=prof_stt,
                         error=str(exc)[:200], source="STT")
        if stt is not None:
            stt_provider_actual = prof_stt
        else:
            # Say exactly why, and exactly what will be used instead. The old
            # code reported a generic "not configured" for every cause.
            logger.warning("stt_provider_unavailable", requested=prof_stt,
                           used="deepgram", reason=_why, source="STT")

    if stt is None and _deepgram_stt is not None:
        stt_provider_actual = "deepgram"
        if prof_stt != "deepgram":
            logger.info("stt_provider_fallback", requested=prof_stt, used="deepgram",
                        reason="selected provider unavailable or failed to build", source="STT")
        # Keyterm prompting (nova-3) biases recognition toward the words this
        # assistant actually hears, so "Tamil" stops becoming "a meal" and the
        # business vocabulary is transcribed correctly.
        _keyterms = [
            "Tamil", "Tanglish", "appointment", "booking", "book",
            "morning", "evening", "slot", "VIMS", "VIMS Enterprise",
            "software", "website", "content creation", "Priya",
        ]
        _stt_kwargs = dict(
            model=config.STT_MODEL,
            language=config.STT_LANGUAGE,
            interim_results=True,
            # endpointing_ms/utterance_end_ms make Deepgram emit reliable end-of-turn
            # signals so STT-based turn detection (below) can finalize turns without
            # depending on the slow default VAD. 25ms (the plugin default) is too
            # aggressive and fragments turns.
            endpointing_ms=config.STT_ENDPOINTING_MS,
            utterance_end_ms=config.STT_UTTERANCE_END_MS,
        )
        try:
            # Keyterm prompting is a nova-3 ENGLISH-ONLY feature. Sending keyterms
            # with a non-English language (e.g. language=ta) makes Deepgram reject
            # the STREAM with 400 "Invalid response status" at websocket connect —
            # which the build-time try/except below cannot catch, so the STT then
            # dies and the AgentSession closes → total silence. Only attach
            # keyterms ONLY for a PURE monolingual English language. `language=multi`
            # is MULTILINGUAL — attaching English-only keyterms to it makes Deepgram
            # reject the stream with HTTP 400 at websocket connect exactly like a
            # non-English monolingual lang does. (This is the proven current 400:
            # STT_LANGUAGE=multi + keyterms.) "multi" is therefore NOT in this set.
            _stt_lang = (config.STT_LANGUAGE or "").lower()
            _keyterms_ok = _stt_lang in ("en", "en-us", "en-in", "en-gb")
            _keyterms_attached = 0
            if _keyterms_ok:
                try:
                    stt = _deepgram_stt(keyterm=_keyterms, **_stt_kwargs)
                    _keyterms_attached = len(_keyterms)
                except Exception as kt_exc:
                    logger.warning("stt_keyterm_unsupported", error=str(kt_exc))
                    stt = _deepgram_stt(**_stt_kwargs)
            else:
                # multi / non-English → minimal config, NO keyterms/keywords (they
                # 400 the stream). Add optional params back only after multi streams.
                stt = _deepgram_stt(**_stt_kwargs)
            # Log the EXACT effective streaming config (no secrets) so a 400 is
            # diagnosable from Live Logs alone (req A1 stt_runtime_config).
            logger.info(
                "stt_runtime_config", provider="deepgram", model=config.STT_MODEL,
                language=config.STT_LANGUAGE, detect_language=False,
                kterm_count=_keyterms_attached, kword_count=0, punctuate=True,
                smart_format=False, interim_results=True,
                endpointing_ms=config.STT_ENDPOINTING_MS,
                utterance_end_ms=config.STT_UTTERANCE_END_MS,
                sample_rate=16000, channels=1, encoding="linear16",
                # Remaining plugin defaults that ALSO go into the Deepgram
                # websocket query string — logged so the full effective config is
                # visible without reading the plugin source.
                no_delay=True, vad_events=True, filler_words=True,
                numerals=False, profanity_filter=False, mip_opt_out=False,
                plugin="livekit-plugins-deepgram-1.8.4",
                kterm_skip_reason=(None if _keyterms_ok else "multilingual_or_non_english_lang"),
                source="STT")
            logger.info("stt_provider_initialized", provider="deepgram",
                        model=config.STT_MODEL, language=config.STT_LANGUAGE,
                        kterm_count=_keyterms_attached)
        except Exception as exc:
            # FAIL SAFE (req 13): a provider-config error must NOT kill the whole
            # job. First retry with the minimal kwargs (drop endpointing/keyterms
            # — those are the options most likely to be rejected). If even that
            # fails, degrade to stt=None so the session still STARTS: the greeting
            # (TTS) plays, the caller is not met with a dead line, and the failure
            # is visible in Live Logs instead of a silent crash.
            logger.error("stt_initialization_failed", provider="deepgram", error=str(exc),
                         phase="full_kwargs")
            try:
                stt = _deepgram_stt(model=config.STT_MODEL, language=config.STT_LANGUAGE)
                logger.warning("stt_provider_degraded", provider="deepgram",
                               model=config.STT_MODEL, language=config.STT_LANGUAGE,
                               reason="rebuilt_without_endpointing_keyterms")
            except Exception as exc2:
                stt = None
                logger.error("stt_initialization_failed", provider="deepgram", error=str(exc2),
                             phase="minimal_kwargs", degraded="session_without_stt",
                             impact="caller can hear agent (TTS) but speech is not transcribed")
    if stt is None:
        logger.error("stt_initialization_failed", provider="none",
                     error="no STT provider could be built",
                     degraded="session_without_stt",
                     impact="caller can hear agent (TTS) but speech is not transcribed",
                     source="STT")

    # Provider selection is the source of truth — resolve once, reuse here.
    llm_obj = _build_pipeline_llm(route or llm_routing.resolve_route(profile))

    # ── TTS: PRIMARY = Gemini TTS (GOOGLE_API_KEY); Sarvam only an OPTIONAL
    # fallback (never required). A FallbackAdapter wraps primary+backup so a
    # mid-synthesis failure fails over instead of leaving the caller silent.
    primary_tts = None
    actual_tts_provider = ""
    tts_provider = (profile.get("tts_provider") or config.DEFAULT_TTS_PROVIDER).lower()
    # Refuse a selection this deployment cannot actually serve, and SAY SO.
    # Previously: "deepgram" matched no branch and fell through to Gemini (silent
    # substitution), while elevenlabs/cartesia/openai raised mid-build and failed
    # the whole call because their credential was missing.
    _tts_def = provider_registry.get(tts_provider, "TTS")
    if _tts_def is None or not _tts_def.integrated or not provider_registry.is_configured(_tts_def, _tenant_keys):
        logger.warning("tts_provider_unavailable", requested=tts_provider,
                       reason=("unknown provider" if _tts_def is None
                               else "no adapter for this provider" if not _tts_def.integrated
                               else (f"no credential — add one on the API keys page "
                                     f"or set {_tts_def.credential_env}")),
                       impact="falling back to the default voice provider",
                       source="TTS")
        tts_provider = ""        # skip straight to the recovery chain below

    # This tenant's own key when they have one, else the server's. Returned as
    # kwargs so each plugin gets the argument shape it expects.
    def _tts_cred(pid: str) -> dict:
        cred, src = provider_credentials.resolve(pid, "TTS", _tenant_keys)
        if not cred:
            return {}
        logger.info("tts_credential_source", provider=pid, credential_source=src,
                    source="TTS")
        return provider_credentials.kwargs_for(pid, cred)

    try:
        if tts_provider in ("gemini", "google-gemini", "gemini-tts"):
            primary_tts, actual_tts_provider = _build_gemini_tts(profile)
        elif tts_provider == "sarvam":
            primary_tts = _build_sarvam_tts(profile)
            actual_tts_provider = "sarvam" if primary_tts else ""
        elif tts_provider == "deepgram":
            # Returns (tts, provider), unlike the single-value builders.
            primary_tts, actual_tts_provider = _build_deepgram_tts()
        elif tts_provider == "elevenlabs" and _elevenlabs is not None:
            primary_tts = _elevenlabs.TTS(
                model="eleven_turbo_v2_5",
                voice_id=provider_registry.coerce_voice("elevenlabs", profile.get("voice") or ""),
                **_tts_cred("elevenlabs"))
            actual_tts_provider = "elevenlabs"
        elif tts_provider == "cartesia" and _cartesia is not None:
            primary_tts = _cartesia.TTS(
                model=config.CARTESIA_MODEL,
                voice=provider_registry.coerce_voice("cartesia", profile.get("voice") or ""),
                **_tts_cred("cartesia"))
            actual_tts_provider = "cartesia"
        elif tts_provider == "openai" and _openai_plugin is not None:
            primary_tts = _openai_plugin.TTS(
                model="tts-1",
                voice=provider_registry.coerce_voice("openai", profile.get("voice") or ""),
                **_tts_cred("openai"))
            actual_tts_provider = "openai"
        elif tts_provider == "rumik" and _rumik is not None:
            # mulberry takes a named preset speaker; muga is tone-driven and has
            # no speaker, so the voice is only sent for mulberry.
            _rk_model = (profile.get("tts_model") or "mulberry").strip().lower()
            _rk_kwargs: dict[str, Any] = {"model": _rk_model, **_tts_cred("rumik")}
            if _rk_model == "mulberry":
                _rk_kwargs["speaker"] = provider_registry.coerce_voice(
                    "rumik", profile.get("voice") or "")
            primary_tts = _rumik.TTS(**_rk_kwargs)
            actual_tts_provider = "rumik"
        elif tts_provider == "murf" and _murf is not None:
            _mf_voice = provider_registry.coerce_voice("murf", profile.get("voice") or "")
            primary_tts = _murf.TTS(
                model=(profile.get("tts_model") or "FALCON").strip().upper(),
                voice=_mf_voice,
                # Murf derives the locale from the voice id prefix (en-IN-..,
                # ta-IN-..), so keep them consistent or it speaks the wrong accent.
                locale="-".join(_mf_voice.split("-")[:2]) if _mf_voice.count("-") >= 2 else "en-US",
                **_tts_cred("murf"))
            actual_tts_provider = "murf"
    except Exception as exc:
        # A provider that cannot construct must not take the call down with it.
        primary_tts, actual_tts_provider = None, ""
        logger.error("tts_build_failed", provider=tts_provider, error=str(exc)[:200],
                     impact="falling back to the default voice provider", source="TTS")

    # Default / recovery chain when nothing matched: Gemini → Sarvam → OpenAI.
    if primary_tts is None:
        primary_tts, actual_tts_provider = _build_gemini_tts(profile)
    if primary_tts is None:
        primary_tts = _build_sarvam_tts(profile)
        if primary_tts:
            actual_tts_provider = "sarvam"
    if primary_tts is None and _openai_plugin is not None:
        primary_tts = _openai_plugin.TTS(model="tts-1", voice=profile.get("voice", "alloy"))
        actual_tts_provider = "openai"

    # Never-silent backup = a HEALTHY fallback TTS (Deepgram Aura by default;
    # Sarvam excluded while 402). FallbackAdapter with max_retry_per_tts=0 fails
    # FAST: a Gemini 429 / primary error flips to the backup immediately instead
    # of multi-second retry dead-air.
    backup_tts, backup_provider = _build_fallback_tts(profile, actual_tts_provider)
    if backup_tts is not None:
        logger.info("tts_language_route", language=(lang.normalize_lang(config.STT_LANGUAGE) or "en"),
                    primary=actual_tts_provider, fallback=backup_provider,
                    reason="healthy_language_safe_fallback", source="TTS")
    tts = primary_tts
    if primary_tts is not None and backup_tts is not None and _TTSFallbackAdapter is not None:
        try:
            tts = _TTSFallbackAdapter(tts=[primary_tts, backup_tts],
                                      max_retry_per_tts=config.TTS_MAX_RETRY_PER_TTS)
            logger.info("tts_fallback_enabled", primary=actual_tts_provider, backup=backup_provider,
                        max_retry_per_tts=config.TTS_MAX_RETRY_PER_TTS, source="TTS")
        except Exception as exc:
            logger.warning("tts_fallback_adapter_failed", error=str(exc))
            tts = primary_tts
    elif backup_tts is None:
        logger.info("tts_fallback_none", primary=actual_tts_provider,
                    reason="no healthy fallback TTS configured/available", source="TTS")

    if primary_tts is not None:
        _tts_model = (config.GEMINI_TTS_MODEL if actual_tts_provider == "gemini"
                      else config.SARVAM_MODEL if actual_tts_provider == "sarvam" else "")
        _tts_voice = (_valid_gemini_voice(profile.get("voice")) if actual_tts_provider == "gemini"
                      else profile.get("voice"))
        logger.info("tts_primary_configured", provider=actual_tts_provider, model=_tts_model,
                    voice=_tts_voice, fallback=(backup_provider or "none"),
                    source="WORKER")
    else:
        logger.error("tts_initialization_failed", requested=tts_provider,
                     error="no TTS provider could be initialized", source="TTS")

    if llm_obj is None:
        raise RuntimeError(
            "No LLM available. Set GROQ_API_KEY (primary) or GOOGLE_API_KEY/OPENAI_API_KEY, "
            "or enable Gemini realtime (USE_GEMINI_REALTIME=true with GOOGLE_API_KEY)."
        )

    # turn_detection="stt": drive end-of-turn from Deepgram's endpointing rather
    # than the auto-loaded default Silero VAD, which runs slower than realtime on
    # this host and was preventing turns from finalizing (so no reply was ever
    # generated). Deepgram is a streaming STT with endpointing, so this is the
    # correct mode here. min_endpointing_delay keeps replies snappy.
    # Fail FAST on an LLM error (esp. Groq 429). The framework default retries 3x
    # (~4s of stacked retries); on a rate-limited window every retry 429s again,
    # so it just freezes the turn for seconds and can later play a stale reply
    # that answers an older question. max_retry=1 with a 0.5s interval gives one
    # quick retry for a genuine transient blip, then fails within <1s so the error
    # handler can speak a short local recovery line and the next (latest) user
    # turn wins. STT/TTS keep the framework defaults.
    _llm_conn = APIConnectOptions(max_retry=1, retry_interval=0.5, timeout=8.0)

    # ── Barge-in on an STT that emits no interim transcripts ─────────────────
    # Interruption needs evidence the caller has started talking. With
    # min_interruption_words=1 that evidence is a transcript, so on Deepgram
    # (which streams interims mid-utterance) barge-in fires while the caller is
    # still speaking. MEASURED 2026-10-13: Sarvam emits ONLY finals, 402-654ms
    # after speech ends, so transcript-only barge-in would make the agent talk
    # over the caller for the whole utterance.
    #
    # Attaching a VAD gives the session a speech signal independent of
    # transcripts, restoring mid-utterance interruption. Only attached when the
    # selected STT genuinely emits no interims, so Deepgram's existing timing is
    # untouched. turn_detection stays "stt" either way — this does not change
    # who decides a turn has ENDED.
    _session_kwargs: dict[str, Any] = {}
    _stt_def_used = provider_registry.get(stt_provider_actual, "STT")
    if stt_provider_actual and _stt_def_used and not _stt_def_used.emits_interim:
        _bargein_vad = _shared_vad()
        if _bargein_vad is not None:
            _session_kwargs["vad"] = _bargein_vad
            logger.info("bargein_vad_attached", stt_provider=stt_provider_actual,
                        reason="selected STT emits no interim transcripts",
                        effect="interruption detected from speech onset rather than "
                               "waiting for the final transcript",
                        turn_detection="stt", source="STT")
        else:
            logger.warning("bargein_degraded", stt_provider=stt_provider_actual,
                           reason="no interim transcripts and VAD unavailable",
                           impact="interruption only after the caller stops speaking",
                           source="STT")

    session = AgentSession(
        stt=stt, llm=llm_obj, tts=tts, tools=tools, **_session_kwargs,
        conn_options=SessionConnectOptions(llm_conn_options=_llm_conn),
        turn_detection="stt",
        # Start generating the reply the instant a transcript is available, in
        # parallel with the end-of-turn endpointing wait, instead of after it.
        # This removes a large chunk of the "user stops → AI starts" gap; a newer
        # user turn discards the speculative generation (latest turn wins).
        preemptive_generation=True,
        min_endpointing_delay=config.MIN_ENDPOINTING_DELAY,
        # Barge-in tuning (balanced). SDK defaults (min_duration=0.5s, min_words=0)
        # let any blip interrupt; we previously over-corrected to 0.8s/2 words,
        # which stopped genuine 1-word barge-ins ("Wait", "No", "Stop") from ever
        # interrupting. 0.5s + 1 real recognised word lets a short genuine
        # interruption cut in within ~0.5s while a sub-0.5s echo/VAD blip (or a
        # zero-word noise burst) still cannot. On a real interruption LiveKit
        # cancels the current TTS and the user's full utterance becomes the next
        # turn, so the interrupting sentence is not lost.
        min_interruption_duration=0.5,
        min_interruption_words=1,
    )
    # Expose the pipeline TTS so the entrypoint can switch its language per turn
    # (multilingual routing). Realtime mode handles language internally.
    session._jj_pipeline = True          # type: ignore[attr-defined]
    # Expose the RAW primary TTS (not the FallbackAdapter) so per-turn language
    # routing can call update_options on it where the provider needs it.
    session._jj_tts = primary_tts        # type: ignore[attr-defined]
    session._jj_tts_provider = actual_tts_provider  # type: ignore[attr-defined]
    # The STT that was ACTUALLY built, and whose credential paid for it. Billing
    # used to infer this from whether the Deepgram module had imported, so a
    # Sarvam call was always billed to Deepgram.
    session._jj_stt_provider = stt_provider_actual          # type: ignore[attr-defined]
    session._jj_stt_credential_source = stt_credential_source  # type: ignore[attr-defined]
    return session


# Max chat-context items (user/assistant/tool messages) re-sent to the LLM each
# turn. The system prompt is preserved separately by ChatContext.truncate(), so
# this bounds ONLY the rolling conversation history. Groq free tier is ~7000
# input-tokens/min (ITPM); history grows ~1 user+1 assistant item per turn, so an
# unbounded context makes every later request re-send the whole transcript and
# blows ITPM mid-call → 429. 6 items ≈ the last ~3 exchanges, which (with a
# compact system prompt + minimal tools) keeps TOTAL per-request input near
# 700–900 tokens — low enough that a normal multi-turn call stays under ITPM.
MAX_HISTORY_ITEMS = 6


def _count_tool_tokens(tool_list: list) -> int:
    """Approximate the input tokens the tool JSON schemas add to EVERY Groq
    request (they are re-sent on every turn). Uses the same strict-OpenAI schema
    the plugin sends, so the count reflects the real wire cost."""
    try:
        from livekit.agents.llm.utils import build_strict_openai_schema
    except Exception:
        return 0
    total = 0
    for t in tool_list or []:
        try:
            schema = build_strict_openai_schema(t)
            total += count_tokens(json.dumps(schema))
        except Exception:
            # Raw/custom tools or anything that won't serialise — skip, don't fail.
            continue
    return total


class BoundedAgent(Agent):
    """Agent that (1) trims conversation history to the last MAX_HISTORY_ITEMS
    before each LLM turn so per-request input tokens stay flat, and (2) logs the
    REAL total input-token breakdown per turn (not just the system prompt) so we
    can see exactly what Groq receives and why ITPM (429) is or isn't hit."""

    def __init__(self, *args: Any, tool_tokens: int = 0,
                 business_context_tokens: int = 0,
                 fallback_llm: Any = None, fallback_label: str | None = None,
                 llm_route: "llm_routing.LlmRoute | None" = None,
                 assistant_id: str | None = None,
                 room_id: str = "", lang_state: Any = None, call_state: Any = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._tool_tokens = tool_tokens
        self._business_context_tokens = business_context_tokens
        self._fallback_llm = fallback_llm
        self._fallback_label = fallback_label
        self._room_id = room_id
        self._lang_state = lang_state  # persistent conversation language
        self._call_state = call_state  # deterministic structured CallState
        self._llm_turn = 0
        # The routing decision for this call (selected/primary/fallback provider
        # + model). Also where the ACTUAL provider used per turn is recorded, so
        # billing never has to guess from a model name.
        self._route = llm_route or llm_routing.resolve_route(None)
        # Website knowledge is per assistant; without this id nothing is retrieved.
        self._assistant_id = assistant_id
        # Primary-provider 429 cooldown (call-level). While active the PRIMARY is
        # skipped and turns go straight to the fallback — which, by default, is a
        # different model on the SAME provider.
        # provider/model label -> monotonic deadline. Separate buckets, because
        # the primary and the fallback are different models and Groq rate-limits
        # per model; one being limited says nothing about the other, and BOTH
        # being limited means there is nothing worth sending at all.
        self._model_cooldown: dict[str, float] = {}
        # (monotonic, input_tokens) for the last 60s — the ITPM warning above.
        self._itpm_window: list[tuple[float, int]] = []
        # Rolling 60s input-token spend PER MODEL, for admission control.
        # Groq meters tokens-per-minute per model, and the primary and the
        # fallback are different models with separate buckets. Trying the
        # primary first on every turn spends one bucket while the other sits
        # idle, so the usable budget was 8K rather than the 16K actually
        # available — and the fallback only ever engaged AFTER a 429 had
        # already cost the caller a turn.
        self._model_spend: dict[str, list[tuple[float, int]]] = {}
        # Size of the most recent request's context, measured in
        # on_user_turn_completed. Used to predict the next turn's cost.
        self._last_ctx_tokens: int = 0
        # Precise per-turn LLM timing (monotonic s), read by the latency
        # breakdown: when the LLM node started and when the FIRST spoken token
        # (first released chunk) was produced — the real first-token signal.
        self._turn_timing: dict = {"llm_start": 0.0, "first_token": 0.0}
        # Consecutive all-providers-failed turns, to avoid repeating the same
        # repair line when every provider is genuinely down.
        self._consec_recovery = 0

    def _recovery_line(self) -> str:
        """A natural conversational REPAIR line (not an infrastructure error),
        spoken ONLY when every provider failed. Varies on a repeat so the caller
        never hears the same sentence twice in a row."""
        active = getattr(self._lang_state, "active", "en") if self._lang_state else "en"
        repeat = self._consec_recovery > 1
        if active == "ta":
            return ("சொல்லுங்க, நான் இன்னும் கேட்டுக்கிட்டு இருக்கேன்."
                    if repeat else
                    "Sorry, last-a சொன்னது miss ஆயிடுச்சு. இன்னொரு முறை சொல்லுங்க?")
        return ("Please go ahead, I'm still listening."
                if repeat else
                "Sorry, I missed that. Could you say it once more?")

    async def _knowledge_context(self, chat_ctx: Any) -> str:
        """Grounding block for the caller's latest question, or "".

        Only the chunks that clear the similarity floor are injected — never the
        whole site — so the prompt stays small and the model sees only material
        that actually relates to what was asked.
        """
        if not self._assistant_id:
            return ""
        try:
            latest = ""
            for item in reversed(list(getattr(chat_ctx, "items", []) or [])):
                if str(getattr(item, "role", "")).lower() == "user":
                    c = getattr(item, "content", "")
                    latest = " ".join(c) if isinstance(c, list) else str(c)
                    break
            if not latest.strip():
                return ""
            # TIME-BOUNDED. This runs inside llm_node BEFORE the LLM is called,
            # so an unbounded wait here means the caller hears nothing at all.
            # Measured on this host: a warm lookup is ~130 ms, but the FIRST one
            # of the process pays the embedder load (~4.1 s load, 6.4 s total)
            # and that cost landed inside the caller's first question. Worse, a
            # repeated "Hello?" cancels this node and the next turn starts the
            # wait again, so the agent could never reach the LLM.
            #
            # Budget 2.0 s: measured steady state is ~130 ms and the first
            # pgvector query of the process ~1.1 s, so real context is kept;
            # meanwhile the LLM always starts long before the 5 s dead-air
            # threshold. A cold or stalled embedder costs one turn's knowledge
            # rather than the whole conversation.
            _kb_t0 = time.monotonic()
            hits = await asyncio.wait_for(
                knowledge.search(self._assistant_id, latest.strip(), top_k=4),
                timeout=float(os.getenv("KNOWLEDGE_LOOKUP_TIMEOUT_S", "2.0")),
            )
            # Timed explicitly. Without this the knowledge stage is invisible: it
            # runs before llm_start is stamped, so its cost hides inside
            # turn_latency_breakdown's stt_final_to_llm_start_ms and a slow
            # lookup looks like a generic LLM-dispatch delay.
            logger.info("knowledge_lookup_done",
                        ms=int((time.monotonic() - _kb_t0) * 1000),
                        hits=len(hits) if hits else 0,
                        call_id=self._room_id, source="KNOWLEDGE")
            if not hits:
                # Nothing relevant: tell the model so, rather than leaving it to
                # fill the silence with invention.
                return ("[BUSINESS INFORMATION] Nothing in the saved business "
                        "information covers this question. Say you don't have that "
                        "confirmed and offer to connect them or take details — "
                        "never guess specifics.")
            return knowledge.build_context(hits)
        except (TimeoutError, asyncio.TimeoutError):
            # Logged distinctly (not as a generic failure) because this is the
            # one that silences a turn: the LLM still runs, just without
            # business context for this question.
            logger.warning("knowledge_lookup_timeout",
                           timeout_s=float(os.getenv("KNOWLEDGE_LOOKUP_TIMEOUT_S", "2.0")),
                           impact="turn proceeds to the LLM without business context",
                           call_id=self._room_id, source="KNOWLEDGE")
            return ""
        except Exception as exc:
            logger.warning("knowledge_context_failed", error=str(exc)[:200],
                           call_id=self._room_id, source="KNOWLEDGE")
            return ""

    def _apply_language_directive(self, chat_ctx: Any) -> Any:
        """Append a system directive pinning the reply to the persistent
        conversation language. Runs for EVERY generation in this node (primary,
        retry, fallback), so the language survives fallback/retry/tool turns
        (rule 10). Returns a COPY of chat_ctx so the shared history is untouched."""
        st = self._lang_state
        directive = lang.llm_language_directive(getattr(st, "active", "en")) if (st and getattr(st, "established", False)) else None
        # Deterministic structured memory (Step B): survives history truncation,
        # carries confirmed tool facts + known slots + pending question so the
        # model never re-asks and never contradicts a confirmed fact.
        state_line = None
        if self._call_state is not None:
            try:
                state_line = self._call_state.to_directive()
            except Exception:
                state_line = None
        if not directive and not state_line:
            return chat_ctx
        try:
            ctx2 = chat_ctx.copy()
            if state_line:
                ctx2.add_message(role="system", content=state_line)
            if directive:
                ctx2.add_message(role="system", content=directive)
            return ctx2
        except Exception:
            return chat_ctx

    async def tts_node(self, text, model_settings):  # type: ignore[override]
        """Per-turn TTS observability (req 10).

        Tees the text stream so we log the EXACT string handed to the provider,
        times first-audio and completion, and records the language/voice actually
        used. Pure instrumentation — the audio stream itself is untouched and any
        provider error is re-raised so the existing failover still runs.
        """
        t0 = time.monotonic()
        parts: list[str] = []
        first_audio_ms: int | None = None
        frames = 0

        async def _tee():
            async for chunk in text:
                parts.append(chunk)
                yield chunk

        base = self._lang() if hasattr(self, "_lang") else ""
        # The resolved provider lives on the session (set in _build_session).
        _sess = getattr(self, "session", None)
        prov = getattr(_sess, "_jj_tts_provider", "") or config.DEFAULT_TTS_PROVIDER
        route = lang.tts_route(base, prov) if base else None
        info = dict(
            detected_language=base or "unknown",
            language_code=(route or {}).get("lang") or config.SARVAM_LANGUAGE,
            provider=prov,
            model=config.SARVAM_MODEL if prov == "sarvam" else config.GEMINI_TTS_MODEL,
            speaker=config.SARVAM_SPEAKER if prov == "sarvam" else config.GEMINI_TTS_VOICE,
            source="TTS",
        )
        try:
            async for frame in Agent.default.tts_node(self, _tee(), model_settings):
                if first_audio_ms is None:
                    first_audio_ms = int((time.monotonic() - t0) * 1000)
                frames += 1
                # Tee the agent's own speech into the local recorder so the
                # recording contains BOTH sides. Never blocks or raises.
                _r = getattr(self, "_recorder", None)
                if _r is not None:
                    _r.write_agent_frame(frame)
                yield frame
        except asyncio.CancelledError:
            # A barge-in cancels this generator. CancelledError is a
            # BaseException, so without this branch NEITHER the error nor the
            # success log below ever ran — every interrupted turn produced no
            # tts_turn record at all, which is why TTS looked silent in the logs.
            logger.info(
                "tts_turn", result="cancelled",
                exact_text_sent_to_tts="".join(parts)[:500],
                tts_latency_ms=int((time.monotonic() - t0) * 1000),
                first_audio_ms=first_audio_ms, frames=frames, **info,
            )
            raise
        except Exception as exc:
            logger.warning(
                "tts_turn", result="error", error=str(exc)[:300],
                exact_text_sent_to_tts="".join(parts)[:500],
                tts_latency_ms=int((time.monotonic() - t0) * 1000),
                first_audio_ms=first_audio_ms, frames=frames, **info,
            )
            raise
        logger.info(
            "tts_turn", result="success",
            exact_text_sent_to_tts="".join(parts)[:500],
            tts_latency_ms=int((time.monotonic() - t0) * 1000),
            first_audio_ms=first_audio_ms, frames=frames, **info,
        )

    async def llm_node(  # type: ignore[override]
        self, chat_ctx: Any, tools: list, model_settings: Any
    ):
        """Streaming LLM router with fallback. The primary (Groq) is STREAMED
        straight to TTS so the first words are spoken as soon as they are
        generated (low latency — no waiting for the whole reply). Fallback only
        kicks in when the primary fails BEFORE any output (e.g. a 429, which Groq
        rejects at request time, so no partial was spoken) — then the fallback LLM
        streams instead. If the primary dies mid-stream (rare) we keep what was
        said and the next turn recovers; if everything fails, one short local line
        is spoken. A newer user turn cancels this node (CancelledError) so a stale
        reply is never finished — the latest question always wins."""
        self._llm_turn += 1
        turn_id = self._llm_turn
        rid = self._room_id
        # Pin the reply to the persistent conversation language for EVERY path
        # below (primary, retry, fallback) so language never drifts on a
        # fallback/retry/tool turn (rule 10).
        chat_ctx = self._apply_language_directive(chat_ctx)
        # Website knowledge for this specific question (empty when nothing fits).
        _kb = await self._knowledge_context(chat_ctx)
        if _kb:
            try:
                chat_ctx = chat_ctx.copy()
                chat_ctx.add_message(role="system", content=_kb)
            except Exception:
                pass
        # Reset per-turn LLM timing (first_token stamped on the first released chunk).
        self._turn_timing = {"llm_start": time.monotonic(), "first_token": 0.0}
        tool_choice = getattr(model_settings, "tool_choice", NOT_GIVEN) if model_settings else NOT_GIVEN
        # Fast-fail per attempt: WE own the fallback, so no framework retry here.
        # timeout is the CONNECT timeout — capped so a hung Groq connection fails
        # over to Gemini fast instead of stalling the turn up to 8s (Phase 8).
        conn = APIConnectOptions(max_retry=0, timeout=float(os.getenv("LLM_CONNECT_TIMEOUT", "4.0")))

        try:
            primary = self._get_activity_or_raise().llm
        except Exception:
            primary = None

        # Groq 429 cooldown: if a recent 429 marked Groq unavailable, SKIP it and
        # route this turn straight to the cross-provider fallback (no per-turn 429
        # round-trip). When the window elapses, Groq is tried again.
        now_mono = time.monotonic()
        primary_label = f"{self._route.primary_provider}/{self._route.primary_model}"
        groq_cooling = self._cooling(primary_label, now_mono, turn_id, rid)
        fallback_cooling = bool(
            self._fallback_label and self._cooling(self._fallback_label, now_mono, turn_id, rid)
        )

        # ── Admission control: pick the model that can actually afford it ───
        # Predict this turn from the last measured context (history grows a
        # little each turn, so this slightly under-estimates, which the 10%
        # margin inside _headroom covers).
        _pred = self._last_ctx_tokens or 3300
        _p_room = self._headroom(primary_label, _pred)
        _f_room = (self._headroom(self._fallback_label, _pred)
                   if self._fallback_label else -(1 << 30))
        # Prefer the primary — it is the operator's selected model — and step
        # aside only when it genuinely cannot afford this turn while the
        # fallback can. This is NOT a provider or model substitution: both are
        # already in the resolved route and the fallback served 31% of turns
        # reactively. Doing it BEFORE the 429 is what turns a failed turn into
        # an answered one.
        _prefer_fallback = (not groq_cooling and not fallback_cooling
                            and _p_room < 0 <= _f_room)
        if _prefer_fallback:
            logger.info(
                "llm_admission_routed", to=self._fallback_label,
                from_model=primary_label, predicted_tokens=_pred,
                primary_spend_60s=self._spend60(primary_label),
                fallback_spend_60s=self._spend60(self._fallback_label),
                budget_per_model=_LLM_ITPM_BUDGET,
                reason="primary has no token headroom this minute; fallback does",
                turn_id=turn_id, call_id=rid, room=rid, source="LLM")
            groq_cooling = True          # skip the primary for THIS turn only

        # BOTH models rate-limited: every request now is guaranteed to 429, so
        # send none. This is the turn-19 case from the 08:21 incident, where the
        # fallback had already 429'd five turns earlier and was still being
        # called on every turn. Skipping straight to the repair line also gets
        # the caller an answer sooner than two doomed round-trips would.
        if groq_cooling and fallback_cooling:
            resumes_in = max(0.0, min(self._model_cooldown.values()) - now_mono)
            logger.warning(
                "llm_all_models_cooling", primary=primary_label,
                fallback=self._fallback_label or "none",
                resumes_in_s=round(resumes_in, 1),
                impact="no provider request sent this turn; both models are rate-limited",
                turn_id=turn_id, call_id=rid, room=rid, source="LLM")
            self._consec_recovery += 1
            logger.error("llm_all_providers_failed", turn_id=turn_id, call_id=rid, room=rid,
                         language=self._lang(), consec=self._consec_recovery,
                         reason="both_models_cooling", source="LLM")
            logger.warning("llm_recovery_spoken", turn_id=turn_id, call_id=rid, room=rid,
                           source="LLM")
            yield self._recovery_line()
            return

        # Stamp the FIRST released chunk (the real caller-perceived first token)
        # whichever provider produces it — used by the latency breakdown.
        async def _stamp(gen: Any):  # noqa: ANN401
            async for c in gen:
                if not self._turn_timing["first_token"]:
                    self._turn_timing["first_token"] = time.monotonic()
                yield c

        # ── Primary (Groq), gated so a bare fragment is never spoken ──────────
        if primary is not None and not groq_cooling:
            self._record_spend(primary_label, _pred)
            logger.info("primary_llm_started", turn_id=turn_id, call_id=rid, room=rid,
                        provider=self._route.primary_provider, model=self._route.primary_model,
                        **self._route.log_fields(), language=self._lang(), source="LLM")
            r1: dict = {}
            async for c in _stamp(_stream_gated(primary, chat_ctx, tools, tool_choice, conn, r1)):
                yield c
            if r1["status"] == "ok":
                self._consec_recovery = 0
                self._route.record_use(self._route.primary_provider, self._route.primary_model)
                logger.info("llm_primary_completed", turn_id=turn_id, call_id=rid, room=rid,
                            provider=self._route.primary_provider,
                            model=self._route.primary_model,
                            actual_provider_used=self._route.primary_provider,
                            actual_model_used=self._route.primary_model,
                            language=self._lang(), source="LLM")
                return
            if r1["status"] == "error_after_output":
                # Tokens were generated and spoken, so this provider DID serve
                # (and bill for) the turn even though it failed afterwards.
                self._route.record_use(self._route.primary_provider, self._route.primary_model)
                et, sc = _classify_llm_error(r1.get("err"))
                if et == "rate_limit":
                    self._enter_model_cooldown(primary_label, now_mono, turn_id, rid,
                                               sc, r1.get("err"))
                logger.warning("primary_llm_failed", error_type=et, status_code=sc,
                               turn_id=turn_id, call_id=rid, room=rid, source="LLM",
                               detail="failed after partial already spoken")
                return  # can't cleanly swap mid-utterance
            # "fragment" or "error" → nothing was spoken; safe to retry/fall back.
            et, sc = (_classify_llm_error(r1["err"]) if r1.get("err") else ("incomplete_generation", None))
            logger.warning("primary_llm_failed", error_type=et, status_code=sc,
                           turn_id=turn_id, call_id=rid, room=rid, source="LLM",
                           detail=(str(r1.get("err"))[:200] if r1.get("err") else f"fragment:{r1.get('text','')[:40]!r}"))
            if et == "rate_limit":
                # HTTP 429 → rest THIS model for as long as it asked and go
                # straight to the fallback. Never retry it here (no 429 loop).
                self._enter_model_cooldown(primary_label, now_mono, turn_id, rid,
                                           sc, r1.get("err"))
            elif et in ("timeout", "server_error", "connection_error", "incomplete_generation"):
                # One quick retry on the primary for TRANSIENT (non-429) problems.
                logger.info("primary_llm_retry", error_type=et, turn_id=turn_id,
                            call_id=rid, room=rid, source="LLM")
                rr: dict = {}
                async for c in _stamp(_stream_gated(primary, chat_ctx, tools, tool_choice, conn, rr)):
                    yield c
                if rr["status"] == "ok":
                    self._consec_recovery = 0
                    self._route.record_use(self._route.primary_provider, self._route.primary_model)
                    return
                if rr["status"] == "error_after_output":
                    return
                rt, rsc = (_classify_llm_error(rr["err"]) if rr.get("err") else ("incomplete_generation", None))
                if rt == "rate_limit":
                    self._enter_model_cooldown(primary_label, now_mono, turn_id, rid,
                                               rsc, rr.get("err"))
        elif groq_cooling:
            # Skip Groq while cooling down — fall through to the fallback below.
            logger.info("llm_primary_skipped_cooldown", provider=self._route.primary_provider,
                        turn_id=turn_id,
                        call_id=rid, room=rid, source="LLM")
        else:
            logger.warning("primary_llm_failed", error_type="unavailable", status_code=None,
                           turn_id=turn_id, call_id=rid, room=rid, source="LLM")

        # ── Fallback model (Gemini) on the SAME latest turn (nothing spoken) ──
        # Gets the SAME chat_ctx (bounded history + language directive + tools),
        # so it has the full conversation/booking context and the locked language.
        if self._fallback_llm is not None and fallback_cooling:
            # Known rate-limited; sending would burn a round-trip to a certain 429.
            logger.info("llm_fallback_skipped_cooldown", provider=self._fallback_label,
                        turn_id=turn_id, call_id=rid, room=rid, source="LLM")
        elif self._fallback_llm is not None:
            logger.info("llm_provider_failover", **{"from": self._route.primary_provider},
                        to=self._fallback_label,
                        is_cross_provider=(self._route.fallback_provider
                                           != self._route.selected_provider),
                        reason=("cooldown" if groq_cooling else "primary_failed"),
                        turn_id=turn_id, call_id=rid, room=rid, source="LLM")
            logger.info("fallback_llm_started", provider=self._fallback_label,
                        turn_id=turn_id, call_id=rid, room=rid, language=self._lang(), source="LLM")
            self._record_spend(self._fallback_label, _pred)
            r2: dict = {}
            async for c in _stamp(_stream_gated(self._fallback_llm, chat_ctx, tools, tool_choice, conn, r2)):
                yield c
            if r2["status"] == "ok":
                self._consec_recovery = 0
                self._route.record_use(self._route.fallback_provider, self._route.fallback_model)
                logger.info("fallback_llm_completed", provider=self._route.fallback_provider,
                            model=self._route.fallback_model, label=self._fallback_label,
                            actual_provider_used=self._route.fallback_provider,
                            actual_model_used=self._route.fallback_model,
                            turn_id=turn_id, call_id=rid, room=rid, language=self._lang(), source="LLM")
                logger.info("turn_recovered_by_fallback", provider=self._fallback_label,
                            turn_id=turn_id, call_id=rid, room=rid, source="LLM")
                return
            if r2["status"] == "error_after_output":
                return
            fe, fs = (_classify_llm_error(r2["err"]) if r2.get("err") else ("incomplete_generation", None))
            logger.warning("fallback_llm_failed", provider=self._fallback_label,
                           error_type=fe, status_code=fs, turn_id=turn_id,
                           call_id=rid, room=rid, source="LLM")
            if fe == "rate_limit" and self._fallback_label:
                # Record it, so the NEXT turn does not repeat this round-trip.
                self._enter_model_cooldown(self._fallback_label, now_mono, turn_id,
                                           rid, fs, r2.get("err"))

        # ── Every provider genuinely failed: ONE short conversational REPAIR ──
        self._consec_recovery += 1
        logger.error("llm_all_providers_failed", turn_id=turn_id, call_id=rid, room=rid,
                      language=self._lang(), consec=self._consec_recovery, source="LLM")
        if self._consec_recovery > 1:
            # Don't repeat the same line / don't loop an infrastructure message.
            logger.warning("repeated_llm_total_failure", turn_id=turn_id,
                           consec=self._consec_recovery, call_id=rid, room=rid, source="LLM")
        logger.warning("llm_recovery_spoken", turn_id=turn_id, call_id=rid, room=rid, source="LLM")
        yield self._recovery_line()

    def _lang(self) -> str:
        return getattr(self._lang_state, "active", "en") if self._lang_state else "en"

    # ── Per-MODEL rate-limit cooldowns ───────────────────────────────────────
    # Previously only the PRIMARY was cooled down. Evidence from the 08:21 call
    # (room call-917397075913-5801): the primary 429'd at turn 4, and from then
    # on every turn was routed to the fallback — which is another model on the
    # SAME Groq key. At turns 14 and 19 the fallback 429'd too, and because
    # nothing recorded that, turn 19 still paid a full doomed round-trip to a
    # model already known to be rate-limited, and the caller heard the recovery
    # line again. Cooling each model separately lets a healthy fallback keep
    # serving while a limited primary rests, and stops doomed requests once
    # BOTH are known to be limited.
    # ── Quota-aware admission control ────────────────────────────────────────
    # Spend is tracked per MODEL because that is how Groq meters it. Before a
    # turn is sent, the model with real headroom is chosen — rather than always
    # hammering the primary until it 429s and only then discovering the
    # fallback's bucket was full the whole time.
    def _record_spend(self, label: str, tokens: int) -> None:
        if not label or tokens <= 0:
            return
        now = time.monotonic()
        w = self._model_spend.setdefault(label, [])
        w.append((now, tokens))
        while w and now - w[0][0] > 60.0:
            w.pop(0)

    def _spend60(self, label: str) -> int:
        now = time.monotonic()
        w = self._model_spend.get(label) or []
        while w and now - w[0][0] > 60.0:
            w.pop(0)
        return sum(t for _, t in w)

    def _headroom(self, label: str, predicted: int) -> int:
        """Tokens left in this model's minute after the next request.

        A safety margin is kept because the prediction is the PREVIOUS turn's
        context and the next one is usually slightly larger (history grows),
        and because the provider's window is rolling, not aligned to ours.
        """
        if not label or _LLM_ITPM_BUDGET <= 0:
            return 1 << 30
        margin = int(_LLM_ITPM_BUDGET * 0.10)
        return _LLM_ITPM_BUDGET - margin - self._spend60(label) - predicted

    def _any_cooling(self) -> bool:
        """True while ANY model is resting. Read by the dead-air watchdog and
        the latency breakdown, which previously read the primary-only
        `_groq_cooldown_active` flag; that flag is gone, and leaving those
        call sites on a getattr default would have made them silently report
        "not cooling" forever."""
        now = time.monotonic()
        return any(until > now for until in self._model_cooldown.values())

    def _cooling(self, label: str, now_mono: float, turn_id: int, rid: str) -> bool:
        until = self._model_cooldown.get(label, 0.0)
        if not until:
            return False
        if now_mono >= until:
            del self._model_cooldown[label]
            logger.info("llm_provider_cooldown_ended", provider=label,
                        turn_id=turn_id, call_id=rid, room=rid, source="LLM")
            return False
        return True

    def _enter_model_cooldown(self, label: str, now_mono: float, turn_id: int,
                              rid: str, status: int | None,
                              err: BaseException | None = None) -> None:
        """Rest one provider/model after a 429, for as long as IT asked for."""
        retry_after, limit_kind = _rate_limit_hint(err)
        if retry_after is not None:
            # Jitter so several concurrent calls on one key do not all resume
            # on the same millisecond and re-trip the limit together.
            wait = retry_after + random.uniform(0.25, 1.5)
        else:
            wait = _GROQ_COOLDOWN_S + random.uniform(0, 5.0)
        already = self._model_cooldown.get(label, 0.0)
        self._model_cooldown[label] = max(already, now_mono + wait)
        # An account-scoped limit (tokens per DAY, or an explicit org limit)
        # exhausts every model on the key at once, so resting them one at a
        # time would just hand each its own doomed request. Cool the whole
        # provider's set together.
        if _limit_is_account_wide(err):
            primary_label = (f"{self._route.primary_provider}/{self._route.primary_model}"
                             if self._route.primary_model else "")
            siblings = [x for x in (primary_label, self._fallback_label)
                        if x and x != label]
            for sib in siblings:
                self._model_cooldown[sib] = max(self._model_cooldown.get(sib, 0.0),
                                                now_mono + wait)
            logger.warning("llm_account_quota_exhausted", provider=label.split("/", 1)[0],
                           limit_kind=limit_kind or "per-day/account",
                           also_cooled=siblings,
                           cooldown_seconds=round(wait, 1),
                           impact="every model on this credential is rate-limited, "
                                  "not just the one that returned 429",
                           turn_id=turn_id, call_id=rid, room=rid, source="LLM")
        logger.warning("llm_primary_rate_limited", provider=label,
                       model=label.split("/", 1)[-1], http_status=status or 429,
                       retry_after_s=round(retry_after, 2) if retry_after is not None else None,
                       limit_kind=limit_kind or "unknown",
                       source_of_wait="provider" if retry_after is not None else "default",
                       turn_id=turn_id, call_id=rid, room=rid, source="LLM")
        if already <= now_mono:
            logger.warning("llm_provider_cooldown_started", provider=label,
                           cooldown_seconds=round(wait, 1), http_status=status or 429,
                           limit_kind=limit_kind or "unknown",
                           turn_id=turn_id, call_id=rid, room=rid, source="LLM")

    async def on_user_turn_completed(
        self, turn_ctx: "llm.ChatContext", new_message: "llm.ChatMessage"
    ) -> None:
        try:
            before = len(turn_ctx.items)
            if before > MAX_HISTORY_ITEMS:
                turn_ctx.truncate(max_items=MAX_HISTORY_ITEMS)
                logger.info(
                    "history_truncated",
                    before_items=before, after_items=len(turn_ctx.items),
                    max_items=MAX_HISTORY_ITEMS, source="WORKER",
                )
        except Exception as exc:  # never let trimming break a turn
            logger.warning("history_truncate_failed", error=str(exc))

        # ── Real total-input-token measurement (task 1). Count the ACTUAL context
        # Groq will receive this turn: system prompt, rolling history, the latest
        # user message, and the tool schemas re-sent every request. This is the
        # number that must stay under ITPM — system_prompt_tokens alone is not.
        try:
            sys_toks = hist_toks = cur_toks = 0
            items = list(getattr(turn_ctx, "items", []) or [])
            new_id = getattr(new_message, "id", None)
            for it in items:
                if getattr(it, "type", None) != "message":
                    # function_call / function_call_output — count their text too.
                    hist_toks += count_tokens(str(getattr(it, "text_content", "") or ""))
                    continue
                role = getattr(it, "role", None)
                try:
                    txt = it.text_content or ""
                except Exception:
                    txt = ""
                toks = count_tokens(txt)
                if role in ("system", "developer"):
                    sys_toks += toks
                elif new_id and getattr(it, "id", None) == new_id:
                    cur_toks += toks
                else:
                    hist_toks += toks
            if cur_toks == 0:  # new_message may not be in items yet
                try:
                    cur_toks = count_tokens(new_message.text_content or "")
                except Exception:
                    cur_toks = 0
            total = sys_toks + hist_toks + cur_toks + self._tool_tokens
            logger.info(
                "groq_input_tokens",
                system_prompt_tokens=sys_toks,
                business_context_tokens=self._business_context_tokens,
                tool_schema_tokens=self._tool_tokens,
                conversation_history_tokens=hist_toks,
                current_user_tokens=cur_toks,
                total_input_tokens=total,
                history_items=len(items),
                # Without these the single most useful rate-limit diagnostic
                # could not be tied to a call: the 08:21 incident had NO
                # readable per-turn token budget at all, because this event
                # carried no room id (and every *_tokens field was being
                # redacted as if it were a credential).
                call_id=self._room_id, room=self._room_id,
                source="WORKER",
            )
            # Rolling 60s input-token spend vs the account's believed ITPM.
            # Warn-only — never throttles, never drops a turn.
            now = time.monotonic()
            self._last_ctx_tokens = total
            self._itpm_window.append((now, total))
            while self._itpm_window and now - self._itpm_window[0][0] > 60.0:
                self._itpm_window.pop(0)
            spent = sum(t for _, t in self._itpm_window)
            if _LLM_ITPM_BUDGET > 0 and spent > _LLM_ITPM_BUDGET:
                logger.warning(
                    "llm_input_budget_exceeded",
                    tokens_last_60s=spent, budget=_LLM_ITPM_BUDGET,
                    requests_last_60s=len(self._itpm_window),
                    per_request_tokens=total,
                    system_prompt_tokens=sys_toks,
                    system_prompt_share_pct=round(100 * sys_toks / max(total, 1)),
                    impact="further turns this minute are likely to be rate-limited",
                    remedy="reduce per-request input (prompt/tools) or raise the "
                           "provider tier; history is already bounded",
                    call_id=self._room_id, room=self._room_id, source="LLM")
        except Exception as exc:
            logger.warning("token_measure_failed", error=str(exc))


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _load_caller_history(phone: str) -> str:
    if phone in ("unknown", "demo"):
        return ""
    try:
        memories, calls = await asyncio.gather(
            db.get_contact_memory(phone),
            db.get_calls_by_phone(phone),
        )
        if not memories and not calls:
            return ""
        bits: list[str] = []
        if memories:
            bits.append("Known: " + " | ".join(m["insight"] for m in memories[:3]))
        if calls:
            last = calls[0]
            last_at = last.get("createdAt") or last.get("created_at")
            bits.append(
                f"Last call ({last_at.date().isoformat() if last_at else 'recently'}): "
                f"{last.get('outcome', '?')}"
            )
        # Hard cap so prior-call context never bloats the per-turn input tokens
        # (Groq ITPM budget): ~150 tokens ≈ 600 chars.
        return "\n".join(bits)[:600]
    except Exception as exc:
        logger.warning("load_caller_history_failed", error=str(exc), phone=phone)
        return ""


async def _resolve_profile(profile_id: str | None) -> dict:
    """Look up by id in agent_profiles, then assistants, then default."""
    if profile_id:
        prof = await db.get_agent_profile(profile_id)
        if prof:
            return prof
        # Inbound routing (Task 2) passes an Assistant id — fall through.
        assistant = await db.get_assistant_as_profile(profile_id)
        if assistant:
            return assistant
    prof = await db.get_default_agent_profile()
    return prof or {}


def _parse_metadata(ctx: JobContext) -> dict:
    out: dict = {}
    for src in (ctx.job.metadata, getattr(ctx.room, "metadata", None)):
        if src:
            try:
                out.update(json.loads(src))
            except Exception:
                pass
    return out


# Display names that must NEVER be treated as a customer/lead name. The browser
# diagnostics participant joins as "Dashboard Monitor"; monitor/agent/standard
# listeners and generic placeholders must not leak into customer identity.
_NON_CUSTOMER_NAMES = {
    "", "there", "caller", "unknown", "monitor", "dashboard monitor",
    "dashboard", "agent", "voice-agent", "bot", "assistant", "listener",
    "sip", "web", "browser", "test",
}


def _clean_customer_name(raw: str | None) -> str:
    """Return a real customer name, or "" when there is none. Rejects diagnostics/
    monitor/placeholder names so they can never become the greeting name."""
    n = (raw or "").strip()
    if n.lower() in _NON_CUSTOMER_NAMES:
        return ""
    # A SIP display name is often just the caller-ID digits — not a real name.
    if re.fullmatch(r"[+\d][\d\s\-()]{5,}", n):
        return ""
    return n


def _is_audio_kind(kind: Any) -> bool:  # noqa: ANN401 - rtc enum or str
    """True for an AUDIO track kind.

    rtc.TrackKind stringifies to its integer: AUDIO is "1", VIDEO is "2". The
    previous inline test (`"audio" in k.lower() or k.endswith("2")`) therefore
    matched VIDEO and never matched audio, so the SIP-audio branch of
    track_subscribed never ran. Accept the enum, its int, or a descriptive
    string so this keeps working if the SDK changes representation.
    """
    try:
        if kind == rtc.TrackKind.KIND_AUDIO:
            return True
    except Exception:
        pass
    k = str(kind or "").strip().lower()
    return "audio" in k or k == "1" or k.endswith("kind_audio")


def _is_sip_participant(ident: str, p: Any) -> bool:
    if ident and ident.startswith("sip_"):
        return True
    try:
        if getattr(p, "kind", None) == rtc.ParticipantKind.PARTICIPANT_KIND_SIP:
            return True
    except Exception:
        pass
    return False


def _extract_caller_phone(ctx: JobContext, meta: dict) -> tuple[str, str]:
    """Returns (phone, name).

    name comes ONLY from the call metadata (selected Contact / lead passed by the
    dialer). It is NEVER taken from a room participant's display name — the
    browser diagnostics participant ("Dashboard Monitor") and any monitor /
    standard listener must not leak into customer identity. phone is read only
    from the real SIP caller participant, never from the monitor.
    """
    phone = meta.get("phone_number") or "unknown"
    name = _clean_customer_name(meta.get("lead_name"))
    for ident, p in ctx.room.remote_participants.items():
        if not _is_sip_participant(ident, p):
            continue  # skip monitor/browser/standard participants entirely
        if phone in ("unknown", ""):
            attrs = p.attributes or {}
            phone = attrs.get("sip.phoneNumber") or attrs.get("phoneNumber") or phone
            if phone in ("unknown", ""):
                m = re.search(r"\+\d{7,15}", ident)
                if m:
                    phone = m.group()
    return phone or "unknown", name


# ── Call recording (LiveKit Egress → Cloudflare R2) ──────────────────────────
# Records the REAL room audio (SIP caller + AI agent) to a PRIVATE R2 object via
# RoomComposite audio-only egress. Started only after the call is connected and
# only when policy allows. The dashboard presigns short-lived playback/download
# URLs from the stored object key (the bucket stays private).

def _r2_recording_config() -> dict | None:
    """Return the R2 egress config, or None if recording is not configured.

    Never returns or logs secret values. Endpoint is taken from R2_ENDPOINT or
    derived from R2_ACCOUNT_ID.
    """
    access = os.getenv("R2_ACCESS_KEY_ID", "")
    secret = os.getenv("R2_SECRET_ACCESS_KEY", "")
    bucket = os.getenv("R2_BUCKET", "")
    account = os.getenv("R2_ACCOUNT_ID", "")
    endpoint = os.getenv("R2_ENDPOINT", "") or (
        f"https://{account}.r2.cloudflarestorage.com" if account else ""
    )
    if access and secret and bucket and endpoint:
        return {"access": access, "secret": secret, "bucket": bucket, "endpoint": endpoint}
    return None


def _recording_enabled_globally() -> bool:
    return os.getenv("CALL_RECORDING_ENABLED", "true").strip().lower() not in ("false", "0", "no", "off")


# ── TTS-BYPASS AUDIO DIAGNOSTIC ───────────────────────────────────────────────
# Plays a KNOWN LOCAL WAV straight through the AgentSession audio output —
# bypassing ALL TTS (Gemini + Deepgram + FallbackAdapter). Isolates the exact
# breakpoint: if the SIP caller HEARS the WAV, the LiveKit RoomIO → audio-track
# publication → SIP playout path is healthy and the fault is in TTS; if the
# caller hears NOTHING, the fault is downstream of TTS (RoomIO/publish/SIP).
# Enable with DIAGNOSTIC_AUDIO=true; override the clip with DIAGNOSTIC_AUDIO_WAV.
def _ensure_diagnostic_wav(path: str, sample_rate: int = 48000) -> str:
    """Create a known, unmistakable local WAV (3 beeps + a tone) if absent.
    Dependency-free (stdlib wave/struct/math); no cloud, no TTS."""
    if os.path.exists(path):
        return path
    import math
    import struct
    import wave
    frames = bytearray()

    def _tone(freq: float, ms: int, amp: float = 0.35) -> None:
        n = int(sample_rate * ms / 1000)
        for i in range(n):
            frames.extend(struct.pack("<h", int(amp * 32767 * math.sin(2 * math.pi * freq * i / sample_rate))))

    def _silence(ms: int) -> None:
        frames.extend(b"\x00\x00" * int(sample_rate * ms / 1000))

    for _ in range(3):
        _tone(660, 350); _silence(200)
    _tone(440, 600)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sample_rate)
        w.writeframes(bytes(frames))
    return path


async def _wav_frames(path: str, on_first):  # noqa: ANN001
    """Yield 10ms rtc.AudioFrame chunks from a mono PCM16 WAV; fire on_first() on
    the very first frame handed to the session output."""
    import wave
    with wave.open(path, "rb") as w:
        sr = w.getframerate(); ch = w.getnchannels()
        data = w.readframes(w.getnframes())
    spf = max(1, int(sr * 0.01))           # samples per channel per 10ms frame
    step = spf * ch * 2                      # bytes per frame (PCM16)
    fired = False
    for off in range(0, len(data), step):
        chunk = data[off:off + step]
        if len(chunk) < 2:
            break
        spc = len(chunk) // (ch * 2)
        frame = rtc.AudioFrame(data=chunk, sample_rate=sr, num_channels=ch, samples_per_channel=spc)
        if not fired:
            fired = True
            try:
                on_first()
            except Exception:
                pass
        yield frame
        await asyncio.sleep(0)


def _play_local_clip(session: Any, kind: str, lang_code: str) -> bool:  # noqa: ANN401
    """Never-silent path (req 12/15): play the caller-language local clip for
    `kind` (presence/filler/unavailable) straight through the audio track, TTS
    bypassed. Interruptible and NOT added to chat history. Returns True if a clip
    was found and started, False if no same-language clip exists (caller decides
    what to do instead — we never play a wrong-language clip).
    """
    try:
        path = _clips.clip_path(lang_code, kind)
        if not path:
            logger.info("local_clip_unavailable", kind=kind, language=lang_code or "unknown",
                        source="TTS")
            return False
        session.say(text=" ", audio=_wav_frames(path, lambda: None),
                    allow_interruptions=True, add_to_chat_ctx=False)
        logger.info("local_clip_played", kind=kind, language=lang_code, file=os.path.basename(path),
                    source="TTS")
        return True
    except Exception as exc:
        logger.warning("local_clip_failed", kind=kind, language=lang_code, error=str(exc)[:200],
                       source="TTS")
        return False


async def _run_diagnostic_audio(ctx: JobContext, session: Any) -> None:  # noqa: ANN401
    """If DIAGNOSTIC_AUDIO is on, push a known WAV through session.say(audio=…)
    (TTS bypassed) and log the three breakpoint markers."""
    if os.getenv("DIAGNOSTIC_AUDIO", "false").strip().lower() not in ("1", "true", "yes", "on"):
        return
    rid = ctx.room.name
    wav = os.getenv("DIAGNOSTIC_AUDIO_WAV", "/tmp/jilljill_diag.wav")
    try:
        _ensure_diagnostic_wav(wav)
        import wave
        with wave.open(wav, "rb") as w:
            sr = w.getframerate(); ch = w.getnchannels(); dur = w.getnframes() / float(w.getframerate() or 1)
    except Exception as exc:
        logger.error("diagnostic_audio_failed", stage="prepare_wav", error=str(exc),
                     call_id=rid, room=rid, source="DIAGNOSTIC")
        return
    state = {"first": False}

    def _on_first() -> None:
        if not state["first"]:
            state["first"] = True
            logger.info("diagnostic_first_frame_published", wav=wav, sample_rate=sr, channels=ch,
                        call_id=rid, room=rid, source="DIAGNOSTIC")

    logger.info("diagnostic_audio_started", wav=wav, duration_s=round(dur, 2), sample_rate=sr,
                channels=ch, bypass="tts+fallback_adapter", path="session.say(audio=) → RoomIO → SIP",
                call_id=rid, room=rid, source="DIAGNOSTIC")
    try:
        handle = session.say(text="(diagnostic audio test)", audio=_wav_frames(wav, _on_first),
                             allow_interruptions=False, add_to_chat_ctx=False)
        try:
            await handle.wait_for_playout()
        except Exception:
            await asyncio.sleep(dur + 1.0)
        logger.info("diagnostic_audio_completed", wav=wav, duration_s=round(dur, 2),
                    first_frame_reached=state["first"], call_id=rid, room=rid, source="DIAGNOSTIC")
    except Exception as exc:
        logger.error("diagnostic_audio_failed", stage="play", error=str(exc),
                     call_id=rid, room=rid, source="DIAGNOSTIC")


async def _maybe_start_recording(ctx: JobContext, profile: dict, agent_tools: Any) -> None:  # noqa: ANN401
    """Start LiveKit Egress for this connected call if policy + R2 allow it.

    Respects the global CALL_RECORDING_ENABLED kill-switch and the per-assistant
    `recording_enabled` consent flag. Emits structured diagnostics events and
    persists recording status/egress-id/object-key onto the call row. Any failure
    is logged and surfaced as recording_failed — it NEVER breaks the live call.
    """
    room = ctx.room.name
    # Consent / policy: both the global switch and the assistant flag must allow.
    if not _recording_enabled_globally() or not bool(profile.get("recording_enabled", False)):
        logger.info("recording_disabled_by_policy", room=room, call_id=room, source="LIVEKIT")
        return

    # SELF-HOSTED LOCAL RECORDING (default). Captures the caller's subscribed
    # audio track + the agent's TTS frames and mixes them to a WAV on this host.
    # No Cloudflare R2 credentials are involved. LiveKit Cloud is unchanged — we
    # only subscribe with the normal SDK instead of asking Egress to upload.
    if config.RECORDING_BACKEND == "local":
        rec = _rec.CallRecorder(room)
        if rec.start():
            agent_tools._recorder = rec
            try:
                await db.set_recording_status(room, status="RECORDING",
                                              object_key=rec.rel_key)
            except Exception as exc:  # noqa: BLE001 — persistence is best-effort
                logger.warning("recording_status_persist_failed", error=str(exc))
            logger.info("recording_started", backend="local", room=room, call_id=room,
                        object_key=rec.rel_key, source="RECORDING")
        else:
            try:
                await db.set_recording_status(room, status="FAILED",
                                              error=rec.failed_reason or "recorder start failed")
            except Exception as exc:  # noqa: BLE001
                logger.warning("recording_status_persist_failed", error=str(exc))
            logger.warning("recording_failed", backend="local", room=room,
                           reason=rec.failed_reason, source="RECORDING")
        return

    cfg = _r2_recording_config()
    if cfg is None:
        # Not configured is NOT a failure — surface it as such and mark the row.
        logger.info("egress_skipped_no_r2_config", room=room, call_id=room, source="LIVEKIT")
        try:
            await db.set_recording_status(room, status="NOT_CONFIGURED")
        except Exception as exc:  # noqa: BLE001 — persistence is best-effort
            logger.warning("recording_status_persist_failed", error=str(exc))
        return

    now = datetime.now(UTC)
    object_key = f"recordings/{now:%Y/%m/%d}/{room}.ogg"
    logger.info("recording_start_requested", room=room, call_id=room,
                object_key=object_key, source="LIVEKIT")
    try:
        egress_req = api.RoomCompositeEgressRequest(
            room_name=room,
            audio_only=True,
            file_outputs=[api.EncodedFileOutput(
                filepath=object_key,
                s3=api.S3Upload(
                    access_key=cfg["access"],
                    secret=cfg["secret"],
                    bucket=cfg["bucket"],
                    endpoint=cfg["endpoint"],
                    region="auto",
                    force_path_style=True,
                ),
            )],
        )
        egress_info = await ctx.api.egress.start_room_composite_egress(egress_req)
        egress_id = getattr(egress_info, "egress_id", "") or ""
        agent_tools._egress_id = egress_id
        agent_tools._recording_object_key = object_key
        await db.set_recording_status(room, status="RECORDING", egress_id=egress_id, object_key=object_key)
        # egress_started kept for backward-compat; recording_started is the new
        # canonical event the dashboard consumes.
        logger.info("egress_started", egress_id=egress_id, room=room, call_id=room, source="LIVEKIT")
        logger.info("recording_started", egress_id=egress_id, room=room, call_id=room,
                    object_key=object_key, source="LIVEKIT")
    except Exception as exc:  # noqa: BLE001 — recording must never break the call
        reason = str(exc)
        logger.warning("egress_start_failed", error=reason, room=room, call_id=room, source="LIVEKIT")
        logger.error("recording_failed", error=reason, room=room, call_id=room,
                     stage="start", source="LIVEKIT")
        try:
            await db.set_recording_status(room, status="FAILED", error=reason[:500])
        except Exception as exc2:  # noqa: BLE001
            logger.warning("recording_status_persist_failed", error=str(exc2))


# ── Main entrypoint ──────────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext) -> None:
    # Start the Live Logs drain on THIS job's event loop so worker-side
    # structlog events (STT/LLM/TTS/turn/call lifecycle) reach the dashboard.
    from observability import start_log_drain
    start_log_drain()
    _job_room = getattr(getattr(ctx, "room", None), "name", "") or ""
    # Build marker: confirms the RUNNING worker is this agent.py version. If this
    # value is not in your live logs, the worker was not restarted after editing.
    logger.info("VOICE_WORKER_BUILD", build=AGENT_BUILD, room=_job_room, source="WORKER")
    logger.info("worker_job_received", room=_job_room, source="LIVEKIT")
    await ctx.connect()
    logger.info("room_connected", room=ctx.room.name, call_id=ctx.room.name, source="LIVEKIT")

    # ── LiveKit room observers (thin, logging-only; do not alter audio flow) ──
    _lk_rid = ctx.room.name

    def _is_sip(p: Any) -> bool:  # noqa: ANN401
        return (getattr(p, "kind", None) == rtc.ParticipantKind.PARTICIPANT_KIND_SIP
                or "sip_" in str(getattr(p, "identity", "")))

    @ctx.room.on("participant_connected")
    def _dbg_participant_joined(*a: Any) -> None:  # noqa: ANN401 — rtc event
        p = a[0] if a else None
        ident = getattr(p, "identity", "")
        kind = getattr(p, "kind", None)
        if _is_sip(p):
            # NOT the answer. Verified against the carrier CDR for room
            # call-917397075913-5801: this fired at 13:51:18.338 IST, which
            # Vobiz records as "Start" (dial initiated). The carrier's
            # "Call picked" was 13:51:25 — seven seconds later, and it bills
            # from the pickup. Anchoring billing here overcharged the ringing
            # period on every outbound call. The authoritative answer stamp is
            # taken where create_sip_participant(wait_until_answered=True)
            # returns; this event stays purely as the ring/start marker.
            logger.info("sip_participant_found", participant=ident, kind=str(kind),
                        name=str(getattr(p, "name", "")), room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")
        else:
            logger.info("participant_joined", participant=ident, kind=str(kind),
                        room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")

    @ctx.room.on("participant_disconnected")
    def _dbg_participant_left(*a: Any) -> None:  # noqa: ANN401 — rtc event
        p = a[0] if a else None
        ident = getattr(p, "identity", "")
        is_sip = _is_sip(p)
        logger.info("sip_participant_left" if is_sip else "participant_left",
                    participant=ident, room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")
        if is_sip:
            # Stamp the hangup the moment it happens. The shutdown hook can run
            # much later (LiveKit's room reaper), and billing must not inherit
            # that delay — see _billable_seconds.
            try:
                ctx._jj_hangup_mono = time.monotonic()   # type: ignore[attr-defined]
                ctx._jj_hangup_at = datetime.now(UTC)    # type: ignore[attr-defined]
            except Exception:
                pass
        # The SIP leg leaving IS the end of the call — end the session now.
        #
        # This handler used to only log. MEASURED on room
        # call-917397075913-5801: the caller hung up at 08:24:59 and the
        # session stayed alive until LiveKit reaped the empty room at 09:17:43
        # — 52.7 minutes later. The shutdown hook then recorded
        # duration=3417s for a call that really lasted 236s, so the stored
        # duration (and every cost derived from it) was ~14x too high, a
        # worker slot and an active_calls row were held for the whole time,
        # and campaign concurrency was starved by a call that had ended.
        #
        # Only the SIP participant counts: the dashboard diagnostics listener
        # joins and leaves these rooms routinely and must never end a call.
        # ctx.shutdown() is idempotent and runs the normal shutdown hook, so
        # the call is completed through exactly the same path as a hangup the
        # agent initiates.
        if not is_sip:
            return
        if getattr(ctx, "_jj_ending", False):
            return
        ctx._jj_ending = True          # type: ignore[attr-defined]
        logger.info("call_ended_by_caller_hangup", participant=ident,
                    room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")
        try:
            ctx.shutdown(reason="sip_participant_left")
        except Exception as exc:
            logger.warning("hangup_shutdown_failed", error=str(exc)[:200],
                           room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")

    # Late-arriving SIP metadata. `sip.callIDFull` (the trunk provider's SIP
    # Call-ID, and the key used to find the Vobiz recording afterwards) is
    # normally set when the participant joins, but it can also land in a later
    # attribute update. The one-shot read after answer would miss that, and the
    # value is unrecoverable once the call ends — so capture it here too.
    # set_sip_call_identity only fills empty columns, making this idempotent.
    @ctx.room.on("participant_attributes_changed")
    def _sip_attrs_changed(*a: Any) -> None:  # noqa: ANN401 — rtc event
        try:
            p = next((x for x in a if hasattr(x, "attributes")), None)
            if p is None or not _is_sip(p):
                return
            full = (getattr(p, "attributes", None) or {}).get("sip.callIDFull")
            if not full:
                return
            logger.info("sip_call_identity_captured_late", sip_call_id_full=full,
                        room=_lk_rid, call_id=_lk_rid, source="VOBIZ")
            asyncio.create_task(db.set_sip_call_identity(_lk_rid, sip_call_id=full))
        except Exception as exc:  # noqa: BLE001 — bookkeeping, never break the call
            logger.warning("sip_call_identity_late_failed", error=str(exc)[:200],
                           room=_lk_rid, source="VOBIZ")

    @ctx.room.on("track_subscribed")
    def _dbg_track_subscribed(*a: Any) -> None:  # noqa: ANN401 — rtc event
        track = a[0] if len(a) >= 1 else None
        pub = a[1] if len(a) >= 2 else None
        p = a[-1] if a else None
        ident = getattr(p, "identity", "")
        pkind = getattr(p, "kind", None)
        tkind = str(getattr(track, "kind", ""))
        tsid = str(getattr(pub, "sid", "") or getattr(track, "sid", ""))
        is_sip = _is_sip(p)
        is_audio = _is_audio_kind(getattr(track, "kind", None) or tkind)
        logger.info("audio_track_subscribed", participant=ident, kind=str(pkind),
                    track_kind=tkind, track_sid=tsid, is_sip=is_sip,
                    room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")
        if is_sip and is_audio:
            # Proof the real SIP caller's audio track is subscribed → with the
            # SIP-only input filter this IS the AgentSession input participant.
            logger.info("sip_audio_track_subscribed", participant=ident, track_sid=tsid,
                        room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")
            logger.info("agent_input_attached", participant=ident, kind="SIP",
                        track_sid=tsid, room=_lk_rid, call_id=_lk_rid, source="LIVEKIT")
            # Feed the caller's audio into the local recorder (best-effort; a
            # recording problem must never affect the live call).
            try:
                _r = getattr(agent_tools, "_recorder", None)
                if _r is not None and track is not None:
                    # Pass the SID so a track the post-start sweep already
                    # attached is skipped instead of being mixed twice.
                    _r.attach_caller_track(track, track_sid=tsid)
            except Exception as _rex:  # noqa: BLE001
                logger.warning("recording_caller_attach_failed", error=str(_rex)[:200],
                               room=_lk_rid, source="RECORDING")

    meta = _parse_metadata(ctx)
    phone, name = _extract_caller_phone(ctx, meta)

    if is_rate_limited(phone):
        logger.warning("rate_limited", phone=phone)
        await db.log_error("agent", f"rate-limit blocked {phone}")
        return

    # ── Inbound routing (Feature Pack 3 / Task 2) ────────────────────────────
    # For inbound calls only: look up the dialed-to number to find the bound
    # assistant. If found, prefer it over metadata-supplied agent_profile_id.
    inbound_user_in_room = any(
        "sip_" in p.identity for p in ctx.room.remote_participants.values()
    )
    inbound_assistant_id: str | None = None
    if inbound_user_in_room:
        dialed_to: str | None = None
        for p in ctx.room.remote_participants.values():
            attrs = p.attributes or {}
            called = attrs.get("sip.calledNumber") or attrs.get("calledNumber")
            if called:
                dialed_to = called
                break
        if dialed_to:
            try:
                routing = await db.get_phone_number_routing(dialed_to)
            except Exception as exc:
                logger.warning("inbound_routing_lookup_failed", error=str(exc))
                routing = None
            if routing and routing.get("assistantId"):
                inbound_assistant_id = routing["assistantId"]
                logger.info(
                    "inbound_routing_hit",
                    to=dialed_to,
                    assistant_id=inbound_assistant_id,
                )

    profile_lookup_id = inbound_assistant_id or meta.get("agent_profile_id")
    profile = await _resolve_profile(profile_lookup_id)
    # Confirm which assistant profile this call actually loaded (not a stale /
    # default one). source=assistant means it came from the assistants table.
    logger.info(
        "assistant_profile_loaded",
        requested_id=profile_lookup_id,
        assistant_id=profile.get("id"),
        assistant_name=profile.get("name"),
        source=profile.get("_profile_source") or "default_or_agent_profile",
        llm_provider=profile.get("llm_provider"),
        llm_model=profile.get("model"),
        realtime_model=profile.get("realtime_model"),
        stt_provider=profile.get("stt_provider"),
        tts_provider=profile.get("tts_provider"),
        voice_id=profile.get("voice"),
        has_first_message=bool(profile.get("first_message")),
        system_prompt_len=len(str(profile.get("system_prompt") or "")),
        call_id=ctx.room.name, room=ctx.room.name,
    )
    if profile_lookup_id and profile.get("id") != profile_lookup_id:
        # A specific assistant was requested (inbound routing, or an outbound /
        # campaign / demo job's metadata) but could not be resolved — inactive,
        # deleted, or a stale id — so _resolve_profile fell through to the
        # default agent_profile. That silently swaps in an UNRELATED prompt,
        # model and voice, and disables knowledge retrieval (which is keyed on
        # an assistant id). It used to leave no trace at all.
        logger.error(
            "assistant_profile_fallback",
            requested_id=profile_lookup_id, loaded_id=profile.get("id"),
            loaded_name=profile.get("name"),
            loaded_source=profile.get("_profile_source") or "default_agent_profile",
            impact="the requested assistant's saved prompt, voice stack and "
                   "knowledge are NOT in force for this call",
            call_id=ctx.room.name, room=ctx.room.name, source="WORKER",
        )
    history = await _load_caller_history(phone)

    # Resolve business + customer identity ONCE so the system prompt and the
    # spoken greeting agree (they used to diverge: greeting used config.BUSINESS_NAME
    # while the prompt body defaulted to "our company"). customer_name is the
    # cleaned lead name or "" — never a monitor/placeholder.
    business_name = str(
        meta.get("business_name") or config.BUSINESS_NAME or "our company"
    ).strip()
    customer_name = _clean_customer_name(meta.get("lead_name") or name)

    # `_prompt_diag` carries hash + substitution counts only, never the prompt
    # text: the saved prompt is confidential, but WHICH prompt loaded and
    # WHETHER its placeholders were filled must be provable from Live Logs.
    _prompt_diag: dict = {}
    system_prompt = build_prompt(
        lead_name=customer_name or "the caller",
        business_name=business_name,
        service_type=meta.get("service_type") or "your enquiry",
        custom_prompt=profile.get("system_prompt"),
        language_preset=meta.get("language_preset") or "multilingual",
        caller_history=history,
        diagnostics=_prompt_diag,
    )
    logger.info("prompt_loaded", assistant_id=profile.get("id"),
                assistant_name=profile.get("name"),
                has_customer_name=bool(customer_name),
                business_name_resolved=business_name,
                **_prompt_diag,
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    if _prompt_diag.get("prompt_source") != "saved_assistant":
        # Loud, because it means the operator's configured behaviour is NOT in
        # force — the platform default receptionist persona is.
        logger.warning("prompt_saved_assistant_missing",
                       assistant_id=profile.get("id"),
                       using=_prompt_diag.get("prompt_source"),
                       impact="the platform default prompt is in force, not the "
                              "assistant's saved configuration",
                       call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    if _prompt_diag.get("unresolved"):
        logger.warning("prompt_placeholders_unresolved",
                       unresolved=_prompt_diag["unresolved"],
                       impact="these braces are not supported placeholders and are "
                              "spoken/sent literally",
                       call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    # Hallucination guard is now covered by the shared [VOICE] rules appended in
    # build_prompt ("don't invent names, prices, policies, availability or
    # facts…"), so no extra per-call paragraph is added here — saves input tokens
    # on every Groq request (free-tier ITPM budget).
    tokens = count_tokens(system_prompt)
    logger.info("prompt_built", system_prompt_tokens=tokens,
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")

    # Deterministic structured call state (Step B): role-agnostic memory that
    # survives chat-history truncation, injected into every LLM turn and updated
    # from explicit signals + CONFIRMED tool results. Shared by the tools (which
    # write confirmed facts) and the LLM node (which injects it).
    import callstate as _cs  # local import to avoid any load-order issues
    _role = str(profile.get("role") or profile.get("agent_role") or "receptionist")
    def _cs_log(event: str, **kw: Any) -> None:  # noqa: ANN401
        try:
            logger.info(event, call_id=ctx.room.name, room=ctx.room.name, source="SESSION", **kw)
        except Exception:
            pass
    _call_state = _cs.CallState(role=_role, log=_cs_log)

    # Build tools placeholder — Phase 3 will wire AppointmentTools.
    from tools import AppointmentTools  # local import to avoid cycle at module load
    agent_tools = AppointmentTools(ctx, phone, name, call_state=_call_state)

    # Human call forwarding destinations for THIS assistant. Loaded once here so
    # resolving a transfer mid-call is a dict lookup and never a database round
    # trip inside a live conversation. The LLM is told the category names only;
    # the numbers never leave this process.
    try:
        agent_tools.transfer_targets = await db.get_human_transfer_targets(
            profile.get("id") or "")
        if agent_tools.transfer_targets:
            logger.info("transfer_targets_loaded",
                        categories=sorted(agent_tools.transfer_targets),
                        count=len(agent_tools.transfer_targets),
                        assistant_id=profile.get("id"), source="TRANSFER")
        else:
            logger.info("transfer_targets_none", assistant_id=profile.get("id"),
                        impact="a human-transfer request will be declined politely",
                        source="TRANSFER")
    except Exception as exc:  # noqa: BLE001 - never fail a call over this
        logger.warning("transfer_targets_load_failed", error=str(exc)[:200],
                       assistant_id=profile.get("id"), source="TRANSFER")

    enabled = json.loads(profile.get("enabled_tools") or "[]") if isinstance(profile.get("enabled_tools"), str) else (profile.get("enabled_tools") or [])
    tool_list = agent_tools.build_tool_list(enabled)

    # ── Custom HTTP tools (Feature Pack 3 / Task 5) ──────────────────────────
    # Look up Tool rows bound to this assistant via AssistantTool. Each active
    # HTTP tool becomes an additional llm.function_tool the LLM can invoke.
    assistant_id_for_tools = (
        inbound_assistant_id
        or (profile.get("id") if isinstance(profile, dict) else None)
    )
    if assistant_id_for_tools:
        try:
            custom_defs = await db.get_assistant_tools(assistant_id_for_tools)
        except Exception as exc:
            logger.warning("custom_tools_lookup_failed", error=str(exc))
            custom_defs = []
        if custom_defs:
            from custom_tools import build_custom_tool
            for d in custom_defs:
                if d.get("kind") == "HTTP" and d.get("isActive"):
                    try:
                        tool_list.append(build_custom_tool(d, ctx))
                    except Exception as exc:
                        logger.warning(
                            "custom_tool_build_failed",
                            tool=d.get("name"), error=str(exc),
                        )
            logger.info(
                "custom_tools_loaded",
                count=sum(1 for d in custom_defs if d.get("isActive")),
                assistant_id=assistant_id_for_tools,
            )

    # Precompute the per-request token cost of the tool schemas (re-sent every
    # turn) and the injected business/identity block, so the per-turn
    # groq_input_tokens log can report the REAL total, not just the system prompt.
    _tool_tokens = _count_tool_tokens(tool_list)
    _biz_tokens = count_tokens(get_business_context(business_name))
    logger.info("tool_schema_budget", tool_count=len(tool_list),
                tool_schema_tokens=_tool_tokens, business_context_tokens=_biz_tokens,
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")

    # Runtime LLM fallback (P0): build a backup LLM once; the router in
    # BoundedAgent.llm_node switches to it per-turn only when the primary fails.
    # ONE routing decision for the whole call. The SELECTED provider controls
    # both primary and fallback; nothing below may infer a provider from a model
    # name. `_llm_route` also accumulates the ACTUAL provider/model used, which
    # is what the call is billed on.
    _llm_route = llm_routing.resolve_route(profile)
    _fallback_llm, _fallback_label = _build_fallback_llm(_llm_route)
    if _fallback_llm is None:          # keep the route honest for logs/billing
        _llm_route.fallback_provider = ""
        _llm_route.fallback_model = ""
    _route_fields = _llm_route.log_fields()
    logger.info("llm_route_resolved", **_route_fields, reason=_llm_route.reason,
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    logger.info("primary_llm_configured", provider=_llm_route.primary_provider or "none",
                model=_llm_route.primary_model or "none", **_route_fields,
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    logger.info("fallback_llm_configured", provider=_llm_route.fallback_provider or "none",
                label=_fallback_label or "none",
                is_cross_provider=bool(_llm_route.fallback_provider
                                       and _llm_route.fallback_provider != _llm_route.selected_provider),
                **_route_fields, call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    logger.info("provider_health",
                primary=f"{_llm_route.primary_provider}/{_llm_route.primary_model}",
                fallback=_fallback_label or "none",
                groq_key=bool(os.environ.get("GROQ_API_KEY")),
                gemini_key=bool(os.environ.get("GOOGLE_API_KEY")),
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    # Never-silent local clips available this process (req 12/15). Empty = a TTS
    # failure on that language will be silent until clip files are supplied.
    logger.info("local_clips_available", clips=_clips.available(),
                call_id=ctx.room.name, room=ctx.room.name, source="WORKER")

    # ONE persistent conversation-language state for the whole call, shared by
    # the STT→language router (which updates it) and the LLM node (which reads it
    # to force the reply language every turn — incl. fallback/retry/tool turns).
    _lang_state = lang.LanguageState()
    _call_state.set_language(_lang_state.active)
    agent = BoundedAgent(instructions=system_prompt, tools=tool_list,
                         tool_tokens=_tool_tokens, business_context_tokens=_biz_tokens,
                         fallback_llm=_fallback_llm, fallback_label=_fallback_label,
                         room_id=ctx.room.name, lang_state=_lang_state, call_state=_call_state,
                         llm_route=_llm_route, assistant_id=profile.get("id"))
    # This organisation's own provider credentials (BYOK), loaded once per call
    # before the session is built. Cached for 60s per org, so this is a DB read
    # at most once a minute rather than per call — provider resolution never
    # becomes work done inside a live conversation.
    _tenant_provider_keys: dict[str, str] = {}
    try:
        _tenant_provider_keys = await provider_credentials.load_for_org(
            profile.get("organization_id"))
    except Exception as exc:  # noqa: BLE001 - fall back to server keys, never fail the call
        logger.warning("byok_unavailable", error=str(exc)[:200],
                       impact="using server provider keys for this call",
                       source="PROVIDERS")

    session = _build_session(tools=tool_list, system_prompt=system_prompt, profile=profile,
                             route=_llm_route, tenant_keys=_tenant_provider_keys)

    is_demo = phone == "demo"
    # Demo (browser) calls: NO server-side noise cancellation. BVC() was found to
    # suppress the user's real browser speech — Deepgram produced zero transcripts
    # with BVC on, whereas STT worked reliably before it was added. Browser demos
    # already get the browser's own echo cancellation + noise suppression (enabled
    # by default by the LiveKit JS SDK), and agent-echo false-turns are handled by
    # the interruption guard in _build_session. close_on_disconnect ends the demo
    # session promptly when the browser leaves.
    # CRITICAL for telephony: restrict the AgentSession INPUT to the SIP caller.
    # RoomIO's default (DEFAULT_PARTICIPANT_KINDS) also accepts STANDARD
    # participants and links the FIRST accepted one as input. On outbound calls
    # the Calls-page browser MONITOR (STANDARD, publishes no audio, joins before
    # the SIP leg answers) was being linked as input → the caller was never heard
    # (no input_speech_started / STT). Limiting to PARTICIPANT_KIND_SIP makes
    # RoomIO wait for and bind the actual SIP caller, ignoring the monitor. Demo
    # (browser) calls keep the default — there the browser IS the input.
    _sip_kinds = [rtc.ParticipantKind.PARTICIPANT_KIND_SIP]
    room_input = RoomInputOptions(close_on_disconnect=is_demo)
    # Real (telephony) calls: stay open across brief disconnects. Noise
    # cancellation (BVCTelephony) is OPT-IN via ENABLE_BVC_TELEPHONY because the
    # demo path proved BVC can suppress caller speech so Deepgram produces ZERO
    # transcripts — the exact "no STT" symptom on outbound. Default OFF aligns
    # real calls with the known-working (no-BVC) demo STT path; set the env var
    # to re-enable once confirmed safe on your trunk.
    # The ASSISTANT's saved setting decides this. ENABLE_BVC_TELEPHONY is an
    # explicit kill-switch, not a required opt-in.
    #
    # It used to be required: `... and use_bvc`, defaulting to false. Since the
    # variable was never set, noise cancellation was silently OFF on every call
    # while the Assistant page showed it ON — measured across the whole log
    # table: noise_cancellation_enabled 0, noise_cancellation_disabled 96,
    # init_failed 0, with all five assistants having backgroundDenoising=true.
    #
    # On a telephony leg with no cancellation, line noise and the agent's own
    # audio reach the VAD. That shows up as VAD flapping (3,431 speaking-state
    # transitions against 607 completed replies) and as spurious barge-in
    # cancelling the agent mid-sentence (1,120 reply-speeches created, 607
    # completed — ~35% cut off). The caller hears the agent stop talking
    # part-way through an answer and says "Hello?" — logged 80 times.
    #
    # Setting ENABLE_BVC_TELEPHONY=false still forces it off for debugging.
    _bvc_env = os.getenv("ENABLE_BVC_TELEPHONY")
    _bvc_forced_off = (_bvc_env is not None
                       and _bvc_env.strip().lower() in ("0", "false", "no", "off"))
    use_bvc = not _bvc_forced_off
    if not is_demo and profile.get("background_denoising", True) and use_bvc:
        try:
            room_input = RoomInputOptions(
                close_on_disconnect=False,
                participant_kinds=_sip_kinds,
                noise_cancellation=noise_cancellation.BVCTelephony(),
            )
            logger.info("noise_cancellation_enabled", kind="BVCTelephony", call_id=ctx.room.name)
        except Exception as exc:
            logger.warning("noise_cancellation_init_failed", error=str(exc), call_id=ctx.room.name)
            room_input = RoomInputOptions(close_on_disconnect=False, participant_kinds=_sip_kinds)
    elif not is_demo:
        room_input = RoomInputOptions(close_on_disconnect=False, participant_kinds=_sip_kinds)
        logger.info("noise_cancellation_disabled",
                    reason=("ENABLE_BVC_TELEPHONY explicitly set to a false value"
                            if _bvc_forced_off
                            else "the assistant has backgroundDenoising switched off"),
                    assistant_setting=bool(profile.get("background_denoising", True)),
                    env_override=_bvc_env,
                    call_id=ctx.room.name)
    if not is_demo:
        logger.info("agent_input_restricted_to_sip", kinds="SIP",
                    call_id=ctx.room.name, room=ctx.room.name, source="LIVEKIT")

    await session.start(room=ctx.room, agent=agent, room_input_options=room_input)
    await db.upsert_active_call(ctx.room.name, phone, name, "active")

    # ── High-signal diagnostics: agent/user state + reply-speech creation ──────
    # If, after a user turn, agent_state goes listening -> thinking -> speaking,
    # reply generation fired. If it stays "listening", generation never triggered.
    _dbg_rid = ctx.room.name

    # ── Per-turn latency instrumentation + dead-air watchdog + barge-in ────────
    # One timing record per caller turn, stamped across the session handlers and
    # emitted as `turn_latency_breakdown` at first audio. All times are
    # monotonic-seconds; deltas are computed in ms. The watchdog only observes +
    # (optionally, last-resort) a single short ack — never a fake delay, never
    # repeated filler (rules 8/9).
    def _blank_turn() -> dict:
        return {"speech_start": 0.0, "speech_end": 0.0, "stt_final": 0.0,
                "llm_req": 0.0, "llm_done": 0.0, "first_audio": 0.0}
    _turn_watch: dict = {"turn_id": 0, "awaiting_audio": False, "task": None,
                         "ack_mono": 0.0, "t": _blank_turn()}
    _barge = {"pending": False}
    # Set True once the opening greeting has been delivered — a "hello?" BEFORE
    # this is the caller's own greeting; AFTER this it is a presence check (req 8).
    _greeted = {"done": False}
    # Optional guarded last-resort spoken ack when a turn is genuinely stuck.
    # OFF by default (rule 9: no repeated filler) — the real recovery is the fast
    # provider failover below. Enable with DEAD_AIR_ACK=true if desired.
    _ACK_ENABLED = os.getenv("DEAD_AIR_ACK", "false").strip().lower() in ("1", "true", "yes", "on")

    def _ms(a: float, b: float) -> int | None:
        return int((b - a) * 1000) if (a and b and b >= a) else None

    async def _dead_air_watch(turn_id: int) -> None:
        # First checkpoint at 3s → warning; second at _DEAD_AIR_S (5s) → critical
        # dead-air + (optional) one short ack. The automatic recovery is the
        # already-fast provider failover; the watchdog does not cancel the
        # in-flight generation (that would risk the working failover/stream).
        try:
            await asyncio.sleep(3.0)
            if _turn_watch["awaiting_audio"] and _turn_watch["turn_id"] == turn_id:
                el = _ms(_turn_watch["t"]["stt_final"], time.monotonic())
                logger.warning("turn_latency_warning", turn_id=turn_id, elapsed_ms=el,
                               call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
            await asyncio.sleep(max(0.0, _DEAD_AIR_S - 3.0))
        except asyncio.CancelledError:
            return
        if _turn_watch["awaiting_audio"] and _turn_watch["turn_id"] == turn_id:
            elapsed = _ms(_turn_watch["t"]["stt_final"], time.monotonic())
            cooling = bool(getattr(agent, "_any_cooling", lambda: False)())
            # Name the stage we are ACTUALLY blocked in, from the stamps we
            # already hold, instead of the catch-all "llm_or_tts".
            _t = _turn_watch["t"]
            _at = getattr(agent, "_turn_timing", {}) or {}
            if not (_at.get("llm_start") or _t["llm_req"]):
                _stage = "WAITING_FOR_LLM_START"
            elif not _at.get("first_token"):
                _stage = "WAITING_FOR_LLM_FIRST_TOKEN"
            elif not _t["first_audio"]:
                _stage = "WAITING_FOR_TTS_FIRST_AUDIO"
            else:
                _stage = "WAITING_FOR_PLAYOUT"
            _rt = getattr(agent, "_route", None)
            logger.warning("conversation_dead_air_detected",
                           turn_id=turn_id, elapsed_ms=elapsed,
                           pipeline_stage=_stage,
                           provider=((getattr(_rt, "actual_provider_used", "")
                                      or getattr(_rt, "primary_provider", "")) or "unknown"),
                           cooling=cooling,
                           call_attempt_id=_dbg_rid, call_id=_dbg_rid, room=_dbg_rid,
                           source="SESSION")
            now = time.monotonic()
            if now - _turn_watch["ack_mono"] > 25.0:
                active = getattr(_lang_state, "active", "en")
                # Prefer a LOCAL cached filler clip (req 15): interruptible, no
                # cloud-TTS cost, same-language-only. Only if no clip exists AND
                # DEAD_AIR_ACK is explicitly enabled do we fall back to cloud TTS.
                played = _play_local_clip(session, "filler", active)
                if played:
                    _turn_watch["ack_mono"] = now
                    logger.info("dead_air_ack_spoken", turn_id=turn_id, language=active,
                                via="local_clip", call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                elif _ACK_ENABLED:
                    _turn_watch["ack_mono"] = now
                    ack = "ஆமா, ஒரு நிமிஷம்..." if active == "ta" else "One moment..."
                    try:
                        session.say(ack, allow_interruptions=True)
                        logger.info("dead_air_ack_spoken", turn_id=turn_id, language=active,
                                    via="cloud_tts", call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                    except Exception as _ax:
                        logger.warning("dead_air_ack_failed", error=str(_ax), call_id=_dbg_rid)

    @session.on("agent_state_changed")
    def _dbg_agent_state(ev: Any) -> None:  # noqa: ANN401
        old = getattr(ev, "old_state", None)
        new = getattr(ev, "new_state", None)
        logger.info("SESSION_STATE_CHANGED", who="agent", old=old, new=new, call_id=_dbg_rid)
        # Derive LLM/TTS lifecycle markers from the agent state machine (no
        # behavior change — these are observations of transitions that already
        # happen): listening->thinking = LLM started; thinking->speaking = LLM
        # done + TTS starting; speaking->listening = reply playback finished.
        try:
            if new == "thinking":
                logger.info("llm_request_started", call_id=_dbg_rid, room=_dbg_rid, source="LLM")
                if not _turn_watch["t"]["llm_req"]:
                    _turn_watch["t"]["llm_req"] = time.monotonic()
            elif new == "speaking":
                logger.info("llm_response_completed", call_id=_dbg_rid, room=_dbg_rid, source="LLM")
                logger.info("tts_request_started", call_id=_dbg_rid, room=_dbg_rid, source="TTS")
                if not _turn_watch["t"]["llm_done"]:
                    _turn_watch["t"]["llm_done"] = time.monotonic()
            elif old == "speaking" and new == "listening":
                logger.info("tts_audio_completed", call_id=_dbg_rid, room=_dbg_rid, source="TTS")
            # Whenever the agent returns to listening (after a reply OR a barge-in
            # interruption) it is ready for the next user turn. If this does NOT
            # appear after an interruption, the session is stuck.
            if new == "listening":
                logger.info("session_resumed_listening", prev=old, call_id=_dbg_rid, source="SESSION")
                # Barge-in fully handled: the agent stopped speaking and is ready
                # for the caller's next turn (context/language/booking preserved).
                if _barge["pending"]:
                    _barge["pending"] = False
                    logger.info("barge_in_completed", call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
        except Exception:
            pass

    # Silence re-engagement (Phase 11): one natural line when the caller goes
    # quiet, never repeated indefinitely. The SDK moves the user to "away" after
    # user_away_timeout (default 15s) of mutual silence; "away" fires once per
    # silence episode, so this prompts once and resets when the caller speaks.
    _reengage = {"done": False}

    @session.on("user_state_changed")
    def _dbg_user_state(ev: Any) -> None:  # noqa: ANN401
        old = getattr(ev, "old_state", None)
        new = getattr(ev, "new_state", None)
        logger.info("SESSION_STATE_CHANGED", who="user", old=old, new=new, call_id=_dbg_rid)
        # Caller audio reached the pipeline. In STT turn-detection mode the SDK's
        # `input_speech_started` event does NOT fire (it is realtime/VAD-only), so
        # the user entering the "speaking" state is the reliable proof that caller
        # audio is being received and processed. The dashboard keys "Customer Voice
        # Detected" off audio_frames_started, so emit it here (verified: user_state
        # fired 96x on a real call where input_speech_started fired 0x).
        if new == "speaking" and old != "speaking":
            logger.info("audio_frames_started", call_id=_dbg_rid, room=_dbg_rid, source="STT")
            _reengage["done"] = False  # caller is back; allow a future re-engage
            # New caller utterance → start a fresh turn-timing record.
            if not _turn_watch["awaiting_audio"]:
                _turn_watch["t"] = _blank_turn()
            _turn_watch["t"]["speech_start"] = time.monotonic()
        # User stopped speaking -> end-of-turn committed to the pipeline.
        if old == "speaking" and new != "speaking":
            logger.info("user_turn_committed", call_id=_dbg_rid, room=_dbg_rid, source="TURN_DETECTION")
            _turn_watch["t"]["speech_end"] = time.monotonic()
        # Prolonged silence -> gently check in, once.
        if new == "away" and not _reengage["done"]:
            _reengage["done"] = True
            try:
                session.say("Are you still there?", allow_interruptions=True)
                logger.info("silence_reengage", call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
            except Exception as exc:  # noqa: BLE001
                logger.warning("silence_reengage_failed", error=str(exc), call_id=_dbg_rid)

    @session.on("speech_created")
    def _dbg_speech_created(ev: Any) -> None:  # noqa: ANN401
        logger.info("REPLY_SPEECH_CREATED", source=getattr(ev, "source", None), call_id=_dbg_rid)

    # Surface Groq 429 (ITPM) distinctly so the dashboard can show it, log the
    # EXACT org limit the API returned (not a guessed number), and speak a short
    # LOCAL recovery line so the caller is never met with dead silence. The
    # framework already supersedes a pending reply when a newer user turn arrives
    # (turn detection + allow_interruptions) and we now fail fast (max_retry=1),
    # so no stale reply is replayed after a newer turn.
    _recovery = {"last": 0.0}
    # Rate-limit the never-silent local clip so a storm of TTS errors in one turn
    # does not stack clips. One clip per ~15s is enough to signal "still here".
    _clip_guard = {"last": 0.0}
    # One-shot guard so a provider that loops the SAME bad config (e.g. Deepgram
    # retrying a 400 up to 4×) produces ONE CRITICAL breakpoint event, not spam.
    _stt_fail = {"critical": False}

    def _clip_lang() -> str:
        return (getattr(_lang_state, "active", "") or getattr(_call_state, "language", "") or "")

    @session.on("error")
    def _dbg_session_error(ev: Any) -> None:  # noqa: ANN401
        try:
            err = getattr(ev, "error", ev)
            src = getattr(ev, "source", None)
            # Which component raised? LiveKit plugin modules are organised as
            # …/<provider>/{tts,stt,llm}.py, so the source's module path is a
            # reliable discriminator (fixes TTS errors being logged as LLM).
            mod = (type(src).__module__ if src is not None else "").lower()
            comp = ("tts" if "tts" in mod else "stt" if "stt" in mod
                    else "llm" if "llm" in mod else "session")
            # Feed the unified provider-health registry (req 16): classify the
            # error into healthy/cooldown/quota/credits/auth/invalid_config/
            # invalid_model/unavailable and emit provider_health_changed. Permanent
            # states disable the provider for the rest of this worker process.
            if comp in ("tts", "stt", "llm") and isinstance(err, BaseException):
                _hp_prov = (getattr(session, "_jj_tts_provider", "") or "tts") if comp == "tts" \
                    else (config.DEFAULT_STT_PROVIDER if comp == "stt" else getattr(session, "_jj_llm_provider", "") or "llm")
                try:
                    PROVIDER_HEALTH.record_error(_hp_prov, comp, err)
                except Exception:
                    pass
            msg = str(err); low = msg.lower()
            status = getattr(err, "status_code", None)
            body = getattr(err, "body", None)
            is_rate = status == 429 or "429" in msg or "rate_limit" in low or "rate limit" in low
            is_credits = (status == 402 or "credit" in low or "quota" in low
                          or "insufficient" in low or "exhaust" in low or "payment" in low or "billing" in low)
            if comp == "tts":
                prov = getattr(session, "_jj_tts_provider", "") or "tts"
                if is_credits:
                    logger.warning("tts_credits_exhausted", provider=prov, detail=msg[:300],
                                   status_code=status, call_id=_dbg_rid, room=_dbg_rid, source="TTS")
                elif is_rate:
                    logger.warning("tts_rate_limited", provider=prov, detail=msg[:300],
                                   status_code=status, call_id=_dbg_rid, room=_dbg_rid, source="TTS")
                else:
                    logger.warning("tts_provider_failed", provider=prov, detail=msg[:300],
                                   status_code=status, call_id=_dbg_rid, room=_dbg_rid, source="TTS")
                # NEVER-SILENT (req 12/15): when the TTS cannot speak (credits/rate)
                # and there is no same-language cloud fallback, the FallbackAdapter
                # leaves the turn silent. Play a short caller-language local clip so
                # the caller hears a reply in THEIR language rather than dead air.
                # Same-language-only (no clip → nothing, never wrong language) and
                # rate-limited. Harmless if a backup voice did speak (rare overlap).
                if is_credits or is_rate:
                    now_c = time.monotonic()
                    if now_c - _clip_guard["last"] > 15.0:
                        if _play_local_clip(session, "unavailable", _clip_lang()):
                            _clip_guard["last"] = now_c
            elif comp == "stt":
                # 400 = invalid provider config (keyterms/options Deepgram rejects
                # at websocket connect). This is PERMANENT for this call — retrying
                # the same config just loops. Emit ONE CRITICAL breakpoint event
                # (req A3) with root cause + impact, and attempt a same-language
                # failure clip (best-effort; the session may already be closing).
                is_cfg = (status == 400) or ("400" in msg) or ("invalid" in low and "config" in low)
                if is_cfg and not _stt_fail["critical"]:
                    _stt_fail["critical"] = True
                    logger.critical(
                        "stt_stream_invalid_config", detail=msg[:300], status_code=status or 400,
                        breakpoint="STT", retryable=False,
                        impact="Deepgram rejected the STT stream (HTTP 400) → AgentSession cannot "
                               "transcribe; no STT fallback exists, so the call ends without dialogue.",
                        call_id=_dbg_rid, room=_dbg_rid, source="STT")
                    _play_local_clip(session, "unavailable", _clip_lang())
                elif not is_cfg:
                    logger.warning("stt_provider_failed", detail=msg[:300], status_code=status,
                                   call_id=_dbg_rid, room=_dbg_rid, source="STT")
            elif comp == "llm":
                if is_rate:
                    logger.warning("llm_rate_limited", detail=msg[:300], status_code=status,
                                   provider_body=str(body)[:600], call_id=_dbg_rid, room=_dbg_rid, source="LLM")
                else:
                    logger.warning("llm_provider_failed", detail=msg[:300], status_code=status,
                                   call_id=_dbg_rid, room=_dbg_rid, source="LLM")
                # Recovery/failover is owned by BoundedAgent.llm_node — nothing here.
            else:
                logger.warning("session_error", detail=msg[:200], call_id=_dbg_rid,
                               room=_dbg_rid, source="SESSION")
        except Exception:
            pass

    # Always-on STT transcript logging (independent of multilingual routing) so
    # the Live Logs page shows exactly what Deepgram transcribed per turn — the
    # key signal for diagnosing "agent heard nothing" cases.
    @session.on("user_input_transcribed")
    def _dbg_stt(ev: Any) -> None:  # noqa: ANN401 — runtime event
        try:
            is_final = getattr(ev, "is_final", True)
            text = getattr(ev, "transcript", None) or getattr(ev, "text", None) or ""
            evt = "stt_final_transcript" if is_final else "stt_partial_transcript"
            # turn_id: the final transcript opens the NEXT turn (the counter is
            # incremented just below for finals) — correlate with that turn so the
            # STT→LLM→TTS chain shares one turn_id in Live Logs (req 17).
            _tid = _turn_watch["turn_id"] + 1 if is_final else _turn_watch["turn_id"]
            logger.info(evt, text=str(text)[:300], is_final=bool(is_final),
                        turn_id=_tid, call_id=_dbg_rid, room=_dbg_rid, source="STT")
            if is_final:
                # ── STT observability (safe; no secrets) ──────────────────────
                # Deepgram per-utterance metadata surfaced by the LiveKit event,
                # best-effort (attrs vary by plugin version). Lets a real call
                # show WHETHER Tamil is being transcribed (detected lang) and how
                # confident/garbled it is — the key STT-accuracy signal.
                det = getattr(ev, "language", None)
                conf = None
                for attr in ("confidence", "avg_confidence"):
                    v = getattr(ev, attr, None)
                    if isinstance(v, (int, float)):
                        conf = round(float(v), 3); break
                dur_ms = None
                st, en = getattr(ev, "start_time", None), getattr(ev, "end_time", None)
                if isinstance(st, (int, float)) and isinstance(en, (int, float)) and en >= st:
                    dur_ms = int((en - st) * 1000)
                logger.info("stt_raw_final", text=str(text)[:300], turn_id=_tid,
                            stt_detected_language=str(det) if det is not None else None,
                            stt_confidence=conf, stt_duration_ms=dur_ms,
                            model=config.STT_MODEL, lang_setting=config.STT_LANGUAGE,
                            call_id=_dbg_rid, room=_dbg_rid, source="STT")
                if conf is not None and conf < float(os.getenv("STT_MIN_CONFIDENCE", "0.6")):
                    logger.warning("stt_low_confidence", stt_confidence=conf,
                                   text=str(text)[:160], call_id=_dbg_rid, room=_dbg_rid, source="STT")
                # Caller-frustration cue → diagnostic only (the prompt does the
                # "acknowledge first, don't restart" behaviour).
                if text and _RE_FRUSTRATION.search(str(text)):
                    logger.info("caller_frustration_detected", text=str(text)[:160],
                                call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                # Presence check (req 8): only MID-CALL (after the greeting). If a
                # reply is already pending, COALESCE — repeated "Hello?"s must not
                # each queue a reply. The spoken "I'm here" + no-re-greet is handled
                # by the prompt on the normal turn (we don't play a competing clip).
                if text and _greeted["done"] and _RE_PRESENCE.search(str(text).strip()):
                    if _turn_watch["awaiting_audio"]:
                        logger.info("presence_check_coalesced", text=str(text)[:80],
                                    reason="reply_already_pending",
                                    call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                    else:
                        logger.info("presence_check_detected", text=str(text)[:80],
                                    language=getattr(_lang_state, "active", ""),
                                    call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                # Arm the dead-air watchdog + first-audio timing for THIS turn.
                _turn_watch["turn_id"] += 1
                _turn_watch["t"]["stt_final"] = time.monotonic()
                _turn_watch["awaiting_audio"] = True
                _prev = _turn_watch.get("task")
                if _prev and not _prev.done():
                    _prev.cancel()
                _turn_watch["task"] = asyncio.create_task(_dead_air_watch(_turn_watch["turn_id"]))
        except Exception:
            pass

    # ── Truthful AUDIO-OUTPUT diagnostics (real LiveKit Agents 1.8.4 events) ──────
    # tts_audio_completed only proves TTS *generated* audio. The REAL proof the
    # reply was pushed to the room → SIP participant is the audio output's
    # playback_started / playback_finished (io.PlaybackFinishedEvent), which fire
    # on session.output.audio (NOT the session). All handlers only log — they add
    # nothing to the realtime audio path.
    _tts_prov = getattr(session, "_jj_tts_provider", "") or ""

    # The greeting is spoken UNINTERRUPTIBLY until its audio actually reaches the
    # caller, then barge-in is armed. Without this, a VAD/STT "user speaking"
    # blip on the SIP connect transient (observed: user marked speaking 0.28s
    # after answer, 3.7s BEFORE any transcript) holds the greeting's playout and
    # the caller's first real word cancels it having played 0.00s — so the caller
    # hears nothing, says "Hello?", and the same thing happens to every reply.
    _greeting = {"handle": None, "armed": False}

    def _arm_greeting_barge_in(reason: str) -> None:
        h = _greeting.get("handle")
        if h is None or _greeting["armed"]:
            return
        _greeting["armed"] = True
        try:
            h.allow_interruptions = True
            logger.info("greeting_barge_in_armed", reason=reason,
                        call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
        except Exception as exc:
            logger.warning("greeting_barge_in_arm_failed", error=str(exc)[:160],
                           call_id=_dbg_rid, room=_dbg_rid, source="SESSION")

    try:
        _audio_out = session.output.audio
    except Exception:
        _audio_out = None
    if _audio_out is not None:
        @_audio_out.on("playback_started")
        def _on_pb_started(_ev: Any) -> None:  # noqa: ANN401 — runtime event
            logger.info("agent_audio_publish_started", call_id=_dbg_rid, room=_dbg_rid,
                        provider="livekit", tts_provider=_tts_prov, source="LIVEKIT")
            # Audio is now reaching the caller, so there is something real to
            # interrupt — hand barge-in back to the caller.
            _arm_greeting_barge_in("first_audio")
            # First audio for this turn → disarm the dead-air watchdog and emit the
            # full per-turn latency breakdown (the Phase-1 measurement signal).
            if _turn_watch["awaiting_audio"]:
                _turn_watch["awaiting_audio"] = False
                _tk = _turn_watch.get("task")
                if _tk and not _tk.done():
                    _tk.cancel()
                t = _turn_watch["t"]
                t["first_audio"] = time.monotonic()
                cooling = bool(getattr(agent, "_any_cooling", lambda: False)())
                # Read the provider/model that ACTUALLY served this turn from the
                # route rather than assuming groq-unless-cooling: that guess
                # mislabelled Groq-served fallback turns as "gemini".
                _rt = getattr(agent, "_route", None)
                provider = (getattr(_rt, "actual_provider_used", "")
                            or getattr(_rt, "primary_provider", "") or "unknown")
                turn_model = (getattr(_rt, "actual_model_used", "")
                              or getattr(_rt, "primary_model", "") or "unknown")
                # Precise LLM timing from the LLM node (start + first released token).
                at = getattr(agent, "_turn_timing", {}) or {}
                llm_start = at.get("llm_start", 0.0) or t["llm_req"]
                first_token = at.get("first_token", 0.0)
                # Per-stage deltas (ms); None when an endpoint wasn't stamped.
                stt_ms = _ms(t["speech_end"] or t["speech_start"], t["stt_final"])
                stt_to_llm_ms = _ms(t["stt_final"], llm_start)
                llm_ft_ms = _ms(llm_start, first_token)
                ft_to_audio_ms = _ms(first_token, t["first_audio"])
                ref = t["speech_end"] or t["stt_final"]
                total_ms = _ms(ref, t["first_audio"])
                # Classify the dominant slow stage (measured, not guessed).
                pairs = [("STT_FINAL_SLOW", stt_ms), ("STT_FINAL_SLOW", stt_to_llm_ms),
                         ("LLM_FIRST_TOKEN_SLOW", llm_ft_ms), ("TTS_FIRST_AUDIO_SLOW", ft_to_audio_ms)]
                worst = max((p for p in pairs if p[1] is not None), key=lambda p: p[1], default=("UNKNOWN", None))
                cls = worst[0]
                if cls == "LLM_FIRST_TOKEN_SLOW" and cooling:
                    cls = "LLM_FAILOVER_SLOW"
                latency = total_ms if total_ms is not None else _ms(t["stt_final"], t["first_audio"])
                band = ("ideal" if latency is not None and latency <= 2000
                        else "acceptable" if latency is not None and latency < 3000
                        else "warning" if latency is not None and latency < 5000 else "critical")
                logger.info("turn_latency_breakdown", turn_id=_turn_watch["turn_id"],
                            language=getattr(_lang_state, "active", "en"), provider=provider,
                            model=turn_model,
                            speech_end_to_stt_final_ms=stt_ms,
                            stt_final_to_llm_start_ms=stt_to_llm_ms,
                            llm_start_to_first_tok_ms=llm_ft_ms,   # 'token' in a field name is redacted by _mask
                            first_tok_to_first_audio_ms=ft_to_audio_ms,
                            speech_end_to_first_audio_ms=total_ms, total_ms=latency,
                            band=band, slow_stage=cls,
                            call_attempt_id=_dbg_rid, call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                logger.info("response_first_audio_latency", turn_id=_turn_watch["turn_id"],
                            stt_final_to_first_audio_ms=_ms(t["stt_final"], t["first_audio"]),
                            band=band, provider=provider,
                            call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                if latency is not None and latency >= 5000:
                    logger.warning("turn_latency_critical", turn_id=_turn_watch["turn_id"],
                                   total_ms=latency, slow_stage=cls,
                                   call_id=_dbg_rid, room=_dbg_rid, source="SESSION")

        @_audio_out.on("playback_finished")
        def _on_pb_finished(ev: Any) -> None:  # noqa: ANN401 — runtime event
            interrupted = bool(getattr(ev, "interrupted", False))
            # synchronized_transcript = the portion of the reply actually PLAYED
            # to the caller. Comparing it with the full generated text (logged by
            # turn_summary below) proves whether a short reply was a short
            # GENERATION or audio cut off mid-playback by a barge-in.
            played_text = str(getattr(ev, "synchronized_transcript", "") or "")
            played_s = round(float(getattr(ev, "playback_position", 0) or 0), 2)
            logger.info("agent_audio_publish_completed", call_id=_dbg_rid, room=_dbg_rid,
                        provider="livekit", interrupted=interrupted,
                        played_s=played_s,
                        played_text=played_text[:300],
                        source="LIVEKIT")
            # Audio was produced but the caller heard NONE of it. This is the
            # signature of a reply cancelled before its first frame — the caller
            # experiences pure silence and starts saying "Hello?".
            if interrupted and played_s <= 0.0:
                logger.warning("agent_audio_never_played", call_id=_dbg_rid, room=_dbg_rid,
                               provider="livekit", played_s=played_s,
                               impact="caller heard nothing of this turn",
                               source="LIVEKIT")
            if interrupted:
                # True general (mid-reply) barge-in — the reply audio was cut off.
                logger.info("interruption_detected", during="reply",
                            call_id=_dbg_rid, room=_dbg_rid, source="SESSION")
                # Mark so session_resumed_listening can log barge_in_completed —
                # the caller's next turn continues with context/language intact.
                _barge["pending"] = True
    else:
        logger.warning("agent_audio_output_unavailable", call_id=_dbg_rid, room=_dbg_rid, source="LIVEKIT")

    # ── Per-turn truth log (F): on every committed message, record the FULL text
    # the model generated, its length, and whether it was interrupted. This is the
    # single signal that disambiguates a fragmentary reply ("I'm"):
    #   • assistant text is a full sentence + interrupted=True  → barge-in cut the
    #     PLAYBACK (generation was fine);
    #   • assistant text is itself a fragment + interrupted=False → the LLM
    #     GENERATED a fragment (Groq rate-limit / truncation) — the real bug.
    _turn_counter = {"n": 0}

    @session.on("conversation_item_added")
    def _on_item_added(ev: Any) -> None:  # noqa: ANN401 — runtime event
        try:
            item = getattr(ev, "item", None)
            role = getattr(item, "role", None)
            if role not in ("user", "assistant"):
                return
            try:
                text = item.text_content or ""
            except Exception:
                text = ""
            interrupted = bool(getattr(item, "interrupted", False))
            if role == "assistant":
                _turn_counter["n"] += 1
                # Track the agent's pending question in CallState (best-effort):
                # if the reply ends with a question, a short caller reply next
                # turn should be read against it (the directive surfaces this).
                try:
                    q = (text or "").strip()
                    if q.endswith("?") and not interrupted:
                        _call_state.set_pending(None, question=q[-140:])
                    elif q:
                        _call_state.clear_pending()
                except Exception:
                    pass
            logger.info(
                "turn_summary", role=role, turn_id=_turn_counter["n"],
                text=str(text)[:400], text_len=len(text or ""),
                interrupted=interrupted,
                call_id=_dbg_rid, room=_dbg_rid, source="TURN",
            )
            # Flag a suspiciously short assistant reply that was NOT interrupted —
            # i.e. the model itself produced a fragment (the symptom the user saw).
            if (role == "assistant" and not interrupted
                    and len((text or "").split()) <= 2
                    and not (text or "").strip().endswith((".", "!", "?"))):
                logger.warning(
                    "incomplete_llm_response", turn_id=_turn_counter["n"],
                    text=str(text)[:120], call_id=_dbg_rid, room=_dbg_rid, source="LLM",
                )
        except Exception:
            pass

    # Caller audio actually reaching the agent/STT (VAD speech onset).
    @session.on("input_speech_started")
    def _on_input_speech(_ev: Any) -> None:  # noqa: ANN401 — runtime event
        logger.info("audio_frames_started", call_id=_dbg_rid, room=_dbg_rid, source="STT")

    # STT initialized + ready for this call (Deepgram realtime pipeline).
    logger.info("stt_connected", provider=config.DEFAULT_STT_PROVIDER, model=config.STT_MODEL,
                call_id=_dbg_rid, room=_dbg_rid, source="STT")
    # When the STT stream opened, so its real lifetime can be measured at
    # teardown. There were 99 stt_connected events in the log table and ZERO
    # close events, which is why Deepgram's billable duration could only be
    # inferred: we could show no audio was transcribed after the hangup, but
    # not when the stream actually closed.
    agent_tools._stt_connected_mono = time.monotonic()
    agent_tools._stt_provider = config.DEFAULT_STT_PROVIDER
    agent_tools._stt_model = config.STT_MODEL

    # Real per-turn provider metrics (truthful latency, not state-derived).
    # Which assistant the usage belongs to, for per-assistant cost attribution.
    _usage_assistant_id = (profile.get("id")
                           if profile.get("_profile_source") == "assistant" else None)

    @session.on("metrics_collected")
    def _on_metrics(ev: Any) -> None:  # noqa: ANN401 — runtime event
        try:
            m = getattr(ev, "metrics", None)
            cls = type(m).__name__ if m is not None else ""
            if cls == "LLMMetrics":
                # PROVIDER-REPORTED token usage, per request.
                #
                # The stored per-call figure was
                #   user_chars//4 + len(system_prompt)//4
                # which counts the system prompt ONCE for the whole call rather
                # than once per request, and ignores tool schemas and history
                # entirely. On room call-917397075913-5801 that stored 2,000
                # input tokens for ~18 requests whose real cost was an order of
                # magnitude higher. Accumulating what the provider actually
                # reports replaces the estimate with a measurement; `estimated`
                # stays available as a labelled fallback when a provider
                # returns no usage block.
                _pt = int(getattr(m, "prompt_tokens", 0) or 0)
                _ct = int(getattr(m, "completion_tokens", 0) or 0)
                _cached = int(getattr(m, "prompt_cached_tokens", 0) or 0)
                if _pt or _ct:
                    agent_tools._usage_prompt_tokens = (
                        getattr(agent_tools, "_usage_prompt_tokens", 0) + _pt)
                    agent_tools._usage_completion_tokens = (
                        getattr(agent_tools, "_usage_completion_tokens", 0) + _ct)
                    agent_tools._usage_cached_tokens = (
                        getattr(agent_tools, "_usage_cached_tokens", 0) + _cached)
                    agent_tools._usage_requests = (
                        getattr(agent_tools, "_usage_requests", 0) + 1)
                _rt = getattr(agent_tools, "_llm_route", None)
                logger.info("llm_response_received", call_id=_dbg_rid, room=_dbg_rid, source="LLM",
                            ttft_ms=round(float(getattr(m, "ttft", 0) or 0) * 1000),
                            duration_ms=round(float(getattr(m, "duration", 0) or 0) * 1000),
                            # request_id is the provider's own id — the join key
                            # back to Groq's request log, which nothing captured
                            # before, so app records could not be reconciled
                            # against the provider's.
                            provider_request_id=(str(getattr(m, "request_id", "") or "") or None),
                            prompt_tokens=_pt, completion_tokens=_ct,
                            cached_tokens=_cached,
                            total_tokens=int(getattr(m, "total_tokens", 0) or 0),
                            usage_source="provider" if (_pt or _ct) else "absent",
                            cancelled=bool(getattr(m, "cancelled", False)),
                            provider=(getattr(_rt, "actual_provider_used", "") or None),
                            model=(getattr(_rt, "actual_model_used", "") or None),
                            assistant_id=_usage_assistant_id,
                            error=(str(getattr(m, "error", "") or "")[:200] or None))
            elif cls == "TTSMetrics":
                logger.info("tts_metrics", call_id=_dbg_rid, room=_dbg_rid, source="TTS",
                            provider=_tts_prov,
                            ttfb_ms=round(float(getattr(m, "ttfb", 0) or 0) * 1000),
                            audio_s=round(float(getattr(m, "audio_duration", 0) or 0), 2),
                            error=(str(getattr(m, "error", "") or "")[:200] or None))
        except Exception:
            pass

    # ── Language detection + lock (ALWAYS, every provider) ────────────────────
    # Each final STT result carries the detected language. This establishes the
    # conversation language from the first meaningful utterance then LOCKS it
    # (per-turn mis-detection / English loan-words / short acks never flip it),
    # mirrors it into CallState, and drives the LLM reply-language directive.
    # This MUST run for every TTS provider — the LLM's reply language depends on
    # it. Only the per-turn TTS `update_options` re-route below is provider-
    # specific: Gemini/text-driven models speak whatever language the TEXT is in,
    # so they need no re-route; Sarvam/ElevenLabs/Cartesia do.
    if config.MULTILINGUAL_TTS_ENABLED and getattr(session, "_jj_pipeline", False):
        _ml_tts = getattr(session, "_jj_tts", None)
        _ml_provider = getattr(session, "_jj_tts_provider", "")
        _tts_needs_route = (_ml_provider in ("sarvam", "elevenlabs", "cartesia")
                            and _ml_tts is not None and hasattr(_ml_tts, "update_options"))
        _rid = ctx.room.name

        @session.on("user_input_transcribed")
        def _lang_route(event: Any) -> None:  # noqa: ANN401 — runtime event
            if not getattr(event, "is_final", True):
                return
            detected = getattr(event, "language", None)
            base = lang.normalize_lang(detected)
            text = str(getattr(event, "transcript", None) or getattr(event, "text", None) or "")
            words = len(text.split())
            logger.info("LANGUAGE_DETECTED", detected=str(detected), base=base,
                        words=words, call_id=_rid)
            logger.info("STT_LANGUAGE", language=str(detected), call_id=_rid)
            # An EXPLICIT instruction ("English la sollunga", "in Tamil") always
            # wins and (re)locks the conversation language (rule 6).
            explicit = "en" if _RE_SWITCH_EN.search(text) else ("ta" if _RE_SWITCH_TA.search(text) else None)
            prev = _lang_state.active
            was_established = _lang_state.established
            changed = _lang_state.observe(detected, text, explicit)
            if explicit:
                logger.info("conversation_language_changed_explicitly",
                            to=_lang_state.active, call_id=_rid, room=_rid, source="SESSION")
                logger.info("LANGUAGE_SWITCH_EXPLICIT", to=_lang_state.active, call_id=_rid)
            if _lang_state.established and not was_established:
                logger.info("conversation_language_locked", language=_lang_state.active,
                            call_id=_rid, room=_rid, source="SESSION")
            if not changed:
                return
            base = _lang_state.active
            _call_state.set_language(base)   # mirror into structured state → LLM directive
            logger.info("language_lock_changed", **{"previous_language": prev},
                        new_language=base,
                        reason=("explicit_request" if explicit else "established_from_speech"),
                        call_id=_rid, room=_rid, source="SESSION")
            logger.info("LANGUAGE_CHANGED", **{"from": prev}, to=base,
                        established=_lang_state.established, call_id=_rid)
            logger.info("LLM_RESPONSE_LANGUAGE", language=base, call_id=_rid)
            # Provider-specific TTS re-route (skipped for text-driven TTS like Gemini).
            if not _tts_needs_route:
                return
            route = lang.tts_route(base, _ml_provider)
            if route is None:
                return
            try:
                _ml_tts.update_options(**{route["kwarg"]: route["lang"]})
                logger.info("TTS_LANGUAGE_SELECTED", language=route["lang"],
                            provider=route["provider"], call_id=_rid)
            except Exception as exc:
                logger.warning("tts_language_switch_failed", base=base,
                               error=str(exc), call_id=_rid)

    user_in_room = any("sip_" in p.identity for p in ctx.room.remote_participants.values())
    direction = "INBOUND" if user_in_room else "OUTBOUND"

    # Insert a placeholder call row so transcript_messages can FK against it during the call.
    # complete_call() in the shutdown hook fills in outcome / duration / recording / etc.
    # Record which assistant handled the call — only when the profile resolved
    # from the assistants table (a valid calls.assistantId FK). Campaign/default
    # agent_profiles leave it NULL.
    resolved_assistant_id = (
        profile.get("id") if profile.get("_profile_source") == "assistant" else None
    )
    call_id = await db.create_call_row(
        phone_number=phone,
        lead_name=meta.get("lead_name") or name or None,
        direction=direction,
        livekit_room_name=ctx.room.name,
        assistant_id=resolved_assistant_id,
    )
    agent_tools._call_id = call_id
    logger.info("call_row_created", call_id=call_id, room=ctx.room.name, source="DATABASE")
    # Expose call_id on ctx so custom_tools (Task 5) can record invocations
    # against the right Call row when the LLM fires them mid-conversation.
    ctx._call_id = call_id  # type: ignore[attr-defined]

    # Stream transcript turns into transcript_messages so the dashboard /calls/[id] view is
    # populated live. Hook the conversation_item_added event emitted by livekit-agents 1.x.
    def _stream_turn(role: str, content: Any) -> None:
        if not role:
            return
        if isinstance(content, list):
            content = " ".join(str(c) for c in content if isinstance(c, str))
        text = str(content or "").strip()
        if not text:
            return
        # Diagnostic: shows user turns reaching the agent and assistant replies.
        logger.info("TURN", role=str(role).upper(), chars=len(text), call_id=ctx.room.name)
        asyncio.create_task(
            _insert_transcript_with_redaction(call_id, role.upper(), text, profile, phone)
        )


    async def _insert_transcript_with_redaction(
        cid: str, role: str, text: str, prof: dict, caller_phone: str,
    ) -> None:
        """Apply PII redaction then persist the transcript message."""
        try:
            mode = await db.get_setting("PII_STORAGE_MODE") or "redacted_only"
        except Exception:
            mode = "redacted_only"
        redaction_enabled = prof.get("redaction_enabled", True)
        protected_nums: tuple[str, ...] = (caller_phone,)
        if redaction_enabled:
            redacted_text, had_pii = redactor.redact(text, protected_nums)
        else:
            redacted_text, had_pii = text, False

        if redaction_enabled and mode == "redacted_only":
            db_content = redacted_text
            db_redacted = None
        else:
            db_content = text
            db_redacted = redacted_text if redaction_enabled else None

        await db.insert_transcript_message(
            call_id=cid,
            role=role,
            content=db_content,
            content_redacted=db_redacted,
            has_pii=had_pii,
        )
        if had_pii:
            await db.mark_call_has_pii(cid)

    @session.on("conversation_item_added")
    def _on_item(event: Any) -> None:  # noqa: ANN401 — runtime event from livekit
        item = getattr(event, "item", None) or event
        role = getattr(item, "role", None)
        content = getattr(item, "text_content", None)
        if content is None:
            content = getattr(item, "content", None)
        _stream_turn(role, content)

    # NOTE: call recording (LiveKit Egress → R2) now starts AFTER the call is
    # genuinely connected — see _maybe_start_recording(...) called below once the
    # outbound SIP participant has answered (or immediately for an in-room
    # caller). Starting it here (pre-dial) recorded ring/silence.

    # ── INBOUND answer anchor ────────────────────────────────────────────────
    # Inbound has different semantics from outbound and must not borrow them:
    # there is no dial and no wait_until_answered. The carrier has ALREADY
    # connected the leg before LiveKit dispatches this job, which is why the
    # SIP participant is in the room the moment we start. The earliest answer
    # signal available to the worker is therefore "the SIP participant is
    # present at job start" — close to, but not identical to, the carrier's own
    # connect instant, so it is labelled as such rather than presented as
    # carrier-confirmed. answer_source distinguishes the two in Live Logs and
    # tells the cost view which figures are provider-grade.
    if user_in_room and getattr(agent_tools, "_answered_mono", None) is None:
        agent_tools._answered_mono = time.monotonic()
        agent_tools._answered_at = datetime.now(UTC)
        agent_tools._ringing_seconds = 0.0
        logger.info("call_answered", phone=phone, ringing_seconds=0.0,
                    answer_source="inbound_participant_present_at_start",
                    call_id=ctx.room.name, room=ctx.room.name, source="LIVEKIT")

    # Outbound dial-out branch
    if phone not in ("unknown", "demo") and not user_in_room:
        # ── DND race-close (Feature Pack 4 / Task 8) ─────────────────────────
        # Re-check DND just before SIP dial: the dnd_numbers table may have been
        # updated between dispatch and this point (e.g. opt-out during delay).
        _dnd_org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
        if await db.is_on_dnd(_dnd_org_id, phone):
            logger.warning("dnd_race_caught", phone=phone)
            await db.log_error("agent", f"DND race caught for {phone}")
            agent_tools._closed_outcome = "OPT_OUT"
            await db.remove_active_call(ctx.room.name)
            return

        _dial_mono = time.monotonic()
        # Marks that a SIP leg was attempted. If no answer stamp follows, the
        # call never connected and must bill zero connected seconds.
        agent_tools._dial_attempted = True
        logger.info("dialing_out", phone=phone, trunk=config.OUTBOUND_TRUNK_ID,
                    call_id=ctx.room.name, room=ctx.room.name, source="VOBIZ")
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=config.OUTBOUND_TRUNK_ID,
                    sip_call_to=phone,
                    participant_identity=f"sip_{phone}",
                    wait_until_answered=True,
                )
            )
            # THE authoritative answer: this call blocks until the carrier
            # reports the call picked up. Verified against the Vobiz CDR for
            # room call-917397075913-5801 — this line logged 13:51:25.113 IST
            # and Vobiz recorded "Call picked 13:51:25". Everything billable
            # starts here; the ringing before it is not connected time.
            agent_tools._answered_mono = time.monotonic()
            agent_tools._answered_at = datetime.now(UTC)
            _ring_s = round(agent_tools._answered_mono - _dial_mono, 2)
            agent_tools._ringing_seconds = _ring_s
            logger.info("call_answered", phone=phone, ringing_seconds=_ring_s,
                        answer_source="sip_wait_until_answered",
                        call_id=ctx.room.name, room=ctx.room.name, source="VOBIZ")
        except Exception as exc:
            logger.error("dial_out_failed", error=str(exc), phone=phone,
                         call_id=ctx.room.name, room=ctx.room.name, source="VOBIZ")
            await db.log_error("agent", "dial out failed", str(exc))
            await db.remove_active_call(ctx.room.name)
            return

    # The call is now genuinely connected (outbound answered, or an in-room
    # caller/demo). Start recording the REAL room audio (SIP caller + AI agent)
    # if policy + R2 are configured. Observability only — never blocks the call.
    await _maybe_start_recording(ctx, profile, agent_tools)

    # ── Attach caller audio that was ALREADY subscribed ───────────────────────
    # The `track_subscribed` handler forwards the caller's track to the recorder,
    # but the caller's SIP audio is normally subscribed well before this point,
    # when `agent_tools._recorder` is still None (and `attach_caller_track` also
    # no-ops until `start()` has run). The track is never offered again, so the
    # caller was never mixed in — only the agent's own TTS tee was, which is why
    # a 30s call produced a ~2s WAV ending with the greeting.
    #
    # Sweeping the room here closes that window. attach_caller_track dedupes by
    # track SID, so a track the event handler already attached is skipped.
    try:
        _rec = getattr(agent_tools, "_recorder", None)
        if _rec is not None:
            for _p in ctx.room.remote_participants.values():
                if not _is_sip_participant(getattr(_p, "identity", "") or "", _p):
                    continue          # never record the agent's own output track
                for _pub in getattr(_p, "track_publications", {}).values():
                    _tk = getattr(_pub, "track", None)
                    _kind = str(getattr(_pub, "kind", "") or getattr(_tk, "kind", ""))
                    if _tk is None or not _is_audio_kind(
                            getattr(_pub, "kind", None) or getattr(_tk, "kind", None)):
                        continue
                    _sid = str(getattr(_pub, "sid", "") or getattr(_tk, "sid", "") or "")
                    logger.info("recording_existing_caller_track_found",
                                participant=getattr(_p, "identity", ""), track_sid=_sid,
                                track_kind=_kind, room=ctx.room.name, source="RECORDING")
                    _rec.attach_caller_track(_tk, track_sid=_sid)
    except Exception as _sx:  # noqa: BLE001 - recording must never affect the call
        logger.warning("recording_existing_track_sweep_failed", error=str(_sx)[:200],
                       room=getattr(ctx.room, "name", ""), source="RECORDING")

    # ── Pre-warm the knowledge embedder (off the turn path) ───────────────────
    # The first knowledge lookup of the process loads a sentence-transformers
    # model: measured 4.1 s to load, 6.4 s for that first search, versus ~130 ms
    # once warm. Until now that cost was paid INSIDE llm_node on the caller's
    # first question, before the LLM was called, so the caller heard silence.
    #
    # Doing it here overlaps the load with the greeting playout (~7 s), so the
    # first real question hits a warm embedder. Fire-and-forget: the turn path is
    # separately time-bounded, so if this is slow or fails nothing waits on it.
    try:
        if resolved_assistant_id:
            async def _warm_knowledge() -> None:
                try:
                    t0 = time.monotonic()
                    await knowledge.embed_texts(["warm"])
                    logger.info("knowledge_prewarm_done",
                                ms=int((time.monotonic() - t0) * 1000),
                                room=ctx.room.name, source="KNOWLEDGE")
                except Exception as exc:  # noqa: BLE001
                    logger.warning("knowledge_prewarm_failed", error=str(exc)[:200],
                                   room=ctx.room.name, source="KNOWLEDGE")
            # The local binding lives for the whole entrypoint, which keeps the
            # task referenced (a bare create_task can be garbage collected).
            _warm_task = asyncio.create_task(_warm_knowledge())  # noqa: RUF006
    except Exception as _wx:  # noqa: BLE001 - prewarm must never affect the call
        logger.warning("knowledge_prewarm_schedule_failed", error=str(_wx)[:200],
                       room=getattr(ctx.room, "name", ""), source="KNOWLEDGE")

    # ── Capture the telephony-provider join key ───────────────────────────────
    # Vobiz records the PSTN leg on its own side. To fetch THAT recording after
    # the call we need a deterministic key linking this call to the Vobiz CDR,
    # and the only one both sides share is the SIP Call-ID: LiveKit exposes the
    # trunk provider's value as the `sip.callIDFull` participant attribute, and
    # Vobiz accepts it as the `sip_call_id` filter on GET /cdr.
    #
    # It MUST be captured while the call is up — the attribute disappears with
    # the participant, and afterwards a call could only be matched by number +
    # timestamp, which is ambiguous for repeat calls to the same number.
    # Observability only: wrapped so it can never affect the call.
    try:
        for _p in ctx.room.remote_participants.values():
            if not _is_sip_participant(getattr(_p, "identity", "") or "", _p):
                continue
            _attrs = getattr(_p, "attributes", None) or {}
            _sip_full = _attrs.get("sip.callIDFull") or ""
            if not _sip_full:
                continue
            logger.info("sip_call_identity_captured",
                        sip_call_id_full=_sip_full,
                        lk_call_id=_attrs.get("sip.callID", ""),
                        trunk_id=_attrs.get("sip.trunkID", ""),
                        room=ctx.room.name, source="VOBIZ")
            await db.set_sip_call_identity(ctx.room.name, sip_call_id=_sip_full)
            break
        else:
            # Not fatal, but it means this call cannot later be matched to its
            # Vobiz recording by key — worth seeing in the logs.
            logger.warning("sip_call_identity_missing", room=ctx.room.name,
                           source="VOBIZ")
    except Exception as _ix:  # noqa: BLE001 - bookkeeping must never affect the call
        logger.warning("sip_call_identity_capture_failed", error=str(_ix)[:200],
                       room=getattr(ctx.room, "name", ""), source="VOBIZ")

    # The TTS node tees the agent's own audio into the recorder, so the Agent
    # instance needs the same handle the tools object got.
    try:
        agent._recorder = getattr(agent_tools, "_recorder", None)  # type: ignore[attr-defined]
    except Exception:  # noqa: BLE001
        pass

    # ── TTS-bypass audio diagnostic (opt-in) ──────────────────────────────────
    # When DIAGNOSTIC_AUDIO=true, play a known local WAV straight to the caller
    # (no TTS) to pinpoint whether silence is a TTS fault or a RoomIO/SIP fault.
    await _run_diagnostic_audio(ctx, session)

    # ── Voicemail detection ──────────────────────────────────────────────────
    # Heuristic: first user transcript turn that matches voicemail phrases or
    # exceeds a long-message threshold ⇒ treat as answering machine, optionally
    # leave a message, then disconnect. Off by default per assistant.
    assistant_voicemail_enabled = bool(profile.get("voicemail_detection"))
    voicemail_msg = profile.get("voicemail_message") or ""
    voicemail_detected = {"flag": False}
    voicemail_window_start = time.time()

    if assistant_voicemail_enabled:
        @session.on("user_input_transcribed")
        def _vm_check(event: Any) -> None:  # noqa: ANN401 — runtime event
            if voicemail_detected["flag"]:
                return
            if not getattr(event, "is_final", True):
                return
            text = getattr(event, "transcript", "") or ""
            elapsed = time.time() - voicemail_window_start
            if looks_like_voicemail(text, elapsed):
                voicemail_detected["flag"] = True
                agent_tools._closed_outcome = "VOICEMAIL"
                agent_tools._closed_reason = "voicemail detected on first turn"
                logger.info(
                    "voicemail_detected", phone=phone, transcript=text[:120]
                )
                asyncio.create_task(_handle_voicemail(session, voicemail_msg, ctx))

    # Recording-consent prompt — only when the assistant has explicit copy and
    # recording is enabled. Plays after firstMessage and before the agent's
    # generated greeting. allow_interruptions=False so it always completes.
    consent = profile.get("recording_consent_message")
    if profile.get("recording_enabled", False) and consent:
        try:
            await session.say(consent, allow_interruptions=False)
        except Exception as exc:
            logger.warning("consent_prompt_failed", error=str(exc))

    # Greet — speak first, once, as soon as the session + TTS are ready.
    # Browser demo uses a fixed English greeting routed through the normal
    # (Sarvam) TTS path so it verifies real audio out; barge-in stays enabled so
    # the caller can interrupt. Real calls keep the prompt-driven intro. After
    # the greeting the session just listens; the per-turn language router then
    # switches to the caller's language on their first utterance.
    _fm_preview = (profile.get("first_message") or "").strip()
    _greeting_mode = (
        "demo" if phone == "demo" else ("first_message" if _fm_preview else "generate_reply")
    )
    logger.info("greeting_mode", mode=_greeting_mode,
                first_message_present=bool(_fm_preview), build=AGENT_BUILD,
                call_id=ctx.room.name)
    if phone == "demo":
        greeting = "Hello, welcome to VIMS Enterprise. This is Abi from the front desk. How may I help you today?"
        logger.info("FIRST_GREETING_STARTED", call_id=ctx.room.name)
        try:
            # Non-blocking: say() schedules the greeting through the normal
            # (Sarvam) TTS path; a done-callback logs completion when playout
            # finishes OR the caller barges in. allow_interruptions keeps
            # barge-in working. Runs once (entrypoint runs once per call).
            handle = session.say(greeting, allow_interruptions=False)
            _greeting["handle"] = handle

            async def _arm_later() -> None:
                await asyncio.sleep(GREETING_PROTECT_MAX_S)
                _arm_greeting_barge_in("timeout")
            asyncio.create_task(_arm_later())

            def _greeting_done(h: Any) -> None:  # noqa: ANN401 — SpeechHandle
                _greeted["done"] = True   # presence checks are now meaningful (req 8)
                logger.info("FIRST_GREETING_COMPLETED", call_id=ctx.room.name,
                            interrupted=bool(getattr(h, "interrupted", False)))
            handle.add_done_callback(_greeting_done)
        except Exception as exc:
            logger.error("FIRST_GREETING_FAILED", error=str(exc), call_id=ctx.room.name)
    else:
        # Real calls: speak the assistant's configured first_message DETERMINISTICALLY
        # (via TTS) as soon as the call is answered — don't depend on the LLM
        # producing an opening turn, and don't wait for the customer to speak
        # first. Falls back to a prompt-driven generate_reply only when the
        # assistant has no first_message.
        first_message = (profile.get("first_message") or "").strip()
        if first_message:
            # Fill template placeholders so the caller doesn't hear a literal
            # "{lead_name}"/"{business_name}". Uses the SAME resolved identity as
            # the system prompt. When the customer name is unknown, the name is
            # dropped gracefully ("Hi {lead_name}, this is Priya…" -> "Hi, this is
            # Priya…") rather than greeting a placeholder like "there" or leaking
            # the "Dashboard Monitor" diagnostics participant.
            _bn = business_name
            _svc = str(meta.get("service_type") or "your enquiry")
            if customer_name:
                first_message = first_message.replace("{lead_name}", customer_name)
            else:
                # Remove name-bearing lead-ins so the greeting reads naturally
                # with no name at all.
                first_message = re.sub(
                    r"\bis this \{lead_name\}\s*\??\s*", "", first_message, flags=re.I
                )
                first_message = (first_message
                                 .replace("Hi {lead_name}, ", "Hi, ")
                                 .replace("Hi {lead_name},", "Hi,")
                                 .replace("Hello {lead_name}, ", "Hello, ")
                                 .replace("{lead_name}, ", "")
                                 .replace(", {lead_name}", "")
                                 .replace("{lead_name}", ""))
            first_message = (first_message
                             .replace("{business_name}", _bn)
                             .replace("{service_type}", _svc))
            # Tidy any double spaces / stray leading punctuation left by removals.
            first_message = re.sub(r"\s{2,}", " ", first_message)
            first_message = re.sub(r"^(Hi|Hello)\s*,\s*,", r"\1,", first_message).strip()
            logger.info("FIRST_GREETING_STARTED", source="first_message",
                        has_customer_name=bool(customer_name), call_id=ctx.room.name)
            try:
                # allow_interruptions=False ONLY until the first frame reaches
                # the caller (see _arm_greeting_barge_in). A pick-up "Hello" must
                # not cancel a greeting the caller has not heard yet.
                handle = session.say(first_message, allow_interruptions=False)
                _greeting["handle"] = handle
                # Safety net: if playback never starts, never leave the greeting
                # permanently uninterruptible.
                async def _arm_later() -> None:
                    await asyncio.sleep(GREETING_PROTECT_MAX_S)
                    _arm_greeting_barge_in("timeout")
                asyncio.create_task(_arm_later())

                def _greeting_done(h: Any) -> None:  # noqa: ANN401 — SpeechHandle
                    _greeted["done"] = True   # presence checks are now meaningful (req 8)
                    was_int = bool(getattr(h, "interrupted", False))
                    if was_int:
                        # Barge-in on the greeting. This cancels ONLY this speech
                        # handle — STT, audio input and the session keep running;
                        # the next user turn must still generate a reply.
                        logger.info("interruption_detected", during="first_greeting", call_id=ctx.room.name)
                        logger.info("speech_cancelled", which="first_greeting", call_id=ctx.room.name)
                    logger.info("FIRST_GREETING_COMPLETED", call_id=ctx.room.name,
                                interrupted=was_int)
                handle.add_done_callback(_greeting_done)
            except Exception as exc:
                logger.error("FIRST_GREETING_FAILED", error=str(exc), call_id=ctx.room.name)
        else:
            logger.info("FIRST_GREETING_STARTED", source="generate_reply", call_id=ctx.room.name)
            await session.generate_reply(instructions="Begin the call now per your system prompt.")

    # Shutdown handler — registered separately
    agent_tools._call_start_time = time.time()
    agent_tools._room_name = ctx.room.name
    # Carry the routing decision to the shutdown hook, which bills the call.
    agent_tools._llm_route = _llm_route
    agent_tools._session = session
    ctx.add_shutdown_callback(lambda: _shutdown_hook(ctx, agent_tools, session, profile, phone, name))


# ── Voicemail handler ────────────────────────────────────────────────────────

async def _handle_voicemail(session, msg: str, ctx: JobContext) -> None:
    """Optional: leave a recorded message, then disconnect."""
    if msg:
        try:
            await session.generate_reply(
                instructions=f"Speak this message exactly, no preamble: {msg}"
            )
            await asyncio.sleep(2)
        except Exception as exc:
            logger.warning("voicemail_msg_failed", error=str(exc))
    try:
        await ctx.shutdown(reason="voicemail")
    except Exception:
        pass


# ── Shutdown hook ────────────────────────────────────────────────────────────

def _billable_seconds(ctx: JobContext, agent_tools) -> tuple[int, str]:
    """(seconds, basis) — the duration the call is BILLED on.

    MEASURED on room call-917397075913-5801: the caller answered at 08:21:25
    and hung up at 08:24:59 — 214s, which is exactly what the carrier's call
    log and the egress recording both show. The stored duration was 3417s,
    because it ran from job start to whenever the shutdown hook finally fired
    (LiveKit's room reaper, 09:18:23). Every duration-derived cost line —
    Vobiz telephony, Deepgram STT, LiveKit media — inherited that 16x error.

    Billing anchors on the two events a carrier bills on:
      answer  = the SIP participant being present (greeting starts here)
      hangup  = the SIP participant leaving
    Either missing falls back to the old wall-clock, with the basis reported
    so an estimate is never mistaken for a measurement.
    """
    def _num(v: Any) -> float | None:
        # Must never raise: this runs inside the shutdown hook, and a bad value
        # here would stop the call row being written at all. Anything that is
        # not a real number (a mock, a stub, None) degrades to the fallback.
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    answered = _num(getattr(agent_tools, "_answered_mono", None))
    hangup = _num(getattr(ctx, "_jj_hangup_mono", None))
    # `is not None`, never truthiness: time.monotonic() may legitimately be
    # 0.0, and a falsy check there would silently bill the wrong span.
    if answered is not None and hangup is not None and hangup >= answered:
        return max(0, int(hangup - answered)), "answer_to_hangup"
    if answered is not None:
        # Agent-initiated hangup, or a teardown with no disconnect event.
        return max(0, int(time.monotonic() - answered)), "answer_to_teardown"
    # A SIP dial was attempted and never answered: busy, declined, ring-timeout
    # or a failed dial. There is NO connected time, so none may be billed.
    # Falling through to the wall-clock here charged dialling + ringing +
    # timeout as if the customer had been on the line — the carrier bills none
    # of it (Vobiz's own CDR separates "Total" from "Connected/billed").
    if getattr(agent_tools, "_dial_attempted", False):
        return 0, "no_answer"
    started = _num(getattr(agent_tools, "_call_start_time", None))
    if started is None:
        return 0, "unknown"
    return max(0, int(time.time() - started)), "job_wallclock"


async def _shutdown_hook(ctx: JobContext, agent_tools, session, profile: dict, phone: str, name: str) -> None:
    duration, duration_basis = _billable_seconds(ctx, agent_tools)
    room_seconds = int(time.time() - agent_tools._call_start_time)
    if duration_basis != "job_wallclock" and room_seconds > duration + 5:
        # The room outlived the conversation. Worth seeing: it is wasted worker
        # capacity even now that billing no longer counts it.
        logger.warning("room_outlived_call", billable_seconds=duration,
                       room_seconds=room_seconds, basis=duration_basis,
                       call_id=ctx.room.name, room=ctx.room.name, source="WORKER")
    transcript = ""
    user_chars_total = 0       # for STT estimate (we transcribed the user)
    assistant_chars_total = 0  # for TTS chars (we synthesised the assistant)
    try:
        chat_ctx = getattr(session, "chat_ctx", None)
        if chat_ctx is None:
            chat_ctx = getattr(session, "history", None)
        msgs = []
        if chat_ctx is not None:
            items = getattr(chat_ctx, "items", None)
            if items is None:
                items = getattr(chat_ctx, "messages", None)
            if callable(items):
                items = items()
            msgs = items or []
        lines = []
        for m in msgs:
            role = getattr(m, "role", None)
            content = getattr(m, "content", "")
            if isinstance(content, list):
                content = " ".join(str(c) for c in content if isinstance(c, str))
            if role and content:
                lines.append(f"[{role.upper()}] {content}")
                role_lower = str(role).lower()
                if role_lower == "user":
                    user_chars_total += len(str(content))
                elif role_lower == "assistant":
                    assistant_chars_total += len(str(content))
        transcript = "\n".join(lines)
    except Exception as exc:
        logger.warning("transcript_read_failed", error=str(exc))

    sentiment = None
    if transcript and os.getenv("OPENAI_API_KEY"):
        try:
            import openai
            client = openai.AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
            resp = await client.chat.completions.create(
                model="gpt-4o-mini", max_tokens=5,
                messages=[{"role": "user", "content":
                    f"Classify this call as one word: positive, neutral, negative, or frustrated.\n\n{transcript[:800]}"}],
            )
            sentiment = (resp.choices[0].message.content or "").strip().lower()[:32]
        except Exception as exc:
            logger.warning("sentiment_failed", error=str(exc))

    # Constrain sentiment to known enum values; null otherwise to keep DB clean.
    if sentiment is not None:
        s = sentiment.strip().lower()
        sentiment = s if s in ("positive", "neutral", "negative", "frustrated") else None

    # Pipeline-mode cost estimate (per minute):
    #   STT @ $0.002 + TTS @ $0.006  (sums via duration/60 terms)
    #   LLM input @ $0.003 / 1k chars + LLM output @ $0.0001 / 4k chars
    # NOTE: For Gemini Live realtime mode, this overestimates — Gemini Live is a single priced unit. TODO: differentiate.
    cost_usd = round(
        (duration / 60) * 0.002 + (duration / 60) * 0.006
        + (len(transcript) / 1000) * 0.003 + (len(transcript) / 4000) * 0.0001,
        5,
    )

    outcome = (agent_tools._closed_outcome or "COMPLETED").upper()
    reason = agent_tools._closed_reason or "session ended"
    was_booked = outcome == "BOOKED"

    # ── Usage breakdown for cost dashboard ───────────────────────────────────
    # The dashboard recomputes cost as usage × current ProviderRate so we
    # capture raw counts here (not money). Token counts are estimated from
    # the transcript at ~4 chars/token — accurate enough for a rolling
    # cost dashboard, off by single-digit % vs exact tokenizer counts.
    use_realtime = config.USE_GEMINI_REALTIME and bool(_google_realtime)
    if use_realtime:
        llm_provider_used = "google"
        llm_sku_used = os.getenv("GEMINI_MODEL", config.GEMINI_MODEL)
        # In realtime mode the same Gemini handles both STT and TTS; book
        # the audio to the LLM provider so we don't double-count.
        stt_provider_used = "google"
        stt_sku_used = llm_sku_used
        tts_provider_used = "google"
        tts_sku_used = llm_sku_used
    else:
        # Bill the provider that ACTUALLY served the turns — never the configured
        # one, and never inferred from a model-name prefix. A Groq-served model
        # called "openai/gpt-oss-20b" is a GROQ bill.
        _route = getattr(agent_tools, "_llm_route", None)
        if _route is not None:
            llm_provider_used = _route.billing_provider
            llm_sku_used = _route.billing_model
            logger.info("llm_cost_attribution", **_route.log_fields(),
                        billed_provider=llm_provider_used, billed_model=llm_sku_used,
                        usage_breakdown=_route.usage_breakdown,
                        call_id=ctx.room.name, room=ctx.room.name, source="LLM")
        else:
            _sel = llm_routing.normalize_provider(
                profile.get("llm_provider") or config.DEFAULT_LLM_PROVIDER)
            llm_provider_used = _sel or "groq"
            llm_sku_used = (profile.get("model") or "").strip() or config.GROQ_MODEL
        # Bill the provider that ACTUALLY ran, read off the session the worker
        # built. This used to be inferred from whether the Deepgram module had
        # imported, which billed every Sarvam call to Deepgram, and the TTS line
        # collapsed anything outside four names to OpenAI.
        stt_provider_used = (getattr(session, "_jj_stt_provider", "") or "").lower() \
            or (profile.get("stt_provider") or "deepgram").lower()
        _stt_bill_def = provider_registry.get(stt_provider_used, "STT")
        stt_sku_used = (
            (profile.get("stt_model") or "").strip()
            or (config.STT_MODEL if stt_provider_used == "deepgram" else "")
            or (_stt_bill_def.models[0] if _stt_bill_def and _stt_bill_def.models else stt_provider_used)
        )
        tts_provider_used = (getattr(session, "_jj_tts_provider", "") or "").lower() \
            or (profile.get("tts_provider") or config.DEFAULT_TTS_PROVIDER).lower()
        _tts_bill_def = provider_registry.get(tts_provider_used, "TTS")
        tts_sku_used = (
            (profile.get("tts_model") or "").strip()
            or (_tts_bill_def.models[0] if _tts_bill_def and _tts_bill_def.models else tts_provider_used)
        )

    # Prefer what the PROVIDER reported, summed over every request this call
    # made. The char-based estimate below counts the system prompt once for the
    # whole call instead of once per request and ignores tool schemas and
    # history, so it understated heavily; it survives only as a labelled
    # fallback for providers that return no usage block.
    _prov_in = int(getattr(agent_tools, "_usage_prompt_tokens", 0) or 0)
    _prov_out = int(getattr(agent_tools, "_usage_completion_tokens", 0) or 0)
    _prov_reqs = int(getattr(agent_tools, "_usage_requests", 0) or 0)
    if _prov_in or _prov_out:
        llm_input_tokens, llm_output_tokens = _prov_in, _prov_out
        token_source = "provider"
    else:
        llm_input_tokens = max(0, user_chars_total // 4 + len(profile.get("system_prompt") or "") // 4)
        llm_output_tokens = max(0, assistant_chars_total // 4)
        token_source = "estimated"
    logger.info("llm_usage_total", input_tokens=llm_input_tokens,
                output_tokens=llm_output_tokens, requests=_prov_reqs,
                cached_tokens=int(getattr(agent_tools, "_usage_cached_tokens", 0) or 0),
                token_source=token_source,
                per_request_input=(round(_prov_in / _prov_reqs) if _prov_reqs else None),
                call_id=ctx.room.name, room=ctx.room.name, source="LLM")
    # STT is metered on audio actually streamed. That is the BILLABLE
    # span, not the room's lifetime: with the SIP leg gone there is no
    # audio track, so nothing reaches Deepgram. The 08:21 call recorded
    # stt_seconds=3417 while the caller was only connected for 214s and
    # zero STT events were logged after the hangup.
    stt_seconds = duration
    tts_chars = assistant_chars_total
    telephony_provider = "vobiz"

    log_call_ok = False
    call_id = getattr(agent_tools, "_call_id", None)
    try:
        if call_id:
            await db.complete_call(
                call_id=call_id,
                outcome=outcome, reason=reason, duration_seconds=duration,
                phone_number=phone, lead_name=name or agent_tools.lead_name,
                recording_url=getattr(agent_tools, "recording_url", None),
                sentiment=sentiment, cost_usd=cost_usd,
                interrupt_count=getattr(agent_tools, "interrupt_count", 0),
                was_booked=was_booked, transcript=transcript,
                llm_input_tokens=llm_input_tokens,
                llm_output_tokens=llm_output_tokens,
                llm_provider_used=llm_provider_used,
                llm_sku_used=llm_sku_used,
                stt_seconds=stt_seconds,
                stt_provider_used=stt_provider_used,
                stt_sku_used=stt_sku_used,
                tts_chars=tts_chars,
                tts_provider_used=tts_provider_used,
                tts_sku_used=tts_sku_used,
                telephony_provider=telephony_provider,
                answered_at=getattr(agent_tools, "_answered_at", None),
                ended_at=getattr(ctx, "_jj_hangup_at", None),
            )
        else:
            # Fallback: row was never inserted (e.g. early exit before session.start).
            call_id = await db.log_call(
                phone_number=phone, lead_name=name or agent_tools.lead_name,
                outcome=outcome, reason=reason, duration_seconds=duration,
                recording_url=getattr(agent_tools, "recording_url", None),
                sentiment=sentiment, cost_usd=cost_usd,
                interrupt_count=getattr(agent_tools, "interrupt_count", 0),
                was_booked=was_booked, transcript=transcript,
            )
        log_call_ok = True
        logger.info("call_logged", call_id=call_id, duration=duration,
                    duration_basis=duration_basis, room_seconds=room_seconds,
                    ringing_seconds=getattr(agent_tools, "_ringing_seconds", None),
                    cost_basis=("provider_aligned" if duration_basis == "answer_to_hangup"
                                else "estimated"),
                    outcome=outcome)
        logger.info("session_ended", call_id=call_id, room=getattr(ctx.room, "name", ""),
                    duration=duration, outcome=outcome, source="WORKER")
    except Exception as exc:
        logger.error("log_call_failed", error=str(exc))
        await db.log_error("agent", "log_call failed", str(exc))

    # Finalize a LOCAL recording: write the mixed WAV and persist READY/FAILED.
    # Local recordings have no egress webhook, so the status is set here.
    _recorder = getattr(agent_tools, "_recorder", None)
    if _recorder is not None:
        try:
            # Finalizing mixes and writes several MB; on a 229s call this blocked
            # the agent event loop for 213ms (the SDK flagged it). It runs in the
            # shutdown callback so no live audio was affected, but recording must
            # never do synchronous work on that loop — so do it in a thread.
            rel_key, rec_dur = await asyncio.to_thread(_recorder.stop)
            if rel_key:
                await db.set_recording_status(
                    ctx.room.name, status="READY", object_key=rel_key,
                    duration_seconds=rec_dur)
                logger.info("recording_ready", backend="local", room=ctx.room.name,
                            call_id=ctx.room.name, object_key=rel_key,
                            duration_seconds=rec_dur, source="RECORDING")
            else:
                await db.set_recording_status(
                    ctx.room.name, status="FAILED",
                    error=_recorder.failed_reason or "no audio captured")
                logger.warning("recording_failed", backend="local", room=ctx.room.name,
                               reason=_recorder.failed_reason or "no audio captured",
                               source="RECORDING")
        except Exception as exc:  # noqa: BLE001 — never break shutdown
            logger.warning("recording_finalize_failed", error=str(exc)[:200],
                           room=ctx.room.name, source="RECORDING")

    # Stop the egress so the file is finalized and the egress_ended webhook fires.
    # The webhook (server.py) flips the status to READY/FAILED with the duration;
    # here we mark PROCESSING so the dashboard reflects "finalising" immediately.
    egress_id = getattr(agent_tools, "_egress_id", "")
    if egress_id:
        try:
            await ctx.api.egress.stop_egress(api.StopEgressRequest(egress_id=egress_id))
            logger.info("recording_stopped", egress_id=egress_id, room=ctx.room.name,
                        call_id=ctx.room.name, source="LIVEKIT")
            logger.info("recording_processing", egress_id=egress_id, room=ctx.room.name,
                        call_id=ctx.room.name, source="LIVEKIT")
            try:
                await db.set_recording_status(ctx.room.name, status="PROCESSING")
            except Exception as exc2:  # noqa: BLE001 — best-effort
                logger.warning("recording_status_persist_failed", error=str(exc2))
        except Exception as exc:
            logger.warning("egress_stop_failed", error=str(exc), egress_id=egress_id)

    # ── STT stream lifetime ──────────────────────────────────────────────────
    # Closes the measurement gap: Deepgram meters streamed audio, and the only
    # evidence we had was the absence of transcripts after a hangup. This
    # reports how long the stream was actually open and how that compares with
    # the connected span, so STT cost stops being inferred from room lifetime.
    try:
        _stt_open = getattr(agent_tools, "_stt_connected_mono", None)
        if isinstance(_stt_open, (int, float)):
            _stt_open_s = int(time.monotonic() - _stt_open)
            logger.info("stt_disconnected",
                        provider=getattr(agent_tools, "_stt_provider", None),
                        model=getattr(agent_tools, "_stt_model", None),
                        stream_open_seconds=_stt_open_s,
                        connected_seconds=duration,
                        billed_on=duration,
                        note=("stream outlived the connected span"
                              if _stt_open_s > duration + 5 else "aligned"),
                        call_id=ctx.room.name, room=ctx.room.name, source="STT")
    except Exception as exc:
        logger.warning("stt_lifetime_log_failed", error=str(exc)[:160],
                       call_id=ctx.room.name, source="STT")

    await db.remove_active_call(ctx.room.name)

    # ── Settle this room's campaign target, if it belongs to a campaign ──────
    # Closes the dispatch loop: until now a target stayed DISPATCHED forever
    # once the dial API accepted, so the campaign page could not distinguish
    # "dial accepted" from "the customer actually spoke to the agent", and the
    # campaign's completed/failed counters never moved off zero.
    #
    # Only two states are written, because only two are supported by evidence
    # this process genuinely has: the session ran and the caller spoke
    # (COMPLETED), or it ended without a conversation (FAILED, carrying the
    # reason). Provider-level outcomes like BUSY / NO ANSWER are NOT inferred
    # here — nothing in the worker observes them.
    try:
        connected = duration > 0 and bool(transcript)
        settled = await db.settle_campaign_target(
            ctx.room.name,
            status="COMPLETED" if connected else "FAILED",
            error=None if connected else (reason or outcome or "no conversation")[:300],
        )
        if settled:
            await db.refresh_campaign_counters(ctx.room.name)
            logger.info("campaign_target_settled", room=ctx.room.name,
                        status="COMPLETED" if connected else "FAILED",
                        duration=duration, outcome=outcome,
                        call_id=ctx.room.name, source="WORKER")
    except Exception as exc:
        # Campaign bookkeeping must never break call teardown.
        logger.warning("campaign_target_settle_failed", error=str(exc)[:200],
                       room=ctx.room.name, source="WORKER")

    # ── Booking-aware notifications (sync notify.py helpers via to_thread) ────
    if log_call_ok:
        caller_name = name or agent_tools.lead_name or ""
        try:
            if was_booked:
                booking_id = getattr(agent_tools, "_last_booking_id", "") or ""
                booking_time_iso = getattr(agent_tools, "_last_booking_time", "") or ""
                tts_voice = (profile.get("voice") if isinstance(profile, dict) else "") or ""
                await asyncio.to_thread(
                    notify.notify_booking_confirmed,
                    caller_name, phone, booking_time_iso, booking_id, reason, tts_voice,
                )
                booking_webhook = os.environ.get("BOOKING_WEBHOOK_URL", "")
                if booking_webhook:
                    await notify.send_webhook(booking_webhook, "booking_confirmed", {
                        "phone": phone, "lead_name": caller_name,
                        "booking_id": booking_id, "booking_time": booking_time_iso,
                        "duration": duration, "outcome": outcome, "reason": reason,
                        "sentiment": sentiment, "cost_usd": cost_usd,
                    })
            else:
                await asyncio.to_thread(
                    notify.notify_call_no_booking,
                    caller_name, phone, reason or "", "", duration,
                )
        except Exception as exc:
            logger.warning("booking_notify_failed", error=str(exc))

    # Fire optional webhooks (n8n etc) — generic call_completed event
    try:
        n8n_url = os.getenv("N8N_WEBHOOK_URL")
        if n8n_url:
            await notify.send_webhook(n8n_url, "call_completed", {
                "phone": phone, "lead_name": name or agent_tools.lead_name,
                "duration": duration, "outcome": outcome, "reason": reason,
                "sentiment": sentiment, "cost_usd": cost_usd, "was_booked": was_booked,
            })
    except Exception:
        pass

    # ── DB-row webhooks (Feature Pack 3 / Task 4) ────────────────────────────
    # HMAC-signed payloads to receivers configured via the dashboard. Records
    # delivery rows so /webhooks/[id] shows attempt history.
    try:
        org_id = os.environ.get("DEFAULT_ORG_ID", "default-org")
        event = "CALL_ENDED" if log_call_ok else "CALL_FAILED"
        db_webhooks = await db.get_active_webhooks_for_event(org_id, event)
        if db_webhooks:
            full_payload = {
                "event": event,
                "call_id": call_id,
                "phone": phone,
                "lead_name": name or agent_tools.lead_name,
                "duration": duration,
                "outcome": outcome,
                "reason": reason,
                "sentiment": sentiment,
                "cost_usd": cost_usd,
                "was_booked": was_booked,
                "recording_url": getattr(agent_tools, "recording_url", None),
            }
            for wh in db_webhooks:
                code, body = await notify.send_signed_webhook(
                    wh["url"], wh.get("secret") or "",
                    event, full_payload,
                )
                succeeded_at = (
                    datetime.now(UTC).replace(tzinfo=None)
                    if (code is not None and 200 <= code < 300)
                    else None
                )
                try:
                    await db.record_webhook_delivery(
                        wh["id"], event, full_payload,
                        code, body, succeeded_at,
                        call_id=call_id,
                    )
                except Exception as exc:
                    logger.warning(
                        "webhook_delivery_record_failed", error=str(exc)
                    )
    except Exception as exc:
        logger.warning("db_webhook_dispatch_failed", error=str(exc))


# ── Worker entry ─────────────────────────────────────────────────────────────

def _prewarm(proc: Any) -> None:  # noqa: ANN401 — livekit JobProcess
    """Warm a FEW cheap, local deps once per worker process. This runs inside the
    process-init timeout, so it must never do network I/O or a heavy model load.
    Notably it does NOT call count_tokens() here: tiktoken's first-use vocab
    DOWNLOAD hangs on a host that can't reach the tiktoken blob store, which hung
    process-init and killed every child (-10). count_tokens is now self-guarded
    (time-bounded, falls back to an estimate), so it is left to warm lazily."""
    logger.info("VOICE_WORKER_BUILD", build=AGENT_BUILD, phase="prewarm", source="WORKER")
    try:
        import pytz
        pytz.timezone("Asia/Kolkata")            # cheap, local (was ~2.9s first use)
        from prompts import get_ist_time_context
        get_ist_time_context()                   # pytz formatting only
        import anyio.streams.memory  # noqa: F401
        import uuid
        uuid.uuid4()
        import redactor
        redactor.redact("warm 9999999999 test@example.com")
    except Exception as exc:
        logger.warning("prewarm_failed", error=str(exc))


if __name__ == "__main__":
    cli.run_app(WorkerOptions(
        entrypoint_fnc=entrypoint,
        prewarm_fnc=_prewarm,
        agent_name="voice-agent",
    ))
