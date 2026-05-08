// Mirror of voice-service/db.py KNOWN_SETTING_KEYS, but typed and grouped so the
// dashboard Settings page can render a real form instead of a free-text key/value
// editor. Add new keys here whenever a new env var is introduced — keeping this
// file in sync with the Python list is the price of typed UX.

export type SettingCategory = "credentials" | "integrations" | "general";

export type SettingDef = {
  key: string;
  label: string;
  category: SettingCategory;
  sensitive: boolean;
  type?: "text" | "password" | "url" | "boolean";
  placeholder?: string;
  description?: string;
};

export const KNOWN_SETTINGS: SettingDef[] = [
  // ─ General ────────────────────────────────────────────────────────────────
  {
    key: "GEMINI_MODEL",
    label: "Gemini model",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "gemini-3.1-flash-live-preview",
  },
  {
    key: "GEMINI_TTS_VOICE",
    label: "Gemini TTS voice",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "Aoede",
  },
  {
    key: "USE_GEMINI_REALTIME",
    label: "Use Gemini realtime mode",
    category: "general",
    sensitive: false,
    type: "boolean",
    description: "If false, falls back to the pipeline (Deepgram + LLM + TTS).",
  },
  {
    key: "ENABLED_TOOLS",
    label: "Enabled LLM tools",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: '["book_appointment","check_availability"]',
    description: "JSON array of enabled tool names; empty = all enabled.",
  },
  {
    key: "DEFAULT_TRANSFER_NUMBER",
    label: "Default transfer number",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "+91...",
    description: "Number used by the transfer_to_human tool.",
  },

  // ─ Credentials (LLM, STT, TTS, LiveKit) ───────────────────────────────────
  { key: "GOOGLE_API_KEY", label: "Google AI / Gemini", category: "credentials", sensitive: true, type: "password" },
  { key: "OPENAI_API_KEY", label: "OpenAI", category: "credentials", sensitive: true, type: "password" },
  { key: "GROQ_API_KEY", label: "Groq", category: "credentials", sensitive: true, type: "password" },
  { key: "ANTHROPIC_API_KEY", label: "Anthropic / Claude", category: "credentials", sensitive: true, type: "password" },
  { key: "DEEPGRAM_API_KEY", label: "Deepgram (STT)", category: "credentials", sensitive: true, type: "password" },
  { key: "SARVAM_API_KEY", label: "Sarvam (STT/TTS)", category: "credentials", sensitive: true, type: "password" },
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs (TTS)", category: "credentials", sensitive: true, type: "password" },
  { key: "CARTESIA_API_KEY", label: "Cartesia (TTS)", category: "credentials", sensitive: true, type: "password" },
  {
    key: "LIVEKIT_URL",
    label: "LiveKit URL",
    category: "credentials",
    sensitive: false,
    type: "url",
    placeholder: "wss://your-project.livekit.cloud",
  },
  { key: "LIVEKIT_API_KEY", label: "LiveKit API key", category: "credentials", sensitive: true, type: "password" },
  { key: "LIVEKIT_API_SECRET", label: "LiveKit API secret", category: "credentials", sensitive: true, type: "password" },
  {
    key: "LIVEKIT_WEBHOOK_SECRET",
    label: "LiveKit webhook secret",
    category: "credentials",
    sensitive: true,
    type: "password",
    description: "HMAC-signs webhook payloads. Copy from LiveKit dashboard.",
  },

  // ─ Integrations (SIP, recordings, calendar, notifications) ────────────────
  { key: "VOBIZ_SIP_DOMAIN", label: "Vobiz SIP domain", category: "integrations", sensitive: false, type: "text" },
  { key: "VOBIZ_USERNAME", label: "Vobiz username", category: "integrations", sensitive: false, type: "text" },
  { key: "VOBIZ_PASSWORD", label: "Vobiz password", category: "integrations", sensitive: true, type: "password" },
  {
    key: "VOBIZ_OUTBOUND_NUMBER",
    label: "Vobiz outbound number",
    category: "integrations",
    sensitive: false,
    type: "text",
    placeholder: "+91...",
  },
  { key: "OUTBOUND_TRUNK_ID", label: "LiveKit outbound trunk ID", category: "integrations", sensitive: false, type: "text" },
  { key: "INBOUND_TRUNK_ID", label: "LiveKit inbound trunk ID", category: "integrations", sensitive: false, type: "text" },

  { key: "R2_ACCOUNT_ID", label: "Cloudflare R2 account ID", category: "integrations", sensitive: false, type: "text" },
  { key: "R2_ACCESS_KEY_ID", label: "R2 access key ID", category: "integrations", sensitive: true, type: "password" },
  { key: "R2_SECRET_ACCESS_KEY", label: "R2 secret access key", category: "integrations", sensitive: true, type: "password" },
  {
    key: "R2_BUCKET",
    label: "R2 bucket",
    category: "integrations",
    sensitive: false,
    type: "text",
    placeholder: "call-recordings",
  },
  {
    key: "R2_ENDPOINT",
    label: "R2 endpoint",
    category: "integrations",
    sensitive: false,
    type: "url",
    placeholder: "https://YOUR.r2.cloudflarestorage.com",
  },

  { key: "CALCOM_API_KEY", label: "Cal.com API key", category: "integrations", sensitive: true, type: "password" },
  { key: "CALCOM_EVENT_TYPE_ID", label: "Cal.com event type ID", category: "integrations", sensitive: false, type: "text" },
  {
    key: "CALCOM_TIMEZONE",
    label: "Cal.com timezone",
    category: "integrations",
    sensitive: false,
    type: "text",
    placeholder: "Asia/Kolkata",
  },

  { key: "TWILIO_ACCOUNT_SID", label: "Twilio account SID", category: "integrations", sensitive: false, type: "text" },
  { key: "TWILIO_AUTH_TOKEN", label: "Twilio auth token", category: "integrations", sensitive: true, type: "password" },
  { key: "TWILIO_FROM_NUMBER", label: "Twilio SMS from", category: "integrations", sensitive: false, type: "text" },
  {
    key: "TWILIO_WHATSAPP_NUMBER",
    label: "Twilio WhatsApp from",
    category: "integrations",
    sensitive: false,
    type: "text",
  },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot token", category: "integrations", sensitive: true, type: "password" },
  { key: "TELEGRAM_CHAT_ID", label: "Telegram chat ID", category: "integrations", sensitive: false, type: "text" },
  {
    key: "N8N_WEBHOOK_URL",
    label: "n8n webhook URL",
    category: "integrations",
    sensitive: false,
    type: "url",
  },

  // ─ Privacy / compliance ───────────────────────────────────────────────────
  {
    key: "PII_STORAGE_MODE",
    label: "PII storage mode",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "redacted_only",
    description:
      "How transcripts are stored. Values: redacted_only (default — raw discarded), both (raw + redacted, admin can toggle), redacted_persistent_raw_ephemeral (raw nulled after 24h).",
  },
  {
    key: "QUIET_HOURS_START",
    label: "Quiet hours — allowed start (HH:MM)",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "09:00",
    description: "Earliest local time outbound dispatches are allowed. 24h format.",
  },
  {
    key: "QUIET_HOURS_END",
    label: "Quiet hours — allowed end (HH:MM)",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "21:00",
    description: "Latest local time outbound dispatches are allowed. 24h format. Wrap-around (e.g., 21:00 → 09:00) is supported.",
  },
  {
    key: "QUIET_HOURS_TIMEZONE",
    label: "Quiet hours — timezone",
    category: "general",
    sensitive: false,
    type: "text",
    placeholder: "Asia/Kolkata",
    description: "IANA timezone (default Asia/Kolkata). Per-contact override supported via Contact.timezone.",
  },
];

export const SETTING_CATEGORIES: { id: SettingCategory; label: string; description: string }[] = [
  {
    id: "credentials",
    label: "Credentials",
    description: "API keys for LLMs, STT/TTS providers, and LiveKit.",
  },
  {
    id: "integrations",
    label: "Integrations",
    description: "SIP, recording storage, calendar, and notification destinations.",
  },
  {
    id: "general",
    label: "General",
    description: "Runtime tunables for the agent (model, voice, enabled tools).",
  },
];

export function settingsByCategory(c: SettingCategory): SettingDef[] {
  return KNOWN_SETTINGS.filter((s) => s.category === c);
}
