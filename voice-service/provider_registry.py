"""THE source of truth for every STT/TTS provider JillJill knows about.

Before this file the same provider names were written out in six places
(two dashboard libs, an inline array in a component, the ops registry, the
Prisma enums, and the dispatch chain in agent.py). They drifted, which is how a
Gemini voice ended up saved against Sarvam and how selecting "Deepgram TTS"
silently produced Gemini audio.

Everything here is declarative. The backend builds adapters from `adapter`, the
dashboard renders dropdowns and badges from the same rows served over HTTP, and
`status` is derived — never typed in by hand.

Honesty rules this file enforces:
  * `integrated=False` means NO adapter exists. It renders as "Not Integrated"
    and can never be selected into a working call, however good the vendor is.
  * Ratings and pricing carry `verified` + `source`. Anything unmeasured says
    so rather than guessing.
  * A provider is only "connected" when its credential exists AND an adapter
    exists. A key alone proves nothing.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class Pricing:
    """Normalised so the UI can render one comparable figure per provider."""
    currency: str = ""          # "USD" | "INR"
    unit: str = ""              # "minute" | "hour" | "1k_chars" | "1m_chars"
    rate: float | None = None
    source: str = ""            # official URL the number came from
    checked_at: str = ""        # ISO date it was last confirmed

    @property
    def verified(self) -> bool:
        return self.rate is not None and bool(self.source)


@dataclass(frozen=True)
class Recommendation:
    """End-user guidance for choosing a provider or model.

    This is NOT telemetry and NOT this account's spend. It is editorial advice
    based on published pricing, language suitability and general reputation, so
    it shows whether or not a credential exists — a customer deciding which
    provider to buy needs to see it BEFORE they have a key.

    Kept deliberately separate from `status_badge()`: "Excellent" answers "is
    this any good?", "Not Configured" answers "can I use it right now?". Mixing
    them is what previously made a good provider look broken.
    """
    quality: str = ""          # "Excellent" | "Good" | "Average"
    cost: str = ""             # "Very Low Cost" … "Very High Cost"
    traits: tuple[str, ...] = ()   # capability wording, e.g. "Fast"
    # "operator" = the figure/wording was given by the product owner.
    # "inferred" = filled in here for a model they did not specify.
    source: str = "inferred"
    note: str = ""


# Tone per badge word, so the same wording never renders two different colours.
_QUALITY_TONE = {"Excellent": "good", "Good": "good", "Average": "warn"}
_COST_TONE = {
    "Very Low Cost": "good", "Low Cost": "good", "Best Value": "good",
    "Medium Cost": "info", "High Cost": "warn", "Very High Cost": "warn",
}
_TRAIT_TONE = {
    "Best for Indian Languages": "good", "Indian Languages": "good",
    "Indian Voice": "good", "Best Value": "good",
    "Multilingual": "info", "Fast": "info", "Very Fast": "info",
    "Voice Agent Optimized": "info", "Premium": "info", "Budget": "info",
    "English Focused": "warn",
}


@dataclass(frozen=True)
class ProviderDefinition:
    id: str
    name: str
    capability: str                      # "STT" | "TTS"
    # False => no adapter in this codebase. Shown as "Not Integrated".
    integrated: bool
    credential_env: str = ""
    models: tuple[str, ...] = ()
    voices: tuple[str, ...] = ()
    streaming: bool = False
    realtime: bool = False
    supported_languages: tuple[str, ...] = ()
    indian_languages: tuple[str, ...] = ()
    code_switching: bool = False
    # 1-5. `ratings_verified` says whether these came from a real measurement.
    quality_rating: int = 0
    cost_rating: int = 0                 # 5 = cheapest
    latency_rating: int = 0              # 5 = fastest
    ratings_verified: bool = False
    ratings_note: str = ""
    recommended_for: str = ""
    pricing: Pricing = field(default_factory=Pricing)
    # Name of the builder in agent.py, for traceability. "" when not integrated.
    adapter: str = ""
    # True when a REAL request was refused for billing (402 / credits). Measured,
    # not assumed — it outranks "configured" because a key that cannot pay is
    # not usable.
    billing_blocked: bool = False
    notes: str = ""

    # ── BYOK / pipeline-compatibility facts ──────────────────────────────────
    # How the customer's credential is shaped. Google Cloud wants a
    # service-account JSON blob, everyone else a single key string; the worker
    # has to pass them to different constructor arguments.
    credential_kind: str = "api_key"     # "api_key" | "service_account_json"
    # False when the provider cannot accept a per-tenant credential and must
    # use the server's own key.
    byok: bool = True
    # True when the plugin declares streaming=False, so the live pipeline has to
    # wrap it in LiveKit's StreamAdapter with a VAD to segment utterances.
    # MEASURED from plugin capabilities, 2026-10-13.
    needs_vad: bool = False
    # Whether the STT actually emits interim transcripts on the streaming path.
    # Deliberately separate from the plugin's declared capability: Sarvam
    # declares interim_results=True but emits none in practice, which changes
    # how quickly barge-in can trigger. MEASURED, not declared.
    emits_interim: bool = False


# ── Measured facts feeding the ratings ───────────────────────────────────────
# Sources: provider audit 2026-10-13 (same audio / same text to every engine).
_SARVAM_STT_NOTE = ("Measured: correct Tamil/Telugu/Malayalam script, 423-471ms "
                    "on the same audio where Deepgram took 1823-2127ms.")
_DEEPGRAM_STT_NOTE = ("Measured: accurate English. Tamil came back as Devanagari or "
                      "Latin romanisation and misheard numbers, with HTTP 200.")
_SARVAM_TTS_NOTE = "Measured: natural audio in en/ta/te/ml, ttfb ~1.1-1.3s."
_AURA_NOTE = ("Measured: clear English. Accepts Tamil text and reads it with an "
              "English voice without erroring.")

REGISTRY: tuple[ProviderDefinition, ...] = (
    # ── STT ──────────────────────────────────────────────────────────────────
    ProviderDefinition(
        id="deepgram", name="Deepgram Nova-3 Multilingual", capability="STT", integrated=True,
        credential_env="DEEPGRAM_API_KEY", adapter="_build_stt(deepgram)",
        models=("nova-3", "nova-2"), streaming=True, realtime=True,
        emits_interim=True,
        supported_languages=("en", "multi"), indian_languages=("hi",),
        code_switching=False,
        quality_rating=4, cost_rating=4, latency_rating=3, ratings_verified=True,
        ratings_note=_DEEPGRAM_STT_NOTE,
        recommended_for="English conversations",
        pricing=Pricing("USD", "minute", 0.0058, "https://deepgram.com/pricing", "2026-10-13"),
        notes="Streaming STT with endpointing and keyterm prompting.",
    ),
    ProviderDefinition(
        id="sarvam", name="Sarvam Saaras STT", capability="STT", integrated=True,
        credential_env="SARVAM_API_KEY", adapter="_build_stt(sarvam)",
        models=("saaras:v4", "saarika:v2.5"), streaming=True, realtime=True,
        # MEASURED 2026-10-13: the plugin declares interim_results=True but emits
        # no INTERIM_TRANSCRIPT on a real stream — only finals, 402-654ms after
        # speech ends. Consequence: barge-in cannot trigger mid-utterance the way
        # it does on Deepgram, so the pipeline pairs Sarvam with a VAD to keep
        # interruption responsive.
        emits_interim=False,
        supported_languages=("en", "ta", "te", "ml", "hi", "kn", "mr", "gu", "bn", "pa", "od"),
        indian_languages=("ta", "te", "ml", "hi", "kn", "mr", "gu", "bn", "pa", "od"),
        code_switching=True,
        quality_rating=5, cost_rating=5, latency_rating=5, ratings_verified=True,
        ratings_note=_SARVAM_STT_NOTE,
        recommended_for="Tamil, Telugu, Malayalam and code-switched speech",
        pricing=Pricing("INR", "hour", 30.0,
                        "https://docs.sarvam.ai/api/getting-started/pricing", "2026-10-13"),
    ),
    ProviderDefinition(
        id="google", name="Google Speech-to-Text", capability="STT", integrated=True,
        credential_env="GOOGLE_APPLICATION_CREDENTIALS_JSON", adapter="_build_stt(google)",
        credential_kind="service_account_json",
        models=("latest_long", "latest_short", "chirp", "chirp_2"),
        streaming=True, realtime=True, emits_interim=True,
        supported_languages=("en", "ta", "te", "ml", "hi", "kn", "mr", "gu", "bn", "multi"),
        indian_languages=("ta", "te", "ml", "hi", "kn", "mr", "gu", "bn"),
        code_switching=False,
        recommended_for="broad language coverage on Google Cloud",
        pricing=Pricing("USD", "minute", 0.016,
                        "https://cloud.google.com/speech-to-text/pricing", "2026-10-13"),
        notes="Streaming with word-level alignment. Credential is a service-account "
              "JSON blob, not an API key.",
    ),
    ProviderDefinition(
        id="cartesia", name="Cartesia Ink-Whisper", capability="STT", integrated=True,
        credential_env="CARTESIA_API_KEY", adapter="_build_stt(cartesia)",
        models=("ink-whisper",), streaming=True, realtime=True, emits_interim=True,
        supported_languages=("en", "multi"),
        recommended_for="low-latency English streaming",
        notes="Streaming STT with interim results.",
    ),
    ProviderDefinition(
        id="openai", name="OpenAI Transcription", capability="STT", integrated=True,
        credential_env="OPENAI_API_KEY", adapter="_build_stt(openai)",
        models=("gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"),
        # MEASURED: the plugin declares streaming=False, so the pipeline wraps it
        # in StreamAdapter + Silero VAD (benchmarked at 37x realtime on this
        # host, 0.54ms per 20ms frame, so the wrapper is affordable).
        streaming=False, needs_vad=True, emits_interim=False,
        supported_languages=("multi",), indian_languages=("hi", "ta"),
        recommended_for="accurate multilingual transcription when latency is less critical",
        pricing=Pricing("USD", "minute", 0.003,
                        "https://openai.com/api/pricing/", "2026-10-13"),
        notes="Not a streaming API: utterances are segmented locally by VAD and sent "
              "per-utterance, so transcripts arrive only after the caller pauses.",
    ),
    ProviderDefinition(
        id="elevenlabs", name="ElevenLabs Scribe", capability="STT", integrated=True,
        credential_env="ELEVENLABS_API_KEY", adapter="_build_stt(elevenlabs)",
        models=("scribe_v1",),
        streaming=False, needs_vad=True, emits_interim=False,
        supported_languages=("multi",), indian_languages=("hi", "ta"),
        recommended_for="accuracy-first batch-style transcription",
        notes="Not a streaming API: segmented locally by VAD, so transcripts arrive "
              "only after the caller pauses.",
    ),

    # ── TTS ──────────────────────────────────────────────────────────────────
    ProviderDefinition(
        id="sarvam", name="Sarvam Bulbul v3", capability="TTS", integrated=True,
        credential_env="SARVAM_API_KEY", adapter="_build_sarvam_tts",
        models=("bulbul:v3",),
        # Exactly the speakers BOTH the installed plugin and the live API accept.
        # Plugin-only names (amelia, sophia) build fine then fail with HTTP 400
        # mid-call; API-only names fail the constructor. Only the intersection is
        # safe to offer.
        voices=("ishita", "priya", "kavya", "ritu", "pooja", "simran", "shreya",
                "neha", "roopa", "suhani", "rupali", "tanya", "shruti", "kavitha",
                "aditya", "rahul", "amit", "ratan", "rohan", "dev", "manan",
                "sumit", "kabir", "varun", "aayan", "ashutosh", "advait", "shubh"),
        streaming=True, realtime=True,
        supported_languages=("en", "ta", "te", "ml", "hi", "kn", "mr", "gu", "bn", "pa", "od"),
        indian_languages=("ta", "te", "ml", "hi", "kn", "mr", "gu", "bn", "pa", "od"),
        code_switching=True,
        quality_rating=5, cost_rating=5, latency_rating=4, ratings_verified=True,
        ratings_note=_SARVAM_TTS_NOTE,
        recommended_for="Indian-language and code-switched speech",
        pricing=Pricing("INR", "1k_chars", 3.0,
                        "https://docs.sarvam.ai/api/getting-started/pricing", "2026-10-13"),
    ),
    ProviderDefinition(
        id="gemini", name="Gemini Flash-Lite TTS", capability="TTS", integrated=True,
        credential_env="GOOGLE_API_KEY", adapter="_build_gemini_tts",
        models=("gemini-3.8-flash-lite-tts",),
        voices=("Aoede", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Zephyr"),
        streaming=True, realtime=True,
        supported_languages=("multi",), indian_languages=("hi", "ta"),
        quality_rating=4, cost_rating=0, latency_rating=4, ratings_verified=False,
        ratings_note="Could not be measured: the account returns HTTP 402, credits depleted.",
        recommended_for="multilingual output when billing is active",
        pricing=Pricing(),      # unverified on purpose
        billing_blocked=True,
    ),
    ProviderDefinition(
        id="deepgram", name="Deepgram Aura-2", capability="TTS", integrated=True,
        credential_env="DEEPGRAM_API_KEY", adapter="_build_deepgram_tts",
        models=("aura-2-thalia-en",), voices=("aura-2-thalia-en",),
        streaming=True, realtime=True,
        supported_languages=("en",), indian_languages=(),
        quality_rating=4, cost_rating=3, latency_rating=3, ratings_verified=True,
        ratings_note=_AURA_NOTE,
        recommended_for="English-only output",
        pricing=Pricing("USD", "1k_chars", 0.030, "https://deepgram.com/pricing", "2026-10-13"),
        notes="English voice model. Do not select for Tamil: it mispronounces without erroring.",
    ),
    ProviderDefinition(
        id="elevenlabs", name="ElevenLabs Turbo v2.5", capability="TTS", integrated=True,
        credential_env="ELEVENLABS_API_KEY", adapter="_build_elevenlabs_tts",
        models=("eleven_turbo_v2_5",), voices=("21m00Tcm4TlvDq8ikWAM",),
        streaming=True, realtime=True,
        supported_languages=("multi",), indian_languages=("hi", "ta"),
        quality_rating=5, cost_rating=1, latency_rating=4, ratings_verified=False,
        ratings_note="Reputation only: no key configured, so nothing was measured here.",
        recommended_for="premium English voice",
        pricing=Pricing("USD", "1k_chars", 0.040, "https://elevenlabs.io/pricing/api", "2026-10-13"),
    ),
    ProviderDefinition(
        id="cartesia", name="Cartesia Sonic", capability="TTS", integrated=True,
        credential_env="CARTESIA_API_KEY", adapter="_build_cartesia_tts",
        models=("sonic-2",), voices=("a0e99841-438c-4a64-b679-ae501e7d6091",),
        streaming=True, realtime=True,
        supported_languages=("multi",), indian_languages=(),
        quality_rating=4, cost_rating=0, latency_rating=5, ratings_verified=False,
        ratings_note="Reputation only: no key configured, so nothing was measured here.",
        recommended_for="low-latency English voice",
        pricing=Pricing(),
    ),
    ProviderDefinition(
        id="openai", name="OpenAI TTS", capability="TTS", integrated=True,
        credential_env="OPENAI_API_KEY", adapter="_build_openai_tts",
        models=("tts-1",),
        voices=("alloy", "ash", "ballad", "coral", "echo", "fable", "onyx",
                "nova", "sage", "shimmer"),
        streaming=True,
        supported_languages=("multi",), indian_languages=(),
        quality_rating=3, cost_rating=0, latency_rating=3, ratings_verified=False,
        ratings_note="Reputation only: no key configured, so nothing was measured here.",
        recommended_for="English output",
        pricing=Pricing(),      # openai.com/api/pricing blocks automated fetch
    ),

    ProviderDefinition(
        id="rumik", name="Rumik Silk / Mulberry", capability="TTS", integrated=True,
        credential_env="RUMIK_API_KEY", adapter="_build_rumik_tts",
        models=("mulberry", "muga"),
        # Canonical mulberry voice names, read from the installed plugin's
        # MULBERRY_VOICES rather than copied from marketing pages.
        voices=("ira", "siya", "aisha", "zoya", "emma", "mia", "sophia", "ava",
                "lucas", "noah", "theo", "adam"),
        streaming=True, realtime=True,
        supported_languages=("en", "hi", "ta", "te", "ml", "kn", "mr", "gu", "bn"),
        indian_languages=("hi", "ta", "te", "ml", "kn", "mr", "gu", "bn"),
        code_switching=True,
        recommended_for="Hinglish / Tanglish code-switching",
        pricing=Pricing(),      # vendor quotes INR per 1k chars; not yet confirmed
        notes=("Adapter via livekit-plugins-rumik 0.2.3 (WebSocket, 24kHz PCM). "
               "No vendor API test has been run — no RUMIK_API_KEY is configured."),
    ),
    ProviderDefinition(
        id="murf", name="Murf Falcon", capability="TTS", integrated=True,
        credential_env="MURF_API_KEY", adapter="_build_murf_tts",
        models=("FALCON", "GEN2"),
        # Locale-prefixed voice ids; the plugin's default plus the Indian-locale
        # voices that matter here. The vendor list is larger and is fetched once
        # a key exists.
        voices=("en-US-matthew", "en-IN-aarav", "en-IN-isha", "ta-IN-abhinav",
                "hi-IN-kabir", "hi-IN-ayushi"),
        streaming=True, realtime=True,
        supported_languages=("en", "ta", "hi", "bn", "multi"),
        indian_languages=("ta", "hi", "bn"),
        recommended_for="low-latency streaming speech",
        pricing=Pricing(),
        notes=("Adapter via livekit-plugins-murf 1.8.4 (WebSocket streaming). "
               "Plugin supports a ta-IN locale. No vendor API test has been run "
               "— no MURF_API_KEY is configured."),
    ),
)


# ── Recommendation metadata (the ONE place badges are authored) ──────────────
# Keyed (capability, provider_id, model_id). Model ids are the strings the
# installed plugins actually accept — read from their model literals, not from
# marketing names — so a badge can never be attached to a model that cannot be
# requested.
#
# Rows marked source="operator" are the product owner's own recommendations.
# Rows marked "inferred" cover models they did not specify; the tooltip says so,
# so nobody mistakes a filled-in guess for a stated position.
_OP = "operator"

MODEL_RECOMMENDATIONS: dict[tuple[str, str, str], Recommendation] = {
    # ── TTS ──────────────────────────────────────────────────────────────────
    ("TTS", "rumik", "mulberry"): Recommendation(
        "Excellent", "Very Low Cost", ("Indian Languages",), _OP),
    ("TTS", "rumik", "muga"): Recommendation(
        "Excellent", "Low Cost", ("Indian Voice",), _OP),
    ("TTS", "sarvam", "bulbul:v3"): Recommendation(
        "Excellent", "Low Cost", ("Best for Indian Languages",), _OP),
    ("TTS", "murf", "FALCON"): Recommendation(
        "Excellent", "Low Cost", ("Fast",), _OP),
    ("TTS", "murf", "GEN2"): Recommendation(
        "Average", "Low Cost", ("Multilingual",), note="Superseded by Falcon for streaming."),
    ("TTS", "deepgram", "aura"): Recommendation(
        "Good", "Low Cost", ("English Focused",), _OP),
    ("TTS", "deepgram", "aura-2"): Recommendation(
        "Good", "Medium Cost", ("Fast",), _OP),
    ("TTS", "gemini", "gemini-3.8-flash-lite-tts"): Recommendation(
        "Excellent", "Very Low Cost", ("Fast",), _OP),
    ("TTS", "cartesia", "sonic-2"): Recommendation(
        "Excellent", "Medium Cost", ("Very Fast",), _OP),
    ("TTS", "cartesia", "sonic-3"): Recommendation(
        "Excellent", "Medium Cost", ("Very Fast",), _OP),
    ("TTS", "elevenlabs", "eleven_v3_conversational"): Recommendation(
        "Excellent", "High Cost", ("Premium",), _OP),
    ("TTS", "elevenlabs", "eleven_v3"): Recommendation(
        "Excellent", "Very High Cost", ("Premium",), _OP),
    ("TTS", "elevenlabs", "eleven_turbo_v2_5"): Recommendation(
        "Excellent", "High Cost", ("Premium", "Fast"),
        note="Turbo tier; cheaper and faster than v3, same voice library."),
    ("TTS", "openai", "tts-1"): Recommendation(
        "Good", "Low Cost", ("Multilingual",)),
    ("TTS", "openai", "gpt-4o-mini-tts"): Recommendation(
        "Good", "Low Cost", ("Multilingual", "Fast")),

    # ── STT ──────────────────────────────────────────────────────────────────
    ("STT", "sarvam", "saaras:v4"): Recommendation(
        "Excellent", "Very Low Cost", ("Best for Indian Languages",), _OP),
    ("STT", "sarvam", "saarika:v2.5"): Recommendation(
        "Excellent", "Very Low Cost", ("Best for Indian Languages",), _OP),
    ("STT", "deepgram", "nova-3-multilingual"): Recommendation(
        "Excellent", "Low Cost", ("Multilingual",), _OP),
    ("STT", "deepgram", "nova-3"): Recommendation(
        "Excellent", "Low Cost", ("Multilingual",), _OP),
    ("STT", "deepgram", "nova-2"): Recommendation(
        "Good", "Low Cost", ("Multilingual",)),
    # Deepgram's Flux family IS in the installed plugin, but only via its v2
    # STT class, which this pipeline does not route to yet.
    ("STT", "deepgram", "flux-general-en"): Recommendation(
        "Excellent", "Medium Cost", ("Voice Agent Optimized",), _OP),
    ("STT", "deepgram", "flux-general-multi"): Recommendation(
        "Excellent", "Medium Cost", ("Voice Agent Optimized", "Multilingual"), _OP),
    ("STT", "openai", "gpt-4o-mini-transcribe"): Recommendation(
        "Good", "Very Low Cost", ("Budget",), _OP),
    ("STT", "openai", "gpt-4o-transcribe"): Recommendation(
        "Excellent", "Low Cost", (), _OP),
    ("STT", "openai", "whisper-1"): Recommendation(
        "Good", "Low Cost", ("Multilingual",)),
    ("STT", "elevenlabs", "scribe_v1"): Recommendation(
        "Excellent", "Medium Cost", ("Multilingual",), _OP),
    ("STT", "elevenlabs", "scribe_v2"): Recommendation(
        "Excellent", "Medium Cost", ("Multilingual",), _OP),
    ("STT", "google", "latest_long"): Recommendation(
        "Good", "Medium Cost", ("Multilingual",), _OP),
    ("STT", "google", "chirp"): Recommendation(
        "Good", "Medium Cost", ("Multilingual",), _OP),
    ("STT", "cartesia", "ink-whisper"): Recommendation(
        "Good", "Medium Cost", ("Fast",)),
}

# Shown on the PROVIDER row, where no model has been chosen. Each points at the
# model that provider actually runs by default, so the dropdown advises on what
# the customer would really get.
_PROVIDER_DEFAULT_MODEL: dict[tuple[str, str], str] = {
    ("TTS", "sarvam"): "bulbul:v3",
    ("TTS", "gemini"): "gemini-3.8-flash-lite-tts",
    ("TTS", "deepgram"): "aura-2",
    ("TTS", "elevenlabs"): "eleven_turbo_v2_5",
    ("TTS", "cartesia"): "sonic-3",
    ("TTS", "openai"): "tts-1",
    ("TTS", "rumik"): "mulberry",
    ("TTS", "murf"): "FALCON",
    ("STT", "deepgram"): "nova-3-multilingual",
    ("STT", "sarvam"): "saaras:v4",
    ("STT", "google"): "latest_long",
    ("STT", "cartesia"): "ink-whisper",
    ("STT", "openai"): "gpt-4o-mini-transcribe",
    ("STT", "elevenlabs"): "scribe_v1",
}


def recommendation_for(capability: str, provider_id: str,
                       model: str | None = None) -> Recommendation | None:
    """The recommendation for a provider, or for one specific model of it.

    Falls back from the exact model, to the model's family prefix (so every
    `aura-2-*` voice resolves to the `aura-2` row), to the provider's default
    model. Returns None when nothing is authored, and the caller shows no
    recommendation rather than inventing one.
    """
    cap, pid = (capability or "").upper(), (provider_id or "").lower()
    m = (model or "").strip()
    if m:
        hit = MODEL_RECOMMENDATIONS.get((cap, pid, m))
        if hit:
            return hit
        # Longest matching family prefix: "aura-2-andromeda-en" -> "aura-2".
        fams = [k[2] for k in MODEL_RECOMMENDATIONS
                if k[0] == cap and k[1] == pid and m.startswith(k[2])]
        if fams:
            return MODEL_RECOMMENDATIONS[(cap, pid, max(fams, key=len))]
    default = _PROVIDER_DEFAULT_MODEL.get((cap, pid))
    if default:
        return MODEL_RECOMMENDATIONS.get((cap, pid, default))
    return None


def _why(rec: Recommendation, part: str) -> str:
    base = {
        "quality": "Overall output quality for voice calls.",
        "cost": "Based on the vendor's published list price, not your usage.",
        "trait": "What this provider or model is best suited to.",
    }[part]
    origin = ("Recommended setting." if rec.source == _OP
              else "General guidance, not a measurement from this account.")
    return f"{base} {origin}{(' ' + rec.note) if rec.note else ''}".strip()


def recommendation_badges(capability: str, provider_id: str,
                          model: str | None = None) -> list[dict]:
    """At most three recommendation badges: quality, cost, and one trait.

    Never credential-dependent — a provider with no key still gets its advice,
    because that advice is how the customer decides whether to buy a key.
    """
    rec = recommendation_for(capability, provider_id, model)
    if rec is None:
        return []
    out: list[dict] = []
    if rec.quality:
        out.append({"label": rec.quality, "tone": _QUALITY_TONE.get(rec.quality, "info"),
                    "why": _why(rec, "quality")})
    if rec.cost:
        out.append({"label": rec.cost, "tone": _COST_TONE.get(rec.cost, "info"),
                    "why": _why(rec, "cost")})
    for t in rec.traits:
        if len(out) >= 3:
            break
        out.append({"label": t, "tone": _TRAIT_TONE.get(t, "info"),
                    "why": _why(rec, "trait")})
    return out[:3]


def model_badge_map(capability: str, provider_id: str) -> dict[str, list[dict]]:
    """Badges for every authored model of one provider, for a model dropdown.

    Exposed so a model selector reads the same table as the provider row —
    this is what keeps badge wording out of the UI code entirely.
    """
    cap, pid = (capability or "").upper(), (provider_id or "").lower()
    return {k[2]: recommendation_badges(cap, pid, k[2])
            for k in MODEL_RECOMMENDATIONS if k[0] == cap and k[1] == pid}


# ── Derived state ────────────────────────────────────────────────────────────
# `byok` is the set of provider ids for which THIS tenant has stored their own
# credential. Passing it in (rather than reading a database here) keeps this
# module import-safe and free of per-request state: the caller resolves the
# tenant, the registry just reports what follows from it.
Byok = frozenset[str] | set[str] | None


def has_server_credential(d: ProviderDefinition) -> bool:
    """True when the SERVER's own env key is present."""
    return bool(d.credential_env and (os.environ.get(d.credential_env) or "").strip())


