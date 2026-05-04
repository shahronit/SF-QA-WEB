"""Google Drive integration routes — OAuth connect, status, file read.

Mirrors the session pattern in `routers.jira`:
  - In-memory session cache keyed by username
  - Optional Firestore persistence (collection ``gdrive_sessions``)
  - All endpoints behind ``get_current_user``

The OAuth dance is split across two endpoints:
  POST /api/gdrive/connect  -> returns the Google consent URL + a state token
  GET  /api/gdrive/callback -> Google redirects here; persists tokens

States are stored in a small in-memory dict so we know which user the
callback belongs to (the callback itself isn't authenticated).
"""

from __future__ import annotations

import secrets
from threading import Lock
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from core import firestore_db, gdrive_client, secret_fields
from routers.deps import get_current_user

router = APIRouter()

# Fields in a GDrive session that hold sensitive credential material;
# everything else (token_uri, scopes, expiry, email, last_folder, etc.)
# stays plaintext so the operator can still tell which Google account
# is linked without granting decrypt access.
_GDRIVE_SESSION_PLAINTEXT_FIELDS = {
    "token_uri", "scopes", "expiry", "client_id",
    "user_email", "email", "last_folder", "created", "updated",
}

# Per-process session and pending-state caches.
_SESSIONS: dict[str, dict[str, Any]] = {}
_SESSIONS_LOCK = Lock()

# Maps random state token -> username, so the unauthenticated callback
# can find which user the OAuth flow belongs to.
_PENDING_STATES: dict[str, str] = {}
_PENDING_STATES_LOCK = Lock()


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _save_session(username: str, session: dict[str, Any]) -> None:
    """Persist a Google session to memory and (optionally) Firestore.

    The in-memory copy stays plaintext for the GDriveClient's hot path;
    Firestore receives an encrypted copy of every credential field
    (access/refresh tokens, client_secret) so a database dump on its
    own does not leak Google OAuth material.
    """
    with _SESSIONS_LOCK:
        _SESSIONS[username] = session
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            persisted = secret_fields.encrypt_dict_values(
                session, exclude=_GDRIVE_SESSION_PLAINTEXT_FIELDS,
            )
            db.collection(firestore_db.GDRIVE_SESSIONS).document(username).set(persisted)
        except Exception:
            pass


def _load_session(username: str) -> dict[str, Any] | None:
    """Look up a Google session for *username* (memory first, then Firestore).

    Decrypts any encrypted values pulled from Firestore before caching
    them in memory so the GDriveClient always sees plaintext credentials.
    """
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(username)
    if session:
        return session
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            doc = db.collection(firestore_db.GDRIVE_SESSIONS).document(username).get()
            if doc.exists:
                raw = doc.to_dict() or {}
                session = secret_fields.decrypt_dict_values(
                    raw, exclude=_GDRIVE_SESSION_PLAINTEXT_FIELDS,
                )
                with _SESSIONS_LOCK:
                    _SESSIONS[username] = session
                return session
        except Exception:
            return None
    return None


def _drop_session(username: str) -> None:
    """Remove a Google session from memory and Firestore."""
    with _SESSIONS_LOCK:
        _SESSIONS.pop(username, None)
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.GDRIVE_SESSIONS).document(username).delete()
        except Exception:
            pass


def _get_client(username: str) -> gdrive_client.GDriveClient:
    """Build a GDriveClient from the user's stored session, or raise 401."""
    session = _load_session(username)
    if not session:
        raise HTTPException(401, "Not connected to Google Drive. POST /api/gdrive/connect first.")
    client = gdrive_client.GDriveClient(session)
    # The client may have refreshed the access token internally — persist that.
    if client.session is not session:
        _save_session(username, client.session)
    else:
        # Same dict reference, but tokens may have been refreshed in place.
        _save_session(username, client.session)
    return client


def try_get_client_optional(username: str) -> gdrive_client.GDriveClient | None:
    """Return a GDriveClient if the user is connected, else None.

    Public helper used by the Jira router to avoid hard-coupling its
    `/full` endpoint to the GDrive auth state.
    """
    try:
        if not _load_session(username):
            return None
        return _get_client(username)
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ReadFilesRequest(BaseModel):
    """Payload for the bulk read endpoint."""
    urls: list[str]


# ---------------------------------------------------------------------------
# OAuth flow
# ---------------------------------------------------------------------------

@router.post("/connect")
async def connect(user=Depends(get_current_user)):
    """Begin the Google OAuth flow — returns the consent URL the user opens."""
    if not gdrive_client.is_oauth_configured():
        raise HTTPException(
            500,
            "Google OAuth is not configured. Set GOOGLE_OAUTH_CLIENT_ID and "
            "GOOGLE_OAUTH_CLIENT_SECRET env vars and restart the server.",
        )

    state = secrets.token_urlsafe(32)
    with _PENDING_STATES_LOCK:
        _PENDING_STATES[state] = user["username"]

    try:
        auth_url = gdrive_client.build_auth_url(state)
    except Exception as exc:  # noqa: BLE001
        with _PENDING_STATES_LOCK:
            _PENDING_STATES.pop(state, None)
        raise HTTPException(500, f"Failed to build Google auth URL: {exc}")

    return {"auth_url": auth_url, "state": state}


@router.get("/callback")
async def callback(code: str = Query(...), state: str = Query(...)):
    """OAuth callback — Google redirects the user back here after consent.

    This endpoint is unauthenticated (Google does not carry our JWT) — we
    correlate it back to the right user via the ``state`` token issued
    during /connect.
    """
    with _PENDING_STATES_LOCK:
        username = _PENDING_STATES.pop(state, None)
    if not username:
        raise HTTPException(400, "Unknown or expired OAuth state.")

    try:
        session = gdrive_client.exchange_code(code)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"Failed to exchange OAuth code: {exc}")

    _save_session(username, session)

    # A small standalone HTML page so the popup auto-closes and the user sees
    # confirmation; calling window.opener avoids blank pages on success.
    return HTMLResponse(
        """
        <!doctype html>
        <html><head><meta charset="utf-8"><title>Google Drive connected</title></head>
        <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 32px; text-align: center;">
            <h2 style="color: #16a34a;">Google Drive connected</h2>
            <p>You can close this tab and return to QA Studio.</p>
            <script>
              try {
                if (window.opener) {
                  window.opener.postMessage({ type: 'gdrive-connected' }, '*');
                  window.close();
                }
              } catch (e) {}
            </script>
        </body></html>
        """
    )


@router.get("/status")
async def status(user=Depends(get_current_user)):
    """Return whether the current user has a Google Drive session."""
    session = _load_session(user["username"])
    if not session:
        return {"connected": False}
    return {
        "connected": True,
        "email": session.get("email", ""),
        "expires_at": session.get("expires_at", ""),
        "connected_at": session.get("connected_at", ""),
        "scopes": session.get("scopes", []),
    }


@router.post("/disconnect")
async def disconnect(user=Depends(get_current_user)):
    """Forget the user's stored Google credentials."""
    _drop_session(user["username"])
    return {"connected": False}


# ---------------------------------------------------------------------------
# File reading
# ---------------------------------------------------------------------------

@router.post("/read")
async def read_files(body: ReadFilesRequest, user=Depends(get_current_user)):
    """Download + extract text from a list of Google Drive URLs (or file ids).

    Files are fetched in parallel with partial-failure isolation: if any
    individual file fails (permissions, unsupported mime, network), it
    appears in the result list with an ``error`` key but does not abort
    the rest.
    """
    if not body.urls:
        return {"files": []}
    client = _get_client(user["username"])
    files = client.read_many(body.urls)
    return {"files": files}
