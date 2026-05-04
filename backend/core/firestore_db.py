"""Firebase Firestore singleton client and storage helpers.

This module is only imported when ``settings.STORAGE_BACKEND == "firestore"``.
It centralises the Firebase Admin initialisation so individual storage modules
(user_auth, project_manager, orchestrator, etc.) can share one client and pool
of connections.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from config import settings

_db: Any = None


def is_enabled() -> bool:
    """Return True when Firestore storage is enabled in config."""
    return settings.STORAGE_BACKEND.lower() == "firestore"


def _load_credentials():
    """Resolve a Firebase ``credentials.Certificate`` from one of two sources.

    Priority:
      1. ``FIREBASE_CREDENTIALS_JSON`` — raw JSON string in env var.
         Best fit for cloud platforms (Render, Heroku, Cloud Run) where
         mounting a file is awkward. Paste the entire service-account JSON
         (including newlines in the private_key) as a single env var.
      2. ``FIREBASE_CREDENTIALS_PATH`` — filesystem path to the JSON file.
         Best fit for local development and Docker bind-mounts.
    """
    from firebase_admin import credentials

    raw_json = settings.FIREBASE_CREDENTIALS_JSON.strip()
    if raw_json:
        try:
            cred_dict = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "FIREBASE_CREDENTIALS_JSON is not valid JSON. Paste the full "
                "service-account file contents (including the curly braces)."
            ) from exc
        return credentials.Certificate(cred_dict)

    cred_path = settings.FIREBASE_CREDENTIALS_PATH.strip()
    if cred_path:
        if not Path(cred_path).is_file():
            raise RuntimeError(
                f"Firebase credentials file not found at: {cred_path}"
            )
        return credentials.Certificate(cred_path)

    raise RuntimeError(
        "No Firebase credentials provided. Set either FIREBASE_CREDENTIALS_JSON "
        "(raw JSON, recommended for cloud deployments) or "
        "FIREBASE_CREDENTIALS_PATH (file path, recommended for local) in your "
        ".env / Render environment."
    )


def get_db() -> Any:
    """Return (or lazily create) the singleton Firestore client.

    Raises ``RuntimeError`` if Firestore is enabled but credentials are missing
    or the firebase-admin package is not installed.
    """
    global _db
    if _db is not None:
        return _db

    try:
        import firebase_admin
        from firebase_admin import firestore
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install firebase-admin`."
        ) from exc

    if not firebase_admin._apps:
        cred = _load_credentials()
        # Initialize with both projectId AND storageBucket so the same Admin
        # app is reusable from `firebase_storage.get_bucket()` without a
        # second initialize_app call (which would raise).
        opts: dict[str, Any] = {}
        if settings.FIREBASE_PROJECT_ID:
            opts["projectId"] = settings.FIREBASE_PROJECT_ID
        if settings.FIREBASE_STORAGE_BUCKET:
            opts["storageBucket"] = settings.FIREBASE_STORAGE_BUCKET
        firebase_admin.initialize_app(cred, opts or None)

    _db = firestore.client()
    return _db


# ---------------------------------------------------------------------------
# Collection name constants — single source of truth
# ---------------------------------------------------------------------------
USERS = "users"
PROJECTS = "projects"
# Subcollection under projects/{slug}/ holding one doc per uploaded file.
PROJECT_DOCUMENTS = "documents"
# Subcollection under projects/{slug}/ holding one doc per configured MCP
# server. Each doc has shape {id, name, url, headers, enabled, created_by,
# created_at} — see project_manager.list_mcp_servers / add_mcp_server.
MCP_SERVERS = "mcp_servers"
AGENT_RUNS = "agent_runs"
JIRA_SESSIONS = "jira_sessions"
GDRIVE_SESSIONS = "gdrive_sessions"
XRAY_SESSIONS = "xray_sessions"
ZEPHYR_SESSIONS = "zephyr_sessions"
# In-app admin notifications. One doc per (admin recipient, event), so
# fanning out a single registration to N admins writes N documents.
NOTIFICATIONS = "notifications"
