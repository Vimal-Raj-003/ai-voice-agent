// Single source of truth for which TTS voice each provider can actually use.
//
// Grounded in the voice-service worker + the INSTALLED livekit plugins, NOT
// invented. The pipeline TTS factory in voice-service/agent.py (_build_session)
// constructs TTS only for these providers:
//   - SARVAM     → _sarvam.TTS(model=bulbul:v3, speaker=profile.voice || "kavya")
//   - ELEVENLABS → _elevenlabs.TTS(model=eleven_turbo_v2_5, voice_id=profile.voice || "21m00Tcm4TlvDq8ikWAM")
//   - CARTESIA   → _cartesia.TTS(model=sonic-2, voice=profile.voice || CARTESIA_VOICE)
//   - OPENAI     → _openai_plugin.TTS(model=tts-1, voice=profile.voice || "alloy")
//   - (google is the silent fallback; no per-voice selection)
// There is NO Deepgram TTS branch — Deepgram is STT-only here — so DEEPGRAM
// exposes no selectable voice (the worker falls back automatically).
//
// Voice lists are read from the installed plugins' own declarations:
//   - Sarvam speakers  : MODEL_SPEAKER_COMPATIBILITY["bulbul:v3"].all (sarvam/tts.py)
//   - OpenAI voices    : TTSVoices literal (openai/models.py)
//   - ElevenLabs/Cartesia voice ids are account/library specific; only the
//     backend-configured default is guaranteed, so that one is listed.
//
// Imported by both the Assistant form (client) and the save action (server) so
// the dropdown options and server-side validation can never drift.

import type { SelectOption } from "@/components/Select";

// Sarvam is an Indic-first TTS: every bulbul:v3 speaker speaks the user's
// priority languages (Tamil / Hindi / Telugu / English-IN + more) via per-turn
// target_language_code routing (voice-service/lang.py SARVAM_TTS). So all
// Sarvam voices are flagged multilingual/Indic.
const INDIC = "Indic · Tamil / Hindi / Telugu / English";

export const TTS_PROVIDERS: SelectOption[] = [
  { value: "SARVAM", label: "Sarvam", description: "Indic multilingual (recommended)" },
  { value: "ELEVENLABS", label: "ElevenLabs", description: "Multilingual" },
  { value: "CARTESIA", label: "Cartesia", description: "Multilingual" },
  { value: "OPENAI", label: "OpenAI", description: "English-centric" },
  { value: "DEEPGRAM", label: "Deepgram", description: "Speech-to-text only — no TTS voice" },
];

// VERIFIED 2026-10-13 against BOTH gates, because they disagree:
//   * the installed livekit sarvam plugin validates `speaker` in its
//     MODEL_SPEAKER_COMPATIBILITY table at CONSTRUCTION time, and
//   * api.sarvam.ai validates it again at SYNTHESIS time.
// Only the intersection is safe. Two names the plugin accepts ("amelia",
// "sophia") are rejected by the live API with HTTP 400 — they build fine and
// then fail silently mid-call, which is worse than failing at save time, so
// they are deliberately NOT offered. Nine names the API accepts ("anand",
// "gokul", "mani", "mohit", "rehan", "soham", "sunny", "tarun", "vijay") are
// rejected by the plugin constructor, so they are excluded too.
const SARVAM_BULBUL_V3_SPEAKERS = [
  // Female
  "ishita", "priya", "kavya", "ritu", "pooja", "simran", "shreya", "neha",
  "roopa", "suhani", "rupali", "tanya", "shruti", "kavitha",
  // Male
  "aditya", "rahul", "amit", "ratan", "rohan", "dev", "manan", "sumit",
  "kabir", "varun", "aayan", "ashutosh", "advait", "shubh",
];

export const TTS_PROVIDER_VOICES: Record<string, SelectOption[]> = {
  SARVAM: SARVAM_BULBUL_V3_SPEAKERS.map((v) => ({
    value: v,
    label: v,
    description: INDIC,
  })),
  OPENAI: [
    "alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer",
  ].map((v) => ({ value: v, label: v, description: "tts-1 · English-centric" })),
  ELEVENLABS: [
    { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (21m00Tcm4TlvDq8ikWAM)", description: "Multilingual" },
  ],
  CARTESIA: [
    { value: "f786b574-daa5-4673-aa0c-cbe3e8534c02", label: "Katie — Friendly Fixer", description: "Multilingual" },
  ],
  // Deepgram: STT-only in this backend → no selectable TTS voice.
  DEEPGRAM: [],
};

// Default voice per provider. These mirror the worker's hardcoded defaults so a
// fresh selection matches exactly what the backend would use. Every non-OpenAI
// default is multilingual/Indic-capable, so multilingual mode never defaults to
// an English-only voice.
export const TTS_PROVIDER_DEFAULT_VOICE: Record<string, string> = {
  SARVAM: "ishita",
  ELEVENLABS: "21m00Tcm4TlvDq8ikWAM",
  CARTESIA: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
  OPENAI: "alloy",
  DEEPGRAM: "",
};

export function providerHasVoices(provider: string): boolean {
  return (TTS_PROVIDER_VOICES[provider]?.length ?? 0) > 0;
}

export function defaultVoiceForProvider(provider: string): string {
  if (!providerHasVoices(provider)) return "";
  return TTS_PROVIDER_DEFAULT_VOICE[provider] ?? TTS_PROVIDER_VOICES[provider][0].value;
}

export function isVoiceValidForProvider(provider: string, voice: string): boolean {
  const list = TTS_PROVIDER_VOICES[provider];
  // Providers with no TTS voice (Deepgram) are valid only with an empty voice.
  if (!list || list.length === 0) return !voice;
  return list.some((o) => o.value === voice);
}

// Coerce a (provider, voice) pair to a valid one. A provider with a fixed voice
// list snaps an invalid/empty voice to its default; a provider without voices
// (Deepgram) yields empty. Used server-side so a crafted request can't persist
// an incompatible pair (e.g. Sarvam + aura-athena-en).
export function coerceVoiceForProvider(provider: string, voice: string): string {
  if (!providerHasVoices(provider)) return "";
  return isVoiceValidForProvider(provider, voice) ? voice : defaultVoiceForProvider(provider);
}
