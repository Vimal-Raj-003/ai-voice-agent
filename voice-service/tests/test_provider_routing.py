"""Strict provider routing: the selected provider/model is the one used.

Context for the `openrouter_model_missing` investigation these pin:

  * That warning came from provider_rates.refresh_llm_rates() — the PRICING
    registry — not from routing. It is emitted while refreshing cost rows from
    OpenRouter's public /models list on a 3-hourly cron, in the API process.
    provider_rates is not imported by agent.py, tools.py or llm_routing.py, so
    it cannot run during a call.
  * The configured model (openai/gpt-oss-120b) is not even in OPENROUTER_LOOKUP;
    the missing ids were anthropic/claude-3.5-haiku and
    google/gemini-2.0-flash-001, both for providers not in use.

All mocked. No provider request is made.
"""
from __future__ import annotations

import pytest

import llm_routing
import provider_rates


# ── 1/2. Groq + an "openai/"-prefixed model stays on Groq ──────────────────
def test_groq_spec_points_at_groq(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    spec = llm_routing._specs()["groq"]
    assert spec.env_key == "GROQ_API_KEY"
    assert "api.groq.com" in spec.base_url
    assert "openrouter" not in spec.base_url.lower()
    assert "openai.com" not in spec.base_url.lower()


def test_openai_prefixed_model_does_not_switch_provider(monkeypatch):
    """`openai/gpt-oss-120b` is a GROQ model id. The prefix must never be read
    as "use OpenAI" or "use OpenRouter"."""
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    captured = {}

    class FakeLLM:
        def __init__(self, **kw):
            captured.update(kw)

    monkeypatch.setattr(llm_routing, "_openai_plugin",
                        type("P", (), {"LLM": FakeLLM})())
    out = llm_routing.build_llm("groq", "openai/gpt-oss-120b")
    assert out is not None
    assert captured["model"] == "openai/gpt-oss-120b", "model must pass through verbatim"
    assert captured["api_key"] == "gsk_test", "must use the GROQ credential"
    assert "api.groq.com" in captured["base_url"]
    # gpt-oss requires an explicit reasoning effort on Groq.
    assert captured.get("reasoning_effort") == "low"
    # We own the fallback; the SDK must not retry a 429 behind our back.
    assert captured.get("max_retries") == 0


def test_model_name_never_selects_the_vendor(monkeypatch):
    """Same model string, different provider -> different endpoint/credential."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk_test")
    captured = {}

    class FakeLLM:
        def __init__(self, **kw):
            captured.update(kw)

    monkeypatch.setattr(llm_routing, "_openai_plugin",
                        type("P", (), {"LLM": FakeLLM})())
    llm_routing.build_llm("openai", "gpt-4o-mini")
    assert captured["api_key"] == "sk_test"
    assert "api.groq.com" not in str(captured.get("base_url") or "")


# ── 3. OpenRouter is never involved unless explicitly selected ─────────────
def test_openrouter_is_selectable_but_not_implicit(monkeypatch):
    specs = llm_routing._specs()
    assert "openrouter" in specs, "it remains a choosable provider"
    # ...but no OTHER provider routes through it.
    for name, spec in specs.items():
        if name == "openrouter":
            continue
        assert "openrouter" not in str(spec.base_url or "").lower(), name


def test_groq_build_never_touches_openrouter_env(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    captured = {}

    class FakeLLM:
        def __init__(self, **kw):
            captured.update(kw)

    monkeypatch.setattr(llm_routing, "_openai_plugin",
                        type("P", (), {"LLM": FakeLLM})())
    # Missing OPENROUTER_API_KEY must not prevent a Groq build.
    assert llm_routing.build_llm("groq", "openai/gpt-oss-120b") is not None
    assert "openrouter" not in str(captured.get("base_url") or "").lower()


# ── 4. "Automatic (provider default)" = same-provider fallback ─────────────
def test_groq_fallbacks_are_all_groq_models():
    """The documented reason: a DIFFERENT Groq model is a separate free-tier
    bucket, so a 429 can be survived without leaving Groq."""
    fallbacks = llm_routing._specs()["groq"].fallback_models
    assert fallbacks, "groq must have an in-provider fallback list"
    for m in fallbacks:
        assert "/" not in m or m.startswith("openai/gpt-oss"), m
        assert "claude" not in m and "gemini" not in m and "gpt-4" not in m


def test_cross_provider_fallback_is_off_by_default(monkeypatch):
    monkeypatch.delenv("ALLOW_CROSS_PROVIDER_FALLBACK", raising=False)
    import importlib
    import config as cfg
    importlib.reload(cfg)
    assert cfg.ALLOW_CROSS_PROVIDER_FALLBACK is False, (
        "leaving the selected provider must be opt-in")


@pytest.mark.parametrize("value,expected", [
    ("true", True), ("1", True), ("yes", True), ("on", True),
    ("false", False), ("", False), ("no", False),
])
def test_cross_provider_flag_parsing(monkeypatch, value, expected):
    monkeypatch.setenv("ALLOW_CROSS_PROVIDER_FALLBACK", value)
    import importlib
    import config as cfg
    importlib.reload(cfg)
    assert cfg.ALLOW_CROSS_PROVIDER_FALLBACK is expected


# ── 5. the pricing warning is a cost concern, not a routing one ────────────
def test_pricing_registry_is_not_on_the_call_path():
    """If the call path imported provider_rates, a pricing refresh could run
    inside a call — and an OpenRouter outage would then affect a live call.
    Read the sources as text so this holds without importing the worker."""
    import pathlib
    import re
    here = pathlib.Path(__file__).resolve().parent.parent
    for name in ("agent.py", "tools.py", "llm_routing.py"):
        src = (here / name).read_text(encoding="utf-8")
        assert re.search(r"^\s*(import|from)\s+provider_rates", src, re.M) is None, (
            f"{name} imports the pricing registry")


def test_configured_groq_model_is_not_in_the_openrouter_price_lookup():
    """The warning could never have referred to the model actually in use."""
    ids = set(provider_rates.OPENROUTER_LOOKUP.values())
    assert "openai/gpt-oss-120b" not in ids
    skus = {sku for (_prov, sku) in provider_rates.OPENROUTER_LOOKUP}
    assert "openai/gpt-oss-120b" not in skus


@pytest.mark.asyncio
async def test_missing_price_ids_are_reported_once_not_per_sku(monkeypatch):
    """Previously one WARNING per missing SKU, every 3 hours, forever."""
    emitted: list[tuple[str, dict]] = []

    class FakeLogger:
        def warning(self, event, **kw): emitted.append((event, kw))
        def info(self, event, **kw): emitted.append((event, kw))
        def error(self, event, **kw): emitted.append((event, kw))

    async def fake_models():
        # Catalogue missing TWO of the looked-up ids.
        return [{"id": "openai/gpt-4o-mini", "pricing": {"prompt": "0", "completion": "0"}},
                {"id": "openai/gpt-4o", "pricing": {"prompt": "0", "completion": "0"}},
                {"id": "meta-llama/llama-3.3-70b-instruct",
                 "pricing": {"prompt": "0", "completion": "0"}}]

    class FakePool:
        async def execute(self, *a, **k): return "UPDATE 1"

    async def fake_get_pool(): return FakePool()

    monkeypatch.setattr(provider_rates, "logger", FakeLogger())
    monkeypatch.setattr(provider_rates, "_fetch_openrouter_models", fake_models)
    # refresh_llm_rates does a local `import db`, so the real module is what
    # it resolves — patch there, not on provider_rates.
    import db as db_mod
    monkeypatch.setattr(db_mod, "get_pool", fake_get_pool)

    res = await provider_rates.refresh_llm_rates()

    per_sku = [e for e, _ in emitted if e == "openrouter_model_missing"]
    assert per_sku == [], "the per-SKU warning must be gone"
    agg = [kw for e, kw in emitted if e == "openrouter_price_lookup_incomplete"]
    assert len(agg) == 1, "exactly one aggregated line per refresh"
    assert agg[0]["missing_count"] == 2
    assert "routing is unaffected" in agg[0]["impact"]
    assert res["missing"] == 2


@pytest.mark.asyncio
async def test_no_aggregated_warning_when_every_price_resolves(monkeypatch):
    """Real warnings are not suppressed — the line only appears when something
    is genuinely missing."""
    emitted: list[str] = []

    class FakeLogger:
        def warning(self, event, **kw): emitted.append(event)
        def info(self, event, **kw): emitted.append(event)
        def error(self, event, **kw): emitted.append(event)

    async def fake_models():
        return [{"id": i, "pricing": {"prompt": "0", "completion": "0"}}
                for i in provider_rates.OPENROUTER_LOOKUP.values()]

    class FakePool:
        async def execute(self, *a, **k): return "UPDATE 1"

    async def fake_get_pool(): return FakePool()

    monkeypatch.setattr(provider_rates, "logger", FakeLogger())
    monkeypatch.setattr(provider_rates, "_fetch_openrouter_models", fake_models)
    # refresh_llm_rates does a local `import db`, so the real module is what
    # it resolves — patch there, not on provider_rates.
    import db as db_mod
    monkeypatch.setattr(db_mod, "get_pool", fake_get_pool)

    await provider_rates.refresh_llm_rates()
    assert "openrouter_price_lookup_incomplete" not in emitted
    assert "rates_refreshed" in emitted


# ── 6. invalid configuration fails loudly, never silently substitutes ──────
def test_unknown_provider_returns_none_rather_than_a_substitute():
    assert llm_routing.build_llm("not-a-provider", "whatever") is None


def test_missing_credential_returns_none_rather_than_another_provider(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    assert llm_routing.build_llm("groq", "openai/gpt-oss-120b") is None


# ── 7. a foreign model id must not be sent to the selected provider ────────
# Regression for the defect that made 83 turns fail with every provider down:
# agent_profiles.model holds the Gemini REALTIME id, the pipeline read it as the
# selected provider's chat model, and Groq answered 404 model_not_found on every
# turn while the route still logged selection_honored=true.
@pytest.mark.parametrize("model,owner", [
    ("gemini-3.1-flash-live-preview", "gemini"),
    ("gemini-flash-latest", "gemini"),
    ("claude-3-5-haiku-latest", "anthropic"),
    ("gpt-4o-mini", "openai"),
])
def test_foreign_bare_model_ids_are_rejected_for_groq(model, owner):
    ok, got = llm_routing.vet_model("groq", model)
    assert ok is False
    assert got == owner


@pytest.mark.parametrize("model", [
    "openai/gpt-oss-120b",      # a GROQ model; the prefix is not a vendor
    "openai/gpt-oss-20b",
    "qwen/qwen3.8-27b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.3-70b-versatile",  # bare, but owned by no provider we call
    "whisper-large-v3",
])
def test_groq_model_ids_are_accepted(model):
    ok, owner = llm_routing.vet_model("groq", model)
    assert ok is True, f"{model} wrongly rejected as {owner}"


def test_a_slashed_id_is_never_attributed_to_a_vendor():
    """Explicitly: `openai/` must never be read as "use OpenAI"."""
    assert llm_routing.model_owner("openai/gpt-oss-120b") == ""
    assert llm_routing.model_owner("google/gemini-2.0-flash-001") == ""


def test_each_provider_accepts_its_own_native_ids():
    assert llm_routing.vet_model("gemini", "gemini-flash-latest")[0] is True
    assert llm_routing.vet_model("openai", "gpt-4o-mini")[0] is True
    assert llm_routing.vet_model("anthropic", "claude-3-5-haiku-latest")[0] is True


def test_aggregators_may_serve_any_vendors_id():
    """OpenRouter/custom exist to serve other vendors' ids — ownership says
    nothing there, so the guard must not fire."""
    for p in ("openrouter", "custom"):
        assert llm_routing.vet_model(p, "anthropic/claude-3.5-haiku")[0] is True
        assert llm_routing.vet_model(p, "gemini-flash-latest")[0] is True


def test_route_keeps_the_provider_and_swaps_only_the_model(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    route = llm_routing.resolve_route(
        {"llm_provider": "groq", "model": "gemini-3.1-flash-live-preview"})
    assert route.selected_provider == "groq"
    assert route.primary_provider == "groq", "the provider selection must survive"
    assert route.primary_model != "gemini-3.1-flash-live-preview"
    assert llm_routing.vet_model("groq", route.primary_model)[0] is True
    assert route.fallback_provider == "groq"
    # Observability must not claim the model selection was honoured.
    assert route.model_honored is False
    assert route.requested_model == "gemini-3.1-flash-live-preview"
    assert route.log_fields()["model_honored"] is False
    assert "unservable" in route.reason


def test_route_honors_a_valid_selected_model(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    route = llm_routing.resolve_route(
        {"llm_provider": "groq", "model": "openai/gpt-oss-120b"})
    assert route.primary_provider == "groq"
    assert route.primary_model == "openai/gpt-oss-120b"
    assert route.model_honored is True
    assert route.fallback_model != route.primary_model, "fallback must be a different bucket"


def test_a_foreign_operator_fallback_model_is_dropped_not_sent(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    route = llm_routing.resolve_route(
        {"llm_provider": "groq", "model": "openai/gpt-oss-120b",
         "fallback_model": "gemini-flash-latest"})
    assert route.fallback_provider == "groq"
    assert llm_routing.vet_model("groq", route.fallback_model)[0] is True


def test_agent_profiles_model_is_exposed_as_a_realtime_model_only():
    """The root cause: one column meaning two incompatible things."""
    import db
    shaped = db._shape_agent_profile(
        {"id": "p1", "name": "Default", "model": "gemini-3.1-flash-live-preview",
         "voice": "Aoede", "is_default": True})
    assert shaped["realtime_model"] == "gemini-3.1-flash-live-preview"
    assert shaped["model"] is None, "the pipeline must get no chat model from this table"


def test_a_legacy_profile_routes_to_a_servable_groq_model(monkeypatch):
    """End to end over the two fixes: the shape db now returns must produce a
    route whose primary model Groq can actually serve."""
    import db
    monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
    profile = db._shape_agent_profile(
        {"id": "p1", "name": "Default", "model": "gemini-3.1-flash-live-preview",
         "voice": "Aoede", "is_default": True})
    route = llm_routing.resolve_route(profile)
    assert route.primary_provider == "groq"
    assert llm_routing.vet_model("groq", route.primary_model)[0] is True
    assert route.primary_model != "gemini-3.1-flash-live-preview"


# ── 8. the mirror case: a leftover namespaced id after a provider switch ───
@pytest.mark.parametrize("provider", ["gemini", "openai", "anthropic"])
def test_a_leftover_groq_style_id_is_rejected_on_single_vendor_apis(provider):
    """Switching an assistant GROQ -> GEMINI leaves `qwen/qwen3.8-27b` in the
    model field; sending it to Google would 404 every turn."""
    ok, owner = llm_routing.vet_model(provider, "qwen/qwen3.8-27b")
    assert ok is False
    assert owner == "namespaced-id"


def test_googles_canonical_models_prefix_is_not_treated_as_foreign():
    assert llm_routing.vet_model("gemini", "models/gemini-flash-latest")[0] is True


def test_groq_still_accepts_namespaced_ids_after_the_stricter_rule():
    for m in ("openai/gpt-oss-120b", "qwen/qwen3.8-27b",
              "meta-llama/llama-4-scout-17b-16e-instruct"):
        assert llm_routing.vet_model("groq", m)[0] is True, m


def test_gemini_route_drops_a_leftover_groq_model(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "ga_test")
    route = llm_routing.resolve_route(
        {"llm_provider": "GEMINI", "model": "qwen/qwen3.8-27b"})
    if route.primary_provider:            # skip when the google plugin is absent
        assert route.primary_provider == "gemini"
        assert route.model_honored is False
        assert llm_routing.vet_model("gemini", route.primary_model)[0] is True
