"""Dynamic LLM-tool registration for user-defined HTTP tools.

Each Tool row in the DB becomes an llm.function_tool the agent registers
on session start. When the LLM invokes one, the agent makes the configured
HTTP request, returns the response (truncated) to the LLM, and records a
ToolInvocation row for audit.

Failure modes return descriptive text to the LLM rather than raising — the
LLM can apologize and continue the call instead of crashing the session.
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any
from urllib.parse import quote

import httpx
from livekit.agents import llm

try:
    from jsonschema import ValidationError, validate as _jsonschema_validate
    _HAS_JSONSCHEMA = True
except ImportError:  # pragma: no cover — jsonschema is in requirements.txt
    _HAS_JSONSCHEMA = False

    class ValidationError(Exception):  # type: ignore[no-redef]
        message: str = ""

    def _jsonschema_validate(instance, schema):  # type: ignore[no-redef]
        return None

from observability import get_logger

logger = get_logger("custom_tools")

MAX_RESPONSE_CHARS = 4000


def _substitute_url(template: str, kwargs: dict) -> str:
    """Replace {arg} placeholders with URL-quoted argument values."""
    out = template
    for k, v in kwargs.items():
        token = "{" + k + "}"
        if token in out:
            out = out.replace(token, quote(str(v), safe=""))
    return out


def build_custom_tool(tool_def: dict, ctx: Any) -> Any:
    """Construct an llm.function_tool from a Tool DB row.

    Args go through (a) jsonschema validation, (b) URL template substitution,
    (c) the configured HTTP request. Response body (truncated) flows back to
    the LLM as the function return value. Errors become descriptive text.
    """
    name: str = tool_def["name"]
    description: str = tool_def.get("description") or ""
    params_schema: dict = tool_def.get("parametersJson") or {
        "type": "object",
        "properties": {},
    }
    method: str = (tool_def.get("httpMethod") or "POST").upper()
    url_template: str = tool_def.get("httpUrl") or ""
    headers_raw = tool_def.get("httpHeaders") or {}
    if not isinstance(headers_raw, dict):
        headers_raw = {}
    headers: dict = {str(k): str(v) for k, v in headers_raw.items()}
    timeout: int = int(tool_def.get("timeoutSeconds") or 15)
    tool_id: str = tool_def["id"]

    @llm.function_tool(
        name=name,
        description=description,
        raw_schema=params_schema,
    )
    async def _impl(**kwargs) -> str:
        invoke_start = time.time()
        invoke_id = str(uuid.uuid4())
        try:
            if _HAS_JSONSCHEMA:
                try:
                    _jsonschema_validate(instance=kwargs, schema=params_schema)
                except ValidationError as exc:
                    return f"Invalid arguments: {exc.message}"

            url = _substitute_url(url_template, kwargs)

            async with httpx.AsyncClient(timeout=timeout) as client:
                if method == "GET":
                    resp = await client.get(url, headers=headers)
                elif method == "DELETE":
                    resp = await client.delete(url, headers=headers)
                else:
                    resp = await client.request(
                        method, url, headers=headers, json=kwargs
                    )
            body = (resp.text or "")[:MAX_RESPONSE_CHARS]
            await _record_invocation(
                tool_id, ctx, invoke_id, name, kwargs, resp.status_code, body, None,
                invoke_start,
            )
            if resp.status_code >= 400:
                return f"Tool returned {resp.status_code}: {body[:300]}"
            return body or f"Tool returned {resp.status_code} (empty body)"
        except httpx.TimeoutException:
            await _record_invocation(
                tool_id, ctx, invoke_id, name, kwargs, None, "", "timeout",
                invoke_start,
            )
            return f"Tool '{name}' timed out after {timeout}s."
        except Exception as exc:
            await _record_invocation(
                tool_id, ctx, invoke_id, name, kwargs, None, "", str(exc)[:300],
                invoke_start,
            )
            return f"Tool '{name}' failed: {exc}"

    return _impl


async def _record_invocation(
    tool_id: str,
    ctx: Any,
    invoke_id: str,
    name: str,
    args: dict,
    status: int | None,
    body: str,
    error: str | None,
    started_at: float,
) -> None:
    import db

    call_id = getattr(ctx, "_call_id", None) or getattr(
        getattr(ctx, "agent_tools", None), "_call_id", None
    )
    if not call_id:
        # No FK target — schema requires callId, so skip silently.
        logger.info("tool_invocation_skipped_no_call", tool=name)
        return
    try:
        elapsed_ms = int((time.time() - started_at) * 1000)
        pool = await db.get_pool()
        await pool.execute(
            '''INSERT INTO tool_invocations
                 (id, "callId", "toolId", "toolName", arguments, result,
                  error, "durationMs", "createdAt")
               VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, now())''',
            invoke_id,
            call_id,
            tool_id,
            name,
            json.dumps(args),
            json.dumps({"status": status, "body": body[:1000]}),
            error,
            elapsed_ms,
        )
    except Exception as exc:
        logger.warning("tool_invocation_record_failed", error=str(exc))
