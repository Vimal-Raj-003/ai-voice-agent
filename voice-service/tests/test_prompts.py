import re

from prompts import (
    DEFAULT_SYSTEM_PROMPT,
    UNIVERSAL_CONVERSATION,
    RECEPTIONIST_TRANSFER,
    build_prompt,
    count_tokens,
)

_ENGINE_MARKER = "[CONVERSATION ENGINE"
_TRANSFER_MARKER = "[HUMAN TRANSFER]"  # category-routing block (numbers live in the DB)
_PHONE_RE = re.compile(r"\+\d{10,15}")  # no destination may appear in any prompt


def test_default_prompt_is_receptionist():
    # The default role is the VIMS Enterprise receptionist.
    assert "VIMS Enterprise" in DEFAULT_SYSTEM_PROMPT


def test_build_prompt_includes_business_name():
    out = build_prompt(business_name="Acme Dental")
    assert "Acme Dental" in out


def test_build_prompt_uses_custom_prompt():
    out = build_prompt(lead_name="X", custom_prompt="Hello {lead_name}!")
    assert out.startswith("Hello X!")


def test_build_prompt_silently_falls_back_on_keyerror():
    out = build_prompt(custom_prompt="Hello {unknown_field}!")
    assert "{unknown_field}" in out


def test_build_prompt_appends_ist_time_context():
    out = build_prompt()
    assert "[SYSTEM CONTEXT]" in out
    assert "IST" in out


def test_count_tokens_returns_positive_int():
    n = count_tokens("Hello world")
    assert isinstance(n, int)
    assert n > 0


# ── Universal conversation engine (Step A) ──────────────────────────────────
def test_universal_engine_appended_to_default_role():
    out = build_prompt()
    assert _ENGINE_MARKER in out


def test_universal_engine_appended_to_custom_role():
    # A custom role (Sales/Support/Collections…) must inherit the SAME engine.
    out = build_prompt(custom_prompt="You are a SALES agent. Qualify and sell.")
    assert out.startswith("You are a SALES agent")
    assert _ENGINE_MARKER in out


def test_custom_role_does_not_inherit_receptionist_transfer():
    # Receptionist-only transfer routing must NOT leak into a custom role.
    custom = build_prompt(custom_prompt="You are a COLLECTIONS agent.")
    assert _TRANSFER_MARKER not in custom
    # …but the default receptionist DOES get it.
    default = build_prompt()
    assert _TRANSFER_MARKER in default


def test_prompt_never_contains_a_transfer_number():
    """The model picks a CATEGORY; the worker resolves the number.

    A number in the prompt is a number the model can read aloud, mistype, or
    recombine — which is exactly what this feature removes.
    """
    for out in (build_prompt(), build_prompt(custom_prompt="You are a COLLECTIONS agent.")):
        assert not _PHONE_RE.search(out), f"a phone number leaked into the prompt: {out[:200]}"
    assert not _PHONE_RE.search(RECEPTIONIST_TRANSFER)


def test_transfer_block_names_only_the_four_categories():
    for cat in ("software", "marketing", "content", "other"):
        assert cat in RECEPTIONIST_TRANSFER
    # One clarifying question, asked only when the topic is genuinely unknown.
    assert "ONE short question" in RECEPTIONIST_TRANSFER


def test_universal_engine_has_no_persona_or_company_literals():
    # The shared engine must be role-neutral (no persona name / company / numbers).
    assert "VIMS" not in UNIVERSAL_CONVERSATION
    assert "Priya" not in UNIVERSAL_CONVERSATION
    assert _TRANSFER_MARKER not in UNIVERSAL_CONVERSATION
    assert not _PHONE_RE.search(UNIVERSAL_CONVERSATION)
    assert _TRANSFER_MARKER in RECEPTIONIST_TRANSFER
