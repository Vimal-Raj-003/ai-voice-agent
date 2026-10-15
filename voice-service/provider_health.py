"""Unified runtime provider-health registry + fail-fast error classification.

One place that answers two questions for every STT/LLM/TTS provider:
  1. "What is wrong with this provider right now?" (classify_error)
  2. "Should I even try this provider for the next turn?" (registry.usable)

Design goals (req 16):
  - PERMANENT failures (400 invalid config, 402 credits exhausted, 404 invalid
    model, 401/403 auth) must NOT be retried in a loop — they fail fast and the
    provider is disabled for the rest of the process until manually reset.
  - TRANSIENT pressure (429 rate/quota) puts the provider in a timed COOLDOWN and
    auto-recovers; 5xx / timeout / connection errors are transient-unavailable
    with a short cooldown.
  - It is a pure, dependency-free state store so it is trivially unit-testable and
    safe to consult from the hot path. Logging is injected (no import cycle).

This module does NOT place calls or pick providers; the agent consults it. It is
process-local (one registry per worker process), which is the right scope for a
LiveKit forkserver worker.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, Optional

# ── Health states ─────────────────────────────────────────────────────────────
HEALTHY = "healthy"
COOLDOWN = "cooldown"                 # 429 rate/quota pressure — timed, auto-recovers
QUOTA_EXHAUSTED = "quota_exhausted"   # free-tier RPM/RPD cap — timed cooldown
CREDITS_EXHAUSTED = "credits_exhausted"  # 402 billing — PERMANENT until top-up
AUTH_FAILED = "auth_failed"           # 401/403 bad key — PERMANENT until fixed
INVALID_CONFIG = "invalid_config"     # 400 bad request/options — PERMANENT
INVALID_MODEL = "invalid_model"       # 404 unknown model id — PERMANENT
UNAVAILABLE = "unavailable"           # 5xx / timeout / network — transient, short cooldown

# States that are NOT recoverable by waiting — do not retry until config/billing changes.
PERMANENT_STATES = frozenset({CREDITS_EXHAUSTED, AUTH_FAILED, INVALID_CONFIG, INVALID_MODEL})
# States that recover on their own after a cooldown window.
TIMED_STATES = frozenset({COOLDOWN, QUOTA_EXHAUSTED, UNAVAILABLE})

# Default cooldown windows (seconds).
_COOLDOWN_429 = 45.0
_COOLDOWN_5XX = 10.0


def _status_code(exc: BaseException) -> Optional[int]:
    """Best-effort HTTP status extraction across SDK exception shapes."""
    for attr in ("status_code", "status", "code", "http_status"):
        v = getattr(exc, attr, None)
        if isinstance(v, int) and 100 <= v <= 599:
            return v
    # Nested response object (httpx / openai style).
    resp = getattr(exc, "response", None)
    if resp is not None:
        v = getattr(resp, "status_code", None)
        if isinstance(v, int):
            return v
    return None


def classify_error(exc: BaseException) -> tuple[str, bool, float]:
    """Map a provider exception → (state, retryable, cooldown_seconds).

    retryable=False means FAIL FAST — do not retry this provider this process.
    cooldown_seconds>0 means skip the provider until the window elapses.
    """
    code = _status_code(exc)
    text = str(exc).lower()

    # Credits / billing first — a 402 or an explicit billing phrase is permanent
    # regardless of how the SDK framed it.
    if code == 402 or any(k in text for k in ("credit", "insufficient", "exhaust", "payment", "billing", "quota exceeded", "out of")):
        # Disambiguate "quota" (free-tier RPM, timed) from "credits/billing" (permanent).
        if ("credit" in text or "billing" in text or "payment" in text or code == 402) and "rate" not in text:
            return CREDITS_EXHAUSTED, False, 0.0
    if code == 400:
        return INVALID_CONFIG, False, 0.0
    if code == 404 or "not found" in text or "does not exist" in text or "unknown model" in text:
        return INVALID_MODEL, False, 0.0
    if code in (401, 403) or "unauthorized" in text or "forbidden" in text or "api key" in text or "invalid authentication" in text:
        return AUTH_FAILED, False, 0.0
    if code == 429 or "rate limit" in text or "too many requests" in text or "resource_exhausted" in text:
        # Free-tier RPM/RPD caps and burst 429s — timed cooldown, auto-recovers.
        state = QUOTA_EXHAUSTED if ("quota" in text or "rpd" in text or "per day" in text) else COOLDOWN
        return state, True, _COOLDOWN_429
    if (code is not None and code >= 500) or "timeout" in text or "timed out" in text or "connection" in text or "unavailable" in text:
        return UNAVAILABLE, True, _COOLDOWN_5XX
    # Unknown error — treat as a short transient so one blip does not permanently
    # disable a provider, but it is still retryable.
    return UNAVAILABLE, True, _COOLDOWN_5XX


@dataclass
class _Entry:
    state: str = HEALTHY
    until: float = 0.0          # monotonic deadline for timed states (0 = n/a)
    detail: str = ""
    changed_at: float = 0.0


@dataclass
class ProviderHealth:
    """Process-local provider → health map. `log` is an optional callback
    (event:str, **fields) so this module stays import-cycle-free."""
    log: Optional[Callable[..., None]] = None
    _entries: dict[str, _Entry] = field(default_factory=dict)

    @staticmethod
    def _key(provider: str, kind: str) -> str:
        return f"{(kind or '').lower()}:{(provider or '').lower()}"

    def record_error(self, provider: str, kind: str, exc: BaseException) -> str:
        """Classify an exception and update the provider's state. Returns state."""
        state, retryable, cooldown = classify_error(exc)
        self.mark(provider, kind, state, cooldown, detail=str(exc)[:200])
        return state

    def record_success(self, provider: str, kind: str) -> None:
        """A successful call clears any TIMED degradation (not permanent ones —
        those need a real config/billing change, surfaced by a manual reset)."""
        key = self._key(provider, kind)
        e = self._entries.get(key)
        if e is None:
            return
        if e.state in TIMED_STATES:
            self._set(provider, kind, HEALTHY, 0.0, "recovered")

    def mark(self, provider: str, kind: str, state: str, cooldown_s: float = 0.0, detail: str = "") -> None:
        until = (time.monotonic() + cooldown_s) if (state in TIMED_STATES and cooldown_s > 0) else 0.0
        self._set(provider, kind, state, until, detail)

    def _set(self, provider: str, kind: str, state: str, until: float, detail: str) -> None:
        key = self._key(provider, kind)
        prev = self._entries.get(key)
        self._entries[key] = _Entry(state=state, until=until, detail=detail, changed_at=time.monotonic())
        if self.log and (prev is None or prev.state != state):
            try:
                self.log("provider_health_changed", provider=provider, kind=kind,
                         state=state, previous=(prev.state if prev else HEALTHY),
                         retryable=(state not in PERMANENT_STATES),
                         cooldown_s=round(max(0.0, until - time.monotonic()), 1) if until else 0,
                         detail=detail[:160], source="WORKER")
            except Exception:
                pass

    def usable(self, provider: str, kind: str) -> bool:
        """False if the provider is permanently disabled or still in cooldown."""
        e = self._entries.get(self._key(provider, kind))
        if e is None or e.state == HEALTHY:
            return True
        if e.state in PERMANENT_STATES:
            return False
        if e.until and time.monotonic() >= e.until:
            # Cooldown elapsed → auto-recover.
            self._set(provider, kind, HEALTHY, 0.0, "cooldown_elapsed")
            return True
        return False

    def state_of(self, provider: str, kind: str) -> str:
        e = self._entries.get(self._key(provider, kind))
        if e is None:
            return HEALTHY
        if e.state in TIMED_STATES and e.until and time.monotonic() >= e.until:
            return HEALTHY
        return e.state

    def reset(self, provider: str, kind: str) -> None:
        self._entries.pop(self._key(provider, kind), None)

    def snapshot(self) -> dict[str, dict]:
        now = time.monotonic()
        out: dict[str, dict] = {}
        for key, e in self._entries.items():
            out[key] = {
                "state": e.state,
                "cooldown_remaining_s": round(max(0.0, e.until - now), 1) if e.until else 0,
                "permanent": e.state in PERMANENT_STATES,
                "detail": e.detail,
            }
        return out
