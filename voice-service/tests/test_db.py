from unittest.mock import AsyncMock, patch

import pytest

import db


@pytest.mark.asyncio
async def test_get_pool_returns_singleton(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://test")
    db._pool = None  # reset
    fake_pool = AsyncMock()
    with patch("db.asyncpg.create_pool", new_callable=AsyncMock, return_value=fake_pool) as create:
        a = await db.get_pool()
        b = await db.get_pool()
        assert a is b
        create.assert_called_once()


@pytest.mark.asyncio
async def test_close_pool_resets_singleton():
    db._pool = AsyncMock()
    await db.close_pool()
    assert db._pool is None


@pytest.mark.asyncio
async def test_get_all_settings_masks_sensitive(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret")
    monkeypatch.setenv("LIVEKIT_URL", "wss://test")
    fake_pool = AsyncMock()
    fake_pool.fetch.return_value = []
    db._pool = fake_pool
    result = await db.get_all_settings()
    assert result["OPENAI_API_KEY"]["value"] == ""
    assert result["OPENAI_API_KEY"]["configured"] is True
    assert result["LIVEKIT_URL"]["value"] == "wss://test"


# ── pooler client-session budget ──────────────────────────────────────────
def test_pool_ceiling_fits_the_pooler_client_budget():
    """The pool ceiling must fit the pooler's shared CLIENT-SESSION budget.

    Supabase's pooler on port 5432 (session mode) caps CLIENT sessions at 15,
    and that budget is shared by the worker, the API and the dashboard's Prisma
    pool. MEASURED 2026-10-17 with max_size=10: a single 4-minute call grew the
    worker's pool to 8 established connections (asyncpg never shrinks a pool);
    with dashboard 5 + API 3 the total hit 16, and the NEXT call's job died in
    _resolve_profile with "(EMAXCONNSESSION) max clients reached in session
    mode" -- it never reached the dial, so the phone never rang.

    Worker + API both use this pool, and the dashboard's Prisma pool was
    measured at 5, so the Python ceiling must leave room for it.
    """
    import inspect
    import os

    import db as dbmod

    src = inspect.getsource(dbmod.get_pool)
    assert 'os.getenv("DB_POOL_MAX"' in src, "the ceiling must stay tunable per deployment"

    cap = int(os.getenv("DB_POOL_MAX", "4"))
    dashboard_prisma = 5          # measured
    python_services = 2           # worker + API, both on this pool
    assert cap * python_services + dashboard_prisma <= 15, (
        f"DB_POOL_MAX={cap} lets worker+API+dashboard exceed the 15-client "
        f"session-mode budget, which starves the next call's job")


def test_pool_floor_is_small_enough_to_share():
    """min_size is held open permanently by every process, so it must be small."""
    import inspect
    import os

    import db as dbmod

    src = inspect.getsource(dbmod.get_pool)
    assert 'os.getenv("DB_POOL_MIN"' in src
    assert int(os.getenv("DB_POOL_MIN", "1")) <= 2
