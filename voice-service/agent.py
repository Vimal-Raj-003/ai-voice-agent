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
import notify  # noqa: E402
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

    if llm_obj is None:
        raise RuntimeError(
            "No LLM plugin available. Install livekit-plugins-openai or enable Gemini realtime "
            "(USE_GEMINI_REALTIME=true with GOOGLE_API_KEY)."
        )

    return AgentSession(stt=stt, llm=llm_obj, tts=tts, tools=tools)


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
            bits.append("Remembered notes: " + " | ".join(m["insight"] for m in memories[:5]))
        if calls:
            last = calls[0]
            last_at = last.get("createdAt") or last.get("created_at")
            bits.append(
                f"Last call ({last_at.date().isoformat() if last_at else 'recently'}): "
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
    # Hallucination guard — auto-append a "do not invent information" clause
    # when the assistant has it enabled (default true). One short paragraph;
    # studies show this measurably reduces fabricated answers across all
    # current LLMs without hurting legitimate domain knowledge.
    if profile.get("hallucination_guard", True):
        system_prompt += (
            "\n\nIMPORTANT: Never invent information you don't have. "
            "If the caller asks something you don't know — pricing, "
            "policies, schedules, names — say plainly that you don't have "
            "that detail and offer to take a message or transfer the call."
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
    # Per-assistant background denoising toggle. BVCTelephony is the
    # broadband-voice cancellation tuned for telephony; turning it off saves
    # ~5% CPU per call but lets in line noise.
    if profile.get("background_denoising", True):
        try:
            room_input = RoomInputOptions(
                close_on_disconnect=False,
                noise_cancellation=noise_cancellation.BVCTelephony(),
            )
        except Exception:
            pass

    await session.start(room=ctx.room, agent=agent, room_input_options=room_input)
    await db.upsert_active_call(ctx.room.name, phone, name, "active")

    user_in_room = any("sip_" in p.identity for p in ctx.room.remote_participants.values())
    direction = "INBOUND" if user_in_room else "OUTBOUND"

    # Insert a placeholder call row so transcript_messages can FK against it during the call.
    # complete_call() in the shutdown hook fills in outcome / duration / recording / etc.
    call_id = await db.create_call_row(
        phone_number=phone,
        lead_name=meta.get("lead_name") or name or None,
        direction=direction,
        livekit_room_name=ctx.room.name,
    )
    agent_tools._call_id = call_id

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
        asyncio.create_task(
            db.insert_transcript_message(call_id, role.upper(), text)
        )

    @session.on("conversation_item_added")
    def _on_item(event: Any) -> None:  # noqa: ANN401 — runtime event from livekit
        item = getattr(event, "item", None) or event
        role = getattr(item, "role", None)
        content = getattr(item, "text_content", None)
        if content is None:
            content = getattr(item, "content", None)
        _stream_turn(role, content)

    # Start LiveKit Egress to R2 if creds are configured. The /api/webhook/livekit handler
    # writes the resulting public URL onto calls.recordingUrl by livekitRoomName.
    if os.getenv("R2_ACCESS_KEY_ID") and os.getenv("R2_BUCKET") and os.getenv("R2_ENDPOINT"):
        try:
            recording_filepath = f"{ctx.room.name}.ogg"
            egress_req = api.RoomCompositeEgressRequest(
                room_name=ctx.room.name,
                audio_only=True,
                file_outputs=[api.EncodedFileOutput(
                    filepath=recording_filepath,
                    s3=api.S3Upload(
                        access_key=os.getenv("R2_ACCESS_KEY_ID", ""),
                        secret=os.getenv("R2_SECRET_ACCESS_KEY", ""),
                        bucket=os.getenv("R2_BUCKET", ""),
                        endpoint=os.getenv("R2_ENDPOINT", ""),
                        region="auto",
                        force_path_style=True,
                    ),
                )],
            )
            egress_info = await ctx.api.egress.start_room_composite_egress(egress_req)
            agent_tools._egress_id = getattr(egress_info, "egress_id", "")
            logger.info("egress_started", egress_id=agent_tools._egress_id, room=ctx.room.name)
        except Exception as exc:
            logger.warning("egress_start_failed", error=str(exc))
    else:
        logger.info("egress_skipped_no_r2_config")

    # Outbound dial-out branch
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
        llm_provider = (profile.get("llm_provider") or config.DEFAULT_LLM_PROVIDER).lower()
        llm_provider_used = "groq" if llm_provider == "groq" else "anthropic" if llm_provider == "claude" else "openai"
        if llm_provider_used == "groq":
            llm_sku_used = config.GROQ_MODEL
        elif llm_provider_used == "anthropic":
            llm_sku_used = os.getenv("ANTHROPIC_MODEL", "claude-haiku-3-5")
        else:
            llm_sku_used = config.DEFAULT_LLM_MODEL
        stt_provider_used = "deepgram" if _deepgram_stt else "sarvam"
        stt_sku_used = config.STT_MODEL if stt_provider_used == "deepgram" else "saaras-v3"
        tts_provider = (profile.get("tts_provider") or config.DEFAULT_TTS_PROVIDER).lower()
        tts_provider_used = tts_provider if tts_provider in ("sarvam", "elevenlabs", "cartesia", "openai") else "openai"
        tts_sku_used = {
            "sarvam": "bulbul-v3",
            "elevenlabs": "turbo-v2-5",
            "cartesia": "sonic-2",
            "openai": "tts-1",
        }.get(tts_provider_used, "tts-1")

    llm_input_tokens = max(0, user_chars_total // 4 + len(profile.get("system_prompt") or "") // 4)
    llm_output_tokens = max(0, assistant_chars_total // 4)
    stt_seconds = duration  # we transcribed the whole call
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
        logger.info("call_logged", call_id=call_id, duration=duration, outcome=outcome)
    except Exception as exc:
        logger.error("log_call_failed", error=str(exc))
        await db.log_error("agent", "log_call failed", str(exc))

    # Stop the egress so the file is finalized and the egress_ended webhook fires.
    egress_id = getattr(agent_tools, "_egress_id", "")
    if egress_id:
        try:
            await ctx.api.egress.stop_egress(api.StopEgressRequest(egress_id=egress_id))
        except Exception as exc:
            logger.warning("egress_stop_failed", error=str(exc), egress_id=egress_id)

    await db.remove_active_call(ctx.room.name)

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


# ── Worker entry ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name="voice-agent"))
