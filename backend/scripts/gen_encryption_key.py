"""Print a fresh AES-256-GCM master key for the encryption layer.

Usage (from the ``backend/`` directory):

    python -m scripts.gen_encryption_key

Outputs both the base64 and hex form so you can paste whichever your
tooling prefers into ``ENCRYPTION_MASTER_KEY``. Use this once when
provisioning a new environment, then keep the key in a secrets
manager — losing it makes every encrypted field unrecoverable.
"""

from __future__ import annotations

import base64
import secrets


def _generate() -> tuple[str, str]:
    """Return a tuple of ``(base64, hex)`` representations of a 32-byte key."""
    key = secrets.token_bytes(32)
    return base64.b64encode(key).decode("ascii"), key.hex()


def main() -> None:
    """Print the freshly generated key in both encodings."""
    b64, hx = _generate()
    print("Generated AES-256 master key (32 bytes).")
    print()
    print("Base64 (paste into ENCRYPTION_MASTER_KEY):")
    print(f"  {b64}")
    print()
    print("Hex (alternative encoding, also accepted):")
    print(f"  {hx}")
    print()
    print(
        "Store this in a secrets manager. If you lose it, every "
        "encrypted field becomes unrecoverable."
    )


if __name__ == "__main__":
    main()
