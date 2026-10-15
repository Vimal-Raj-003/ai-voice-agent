"""Live LLM model discovery, per provider.

The model list is NOT hardcoded: each provider's own models endpoint is queried
with that provider's configured credential, so a model the vendor adds or
removes shows up (or disappears) with no code change. Results are filtered to
models usable for TEXT CHAT — the only LLM capability the voice agent uses —
and cached briefly so opening a dropdown does not hammer the provider API.

Provider is NEVER inferred from a model id. The caller names the provider; we
query that provider's endpoint with that provider's key. A Groq-served model
called ``openai/gpt-oss-20b`` is listed under Groq, because Groq is serving it.

When discovery fails (no key, outage, rate limit) a small local fallback list is
returned with ``stale=True`` so the UI can say "Model list may be outdated"
instead of showing nothing.
"""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

import config
import llm_routing
from observability import get_logger

logger = get_logger("model_catalog")

# Dropdowns are opened repeatedly while editing an assistant; 10 minutes keeps
# them responsive without pinning a stale list for a whole session.
_CACHE_TTL_S = int(os.getenv("MODEL_CATALOG_TTL_SECONDS", "600"))
_TIMEOUT = httpx.Timeout(12.0, connect=6.0)
_cache: dict[str, tuple[float, dict]] = {}

# Capability fences. Providers that publish modality metadata (Groq, Gemini,
# OpenRouter) are filtered on THAT; these name hints are the safety net for
# providers whose models endpoint returns no capability fields at all (OpenAI).
_NON_CHAT_HINTS = (
    "whisper", "tts", "audio", "speech", "orpheus", "transcribe", "realtime",
    "embed", "embedding", "moderation", "dall-e", "image", "imagen", "veo",
    "guard", "rerank", "search", "computer-use", "codex-mini",
)
# A chat model needs room for a conversation; classifiers/guards sit far below.
_MIN_CHAT_CONTEXT = 4096


def _looks_non_chat(model_id: str) -> bool:
    mid = (model_id or "").lower()
    return any(h in mid for h in _NON_CHAT_HINTS)


def _recommended_for(provider: str) -> str:
    """The provider's default model — the one the worker uses when none is set."""
    spec = llm_routing._specs().get(provider)
    return spec.default_model if spec else ""


# ── Local fallback lists (ONLY used when live discovery fails) ───────────────
_FALLBACK: dict[str, tuple[str, ...]] = {
    "groq": ("qwen/qwen3.8-27b", "openai/gpt-oss-20b", "openai/gpt-oss-120b",
             "llama-3.3-70b-versatile"),
    "openai": ("gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"),
    "gemini": ("gemini-flash-latest", "gemini-flash-lite-latest", "gemini-2.5-pro"),
    "anthropic": ("claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"),
    "openrouter": ("openai/gpt-4o-mini", "meta-llama/llama-3.3-70b-instruct"),
    "custom": (),
}


def _entry(model_id: str, provider: str, *, context: int | None = None,
           label: str | None = None, status: str = "available") -> dict:
    return {
        "id": model_id,
        "label": label or model_id,
        "provider": provider,
        "context": context,
        "status": status,
        "recommended": model_id == _recommended_for(provider),
    }


# ── Per-provider discovery ───────────────────────────────────────────────────
async def _fetch_groq(key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://api.groq.com/openai/v1/models",
                        headers={"Authorization": f"Bearer {key}"})
    r.raise_for_status()
    out = []
    for m in r.json().get("data", []):
        mid = m.get("id") or ""
        # Groq publishes real modality metadata — use it rather than guessing.
        ins = set(m.get("input_modalities") or ["text"])
        outs = set(m.get("output_modalities") or ["text"])
        ctx = m.get("context_window") or m.get("context_length")
        if not m.get("active", True):
            continue
        if "text" not in ins or "text" not in outs:      # whisper / orpheus
            continue
        if _looks_non_chat(mid):                          # prompt-guard etc.
            continue
        if isinstance(ctx, int) and ctx < _MIN_CHAT_CONTEXT:
            continue
        out.append(_entry(mid, "groq", context=ctx, label=m.get("name") or mid))
    return out


async def _fetch_openai(key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://api.openai.com/v1/models",
                        headers={"Authorization": f"Bearer {key}"})
    r.raise_for_status()
    # OpenAI's models endpoint returns NO capability/context metadata, so the
    # name hints above are the only available filter here.
    out = [_entry(m.get("id") or "", "openai")
           for m in r.json().get("data", [])
           if (m.get("id") or "") and not _looks_non_chat(m.get("id") or "")]
    # Keep it to conversational families; the raw list includes fine-tunes and
    # legacy completion-only ids that would only confuse the dropdown.
    return [m for m in out if m["id"].startswith(("gpt-", "o1", "o3", "o4", "chatgpt"))]


