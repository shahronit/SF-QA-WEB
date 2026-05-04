"""One-off helper: print every user in the configured store.

Reads STORAGE_BACKEND from backend/.env and dumps a tabular summary
(username, display name, role, agent access, menu visibility, last
update). Run from the repo root:

    python backend/scripts/_list_users_report.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Ensure backend/ is importable when launched from the repo root.
HERE = Path(__file__).resolve()
BACKEND_DIR = HERE.parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _strip_unknown_env_vars() -> str | None:
    """Pydantic Settings rejects undeclared env vars. The current Settings
    model no longer declares OPENAI_*; the .env file still carries them.
    Snip those lines for the duration of this script and restore on exit.
    """
    env_path = BACKEND_DIR / ".env"
    if not env_path.exists():
        return None
    original = env_path.read_text(encoding="utf-8")
    keep = []
    for line in original.splitlines():
        token = line.strip().split("=", 1)[0].strip()
        if token in {"OPENAI_API_KEY", "OPENAI_FALLBACK_MODELS",
                     "OPENAI_MAX_RETRIES", "LLM_PROVIDER"}:
            continue
        keep.append(line)
    env_path.write_text("\n".join(keep) + "\n", encoding="utf-8")
    return original


def _restore_env(original: str | None) -> None:
    if original is None:
        return
    env_path = BACKEND_DIR / ".env"
    env_path.write_text(original, encoding="utf-8")


def main() -> int:
    backup = _strip_unknown_env_vars()
    try:
        from core import user_auth  # noqa: WPS433  (deferred import on purpose)
        from core import firestore_db
        backend = "firestore" if firestore_db.is_enabled() else "local JSON"
        users = user_auth.list_users_public()

        print(f"Storage backend : {backend}")
        print(f"Total users     : {len(users)}")
        print("-" * 110)

        if not users:
            print("(no users registered)")
            return 0

        for u in users:
            uname = u.get("username", "")
            disp  = u.get("display_name", "") or "(no display name)"
            role  = "ADMIN" if u.get("is_admin") else "user"
            access = u.get("agent_access")
            access_str = "ALL" if access in (None, "all") else (
                ", ".join(access) if access else "(none)"
            )
            menu = u.get("menu_visibility") or {}
            menu_bits = []
            for key in ("manual", "advanced"):
                menu_bits.append(f"{key}={'on' if menu.get(key, True) else 'off'}")
            updated = u.get("updated_at") or u.get("created_at") or ""

            print(f"{uname:<25} | {disp:<28} | {role:<5} | "
                  f"agents: {access_str[:30]:<30} | "
                  f"menu: {','.join(menu_bits):<22} | {updated}")

        # JSON dump too, in case you want to copy it elsewhere.
        print("-" * 110)
        print("\nFull JSON (admin-panel shape):")
        print(json.dumps(users, indent=2, default=str))
        return 0
    finally:
        _restore_env(backup)


if __name__ == "__main__":
    raise SystemExit(main())
