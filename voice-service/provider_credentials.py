"""Resolve which credential a call should use for a given provider.

Order is deliberate: the tenant's own key wins over the server's env key. That
is the whole point of BYOK — one customer's calls must not burn another's quota,
and an organisation that supplied a key expects their key to be the one used.

Nothing in here logs, returns or formats a plaintext credential for display.
The only consumer is agent.py, which passes the value straight into a plugin
constructor.

Loading is cached per organisation for a short TTL so that starting a call does
not add a database round-trip per provider, and so provider resolution never
turns into a live-call bottleneck.
"""
from __future__ import annotations

import time
from typing import Any

import credential_crypto
import db
import provider_registry
from observability import get_logger

logger = get_logger(__name__)

# org_id -> (expires_at_monotonic, {provider_id: plaintext})
_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_TTL_SECONDS = 60.0

# Providers whose credential is a service-account JSON blob rather than a key
# string; agent.py has to pass these to a different constructor argument.
JSON_CREDENTIAL_PROVIDERS = frozenset(
    d.id for d in provider_registry.REGISTRY
    if d.credential_kind == "service_account_json"
)


def invalidate(org_id: str | None = None) -> None:
    """Drop cached credentials, for when the dashboard has just saved one."""
    if org_id:
        _CACHE.pop(org_id, None)
    else:
        _CACHE.clear()


async def load_for_org(org_id: str | None) -> dict[str, str]:
    """Return {provider_id: plaintext credential} for this organisation.

    Rows that fail to decrypt are skipped with a warning rather than raising:
    one bad row must not stop a call that could still run on the server key or
    on another provider. The warning never contains the ciphertext or the key.
    """
    if not org_id:
        return {}
    now = time.monotonic()
    hit = _CACHE.get(org_id)
    if hit and hit[0] > now:
        return hit[1]

    if not credential_crypto.available():
        # No encryption key configured => BYOK is simply off. Said once per TTL.
        logger.info("byok_disabled", reason="CREDENTIAL_ENCRYPTION_KEY is not set",
                    source="PROVIDERS")
        _CACHE[org_id] = (now + _TTL_SECONDS, {})
        return {}

    try:
        rows = await db.get_provider_credentials(org_id)
    except Exception as exc:  # noqa: BLE001 - a DB blip must not kill the call
        logger.warning("byok_load_failed", error=str(exc)[:200], org_id=org_id,
                       source="PROVIDERS")
        return {}

    out: dict[str, str] = {}
    failed: list[str] = []
    for row in rows:
        pid = (row.get("provider") or "").strip().lower()
        if not pid:
            continue
        try:
            out[pid] = credential_crypto.decrypt(row["ciphertext"])
        except credential_crypto.CredentialError:
            failed.append(pid)

    if failed:
        logger.warning(
            "byok_decrypt_failed", providers=sorted(failed), org_id=org_id,
            detail="stored credential could not be decrypted; falling back to the "
                   "server key for these providers",
            source="PROVIDERS")

    _CACHE[org_id] = (now + _TTL_SECONDS, out)
    if out:
        logger.info("byok_loaded", providers=sorted(out), count=len(out),
                    org_id=org_id, source="PROVIDERS")
    return out


def resolve(provider_id: str, capability: str,
            tenant_keys: dict[str, str]) -> tuple[str | None, str]:
    """Return (credential, source) for one provider.

    source is "tenant" | "server" | "" so the caller can log WHICH credential
    was used without ever logging the credential itself.
    """
    pid = (provider_id or "").lower()
    if pid in tenant_keys:
        return tenant_keys[pid], "tenant"
    d = provider_registry.get(pid, capability)
    if d and provider_registry.has_server_credential(d):
        import os
        return (os.environ.get(d.credential_env) or "").strip(), "server"
    return None, ""


def kwargs_for(provider_id: str, credential: str) -> dict[str, Any]:
    """Shape a credential into the constructor argument its plugin expects.

    Google Cloud wants a parsed service-account dict as `credentials_info`;
    every other installed plugin takes `api_key`. Getting this wrong produces a
    confusing auth error deep inside the vendor SDK, so it is decided here once.
    """
    if (provider_id or "").lower() in JSON_CREDENTIAL_PROVIDERS:
        import json
        try:
            return {"credentials_info": json.loads(credential)}
        except Exception as exc:  # noqa: BLE001
            raise ValueError(
                f"{provider_id} expects a service-account JSON credential, but the "
                "stored value is not valid JSON"
            ) from exc
    return {"api_key": credential}
