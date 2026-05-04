"""AES-256-GCM encryption primitives for at-rest field encryption.

This is the lowest-level layer of the encryption stack. Application
code should generally not call this directly — use
:mod:`core.secret_fields` for the convenience helpers that tolerate
plaintext (lazy migration) and walk dicts.

Design choices:

* **Algorithm**: AES-256-GCM via ``cryptography``'s ``AESGCM``. AEAD,
  NIST-approved, 96-bit IV, 128-bit auth tag. Tampering with the
  ciphertext is detected on decrypt.
* **Random IV per call**: ``os.urandom(12)``. Re-using an IV with the
  same key would be catastrophic for GCM; we never reuse one.
* **Envelope format**: ``enc:v1:<base64-iv>:<base64-ct-with-tag>``.
  The version prefix lets us bump algorithms later without ambiguity,
  and the ``enc:`` marker lets readers distinguish ciphertext from
  legacy plaintext (lazy migration).
* **Key encoding**: 32 raw bytes accepted as either base64 (44 char,
  including the ``=`` pad) or hex (64 char). Anything else is rejected
  so a typo cannot quietly downgrade the key strength.
* **Rotation**: ``ENCRYPTION_OLD_KEYS`` is a comma-separated list of
  retired keys. ``decrypt`` falls back to each in order so old rows
  written under a previous key still read; the next write encrypts
  with the current ``ENCRYPTION_MASTER_KEY`` so rotation drains
  organically over time.
"""

from __future__ import annotations

import base64
import os
from typing import Iterable

from config import settings

_VERSION_PREFIX = "enc:v1:"
_IV_LEN = 12  # GCM-recommended 96-bit nonce
_KEY_LEN = 32  # AES-256


class EncryptionError(Exception):
    """Raised for any encryption / decryption failure (bad key, tamper, etc.)."""


# ---------------------------------------------------------------------------
# Key handling
# ---------------------------------------------------------------------------

def _decode_key(raw: str) -> bytes:
    """Return the 32-byte key encoded by *raw*.

    Accepts base64 (44 chars including padding) or hex (64 chars).
    Raises :class:`EncryptionError` on any other shape so a malformed
    key fails loudly instead of silently downgrading to a weak / empty
    key.
    """
    txt = (raw or "").strip()
    if not txt:
        raise EncryptionError("Encryption key is empty")
    # Hex form first (longest, least ambiguous).
    if len(txt) == 64:
        try:
            key = bytes.fromhex(txt)
        except ValueError as exc:
            raise EncryptionError("Encryption key is not valid hex") from exc
        if len(key) != _KEY_LEN:
            raise EncryptionError("Hex encryption key did not decode to 32 bytes")
        return key
    # Base64 form (urlsafe or standard, with or without padding).
    try:
        # Pad to a multiple of 4 so callers can paste either form.
        padded = txt + "=" * (-len(txt) % 4)
        key = base64.b64decode(padded, validate=False)
    except Exception as exc:  # noqa: BLE001 — catch any decoding crash
        raise EncryptionError(
            "Encryption key is not valid base64 or hex"
        ) from exc
    if len(key) != _KEY_LEN:
        raise EncryptionError(
            f"Encryption key must decode to {_KEY_LEN} bytes "
            f"(got {len(key)} bytes — generate with "
            "`python -m scripts.gen_encryption_key`)"
        )
    return key


def _split_old_keys(csv: str) -> list[str]:
    """Parse ``ENCRYPTION_OLD_KEYS`` into individual key strings."""
    if not csv:
        return []
    return [k.strip() for k in csv.split(",") if k.strip()]


