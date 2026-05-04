"""In-app admin notifications with pluggable storage backend.

Mirrors the design of :mod:`core.user_auth`: a thin public API that
transparently dispatches between Firestore and a local JSON file based
on ``settings.STORAGE_BACKEND``.

Today we only emit one event kind, ``user_registered``, but the schema
is generic so additional kinds (``prompt_changed``, ``cache_cleared``,
etc.) can be added later without a migration.

Record shape (one document per *recipient* — fanning a single event to
N admins writes N rows so per-admin read/unread state is independent)::

    {
        "id": "<uuid>",
        "kind": "user_registered",
        "for_admin": "<admin username>",
        "title": "New user registered",
        "body": "<display_name> (<username>) just signed up.",
        "actor_username": "<new username>",
        "created": "<ISO 8601 UTC>",
        "read": False,
        "read_at": None,
    }
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core import firestore_db, user_auth

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_NOTIFICATIONS_FILE = _DATA_DIR / "notifications.json"

# Cap how many records we ever return in one shot. The bell dropdown
# only renders a handful so this protects against runaway memory if the
# store grows unexpectedly.
_MAX_LIST_LIMIT = 200


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    """Return an ISO-8601 UTC timestamp for newly-created records."""
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    """Return a fresh notification id (random UUID4 hex)."""
    return uuid.uuid4().hex


def _admin_usernames() -> list[str]:
    """Return the usernames of every current admin.

    We delegate to ``user_auth.list_users_public`` so the recipient set
    always matches the same admin gating used by the API guards.
    """
    try:
        users = user_auth.list_users_public() or []
    except Exception:
        return []
    return [u["username"] for u in users if u and u.get("is_admin")]


# ---------------------------------------------------------------------------
# Local JSON backend
# ---------------------------------------------------------------------------

def _local_load() -> dict[str, dict]:
    """Read the notifications file, returning ``{}`` if missing/corrupt."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not _NOTIFICATIONS_FILE.is_file():
        return {}
    try:
        data = json.loads(_NOTIFICATIONS_FILE.read_text("utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _local_save(records: dict[str, dict]) -> None:
    """Persist the notifications dict to disk."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _NOTIFICATIONS_FILE.write_text(
        json.dumps(records, indent=2), encoding="utf-8"
    )


# ---------------------------------------------------------------------------
# Firestore backend
# ---------------------------------------------------------------------------

def _fs_collection() -> Any:
    """Return the Firestore collection reference for notifications."""
    db = firestore_db.get_db()
    return db.collection(firestore_db.NOTIFICATIONS)


def _fs_save(record: dict) -> None:
    """Insert a single notification document keyed by its id."""
    _fs_collection().document(record["id"]).set(record)


def _fs_list_for_admin(username: str) -> list[dict]:
    """Return every notification addressed to *username*."""
    col = _fs_collection()
    docs = col.where("for_admin", "==", username).stream()
    return [d.to_dict() for d in docs if d.exists]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def notify_user_registered(new_user: dict | None) -> int:
    """Fan out a ``user_registered`` notification to every existing admin.

    *new_user* is the public user dict returned by
    ``user_auth.authenticate`` after a fresh registration. We tolerate
    a missing dict / missing fields so a botched registration log line
    can't break the whole signup flow.

    Returns the number of records actually written.
    """
    if not new_user:
        return 0
    actor = str(new_user.get("username") or "").strip().lower()
    if not actor:
        return 0
    display = str(new_user.get("display_name") or actor).strip() or actor

    # Don't bother delivering to the new user's own account if they
    # somehow bootstrap-promoted themselves — there's nobody else to
    # tell yet.
    recipients = [u for u in _admin_usernames() if u and u != actor]
    if not recipients:
        return 0

    title = "New user registered"
    body = f"{display} ({actor}) just signed up."
    created = _now_iso()
    written = 0

    if firestore_db.is_enabled():
        for admin_user in recipients:
            record = {
                "id": _new_id(),
                "kind": "user_registered",
                "for_admin": admin_user,
                "title": title,
                "body": body,
                "actor_username": actor,
                "created": created,
                "read": False,
                "read_at": None,
            }
            try:
                _fs_save(record)
                written += 1
            except Exception:
                # Best-effort: keep going so a single network blip
                # against one admin doesn't drop notifications for
                # the others.
                continue
        return written

    records = _local_load()
    for admin_user in recipients:
        record = {
            "id": _new_id(),
            "kind": "user_registered",
            "for_admin": admin_user,
            "title": title,
            "body": body,
            "actor_username": actor,
            "created": created,
            "read": False,
            "read_at": None,
        }
        records[record["id"]] = record
        written += 1
    _local_save(records)
    return written


def list_for_admin(
    username: str, unread_only: bool = False, limit: int = 50,
) -> list[dict]:
    """Return notifications addressed to *username*, newest first.

    *limit* is clamped to a sane upper bound so a malicious / sloppy
    caller can't ask us to materialise the entire collection.
    """
    username = (username or "").strip().lower()
    if not username:
        return []
    try:
        capped = max(1, min(int(limit), _MAX_LIST_LIMIT))
    except (TypeError, ValueError):
        capped = 50

    if firestore_db.is_enabled():
        rows = _fs_list_for_admin(username)
    else:
        rows = [
            r for r in _local_load().values()
            if r and r.get("for_admin") == username
        ]

    if unread_only:
        rows = [r for r in rows if not r.get("read")]
    rows.sort(key=lambda r: r.get("created", ""), reverse=True)
    return rows[:capped]


def unread_count(username: str) -> int:
    """Return the number of unread notifications for *username*."""
    username = (username or "").strip().lower()
    if not username:
        return 0
    if firestore_db.is_enabled():
        rows = _fs_list_for_admin(username)
    else:
        rows = [
            r for r in _local_load().values()
            if r and r.get("for_admin") == username
        ]
    return sum(1 for r in rows if r and not r.get("read"))


def mark_read(username: str, notif_id: str) -> bool:
    """Mark a single notification read. Returns True iff a row flipped.

    A no-op (returns ``False``) when the id doesn't exist or doesn't
    belong to *username* — we never let one admin mark another's row.
    """
    username = (username or "").strip().lower()
    notif_id = (notif_id or "").strip()
    if not username or not notif_id:
        return False

    if firestore_db.is_enabled():
        col = _fs_collection()
        doc = col.document(notif_id).get()
        if not doc.exists:
            return False
        data = doc.to_dict() or {}
        if data.get("for_admin") != username:
            return False
        if data.get("read"):
            return False
        data["read"] = True
        data["read_at"] = _now_iso()
        col.document(notif_id).set(data)
        return True

    records = _local_load()
    rec = records.get(notif_id)
    if not rec or rec.get("for_admin") != username:
        return False
    if rec.get("read"):
        return False
    rec["read"] = True
    rec["read_at"] = _now_iso()
    records[notif_id] = rec
    _local_save(records)
    return True


def mark_all_read(username: str) -> int:
    """Mark every unread notification for *username* as read.

    Returns the count of rows actually flipped.
    """
    username = (username or "").strip().lower()
    if not username:
        return 0

    flipped = 0
    now = _now_iso()
    if firestore_db.is_enabled():
        col = _fs_collection()
        rows = col.where("for_admin", "==", username).where("read", "==", False).stream()
        for doc in rows:
            try:
                data = doc.to_dict() or {}
                data["read"] = True
                data["read_at"] = now
                col.document(doc.id).set(data)
                flipped += 1
            except Exception:
                continue
        return flipped

    records = _local_load()
    changed = False
    for rec_id, rec in records.items():
        if not rec or rec.get("for_admin") != username:
            continue
        if rec.get("read"):
            continue
        rec["read"] = True
        rec["read_at"] = now
        records[rec_id] = rec
        flipped += 1
        changed = True
    if changed:
        _local_save(records)
    return flipped
