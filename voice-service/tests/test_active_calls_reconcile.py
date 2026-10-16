"""Safety properties of the active_calls reconciliation.

A row in active_calls is written when a call starts and removed by the
shutdown hook. A KILLED worker never runs that hook, so the row is orphaned
and nothing cleans it up. Reconciliation removes those rows -- but it must
never remove a row belonging to a call that is actually in progress, because
capacity accounting counts this table and an under-count lets the dispatcher
over-dial.

These assert the guards, with no database and no LiveKit connection.
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest

import db


class _FakePool:
    """Captures the SQL and arguments a delete would issue."""

    def __init__(self, rowcount: int = 1):
        self.calls: list[tuple] = []
        self.rowcount = rowcount

    async def execute(self, sql, *args):
        self.calls.append((sql, args))
        return f"DELETE {self.rowcount}"


@pytest.fixture
def fake_pool(monkeypatch):
    pool = _FakePool()

    async def get_pool():
        return pool

    monkeypatch.setattr(db, "get_pool", get_pool)
    return pool


@pytest.mark.asyncio
async def test_empty_list_touches_nothing(fake_pool):
    """A reconciliation that found no orphans must issue no DELETE at all."""
    assert await db.delete_active_calls([]) == 0
    assert fake_pool.calls == [], "no SQL should run for an empty candidate list"


@pytest.mark.asyncio
async def test_delete_is_scoped_to_the_given_room_ids(fake_pool):
    await db.delete_active_calls(["room-a", "room-b"])
    sql, args = fake_pool.calls[0]
    assert "room_id = ANY" in sql
    assert args[0] == ["room-a", "room-b"]
    # It must never be a blanket delete.
    assert "DELETE FROM active_calls WHERE room_id" in sql
    assert sql.strip() != "DELETE FROM active_calls"


@pytest.mark.asyncio
async def test_age_predicate_closes_the_recreated_room_race(fake_pool):
    """TOCTOU: between listing LiveKit rooms and deleting, a new call can start
    and reuse the same room id (`call-<phone>-<4 digits>`). Re-asserting the
    age inside the DELETE means a freshly recreated row survives."""
    cutoff = datetime(2026, 10, 16, 5, 0, 0)
    await db.delete_active_calls(["room-a"], older_than=cutoff)
    sql, args = fake_pool.calls[0]
    assert "started_at < $2" in sql, "the delete must re-check the age atomically"
    assert args[1] == cutoff


@pytest.mark.asyncio
async def test_without_a_cutoff_no_age_clause_is_invented(fake_pool):
    """The caller decides; the helper does not silently apply its own window."""
    await db.delete_active_calls(["room-a"])
    sql, _ = fake_pool.calls[0]
    assert "started_at" not in sql


@pytest.mark.asyncio
async def test_repeated_reconciliation_is_idempotent(fake_pool):
    """Two concurrent runs computing the same candidates are safe: the second
    DELETE simply matches no rows."""
    fake_pool.rowcount = 1
    first = await db.delete_active_calls(["room-a"], older_than=datetime.utcnow())
    fake_pool.rowcount = 0
    second = await db.delete_active_calls(["room-a"], older_than=datetime.utcnow())
    assert first == 1
    assert second == 0, "a repeat run deletes nothing rather than erroring"


def test_reconcile_endpoint_requires_authentication():
    """The endpoint must sit behind the same bearer-token dependency as the
    rest of the API -- it can delete rows that affect dial capacity."""
    import inspect
    import server

    src = inspect.getsource(server)
    idx = src.index('"/api/active-calls/reconcile"')
    decorator = src[idx - 200:idx + 200]
    assert "require_token" in decorator, "reconcile must be token-protected"


def test_reconcile_defaults_to_a_dry_run():
    """Nothing is deleted unless the caller explicitly opts in."""
    import inspect
    import server

    sig = inspect.signature(server.reconcile_active_calls)
    assert sig.parameters["apply"].default is False
    assert sig.parameters["min_age_seconds"].default == 1800