def credential_source(d: ProviderDefinition, byok: Byok = None) -> str:
    """Where the usable credential comes from: "tenant" | "server" | "".

    Tenant wins deliberately — that is the whole point of BYOK, and it keeps one
    customer's traffic off another's quota.
    """
    if byok and d.id in byok:
        return "tenant"
    if has_server_credential(d):
        return "server"
    return ""


def is_configured(d: ProviderDefinition, byok: Byok = None) -> bool:
    return bool(credential_source(d, byok))


def status_of(d: ProviderDefinition, byok: Byok = None) -> str:
    """One word the UI can show. Derived, never authored.

    not_integrated -> no adapter, whatever the credential says
    not_configured -> adapter exists, no credential (tenant's or server's)
    configured     -> adapter + credential; a live check decides "connected"
    """
    if not d.integrated:
        return "not_integrated"
    if not is_configured(d, byok):
        return "not_configured"
    if d.billing_blocked:
        return "billing_required"
    return "configured"


def can_run_calls(d: ProviderDefinition, byok: Byok = None) -> bool:
    """Whether a live call may actually be placed on this provider.

    This is the single gate the worker and the dashboard both use, so "visible
    in the dropdown" and "allowed to start a call" can differ without the two
    sides disagreeing about which is which.
    """
    return bool(d.integrated and is_configured(d, byok) and not d.billing_blocked)


