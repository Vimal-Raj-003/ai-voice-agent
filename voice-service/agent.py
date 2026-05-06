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

import asyncio  # noqa: E402
import json  # noqa: E402
import re  # noqa: E402
import time  # noqa: E402
from collections import defaultdict  # noqa: E402
from datetime import datetime  # noqa: E402

from dotenv import load_dotenv  # noqa: E402
from livekit import agents, api  # noqa: E402
from livekit.agents import (  # noqa: E402
    Agent,
    AgentSession,
    JobContext,
    RoomInputOptions,
    WorkerOptions,
    cli,
    llm,
)
from livekit.plugins import noise_cancellation, silero  # noqa: E402

import config  # noqa: E402
import db  # noqa: E402
from language_presets import LANGUAGE_PRESETS  # noqa: E402
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
