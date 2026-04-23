"""Test Management push routes — Xray Cloud, Zephyr Scale, native Jira Test."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import firestore_db
from core.jira_client import JiraClient
from core.test_management.parser import TestCase, parse_testcases_markdown
from core.test_management.native_jira import push_test_case as push_native
from core.test_management.xray_client import XrayClient
from core.test_management.zephyr_scale_client import ZephyrScaleClient
from routers.deps import get_current_user
from routers.jira import _load_session as load_jira_session

router = APIRouter()


# ---------------------------------------------------------------------------
# Per-process session caches (mirror routers/jira.py pattern)
# ---------------------------------------------------------------------------
_XRAY_SESSIONS: dict[str, dict] = {}
_XRAY_LOCK = Lock()
_ZEPHYR_SESSIONS: dict[str, dict] = {}
_ZEPHYR_LOCK = Lock()


def _save(scope: str, username: str, session: dict) -> None:
    cache, lock, collection = _resolve_scope(scope)
    with lock:
        cache[username] = session
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(collection).document(username).set(session)
        except Exception:
            pass


def _load(scope: str, username: str) -> dict | None:
    cache, lock, collection = _resolve_scope(scope)
    with lock:
        session = cache.get(username)
    if session:
        return session
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            doc = db.collection(collection).document(username).get()
            if doc.exists:
                session = doc.to_dict()
                with lock:
                    cache[username] = session
                return session
        except Exception:
            return None
    return None


def _drop(scope: str, username: str) -> None:
    cache, lock, collection = _resolve_scope(scope)
    with lock:
        cache.pop(username, None)
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(collection).document(username).delete()
        except Exception:
            pass


def _resolve_scope(scope: str) -> tuple[dict, Lock, str]:
    if scope == "xray":
        return _XRAY_SESSIONS, _XRAY_LOCK, firestore_db.XRAY_SESSIONS
    if scope == "zephyr":
        return _ZEPHYR_SESSIONS, _ZEPHYR_LOCK, firestore_db.ZEPHYR_SESSIONS
    raise ValueError(f"Unknown session scope: {scope}")


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------

class ParseRequest(BaseModel):
    markdown: str


class TestCaseDTO(BaseModel):
    id: str = ""
    title: str = ""
    preconditions: str = ""
    steps: list[str] = []
    expected: str = ""
    priority: str = ""
    type: str = ""


class XrayConnectRequest(BaseModel):
    client_id: str
    client_secret: str


class ZephyrConnectRequest(BaseModel):
    api_token: str
    jira_url: str | None = None


class PushRequest(BaseModel):
    target: Literal["xray", "zephyr", "native_jira"]
    project_key: str
    testcases: list[TestCaseDTO]
    issuetype: str | None = None  # only honoured for native_jira (default 'Test')
    user_story_key: str | None = None  # appended to each test case description


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _dto_to_testcase(dto: TestCaseDTO) -> TestCase:
    return TestCase(
        id=dto.id,
        title=dto.title,
        preconditions=dto.preconditions,
        steps=list(dto.steps or []),
        expected=dto.expected,
        priority=dto.priority,
        type=dto.type,
    )


def _xray_steps(tc: TestCase) -> list[dict[str, str]]:
    """Convert internal steps to Xray ``import/test`` step shape."""
    if not tc.steps:
        return [{
            "action": tc.title or "(see test summary)",
            "data": "",
            "result": tc.expected or "Behaves as described in the summary.",
        }]
    items: list[dict[str, str]] = []
    for idx, step in enumerate(tc.steps, start=1):
        items.append({
            "action": step,
            "data": "",
            "result": tc.expected if idx == len(tc.steps) else "",
        })
    return items


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/parse")
async def parse(body: ParseRequest, user=Depends(get_current_user)) -> dict[str, Any]:
    """Parse a Markdown report into a flat list of test-case dicts."""
    cases = parse_testcases_markdown(body.markdown or "")
    return {"testcases": [tc.to_dict() for tc in cases], "count": len(cases)}


@router.get("/status")
async def status(user=Depends(get_current_user)) -> dict[str, Any]:
    """Return per-target connection status for the current user."""
    jira = bool(load_jira_session(user["username"]))
    xray = bool(_load("xray", user["username"]))
    zephyr = bool(_load("zephyr", user["username"]))
    return {"jira": jira, "xray": xray, "zephyr": zephyr}


@router.post("/connect/xray")
async def connect_xray(
    body: XrayConnectRequest, user=Depends(get_current_user)
) -> dict[str, Any]:
    """Validate Xray Cloud credentials and persist the session."""
    try:
        client = XrayClient(body.client_id, body.client_secret)
        client.verify()
    except ConnectionError as exc:
        raise HTTPException(400, str(exc))
    session = {
        "client_id": body.client_id.strip(),
        "client_secret": body.client_secret.strip(),
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    _save("xray", user["username"], session)
    return {"connected": True}


@router.post("/connect/zephyr")
async def connect_zephyr(
    body: ZephyrConnectRequest, user=Depends(get_current_user)
) -> dict[str, Any]:
    """Validate Zephyr Scale token and persist the session."""
    try:
        client = ZephyrScaleClient(body.api_token, body.jira_url or "")
        client.verify()
    except ConnectionError as exc:
        raise HTTPException(400, str(exc))
    session = {
        "api_token": body.api_token.strip(),
        "jira_url": (body.jira_url or "").strip(),
        "connected_at": datetime.now(timezone.utc).isoformat(),
    }
    _save("zephyr", user["username"], session)
    return {"connected": True}


@router.post("/disconnect/xray")
async def disconnect_xray(user=Depends(get_current_user)) -> dict[str, bool]:
    _drop("xray", user["username"])
    return {"connected": False}


@router.post("/disconnect/zephyr")
async def disconnect_zephyr(user=Depends(get_current_user)) -> dict[str, bool]:
    _drop("zephyr", user["username"])
    return {"connected": False}


@router.post("/push")
async def push(body: PushRequest, user=Depends(get_current_user)) -> dict[str, Any]:
    """Push the supplied test cases to the chosen target.

    Returns one result entry per test case so the UI can render per-row
    success / failure (the call never fails wholesale just because one row
    bombed — partial success is the common case).
    """
    if not body.testcases:
        raise HTTPException(400, "No test cases supplied.")
    if not body.project_key:
        raise HTTPException(400, "project_key is required.")

    # For native_jira we now create a real Jira issue link (type "Test") so
    # the textual "Linked story:" tag is no longer needed there. Xray and
    # Zephyr Scale clients don't have a generic link API in this codebase, so
    # for those targets we still inject the textual tag into preconditions
    # (it surfaces in their description / objective field for traceability).
    story_key = (body.user_story_key or "").strip()
    if story_key and body.target != "native_jira":
        for dto in body.testcases:
            tag = f"Linked story: {story_key}"
            dto.preconditions = (
                f"{(dto.preconditions or '').rstrip()}\n\n{tag}"
                if dto.preconditions else tag
            )

    target = body.target
    results: list[dict[str, Any]] = []

    if target == "xray":
        session = _load("xray", user["username"])
        if not session:
            raise HTTPException(401, "Not connected to Xray. Connect first.")
        client = XrayClient(session["client_id"], session["client_secret"])
        for dto in body.testcases:
            tc = _dto_to_testcase(dto)
            try:
                created = client.create_test(
                    project_key=body.project_key,
                    title=tc.title or tc.id or "(untitled test case)",
                    steps=_xray_steps(tc),
                    preconditions=tc.preconditions,
                    priority=tc.priority,
                )
                results.append({"title": tc.title, **created})
            except ConnectionError as exc:
                results.append({"title": tc.title, "error": str(exc)})

    elif target == "zephyr":
        session = _load("zephyr", user["username"])
        if not session:
            raise HTTPException(401, "Not connected to Zephyr Scale. Connect first.")
        client = ZephyrScaleClient(session["api_token"], session.get("jira_url", ""))
        for dto in body.testcases:
            tc = _dto_to_testcase(dto)
            try:
                created = client.create_test_case(
                    project_key=body.project_key,
                    title=tc.title or tc.id or "(untitled test case)",
                    steps=tc.steps,
                    preconditions=tc.preconditions,
                    priority=tc.priority,
                )
                results.append({"title": tc.title, **created})
            except ConnectionError as exc:
                results.append({"title": tc.title, "error": str(exc)})

    elif target == "native_jira":
        jira_session = load_jira_session(user["username"])
        if not jira_session:
            raise HTTPException(401, "Not connected to Jira. Connect Jira first.")
        client = JiraClient(
            jira_session["jira_url"],
            jira_session["email"],
            jira_session["api_token"],
        )
        issuetype = (body.issuetype or "Test").strip() or "Test"
        for dto in body.testcases:
            tc = _dto_to_testcase(dto)
            try:
                created = push_native(
                    client,
                    body.project_key,
                    tc,
                    issuetype=issuetype,
                    user_story_key=story_key or None,
                )
                results.append({"title": tc.title, **created})
            except ConnectionError as exc:
                results.append({"title": tc.title, "error": str(exc)})

    else:  # pragma: no cover - validated by Pydantic Literal
        raise HTTPException(400, f"Unknown target: {target}")

    successes = sum(1 for r in results if r.get("key") and not r.get("error"))
    links_succeeded = sum(1 for r in results if r.get("link_to") and not r.get("link_error"))
    links_failed = sum(1 for r in results if r.get("link_error"))
    return {
        "target": target,
        "total": len(results),
        "succeeded": successes,
        "failed": len(results) - successes,
        "links_succeeded": links_succeeded,
        "links_failed": links_failed,
        "results": results,
    }
