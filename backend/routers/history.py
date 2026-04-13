"""Agent run history routes (read / clear the JSONL log)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends

from config import settings
from routers.deps import get_current_user

router = APIRouter()
LOG_PATH: Path | None = None


def _log_path() -> Path:
    """Resolve and cache the agent log file path."""
    global LOG_PATH
    if LOG_PATH is None:
        LOG_PATH = settings.PROJECT_ROOT / "logs" / "agent_log.jsonl"
    return LOG_PATH


@router.get("/")
async def get_history(
    limit: int = 200,
    agent: str = "",
    project: str = "",
    user=Depends(get_current_user),
):
    """Return recent agent run records, newest first."""
    lp = _log_path()
    if not lp.exists():
        return {"records": []}
    lines = [ln for ln in lp.read_text("utf-8").splitlines() if ln.strip()]
    records = []
    for line in lines[-(limit):]:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    records.reverse()
    if agent:
        records = [r for r in records if r.get("agent") == agent]
    if project:
        records = [r for r in records if r.get("project") == project]
    return {"records": records}


@router.delete("/")
async def clear_history(user=Depends(get_current_user)):
    """Truncate the agent log file."""
    lp = _log_path()
    if lp.exists():
        lp.write_text("", encoding="utf-8")
    return {"cleared": True}
