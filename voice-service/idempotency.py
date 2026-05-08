# voice-service/idempotency.py
"""Stripe-style Idempotency-Key handling for dispatch endpoints."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import HTTPException, Request

import db


async def check(request: Request, scope: str, org_id: str) -> tuple[str | None, dict | None]:
    """Returns (key, cached_response) tuple.

    - (None, None): no header present, caller proceeds without caching.
    - (key, cached): cached response present, caller returns it as-is.
    - (key, None):    miss; caller proceeds and must call `record(...)` after.
    Raises 422 on key reuse with a different request body.
    """
    key = request.headers.get("Idempotency-Key")
    if not key:
        return None, None
    if len(key) > 128:
        raise HTTPException(400, "Idempotency-Key too long (max 128)")
    body = await request.body()
    body_hash = hashlib.sha256(body).hexdigest()
    existing = await db.get_idempotency(org_id, scope, key)
    if existing:
        if existing["requestHash"] != body_hash:
            raise HTTPException(422, {"error": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"})
        return key, {
            "status": existing["responseStatus"],
            "body": existing["responseBody"],
        }
    request.state.idempotency_request_hash = body_hash
    return key, None


async def record(
    request: Request, scope: str, org_id: str, key: str,
    response_status: int, response_body: Any,
) -> None:
    body_hash = getattr(request.state, "idempotency_request_hash", "")
    if not body_hash:
        return
    if isinstance(response_body, str):
        response_body = json.loads(response_body)
    await db.record_idempotency(org_id, scope, key, body_hash, response_status, response_body)
