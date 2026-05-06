"""Shared pytest fixtures."""

import pytest_asyncio
from unittest.mock import AsyncMock

import db


@pytest_asyncio.fixture
async def mock_pool(monkeypatch):
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = None
    pool.fetchrow.return_value = None
    pool.execute.return_value = "INSERT 0 1"
    monkeypatch.setattr(db, "_pool", pool)
    yield pool


@pytest_asyncio.fixture(autouse=True)
async def isolate_db(monkeypatch):
    monkeypatch.setattr(db, "_pool", None)
