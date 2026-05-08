"""Dynamic LLM-tool registration for user-defined HTTP tools.

Each Tool row in the DB becomes an llm.function_tool the agent registers
on session start. When the LLM invokes one, the agent makes the configured
HTTP request, returns the response (truncated) to the LLM, and records a
ToolInvocation row for audit.

Failure modes return descriptive text to the LLM rather than raising — the
LLM can apologize and continue the call instead of crashing the session.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
import time
import uuid
from typing import Any
from urllib.parse import quote, urlparse

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

# Placeholder regex used to identify {arg} substitutions in a URL template.
_PLACEHOLDER_RE = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


# ─── SSRF guard ───────────────────────────────────────────────────────────────
# We resolve the destination DNS before issuing the request and reject anything
# that lands on a private / loopback / link-local / reserved address. The check
# runs at request time (not just create time) so DNS-rebind attacks where a
# domain initially resolves to a public IP and later flips to 169.254.169.254
# are caught on the fresh resolution. Pinning the connection to the resolved IP
# would close the remaining race; httpx doesn't expose a clean transport hook
# for that without a custom resolver, so for now we accept the very short
# rebind window in exchange for simpler code.

class SSRFBlocked(Exception):
    """Raised when a tool URL resolves to a disallowed network."""


def _is_blocked_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # not a real IP — refuse rather than guess
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _validate_url(url: str) -> None:
    """Parse + DNS-resolve the URL and raise SSRFBlocked on disallowed hosts."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SSRFBlocked(f"scheme not allowed: {parsed.scheme!r}")
    host = parsed.hostname
    if not host:
        raise SSRFBlocked("missing host in URL")
    # If host is already an IP literal, validate it directly.
    try:
        ipaddress.ip_address(host)
        if _is_blocked_ip(host):
            raise SSRFBlocked(f"host resolves to blocked network: {host}")
        return
    except ValueError:
        pass
    # Resolve every A/AAAA record and reject if ANY answer is disallowed.
    try:
        infos = socket.getaddrinfo(host, parsed.port or None, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFBlocked(f"DNS resolution failed for {host!r}: {exc}") from exc
    seen: set[str] = set()
    for info in infos:
        ip = info[4][0]
        if ip in seen:
            continue
        seen.add(ip)
        if _is_blocked_ip(ip):
            raise SSRFBlocked(
                f"host {host!r} resolves to blocked network: {ip}"
            )


# ─── URL templating ───────────────────────────────────────────────────────────

def _substitute_url(template: str, kwargs: dict) -> str:
    """Replace {arg} placeholders with URL-quoted argument values.

    Caller has already validated at create time that no placeholder lives in
    the scheme/host/port portion of the template, so substitution can only
    affect path/query/fragment — the arg cannot pivot to another host.
    """
    out = template
    for k, v in kwargs.items():
        token = "{" + k + "}"
        if token in out:
            out = out.replace(token, quote(str(v), safe=""))
    return out


def _template_authority_is_static(template: str) -> bool:
    """Reject templates with placeholders in scheme/host/port.

    Used at agent boot so a malformed Tool row is never registered, even if
    it slipped past the dashboard server-action validation.
    """
    parsed = urlparse(template)
    authority = (
        f"{parsed.scheme}://"
        f"{parsed.netloc}"
    )
    return not _PLACEHOLDER_RE.search(authority)


# ─── Tool factory ─────────────────────────────────────────────────────────────

def build_custom_tool(tool_def: dict, ctx: Any) -> Any:
    """Construct an llm.function_tool from a Tool DB row.

    Args go through (a) jsonschema validation, (b) URL template substitution,
    (c) SSRF check on the substituted URL, (d) the configured HTTP request.
    Response body (truncated) flows back to the LLM as the function return
    value. Errors become descriptive text.
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

    # Reject the row up front if its template would let the LLM pick the host.
    if not _template_authority_is_static(url_template):
        logger.warning(
            "tool_template_authority_dynamic_rejected",
            tool=name,
            url=url_template,
        )

        @llm.function_tool(name=name, description=description, raw_schema=params_schema)
        async def _rejected(**_kwargs) -> str:
            return (
                f"Tool '{name}' is misconfigured "
                "(URL template contains a placeholder in the host portion)."
            )

        return _rejected

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
            if _PLACEHOLDER_RE.search(url):
                # The LLM forgot to fill a placeholder. Surface a clean error
                # so it can retry instead of shipping a literal {foo} upstream.
                return (
                    f"Missing argument for tool '{name}': "
                    "all URL placeholders must be supplied."
                )
            try:
                _validate_url(url)
            except SSRFBlocked as exc:
                logger.warning(
                    "tool_url_blocked", tool=name, url=url, reason=str(exc)
                )
                await _record_invocation(
                    tool_id, ctx, invoke_id, name, kwargs, None, "",
                    f"blocked: {exc}", invoke_start,
                )
                return f"Tool '{name}' refused: destination not allowed."

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
        # No FK target — schema requires callId, so we drop the audit row
        # rather than fail the FK insert. WARNING because this is a real gap
        # in the audit trail: it means a tool fired before the call row was
        # created (or after it was deleted), which shouldn't normally happen.
        logger.warning("tool_invocation_skipped_no_call", tool=name)
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
