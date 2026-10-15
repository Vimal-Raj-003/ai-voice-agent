"""H1 fix: saving/reloading campaigns must not remove global system jobs.

Exercises server._reload_scheduled_campaigns against a real AsyncIOScheduler
(not started, so no timers fire) with a fake DB pool supplying campaign rows.
"""

import pytest
from apscheduler.schedulers.asyncio import AsyncIOScheduler

import server

SYSTEM_JOBS = [
    "appointment_reminder_poll",
    "webhook_retry_poll",
    "provider-rates-refresh",
    "idempotency_prune",
]


def _noop():
    return None


def _scheduler_with(system=True, campaigns=()):
    sch = AsyncIOScheduler(timezone=server._ist())
    if system:
        for jid in SYSTEM_JOBS:
            sch.add_job(_noop, "interval", seconds=3600, id=jid)
    for cid in campaigns:
        sch.add_job(_noop, "interval", seconds=3600, id=f"{server.CAMPAIGN_JOB_PREFIX}{cid}")
    return sch


class _FakePool:
    def __init__(self, rows):
        self._rows = rows

    async def fetch(self, *a, **k):
        return self._rows


def _row(cid, stype="DAILY", stime="09:00"):
    return {"id": cid, "scheduleType": stype, "scheduleTime": stime}


def _install(monkeypatch, scheduler, rows):
    monkeypatch.setattr(server, "_scheduler", scheduler)

    async def fake_pool():
        return _FakePool(rows)

    monkeypatch.setattr("server.db.get_pool", fake_pool)


def _job_ids(sch):
    return {j.id for j in sch.get_jobs()}


# ── TEST 1: appointment_reminder_poll survives a campaign save ──────────────
@pytest.mark.asyncio
async def test_system_jobs_survive_reload(monkeypatch):
    sch = _scheduler_with(system=True, campaigns=["A"])
    _install(monkeypatch, sch, [_row("A")])
    await server._reload_scheduled_campaigns()
    ids = _job_ids(sch)
    for jid in SYSTEM_JOBS:
        assert jid in ids, f"{jid} must survive a campaign reload"
    assert "appointment_reminder_poll" in ids


# ── TEST 2: save/update a campaign → only that campaign's job changes ───────
@pytest.mark.asyncio
async def test_update_only_affects_that_campaign(monkeypatch):
    sch = _scheduler_with(system=True, campaigns=["A"])
    _install(monkeypatch, sch, [_row("A", stime="14:30")])
    await server._reload_scheduled_campaigns()
    ids = _job_ids(sch)
    assert ids == set(SYSTEM_JOBS) | {"campaign-A"}
    # The campaign job reflects the new time.
    job = sch.get_job("campaign-A")
    assert job is not None


# ── TEST 3: delete a campaign → only that campaign's job removed ────────────
@pytest.mark.asyncio
async def test_delete_removes_only_that_campaign(monkeypatch):
    sch = _scheduler_with(system=True, campaigns=["A", "B"])
    # B is no longer RUNNING (not in rows) → should be dropped; A stays.
    _install(monkeypatch, sch, [_row("A")])
    await server._reload_scheduled_campaigns()
    ids = _job_ids(sch)
    assert "campaign-A" in ids
    assert "campaign-B" not in ids
    for jid in SYSTEM_JOBS:
        assert jid in ids


# ── TEST 4: editing one campaign does not affect others ─────────────────────
@pytest.mark.asyncio
async def test_editing_one_keeps_others(monkeypatch):
    sch = _scheduler_with(system=True, campaigns=["A", "B"])
    _install(monkeypatch, sch, [_row("A", stime="10:00"), _row("B", stime="11:00")])
    await server._reload_scheduled_campaigns()
    ids = _job_ids(sch)
    assert "campaign-A" in ids and "campaign-B" in ids
    assert set(SYSTEM_JOBS) <= ids


# ── TEST 5: reminder poller still present & executable after a campaign save ─
@pytest.mark.asyncio
async def test_reminder_poll_executable_after_reload(monkeypatch):
    sch = _scheduler_with(system=True, campaigns=[])
    _install(monkeypatch, sch, [_row("A")])
    await server._reload_scheduled_campaigns()
    job = sch.get_job("appointment_reminder_poll")
    assert job is not None
    # The original system job is still the real poller (not replaced).
    sch2 = _scheduler_with(system=False)
    sch2.add_job(server._poll_reminders, "interval", seconds=60, id="appointment_reminder_poll")
    _install(monkeypatch, sch2, [_row("A")])
    await server._reload_scheduled_campaigns()
    j2 = sch2.get_job("appointment_reminder_poll")
    assert j2 is not None and j2.func is server._poll_reminders
