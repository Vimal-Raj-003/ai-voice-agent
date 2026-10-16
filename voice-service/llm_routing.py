"""Single source of truth for LLM provider routing.

THE RULE: the provider the user selected controls BOTH the primary and the
fallback LLM. Provider is NEVER inferred from a model name — a model called
``openai/gpt-oss-20b`` served over Groq's endpoint is a GROQ request, billed to
Groq. Only the selected provider decides who is called.

Fallback stays INSIDE the selected provider by default (a different model on the
same account = a different rate-limit bucket, no new credential). Jumping to a
different vendor is a deliberate, logged decision gated behind
``ALLOW_CROSS_PROVIDER_FALLBACK=true`` (default false).

Everything the rest of the service needs to log, persist and bill is carried on
the resolved :class:`LlmRoute`: selected/primary/fallback provider+model, plus
``actual_provider_used``/``actual_model_used`` recorded at runtime as turns are
served.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass, field
from typing import Any

import config
from observability import get_logger

logger = get_logger("llm_routing")

# ── Plugins (imported here so routing is self-contained and testable) ─────────
_openai_plugin: Any = None
try:
    from livekit.plugins import openai as _oai
    _openai_plugin = _oai
except ImportError:
    pass

_google_llm: Any = None
try:
    from livekit.plugins import google as _gp
    _google_llm = getattr(_gp, "LLM", None)
except ImportError:
    pass


# ── Provider identity ────────────────────────────────────────────────────────
# Maps every spelling we might receive (DB enum values, env values, human
# aliases) onto ONE canonical key. The DB enum is OPENAI | GROQ | OPENROUTER |
# ANTHROPIC | CUSTOM, while the code historically spoke "gemini"/"claude" —
# which is why selecting ANTHROPIC used to match nothing and silently land on
# Groq.
_ALIASES = {
    "groq": "groq",
    "openai": "openai",
    "gemini": "gemini", "google": "gemini", "google-gemini": "gemini",
    "anthropic": "anthropic", "claude": "anthropic",
    "openrouter": "openrouter",
    "custom": "custom",
}

CANONICAL_PROVIDERS = ("groq", "openai", "gemini", "anthropic", "openrouter", "custom")


def normalize_provider(raw: str | None) -> str:
    """Canonical provider key for any spelling. NEVER looks at a model name."""
    return _ALIASES.get((raw or "").strip().lower(), "")


@dataclass(frozen=True)
class ProviderSpec:
    key: str
    env_key: str                       # credential that must be present
    default_model: str
    fallback_models: tuple[str, ...]   # same-provider fallbacks, in order
    base_url: str | None = None        # None = the plugin's native endpoint
    native: bool = False               # True = dedicated plugin (not OpenAI-compatible)


def _specs() -> dict[str, ProviderSpec]:
    """Built on demand so env changes (and tests) are picked up."""
    return {
        "groq": ProviderSpec(
            key="groq", env_key="GROQ_API_KEY", base_url=config.GROQ_BASE_URL,
            default_model=config.GROQ_MODEL,
            # A DIFFERENT Groq model is a separate free-tier bucket, so it
            # survives a 429 on the primary without leaving Groq.
            fallback_models=(os.getenv("GROQ_FALLBACK_MODEL", "openai/gpt-oss-20b"),
                             "llama-3.3-70b-versatile", "openai/gpt-oss-20b"),
        ),
        "openai": ProviderSpec(
            key="openai", env_key="OPENAI_API_KEY",
            default_model=config.DEFAULT_LLM_MODEL,
            fallback_models=(os.getenv("OPENAI_FALLBACK_MODEL", "gpt-4o-mini"), "gpt-4o-mini", "gpt-4.1-mini"),
        ),
        "gemini": ProviderSpec(
            key="gemini", env_key="GOOGLE_API_KEY", native=True,
            default_model=config.GEMINI_LLM_MODEL,
            fallback_models=(os.getenv("GEMINI_FALLBACK_MODEL", "gemini-flash-lite-latest"),
                             "gemini-flash-latest"),
        ),
        "anthropic": ProviderSpec(
            key="anthropic", env_key="ANTHROPIC_API_KEY", base_url="https://api.anthropic.com/v1/",
            default_model=os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"),
            fallback_models=(os.getenv("ANTHROPIC_FALLBACK_MODEL", "claude-3-5-haiku-latest"),
                             "claude-3-5-sonnet-latest"),
        ),
        "openrouter": ProviderSpec(
            key="openrouter", env_key="OPENROUTER_API_KEY",
            base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            default_model=os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini"),
            fallback_models=(os.getenv("OPENROUTER_FALLBACK_MODEL", "meta-llama/llama-3.3-70b-instruct"),),
        ),
        "custom": ProviderSpec(
            key="custom", env_key=os.getenv("CUSTOM_LLM_API_KEY_NAME", "CUSTOM_LLM_API_KEY"),
            base_url=os.getenv("CUSTOM_LLM_BASE_URL") or None,
            default_model=os.getenv("CUSTOM_LLM_MODEL", "gpt-4o-mini"),
            fallback_models=(os.getenv("CUSTOM_LLM_FALLBACK_MODEL", ""),),
        ),
    }


def provider_available(key: str) -> tuple[bool, str]:
    """(usable, reason). Checks the credential AND that a plugin can serve it."""
    spec = _specs().get(key)
    if spec is None:
        return False, f"unknown provider '{key}'"
    if not os.environ.get(spec.env_key):
        return False, f"{spec.env_key} is not configured"
    if spec.native and _google_llm is None:
        return False, "livekit-plugins-google is not installed"
    if not spec.native and _openai_plugin is None:
        return False, "livekit-plugins-openai is not installed"
    if key == "custom" and not spec.base_url:
        return False, "CUSTOM_LLM_BASE_URL is not configured"
    return True, ""


# ── Model / provider compatibility ───────────────────────────────────────────
# A model id is NEVER used to pick a provider (see THE RULE). It is used only to
# reject an id the selected provider demonstrably cannot serve, which is a
# different thing: the provider stays exactly as selected, and only the model
# falls back to that provider's default.
#
# WHY THIS EXISTS: `agent_profiles.model` holds the GEMINI REALTIME model id
# (config.GEMINI_MODEL, e.g. "gemini-3.1-flash-live-preview"). The pipeline path
# read the same field as the selected provider's CHAT model, so every legacy
# profile call sent a Gemini id to Groq and took a 404 `model_not_found` on
# EVERY turn, then leaned on the Groq fallback (or spoke the recovery line when
# that 429'd). The route still logged selection_honored=true, so the dashboard
# said the selection was being honoured while no turn could be served.
#
# Only ids that POSITIVELY identify another vendor's native API are rejected:
#  * an id containing "/" is an aggregator-style namespaced id and is always
#    allowed — `openai/gpt-oss-120b` is a GROQ model and the `openai/` prefix
#    must never be read as "use OpenAI";
#  * an unrecognised bare id is allowed, so a newly released model is never
#    blocked by this table.
_NATIVE_MODEL_OWNERS: tuple[tuple[str, str], ...] = (
    ("gemini-", "gemini"),
    ("claude-", "anthropic"),
    ("gpt-4", "openai"),
    ("gpt-5", "openai"),
    ("gpt-3.5", "openai"),
    ("o1-", "openai"),
    ("o3-", "openai"),
    ("chatgpt-", "openai"),
)

# These deliberately serve other vendors' model ids, so ownership says nothing.
_AGGREGATORS = frozenset({"openrouter", "custom"})

# Providers whose own API serves namespaced, "vendor/model" ids. Groq is one:
# `openai/gpt-oss-120b` and `qwen/qwen3.8-27b` are GROQ models. The native
# single-vendor APIs below are not, so a slashed id there is a leftover from a
# different provider — the mirror image of the bug this guard was written for
# (switch an assistant GROQ -> GEMINI and the old `qwen/...` id would be sent to
# Google, 404ing every turn exactly as before).
_SLASHED_ID_PROVIDERS = frozenset({"groq"}) | _AGGREGATORS

# Google accepts its own ids in a canonical "models/<id>" form, so that one
# namespace is not a foreign vendor.
_OWN_NAMESPACES = {"gemini": frozenset({"models", "tunedmodels"})}


def model_owner(model: str) -> str:
    """Canonical provider whose NATIVE api owns this bare model id, else "".

    Never call this to choose a provider — it exists only for `vet_model`.
    """
    m = (model or "").strip().lower()
    if not m or "/" in m:
        return ""
    for prefix, owner in _NATIVE_MODEL_OWNERS:
        if m.startswith(prefix):
            return owner
    return ""


def vet_model(selected_provider: str, model: str) -> tuple[bool, str]:
    """(servable, owner). False only when `model` is provably another vendor's.

    `owner` names the vendor it belongs to when that is identifiable, else
    "namespaced-id" for a slashed id on a single-vendor API.
    """
    m = (model or "").strip()
    if not m or selected_provider in _AGGREGATORS:
        return True, ""
    owner = model_owner(m)
    if owner and owner != selected_provider:
        return False, owner
    if "/" in m and selected_provider not in _SLASHED_ID_PROVIDERS:
        ns = m.split("/", 1)[0].lower()
        if ns not in _OWN_NAMESPACES.get(selected_provider, frozenset())                 and ns != selected_provider:
            return False, "namespaced-id"
    return True, ""


# ── Route ────────────────────────────────────────────────────────────────────
# The cost tables (ProviderRate) and the existing realtime path spell Gemini
# "google". Canonical routing keys stay "gemini"; only the BILLING name is
# translated, so rate lookups keep matching the rows that already exist.
BILLING_ALIASES = {"gemini": "google"}


@dataclass
class LlmRoute:
    """The routing decision for one call, plus what actually got used."""
    selected_provider: str                 # what the user picked (canonical)
    primary_provider: str = ""
    primary_model: str = ""
    fallback_provider: str = ""
    fallback_model: str = ""
    cross_provider_allowed: bool = False
    cross_provider_used: bool = False      # True once a different vendor served a turn
    selection_honored: bool = True         # False = selection could not be served
    # The provider selection and the MODEL selection can fail independently: a
    # foreign model id is replaced by the provider's default while the provider
    # stays exactly as chosen. Reporting one flag for both made that invisible.
    model_honored: bool = True             # False = requested model was unservable
    requested_model: str = ""              # what the profile actually asked for
    reason: str = ""                       # why the route looks the way it does
    # Runtime truth — stamped by `record_use` as turns are served.
    actual_provider_used: str = ""
    actual_model_used: str = ""
    _lock: Any = field(default_factory=threading.Lock, repr=False, compare=False)
    _usage: dict = field(default_factory=dict, repr=False, compare=False)

    def record_use(self, provider: str, model: str) -> None:
        """Record that `provider/model` actually served a turn (billing truth)."""
        if not provider:
            return
        with self._lock:
            self.actual_provider_used = provider
            self.actual_model_used = model
            self._usage[f"{provider}/{model}"] = self._usage.get(f"{provider}/{model}", 0) + 1
            if provider != self.selected_provider:
                self.cross_provider_used = True

    @property
    def usage_breakdown(self) -> dict:
        """{"groq/qwen…": turns} — every provider/model that served this call."""
        with self._lock:
            return dict(self._usage)

    @property
    def billing_provider(self) -> str:
        """Who to bill. The provider that SERVED the turns, never a model prefix."""
        served = self.actual_provider_used or self.primary_provider or self.selected_provider
        return BILLING_ALIASES.get(served, served)

    @property
    def billing_model(self) -> str:
        return self.actual_model_used or self.primary_model

    def log_fields(self) -> dict:
        """The fields the spec requires to be logged/persisted separately."""
        return {
            "selected_provider": self.selected_provider,
            "primary_provider": self.primary_provider,
            "primary_model": self.primary_model,
            "fallback_provider": self.fallback_provider or "none",
            "fallback_model": self.fallback_model or "none",
            "actual_provider_used": self.actual_provider_used or "none",
            "actual_model_used": self.actual_model_used or "none",
            "cross_provider_allowed": self.cross_provider_allowed,
            "cross_provider_used": self.cross_provider_used,
            "selection_honored": self.selection_honored,
            "model_honored": self.model_honored,
            "requested_model": self.requested_model or self.primary_model,
        }


def _pick_fallback_model(spec: ProviderSpec, primary_model: str) -> str:
    """First same-provider fallback that DIFFERS from the primary model."""
    for m in spec.fallback_models:
        if m and m != primary_model:
            return m
    return ""


def resolve_route(profile: dict | None = None) -> LlmRoute:
    """Decide primary + fallback from the SELECTED provider alone.

    The assistant's configured provider wins; `DEFAULT_LLM_PROVIDER` is only a
    fallback for an unset/unknown value. The selected MODEL is honoured too —
    previously the pipeline ignored it and always used the provider default.
    """
    profile = profile or {}
    raw = profile.get("llm_provider") or config.DEFAULT_LLM_PROVIDER
    selected = normalize_provider(raw)
    if not selected:
        selected = normalize_provider(config.DEFAULT_LLM_PROVIDER) or "groq"
        logger.warning("llm_provider_unrecognized", requested=str(raw), using=selected,
                       source="LLM")

    specs = _specs()
    route = LlmRoute(selected_provider=selected,
                     cross_provider_allowed=config.ALLOW_CROSS_PROVIDER_FALLBACK)

    usable, why = provider_available(selected)
    if usable:
        spec = specs[selected]
        route.primary_provider = selected
        # Honour the operator's chosen model; fall back to the provider default.
        wanted = (profile.get("llm_model") or profile.get("model") or "").strip()
        route.requested_model = wanted
        ok, owner = vet_model(selected, wanted)
        if not ok:
            # Keep the PROVIDER exactly as selected — only the unservable model
            # is replaced, and loudly. Silently sending it anyway is what made
            # every turn 404.
            route.model_honored = False
            logger.error("llm_model_foreign_to_provider",
                         selected_provider=selected, requested_model=wanted,
                         model_belongs_to=owner, using_model=spec.default_model,
                         impact="the requested model cannot be served by the selected "
                                "provider; the provider's default model is used instead",
                         source="LLM")
            wanted = ""
        route.primary_model = wanted or spec.default_model
        # An operator-chosen fallback wins; it must still be a DIFFERENT model
        # on the SAME provider, otherwise it just retries the same bucket.
        chosen_fb = (profile.get("fallback_model") or "").strip()
        if chosen_fb:
            fb_ok, fb_owner = vet_model(selected, chosen_fb)
            if not fb_ok:
                logger.error("llm_fallback_model_foreign_to_provider",
                             selected_provider=selected, requested_model=chosen_fb,
                             model_belongs_to=fb_owner, source="LLM")
                chosen_fb = ""
        fb_model = (chosen_fb if chosen_fb and chosen_fb != route.primary_model
                    else _pick_fallback_model(spec, route.primary_model))
        if fb_model:
            route.fallback_provider = selected
            route.fallback_model = fb_model
            route.reason = ("same-provider fallback (selection is source of truth)"
                            if route.model_honored else
                            "provider honoured; requested model unservable, using "
                            "provider default + same-provider fallback")
        elif config.ALLOW_CROSS_PROVIDER_FALLBACK:
            route.fallback_provider, route.fallback_model = _cross_provider_fallback(selected, specs)
            route.reason = "no distinct same-provider model; cross-provider fallback enabled"
        else:
            route.reason = "no distinct same-provider fallback model configured"
        return route

    # The SELECTED provider cannot serve traffic. Never silently swap vendors:
    # say so loudly, and only cross over when explicitly permitted.
    route.selection_honored = False
    logger.error("llm_selected_provider_unavailable", provider=selected, root_cause=why,
                 cross_provider_allowed=config.ALLOW_CROSS_PROVIDER_FALLBACK, source="LLM")
    if not config.ALLOW_CROSS_PROVIDER_FALLBACK:
        route.reason = f"selected provider unusable ({why}); cross-provider fallback disabled"
        return route

    alt, alt_model = _cross_provider_fallback(selected, specs)
    if alt:
        route.primary_provider, route.primary_model = alt, alt_model
        spec = specs[alt]
        route.fallback_provider = alt
        route.fallback_model = _pick_fallback_model(spec, alt_model)
        route.reason = f"selected provider unusable ({why}); crossed to {alt} (explicitly enabled)"
        logger.warning("llm_cross_provider_substitution", **{"from": selected}, to=alt,
                       model=alt_model, reason=why, source="LLM")
    else:
        route.reason = f"selected provider unusable ({why}); no alternative configured"
    return route


def _cross_provider_fallback(exclude: str, specs: dict[str, ProviderSpec]) -> tuple[str, str]:
    """Best OTHER vendor that is actually usable. Only ever called when
    ALLOW_CROSS_PROVIDER_FALLBACK is true."""
    for key in ("gemini", "openai", "anthropic", "groq", "openrouter", "custom"):
        if key == exclude:
            continue
        ok, _ = provider_available(key)
        if ok:
            return key, specs[key].default_model
    return "", ""


# ── Construction ─────────────────────────────────────────────────────────────
def build_llm(provider: str, model: str) -> Any | None:
    """Instantiate the LLM for `provider`/`model`, or None if it cannot be built.

    `provider` decides the endpoint and credential; `model` is passed through
    verbatim. A model name never changes which vendor is called.
    """
    spec = _specs().get(provider)
    if spec is None:
        return None
    ok, why = provider_available(provider)
    if not ok:
        logger.warning("llm_build_skipped", provider=provider, model=model,
                       root_cause=why, source="LLM")
        return None
    key = os.environ[spec.env_key]
    try:
        if spec.native:                                   # Gemini via its own plugin
            return _google_llm(model=model, api_key=key)

        kwargs: dict[str, Any] = {"model": model, "api_key": key, "max_completion_tokens": 512}
        if spec.base_url:
            kwargs["base_url"] = spec.base_url
        if provider == "groq":
            kwargs["temperature"] = config.GROQ_TEMPERATURE
            # Reasoning models spend completion tokens on hidden "thinking" before
            # answering, which truncated replies and cost ~5s of latency. qwen
            # accepts "none"; gpt-oss REQUIRES low/medium/high.
            kwargs["reasoning_effort"] = "low" if model.startswith("openai/gpt-oss") else "none"
            # Never let the SDK retry: on a 429 it honours Groq's retry-after
            # (up to ~20s) and freezes the turn. We own the fallback.
            kwargs["max_retries"] = 0
        return _openai_plugin.LLM(**kwargs)
    except Exception as exc:
        logger.warning("llm_build_failed", provider=provider, model=model,
                       error=str(exc)[:200], source="LLM")
        return None