def _all_keys() -> list[bytes]:
    """Return [current_key, *old_keys] — current first for fast path.

    Empty list when no master key is configured (encryption is
    disabled). Raises :class:`EncryptionError` if the configured key
    is malformed, since that's a deploy-time mistake we want to
    surface.
    """
    primary = (settings.ENCRYPTION_MASTER_KEY or "").strip()
    if not primary:
        return []
    keys: list[bytes] = [_decode_key(primary)]
    for old in _split_old_keys(settings.ENCRYPTION_OLD_KEYS):
        try:
            keys.append(_decode_key(old))
        except EncryptionError:
            # An unparseable retired key would just permanently shadow
            # everything after it — better to skip and log than crash
            # the whole process. (Validate-or-raise at boot still
            # catches the primary key.)
            continue
    return keys


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def is_enabled() -> bool:
    """Return True when an encryption key is configured *and* parseable."""
    primary = (settings.ENCRYPTION_MASTER_KEY or "").strip()
    if not primary:
        return False
    try:
        _decode_key(primary)
    except EncryptionError:
        return False
    return True


def is_encrypted(value: object) -> bool:
    """Cheap prefix check — does *value* look like one of our envelopes?"""
    return isinstance(value, str) and value.startswith(_VERSION_PREFIX)


def encrypt(plaintext: str) -> str:
    """Encrypt *plaintext* and return an ``enc:v1:...`` envelope.

    Raises :class:`EncryptionError` if no key is configured. Callers
    that want a no-op-when-disabled behaviour should go through
    :func:`core.secret_fields.encrypt_secret` instead.
    """
    if not isinstance(plaintext, str):
        raise EncryptionError("encrypt() requires a str input")
    keys = _all_keys()
    if not keys:
        raise EncryptionError(
            "Encryption is not configured (set ENCRYPTION_MASTER_KEY)"
        )
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aes = AESGCM(keys[0])
    iv = os.urandom(_IV_LEN)
    ct = aes.encrypt(iv, plaintext.encode("utf-8"), associated_data=None)
    return (
        _VERSION_PREFIX
        + base64.b64encode(iv).decode("ascii")
        + ":"
        + base64.b64encode(ct).decode("ascii")
    )


def decrypt(ciphertext: str) -> str:
    """Decrypt an ``enc:v1:...`` envelope and return the plaintext.

    Tries the current key first, then each retired key in
    ``ENCRYPTION_OLD_KEYS`` so rotated databases keep working.
    Raises :class:`EncryptionError` on tamper / bad key / unknown
    envelope version.
    """
    if not isinstance(ciphertext, str):
        raise EncryptionError("decrypt() requires a str input")
    if not ciphertext.startswith(_VERSION_PREFIX):
        raise EncryptionError("Value is not an encrypted envelope")
    body = ciphertext[len(_VERSION_PREFIX):]
    try:
        iv_b64, ct_b64 = body.split(":", 1)
        iv = base64.b64decode(iv_b64)
        ct = base64.b64decode(ct_b64)
    except (ValueError, base64.binascii.Error) as exc:
        raise EncryptionError("Malformed encryption envelope") from exc
    if len(iv) != _IV_LEN:
        raise EncryptionError("Malformed encryption envelope (iv length)")

    keys = _all_keys()
    if not keys:
        raise EncryptionError(
            "Encryption key is not configured but ciphertext was found"
        )

    from cryptography.exceptions import InvalidTag
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    last_exc: Exception | None = None
    for key in keys:
        try:
            pt = AESGCM(key).decrypt(iv, ct, associated_data=None)
            return pt.decode("utf-8")
        except InvalidTag as exc:
            last_exc = exc
            continue
    raise EncryptionError(
        "Failed to decrypt with any configured key (data may be tampered "
        "with or the key was retired without being added to "
        "ENCRYPTION_OLD_KEYS)"
    ) from last_exc


def validate_or_raise() -> None:
    """Validate the configured key at boot and raise if it's malformed.

    A no-op when the key is unset (encryption disabled). Called from
    the FastAPI startup hook so a typo in the env var fails the whole
    process loudly instead of silently storing plaintext.
    """
    primary = (settings.ENCRYPTION_MASTER_KEY or "").strip()
    if not primary:
        return
    # Will raise EncryptionError if malformed.
    _decode_key(primary)
    # Round-trip a tiny string to confirm cryptography is importable
    # and the key actually works.
    sample = encrypt("ok")
    if decrypt(sample) != "ok":
        raise EncryptionError("Encryption self-test failed")