async def _fetch_gemini(key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://generativelanguage.googleapis.com/v1beta/models",
                        params={"pageSize": 200}, headers={"x-goog-api-key": key})
    r.raise_for_status()
    out = []
    for m in r.json().get("models", []):
        mid = (m.get("name") or "").removeprefix("models/")
        methods = m.get("supportedGenerationMethods") or []
        if not mid or "generateContent" not in methods:   # not a text generator
            continue
        if _looks_non_chat(mid):                          # -tts, embedding, imagen
            continue
        out.append(_entry(mid, "gemini", context=m.get("inputTokenLimit"),
                          label=m.get("displayName") or mid))
    return out


async def _fetch_anthropic(key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://api.anthropic.com/v1/models",
                        headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                        params={"limit": 100})
    r.raise_for_status()
    # Every model Anthropic lists is a chat model.
    return [_entry(m.get("id") or "", "anthropic", label=m.get("display_name") or m.get("id"))
            for m in r.json().get("data", []) if m.get("id")]


async def _fetch_openrouter(key: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get("https://openrouter.ai/api/v1/models",
                        headers={"Authorization": f"Bearer {key}"})
    r.raise_for_status()
    out = []
    for m in r.json().get("data", []):
        mid = m.get("id") or ""
        modality = ((m.get("architecture") or {}).get("modality") or "")
        if not mid or "text" not in modality:
            continue
        out.append(_entry(mid, "openrouter", context=m.get("context_length"),
                          label=m.get("name") or mid))
    return out


_FETCHERS = {
    "groq": _fetch_groq, "openai": _fetch_openai, "gemini": _fetch_gemini,
    "anthropic": _fetch_anthropic, "openrouter": _fetch_openrouter,
}


def _fallback_payload(provider: str, reason: str) -> dict:
    models = [_entry(m, provider) for m in _FALLBACK.get(provider, ())]
    return {
        "provider": provider, "models": models, "source": "fallback",
        "stale": True, "error": reason, "recommended": _recommended_for(provider),
        "fetched_at": time.time(), "count": len(models),
    }


async def list_models(provider: str, *, force_refresh: bool = False) -> dict:
    """All chat-capable models the configured account can currently use.

    Returns ``{provider, models[], source: live|fallback, stale, error,
    recommended, fetched_at, count}``. Never raises — a discovery failure
    degrades to the local fallback list marked ``stale``.
    """
    key_name = llm_routing.normalize_provider(provider)
    if not key_name:
        return {"provider": provider, "models": [], "source": "none", "stale": False,
                "error": f"unknown provider '{provider}'", "recommended": "",
                "fetched_at": time.time(), "count": 0}

    if not force_refresh:
        hit = _cache.get(key_name)
        if hit and hit[0] > time.monotonic():
            cached = dict(hit[1])
            cached["cached"] = True
            return cached

    fetcher = _FETCHERS.get(key_name)
    if fetcher is None:                     # e.g. "custom" — free-text by design
        return _fallback_payload(key_name, "no model discovery endpoint for this provider")

    spec = llm_routing._specs().get(key_name)
    cred = os.environ.get(spec.env_key) if spec else ""
    if not cred:
        return _fallback_payload(key_name, f"{spec.env_key if spec else 'API key'} is not configured")

    started = time.monotonic()
    try:
        models = await fetcher(cred)
    except Exception as exc:
        detail = str(exc)[:200]
        status = getattr(getattr(exc, "response", None), "status_code", None)
        logger.warning("model_discovery_failed", provider=key_name, error=detail,
                       http_status=status, source="LLM")
        return _fallback_payload(key_name, f"discovery failed: {detail}")

    # Recommended first, then alphabetical — so the default is always on top.
    models.sort(key=lambda m: (not m["recommended"], m["id"]))
    payload = {
        "provider": key_name, "models": models, "source": "live", "stale": False,
        "error": "", "recommended": _recommended_for(key_name),
        "fetched_at": time.time(), "count": len(models),
    }
    _cache[key_name] = (time.monotonic() + _CACHE_TTL_S, payload)
    logger.info("model_discovery_completed", provider=key_name, count=len(models),
                latency_ms=int((time.monotonic() - started) * 1000),
                refreshed=force_refresh, source="LLM")
    return payload


def invalidate(provider: str | None = None) -> None:
    """Drop cached results so the next call re-queries the provider."""
    if provider:
        _cache.pop(llm_routing.normalize_provider(provider), None)
    else:
        _cache.clear()
