"""Booking-tool consolidation and platform-prompt trimming — both MEASURED.

Context: Groq GPT-OSS 120B allows 8,000 TPM. The fixed per-request context was
3,593 tokens, so a call at ~5 requests/minute needed ~18,000 TPM and was rate
limited during ordinary conversation.

Nothing here touches a saved assistant prompt.
"""
from __future__ import annotations

import json

import pytest

from prompts import UNIVERSAL_CONVERSATION, count_tokens


class _Room:
    name = "probe"


class _Ctx:
    room = _Room()


def _tools(enabled=None):
    import tools as T
    return T.AppointmentTools(_Ctx()).build_tool_list(enabled)


def _names(tl):
    return [getattr(t, "__name__", getattr(t, "name", "?")) for t in tl]


# ── booking tools ──────────────────────────────────────────────────────────
def test_book_calcom_is_not_exposed_by_default():
    """It books Cal.com WITHOUT the local row, so a booking made through it is
    invisible to the local calendar, reminders and reconciliation — and it
    duplicates book_appointment, which does both as one operation."""
    assert "book_calcom" not in _names(_tools(None))


def test_book_appointment_remains_the_booking_path():
    assert "book_appointment" in _names(_tools(None))


def test_cancellation_is_preserved():
    """The brief requires cancellation to survive; it has no equivalent.

    Cal.com tools are gated on the integration being configured, so this is
    conditional — the point is that cancel_calcom is NOT withdrawn alongside
    book_calcom wherever Cal.com IS available."""
    from tools import calcom_enabled
    if not calcom_enabled():
        pytest.skip("Cal.com not configured in this environment")
    assert "cancel_calcom" in _names(_tools(None))


def test_availability_is_preserved():
    assert "check_availability" in _names(_tools(None))


def test_the_backend_method_is_not_deleted():
    import tools as T
    at = T.AppointmentTools(_Ctx())
    assert hasattr(at, "book_calcom"), \
        "withdrawing a schema must not remove the working backend"


def test_book_calcom_is_still_reachable_when_explicitly_enabled():
    from tools import calcom_enabled
    if not calcom_enabled():
        pytest.skip("Cal.com not configured in this environment")
    assert "book_calcom" in _names(_tools(["book_appointment", "book_calcom"]))


def test_transfer_and_end_call_are_untouched():
    n = _names(_tools(None))
    assert "transfer_to_human" in n and "end_call" in n


def test_the_default_tool_set_got_cheaper_by_the_measured_amount():
    """With Cal.com configured the default set measures 669 tok, down from 829
    — exactly the 160 that book_calcom's schema cost. Without Cal.com the set
    is smaller still (562), since both Cal.com tools are gated off."""
    from livekit.agents.llm.utils import build_strict_openai_schema
    from tools import calcom_enabled
    total = sum(count_tokens(json.dumps(build_strict_openai_schema(t)))
                for t in _tools(None))
    if calcom_enabled():
        assert total == 669, f"measured {total}, expected 669"
        assert 829 - total == 160
    else:
        assert total == 562, f"measured {total}, expected 562 without Cal.com"
    assert "book_calcom" not in _names(_tools(None))


# ── platform prompt ────────────────────────────────────────────────────────
def test_the_duplicated_presence_rule_is_gone():
    """Two bullets stated the same rule. The surviving PRESENCE bullet covers
    'Hello?', 'Are you there?' and the Tamil form, with an example; the removed
    one was strictly contained in it."""
    assert UNIVERSAL_CONVERSATION.count("Never re-greet") == 1
    assert "they are only checking you are there" not in UNIVERSAL_CONVERSATION


def test_the_surviving_rule_still_covers_the_behaviour():
    u = UNIVERSAL_CONVERSATION
    assert "PRESENCE:" in u
    assert "Hello?" in u
    assert "never restart" in u.lower()
    assert "CONTINUE the current topic" in u


def test_platform_prompt_measured_size():
    assert count_tokens(UNIVERSAL_CONVERSATION) == 975, "expected the measured 975"


@pytest.mark.parametrize("rule", [
    "ANSWER THE QUESTION ASKED",     # answer before booking
    "ONE QUESTION AT A TIME",
    "MEMORY:",
    "CORRECTIONS:",
    "LANGUAGE:",
    "INTERRUPTION:",
    "TOOLS:",
    "transfer_to_human",
    "DIDN'T CATCH IT",
    "SHORT REPLIES",
])
def test_every_mandatory_platform_rule_survives(rule):
    """These protect all five assistants, not just the one whose prompt happens
    to restate them — so none may be dropped on overlap grounds."""
    assert rule in UNIVERSAL_CONVERSATION


def test_language_persistence_rules_are_intact():
    u = UNIVERSAL_CONVERSATION
    assert "KEEP it the whole call" in u
    assert "switch ONLY on an explicit request" in u
    assert "Tanglish" in u and "Tamil" in u


def test_tool_honesty_rule_is_intact():
    assert "never claim an action/booking succeeded before the tool confirms" in \
        UNIVERSAL_CONVERSATION


# ── the saved prompts are untouched ────────────────────────────────────────
def test_no_saved_assistant_prompt_is_referenced_or_modified_here():
    import inspect
    import prompts
    src = inspect.getsource(prompts.build_prompt)
    assert "custom_prompt" in src
    assert "template = custom_prompt if custom_prompt else DEFAULT_SYSTEM_PROMPT" in src


def test_a_saved_prompt_still_leads_the_assembled_context():
    from prompts import build_prompt
    saved = "You are Priya for {business_name}. Speak Tamil when asked."
    out = build_prompt(custom_prompt=saved, business_name="VIMS", lead_name="Ravi")
    assert out.startswith("You are Priya for VIMS.")
