"""User authentication with pluggable storage backend (local JSON or Firestore).

In addition to credentials, each user record carries the admin-panel
metadata that controls what they can see and which prompts they get:

    is_admin: bool         -- gates the /admin panel and /api/admin/*.
    agent_access: list|None -- allow-list of agent slugs (None = all
                              enabled agents; [] = nothing).
    menu_visibility: dict  -- {"manual": bool, "advanced": bool} —
                              hides whole Sidebar groups when False.
    prompt_overrides: dict -- {agent: {qa_mode: prompt_string}} —
                              overrides the global default for that
                              user only.
    model_overrides: dict  -- {agent: {"provider": str, "model": str}} —
                              admin-set per-agent (provider, model)
                              override that wins over the Sidebar's
                              global active selection. Empty / missing
                              entries fall through to the global pick.

The very first registered user is bootstrapped as an admin so a fresh
deployment always has someone able to configure the rest. After that
admin status is only granted via the admin panel itself.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import bcrypt
from jose import JWTError, jwt

from core import firestore_db, secret_fields

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_USERS_FILE = _DATA_DIR / "users.json"

# Keys an admin is allowed to write to a user via update_user(). Anything
# else in the patch is dropped — credentials and audit fields stay
# server-managed only.
_ADMIN_WRITABLE_KEYS = {
    "is_admin",
    "agent_access",
    "menu_visibility",
    "prompt_overrides",
    "model_overrides",
    "display_name",
}

# Default admin-managed values for a brand-new user.
#
# NOTE: brand-new users land with the Manual QA section visible only,
# and a minimal allow-list of three baseline agents. The bootstrap admin
# (very first user) keeps full access — see :func:`register`.
_DEFAULT_MENU_VISIBILITY = {"manual": True, "advanced": False}
_DEFAULT_AGENT_ACCESS = ["requirement", "testcase", "bug_report"]


def _encrypt_prompt_overrides(overrides: dict | None) -> dict:
    """Encrypt every prompt string in a ``{agent: {qa_mode: prompt}}`` dict.

    Returns a deep-enough copy so we never mutate the caller's dict.
    Already-encrypted values pass through unchanged so the function is
    idempotent (safe to call twice).
    """
    if not isinstance(overrides, dict):
        return {}
    out: dict = {}
    for agent, by_mode in overrides.items():
        if not isinstance(by_mode, dict):
            continue
        cleaned: dict = {}
        for mode, prompt in by_mode.items():
            if isinstance(prompt, str) and prompt:
                cleaned[mode] = secret_fields.encrypt_secret(prompt)
            else:
                cleaned[mode] = prompt
        out[agent] = cleaned
    return out


def _decrypt_prompt_overrides(overrides: dict | None) -> dict:
    """Inverse of :func:`_encrypt_prompt_overrides` for the read path.

    Plaintext-tolerant — legacy rows written before encryption was
    enabled pass through unchanged.
    """
    if not isinstance(overrides, dict):
        return {}
    out: dict = {}
    for agent, by_mode in overrides.items():
        if not isinstance(by_mode, dict):
            continue
        cleaned: dict = {}
        for mode, prompt in by_mode.items():
            if isinstance(prompt, str) and prompt:
                cleaned[mode] = secret_fields.decrypt_secret(prompt)
            else:
                cleaned[mode] = prompt
        out[agent] = cleaned
    return out


def _encrypt_user_secrets(raw: dict | None) -> dict | None:
    """Return a copy of *raw* with sensitive sub-fields encrypted.

    Currently only ``prompt_overrides`` qualifies — the bcrypt
    ``password_hash`` is already irreversible, and the structural
    fields (``is_admin``, ``agent_access``, ``menu_visibility``) need
    to stay queryable.
    """
    if not raw:
        return raw
    out = dict(raw)
    if "prompt_overrides" in out:
        out["prompt_overrides"] = _encrypt_prompt_overrides(out.get("prompt_overrides"))
    return out


def _decrypt_user_secrets(raw: dict | None) -> dict | None:
    """Inverse of :func:`_encrypt_user_secrets`."""
    if not raw:
        return raw
    out = dict(raw)
    if "prompt_overrides" in out:
        out["prompt_overrides"] = _decrypt_prompt_overrides(out.get("prompt_overrides"))
    return out


def _normalize_user(raw: dict | None) -> dict | None:
    """Return *raw* with the new admin fields filled in with safe defaults.

    Existing users (created before the schema bump) lack these keys; we
    fill them in on every read so the rest of the app can trust that
    every user dict has the same shape. The on-disk record is untouched
    until something explicitly writes the user back.
    """
    if not raw:
        return None
    out = dict(raw)
    out.setdefault("is_admin", False)
    # agent_access None means "no allow-list" -> see every enabled agent.
    if "agent_access" not in out:
        out["agent_access"] = None
    elif out["agent_access"] is not None and not isinstance(out["agent_access"], list):
        out["agent_access"] = list(out["agent_access"])
    raw_menu = out.get("menu_visibility") or {}
    out["menu_visibility"] = {
        "manual": bool(raw_menu.get("manual", True)),
        "advanced": bool(raw_menu.get("advanced", True)),
    }
    overrides = out.get("prompt_overrides") or {}
    if not isinstance(overrides, dict):
        overrides = {}
    out["prompt_overrides"] = overrides
    # Per-agent (provider, model) override map. Coerce malformed
    # entries to {} silently — a stale Firestore doc must never
    # crash the auth path.
    model_overrides = out.get("model_overrides") or {}
    if not isinstance(model_overrides, dict):
        model_overrides = {}
    cleaned: dict = {}
    for agent, rec in model_overrides.items():
        if not isinstance(rec, dict):
            continue
        prov = str(rec.get("provider") or "").strip()
        mdl = str(rec.get("model") or "").strip()
        if prov and mdl:
            cleaned[str(agent)] = {"provider": prov, "model": mdl}
    out["model_overrides"] = cleaned
    return out


def _public_user(raw: dict | None) -> dict | None:
    """Strip server-only fields (password hash) and normalise.

    Returned to API clients. Includes admin/access metadata so the
    frontend can hide nav items and gate the Admin route immediately
    on login without a second round-trip.
    """
    norm = _normalize_user(raw)
    if not norm:
        return None
    return {
        "username": norm["username"],
        "display_name": norm["display_name"],
        "is_admin": bool(norm.get("is_admin", False)),
        "agent_access": norm.get("agent_access"),
        "menu_visibility": norm.get("menu_visibility"),
        # prompt_overrides intentionally NOT exposed on auth responses
        # (privacy + payload size). The orchestrator reads them server
        # side; the admin panel reads them via /api/admin/*.
    }


# ---------------------------------------------------------------------------
# Local JSON backend
# ---------------------------------------------------------------------------

def _local_load_users() -> dict[str, dict]:
    """Read the users file, returning an empty dict if missing.

    Decrypts every per-user ``prompt_overrides`` blob on the way out
    so the rest of the module sees plaintext just like before
    encryption was introduced.
    """
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not _USERS_FILE.is_file():
        return {}
    try:
        raw = json.loads(_USERS_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {u: _decrypt_user_secrets(v) for u, v in raw.items() if v}


def _local_save_users(users: dict[str, dict]) -> None:
    """Persist the users dict to disk (with prompt overrides encrypted)."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    persisted = {u: _encrypt_user_secrets(v) for u, v in (users or {}).items() if v}
    _USERS_FILE.write_text(json.dumps(persisted, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Firestore backend
# ---------------------------------------------------------------------------

def _fs_get_user(username: str) -> dict | None:
    """Fetch a user document from Firestore (prompt overrides decrypted)."""
    db = firestore_db.get_db()
    doc = db.collection(firestore_db.USERS).document(username).get()
    if not doc.exists:
        return None
    return _decrypt_user_secrets(doc.to_dict())


def _fs_save_user(username: str, data: dict) -> None:
    """Persist a user document in Firestore (prompt overrides encrypted)."""
    db = firestore_db.get_db()
    db.collection(firestore_db.USERS).document(username).set(_encrypt_user_secrets(data))


def _fs_delete_user(username: str) -> None:
    """Remove a user document from Firestore."""
    db = firestore_db.get_db()
    db.collection(firestore_db.USERS).document(username).delete()


def _fs_list_users() -> list[str]:
    """List all usernames from Firestore."""
    db = firestore_db.get_db()
    return sorted(d.id for d in db.collection(firestore_db.USERS).stream())


def _fs_list_user_dicts() -> list[dict]:
    """List all user documents (admin metadata + decrypted prompt overrides)."""
    db = firestore_db.get_db()
    return [
        _decrypt_user_secrets(d.to_dict())
        for d in db.collection(firestore_db.USERS).stream()
    ]


# ---------------------------------------------------------------------------
# Public API (transparent backend dispatch)
# ---------------------------------------------------------------------------

def _is_first_user_setup() -> bool:
    """Return True when no users exist yet (next register() promotes admin)."""
    if firestore_db.is_enabled():
        return len(_fs_list_users()) == 0
    return len(_local_load_users()) == 0


def register(username: str, display_name: str, password: str) -> bool:
    """Create a new user. Returns True on success, False if username taken.

    The very first user registered against an empty store is bootstrapped
    as ``is_admin=True`` so a fresh deployment always has at least one
    administrator. After that admin status is only granted via the
    admin-panel endpoint (PATCH /api/admin/users/{username}).
    """
    username = username.strip().lower()
    if not username or not password:
        return False
    bootstrap_admin = _is_first_user_setup()
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    # The bootstrap admin needs every menu group + every agent so a fresh
    # deployment is immediately usable. Subsequent self-service signups
    # land with the conservative defaults defined above; the admin grants
    # Advanced QA / extra agents from the admin panel.
    if bootstrap_admin:
        menu_visibility = {"manual": True, "advanced": True}
        agent_access: list[str] | None = None
    else:
        menu_visibility = dict(_DEFAULT_MENU_VISIBILITY)
        agent_access = list(_DEFAULT_AGENT_ACCESS)
    user_data = {
        "username": username,
        "display_name": display_name.strip() or username,
        "password_hash": pw_hash,
        "created": datetime.now(timezone.utc).isoformat(),
        "is_admin": bool(bootstrap_admin),
        "agent_access": agent_access,
        "menu_visibility": menu_visibility,
        "prompt_overrides": {},
    }

    if firestore_db.is_enabled():
        if _fs_get_user(username):
            return False
        _fs_save_user(username, user_data)
        return True

    users = _local_load_users()
    if username in users:
        return False
    users[username] = user_data
    _local_save_users(users)
    return True


def authenticate(username: str, password: str) -> dict | None:
    """Verify credentials. Returns the public user dict on success."""
    username = username.strip().lower()

    if firestore_db.is_enabled():
        user = _fs_get_user(username)
    else:
        user = _local_load_users().get(username)

    if not user:
        return None
    if bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        return _public_user(user)
    return None


def list_usernames() -> list[str]:
    """Return all registered usernames (sorted)."""
    if firestore_db.is_enabled():
        return _fs_list_users()
    return sorted(_local_load_users().keys())


def list_users_public() -> list[dict]:
    """Return public user dicts (admin-panel use), sorted by username."""
    if firestore_db.is_enabled():
        raws = _fs_list_user_dicts()
    else:
        raws = list(_local_load_users().values())
    out = [_public_user(r) for r in raws if r]
    return sorted([u for u in out if u], key=lambda u: u["username"])


def get_user(username: str) -> dict | None:
    """Return public user info (without hash) or None."""
    username = username.strip().lower()
    if firestore_db.is_enabled():
        user = _fs_get_user(username)
    else:
        user = _local_load_users().get(username)
    return _public_user(user)


def get_user_full(username: str) -> dict | None:
    """Return the *full* normalised user record incl. prompt_overrides.

    For admin-only callers (e.g. the orchestrator's per-user prompt
    resolution and the per-user prompt-override endpoints). Still
    strips ``password_hash`` so it's safe to log if needed.
    """
    username = username.strip().lower()
    if firestore_db.is_enabled():
        raw = _fs_get_user(username)
    else:
        raw = _local_load_users().get(username)
    norm = _normalize_user(raw)
    if not norm:
        return None
    norm = dict(norm)
    norm.pop("password_hash", None)
    return norm


def update_user(username: str, patch: dict[str, Any]) -> dict | None:
    """Apply an admin-supplied patch to a user. Returns the public dict.

    Only keys in ``_ADMIN_WRITABLE_KEYS`` are accepted; everything else
    in *patch* is silently dropped. Returns ``None`` if the user does
    not exist.
    """
    username = username.strip().lower()
    safe = {k: v for k, v in (patch or {}).items() if k in _ADMIN_WRITABLE_KEYS}
    # Light validation / coercion for the structured fields. Any caller
    # passing the wrong shape (e.g. agent_access as a non-list) gets a
    # cleanly-shaped value back instead of polluting Firestore.
    if "agent_access" in safe:
        v = safe["agent_access"]
        if v is None:
            safe["agent_access"] = None
        elif isinstance(v, (list, tuple)):
            safe["agent_access"] = [str(x) for x in v if str(x).strip()]
        else:
            safe.pop("agent_access")
    if "menu_visibility" in safe:
        v = safe["menu_visibility"] or {}
        if not isinstance(v, dict):
            safe.pop("menu_visibility")
        else:
            safe["menu_visibility"] = {
                "manual": bool(v.get("manual", True)),
                "advanced": bool(v.get("advanced", True)),
            }
    if "prompt_overrides" in safe:
        v = safe["prompt_overrides"] or {}
        if not isinstance(v, dict):
            safe.pop("prompt_overrides")
    if "model_overrides" in safe:
        v = safe["model_overrides"] or {}
        if not isinstance(v, dict):
            safe.pop("model_overrides")
        else:
            cleaned: dict = {}
            for agent, rec in v.items():
                if not isinstance(rec, dict):
                    continue
                prov = str(rec.get("provider") or "").strip()
                mdl = str(rec.get("model") or "").strip()
                if prov and mdl:
                    cleaned[str(agent)] = {"provider": prov, "model": mdl}
            safe["model_overrides"] = cleaned
    if "display_name" in safe:
        dn = str(safe["display_name"] or "").strip()
        if dn:
            safe["display_name"] = dn
        else:
            safe.pop("display_name")
    if "is_admin" in safe:
        safe["is_admin"] = bool(safe["is_admin"])

    if firestore_db.is_enabled():
        existing = _fs_get_user(username)
        if not existing:
            return None
        merged = {**existing, **safe}
        _fs_save_user(username, merged)
        return _public_user(merged)

    users = _local_load_users()
    if username not in users:
        return None
    users[username] = {**users[username], **safe}
    _local_save_users(users)
    return _public_user(users[username])


def delete_user(username: str) -> bool:
    """Remove a user. Returns True on success, False if user not found.

    Callers (the admin endpoint) are responsible for refusing to delete
    the last admin — this function deliberately stays mechanical.
    """
    username = username.strip().lower()
    if firestore_db.is_enabled():
        if not _fs_get_user(username):
            return False
        _fs_delete_user(username)
        return True
    users = _local_load_users()
    if username not in users:
        return False
    del users[username]
    _local_save_users(users)
    return True


def count_admins() -> int:
    """Count users where is_admin is true (used to protect the last admin)."""
    if firestore_db.is_enabled():
        return sum(1 for r in _fs_list_user_dicts() if r and r.get("is_admin"))
    return sum(1 for r in _local_load_users().values() if r and r.get("is_admin"))


def get_user_prompt_override(username: str, agent: str, qa_mode: str) -> str | None:
    """Return the per-user prompt override for (agent, qa_mode), if any.

    Used by the orchestrator's prompt-resolution chain. ``qa_mode`` is
    normalised to ``"salesforce"`` or ``"general"`` to match the keys
    written by the admin endpoints.
    """
    full = get_user_full(username)
    if not full:
        return None
    overrides = full.get("prompt_overrides") or {}
    by_agent = overrides.get(agent) or {}
    mode = "general" if str(qa_mode or "").strip().lower() == "general" else "salesforce"
    val = by_agent.get(mode)
    return val if isinstance(val, str) and val.strip() else None


def set_user_prompt_override(
    username: str, agent: str, qa_mode: str, prompt: str | None,
) -> dict | None:
    """Write or clear a per-user prompt override. Returns the updated user.

    Passing ``prompt=None`` (or empty string) removes the override for
    that mode and prunes empty containers so we never persist
    ``{"agent": {}}`` placeholders.
    """
    full = get_user_full(username)
    if not full:
        return None
    overrides = dict(full.get("prompt_overrides") or {})
    by_agent = dict(overrides.get(agent) or {})
    mode = "general" if str(qa_mode or "").strip().lower() == "general" else "salesforce"
    if prompt and str(prompt).strip():
        by_agent[mode] = str(prompt)
    else:
        by_agent.pop(mode, None)
    if by_agent:
        overrides[agent] = by_agent
    else:
        overrides.pop(agent, None)
    return update_user(username, {"prompt_overrides": overrides})


def get_user_model_override(username: str, agent: str) -> dict | None:
    """Return ``{"provider": ..., "model": ...}`` for *user* + *agent*, or None.

    Used by the orchestrator's ``_resolve_provider_and_model`` chain.
    Returns ``None`` (not an empty dict) when no override is set so
    callers can do a clean ``if rec:`` check.
    """
    full = get_user_full(username)
    if not full:
        return None
    overrides = full.get("model_overrides") or {}
    rec = overrides.get(agent)
    if not isinstance(rec, dict):
        return None
    prov = str(rec.get("provider") or "").strip()
    mdl = str(rec.get("model") or "").strip()
    if not prov or not mdl:
        return None
    return {"provider": prov, "model": mdl}


def set_user_model_override(
    username: str, agent: str, provider: str, model: str,
) -> dict | None:
    """Pin (provider, model) for *user* + *agent*. Returns the updated user.

    Either field empty / blank clears the override and prunes the
    container so we never persist ``{"agent": {}}`` placeholders.
    """
    full = get_user_full(username)
    if not full:
        return None
    overrides = dict(full.get("model_overrides") or {})
    prov = str(provider or "").strip()
    mdl = str(model or "").strip()
    if prov and mdl:
        overrides[agent] = {"provider": prov, "model": mdl}
    else:
        overrides.pop(agent, None)
    return update_user(username, {"model_overrides": overrides})


def clear_user_model_override(username: str, agent: str) -> dict | None:
    """Remove the per-agent (provider, model) override for *user*.

    Returns the updated user dict, or ``None`` if the user is unknown.
    Equivalent to ``set_user_model_override(username, agent, "", "")``.
    """
    return set_user_model_override(username, agent, "", "")


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
