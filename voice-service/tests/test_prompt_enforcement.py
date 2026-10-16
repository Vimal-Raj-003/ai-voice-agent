"""The SAVED assistant prompt must be what actually governs the conversation.

Covers the loading path (Assistant Settings -> DB -> worker -> LLM context),
prompt precedence, placeholder substitution, greeting rendering, and the
diagnostics that make all of it provable from Live Logs without ever persisting
the confidential prompt text.

Language, 20-turn retention and CallState continuity are covered by
test_conversation_continuity.py and test_callstate.py; tool execution by
test_tools.py and test_calcom_v2.py. This file does not duplicate them.

All mocked — no SIP call, no provider request, no DB write.
"""
from __future__ import annotations

import re

import pytest

import prompts
from prompts import (
    DEFAULT_SYSTEM_PROMPT,
    build_prompt,
    prompt_fingerprint,
    substitute_placeholders,
)

# A realistic stand-in for the saved Priya prompt: a persona, supported
# languages, knowledge/booking/forwarding rules, and both placeholders.
SAVED = """You are Priya, the appointment coordinator for {business_name}.
Speak Tamil, Tanglish or English — follow the caller's language.
Greet {lead_name} warmly and ask what they need before offering a booking.
Use the knowledge base for business questions. If you do not know, say so.
Only book when the caller asks to book. Transfer to a human on request.
"""


# ── 1. the saved prompt is loaded, first, and verbatim ─────────────────────
def test_saved_prompt_is_used_instead_of_the_platform_default():
    out = build_prompt(custom_prompt=SAVED, business_name="VIMS Enterprise",
                       lead_name="Ravi")
    assert "You are Priya" in out
    # The generic receptionist persona must not be substituted in.
    assert "You are Abi" not in out
    assert DEFAULT_SYSTEM_PROMPT[:80] not in out


def test_saved_prompt_comes_first_and_is_unmodified():
    """Precedence: the operator's text leads; platform rules are appended."""
    expected = SAVED.replace("{business_name}", "VIMS Enterprise") \
                    .replace("{lead_name}", "Ravi")
    out = build_prompt(custom_prompt=SAVED, business_name="VIMS Enterprise",
                       lead_name="Ravi")
    assert out.startswith(expected), "the saved prompt was altered or displaced"


def test_the_saved_prompts_own_rules_survive_assembly():
    out = build_prompt(custom_prompt=SAVED, business_name="VIMS Enterprise",
                       lead_name="Ravi")
    for rule in ("Tamil, Tanglish or English",
                 "ask what they need before offering a booking",
                 "Only book when the caller asks to book",
                 "Transfer to a human on request"):
        assert rule in out, rule


def test_platform_rules_are_appended_not_prepended():
    out = build_prompt(custom_prompt=SAVED)
    i_saved = out.index("You are Priya")
    i_universal = out.index("[IDENTITY")
    assert i_saved < i_universal, "platform rules must not precede the saved prompt"


def test_a_custom_role_never_inherits_the_receptionist_transfer_block():
    """Already asserted in test_prompts.py; re-pinned here because the brief
    requires the assistant's OWN forwarding instructions to stand."""
    out = build_prompt(custom_prompt=SAVED)
    assert "RECEPTIONIST" not in out


def test_platform_default_is_used_only_when_nothing_is_saved():
    assert "You are Abi" in build_prompt(custom_prompt=None)
    assert "You are Abi" in build_prompt(custom_prompt="")


# ── 2. placeholder substitution ────────────────────────────────────────────
def test_both_placeholders_are_substituted():
    out = build_prompt(custom_prompt=SAVED, business_name="VIMS Enterprise",
                       lead_name="Ravi")
    assert "VIMS Enterprise" in out and "Ravi" in out
    assert "{business_name}" not in out and "{lead_name}" not in out


def test_no_supported_placeholder_survives_into_the_prompt():
    out = build_prompt(custom_prompt=SAVED, business_name="B", lead_name="L",
                       service_type="S")
    for name in prompts.PLACEHOLDERS:
        assert "{" + name + "}" not in out


def test_an_unrelated_brace_no_longer_abandons_all_substitution():
    """The old str.format path raised KeyError on ANY unknown brace and fell
    back to the raw template, so the caller heard "{lead_name}" literally."""
    tricky = 'You are Priya at {business_name}. Emit {"intent": "book"} for {lead_name}.'
    out, diag = substitute_placeholders(tricky, business_name="VIMS", lead_name="Ravi")
    assert "VIMS" in out and "Ravi" in out
    assert "{business_name}" not in out and "{lead_name}" not in out
    # The operator's own braces are preserved exactly.
    assert '{"intent": "book"}' in out
    assert diag["substituted"]["business_name"] == 1
    assert diag["substituted"]["lead_name"] == 1


def test_substitution_never_raises_on_any_brace_shape():
    for bad in ("{", "}", "{}", "{{", "}}", "{0}", "{a.b}", "{ lead_name }",
                "{unknown}", "a{b{c}d}e", "{" * 40):
        out, diag = substitute_placeholders(bad, lead_name="L", business_name="B")
        assert isinstance(out, str)
        assert isinstance(diag["unresolved"], list)