def status_badge(d: ProviderDefinition, byok: Byok = None) -> dict:
    """The ONE connection-status chip, kept apart from the recommendations.

    Recommendation badges answer "is this provider any good?"; this answers "can
    I use it right now?". They used to share one badge row, which meant a well
    regarded provider with no key rendered as nothing but "Needs API Key" — the
    customer could not see it was worth buying.

    Never contains an HTTP code or a vendor error string; the detail goes in
    `why`, which the UI shows only as a tooltip.
    """
    if not d.integrated:
        return {"label": "Not Integrated", "tone": "info", "status": "not_integrated",
                "why": d.notes or "No adapter exists for this provider yet."}
    if d.billing_blocked:
        return {"label": "Billing Required", "tone": "bad", "status": "billing_required",
                "why": "A real request was refused: the account's credits are depleted."}
    if not is_configured(d, byok):
        return {"label": "Not Configured", "tone": "warn", "status": "not_configured",
                "why": ("No credential for this provider yet. Add one on the API keys "
                        "page to enable it for live calls.")}
    src = credential_source(d, byok)
    return {"label": "Connected", "tone": "good", "status": "configured",
            "why": ("Using your organisation's own key." if src == "tenant"
                    else "Using the platform key. Run a health check to confirm.")}


def _price_label(d: ProviderDefinition) -> str:
    p = d.pricing
    if not p.verified:
        return "Price Unverified"
    sym = "₹" if p.currency == "INR" else "$"
    unit = {"minute": "/min", "hour": "/hr", "1k_chars": "/1K chars",
            "1m_chars": "/1M chars"}.get(p.unit, "")
    return f"~{sym}{p.rate:g}{unit}"


