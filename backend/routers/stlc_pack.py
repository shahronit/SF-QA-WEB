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
    # Optional execution data for Phase 4 (Test Execution Report). When
    # ``executed`` / ``passed`` / ``failed`` are all non-empty the pack
    # will run Phase 4 with these values; otherwise Phase 4 and Phase 5
    # are skipped (an ``agent_skipped`` SSE event is emitted instead).
    # Optional companion keys: ``blocked``, ``defects_summary``,
    # ``coverage_notes``, ``cycle_name``.
    execution_data: dict[str, Any] | None = None


def _has_exec_data(data: dict[str, Any] | None) -> bool:
    """Decide whether the supplied execution data is sufficient for Phase 4.

    Required keys: ``executed``, ``passed``, ``failed`` — each must be
    a non-empty string after ``.strip()``. ``"0"`` is acceptable. We do
    not validate that the values parse as integers; the agent prompt
    handles that itself and renders whatever the user supplied.
    """
    if not data:
        return False
    for k in ("executed", "passed", "failed"):
        v = str(data.get(k, "")).strip()
        if not v:
            return False
    return True


# ---------------------------------------------------------------------------
# Seed building
# ---------------------------------------------------------------------------

def _person_name(p: Any) -> str:
    """Reduce a Jira person object (or plain string) to a display name."""
    if not p:
        return ""
    if isinstance(p, str):
        return p
    if isinstance(p, dict):
        return p.get("display_name") or p.get("displayName") or p.get("name") or ""
    return ""


def _format_jira_seed(payload: dict[str, Any]) -> str:
    """Render a fetched Jira issue as plain text seed input for the pack.

    Accepts EITHER:
    * the rich envelope from ``JiraClient.get_full_issue`` (keys: ``core``,
      ``comments``, ``subtasks``, ``linked_issues``, ``attachments``,
      ``sprint``, ``epic``, …), OR
    * the lite shape from ``JiraClient.get_issue`` (flat dict).

    The rich shape is auto-detected via the ``core`` / ``fetch_metadata``
    envelope keys; otherwise we fall back to the lite renderer.
    """
    if not payload:
        return ""
    is_rich = bool(payload.get("core") or payload.get("fetch_metadata"))
    if not is_rich:
        return _format_jira_seed_lite(payload)

    core: dict[str, Any] = payload.get("core") or {}
    lines: list[str] = []
    lines.append(
        f"Jira {core.get('issuetype') or 'Issue'} {core.get('key', '')}: {core.get('summary', '')}".strip()
    )

    status_bits: list[str] = []
    if core.get("status"):
        sc = core.get("status_category")
        status_bits.append(f"Status: {core['status']}" + (f" ({sc})" if sc else ""))
    if core.get("resolution"):
        status_bits.append(f"Resolution: {core['resolution']}")
    if core.get("priority"):
        status_bits.append(f"Priority: {core['priority']}")
    if status_bits:
        lines.append(" | ".join(status_bits))

    people: list[str] = []
    a = _person_name(core.get("assignee"))
    r = _person_name(core.get("reporter"))
    cr = _person_name(core.get("creator"))
    if a:
        people.append(f"Assignee: {a}")
    if r:
        people.append(f"Reporter: {r}")
    if cr and cr != r:
        people.append(f"Creator: {cr}")
    if people:
        lines.append(" | ".join(people))

    proj = core.get("project") or {}
    if proj.get("key"):
        lines.append(f"Project: {proj['key']}" + (f" — {proj['name']}" if proj.get("name") else ""))
    parent = core.get("parent") or {}
    if parent.get("key"):
        lines.append(f"Parent: {parent['key']}" + (f" — {parent['summary']}" if parent.get("summary") else ""))

    sprint = payload.get("sprint") or {}
    if sprint.get("name"):
        lines.append(f"Sprint: {sprint['name']}" + (f" [{sprint['state']}]" if sprint.get("state") else ""))
    epic = payload.get("epic") or {}
    if epic.get("key"):
        lines.append(f"Epic: {epic['key']}" + (f" — {epic['summary']}" if epic.get("summary") else ""))
    if core.get("story_points") is not None:
        lines.append(f"Story Points: {core['story_points']}")

    dates: list[str] = []
    for label, key in (("Created", "created"), ("Updated", "updated"), ("Due", "due_date"), ("Resolved", "resolution_date")):
        if core.get(key):
            dates.append(f"{label}: {core[key]}")
    if dates:
        lines.append(" | ".join(dates))

    if core.get("fix_versions"):
        lines.append("Fix Versions: " + ", ".join(core["fix_versions"]))
    if core.get("affects_versions"):
        lines.append("Affects Versions: " + ", ".join(core["affects_versions"]))
    if core.get("components"):
        lines.append("Components: " + ", ".join(core["components"]))
    if core.get("labels"):
        lines.append("Labels: " + ", ".join(core["labels"]))
    if core.get("environment"):
        lines.append(f"Environment: {core['environment']}")

    lines.append("")
    lines.append("Description:")
    lines.append((core.get("description") or "(no description)").strip())

    subtasks = payload.get("subtasks") or []
    if subtasks:
        lines.append("")
        lines.append("Sub-tasks:")
        for s in subtasks:
            bits = [s.get("key", ""), f"[{s.get('status', '')}]" if s.get("status") else "", s.get("summary", "")]
            lines.append("- " + " ".join(b for b in bits if b))

    linked = payload.get("linked_issues") or []
    if linked:
        lines.append("")
        lines.append("Linked issues:")
        for l in linked:
            rel = l.get("label") or l.get("type") or "related to"
            tgt = l.get("key", "")
            lines.append(f"- {rel}: {tgt}" + (f" — {l['summary']}" if l.get("summary") else ""))

    attachments = payload.get("attachments") or []
    if attachments:
        lines.append("")
        lines.append(f"Attachments ({len(attachments)}):")
        for a in attachments:
            size_kb = f" ({round(a['size'] / 1024)} KB)" if a.get("size") else ""
            url_part = f" — {a['url']}" if a.get("url") else ""
            lines.append(f"- {a.get('filename') or a.get('name') or 'file'}{size_kb}{url_part}")

    comments = payload.get("comments") or []
    if comments:
        recent = comments[-5:]
        lines.append("")
        lines.append(f"Comments (showing {len(recent)} of {len(comments)}):")
        for cm in recent:
            who = _person_name(cm.get("author")) or "unknown"
            when = cm.get("created", "")
            lines.append(f"- {who}" + (f" @ {when}" if when else "") + ":")
            body = (cm.get("body") or "").strip()
            if body:
                lines.append(f"  {body[:600]}…" if len(body) > 600 else f"  {body}")

    custom_fields = core.get("custom_fields") or {}
    cf_items = [(k, v) for k, v in custom_fields.items() if v not in (None, "", [], {})]
    if cf_items:
        lines.append("")
        lines.append("Custom fields:")
        for label, val in cf_items:
            lines.append(f"- {label}: {_format_cf(val)}")

    if core.get("url"):
        lines.append("")
        lines.append(f"Source: {core['url']}")

    return "\n".join(line for line in lines if line is not None)


