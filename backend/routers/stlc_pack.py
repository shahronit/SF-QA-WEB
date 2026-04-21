"""One-click STLC pack — runs five core agents end-to-end from a single seed.

Agents are chained: each subsequent agent receives the previous agent's full
markdown as ``linked_output`` (matches the ``_LINKED_OUTPUT`` block in the
prompts). The endpoint streams progress over Server-Sent Events so the UI can
render a live phase-by-phase pipeline.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from core import firestore_db
from core.jira_client import JiraClient
from core.jira_links import extract_jira_key
from routers.deps import get_current_user, get_orchestrator
from routers.jira import _load_session

logger = logging.getLogger(__name__)
router = APIRouter()

# SSE headers that prevent buffering so phase progress arrives live.
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


# Five core STLC agents in execution order — keep in sync with the frontend
# constant ``STLC_PACK_AGENTS`` in ``frontend/src/config/agentMeta.js``.
PACK_AGENTS: list[dict[str, str]] = [
    {"agent": "requirement", "label": "Requirements Analysis", "phase": "Phase 1 — Requirement Analysis"},
    {"agent": "test_plan", "label": "Test Plan Documentation", "phase": "Phase 2 — Test Planning"},
    {"agent": "testcase", "label": "Test Case Development", "phase": "Phase 3 — Test Case Development"},
    {"agent": "exec_report", "label": "Test Execution Report", "phase": "Phase 4 — Test Execution"},
    {"agent": "closure_report", "label": "Test Closure Report", "phase": "Phase 5 — Test Cycle Closure"},
]


class StlcRunRequest(BaseModel):
    """Payload for the one-click STLC pack run."""

    user_story: str | None = None
    jira_key_or_url: str | None = None
    project_slug: str | None = None
    qa_mode: str | None = "salesforce"  # "salesforce" or "general"


# ---------------------------------------------------------------------------
# Seed building
# ---------------------------------------------------------------------------

def _format_jira_seed(issue: dict[str, Any]) -> str:
    """Render a fetched Jira issue as plain text seed input for the pack."""
    if not issue:
        return ""
    lines = [
        f"Jira {issue.get('issuetype') or 'Issue'} {issue.get('key', '')}: {issue.get('summary', '')}",
    ]
    for label, key in [
        ("Status", "status"),
        ("Priority", "priority"),
        ("Assignee", "assignee"),
        ("Reporter", "reporter"),
    ]:
        val = issue.get(key)
        if val:
            lines.append(f"{label}: {val}")
    if issue.get("labels"):
        lines.append("Labels: " + ", ".join(issue["labels"]))
    if issue.get("components"):
        lines.append("Components: " + ", ".join(issue["components"]))
    lines.append("")
    lines.append("Description:")
    lines.append((issue.get("description") or "(no description)").strip())
    if issue.get("subtasks"):
        lines.append("")
        lines.append("Sub-tasks:")
        for sub in issue["subtasks"]:
            lines.append(f"- {sub.get('key', '')} [{sub.get('status', '')}] {sub.get('summary', '')}")
    if issue.get("url"):
        lines.append("")
        lines.append(f"Source: {issue['url']}")
    return "\n".join(lines)


def _build_seed(username: str, body: StlcRunRequest) -> tuple[str, str | None]:
    """Combine user story + (optionally) fetched Jira ticket into one seed text.

    Returns ``(seed_text, jira_key)``. Raises 400 when neither input is given
    or when a Jira key is provided without an active session.
    """
    parts: list[str] = []
    jira_key: str | None = None

    if body.jira_key_or_url and body.jira_key_or_url.strip():
        jira_key = extract_jira_key(body.jira_key_or_url) or body.jira_key_or_url.strip()
        session = _load_session(username)
        if not session:
            raise HTTPException(
                401,
                "Jira reference provided but no active Jira session. "
                "Connect Jira from the Hub or supply user_story instead.",
            )
        client = JiraClient(session["jira_url"], session["email"], session["api_token"])
        try:
            issue = client.get_issue(jira_key)
        except ConnectionError as exc:
            raise HTTPException(400, f"Could not fetch Jira issue {jira_key}: {exc}")
        parts.append(_format_jira_seed(issue))

    if body.user_story and body.user_story.strip():
        parts.append("User story / additional context:\n" + body.user_story.strip())

    if not parts:
        raise HTTPException(400, "Provide user_story or jira_key_or_url (at least one).")

    return "\n\n".join(parts), jira_key


def _agent_input(
    agent: str,
    seed_text: str,
    prior_output: str | None,
    qa_mode: str = "salesforce",
) -> dict[str, Any]:
    """Map the seed text to the primary input field expected by each agent.

    The keys here mirror those declared on the matching pages under
    ``frontend/src/pages`` so the prompts receive the same JSON shape they
    would when invoked manually. ``qa_mode`` is propagated to every phase so
    the whole pack runs in a single mode.
    """
    base: dict[str, Any] = {}
    if agent == "requirement":
        base = {"user_story": seed_text}
    elif agent == "test_plan":
        base = {
            "scope": seed_text,
            "test_strategy_summary": "(use linked_output from Requirements Analysis)",
        }
    elif agent == "testcase":
        base = {
            "requirements": seed_text,
            "objects": "(infer from linked Test Plan / Requirements)",
            "additional_context": "Generated as part of one-click STLC pack.",
        }
    elif agent == "exec_report":
        base = {
            "cycle_name": "STLC Pack — first execution",
            "executed": "(estimate from linked Test Cases)",
            "passed": "(planned)",
            "failed": "0",
            "blocked": "0",
            "defects_summary": "(none yet — populate from real run)",
            "coverage_notes": seed_text,
        }
    elif agent == "closure_report":
        base = {
            "project_name": "STLC Pack",
            "cycle_summary": seed_text,
            "metrics": "(use linked Execution Report metrics)",
            "open_defects": "(use linked Execution Report)",
            "lessons_learned": "Generated end-to-end by the one-click STLC pack.",
        }
    base["qa_mode"] = qa_mode
    if prior_output:
        base["linked_output"] = prior_output
    return base


# ---------------------------------------------------------------------------
# Pack-level history record
# ---------------------------------------------------------------------------

def _log_pack_run(
    *,
    pack_id: str,
    username: str,
    project_slug: str | None,
    jira_key: str | None,
    seed_text: str,
    outputs: dict[str, str],
) -> None:
    """Persist a single combined ``stlc_pack`` history record alongside the
    per-agent logs that the orchestrator already writes.
    """
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "agent": "stlc_pack",
        "pack_id": pack_id,
        "username": username,
        "project": project_slug,
        "jira_key": jira_key,
        "input": {"seed_preview": seed_text[:500]},
        "agents": [a["agent"] for a in PACK_AGENTS],
        "output_preview": "\n\n".join(
            f"## {a['phase']} — {a['label']}\n\n{(outputs.get(a['agent']) or '')[:200]}"
            for a in PACK_AGENTS
        )[:2000],
    }
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.AGENT_RUNS).add(record)
            return
        except Exception:
            logger.warning("Firestore log of STLC pack failed; falling back to file", exc_info=True)
    try:
        from core.orchestrator import LOG_PATH  # local import to avoid cycles
    except Exception:
        return
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        logger.exception("Failed to write STLC pack log record")


# ---------------------------------------------------------------------------
# SSE endpoint
# ---------------------------------------------------------------------------

def _sse(event: str, payload: dict[str, Any]) -> dict[str, str]:
    """Format a Server-Sent Event for sse_starlette."""
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


@router.post("/run")
async def run_stlc_pack(body: StlcRunRequest, user=Depends(get_current_user)):
    """Run the five-agent STLC pack and stream phase-by-phase progress over SSE."""
    seed_text, jira_key = _build_seed(user["username"], body)
    pack_id = uuid.uuid4().hex
    orch = get_orchestrator()
    orch.set_project(body.project_slug)
    qa_mode = "general" if str(body.qa_mode or "").strip().lower() == "general" else "salesforce"

    async def event_generator() -> Iterable[dict[str, str]]:
        outputs: dict[str, str] = {}
        prior_output: str | None = None
        total = len(PACK_AGENTS)

        yield _sse("pack_start", {
            "pack_id": pack_id,
            "total": total,
            "agents": PACK_AGENTS,
            "jira_key": jira_key,
            "seed_preview": seed_text[:600],
        })

        for index, step in enumerate(PACK_AGENTS, start=1):
            agent = step["agent"]
            yield _sse("agent_start", {
                "pack_id": pack_id,
                "index": index,
                "total": total,
                "agent": agent,
                "label": step["label"],
                "phase": step["phase"],
            })
            user_input = _agent_input(agent, seed_text, prior_output, qa_mode=qa_mode)
            collected: list[str] = []
            err_msg: str | None = None
            q: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()
            loop = asyncio.get_running_loop()

            def _producer(_agent=agent, _input=user_input, _q=q, _loop=loop) -> None:
                try:
                    for chunk in orch.stream_agent(_agent, _input):
                        _loop.call_soon_threadsafe(_q.put_nowait, ("chunk", chunk))
                except Exception as exc:  # noqa: BLE001
                    _loop.call_soon_threadsafe(_q.put_nowait, ("error", str(exc)))
                finally:
                    _loop.call_soon_threadsafe(_q.put_nowait, ("done", None))

            asyncio.create_task(run_in_threadpool(_producer))
            while True:
                kind, payload = await q.get()
                if kind == "chunk":
                    collected.append(payload)
                    yield _sse("token", {"agent": agent, "text": payload})
                elif kind == "error":
                    err_msg = payload
                    break
                else:
                    break
            if err_msg is not None:
                err_text = f"**Error running {agent}:** {err_msg}"
                collected.append(err_text)
                yield _sse("agent_error", {"agent": agent, "error": err_msg})
            full = "".join(collected)
            outputs[agent] = full
            prior_output = full
            yield _sse("agent_done", {
                "pack_id": pack_id,
                "index": index,
                "total": total,
                "agent": agent,
                "label": step["label"],
                "phase": step["phase"],
                "content": full,
            })

        combined = "\n\n".join(
            f"## {step['phase']} — {step['label']}\n\n{outputs.get(step['agent'], '')}\n\n---\n"
            for step in PACK_AGENTS
        )
        _log_pack_run(
            pack_id=pack_id,
            username=user["username"],
            project_slug=body.project_slug,
            jira_key=jira_key,
            seed_text=seed_text,
            outputs=outputs,
        )
        yield _sse("pack_done", {
            "pack_id": pack_id,
            "combined_markdown": combined,
        })

    return EventSourceResponse(event_generator(), headers=_SSE_HEADERS)
