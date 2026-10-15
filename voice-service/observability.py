"""Sentry + structlog init. Imported once at app start.

Also bridges structlog runtime events into the existing `error_logs` table (and
from there to the dashboard Live Logs SSE stream) via a bounded, non-blocking
in-memory buffer drained by a background batch writer. The bridge never blocks
the caller and never raises, so it cannot add latency to the realtime audio
event loop or break a call if the database is slow or unreachable.
"""

import asyncio
import json
import logging
import os
import sys
import threading
import uuid
import weakref
from collections import deque
from datetime import UTC, datetime

import sentry_sdk
import structlog
from sentry_sdk.integrations.asyncio import AsyncioIntegration

# ── Live Logs bridge (structlog -> error_logs -> SSE) ─────────────────────────
# Bounded in-memory buffer. deque(maxlen) drops the OLDEST entry on overflow
# without blocking the producer — so a slow/unreachable DB can never stall the
# realtime audio loop. list.append/popleft are atomic under the GIL, so logging
# from any thread (e.g. asyncio.to_thread workers) is safe without a lock.
_LOG_BUFFER_MAX = 2000
_log_buffer: "deque[dict]" = deque(maxlen=_LOG_BUFFER_MAX)
# One drain task PER event loop. The LiveKit worker runs each job on its own
# loop (often its own thread) in one process; a single global drain task would
# only ever flush the one loop it was created on, so events from the other jobs'
# loops would never persist. Each loop drains the shared buffer via its own
# per-loop DB pool (see db.get_pool). WeakKeyDictionary drops a loop's task once
# the loop is gone. The lock guards only the tiny get-or-create bookkeeping.
_drain_tasks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Task]" = (
    weakref.WeakKeyDictionary()
)
_drain_lock = threading.Lock()
_BATCH_SIZE = 200
_DRAIN_INTERVAL = 1.0

# structlog level name -> error_logs "ErrorLevel" enum (INFO/WARNING/ERROR/
# CRITICAL). The enum has no DEBUG, so DEBUG maps up to INFO.
_LEVEL_MAP = {
    "debug": "INFO", "info": "INFO", "warning": "WARNING", "warn": "WARNING",
    "error": "ERROR", "critical": "CRITICAL", "exception": "ERROR", "fatal": "CRITICAL",
}
# Logger name -> UI source label. An explicit source=... on a log call wins.
_SOURCE_MAP = {"agent": "WORKER", "server": "API"}
# Any field whose KEY contains one of these substrings is masked before it is
# persisted, so secrets/keys/JWTs/auth headers never reach the log table.
_SECRET_HINTS = ("key", "token", "secret", "password", "passwd", "authorization",
                 "auth", "jwt", "dsn", "credential")
# structlog-internal fields that are represented elsewhere in the row.
_META_SKIP = {"event", "level", "timestamp", "logger", "source", "stack", "exception"}


def _mask(key: str, value: object) -> object:
    if any(h in key.lower() for h in _SECRET_HINTS):
        return "***redacted***"
    return value


def _bridge_processor(logger, method_name, event_dict):
    """structlog processor: enqueue a normalized Live Logs row, then return the
    event_dict unchanged so existing console (stderr) output is untouched."""
    try:
        source = str(
            event_dict.get("source")
            or _SOURCE_MAP.get(event_dict.get("logger", ""),
                               event_dict.get("logger") or "SYSTEM")
        ).upper()
        level = _LEVEL_MAP.get(str(method_name).lower(), "INFO")
        message = str(event_dict.get("event", ""))[:500]
        meta = {k: _mask(k, v) for k, v in event_dict.items() if k not in _META_SKIP}
        detail = json.dumps(meta, default=str)[:2000] if meta else ""
        _log_buffer.append({
            "id": str(uuid.uuid4()),
            "source": source,
            "level": level,
            "message": message,
            "detail": detail,
            "timestamp": datetime.now(UTC).replace(tzinfo=None),
        })
    except Exception:
        pass  # logging must never raise
    return event_dict


async def _drain_logs() -> None:
    """Background task: batch-insert buffered rows into error_logs once a second."""
    import db  # lazy import avoids an import cycle (db does not import this module)
    while True:
        try:
            await asyncio.sleep(_DRAIN_INTERVAL)
            if not _log_buffer:
                continue
            batch: list[dict] = []
            while _log_buffer and len(batch) < _BATCH_SIZE:
                try:
                    batch.append(_log_buffer.popleft())
                except IndexError:
                    break
            if batch:
                await db.log_events_batch(batch)
        except asyncio.CancelledError:
            break
        except Exception:
            # Never let a transient DB error kill the drain loop.
            await asyncio.sleep(_DRAIN_INTERVAL)


def start_log_drain() -> None:
    """Start a drain task on the CURRENT event loop (idempotent per loop). Safe
    to call from the FastAPI startup hook and from every LiveKit worker job
    entrypoint — each loop gets its own drain so concurrent jobs all flush."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    with _drain_lock:
        existing = _drain_tasks.get(loop)
        if existing is None or existing.done():
            _drain_tasks[loop] = loop.create_task(_drain_logs())


def init_observability() -> None:
    dsn = os.getenv("SENTRY_DSN", "")
    if dsn:
        sentry_sdk.init(
            dsn=dsn,
            traces_sample_rate=0.1,
            integrations=[AsyncioIntegration()],
            environment=os.getenv("ENVIRONMENT", "production"),
            release=os.getenv("RELEASE_SHA", "unknown"),
            send_default_pii=False,
        )

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.stdlib.add_log_level,
            timestamper,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            _bridge_processor,  # mirror every event into the Live Logs buffer
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
    )

    for noisy in ("httpx", "httpcore", "hpack", "google.auth.transport", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.BoundLogger:
    # Bind the module name so the bridge can derive a stable source label. (The
    # previous positional-name form was discarded by PrintLoggerFactory, so the
    # name never reached the event dict.)
    return structlog.get_logger().bind(logger=name)
