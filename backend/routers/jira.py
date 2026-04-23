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


class JiraAddCommentRequest(BaseModel):
    """Add a comment to an existing Jira issue (session credentials)."""
    issue_key: str
    body: str


class JiraCreateBugRequest(BaseModel):
    """Payload for creating a Jira bug issue using the session credentials."""
    project_key: str
    summary: str
    description: str
    # Optional issue link — when set, after the bug is created we attempt to
    # link it to the chosen ticket using the given link type. Failures here
    # are non-fatal: the bug is still returned, with a ``link_error`` field.
    linked_issue_key: str | None = None
    link_type: str = "Relates"
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
    except Exception as e:  # noqa: BLE001 - keep the error visible to the UI
        raise HTTPException(
            400, f"Unexpected Jira error ({type(e).__name__}): {e}"
        )
    session = {
        "jira_url": client.base_url,
        "email": body.email.strip(),
        "api_token": body.api_token.strip(),
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "projects": projects,
    }
    _save_session(user["username"], session)
    return {"connected": True, "jira_url": session["jira_url"], "projects": projects}


@router.get("/status")
async def status(user=Depends(get_current_user)):
    """Return whether the user is currently connected to Jira."""
    session = _load_session(user["username"])
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
    _drop_session(user["username"])
    return {"connected": False}


# ---------------------------------------------------------------------------
# Browse / search
# ---------------------------------------------------------------------------

@router.get("/projects")
async def list_jira_projects(user=Depends(get_current_user)):
    """Refresh and return the list of projects from Jira."""
    client = _get_client(user["username"])
    try:
        projects = client.list_projects()
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    session = _load_session(user["username"]) or {}
    session["projects"] = projects
    _save_session(user["username"], session)
    return {"projects": projects}


@router.get("/issues")
async def list_jira_issues(
    project_key: str,
    issue_type: str = "",
    max_results: int = 50,
    sprint_id: int | None = None,
    active_sprints_only: bool = False,
    user=Depends(get_current_user),
):
    """Browse issues for a project, optionally filtered by issue type and sprint.

    - ``sprint_id`` narrows results to a single sprint (takes precedence).
    - ``active_sprints_only`` (when ``sprint_id`` is unset) narrows to the
      project's currently-open sprints.
    """
    client = _get_client(user["username"])
    try:
        issues = client.list_issues(
            project_key=project_key,
            issue_type=issue_type or None,
            max_results=max_results,
            sprint_id=sprint_id,
            active_sprints_only=active_sprints_only,
        )
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    return {"issues": issues}


@router.get("/sprints")
async def list_jira_sprints(
    project_key: str,
    state: str = "active,future",
    user=Depends(get_current_user),
):
    """Return sprints for *project_key* by auto-detecting its first scrum board.

    Always returns ``200`` with ``{board_id, board_name, sprints, reason?}``.
    A missing board or 403 surfaces as an empty ``sprints`` list with a
    ``reason`` field, so the frontend can hide the dropdown gracefully
    rather than treat it as a hard error.
    """
    client = _get_client(user["username"])
    try:
        return client.list_sprints_for_project(project_key, state=state)
    except ConnectionError as e:
        raise HTTPException(400, str(e))


@router.get("/issue/{issue_key}")
async def get_jira_issue(issue_key: str, user=Depends(get_current_user)):
    """Return the full detail for a single issue."""
    client = _get_client(user["username"])
    try:
        return client.get_issue(issue_key)
    except ConnectionError as e:
        raise HTTPException(400, str(e))


@router.get("/issue/{issue_key}/full")
async def get_jira_issue_full(issue_key: str, user=Depends(get_current_user)):
    """Fetch all available detail categories for a Jira issue in parallel.

    Runs up to 8 concurrent category fetches (comments, changelog, worklogs,
    remote links, watchers, votes, transitions) plus derived categories
    (participants, attachments, linked issues, subtasks, sprint, epic).
    Partial failures are isolated — a 403 on watchers does not abort the rest.

    Returns a structured payload with ``fetch_metadata``, all category results,
    and an ``errors`` list for any categories that could not be fetched.
    """
    client = _get_client(user["username"])

    # If the user has connected Google Drive, automatically fetch any
    # Drive files referenced anywhere in the issue. Missing/failed GDrive
    # auth is silent — the response still includes the detected URLs so
    # the UI can prompt the user to connect.
    gdrive_client = None
    try:
        from routers.gdrive import try_get_client_optional
        gdrive_client = try_get_client_optional(user["username"])
    except Exception:
        gdrive_client = None

    try:
        return client.get_full_issue(issue_key, gdrive_client=gdrive_client)
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
    session = _load_session(user["username"])
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
    client = _get_client(user["username"])
    try:
        issues = client.search_issues(body.jql, max_results=body.max_results)
    except ConnectionError as e:
        raise HTTPException(400, str(e))
    return {"issues": issues}


# ---------------------------------------------------------------------------
# Issue comment (session only)
# ---------------------------------------------------------------------------

@router.post("/comment")
async def add_issue_comment(body: JiraAddCommentRequest, user=Depends(get_current_user)):
    """Post a comment on a Jira issue; body is rendered from markdown to ADF."""
    client = _get_client(user["username"])
    try:
        return client.add_comment(body.issue_key.strip(), body.body)
    except ConnectionError as e:
        raise HTTPException(400, str(e))


# ---------------------------------------------------------------------------
# Bug creation (uses the session when available, falls back to body credentials)
# ---------------------------------------------------------------------------

@router.post("/create-bug")
async def create_bug(body: JiraCreateBugRequest, user=Depends(get_current_user)):
    """Create a Bug issue in Jira and return its key and URL."""
    session = _load_session(user["username"])
    if session:
        client = JiraClient(session["jira_url"], session["email"], session["api_token"])
    elif body.jira_url and body.email and body.api_token:
        client = JiraClient(body.jira_url, body.email, body.api_token)
    else:
        raise HTTPException(401, "Not connected to Jira and no credentials provided.")
    try:
        created = client.create_bug(body.project_key, body.summary, body.description)
    except ConnectionError as e:
        raise HTTPException(400, str(e))

    linked_key = (body.linked_issue_key or "").strip()
    if linked_key:
        link_type = (body.link_type or "Relates").strip() or "Relates"
        try:
            client.create_issue_link(link_type, created["key"], linked_key)
            created["linked_issue_key"] = linked_key
            created["link_type"] = link_type
        except ConnectionError as exc:
            # Bug already exists in Jira — surface the link failure but
            # do not roll back; the user can re-link manually.
            created["linked_issue_key"] = linked_key
            created["link_type"] = link_type
            created["link_error"] = str(exc)
    return created
