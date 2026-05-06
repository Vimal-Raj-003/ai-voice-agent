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
