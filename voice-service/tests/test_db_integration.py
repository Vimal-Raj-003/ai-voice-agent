"""Integration tests that hit a real Postgres at $TEST_DATABASE_URL.

Run with:  pytest -m integration

These tests catch schema-drift bugs the mocked unit tests miss
(snake_case vs camelCase column names, enum casts, NOT NULL columns).

Each test isolates itself by:
  - using a session-scoped test Organization (slug="integration-test-<uuid>")
  - generating unique phone numbers per test
  - cleaning up after itself in a `finally` block

The Organization deletion at session-end cascades to calls / campaigns /
campaign_targets / etc.; tables not tied to org (contacts, contact_memory,
appointments, settings, error_logs, active_calls) are cleaned by phone-prefix
or key-prefix DELETEs.
"""

from __future__ import annotations

import os
import uuid

import asyncpg
import pytest
import pytest_asyncio

import db

# All integration tests share a single session-scoped event loop so they can
# share the asyncpg pool fixture below — function-scoped loops would each
# rebind the pool and break with "got Future attached to a different loop".
pytestmark = [
    pytest.mark.integration,
    pytest.mark.asyncio(loop_scope="session"),
]

TEST_DSN = os.environ.get("TEST_DATABASE_URL")

# Skip the entire module if the test DSN is unset — keeps `pytest -m integration`
# safe to run in any environment.
if not TEST_DSN:
    pytest.skip(
        "TEST_DATABASE_URL is not set — skipping integration tests. "
        "Set it to a Neon test branch DSN to enable.",
        allow_module_level=True,
    )


PHONE_PREFIX = "+99990000"  # all phones we touch start with this; cleanup deletes by prefix
SETTING_PREFIX = "TEST_"     # all settings we touch start with this


def _phone() -> str:
    """Generate a unique test phone number."""
    return f"{PHONE_PREFIX}{uuid.uuid4().hex[:6]}"


def _setting_key() -> str:
    return f"{SETTING_PREFIX}{uuid.uuid4().hex[:8]}"


@pytest_asyncio.fixture(loop_scope="session", scope="session", autouse=True)
async def real_pool():
    """Open a session-scoped real pool against $TEST_DATABASE_URL.

    Overrides db._pool so all functions under test transparently use it.
    Closes + nulls the pool at session end.
    """
    os.environ["DATABASE_URL"] = TEST_DSN
    pool = await asyncpg.create_pool(
        dsn=TEST_DSN,
        min_size=1,
        max_size=4,
        command_timeout=30,
        statement_cache_size=0,  # Neon pgbouncer
    )
    db._pool = pool

    # Make sure the test session starts with a clean slate for our prefixes.
    await pool.execute(f"DELETE FROM contact_memory WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM appointments WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM contacts WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM active_calls WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM settings WHERE key LIKE '{SETTING_PREFIX}%'")
    await pool.execute("DELETE FROM error_logs WHERE source LIKE 'test_%'")

    yield pool

    # Session teardown: re-clean prefixes. Org cascade handles calls/campaigns.
    await pool.execute(f"DELETE FROM contact_memory WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM appointments WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM contacts WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM active_calls WHERE phone_number LIKE '{PHONE_PREFIX}%'")
    await pool.execute(f"DELETE FROM settings WHERE key LIKE '{SETTING_PREFIX}%'")
    await pool.execute("DELETE FROM error_logs WHERE source LIKE 'test_%'")
    await pool.close()
    db._pool = None


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def test_org(real_pool):
    """Create a dedicated test Organization. Cascades to all org-scoped rows on teardown."""
    slug = f"integration-test-{uuid.uuid4().hex[:8]}"
    org_id = await real_pool.fetchval(
        """INSERT INTO organizations (id, name, slug, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, now(), now()) RETURNING id""",
        str(uuid.uuid4()), "Integration Test Org", slug,
    )
    os.environ["DEFAULT_ORG_ID"] = org_id
    yield org_id
    # Cleanup: org cascade removes calls + campaigns + targets + transcripts.
    await real_pool.execute("DELETE FROM organizations WHERE id = $1", org_id)


