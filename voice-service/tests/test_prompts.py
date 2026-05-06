
from prompts import DEFAULT_SYSTEM_PROMPT, build_prompt, count_tokens


def test_default_prompt_contains_priya_marker():
    assert "Priya" in DEFAULT_SYSTEM_PROMPT


def test_build_prompt_interpolates_lead_name():
    out = build_prompt(lead_name="Ravi", business_name="Acme Dental", service_type="cleaning")
    assert "Ravi" in out
    assert "Acme Dental" in out
    assert "cleaning" in out


def test_build_prompt_uses_custom_prompt():
    out = build_prompt(lead_name="X", custom_prompt="Hello {lead_name}!")
    assert out.startswith("Hello X!")


def test_build_prompt_silently_falls_back_on_keyerror():
    out = build_prompt(custom_prompt="Hello {unknown_field}!")
    assert "{unknown_field}" in out


def test_build_prompt_appends_language_directive():
    out = build_prompt(language_preset="hindi")
    assert "[LANGUAGE DIRECTIVE]" in out
    assert "Hindi" in out


def test_build_prompt_appends_ist_time_context():
    out = build_prompt()
    assert "[SYSTEM CONTEXT]" in out
    assert "IST" in out


def test_count_tokens_returns_positive_int():
    n = count_tokens("Hello world")
    assert isinstance(n, int)
    assert n > 0
