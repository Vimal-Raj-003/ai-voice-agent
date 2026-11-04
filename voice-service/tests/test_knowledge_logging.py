import io
from unittest.mock import AsyncMock

import pytest
import structlog

import knowledge
import observability


@pytest.mark.asyncio
async def test_tamil_retrieval_survives_logger_created_before_startup(monkeypatch):
    previous = structlog.get_config().copy()
    stream = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", write_through=True)
    monkeypatch.setattr(observability.sys, "stderr", stream)
    monkeypatch.setattr(observability.sys, "stdout", stream)
    monkeypatch.setenv("SENTRY_DSN", "")
    structlog.reset_defaults()
    try:
        # Matches knowledge.py import before agent.py configures observability.
        monkeypatch.setattr(knowledge, "logger", observability.get_logger("knowledge"))
        observability.init_observability()
        monkeypatch.setattr(knowledge, "embed_texts", AsyncMock(return_value=[[0.1, 0.2]]))
        pool = AsyncMock()
        pool.fetch.return_value = [{
            "id": "chunk", "source_id": "source", "metadata": {},
            "url": "https://example.test/services", "title": "Services",
            "content": "Verified business services", "similarity": 0.9,
        }]
        monkeypatch.setattr(knowledge.db, "get_pool", AsyncMock(return_value=pool))
        hits = await knowledge.search("assistant", "எந்த மாதிரி service provide பண்றீங்க?")
        assert len(hits) == 1
        assert hits[0]["content"] == "Verified business services"
        assert "Verified business services" in knowledge.build_context(hits)
    finally:
        structlog.configure(**previous)
