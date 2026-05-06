"""Sentry + structlog init. Imported once at app start."""

import logging
import os
import sys

import sentry_sdk
import structlog
from sentry_sdk.integrations.asyncio import AsyncioIntegration


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
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
    )

    for noisy in ("httpx", "httpcore", "hpack", "google.auth.transport", "asyncio"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> structlog.BoundLogger:
    return structlog.get_logger(name)