def test_an_unknown_placeholder_is_left_alone_and_reported():
    out, diag = substitute_placeholders("Hi {unknown_field} from {business_name}",
                                        business_name="VIMS")
    assert "{unknown_field}" in out, "operator text must not be silently rewritten"
    assert "VIMS" in out, "the known placeholder must still be filled"
    assert "{unknown_field}" in diag["unresolved"]


def test_a_missing_lead_name_does_not_leave_a_placeholder():
    out = build_prompt(custom_prompt=SAVED, business_name="VIMS", lead_name="")
    assert "{lead_name}" not in out


# ── 3. loading diagnostics (safe to persist) ───────────────────────────────
def test_diagnostics_report_the_source_hash_and_substitutions():
    diag: dict = {}
    build_prompt(custom_prompt=SAVED, business_name="VIMS", lead_name="Ravi",
                 diagnostics=diag)
    assert diag["prompt_source"] == "saved_assistant"
    assert diag["prompt_sha"] == prompt_fingerprint(SAVED)
    assert diag["prompt_chars"] == len(SAVED)
    assert diag["substituted"]["business_name"] == 1
    assert diag["substituted"]["lead_name"] == 1
    assert diag["unresolved"] == []
    assert diag["saved_prompt_first_verbatim"] is True
    assert "UNIVERSAL_CONVERSATION" in diag["platform_rules_appended"]


def test_diagnostics_flag_a_fallback_to_the_platform_default():
    diag: dict = {}
    build_prompt(custom_prompt=None, diagnostics=diag)
    assert diag["prompt_source"] == "platform_default"


def test_diagnostics_never_contain_the_prompt_text():
    """The brief forbids logging the confidential prompt by default."""
    diag: dict = {}
    build_prompt(custom_prompt=SAVED, business_name="VIMS", lead_name="Ravi",
                 diagnostics=diag)
    blob = repr(diag)
    for secret in ("You are Priya", "appointment coordinator", "Tanglish"):
        assert secret not in blob, f"{secret!r} leaked into the diagnostics"


def test_the_fingerprint_distinguishes_an_edited_prompt():
    a = prompt_fingerprint(SAVED)
    b = prompt_fingerprint(SAVED + " Also offer a callback.")
    assert a != b
    assert len(a) == 16 and re.fullmatch(r"[0-9a-f]{16}", a)


def test_the_fingerprint_is_stable_across_calls():
    assert prompt_fingerprint(SAVED) == prompt_fingerprint(SAVED)


# ── 4. token-count diagnostics must survive the log redactor ───────────────
# The per-turn ITPM breakdown was persisted entirely as "***redacted***",
# because _SECRET_HINTS matches "token" as a substring and every field is named
# *_tokens. Credentials must still be masked.
@pytest.mark.parametrize("field,value", [
    ("total_input_tokens", 2764),
    ("system_prompt_tokens", 1531),
    ("conversation_history_tokens", 180),
    ("tool_schema_tokens", 640),
    ("current_user_tokens", 12),
    ("business_context_tokens", 154),
    ("llm_input_tokens", 900),
    ("llm_output_tokens", 120),
    ("max_tokens", 250),
    ("history_items", 7),
])
def test_measurement_fields_are_readable(field, value):
    import observability
    assert observability._mask(field, value) == value


@pytest.mark.parametrize("field,value", [
    ("api_key", "sk_live_realkey"),
    ("GROQ_API_KEY", "gsk_realkey"),
    ("auth_token", "eyJhbGciOiJIUzI1NiJ9"),
    ("auth_token", "1234567890"),          # a digit STRING is still a secret
    ("client_secret", "cs_abc"),
    ("aws_secret_access_key", "AKIAEXAMPLE"),
    ("password", "hunter2"),
    ("authorization", "Bearer abc"),
    ("dsn", "https://k@sentry.io/1"),
    ("credential", "x"),
])
def test_credentials_are_still_redacted(field, value):
    import observability
    assert observability._mask(field, value) == "***redacted***"


def test_boolean_key_presence_flags_are_readable():
    """provider_health logs groq_key=bool(...) — a yes/no, not a secret."""
    import observability
    assert observability._mask("groq_key", True) is True
    assert observability._mask("gemini_key", False) is False


def test_non_secret_fields_pass_through_untouched():
    import observability
    assert observability._mask("assistant_name", "Appointment Booker") == "Appointment Booker"
    assert observability._mask("prompt_sha", "174ae475ff002776") == "174ae475ff002776"


# ── 5. the greeting the caller actually hears ──────────────────────────────
# Mirrors the substitution agent.py applies to profile["first_message"] before
# session.say(), including the no-name path.
FIRST = "Hi {lead_name}, this is Priya from {business_name} regarding your appointment."


