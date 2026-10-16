"""Campaign targets must be settled from the CALL's outcome, not the dial's.

The defect these pin, found in live data:

    campaigns:         'abilasri' status=COMPLETED targets=2 dispatched=2
                       completedTargets=0 failedTargets=0
    campaign_targets:  DISPATCHED x4, PENDING x1   (no terminal state, ever)

Every campaign_targets writer lived in the dispatcher and ran before or at dial
time — FAILED (bad number / dial threw), BLOCKED (DND), DEFERRED (outside the
window), DISPATCHED (the dial API accepted). Nothing wrote the row again after
the call ended, so DISPATCHED silently meant "the dial API returned 200" and
was shown as the final state of the attempt.

All mocked: no dial, no SIP, no real campaign is touched.
"""
from __future__ import annotations

import pytest

import db


class FakePool:
    """Records executed statements and returns a chosen UPDATE tag."""

    def __init__(self, tag: str = "UPDATE 1"):
        self.tag = tag
        self.calls: list[tuple] = []

    async def execute(self, sql, *args):
        self.calls.append((" ".join(sql.split()), args))
        return self.tag


@pytest.fixture
def pool(monkeypatch):
    p = FakePool()

    async def fake_get_pool():
        return p

    monkeypatch.setattr(db, "get_pool", fake_get_pool)
    return p


# ── settle_campaign_target ─────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_a_connected_call_settles_the_target_completed(pool):
    ok = await db.settle_campaign_target("call-919-1234", status="COMPLETED")
    assert ok is True
    sql, args = pool.calls[0]
    assert "UPDATE campaign_targets" in sql
    assert args[0] == "call-919-1234"
    assert args[1] == "COMPLETED"


@pytest.mark.asyncio
async def test_an_unconnected_call_settles_failed_with_a_reason(pool):
    await db.settle_campaign_target("call-919-1234", status="FAILED",
                                    error="no answer")
    sql, args = pool.calls[0]
    assert args[1] == "FAILED"
    assert args[2] == "no answer"
    assert '"lastError" = COALESCE($3' in sql, "must not erase an existing error"


@pytest.mark.asyncio
async def test_it_is_keyed_on_the_room_via_callId(pool):
    """mark_campaign_target_dispatched stores the room name in callId; that is
    the only link the worker has back to the target."""
    await db.settle_campaign_target("call-919-1234", status="COMPLETED")
    sql, _ = pool.calls[0]
    assert 'WHERE "callId" = $1' in sql


@pytest.mark.asyncio
async def test_only_a_dispatched_target_is_settled(pool):
    """Idempotent, and incapable of overwriting a target the DISPATCHER
    already resolved as BLOCKED/DEFERRED/FAILED."""
    await db.settle_campaign_target("call-919-1234", status="COMPLETED")
    sql, _ = pool.calls[0]
    assert "AND status = 'DISPATCHED'" in sql


@pytest.mark.asyncio
async def test_no_matching_row_reports_false(monkeypatch):
    p = FakePool(tag="UPDATE 0")

    async def fake_get_pool():
        return p

    monkeypatch.setattr(db, "get_pool", fake_get_pool)
    assert await db.settle_campaign_target("call-not-a-campaign",
                                           status="COMPLETED") is False


@pytest.mark.asyncio
async def test_an_empty_room_touches_nothing(pool):
    assert await db.settle_campaign_target("", status="COMPLETED") is False
    assert pool.calls == []


@pytest.mark.asyncio
async def test_a_direct_inbound_call_is_not_a_campaign_target(monkeypatch):
    """Most calls belong to no campaign; the update must simply match nothing
    rather than error or touch unrelated rows."""
    p = FakePool(tag="UPDATE 0")

    async def fake_get_pool():
        return p

    monkeypatch.setattr(db, "get_pool", fake_get_pool)
    assert await db.settle_campaign_target("call-inbound-99", status="COMPLETED") is False
    assert len(p.calls) == 1


# ── refresh_campaign_counters ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_counters_are_derived_from_targets_not_incremented(pool):
    """Incrementing would drift; deriving self-heals the counters that sat at
    zero for every historical campaign."""
    await db.refresh_campaign_counters("call-919-1234")
    sql, args = pool.calls[0]
    assert "UPDATE campaigns" in sql
    assert "COUNT(*) FILTER (WHERE t.status = 'COMPLETED')" in sql
    assert "COUNT(*) FILTER (WHERE t.status IN ('FAILED','BLOCKED'))" in sql
    assert "+ 1" not in sql and "+1" not in sql
    assert args[0] == "call-919-1234"


@pytest.mark.asyncio
async def test_counters_resolve_the_campaign_from_the_room(pool):
    await db.refresh_campaign_counters("call-919-1234")
    sql, _ = pool.calls[0]
    assert 'FROM campaign_targets WHERE "callId" = $1' in sql


@pytest.mark.asyncio
async def test_empty_room_does_not_touch_counters(pool):
    await db.refresh_campaign_counters("")
    assert pool.calls == []


# ── the status the worker chooses ──────────────────────────────────────────
def _decide(duration: int, transcript) -> str:
    """Mirrors the shutdown hook's rule, which is deliberately conservative:
    only states the worker can actually evidence."""
    return "COMPLETED" if (duration > 0 and bool(transcript)) else "FAILED"


@pytest.mark.parametrize("duration,transcript,expected", [
    (42, [{"role": "user", "text": "hello"}], "COMPLETED"),
    (0,  [], "FAILED"),          # never connected
    (8,  [], "FAILED"),          # ringing then dropped — no conversation
    (0,  [{"role": "user", "text": "hi"}], "FAILED"),
])
def test_only_a_real_conversation_counts_as_completed(duration, transcript, expected):
    assert _decide(duration, transcript) == expected


def test_a_200_from_the_dial_api_is_not_a_completed_call():
    """The specific rule the brief sets: an accepted dial proves nothing about
    whether the customer was reached."""
    assert _decide(0, []) == "FAILED"