# ── Settings ──────────────────────────────────────────────────────────────────

async def test_set_and_get_setting():
    key = _setting_key()
    await db.set_setting(key, "hello-world")
    got = await db.get_setting(key)
    assert got == "hello-world"


async def test_get_setting_falls_back_to_env(monkeypatch):
    key = _setting_key()  # not in DB
    monkeypatch.setenv(key, "from-env")
    got = await db.get_setting(key)
    assert got == "from-env"


async def test_get_setting_default_when_missing(monkeypatch):
    key = _setting_key()  # neither DB nor env
    monkeypatch.delenv(key, raising=False)
    got = await db.get_setting(key, default="fallback")
    assert got == "fallback"


# ── Error logs ────────────────────────────────────────────────────────────────

async def test_log_error_and_fetch():
    await db.log_error("test_logger", "boom", detail="stack trace…", level="ERROR")
    rows = await db.get_logs(level="ERROR", source="test_logger", limit=10)
    assert any(r["message"] == "boom" for r in rows)


async def test_log_error_swallows_exceptions(monkeypatch):
    # Even with a borked level value, log_error must not raise.
    await db.log_error("test_logger", "x", level="NOT_A_REAL_LEVEL")
    # No assertion needed beyond "did not raise".


# ── Appointments ──────────────────────────────────────────────────────────────

async def test_insert_and_query_appointment():
    phone = _phone()
    bid = await db.insert_appointment("Ravi", phone, "2026-12-31", "10:00", "consultation")
    assert isinstance(bid, str) and len(bid) == 8
    got = await db.get_appointments_by_phone(phone)
    assert len(got) == 1
    assert got[0]["booking_id"] == bid
    assert got[0]["service"] == "consultation"
    # status enum survives the round-trip
    assert str(got[0]["status"]) == "BOOKED"


async def test_check_slot_returns_false_when_booked():
    phone = _phone()
    await db.insert_appointment("X", phone, "2026-12-30", "11:00", "demo")
    assert await db.check_slot("2026-12-30", "11:00") is False
    assert await db.check_slot("2026-12-30", "11:30") is True


async def test_cancel_appointment_idempotent():
    phone = _phone()
    await db.insert_appointment("Z", phone, "2026-12-29", "12:00", "demo")
    rows = await db.get_appointments_by_phone(phone)
    assert await db.cancel_appointment(rows[0]["id"]) is True
    # second cancel on same row returns False (already CANCELLED)
    assert await db.cancel_appointment(rows[0]["id"]) is False


# ── Calls ─────────────────────────────────────────────────────────────────────

async def test_log_call_writes_real_columns(test_org):
    phone = _phone()
    call_id = await db.log_call(
        phone_number=phone,
        lead_name="Test User",
        outcome="booked",
        reason="confirmed slot",
        duration_seconds=120,
        recording_url="https://example.com/rec.mp3",
        notes="went well",
        sentiment="positive",
        cost_usd=0.0234,
        interrupt_count=2,
        was_booked=True,
        transcript="full transcript text",
        from_number=PHONE_PREFIX + "caller",
        direction="OUTBOUND",
    )
    assert isinstance(call_id, str)
    pool = await db.get_pool()
    row = await pool.fetchrow('SELECT * FROM calls WHERE id = $1', call_id)
    assert row is not None
    assert row["toNumber"] == phone
    assert row["fromNumber"] == PHONE_PREFIX + "caller"
    assert str(row["direction"]) == "OUTBOUND"
    assert str(row["status"]) == "COMPLETED"
    assert str(row["outcome"]) == "BOOKED"
    assert row["durationSeconds"] == 120
    assert row["recordingUrl"] == "https://example.com/rec.mp3"
    assert row["sentiment"] == "positive"
    assert row["interrupt_count"] == 2
    assert row["was_booked"] is True
    assert row["organizationId"] == test_org


async def test_log_call_upserts_contact(test_org):
    phone = _phone()
    await db.log_call(phone, "Alice", "booked", "ok", 60, was_booked=True)
    await db.log_call(phone, "Alice", "booked", "ok", 75, was_booked=True)
    pool = await db.get_pool()
    row = await pool.fetchrow("SELECT * FROM contacts WHERE phone_number = $1", phone)
    assert row["total_calls"] == 2
    assert row["is_booked"] is True
    assert str(row["last_outcome"]) == "BOOKED"


