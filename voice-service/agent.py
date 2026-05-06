"""LiveKit voice agent worker — handles inbound + outbound calls with Gemini Live default."""

from __future__ import annotations

import os
import ssl
from typing import Any

import certifi

# ── SSL patch (must happen before any networking imports) ────────────────────
_orig_ssl = ssl.create_default_context
def _certifi_ssl(purpose=ssl.Purpose.SERVER_AUTH, **kwargs):
    if not kwargs.get("cafile") and not kwargs.get("capath") and not kwargs.get("cadata"):
        kwargs["cafile"] = certifi.where()
    return _orig_ssl(purpose, **kwargs)
ssl.create_default_context = _certifi_ssl  # type: ignore[assignment]

import asyncio  # noqa: E402, F401
import json  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402
from collections import defaultdict  # noqa: E402
from datetime import datetime  # noqa: E402

from dotenv import load_dotenv  # noqa: E402
from livekit import agents, api  # noqa: E402, F401
from livekit.agents import (  # noqa: E402
    Agent,
    AgentSession,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
    llm,  # noqa: F401
)
from livekit.plugins import noise_cancellation, silero  # noqa: E402, F401

import config  # noqa: E402
import db  # noqa: E402
from language_presets import LANGUAGE_PRESETS  # noqa: E402, F401
from observability import get_logger, init_observability  # noqa: E402
from prompts import build_prompt, count_tokens  # noqa: E402

load_dotenv(".env")
init_observability()
logger = get_logger("agent")

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
except ImportError:
    logger.warning("livekit-plugins-google not installed")

_deepgram_stt: Any = None
try:
    from livekit.plugins import deepgram as _dg
    _deepgram_stt = _dg.STT
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

def _build_session(tools: list, system_prompt: str, profile: dict | None = None) -> AgentSession:
    """
    Build AgentSession with Gemini Live (default) or pipeline fallback.

    Silence-prevention config (mandatory for Gemini Live):
    1. SessionResumptionConfig(transparent=True) → auto-reconnect after timeout
    2. ContextWindowCompressionConfig → sliding window prevents token-limit freeze
    3. RealtimeInputConfig(END_SENSITIVITY_LOW) → 2s silence threshold

    EndSensitivity MUST use full string form: END_SENSITIVITY_LOW (not .LOW).
    """
    profile = profile or {}
    gemini_model = profile.get("model") or os.getenv("GEMINI_MODEL", config.GEMINI_MODEL)
    gemini_voice = profile.get("voice") or os.getenv("GEMINI_TTS_VOICE", config.GEMINI_TTS_VOICE)
    use_realtime = config.USE_GEMINI_REALTIME

    RealtimeClass = _google_realtime or (_google_beta_realtime if use_realtime else None)

    if use_realtime and RealtimeClass is not None:
        logger.info("session_mode_realtime", model=gemini_model, voice=gemini_voice)
        try:
            from google.genai import types as _gt
            realtime_input_cfg = _gt.RealtimeInputConfig(
                automatic_activity_detection=_gt.AutomaticActivityDetection(
                    end_of_speech_sensitivity=_gt.EndSensitivity.END_SENSITIVITY_LOW,
                    silence_duration_ms=2000,
                    prefix_padding_ms=200,
                ),
            )
            session_resumption_cfg = _gt.SessionResumptionConfig(transparent=True)
            ctx_compression_cfg = _gt.ContextWindowCompressionConfig(
                trigger_tokens=25600,
                sliding_window=_gt.SlidingWindow(target_tokens=12800),
            )
        except Exception as cfg_err:
            logger.warning("silence_prevention_config_failed", error=str(cfg_err))
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

        return AgentSession(llm=RealtimeClass(**kwargs), tools=tools)

    # ── Pipeline fallback (Deepgram STT → OpenAI/Groq/Claude LLM → Sarvam/ElevenLabs/Cartesia TTS)
    logger.info("session_mode_pipeline")

    stt = None
    if _deepgram_stt is not None:
        stt = _deepgram_stt(model=config.STT_MODEL, language=config.STT_LANGUAGE)
    elif _sarvam is not None:
        stt = _sarvam.STT(language="unknown", model="saaras:v3", mode="translate", flush_signal=True, sample_rate=16000)

    llm_obj = None
    if _openai_plugin is not None:
        llm_provider = (profile.get("llm_provider") or config.DEFAULT_LLM_PROVIDER).lower()
        if llm_provider == "groq":
            llm_obj = _openai_plugin.LLM.with_groq(model=config.GROQ_MODEL, max_completion_tokens=120)
        elif llm_provider == "claude":
            llm_obj = _openai_plugin.LLM(
                model=os.getenv("ANTHROPIC_MODEL", "claude-haiku-3-5-latest"),
                base_url="https://api.anthropic.com/v1/",
                api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
                max_completion_tokens=120,
            )
        else:
            llm_obj = _openai_plugin.LLM(model=config.DEFAULT_LLM_MODEL, max_completion_tokens=120)

    tts = None
    tts_provider = (profile.get("tts_provider") or config.DEFAULT_TTS_PROVIDER).lower()
    if tts_provider == "sarvam" and _sarvam is not None:
        tts = _sarvam.TTS(target_language_code=config.SARVAM_LANGUAGE, model=config.SARVAM_MODEL,
                          speaker=profile.get("voice", "kavya"), speech_sample_rate=24000)
    elif tts_provider == "elevenlabs" and _elevenlabs is not None:
        tts = _elevenlabs.TTS(model="eleven_turbo_v2_5", voice_id=profile.get("voice", "21m00Tcm4TlvDq8ikWAM"))
    elif tts_provider == "cartesia" and _cartesia is not None:
        tts = _cartesia.TTS(model=config.CARTESIA_MODEL, voice=profile.get("voice", config.CARTESIA_VOICE))
    elif _google_tts is not None:
        tts = _google_tts()
    elif _openai_plugin is not None:
        tts = _openai_plugin.TTS(model="tts-1", voice=profile.get("voice", "alloy"))

    return AgentSession(stt=stt, llm=llm_obj, tts=tts, tools=tools)


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _load_caller_history(phone: str) -> str:
    if phone in ("unknown", "demo"):
        return ""
    try:
        memories = await db.get_contact_memory(phone)
        calls = await db.get_calls_by_phone(phone)
        if not memories and not calls:
            return ""
        bits: list[str] = []
        if memories:
            bits.append("Remembered notes: " + " | ".join(m["insight"] for m in memories[:5]))
        if calls:
            last = calls[0]
            bits.append(
                f"Last call ({(last['created_at'] or datetime.utcnow()).date().isoformat() if last.get('created_at') else 'recently'}): "
                f"{last.get('outcome', '?')} — {last.get('reason', '')}"
            )
        return "\n".join(bits)
    except Exception as exc:
        logger.warning("load_caller_history_failed", error=str(exc), phone=phone)
        return ""


