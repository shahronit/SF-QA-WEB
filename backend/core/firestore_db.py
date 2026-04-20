"""Firebase Firestore singleton client and storage helpers.

This module is only imported when ``settings.STORAGE_BACKEND == "firestore"``.
It centralises the Firebase Admin initialisation so individual storage modules
(user_auth, project_manager, orchestrator, etc.) can share one client and pool
of connections.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from config import settings

_db: Any = None


def is_enabled() -> bool:
    """Return True when Firestore storage is enabled in config."""
    return settings.STORAGE_BACKEND.lower() == "firestore"


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
        from firebase_admin import credentials, firestore
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install firebase-admin`."
        ) from exc

    if not firebase_admin._apps:
        cred_path = settings.FIREBASE_CREDENTIALS_PATH.strip()
        if not cred_path:
            raise RuntimeError(
                "FIREBASE_CREDENTIALS_PATH is empty. Download a service-account "
                "JSON from Firebase Console and set its path in backend/.env."
            )
        if not Path(cred_path).is_file():
            raise RuntimeError(
                f"Firebase credentials file not found at: {cred_path}"
            )
        cred = credentials.Certificate(cred_path)
        opts = {"projectId": settings.FIREBASE_PROJECT_ID} if settings.FIREBASE_PROJECT_ID else None
        firebase_admin.initialize_app(cred, opts)

    _db = firestore.client()
    return _db


# ---------------------------------------------------------------------------
# Collection name constants — single source of truth
# ---------------------------------------------------------------------------
USERS = "users"
PROJECTS = "projects"
AGENT_RUNS = "agent_runs"
JIRA_SESSIONS = "jira_sessions"
