"""Deterministic, role-agnostic per-call conversation state.

Memory that does NOT depend on the bounded LLM chat history: a small structured
object the runtime owns for the whole call, injected into every LLM turn as a
compact [CALL STATE] line and updated from explicit signals + CONFIRMED tool
results. Pure + fully unit-testable (no I/O); a `log` callback emits transition
events so the runtime can mirror them to the diagnostics bridge.

Design rules (see Step B requirements):
- Recent explicit value WINS (corrections overwrite).
- Short replies ("yes"/"tomorrow"/"4 PM"…) resolve against `pending_question`.
- Generic acknowledgements are never stored as facts or entity values.
- Tool-CONFIRMED facts are LOCKED: a later unconfirmed (LLM/text) update can't
  silently mutate them.
- Everything here survives chat-history truncation (it lives outside history).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

# Generic acknowledgements / fillers — never stored as a value or a fact. "yes"/
# "no" can still RESOLVE a confirm question (handled explicitly in resolve()).
_ACK = {
    "yes", "yeah", "yep", "yup", "ya", "no", "nope", "ok", "okay", "okey", "k",
    "hmm", "mm", "mhm", "right", "fine", "sure", "good", "great", "thanks",
    "thank you", "hello", "hi", "hey", "what", "huh", "oh", "ah",
    "ஆமா", "ஆம்", "சரி", "இல்ல", "இல்லை", "aama", "aamaam", "seri", "sari", "illa",
}
_YES = {"yes", "yeah", "yep", "yup", "ya", "ok", "okay", "sure", "ஆமா", "ஆம்", "சரி", "aama", "seri"}
_NO = {"no", "nope", "இல்ல", "இல்லை", "illa", "illai"}

# Slots the engine tracks (role-agnostic). Extra keys are allowed too.
ENTITY_KEYS = (
    "name", "date", "time", "service", "product", "order_id", "budget",
    "company", "payment_date", "choice", "confirmed", "team_size",
)


def _norm(s: Any) -> str:
    return str(s or "").strip()


def _is_ack(value: str) -> bool:
    t = value.strip().lower().rstrip(".!?,")
    return t in _ACK


@dataclass
class CallState:
    role: str = "assistant"
    language: str = "auto"
    intent: str | None = None
    phase: str = "greeting"            # greeting|understanding|acting|confirming|closing
    entities: dict[str, str] = field(default_factory=dict)
    pending_slug: str | None = None    # date|time|name|confirm|choice|…
    pending_question: str | None = None
    last_action: str | None = None
    known_facts: list[str] = field(default_factory=list)
    correction_applied: str | None = None
    tool_state: dict[str, str] = field(default_factory=dict)
    unresolved_item: str | None = None
    _locked: set[str] = field(default_factory=set)
    log: Callable[..., None] | None = None

    def _emit(self, event: str, **kw: Any) -> None:
        if self.log:
            try:
                self.log(event, **kw)
            except Exception:
                pass

    # ── mutations ────────────────────────────────────────────────────────────
    def set_language(self, lang: str) -> bool:
        lang = _norm(lang)
        if lang and lang != self.language:
            self.language = lang
            self._emit("call_state_updated", field="language", value=lang)
            return True
        return False

    def set_role(self, role: str) -> None:
        role = _norm(role)
        if role:
            self.role = role

    def set_intent(self, intent: str | None) -> bool:
        intent = _norm(intent) or None
        if intent and intent != self.intent:
            old, self.intent = self.intent, intent
            self._emit("intent_changed", old=old, new=intent)
            return True
        return False

    def set_phase(self, phase: str) -> None:
        phase = _norm(phase)
        if phase and phase != self.phase:
            self.phase = phase
            self._emit("call_state_updated", field="phase", value=phase)

    def update_entity(self, key: str, value: Any, *, confirmed: bool = False) -> bool:
        """Set an entity slot. Correction-wins (overwrites). Generic acks are
        ignored. A key previously CONFIRMED by a tool can't be overwritten by an
        unconfirmed update (requirement 6)."""
        key = _norm(key)
        v = _norm(value)
        if not key or not v or _is_ack(v):
            return False
        if key in self._locked and not confirmed:
            return False
        old = self.entities.get(key)
        if old is not None and old != v:
            self.correction_applied = f"{key}:{old}→{v}"
            self._emit("correction_applied", key=key, old=old, new=v)
        self.entities[key] = v
        if confirmed:
            self._locked.add(key)
        self._emit("entity_updated", key=key, value=v, confirmed=confirmed)
        return True

    def set_tool_fact(self, label: str, *, state: str, entities: dict[str, Any] | None = None) -> None:
        """Record a CONFIRMED tool outcome (authoritative). `label` e.g.
        'availability'/'booking'; `state` e.g. 'checked_free'/'confirmed:ID123'.
        Any entities passed are locked so the LLM can't mutate them."""
        label = _norm(label)
        self.tool_state[label] = _norm(state)
        self.last_action = f"{label}:{_norm(state)}"
        for k, val in (entities or {}).items():
            self.update_entity(k, val, confirmed=True)
        self._emit("tool_state_changed", tool=label, state=_norm(state), last_action=self.last_action)

    def set_pending(self, slug: str | None, question: str | None = None) -> None:
        slug = _norm(slug) or None
        if slug != self.pending_slug or _norm(question) != _norm(self.pending_question):
            self.pending_slug = slug
            self.pending_question = _norm(question) or None
            self._emit("pending_question_changed", slug=slug, question=self.pending_question)

    def clear_pending(self) -> None:
        if self.pending_slug or self.pending_question:
            self.pending_slug = None
            self.pending_question = None
            self._emit("pending_question_changed", slug=None, question=None)

    def resolve_short_reply(self, text: str) -> bool:
        """Resolve a short caller reply against the pending question slug. Returns
        True if it filled/confirmed something. Deterministic — no LLM."""
        if not self.pending_slug:
            return False
        t = _norm(text)
        if not t:
            return False
        slug = self.pending_slug
        if slug in ("date", "time", "name", "service", "choice", "order_id", "company", "product"):
            ok = self.update_entity(slug, t)
            if ok:
                self.clear_pending()
            return ok
        if slug == "confirm":
            low = t.lower().rstrip(".!?,")
            if low in _YES:
                self.entities["confirmed"] = "yes"; self.clear_pending()
                self._emit("entity_updated", key="confirmed", value="yes", confirmed=False); return True
            if low in _NO:
                self.entities["confirmed"] = "no"; self.clear_pending()
                self._emit("entity_updated", key="confirmed", value="no", confirmed=False); return True
            return False
        return False

    def add_fact(self, fact: str) -> bool:
        f = _norm(fact)
        if not f or _is_ack(f):
            return False
        if f in self.known_facts:
            return False
        self.known_facts.append(f)
        if len(self.known_facts) > 12:
            self.known_facts = self.known_facts[-12:]
        self._emit("call_state_updated", field="known_facts", value=f)
        return True

    # ── views ──────────────────────────────────────────────────────────────
    def to_directive(self) -> str:
        """Compact, injected into every LLM turn. Short to protect the token
        budget; carries only set fields."""
        ents = " ".join(f"{k}={v}" for k, v in self.entities.items() if v)
        parts = [f"role={self.role}", f"lang={self.language}", f"phase={self.phase}"]
        if self.intent:
            parts.append(f"intent={self.intent}")
        line = "[CALL STATE] " + " · ".join(parts)
        if ents:
            line += f"\nKnown: {ents}"
        if self.tool_state:
            line += "\nConfirmed (do NOT contradict or re-ask): " + \
                    " ".join(f"{k}={v}" for k, v in self.tool_state.items())
        if self.pending_question:
            line += f"\nYou last asked: {self.pending_question} — interpret a short reply against it."
        if self.known_facts:
            line += "\nFacts: " + " | ".join(self.known_facts[-6:])
        line += ("\nUse this state: never re-ask a Known/Confirmed value; apply the caller's "
                 "latest correction; don't contradict Confirmed tool facts.")
        return line

    def snapshot(self) -> dict[str, Any]:
        return {
            "role": self.role, "language": self.language, "intent": self.intent,
            "phase": self.phase, "entities": dict(self.entities),
            "pending": self.pending_slug, "last_action": self.last_action,
            "tool_state": dict(self.tool_state), "facts": len(self.known_facts),
            "correction_applied": self.correction_applied,
        }
