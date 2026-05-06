import json
from unittest.mock import AsyncMock, MagicMock

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


@pytest.mark.asyncio
async def test_build_session_pipeline_raises_without_llm(monkeypatch):
    """When no LLM plugin is loaded, _build_session must raise loudly, not return a useless session."""
    monkeypatch.setattr(agent, "_google_realtime", None)
    monkeypatch.setattr(agent, "_google_beta_realtime", None)
    monkeypatch.setattr(agent, "_openai_plugin", None)
    monkeypatch.setattr(agent.config, "USE_GEMINI_REALTIME", False)
    with pytest.raises(RuntimeError, match="No LLM plugin"):
        agent._build_session(tools=[], system_prompt="test", profile={})


@pytest.mark.asyncio
async def test_shutdown_hook_logs_call_with_transcript(monkeypatch, mock_pool):
    """_shutdown_hook reads chat_ctx.items, formats transcript, calls db.log_call."""
    captured: dict = {}

    async def fake_log_call(**kwargs):
        captured.update(kwargs)
        return "fake-call-id"

    async def fake_remove_active_call(_):
        pass

    monkeypatch.setattr(agent.db, "log_call", fake_log_call)
    monkeypatch.setattr(agent.db, "remove_active_call", fake_remove_active_call)
    monkeypatch.setattr(agent.db, "log_error", AsyncMock())
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("N8N_WEBHOOK_URL", raising=False)

    # Build minimal mocks
    ctx = MagicMock()
    ctx.room.name = "test-room"

    class FakeMessage:
        def __init__(self, role, content):
            self.role = role
            self.content = content

    fake_chat_ctx = MagicMock()
    fake_chat_ctx.items = [
        FakeMessage("user", "Hello"),
        FakeMessage("assistant", "Hi there"),
    ]

    session = MagicMock()
    session.chat_ctx = fake_chat_ctx

    agent_tools = MagicMock()
    agent_tools._call_start_time = __import__("time").time() - 30
    agent_tools._closed_outcome = "BOOKED"
    agent_tools._closed_reason = "appointment confirmed"
    agent_tools.lead_name = "Ravi"
    agent_tools.recording_url = None
    agent_tools.interrupt_count = 1

    await agent._shutdown_hook(ctx, agent_tools, session, {}, "+91111", "Ravi")

    assert captured["phone_number"] == "+91111"
    assert captured["outcome"] == "BOOKED"
    assert captured["was_booked"] is True
    assert "[USER] Hello" in captured["transcript"]
    assert "[ASSISTANT] Hi there" in captured["transcript"]
    assert captured["interrupt_count"] == 1
