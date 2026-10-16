"""Live Logs stream: timestamp format and cursor correctness.

Two defects this pins, both found by tracing a real event from the producing
process to the browser:

 1. The stream emitted `ts.isoformat()` on a NAIVE UTC column, i.e.
    "2026-10-16T06:24:35.123456" with no zone. JavaScript parses that form as
    LOCAL time, so on an IST (+05:30) host every event arrived 5.5 hours in the
    past and the Live Logs session-boundary filter discarded it — the page read
    CONNECTED with EVENTS 0 while delivery was in fact working.

 2. error_logs.timestamp has millisecond precision, so sibling events routinely
    share one value. The cursor skipped rows with `ts <= last_seen`, which
    delivered only the FIRST row of each tie and silently dropped the rest —
    exactly the burst traffic (STT -> LLM -> TTS) a call timeline consists of.

Both are exercised through the real endpoint with a stubbed db.get_logs.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime

import pytest


def _rows():
    """Four rows, in two millisecond-identical pairs — the real shape observed
    in error_logs for a single diagnostics probe."""
    t1 = datetime(2026, 10, 16, 6, 28, 22, 52000)
    t2 = datetime(2026, 10, 16, 6, 28, 22, 489000)
    return [
        {"id": "r4", "source": "PROVIDER_DIAGNOSTIC", "level": "INFO",
         "message": "diagnostic_completed", "detail": "", "timestamp": t2},
        {"id": "r3", "source": "PROVIDER_DIAGNOSTIC", "level": "INFO",
         "message": "diagnostic_response_received", "detail": "", "timestamp": t2},
        {"id": "r2", "source": "PROVIDER_DIAGNOSTIC", "level": "INFO",
         "message": "diagnostic_request_sent", "detail": "", "timestamp": t1},
        {"id": "r1", "source": "PROVIDER_DIAGNOSTIC", "level": "INFO",
         "message": "diagnostic_started", "detail": "", "timestamp": t1},
    ]


async def _collect(monkeypatch, since: str | None, max_events: int = 6,
                   timeout: float = 4.0) -> list[dict]:
    """Drive the real logs_stream generator and collect its `log` payloads."""
    import server

    served = {"n": 0}

    async def fake_get_logs(level=None, source=None, limit=20):
        # First poll returns the batch; later polls return nothing, as a quiet
        # system would.
        served["n"] += 1
        return list(_rows()) if served["n"] == 1 else []

    monkeypatch.setattr(server.db, "get_logs", fake_get_logs)

    class _Req:
        async def is_disconnected(self):
            return served["n"] > 2      # end the generator after a couple of polls

    resp = await server.logs_stream(_Req(), since=since)
    # logs_stream returns an EventSourceResponse; its body_iterator yields the
    # {"event": ..., "data": ...} dicts the generator produced.
    iterator = getattr(resp, "body_iterator", resp)
    out: list[dict] = []

    async def pump():
        async for chunk in iterator:
            ev = chunk.get("event") if isinstance(chunk, dict) else None
            if ev == "log":
                out.append(json.loads(chunk["data"]))
                if len(out) >= max_events:
                    return
    try:
        await asyncio.wait_for(pump(), timeout=timeout)
    except (asyncio.TimeoutError, StopAsyncIteration):
        pass
    return out


@pytest.mark.asyncio
async def test_every_row_is_delivered_even_with_identical_timestamps(monkeypatch):
    """The tie-breaking cursor must deliver all four rows, not one per pair.

    Uses an explicit cursor BEFORE the batch: with `since=None` the stream
    deliberately seeds from the newest existing row so a fresh session is not
    flooded with history, which would mask what is under test here.
    """
    got = await _collect(monkeypatch, since="2026-10-16T06:00:00Z")
    messages = [g["message"] for g in got]
    assert len(got) == 4, f"rows dropped on identical timestamps: {messages}"
    assert set(messages) == {
        "diagnostic_started", "diagnostic_request_sent",
        "diagnostic_response_received", "diagnostic_completed",
    }


@pytest.mark.asyncio
async def test_timestamps_carry_an_explicit_utc_marker(monkeypatch):
    """Without a zone, a browser parses the value as local time."""
    got = await _collect(monkeypatch, since="2026-10-16T06:00:00Z")
    assert got, "no events delivered"
    for g in got:
        ts = g["timestamp"]
        assert ts.endswith("Z") or "+" in ts[10:], f"ambiguous timestamp: {ts}"


@pytest.mark.asyncio
async def test_no_row_is_delivered_twice(monkeypatch):
    """The cursor must still advance — ties are delivered once, not repeatedly."""
    got = await _collect(monkeypatch, since="2026-10-16T06:00:00Z", max_events=12)
    ids = [g["id"] for g in got]
    assert len(ids) == len(set(ids)), f"duplicate delivery: {ids}"


@pytest.mark.asyncio
async def test_since_cursor_still_suppresses_older_rows(monkeypatch):
    """The session boundary must keep working: a cursor AFTER the batch yields
    nothing, so a fresh page is not flooded with history."""
    got = await _collect(monkeypatch, since="2026-10-16T07:00:00Z", timeout=3.0)
    assert got == [], f"history replayed past the cursor: {got}"


@pytest.mark.asyncio
async def test_since_cursor_without_a_zone_is_treated_as_utc(monkeypatch):
    """A client that sends a naive cursor must not be compared against
    zone-marked row timestamps as raw strings."""
    got = await _collect(monkeypatch, since="2026-10-16T07:00:00", timeout=3.0)
    assert got == [], f"naive cursor mis-compared, replayed: {got}"


@pytest.mark.asyncio
async def test_without_a_cursor_history_is_not_replayed(monkeypatch):
    """`since=None` seeds from the newest existing row, so a fresh Live Logs
    session starts quiet instead of replaying the backlog."""
    got = await _collect(monkeypatch, since=None, timeout=3.0)
    # Only the newest timestamp group may appear, never the older one.
    assert all(g["message"] in {"diagnostic_response_received", "diagnostic_completed"}
               for g in got), [g["message"] for g in got]
