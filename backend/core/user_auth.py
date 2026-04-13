"""Local JSON-backed user authentication with JWT token support."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
from jose import JWTError, jwt

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_USERS_FILE = _DATA_DIR / "users.json"


def _load_users() -> dict[str, dict]:
    """Read the users file, returning an empty dict if missing."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not _USERS_FILE.is_file():
        return {}
    try:
        return json.loads(_USERS_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_users(users: dict[str, dict]) -> None:
    """Persist the users dict to disk."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _USERS_FILE.write_text(json.dumps(users, indent=2), encoding="utf-8")


def register(username: str, display_name: str, password: str) -> bool:
    """Create a new user. Returns True on success, False if username taken."""
    username = username.strip().lower()
    if not username or not password:
        return False
    users = _load_users()
    if username in users:
        return False
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    users[username] = {
        "username": username,
        "display_name": display_name.strip() or username,
        "password_hash": pw_hash,
        "created": datetime.now(timezone.utc).isoformat(),
    }
    _save_users(users)
    return True


def authenticate(username: str, password: str) -> dict | None:
    """Verify credentials. Returns user dict (without hash) on success."""
    username = username.strip().lower()
    users = _load_users()
    user = users.get(username)
    if not user:
        return None
    if bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return {"username": user["username"], "display_name": user["display_name"]}
    return None


def list_usernames() -> list[str]:
    """Return all registered usernames (sorted)."""
    return sorted(_load_users().keys())


def get_user(username: str) -> dict | None:
    """Return user info (without hash) or None."""
    users = _load_users()
    user = users.get(username.strip().lower())
    if not user:
        return None
    return {"username": user["username"], "display_name": user["display_name"]}


def create_access_token(data: dict, secret: str, algorithm: str, expires_minutes: int = 480) -> str:
    """Create a signed JWT access token."""
    to_encode = data.copy()
    to_encode["exp"] = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    return jwt.encode(to_encode, secret, algorithm=algorithm)


def decode_token(token: str, secret: str, algorithm: str) -> dict | None:
    """Decode and validate a JWT token. Returns payload or None."""
    try:
        return jwt.decode(token, secret, algorithms=[algorithm])
    except JWTError:
        return None
