"""Provider rate fetcher.

Cost in this app is computed as Call.usage × ProviderRate at query time —
never stored on the Call row alone. So if rates change, every historical
call's reported cost changes with them. The dashboard shows the rates' last-
verified timestamp so users know how fresh the figures are.

Strategy
========
- LLM rates (input + output, per 1M tokens): fetched live from OpenRouter's
  free public API at https://openrouter.ai/api/v1/models. We trust these as
  authoritative because OpenRouter mirrors each provider's published prices
  and updates within minutes of any change.
- STT / TTS / TELEPHONY rates: NO public pricing API exists for any of these
  providers. We seed defaults from code (Nov 2026 list prices) and rely on
  the admin to refresh them via the dashboard. Each rate row carries a
  ``last_verified_at`` timestamp so the UI can flag stale values.

The 3-hourly APScheduler job in server.py calls ``refresh_llm_rates()``.
The dashboard's "Verify rates now" button calls
``POST /api/rates/refresh`` which runs the same function on demand.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx

from observability import get_logger

logger = get_logger("provider_rates")

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

# Map our (provider, sku) tuple to the corresponding openrouter.ai model id.
# Add a row here when you start using a new model so the cron picks it up.
OPENROUTER_LOOKUP: dict[tuple[str, str], str] = {
    ("openai", "gpt-4o-mini"): "openai/gpt-4o-mini",
    ("openai", "gpt-4o"): "openai/gpt-4o",
    # OpenRouter doesn't list Groq's own llama-3.3-70b-versatile; the
    # underlying model is the same Meta llama-3.3-70b-instruct, and
    # OpenRouter mirrors Groq's prices.
    ("groq", "llama-3.3-70b-versatile"): "meta-llama/llama-3.3-70b-instruct",
    ("anthropic", "claude-haiku-3-5"): "anthropic/claude-3.5-haiku",
    ("google", "gemini-3.1-flash-live-preview"): "google/gemini-2.0-flash-001",
}


async def _fetch_openrouter_models() -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(OPENROUTER_MODELS_URL)
        r.raise_for_status()
        data = r.json()
    return data.get("data", [])


async def refresh_llm_rates() -> dict[str, int]:
    """Fetch OpenRouter and overwrite LLM rate rows. Returns a {kind: count}
    summary so callers (cron + manual refresh endpoint) can log results.

    Existing MANUAL rows are NOT overwritten — admin edits stick. Rows whose
    source is OPENROUTER or DEFAULT are bumped to OPENROUTER on success.
    """
    import db  # local import to avoid a cycle at module load.

    try:
        models = await _fetch_openrouter_models()
    except Exception as exc:
        logger.error("openrouter_fetch_failed", error=str(exc))
        return {"errors": 1, "input": 0, "output": 0}

    by_id = {m.get("id"): m for m in models if m.get("id")}
    pool = await db.get_pool()

    n_input = 0
    n_output = 0
    # Prisma maps `DateTime` to Postgres `timestamp(3)` (no tz) — pass naive
    # UTC, otherwise asyncpg refuses with "can't subtract offset-naive and
    # offset-aware datetimes" inside the binding layer.
    now = datetime.now(UTC).replace(tzinfo=None)

    for (provider, sku), or_id in OPENROUTER_LOOKUP.items():
        model = by_id.get(or_id)
        if not model:
            logger.warning("openrouter_model_missing", provider=provider, sku=sku, id=or_id)
            continue
        pricing = model.get("pricing") or {}
        # OpenRouter prices are USD per single token — convert to per-Mtok.
        try:
            prompt_per_tok = float(pricing.get("prompt", 0))
            completion_per_tok = float(pricing.get("completion", 0))
        except (TypeError, ValueError):
            continue
        input_mtok = round(prompt_per_tok * 1_000_000, 6)
        output_mtok = round(completion_per_tok * 1_000_000, 6)

        # Only overwrite rows whose source is DEFAULT or OPENROUTER.
        await pool.execute(
            """UPDATE provider_rates
                  SET "rateUsd" = $1::numeric,
                      source = 'OPENROUTER'::"RateSource",
                      last_verified_at = $2,
                      notes = COALESCE(notes, $3),
                      updated_at = now()
                WHERE provider = $4
                  AND sku = $5
                  AND kind = 'LLM_INPUT_MTOK'::"RateKind"
                  AND source IN ('DEFAULT'::"RateSource", 'OPENROUTER'::"RateSource")""",
            input_mtok, now, "auto-fetched from openrouter.ai", provider, sku,
        )
        n_input += 1

        await pool.execute(
            """UPDATE provider_rates
                  SET "rateUsd" = $1::numeric,
                      source = 'OPENROUTER'::"RateSource",
                      last_verified_at = $2,
                      notes = COALESCE(notes, $3),
                      updated_at = now()
                WHERE provider = $4
                  AND sku = $5
                  AND kind = 'LLM_OUTPUT_MTOK'::"RateKind"
                  AND source IN ('DEFAULT'::"RateSource", 'OPENROUTER'::"RateSource")""",
            output_mtok, now, "auto-fetched from openrouter.ai", provider, sku,
        )
        n_output += 1

    logger.info(
        "rates_refreshed",
        input_rows=n_input,
        output_rows=n_output,
        when=now.isoformat(),
    )
    return {"input": n_input, "output": n_output, "errors": 0}


async def get_all_rates() -> list[dict[str, Any]]:
    """Read every rate row for the dashboard / API."""
    import db
    pool = await db.get_pool()
    rows = await pool.fetch(
        '''SELECT id, provider, sku, kind::text AS kind,
                  "rateUsd"::text AS "rateUsd", source::text AS source,
                  last_verified_at, notes, created_at, updated_at
             FROM provider_rates
            ORDER BY provider, kind, sku''',
    )
    out = []
    for r in rows:
        d = dict(r)
        for k in ("last_verified_at", "created_at", "updated_at"):
            if d.get(k):
                d[k] = d[k].isoformat()
        out.append(d)
    return out
