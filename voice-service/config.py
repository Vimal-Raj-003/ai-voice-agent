"""Static defaults and helpers. Anything mutable lives in Neon `settings` table."""

import os

# ── Telephony defaults ────────────────────────────────────────────────────────
DEFAULT_TRANSFER_NUMBER = os.getenv("DEFAULT_TRANSFER_NUMBER", "")
SIP_DOMAIN              = os.getenv("VOBIZ_SIP_DOMAIN", "")
OUTBOUND_TRUNK_ID       = os.getenv("OUTBOUND_TRUNK_ID", "")
INBOUND_TRUNK_ID        = os.getenv("INBOUND_TRUNK_ID", "")

# ── Gemini Live defaults ──────────────────────────────────────────────────────
GEMINI_MODEL            = os.getenv("GEMINI_MODEL", "gemini-3.1-flash-live-preview")
GEMINI_TTS_VOICE        = os.getenv("GEMINI_TTS_VOICE", "Aoede")
USE_GEMINI_REALTIME     = os.getenv("USE_GEMINI_REALTIME", "true").lower() != "false"
# Primary (pipeline) TTS = Gemini TTS via the GOOGLE_API_KEY. Model verified
# present in livekit-plugins-google 1.8.4 GEMINI_TTS_MODELS. Low-latency flash
# model; override with GEMINI_TTS_MODEL. Gemini voices are language-agnostic
# (they speak Tamil/English/Tanglish from the text), so no per-turn language
# switch is needed; tone/accent is steered via GEMINI_TTS_INSTRUCTIONS.
GEMINI_TTS_MODEL        = os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
GEMINI_TTS_INSTRUCTIONS = os.getenv(
    "GEMINI_TTS_INSTRUCTIONS",
    "Speak as a warm, natural, professional female Indian receptionist on a phone call — "
    "clear and conversational in English and Tamil/Tanglish, unhurried but efficient.",
)

# ── Pipeline-mode LLM (primary Groq, Gemini fallback) ─────────────────────────
# Provider preference order for the pipeline LLM. The first whose credentials
# are present is used; see agent._build_pipeline_llm.
DEFAULT_LLM_PROVIDER    = os.getenv("DEFAULT_LLM_PROVIDER", "groq")
DEFAULT_LLM_MODEL       = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
GROQ_MODEL              = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_BASE_URL           = "https://api.groq.com/openai/v1"
GROQ_TEMPERATURE        = 0.7
# Text (non-realtime) Gemini model used when Gemini is the pipeline LLM fallback.
# NOTE: "gemini-2.0-flash" returns HTTP 404 for this account (verified on real
# calls) — a 404 model id makes the cross-provider LLM fallback itself fail, so
# a Groq 429 then cascades to llm_all_providers_failed. "gemini-flash-latest" is
# a stable alias that always resolves to the current flash model and does not
# 404. Override with GEMINI_LLM_MODEL if a specific pinned id is desired.
GEMINI_LLM_MODEL        = os.getenv("GEMINI_LLM_MODEL", "gemini-flash-latest")

# The SELECTED provider controls both primary and fallback. Leaving the
# selected provider for another vendor is a deliberate, logged decision —
# off by default so a Groq failure never silently becomes a Gemini bill.
ALLOW_CROSS_PROVIDER_FALLBACK = os.getenv(
    "ALLOW_CROSS_PROVIDER_FALLBACK", "false").strip().lower() in ("1", "true", "yes", "on")

# ── Multilingual ──────────────────────────────────────────────────────────────
# When true, the agent switches TTS language per caller turn to match the
# detected spoken language. STT uses Deepgram "multi" for code-switch detection.
MULTILINGUAL_TTS_ENABLED = os.getenv("MULTILINGUAL_TTS_ENABLED", "true").lower() != "false"

