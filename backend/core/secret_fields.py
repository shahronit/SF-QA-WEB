"""High-level field encryption helpers used by storage modules.

This is the layer most callers (routers, project_manager, orchestrator,
user_auth) use. It hides three lazy-migration concerns:

* When ``ENCRYPTION_MASTER_KEY`` is unset, ``encrypt_secret`` is a
  no-op so a fresh dev install still runs without a key.
* On read, plaintext values that were written before encryption was
  enabled are returned unchanged; the next write seamlessly upgrades
  them to ciphertext.
* Already-encrypted values are not double-encrypted on write.

The ``_dict`` helpers walk shallow JSON-shaped dicts so a caller can
encrypt a credential bag with a single line:

    cleaned = encrypt_dict_values(session, exclude={"email", "base_url"})
"""

from __future__ import annotations

import logging
from typing import Iterable

from core import secret_box

logger = logging.getLogger(__name__)


def encrypt_secret(value: str | None) -> str | None:
    """Return ciphertext for *value*, or *value* unchanged when unsuitable.

    No-ops in three cases (preserving the input):

    * ``value`` is ``None`` or empty / not a ``str``.
    * Encryption is not configured (``ENCRYPTION_MASTER_KEY`` unset).
    * ``value`` already starts with the encryption envelope prefix.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        return value
    if secret_box.is_encrypted(value):
        return value
    if not secret_box.is_enabled():
        return value
    try:
        return secret_box.encrypt(value)
    except secret_box.EncryptionError:
        # Fail-open on the write path would silently leak plaintext;
        # we'd rather raise so the caller surfaces a 500 and the
        # operator notices the misconfiguration.
        raise


def decrypt_secret(value: str | None) -> str | None:
    """Decrypt *value* if it carries the envelope prefix; otherwise pass through.

    Plaintext-tolerant on purpose so legacy rows (written before
    encryption was enabled) keep working. A genuinely tampered
    ciphertext still raises — we don't want to silently return a
    partial / wrong plaintext.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not value:
        return value
    if not secret_box.is_encrypted(value):
        return value
    return secret_box.decrypt(value)


def encrypt_dict_values(
    payload: dict | None, *, exclude: Iterable[str] = (),
) -> dict | None:
    """Return a shallow copy of *payload* with str leaf values encrypted.

    Keys in *exclude* are passed through unchanged (use this for
    metadata that needs to stay queryable, e.g. ``email``,
    ``project_key``). Non-string values are also passed through —
    booleans, numbers, lists, nested dicts are not touched.
    """
    if not payload:
        return payload
    skip = {str(k) for k in exclude}
    out: dict = {}
    for k, v in payload.items():
        if k in skip or not isinstance(v, str) or not v:
            out[k] = v
            continue
        out[k] = encrypt_secret(v)
    return out


def decrypt_dict_values(
    payload: dict | None, *, exclude: Iterable[str] = (),
) -> dict | None:
    """Mirror of :func:`encrypt_dict_values` for the read path.

    Tolerates plaintext leaves (lazy migration) but propagates real
    decrypt failures so a tampered store doesn't masquerade as a
    successful read.
    """
    if not payload:
        return payload
    skip = {str(k) for k in exclude}
    out: dict = {}
    for k, v in payload.items():
        if k in skip or not isinstance(v, str) or not v:
            out[k] = v
            continue
        try:
            out[k] = decrypt_secret(v)
        except secret_box.EncryptionError:
            logger.exception(
                "Failed to decrypt field %r — returning passthrough; "
                "data may need re-keying or re-entry.",
                k,
            )
            # Re-raise so the caller can surface a clean error rather
            # than acting on garbled data.
            raise
    return out