async def _resolve_profile(profile_id: str | None) -> dict:
    if profile_id:
        prof = await db.get_agent_profile(profile_id)
        if prof:
            return prof
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


def _extract_caller_phone(ctx: JobContext, meta: dict) -> tuple[str, str]:
    """Returns (phone, name)."""
    phone = meta.get("phone_number") or "unknown"
    name = meta.get("lead_name") or ""
    for ident, p in ctx.room.remote_participants.items():
        if p.name and p.name not in ("", "Caller", "Unknown"):
            name = p.name
        if phone in ("unknown", ""):
            attrs = p.attributes or {}
            phone = attrs.get("sip.phoneNumber") or attrs.get("phoneNumber") or phone
            if phone in ("unknown", ""):
                m = re.search(r"\+\d{7,15}", ident)
                if m:
                    phone = m.group()
    return phone or "unknown", name


# ── Main entrypoint ──────────────────────────────────────────────────────────

async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    logger.info("room_connected", room=ctx.room.name)

    meta = _parse_metadata(ctx)
    phone, name = _extract_caller_phone(ctx, meta)

    if is_rate_limited(phone):
        logger.warning("rate_limited", phone=phone)
        await db.log_error("agent", f"rate-limit blocked {phone}")
        return

    profile = await _resolve_profile(meta.get("agent_profile_id"))
    history = await _load_caller_history(phone)

    system_prompt = build_prompt(
        lead_name=meta.get("lead_name") or name or "there",
        business_name=meta.get("business_name") or "our company",
        service_type=meta.get("service_type") or "our service",
        custom_prompt=profile.get("system_prompt"),
        language_preset=meta.get("language_preset") or "multilingual",
        caller_history=history,
    )
    tokens = count_tokens(system_prompt)
    logger.info("prompt_built", tokens=tokens)

    # Build tools placeholder — Phase 3 will wire AppointmentTools.
    from tools import AppointmentTools  # local import to avoid cycle at module load
    agent_tools = AppointmentTools(ctx, phone, name)
    enabled = json.loads(profile.get("enabled_tools") or "[]") if isinstance(profile.get("enabled_tools"), str) else (profile.get("enabled_tools") or [])
    tool_list = agent_tools.build_tool_list(enabled)

    agent = Agent(instructions=system_prompt, tools=tool_list)
    session = _build_session(tools=tool_list, system_prompt=system_prompt, profile=profile)

    room_input = RoomInputOptions(close_on_disconnect=False)
    try:
        room_input = RoomInputOptions(close_on_disconnect=False, noise_cancellation=noise_cancellation.BVCTelephony())
    except Exception:
        pass

    await session.start(room=ctx.room, agent=agent, room_input_options=room_input)
    await db.upsert_active_call(ctx.room.name, phone, name, "active")

    # Outbound dial-out branch
    user_in_room = any("sip_" in p.identity for p in ctx.room.remote_participants.values())
    if phone not in ("unknown", "demo") and not user_in_room:
        logger.info("dialing_out", phone=phone, trunk=config.OUTBOUND_TRUNK_ID)
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
            logger.info("call_answered", phone=phone)
        except Exception as exc:
            logger.error("dial_out_failed", error=str(exc), phone=phone)
            await db.log_error("agent", "dial out failed", str(exc))
            await db.remove_active_call(ctx.room.name)
            return

    # Greet (the prompt instructs the agent to speak first)
    await session.generate_reply(instructions="Begin the call now per your system prompt.")

    # Shutdown handler — registered separately
    agent_tools._call_start_time = time.time()
    agent_tools._room_name = ctx.room.name
    agent_tools._session = session
    ctx.add_shutdown_callback(lambda: _shutdown_hook(ctx, agent_tools, session, profile, phone, name))


