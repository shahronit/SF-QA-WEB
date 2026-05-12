"""Audit log for "pushed to Jira" actions (Create Bug, Add Comment).

Mirrors the ``_append_log`` pattern in :mod:`core.orchestrator` — writes
to Firestore when ``STORAGE_BACKEND=firestore`` and is enabled, else
appends one JSON line per push to ``logs/jira_push_log.jsonl``. Used by
the Dashboard analytics endpoint (``/api/me/dashboard``) so users see
how many bugs/comments they've pushed per agent over time, in addition
to LLM agent runs.

Failures here are deliberately swallowed: the user's bug/comment has
already been created in Jira by the time we get here, and an audit
glitch should never surface as an error toast for the user.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core import firestore_db

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
JIRA_PUSH_LOG_PATH = PROJECT_ROOT / "logs" / "jira_push_log.jsonl"


def log_jira_push(
    *,
    username: str,
    kind: str,
    project_key: str = "",
    issue_key: str = "",
    linked_issue_key: str | None = None,
    agent: str | None = None,
    status: str = "success",
    error: str | None = None,
) -> None:
    """Persist a single Jira-push event.

    Args:
        username: Authenticated user who triggered the push.
        kind: Either ``"bug"`` (Create Bug flow) or ``"comment"``
            (Add Comment flow).
        project_key: Jira project key the push targeted, e.g. ``TNS``.
            Empty when the push failed before a project was resolved.
        issue_key: Resulting Jira issue key (``TNS-69``) for bug creates,
            or the issue the comment was attached to. Empty on error.
        linked_issue_key: For bug pushes only — the user-story / parent
            issue the new bug was linked to via ``/rest/api/3/issueLink``.
        agent: Source agent slug (e.g. ``"bug_report"``) when known.
            Falls through to ``None`` for comment pushes that didn't
            specify one — the dashboard rolls those up under
            ``"unattributed"``.
        status: ``"success"`` or ``"error"``.
        error: Short, user-facing message when ``status="error"``.
    """
    record: dict[str, Any] = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "username": (username or "").strip(),
        "kind": (kind or "").strip().lower(),
        "project_key": (project_key or "").strip(),
        "issue_key": (issue_key or "").strip(),
        "linked_issue_key": (linked_issue_key or "").strip() or None,
        "agent": (agent or "").strip() or None,
        "status": (status or "success").strip().lower() or "success",
        "error": (error or "").strip() or None,
    }
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.JIRA_PUSHES).add(record)
            return
        except Exception:  # noqa: BLE001 - audit, never fatal
            logger.exception("Failed to write jira_push to Firestore; falling back to local JSONL")
    try:
        JIRA_PUSH_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with JIRA_PUSH_LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(line)
    except Exception:  # noqa: BLE001 - audit, never fatal
        logger.exception("Failed to write jira_push to local JSONL")


def read_jira_pushes(
    *,
    limit: int = 500,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """Return the most recent Jira-push records (newest first).

    Reads Firestore when enabled, else replays the local JSONL log.
    Records are filtered to ``ts >= since`` when supplied. The list is
    capped at ``limit`` after the in-memory sort so the Dashboard
    endpoint stays responsive even on instances with thousands of pushes.
    """
    records: list[dict[str, Any]] = []
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            query = db.collection(firestore_db.JIRA_PUSHES)
            for snap in query.stream():
                row = snap.to_dict() or {}
                records.append(row)
        except Exception:  # noqa: BLE001 - read errors fall through to local
            logger.exception("Failed to read jira_pushes from Firestore")
    else:
        if JIRA_PUSH_LOG_PATH.exists():
            try:
                with JIRA_PUSH_LOG_PATH.open("r", encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            records.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue
            except Exception:  # noqa: BLE001
                logger.exception("Failed to read local jira_push_log.jsonl")

    if since:
        records = [r for r in records if (r.get("ts") or "") >= since]
    records.sort(key=lambda r: r.get("ts") or "", reverse=True)
    if limit and len(records) > limit:
        records = records[:limit]
    return records


def read_jira_pushes_for_user(
    username: str,
    *,
    limit: int = 1000,
    since: str | None = None,
) -> list[dict[str, Any]]:
    """User-scoped variant of :func:`read_jira_pushes`.

    Pushes the username filter down to the storage layer so the Dashboard
    endpoint never iterates rows that belong to other users:

      * Firestore  — ``where("username", "==", username)`` runs at the
        query level. No other users' documents are downloaded.
      * Local JSONL — the log is a single shared file (no per-user shard),
        so we still scan it linearly, but the username filter is applied
        on every line before the record enters the in-memory list.

    Returns the matching records newest-first, capped at ``limit`` and
    optionally filtered to ``ts >= since``.
    """
    me = (username or "").strip()
    if not me:
        return []

    records: list[dict[str, Any]] = []
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            try:
                # firestore-admin >= 6.x deprecated positional `where`
                # in favour of `filter=FieldFilter(...)`. Both still
                # work; prefer the new form when available so the
                # console doesn't fill with DeprecationWarning lines.
                from google.cloud.firestore_v1.base_query import FieldFilter
                query = db.collection(firestore_db.JIRA_PUSHES).where(
                    filter=FieldFilter("username", "==", me)
                )
            except Exception:  # noqa: BLE001 - older SDK fallback
                query = db.collection(firestore_db.JIRA_PUSHES).where(
                    "username", "==", me
                )
            for snap in query.stream():
                row = snap.to_dict() or {}
                records.append(row)
        except Exception:  # noqa: BLE001 - read errors stay quiet
            logger.exception(
                "Failed to read jira_pushes for user %s from Firestore", me
            )
    else:
        if JIRA_PUSH_LOG_PATH.exists():
            try:
                with JIRA_PUSH_LOG_PATH.open("r", encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            row = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if (row.get("username") or "").strip() == me:
                            records.append(row)
            except Exception:  # noqa: BLE001
                logger.exception("Failed to read local jira_push_log.jsonl")

    if since:
        records = [r for r in records if (r.get("ts") or "") >= since]
    records.sort(key=lambda r: r.get("ts") or "", reverse=True)
    if limit and len(records) > limit:
        records = records[:limit]
    return records
