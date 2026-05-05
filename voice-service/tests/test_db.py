import pytest
from unittest.mock import AsyncMock, patch

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