# ── Shutdown hook ────────────────────────────────────────────────────────────

async def _shutdown_hook(ctx: JobContext, agent_tools, session, profile: dict, phone: str, name: str) -> None:
    duration = int(time.time() - agent_tools._call_start_time)
    transcript = ""
    try:
        msgs = session.history.items if hasattr(session, "history") else []
        if callable(msgs):
            msgs = msgs()
        lines = []
        for m in msgs:
            role = getattr(m, "role", None)
            content = getattr(m, "content", "")
            if isinstance(content, list):
                content = " ".join(str(c) for c in content if isinstance(c, str))
            if role and content:
                lines.append(f"[{role.upper()}] {content}")
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

    cost_usd = round(
        (duration / 60) * 0.002 + (duration / 60) * 0.006
        + (len(transcript) / 1000) * 0.003 + (len(transcript) / 4000) * 0.0001,
        5,
    )

    outcome = (agent_tools._closed_outcome or "COMPLETED").upper()
    reason = agent_tools._closed_reason or "session ended"
    was_booked = outcome == "BOOKED"

    try:
        call_id = await db.log_call(
            phone_number=phone, lead_name=name or agent_tools.lead_name,
            outcome=outcome, reason=reason, duration_seconds=duration,
            recording_url=getattr(agent_tools, "recording_url", None),
            sentiment=sentiment, cost_usd=cost_usd,
            interrupt_count=getattr(agent_tools, "interrupt_count", 0),
            was_booked=was_booked, transcript=transcript,
        )
        logger.info("call_logged", call_id=call_id, duration=duration, outcome=outcome)
    except Exception as exc:
        logger.error("log_call_failed", error=str(exc))
        await db.log_error("agent", "log_call failed", str(exc))

    await db.remove_active_call(ctx.room.name)

    # Fire optional webhooks (n8n etc) — Phase 5 will fully wire notify.py
    try:
        from notify import send_webhook
        n8n_url = os.getenv("N8N_WEBHOOK_URL")
        if n8n_url:
            await send_webhook(n8n_url, "call_completed", {
                "phone": phone, "lead_name": name or agent_tools.lead_name,
                "duration": duration, "outcome": outcome, "reason": reason,
                "sentiment": sentiment, "cost_usd": cost_usd, "was_booked": was_booked,
            })
    except Exception:
        pass


# ── Worker entry ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voice-agent"))
