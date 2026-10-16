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
    # The LLM is no longer chosen from module-level plugin globals; it comes
    # from llm_routing.build_llm (Groq primary, cross-provider fallback). Patch
    # THAT seam, otherwise a real GROQ_API_KEY in the environment silently
    # satisfies the pipeline and nothing raises.
    monkeypatch.setattr(agent, "_google_realtime", None)
    monkeypatch.setattr(agent, "_google_beta_realtime", None)
    monkeypatch.setattr(agent.config, "USE_GEMINI_REALTIME", False)
    monkeypatch.setattr(agent.llm_routing, "build_llm", lambda *a, **k: None)
    with pytest.raises(RuntimeError, match="No LLM available"):
        agent._build_session(tools=[], system_prompt="test", profile={})


@pytest.mark.asyncio
async def test_shutdown_hook_completes_call_with_transcript(monkeypatch, mock_pool):
    """_shutdown_hook reads chat_ctx.items, formats the transcript and COMPLETES
    the existing call row.

    The call row is inserted when the call starts and finished here via
    db.complete_call; db.log_call is only the fallback for an early exit that
    never created a row. This test covers the primary path (agent_tools has a
    _call_id); the fallback is covered by the test below."""
    captured: dict = {}

    async def fake_complete_call(**kwargs):
        captured.update(kwargs)
        return kwargs.get("call_id")

    async def fake_log_call(**kwargs):
        captured.update(kwargs)
        return "fake-call-id"

    async def fake_remove_active_call(_):
        pass

    monkeypatch.setattr(agent.db, "complete_call", fake_complete_call)
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
    # A MagicMock attribute is truthy, so set the real thing: a row exists.
    agent_tools._call_id = "call-row-1"

    await agent._shutdown_hook(ctx, agent_tools, session, {}, "+91111", "Ravi")

    assert captured["phone_number"] == "+91111"
    assert captured["outcome"] == "BOOKED"
    assert captured["was_booked"] is True
    assert "[USER] Hello" in captured["transcript"]
    assert "[ASSISTANT] Hi there" in captured["transcript"]
    assert captured["interrupt_count"] == 1
    assert captured["call_id"] == "call-row-1"


@pytest.mark.asyncio
async def test_shutdown_hook_falls_back_to_log_call_without_row(monkeypatch, mock_pool):
    """With no call row (early exit before session.start), the hook inserts one
    via db.log_call rather than losing the call."""
    captured: dict = {}

    async def fake_log_call(**kwargs):
        captured.update(kwargs)
        return "fallback-call-id"

    async def boom_complete(**kwargs):  # must NOT be used on this path
        raise AssertionError("complete_call called without an existing row")

    monkeypatch.setattr(agent.db, "log_call", fake_log_call)
    monkeypatch.setattr(agent.db, "complete_call", boom_complete)
    monkeypatch.setattr(agent.db, "remove_active_call", AsyncMock())
    monkeypatch.setattr(agent.db, "log_error", AsyncMock())
    monkeypatch.delenv("N8N_WEBHOOK_URL", raising=False)

    ctx = MagicMock()
    ctx.room.name = "test-room"
    session = MagicMock()
    session.chat_ctx = MagicMock()
    session.chat_ctx.items = []

    agent_tools = MagicMock()
    agent_tools._call_start_time = __import__("time").time() - 12
    agent_tools._closed_outcome = "NO_ANSWER"
    agent_tools._closed_reason = "caller hung up"
    agent_tools.lead_name = "Ravi"
    agent_tools.recording_url = None
    agent_tools.interrupt_count = 0
    agent_tools._call_id = None          # no row was ever inserted

    await agent._shutdown_hook(ctx, agent_tools, session, {}, "+91222", "Ravi")

    assert captured["phone_number"] == "+91222"
    assert captured["outcome"] == "NO_ANSWER"
