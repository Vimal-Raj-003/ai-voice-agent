import json
from unittest.mock import MagicMock

import pytest

import agent


@pytest.mark.asyncio
async def test_parse_metadata_merges_job_and_room():
    ctx = MagicMock()
    ctx.job.metadata = json.dumps({"phone_number": "+91111", "lead_name": "Job"})
    ctx.room.metadata = json.dumps({"lead_name": "Room", "business_name": "Acme"})
    out = agent._parse_metadata(ctx)
    assert out["phone_number"] == "+91111"
    assert out["lead_name"] == "Room"  # room overrides
    assert out["business_name"] == "Acme"


@pytest.mark.asyncio
async def test_extract_caller_phone_from_participant_identity():
    ctx = MagicMock()
    p = MagicMock()
    p.name = ""
    p.attributes = {}
    ctx.room.remote_participants = {"sip_+918065480036": p}
    phone, name = agent._extract_caller_phone(ctx, {})
    assert phone == "+918065480036"


@pytest.mark.asyncio
async def test_is_rate_limited_blocks_after_threshold(monkeypatch):
    monkeypatch.setattr(agent.config, "RATE_LIMIT_CALLS_PER_HOUR", 2)
    agent._call_timestamps.clear()
    assert agent.is_rate_limited("+919999") is False
    assert agent.is_rate_limited("+919999") is False
    assert agent.is_rate_limited("+919999") is True


@pytest.mark.asyncio
async def test_load_caller_history_returns_empty_for_unknown(mock_pool):
    out = await agent._load_caller_history("unknown")
    assert out == ""