DEFAULT_STT_PROVIDER    = "deepgram"
STT_MODEL               = os.getenv("STT_MODEL", "nova-3")
# Deepgram streaming has NO auto language detection, and nova-3 "multi" code-switch
# EXCLUDES Tamil (only en/es/fr/de/hi/ru/pt/ja/it/nl) — so a Tamil caller was
# transcribed as broken English. nova-3 supports Tamil only in MONOLINGUAL mode
# (language=ta), which also handles Tanglish (English nouns inside Tamil) far
# better. Default to "ta" for this Tamil-first deployment; set STT_LANGUAGE=multi
# (or en) to revert for an English-dominant deployment. Response language stays
# separately controlled by the call-level language lock.
STT_LANGUAGE            = os.getenv("STT_LANGUAGE", "ta")
# End-of-turn tuning (lower = snappier, but may clip natural pauses). Deepgram
# utterance_end_ms + endpointing_ms and the session min_endpointing_delay drove
# a ~2.2s speech_end→stt_final. Env-tunable; defaults trimmed from 1000/0.4 to
# cut that wait while still protecting mid-sentence Tamil pauses. MEASURE before/
# after with turn_latency_breakdown.speech_end_to_stt_final_ms.
# Deepgram REJECTS utterance_end_ms < 1000 with HTTP 400 at websocket connect
# (verified by direct probe: 700 -> 400 on BOTH language=en and language=multi;
# 1000 -> 101 OK). A previous latency trim set this to 700, which silently broke
# ALL calls: the STT socket opened then was rejected, AgentSession closed, and
# the caller heard nothing. Clamped so an env override can never go below the
# provider minimum again.
STT_UTTERANCE_END_MS    = max(1000, int(os.getenv("STT_UTTERANCE_END_MS", "1000")))
# MEASURED 2026-10-12 (call-917397075913-1736): at 300ms Deepgram finalised on
# ordinary mid-sentence pauses, splitting ONE question into four turns —
#   "Okay. First of all, we want to" / "tell about your services and" /
#   "which type of services we should provide." / "And what benefit"
# 20 finals and 30 LLM calls for ~7 real utterances. Each fragment started a
# reply that the next fragment cancelled (agent_audio_never_played), which is
# what produced the dead air, the lost context and the "sorry, I missed that"
# loop — the LLM was answering half-sentences.
# A natural thinking pause is 500-800ms, so finalise at 700ms instead.
# Latency cost is small because preemptive_generation already starts the LLM on
# the interim transcript: measured stt_final -> first_audio p50 was 987ms.
STT_ENDPOINTING_MS      = int(os.getenv("STT_ENDPOINTING_MS", "700"))
MIN_ENDPOINTING_DELAY   = float(os.getenv("MIN_ENDPOINTING_DELAY", "0.5"))

DEFAULT_TTS_PROVIDER    = os.getenv("DEFAULT_TTS_PROVIDER", "sarvam")
# Healthy fallback TTS for the never-silent path. Gemini free tier returns 429
# (10 req/min) and Sarvam is 402 credits-exhausted, so neither is a reliable
# fallback for testing. Deepgram Aura uses the already-working DEEPGRAM_API_KEY
# and is verified healthy (real synthesis succeeds). English-centric — it
# guarantees AUDIBLE audio on every turn even when Gemini 429s. "none" disables.
TTS_FALLBACK_PROVIDER   = os.getenv("TTS_FALLBACK_PROVIDER", "deepgram")
DEEPGRAM_TTS_MODEL      = os.getenv("DEEPGRAM_TTS_MODEL", "aura-2-andromeda-en")
# Fail FAST: 0 retries per TTS before switching, so a Gemini 429 / Sarvam 402
# flips to the healthy fallback immediately instead of multi-second dead-air.
TTS_MAX_RETRY_PER_TTS   = int(os.getenv("TTS_MAX_RETRY_PER_TTS", "0"))
# Sarvam is credits-exhausted (402); keep it OUT of the active fallback chain
# until a top-up. Set SARVAM_TTS_FALLBACK=true to re-enable it.
SARVAM_TTS_FALLBACK     = os.getenv("SARVAM_TTS_FALLBACK", "false").strip().lower() in ("1", "true", "yes", "on")
# ── Sarvam TTS (primary voice) ────────────────────────────────────────────────
# ONE natural Indian female receptionist voice across English / Tamil / Tanglish
# / Telugu / Malayalam. The SPEAKER never changes when the language changes —
# only `target_language_code` is re-routed per turn (lang.tts_route), so the
# caller hears the same voice identity throughout the call.
SARVAM_MODEL            = os.getenv("SARVAM_MODEL", "bulbul:v3")
# Sarvam STT. codemix is VERIFIED to return correct Tamil script while
# keeping English/brand words in Latin — what a Tanglish caller says.
SARVAM_STT_MODEL        = os.getenv("SARVAM_STT_MODEL", "saaras:v4")
SARVAM_STT_MODE         = os.getenv("SARVAM_STT_MODE", "codemix")
SARVAM_SPEAKER          = os.getenv("SARVAM_SPEAKER", "ishita")
# Seed language only — overridden per turn by the detected conversation language.
SARVAM_LANGUAGE         = os.getenv("SARVAM_LANGUAGE", "en-IN")
# Natural conversational pace (Sarvam allows 0.3–3.0). 0.95–1.0 reads naturally;
# anything faster clips Indic syllables, slower sounds robotic.
SARVAM_PACE             = min(3.0, max(0.3, float(os.getenv("SARVAM_PACE", "0.98"))))
SARVAM_SAMPLE_RATE      = int(os.getenv("SARVAM_SAMPLE_RATE", "24000"))
CARTESIA_MODEL          = "sonic-2"
CARTESIA_VOICE          = "f786b574-daa5-4673-aa0c-cbe3e8534c02"

