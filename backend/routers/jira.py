"""Jira integration routes — session-based connect, browse, search, disconnect."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import firestore_db
from core.jira_client import JiraClient
from core.jira_links import extract_jira_key
from routers.deps import get_current_user

router = APIRouter()

# Per-process in-memory session cache (keyed by username).
# When STORAGE_BACKEND=firestore the credentials also persist in `jira_sessions`
# so they survive restarts; otherwise they only live for the server's lifetime.
_SESSIONS: dict[str, dict] = {}
_SESSIONS_LOCK = Lock()


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

def _save_session(username: str, session: dict) -> None:
    """Persist a Jira session to memory and (optionally) Firestore."""
    with _SESSIONS_LOCK:
        _SESSIONS[username] = session
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.JIRA_SESSIONS).document(username).set(session)
        except Exception:
            pass


def _load_session(username: str) -> dict | None:
    """Look up a Jira session for *username* (memory first, then Firestore)."""
    with _SESSIONS_LOCK:
        session = _SESSIONS.get(username)
    if session:
        return session
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            doc = db.collection(firestore_db.JIRA_SESSIONS).document(username).get()
            if doc.exists:
                session = doc.to_dict()
                with _SESSIONS_LOCK:
                    _SESSIONS[username] = session
                return session
        except Exception:
            return None
    return None


def _drop_session(username: str) -> None:
    """Remove a Jira session from memory and Firestore."""
    with _SESSIONS_LOCK:
        _SESSIONS.pop(username, None)
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.JIRA_SESSIONS).document(username).delete()
        except Exception:
            pass


def _get_client(username: str) -> JiraClient:
    """Build a JiraClient from the user's stored session, or raise 401."""
    session = _load_session(username)
    if not session:
        raise HTTPException(401, "Not connected to Jira. POST /api/jira/connect first.")
    return JiraClient(session["jira_url"], session["email"], session["api_token"])


# ---------------------------------------------------------------------------
# Request/response schemas
# ---------------------------------------------------------------------------

class JiraConnectRequest(BaseModel):
    """Credentials for connecting to Jira Cloud."""
    jira_url: str
    email: str
    api_token: str


class JiraSearchRequest(BaseModel):
    """Custom JQL search payload."""
    jql: str
    max_results: int = 50


class JiraResolveRequest(BaseModel):
    """Free-form text in which we look for a single Jira issue key/URL."""
    text: str


class JiraCreateBugRequest(BaseModel):
    """Payload for creating a Jira bug issue using the session credentials."""
    project_key: str
    summary: str
    description: str
    # Legacy clients may still send these — they are accepted but ignored when
    # an active session exists.
    jira_url: str | None = None
    email: str | None = None
    api_token: str | None = None


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

@router.post("/connect")
async def connect(body: JiraConnectRequest, user=Depends(get_current_user)):
    """Validate credentials, store the session, and return projects + status."""
    try:
        client = JiraClient(body.jira_url, body.email, body.api_token)
        projects = client.list_projects()
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    session = {
        "jira_url": body.jira_url.rstrip("/"),
        "email": body.email,
        "api_token": body.api_token,
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "projects": projects,
    }
    _save_session(user["sub"], session)
    return {"connected": True, "jira_url": session["jira_url"], "projects": projects}


@router.get("/status")
async def status(user=Depends(get_current_user)):
    """Return whether the user is currently connected to Jira."""
    session = _load_session(user["sub"])
    if not session:
        return {"connected": False}
    return {
        "connected": True,
        "jira_url": session.get("jira_url", ""),
        "email": session.get("email", ""),
        "connected_at": session.get("connected_at", ""),
        "projects": session.get("projects", []),
    }


@router.post("/disconnect")
async def disconnect(user=Depends(get_current_user)):
    """Forget the user's stored Jira credentials."""
    _drop_session(user["sub"])
    return {"connected": False}


# ---------------------------------------------------------------------------
# Browse / search
# ---------------------------------------------------------------------------

@router.get("/projects")
async def list_jira_projects(user=Depends(get_current_user)):
    """Refresh and return the list of projects from Jira."""
    client = _get_client(user["sub"])
    try:
        projects = client.list_projects()
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    session = _load_session(user["sub"]) or {}
    session["projects"] = projects
    _save_session(user["sub"], session)
    return {"projects": projects}


@router.get("/issues")
async def list_jira_issues(
    project_key: str,
    issue_type: str = "",
    max_results: int = 50,
    user=Depends(get_current_user),
):
    """Browse issues for a project, optionally filtered by issue type."""
    client = _get_client(user["sub"])
    try:
        issues = client.list_issues(
            project_key=project_key,
            issue_type=issue_type or None,
            max_results=max_results,
        )
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    return {"issues": issues}


@router.get("/issue/{issue_key}")
async def get_jira_issue(issue_key: str, user=Depends(get_current_user)):
    """Return the full detail for a single issue."""
    client = _get_client(user["sub"])
    try:
        return client.get_issue(issue_key)
    except ConnectionError as e:
        raise HTTPException(400, str(e))


@router.post("/resolve")
async def resolve_jira_text(body: JiraResolveRequest, user=Depends(get_current_user)):
    """Detect a Jira issue key/URL in *text* and return the fetched issue.

    Used by the frontend to auto-expand pasted ticket references inside any
    textarea. Returns ``{"key": null}`` (200) when no key is detected or the
    user is not connected — callers can treat the call as best-effort.
    """
    key = extract_jira_key(body.text)
    if not key:
        return {"key": None}
    session = _load_session(user["sub"])
    if not session:
        return {"key": key, "issue": None, "connected": False}
    client = JiraClient(session["jira_url"], session["email"], session["api_token"])
    try:
        issue = client.get_issue(key)
    except ConnectionError as exc:
        raise HTTPException(400, str(exc))
    return {"key": key, "issue": issue, "connected": True}


@router.post("/search")
async def search_jira(body: JiraSearchRequest, user=Depends(get_current_user)):
    """Run a custom JQL search."""
    client = _get_client(user["sub"])
    try:
        issues = client.search_issues(body.jql, max_results=body.max_results)
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    return {"issues": issues}


# ---------------------------------------------------------------------------
# Bug creation (uses the session when available, falls back to body credentials)
# ---------------------------------------------------------------------------

@router.post("/create-bug")
async def create_bug(body: JiraCreateBugRequest, user=Depends(get_current_user)):
    """Create a Bug issue in Jira and return its key and URL."""
    session = _load_session(user["sub"])
    if session:
        client = JiraClient(session["jira_url"], session["email"], session["api_token"])
    elif body.jira_url and body.email and body.api_token:
        client = JiraClient(body.jira_url, body.email, body.api_token)
    else:
        raise HTTPException(401, "Not connected to Jira and no credentials provided.")
    try:
        return client.create_bug(body.project_key, body.summary, body.description)
    except ConnectionError as e:
        raise HTTPException(400, str(e))