def _render_greeting(first_message: str, customer_name: str,
                     business_name: str, service_type: str = "your enquiry") -> str:
    fm = first_message.strip()
    if customer_name:
        fm = fm.replace("{lead_name}", customer_name)
    else:
        fm = re.sub(r"\bis this \{lead_name\}\s*\??\s*", "", fm, flags=re.I)
        fm = (fm.replace("Hi {lead_name}, ", "Hi, ")
                .replace("Hi {lead_name},", "Hi,")
                .replace("Hello {lead_name}, ", "Hello, ")
                .replace("{lead_name}, ", "")
                .replace(", {lead_name}", "")
                .replace("{lead_name}", ""))
    fm = fm.replace("{business_name}", business_name).replace("{service_type}", service_type)
    fm = re.sub(r"\s{2,}", " ", fm)
    return re.sub(r"^(Hi|Hello)\s*,\s*,", r"\1,", fm).strip()


def test_greeting_uses_the_caller_name_when_known():
    out = _render_greeting(FIRST, "Ravi", "VIMS Enterprise")
    assert out == "Hi Ravi, this is Priya from VIMS Enterprise regarding your appointment."


def test_greeting_drops_the_name_cleanly_when_unknown():
    out = _render_greeting(FIRST, "", "VIMS Enterprise")
    assert out == "Hi, this is Priya from VIMS Enterprise regarding your appointment."
    assert "{lead_name}" not in out


def test_greeting_never_speaks_a_literal_placeholder():
    for name in ("Ravi", ""):
        out = _render_greeting(FIRST, name, "VIMS Enterprise")
        assert "{" not in out and "}" not in out


def test_greeting_handles_the_is_this_lead_name_form():
    out = _render_greeting("Hi, is this {lead_name}? This is Riya from {business_name}.",
                           "", "VIMS Enterprise")
    assert "{lead_name}" not in out
    assert "is this" not in out
    assert "VIMS Enterprise" in out


def test_greeting_and_prompt_agree_on_the_business_name():
    """They used to diverge: greeting used config.BUSINESS_NAME while the prompt
    body defaulted to "our company"."""
    bn = "VIMS Enterprise"
    greeting = _render_greeting(FIRST, "Ravi", bn)
    prompt = build_prompt(custom_prompt=SAVED, business_name=bn, lead_name="Ravi")
    assert bn in greeting and bn in prompt
    assert "our company" not in prompt


# ── 6. assistant selection must not silently fall through ──────────────────
@pytest.mark.asyncio
async def test_an_assistant_backed_profile_is_marked_as_such(monkeypatch):
    """_profile_source=="assistant" is what gates per-assistant knowledge
    retrieval, so it must be set whenever an assistant resolved."""
    import db
    row = {
        "id": "asst_1", "name": "Appointment Booker", "organizationId": "org_1",
        "systemPrompt": SAVED, "firstMessage": FIRST, "endCallMessage": "Bye",
        "llmProvider": "GROQ", "llmModel": "openai/gpt-oss-120b",
        "llm_fallback_model": None, "temperature": 0.7, "maxTokens": 250,
        "sttProvider": "DEEPGRAM", "sttModel": "nova-2", "sttLanguage": "multi",
        "ttsProvider": "SARVAM", "ttsModel": None, "voiceId": "ishita",
        "silenceTimeoutSeconds": 10, "maxDurationSeconds": 600,
        "endOfSpeechSensitivity": "LOW", "interruptionThresholdMs": 200,
        "backgroundDenoising": True, "voicemailDetection": False,
        "voicemailMessage": None, "confidenceThresholdPct": 50,
        "hallucinationGuard": True, "minPauseMs": 200,
        "recordingEnabled": True, "recordingConsentMessage": None,
        "redactionEnabled": False, "isActive": True,
    }

    class FakePool:
        async def fetchrow(self, *a, **k):
            return row

    async def fake_pool():
        return FakePool()

    monkeypatch.setattr(db, "get_pool", fake_pool)
    prof = await db.get_assistant_as_profile("asst_1")
    assert prof["_profile_source"] == "assistant"
    assert prof["id"] == "asst_1"
    assert prof["system_prompt"] == SAVED
    assert prof["llm_provider"] == "groq"
    assert prof["model"] == "openai/gpt-oss-120b"
    # and the saved prompt must drive the assembled prompt
    assert build_prompt(custom_prompt=prof["system_prompt"],
                        business_name="VIMS").startswith("You are Priya")


def test_the_legacy_default_profile_contributes_no_chat_model():
    """A fall-through to agent_profiles must not hand a realtime model id to the
    selected chat provider (that 404'd every turn)."""
    import db
    shaped = db._shape_agent_profile(
        {"id": "p1", "name": "Default", "model": "gemini-3.1-flash-live-preview",
         "system_prompt": "legacy prompt", "voice": "Aoede", "is_default": True})
    assert shaped["model"] is None
    assert shaped["realtime_model"] == "gemini-3.1-flash-live-preview"
    assert shaped.get("_profile_source") != "assistant", (
        "a legacy profile must not masquerade as an assistant, or knowledge "
        "retrieval would be keyed on a non-assistant id")
