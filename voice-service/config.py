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

# ── Pipeline-mode fallbacks ───────────────────────────────────────────────────
DEFAULT_LLM_PROVIDER    = "openai"
DEFAULT_LLM_MODEL       = "gpt-4o-mini"
GROQ_MODEL              = "llama-3.3-70b-versatile"
GROQ_TEMPERATURE        = 0.7

DEFAULT_STT_PROVIDER    = "deepgram"
STT_MODEL               = "nova-3"
STT_LANGUAGE            = "multi"

DEFAULT_TTS_PROVIDER    = "sarvam"
SARVAM_MODEL            = "bulbul:v3"
SARVAM_LANGUAGE         = "hi-IN"
CARTESIA_MODEL          = "sonic-2"
CARTESIA_VOICE          = "f786b574-daa5-4673-aa0c-cbe3e8534c02"

# ── Limits ────────────────────────────────────────────────────────────────────
MAX_TURNS_PER_CALL      = int(os.getenv("MAX_TURNS_PER_CALL", "25"))
RATE_LIMIT_CALLS_PER_HOUR = int(os.getenv("RATE_LIMIT_CALLS_PER_HOUR", "5"))
RATE_LIMIT_WINDOW       = 3600

# ── Recording ─────────────────────────────────────────────────────────────────
R2_BUCKET               = os.getenv("R2_BUCKET", "call-recordings")
R2_ENDPOINT             = os.getenv("R2_ENDPOINT", "")

# ── Misc ──────────────────────────────────────────────────────────────────────
ENVIRONMENT             = os.getenv("ENVIRONMENT", "development")
