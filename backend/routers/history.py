"""Agent run history routes — backed by Firestore or local JSONL log."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends

from config import settings
from core import firestore_db
from routers.deps import get_current_user

router = APIRouter()
LOG_PATH: Path | None = None


def _log_path() -> Path:
    """Resolve and cache the agent log file path."""
    global LOG_PATH
    if LOG_PATH is None:
        LOG_PATH = settings.PROJECT_ROOT / "logs" / "agent_log.jsonl"
    return LOG_PATH


def _read_local(limit: int) -> list[dict]:
    """Read the most recent ``limit`` records from the JSONL file (newest first)."""
    lp = _log_path()
    if not lp.exists():
        return []
    lines = [ln for ln in lp.read_text("utf-8").splitlines() if ln.strip()]
    records: list[dict] = []
    for line in lines[-limit:]:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    records.reverse()
    return records


def _read_firestore(limit: int) -> list[dict]:
    """Query the most recent ``limit`` agent runs from Firestore (newest first)."""
    db = firestore_db.get_db()
    try:
        from google.cloud.firestore_v1 import Query
        query = (
            db.collection(firestore_db.AGENT_RUNS)
            .order_by("ts", direction=Query.DESCENDING)
            .limit(limit)
        )
    except Exception:
        query = db.collection(firestore_db.AGENT_RUNS).limit(limit)
    return [d.to_dict() for d in query.stream()]


@router.get("/")
async def get_history(
    limit: int = 200,
    agent: str = "",
    project: str = "",
    user=Depends(get_current_user),
):
    """Return recent agent run records, newest first."""
    if firestore_db.is_enabled():
        try:
            records = _read_firestore(limit)
        except Exception:
            records = _read_local(limit)
    else:
        records = _read_local(limit)

    if agent:
        records = [r for r in records if r.get("agent") == agent]
    if project:
        records = [r for r in records if r.get("project") == project]
    return {"records": records}


@router.delete("/")
async def clear_history(user=Depends(get_current_user)):
    """Truncate the local log and (when enabled) delete Firestore agent_runs."""
    lp = _log_path()
    if lp.exists():
        lp.write_text("", encoding="utf-8")
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            for doc in db.collection(firestore_db.AGENT_RUNS).stream():
                doc.reference.delete()
        except Exception:
            pass
    return {"cleared": True}
