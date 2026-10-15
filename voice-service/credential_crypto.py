"""Decrypt BYOK provider credentials written by the dashboard.

Counterpart to dashboard/lib/credential-crypto.ts. Same key, same wire format:

    v1:<base64 iv>:<base64 ciphertext>:<base64 tag>

The worker only ever needs to READ credentials, so encryption lives in the
dashboard and this module is decrypt-only. Keeping it that way means a
compromised worker cannot mint new credential rows.

Nothing here logs or returns a plaintext key. Callers hand the result straight
to a plugin constructor's api_key= argument.
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_VERSION = "v1"


class CredentialError(Exception):
    """Raised when a credential cannot be decrypted. Never carries the key."""


def _key() -> bytes:
    """The 32-byte AES key, matching the dashboard's derivation exactly.

    A 32-byte base64 value is used directly; anything else is SHA-256'd, so a
    human-typed passphrase works identically on both sides. There is no default
    key: without CREDENTIAL_ENCRYPTION_KEY we raise rather than silently using
    a guessable one.
    """
    raw = (os.getenv("CREDENTIAL_ENCRYPTION_KEY") or "").strip()
    if not raw:
        raise CredentialError("CREDENTIAL_ENCRYPTION_KEY is not set")
    try:
        decoded = base64.b64decode(raw, validate=True)
    except Exception:
        decoded = b""
    if len(decoded) == 32:
        return decoded
    return hashlib.sha256(raw.encode("utf-8")).digest()


def available() -> bool:
    """True when a key is configured, so callers can fall back to env keys."""
    try:
        _key()
        return True
    except CredentialError:
        return False


def decrypt(payload: str) -> str:
    """Return the plaintext credential, or raise CredentialError.

    The GCM tag is verified, so a tampered or truncated row fails here instead
    of sending a corrupted key to a provider and producing a confusing 401.
    """
    parts = (payload or "").split(":")
    if len(parts) != 4 or parts[0] != _VERSION:
        raise CredentialError("ciphertext is malformed or of an unknown version")
    _, iv_b64, ct_b64, tag_b64 = parts
    try:
        iv = base64.b64decode(iv_b64)
        ct = base64.b64decode(ct_b64)
        tag = base64.b64decode(tag_b64)
    except Exception as exc:  # noqa: BLE001 - message must not include the key
        raise CredentialError("ciphertext is not valid base64") from exc
    try:
        # cryptography's AESGCM expects ciphertext||tag concatenated.
        return AESGCM(_key()).decrypt(iv, ct + tag, None).decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        raise CredentialError(
            "credential failed to decrypt (wrong CREDENTIAL_ENCRYPTION_KEY, "
            "or the row was written with a different key)"
        ) from exc