async def test_get_calls_by_phone(test_org):
    phone = _phone()
    await db.log_call(phone, None, "booked", "", 30)
    rows = await db.get_calls_by_phone(phone)
    assert len(rows) >= 1
    assert rows[0]["toNumber"] == phone


async def test_update_call_notes(test_org):
    phone = _phone()
    call_id = await db.log_call(phone, None, "completed", "", 10)
    assert await db.update_call_notes(call_id, "follow-up next week") is True
    pool = await db.get_pool()
    row = await pool.fetchrow('SELECT notes FROM calls WHERE id = $1', call_id)
    assert row["notes"] == "follow-up next week"


# ── Transcript messages ───────────────────────────────────────────────────────

async def test_insert_transcript_and_fetch(test_org):
    phone = _phone()
    call_id = await db.log_call(phone, None, "completed", "", 5)
    await db.insert_transcript_message(call_id, "USER", "hello")
    await db.insert_transcript_message(call_id, "ASSISTANT", "hi there")
    msgs = await db.get_transcript(call_id)
    assert len(msgs) == 2
    assert str(msgs[0]["role"]) == "USER"
    assert msgs[0]["content"] == "hello"
    assert str(msgs[1]["role"]) == "ASSISTANT"


# ── Contact memory ────────────────────────────────────────────────────────────

async def test_add_and_get_contact_memory(test_org):
    phone = _phone()
    # Contact must exist before contact_memory FK is satisfied.
    await db.log_call(phone, None, "completed", "", 5)
    await db.add_contact_memory(phone, "prefers Hindi")
    await db.add_contact_memory(phone, "morning slots only")
    rows = await db.get_contact_memory(phone)
    assert len(rows) == 2
    insights = [r["insight"] for r in rows]
    assert "prefers Hindi" in insights
    assert "morning slots only" in insights


async def test_compress_contact_memory_replaces_all(test_org):
    phone = _phone()
    await db.log_call(phone, None, "completed", "", 5)
    for i in range(5):
        await db.add_contact_memory(phone, f"insight {i}")
    await db.compress_contact_memory(phone, "summary: all five insights")
    rows = await db.get_contact_memory(phone)
    assert len(rows) == 1
    assert rows[0]["insight"] == "summary: all five insights"


# ── Active calls ──────────────────────────────────────────────────────────────

async def test_active_call_lifecycle():
    room = f"call-test-{uuid.uuid4().hex[:6]}"
    phone = _phone()
    await db.upsert_active_call(room, phone, caller_name="Test", status="ringing")
    rows = await db.get_active_calls()
    assert any(r["room_id"] == room for r in rows)
    await db.upsert_active_call(room, phone, caller_name="Test", status="in_progress")
    rows = await db.get_active_calls()
    matching = [r for r in rows if r["room_id"] == room]
    assert matching and matching[0]["status"] == "in_progress"
    await db.remove_active_call(room)
    rows = await db.get_active_calls()
    assert not any(r["room_id"] == room for r in rows)


# ── Stats ─────────────────────────────────────────────────────────────────────

async def test_get_stats_smoke(test_org):
    """get_stats must run without column-name errors and return the documented shape."""
    phone = _phone()
    await db.log_call(phone, None, "booked", "ok", 90, was_booked=True)
    s = await db.get_stats()
    assert "total_calls" in s and "booked" in s and "outcomes" in s and "timeline" in s
    assert s["total_calls"] >= 1
    assert isinstance(s["timeline"], list) and len(s["timeline"]) == 14


# ── Get-all-settings + sensitive masking ──────────────────────────────────────

async def test_get_all_settings_masks_sensitive(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "real-key")
    out = await db.get_all_settings()
    # OPENAI_API_KEY is in SENSITIVE_KEYS — value masked, configured=True
    assert out["OPENAI_API_KEY"]["value"] == ""
    assert out["OPENAI_API_KEY"]["configured"] is True