def _format_cf(val: Any) -> str:
    """Compact, human-readable rendering of a custom-field value."""
    if val is None:
        return ""
    if isinstance(val, (str, int, float, bool)):
        return str(val)
    if isinstance(val, list):
        return ", ".join(_format_cf(v) for v in val if v not in (None, ""))
    if isinstance(val, dict):
        for k in ("value", "name", "displayName", "key"):
            if isinstance(val.get(k), str) and val.get(k):
                return val[k]
        return json.dumps(val, ensure_ascii=False)
    return str(val)


def _format_jira_seed_lite(issue: dict[str, Any]) -> str:
    """Legacy formatter for the trimmed ``JiraClient.get_issue`` shape."""
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
        # Prefer the rich /full payload so the pack seed includes comments,
        # sub-tasks, linked issues, attachments, sprint/epic, AND any
        # tenant-specific custom fields (Acceptance Criteria, etc.). Fall
        # back to the trimmed get_issue shape if the full pipeline fails
        # entirely so a partial Jira outage doesn't block the pack.
        issue: dict[str, Any]
        try:
            issue = client.get_full_issue(jira_key)
        except ConnectionError as exc:
            try:
                issue = client.get_issue(jira_key)
            except ConnectionError as exc2:
                raise HTTPException(400, f"Could not fetch Jira issue {jira_key}: {exc2}") from exc
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
    execution_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Map the seed text to the primary input field expected by each agent.

    The keys here mirror those declared on the matching pages under
    ``frontend/src/pages`` so the prompts receive the same JSON shape they
    would when invoked manually. ``qa_mode`` is propagated to every phase so
    the whole pack runs in a single mode. ``execution_data`` (when present)
    feeds Phase 4 directly so the report reflects the user's real numbers
    instead of synthetic placeholders.
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
        ed = execution_data or {}
        base = {
            "cycle_name": (ed.get("cycle_name") or "").strip() or "STLC Pack",
            "executed": str(ed.get("executed", "")).strip(),
            "passed": str(ed.get("passed", "")).strip(),
            "failed": str(ed.get("failed", "")).strip(),
            "blocked": str(ed.get("blocked", "")).strip() or "0",
            "defects_summary": (ed.get("defects_summary") or "").strip() or "(none reported)",
            "coverage_notes": (ed.get("coverage_notes") or "").strip() or seed_text,
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

        exec_ok = _has_exec_data(body.execution_data)
        skipped_reason = (
            "Execution details not provided. Add Executed / Passed / Failed "
            "counts on the STLC Pack page to generate this report."
        )

        for index, step in enumerate(PACK_AGENTS, start=1):
            agent = step["agent"]
            if agent in ("exec_report", "closure_report") and not exec_ok:
                # Tell the UI we deliberately skipped these phases so it can
                # render a clear "Skipped" card instead of a fake report.
                yield _sse("agent_skipped", {
                    "pack_id": pack_id,
                    "index": index,
                    "total": total,
                    "agent": agent,
                    "label": step["label"],
                    "phase": step["phase"],
                    "reason": skipped_reason,
                })
                outputs[agent] = ""
                # Phase 5 chains off Phase 4's output today; when Phase 4 is
                # skipped we deliberately leave ``prior_output`` untouched so
                # later phases (none right now) wouldn't inherit a half-baked
                # placeholder. ``closure_report`` is also skipped via this
                # branch, so the chain effectively stops at Phase 3.
                continue
            yield _sse("agent_start", {
                "pack_id": pack_id,
                "index": index,
                "total": total,
                "agent": agent,
                "label": step["label"],
                "phase": step["phase"],
            })
            user_input = _agent_input(
                agent, seed_text, prior_output, qa_mode=qa_mode,
                execution_data=body.execution_data,
            )
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

        def _section(step: dict[str, str]) -> str:
            agent = step["agent"]
            content = outputs.get(agent, "")
            if not content and agent in ("exec_report", "closure_report") and not exec_ok:
                content = f"_Skipped — {skipped_reason}_"
            return f"## {step['phase']} — {step['label']}\n\n{content}\n\n---\n"

        combined = "\n\n".join(_section(step) for step in PACK_AGENTS)
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