# ── Limits ────────────────────────────────────────────────────────────────────
MAX_TURNS_PER_CALL      = int(os.getenv("MAX_TURNS_PER_CALL", "25"))
RATE_LIMIT_CALLS_PER_HOUR = int(os.getenv("RATE_LIMIT_CALLS_PER_HOUR", "5"))
RATE_LIMIT_WINDOW       = 3600

# ── Recording backend ─────────────────────────────────────────────────────────
# "local"  = self-hosted capture to disk on this VPS (no Cloudflare R2 needed).
# "r2"     = legacy LiveKit Egress -> Cloudflare R2 upload.
# Local is the default for NEW recordings; existing R2 recordings stay readable
# because playback falls back to R2 whenever a row has no local key.
RECORDING_BACKEND       = os.getenv("RECORDING_BACKEND", "local").strip().lower()
# Persistent storage root. Containerised deploys mount a volume here; override
# with RECORDINGS_DIR for local development (the default path is Linux-only).
RECORDINGS_DIR          = os.getenv("RECORDINGS_DIR", "/opt/jilljill/recordings")
# Bounded buffers + disk safeguards so a recording can never destabilise a call.
RECORDING_MAX_MINUTES   = int(os.getenv("RECORDING_MAX_MINUTES", "60"))
RECORDING_MIN_FREE_MB   = int(os.getenv("RECORDING_MIN_FREE_MB", "500"))

# ── Recording (LiveKit Egress → Cloudflare R2) ──────────────────────────────────
# Global kill-switch; per-assistant `recording_enabled` still applies on top.
CALL_RECORDING_ENABLED  = os.getenv("CALL_RECORDING_ENABLED", "true").strip().lower() not in ("false", "0", "no", "off")
R2_BUCKET               = os.getenv("R2_BUCKET", "call-recordings")
R2_ENDPOINT             = os.getenv("R2_ENDPOINT", "")
R2_ACCOUNT_ID           = os.getenv("R2_ACCOUNT_ID", "")
# NOTE: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are read via os.getenv at egress
# start (agent.py) and never stored on the config module or logged.

# ── Appointment reminders ───────────────────────────────────────────────────
# Customer reminder sent before the appointment (persistent, restart-safe).
APPOINTMENT_REMINDER_ENABLED       = os.getenv("APPOINTMENT_REMINDER_ENABLED", "true").lower() != "false"
APPOINTMENT_REMINDER_MINUTES_BEFORE = int(os.getenv("APPOINTMENT_REMINDER_MINUTES_BEFORE", "60"))
APPOINTMENT_REMINDER_MAX_RETRIES   = int(os.getenv("APPOINTMENT_REMINDER_MAX_RETRIES", "3"))
BUSINESS_NAME                      = os.getenv("BUSINESS_NAME", "our team")

# ── Misc ──────────────────────────────────────────────────────────────────────
ENVIRONMENT             = os.getenv("ENVIRONMENT", "development")
