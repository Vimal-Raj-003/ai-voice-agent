"""Durability of the orphaned-Cal.com-booking record.

THE BUG THESE EXIST FOR: db.log_error() ends with `except Exception: pass`, so
it never raises. record_calcom_orphan() used to wrap it in try/except and set
`db_ok = True` inside the try body — which meant a FAILED insert was recorded
as a success and the local fallback never ran, in exactly the Neon-outage case
the fallback was written for.

The earlier tests missed it because they monkeypatched log_error with a stub
that raises. These exercise the REAL log_error with a failing pool instead, so
the swallowed-exception path is covered honestly.
"""
from __future__ import annotations

import json

import pytest

import db


class _DeadPool:
    """A pool whose every statement fails, like an unreachable Neon."""

    async def execute(self, *a, **k):
        raise ConnectionError("neon unreachable")

    async def fetchrow(self, *a, **k):
        raise ConnectionError("neon unreachable")


class _OkPool:
    def __init__(self):
        self.statements: list[str] = []

    async def execute(self, sql, *a, **k):
        self.statements.append(sql)
        return "INSERT 0 1"


def _orphan_args():
    return ("bk_uid_1", "+919876500000", "2026-06-01", "10:00", "demo", "Ravi", "neon down")


# ── 1. the audit insert succeeds ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_log_error_returns_true_when_the_insert_commits(monkeypatch):
    pool = _OkPool()

    async def get_pool():
        return pool

    monkeypatch.setattr(db, "get_pool", get_pool)
    assert await db.log_error("src", "msg", "detail") is True
    assert any("INSERT INTO error_logs" in s for s in pool.statements)


@pytest.mark.asyncio
async def test_orphan_uses_the_database_when_it_works(monkeypatch, tmp_path):
    pool = _OkPool()

    async def get_pool():
        return pool

    monkeypatch.setattr(db, "get_pool", get_pool)
    path = tmp_path / "orphans.jsonl"
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    assert await db.record_calcom_orphan(*_orphan_args()) is True
    assert any("error_logs" in s for s in pool.statements)
    assert not path.exists(), "the file is a fallback, not a second copy"


# ── 2. the insert fails and log_error SWALLOWS the exception ───────────────
@pytest.mark.asyncio
async def test_log_error_returns_false_without_raising_when_the_insert_fails(monkeypatch):
    """The regression itself: the exception is swallowed, so the return value
    is the only way to know the row did not land."""
    async def get_pool():
        return _DeadPool()

    monkeypatch.setattr(db, "get_pool", get_pool)
    result = await db.log_error("src", "msg", "detail")   # must NOT raise
    assert result is False, "a failed insert must report False, not None/True"


# ── 3. the local durable fallback captures the record ──────────────────────
@pytest.mark.asyncio
async def test_fallback_fires_against_the_real_log_error(monkeypatch, tmp_path):
    """End-to-end through the REAL log_error with a dead pool — the path that
    was previously impossible to reach."""
    async def get_pool():
        return _DeadPool()

    monkeypatch.setattr(db, "get_pool", get_pool)
    path = tmp_path / "orphans.jsonl"
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    assert await db.record_calcom_orphan(*_orphan_args()) is True
    assert path.exists(), "Neon was unreachable, so the disk record is mandatory"
    row = json.loads(path.read_text(encoding="utf-8").strip())
    assert row["calcom_uid"] == "bk_uid_1"          # confirmed UID retained
    assert row["phone_number"] == "+919876500000"
    assert row["date"] == "2026-06-01" and row["time"] == "10:00"
    assert "recorded_at" in row


@pytest.mark.asyncio
async def test_no_credentials_or_secrets_in_the_record(monkeypatch, tmp_path):
    """The file is reconciliation data, not a credential sink."""
    async def get_pool():
        return _DeadPool()

    monkeypatch.setattr(db, "get_pool", get_pool)
    monkeypatch.setenv("CALCOM_API_KEY", "cal_live_supersecret")
    path = tmp_path / "orphans.jsonl"
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    await db.record_calcom_orphan(*_orphan_args())
    text = path.read_text(encoding="utf-8")
    assert "cal_live_supersecret" not in text
    assert "api_key" not in text.lower()
    assert "password" not in text.lower() and "token" not in text.lower()
    # Only the fields reconciliation needs are present.
    assert set(json.loads(text.strip())) == {
        "calcom_uid", "phone_number", "date", "time", "service", "name",
        "reason", "recorded_at"}


# ── 4. BOTH destinations fail ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_both_sinks_failing_reports_unrecovered(monkeypatch, tmp_path):
    async def get_pool():
        return _DeadPool()

    monkeypatch.setattr(db, "get_pool", get_pool)
    # Make the file sink genuinely impossible: use an existing FILE as the
    # parent directory, so makedirs cannot create the path. (A merely missing
    # directory is not a failure — makedirs would create it.)
    blocker = tmp_path / "blocker"
    blocker.write_text("not a directory", encoding="utf-8")
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(blocker / "x.jsonl"))

    ok = await db.record_calcom_orphan(*_orphan_args())
    assert ok is False, "the caller must be able to raise an unresolved recovery risk"


@pytest.mark.asyncio
async def test_record_never_raises_even_when_everything_fails(monkeypatch, tmp_path):
    """The booking is real and already confirmed to the caller; losing the
    audit trail must not become an exception mid-call."""
    async def get_pool():
        raise ConnectionError("pool creation itself failed")

    monkeypatch.setattr(db, "get_pool", get_pool)
    blocker = tmp_path / "blocker2"
    blocker.write_text("not a directory", encoding="utf-8")
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(blocker / "x.jsonl"))
    # Should return a bool rather than propagate.
    assert await db.record_calcom_orphan(*_orphan_args()) in (True, False)


# ── multi-writer safety of the fallback file ───────────────────────────────
@pytest.mark.asyncio
async def test_concurrent_writers_do_not_lose_or_interleave_records(monkeypatch, tmp_path):
    """The worker runs multiple processes. Appends are O_APPEND line writes, so
    concurrent records must each land as one intact JSON line."""
    import asyncio

    async def get_pool():
        return _DeadPool()

    monkeypatch.setattr(db, "get_pool", get_pool)
    path = tmp_path / "orphans.jsonl"
    monkeypatch.setenv("CALCOM_ORPHAN_LOG", str(path))

    await asyncio.gather(*[
        db.record_calcom_orphan(f"bk_{i}", "+919876500000", "2026-06-01",
                                f"{9 + i}:00", "demo", "Ravi", "neon down")
        for i in range(12)
    ])
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 12, "no record may be lost"
    uids = sorted(json.loads(l)["calcom_uid"] for l in lines)
    assert uids == sorted(f"bk_{i}" for i in range(12))