def price_label(d: ProviderDefinition) -> str:
    return _price_label(d)


def to_dict(d: ProviderDefinition, byok: Byok = None) -> dict[str, Any]:
    out = asdict(d)
    out["pricing"]["verified"] = d.pricing.verified
    out["status"] = status_of(d, byok)
    out["configured"] = is_configured(d, byok)
    out["credentialSource"] = credential_source(d, byok)
    # The gate for starting a call. The dropdown shows every provider; only
    # these may actually be used, and the UI explains the difference.
    out["canRunCalls"] = can_run_calls(d, byok)
    out["needsCredential"] = bool(d.integrated and not is_configured(d, byok))
    out["priceLabel"] = price_label(d)
    # Recommendation badges: editorial advice about the provider itself. Shown
    # regardless of credential state, because that is what a customer uses to
    # decide which provider to buy a key for.
    out["badges"] = recommendation_badges(d.capability, d.id)
    # Connection status: a SEPARATE chip, so "Excellent" and "Not Configured"
    # can both be true at once without one hiding the other.
    out["statusBadge"] = status_badge(d, byok)
    # Per-model badges from the same table, for a model selector.
    out["modelBadges"] = model_badge_map(d.capability, d.id)
    out["recommendedModel"] = _PROVIDER_DEFAULT_MODEL.get((d.capability, d.id), "")
    # The dashboard keys its enums in upper case.
    out["value"] = d.id.upper()
    return out


def serialize(capability: str | None = None, byok: Byok = None) -> list[dict[str, Any]]:
    rows = [d for d in REGISTRY if capability is None or d.capability == capability.upper()]
    return [to_dict(d, byok) for d in rows]


def get(provider_id: str, capability: str) -> ProviderDefinition | None:
    pid, cap = (provider_id or "").lower(), (capability or "").upper()
    for d in REGISTRY:
        if d.id == pid and d.capability == cap:
            return d
    return None


def is_valid_voice(provider_id: str, voice: str) -> bool:
    """A provider/voice pair is only valid if this provider declares that voice.

    This is what makes "Sarvam + Aoede" structurally impossible.
    """
    d = get(provider_id, "TTS")
    if d is None:
        return False
    if not d.voices:
        return not voice
    return voice in d.voices


def default_voice(provider_id: str) -> str:
    d = get(provider_id, "TTS")
    return d.voices[0] if d and d.voices else ""


def coerce_voice(provider_id: str, voice: str) -> str:
    """Return `voice` when this provider can speak it, else its default."""
    return voice if is_valid_voice(provider_id, voice) else default_voice(provider_id)
