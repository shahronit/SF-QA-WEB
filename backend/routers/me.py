"""Per-user "My Usage" routes — mounted at ``/api/me``.

Mirrors the shape of ``/api/admin/usage`` but scoped to the calling
user. Two key differences from the admin endpoint:

    * No admin guard — any authenticated user gets their own slice.
    * ``records`` carry decrypted ``input`` / ``output`` (admins get
      neither in the cross-user feed). The user owns these rows so the
      MyUsage page can show them their actual prompt and response.

The ``per_user`` rollup is intentionally omitted because there is only
ever one user in scope.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends

from core import firestore_db
from core.agent_insight_parsers import parse_for_agent
from core.jira_push_logger import read_jira_pushes, read_jira_pushes_for_user
from routers.admin import (
    reasoning_for,
    usage_bump,
    usage_empty_totals,
    usage_new_bucket,
    usage_ranked,
)
from routers.deps import get_current_user
from routers.history import _decrypt_record, _read_firestore, _read_local

router = APIRouter()


# Window picker on the Dashboard maps to a fixed lookback in days. ``all``
# returns the entire log window the storage backend will give us (capped
# by the read limit below) and is mostly useful for admins or long-time
# users wanting to see their cumulative footprint.
_WINDOW_DAYS = {
    "7d": 7,
    "30d": 30,
    "90d": 90,
    "all": None,
}

# Hard cap on how many records we will scan to build a dashboard.
# Reads are user-scoped at the storage layer (Firestore ``where`` query
# on ``username``, line-by-line username match for the local JSONL
# fallback), so this number bounds the calling user's history — it
# does NOT include other users' rows. A single user generating 10k+
# records in 90 days is virtually unheard of, so 5000 leaves enormous
# headroom while still keeping the read cheap.
_DASHBOARD_READ_LIMIT = 5000


def _resolve_window(window: str | None) -> tuple[str, str | None]:
    """Return ``(canonical_window, since_iso)`` for the Dashboard query."""
    key = (window or "30d").strip().lower()
    if key not in _WINDOW_DAYS:
        key = "30d"
    days = _WINDOW_DAYS[key]
    if days is None:
        return key, None
    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    return key, since_dt.isoformat()


def _read_runs_for_user(username: str, limit: int) -> list[dict[str, Any]]:
    """Read ``agent_runs`` records belonging to *username* only.

    Pushes the username filter to the storage layer so the Dashboard
    endpoint never downloads another user's run rows:

      * Firestore — adds ``where("username", "==", username)`` to the
        query so the document iterator only yields the caller's runs.
        ``order_by("ts", DESC)`` is attempted first; if Firestore
        rejects it (composite index not provisioned), we fall back to
        an unordered ``where`` and sort client-side.
      * Local JSONL — the file is a single tenant-wide log, so we read
        recent lines and discard any whose ``username`` doesn't match
        before the record enters the in-memory list. No other user's
        record is ever decrypted or inspected.

    Returns the user's most recent runs (newest first), at most
    ``limit`` items.
    """
    me = (username or "").strip()
    if not me:
        return []

    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            from google.cloud.firestore_v1 import Query
            # Newer SDKs use FieldFilter for typed equality, but the
            # positional form still works and avoids a hard dependency.
            try:
                from google.cloud.firestore_v1.base_query import FieldFilter
                base = db.collection(firestore_db.AGENT_RUNS).where(
                    filter=FieldFilter("username", "==", me)
                )
            except Exception:  # noqa: BLE001 - older firestore-admin
                base = db.collection(firestore_db.AGENT_RUNS).where(
                    "username", "==", me
                )
            try:
                query = base.order_by("ts", direction=Query.DESCENDING).limit(limit)
                return [d.to_dict() for d in query.stream()]
            except Exception:  # noqa: BLE001 - composite index missing
                # Fallback: query with just the username filter, sort
                # client-side. Single-field equality doesn't need an
                # explicit composite index in Firestore.
                rows = [d.to_dict() for d in base.limit(limit).stream()]
                rows.sort(key=lambda r: r.get("ts") or "", reverse=True)
                return rows
        except Exception:  # noqa: BLE001 - Firestore down / creds bad
            # Fall through to local JSONL so the Dashboard still works.
            pass

    # Local JSONL path. The shared log is read newest-first by
    # ``_read_local`` (which reverses the slice). Filter every row by
    # username so the function never returns another user's record,
    # even transiently.
    rows = _read_local(limit * 8)  # 8x slack to absorb other users' rows
    out = [r for r in rows if (r.get("username") or "").strip() == me]
    return out[:limit]


def _user_can_see_agent(user: dict, agent: str | None) -> bool:
    """Return True when *agent* is inside the caller's allow-list.

    Mirrors the access semantics of ``_ensure_agent_access`` in
    ``routers.agents`` so the Dashboard surface matches the API gate.
    ``None`` / ``[]`` / ``[...]`` are interpreted identically; admins
    bypass the check. Rows with an unknown / empty ``agent`` slug stay
    visible so the user still sees them in their own activity feed.
    """
    if user.get("is_admin"):
        return True
    access = user.get("agent_access")
    if access is None:
        return True
    if not agent:
        return True
    return agent in access


@router.get("/dashboard")
async def my_dashboard(
    window: str = "30d",
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Aggregated activity feed for the calling user's Dashboard.

    Combines two data sources into a single response so the Dashboard
    page only pays one round-trip when it loads:

      * ``agent_runs`` — LLM agent executions logged by the orchestrator.
      * ``jira_pushes`` — Create Bug + Add Comment events logged by
        ``routers.jira`` via :mod:`core.jira_push_logger`.

    Both are filtered to ``ts >= since`` derived from *window* and
    intersected with the caller's ``agent_access`` allow-list so a user
    who can't run the bug-report agent won't see it as a bar in the
    runs-per-agent chart. Admins see every agent.

    Returns:
        ``{window, since, totals, per_agent, daily, recent}`` — see the
        Dashboard plan for shape details.
    """
    me = (user or {}).get("username") or ""
    canonical_window, since = _resolve_window(window)

    # ----------------------------------------------------------------
    # Pull recent agent runs (newest first) — user-scoped at the
    # storage layer, so no other user's records are downloaded /
    # decrypted / counted. This is enforced by ``_read_runs_for_user``
    # both for Firestore (``where("username", "==", me)``) and for the
    # local JSONL fallback (line-by-line username match).
    # ----------------------------------------------------------------
    run_records = _read_runs_for_user(me, _DASHBOARD_READ_LIMIT)
    if since:
        run_records = [r for r in run_records if (r.get("ts") or "") >= since]

    # ----------------------------------------------------------------
    # Pull Jira-push audit entries for the same user / window. Same
    # user-scoping guarantee as ``_read_runs_for_user`` above —
    # ``read_jira_pushes_for_user`` filters at the Firestore query
    # level and never sees another user's push row. Failed pushes are
    # dropped client-side because the audit logs them for
    # observability, but they shouldn't inflate "Bugs created" KPIs.
    # ----------------------------------------------------------------
    push_records = read_jira_pushes_for_user(
        me, limit=_DASHBOARD_READ_LIMIT, since=since,
    )
    push_records = [
        p for p in push_records
        if (p.get("status") or "success").lower() != "error"
    ]

    # ----------------------------------------------------------------
    # Roll up per agent (intersected with the caller's allow-list).
    # ----------------------------------------------------------------
    per_agent: dict[str, dict[str, Any]] = {}

    def _bucket(agent_slug: str | None) -> dict[str, Any]:
        slug = (agent_slug or "").strip() or "(unknown)"
        bucket = per_agent.get(slug)
        if bucket is None:
            bucket = {
                "agent": slug,
                "runs": 0,
                "jira_bugs": 0,
                "jira_comments": 0,
            }
            per_agent[slug] = bucket
        return bucket

    for r in run_records:
        slug = r.get("agent") or "(unknown)"
        if not _user_can_see_agent(user, slug):
            continue
        _bucket(slug)["runs"] += 1

    bugs_total = 0
    comments_total = 0
    for p in push_records:
        slug = p.get("agent")
        if not _user_can_see_agent(user, slug):
            continue
        bucket = _bucket(slug)
        kind = (p.get("kind") or "").lower()
        if kind == "bug":
            bucket["jira_bugs"] += 1
            bugs_total += 1
        elif kind == "comment":
            bucket["jira_comments"] += 1
            comments_total += 1

    # Sort by total activity (runs + pushes) so the busiest agent
    # surfaces first in the bar charts.
    per_agent_list = sorted(
        per_agent.values(),
        key=lambda b: (b["runs"] + b["jira_bugs"] + b["jira_comments"]),
        reverse=True,
    )

    # ----------------------------------------------------------------
    # Per-day timeseries for the line chart. Only buckets dates we
    # actually have activity for so the frontend can decide whether to
    # zero-fill gaps based on the selected window.
    # ----------------------------------------------------------------
    daily: dict[str, dict[str, int]] = defaultdict(
        lambda: {"date": "", "runs": 0, "jira_pushes": 0}
    )

    def _date_key(iso_ts: str | None) -> str:
        if not iso_ts:
            return ""
        return iso_ts[:10]  # YYYY-MM-DD prefix of ISO timestamp

    for r in run_records:
        slug = r.get("agent") or "(unknown)"
        if not _user_can_see_agent(user, slug):
            continue
        key = _date_key(r.get("ts"))
        if not key:
            continue
        cell = daily[key]
        cell["date"] = key
        cell["runs"] += 1

    for p in push_records:
        slug = p.get("agent")
        if not _user_can_see_agent(user, slug):
            continue
        key = _date_key(p.get("ts"))
        if not key:
            continue
        cell = daily[key]
        cell["date"] = key
        cell["jira_pushes"] += 1

    daily_list = sorted(daily.values(), key=lambda c: c["date"])

    # ----------------------------------------------------------------
    # Distinct projects touched in this window (KPI tile).
    # ----------------------------------------------------------------
    projects_active: set[str] = set()
    for r in run_records:
        slug = r.get("agent") or "(unknown)"
        if not _user_can_see_agent(user, slug):
            continue
        proj = (r.get("project") or "").strip()
        if proj:
            projects_active.add(proj)
    for p in push_records:
        slug = p.get("agent")
        if not _user_can_see_agent(user, slug):
            continue
        proj = (p.get("project_key") or "").strip()
        if proj:
            projects_active.add(proj)

    # ----------------------------------------------------------------
    # Recent activity feed — the COMPLETE merged timeline of the
    # user's runs + pushes in this window. We deliberately don't cap
    # the list here ("show all the details"): the frontend can virtualise
    # the scroll or paginate visually, but the API hands over the
    # full slice so a user who ran 47 agents yesterday sees all 47
    # rows rather than the most-recent 10. Reads are already capped
    # by ``_DASHBOARD_READ_LIMIT`` at the storage layer, so the
    # response stays bounded.
    # ----------------------------------------------------------------
    recent: list[dict[str, Any]] = []
    for r in run_records:
        slug = r.get("agent") or "(unknown)"
        if not _user_can_see_agent(user, slug):
            continue
        recent.append({
            "ts": r.get("ts"),
            "kind": "run",
            "agent": slug,
            "project": r.get("project") or "",
            "summary": r.get("output_preview") or "",
            "provider": r.get("provider") or "",
            "model": r.get("model") or "",
            "cache_hit": bool(r.get("cache_hit", False)),
            "repaired": bool(r.get("repaired", False)),
        })
    for p in push_records:
        slug = p.get("agent")
        if not _user_can_see_agent(user, slug):
            continue
        issue = (p.get("issue_key") or "").strip()
        kind = (p.get("kind") or "").lower()
        if kind == "bug" and issue:
            summary = f"Created Jira bug {issue}"
        elif kind == "bug":
            summary = f"Created Jira bug in {p.get('project_key', '')}"
        elif kind == "comment" and issue:
            summary = f"Commented on {issue}"
        else:
            summary = "Pushed to Jira"
        recent.append({
            "ts": p.get("ts"),
            "kind": "jira",
            "subkind": kind,
            "agent": slug,
            "project": p.get("project_key") or "",
            "issue_key": issue,
            "linked_issue_key": p.get("linked_issue_key") or "",
            "summary": summary,
        })
    recent.sort(key=lambda x: x.get("ts") or "", reverse=True)

    # ----------------------------------------------------------------
    # Per-agent insights: one entry per agent the user touched in this
    # window, carrying the run count, a daily sparkline series, and
    # (when the agent emits structured markdown) a chart-ready dict
    # parsed from the latest run. The Dashboard "Agent insights" grid
    # consumes this directly — one card per agent.
    # ----------------------------------------------------------------
    runs_by_agent: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in run_records:
        slug = (r.get("agent") or "").strip() or "(unknown)"
        if not _user_can_see_agent(user, slug):
            continue
        runs_by_agent[slug].append(r)

    per_agent_insights: list[dict[str, Any]] = []
    for slug, records in runs_by_agent.items():
        # ``run_records`` was loaded newest-first, but defaultdict
        # preserves insertion order — newest is index 0 already.
        records_sorted = sorted(
            records,
            key=lambda x: x.get("ts") or "",
            reverse=True,
        )
        latest = records_sorted[0] if records_sorted else {}
        latest_ts = latest.get("ts")

        # Per-day sparkline series for this agent. Same shape as the
        # global ``daily`` list above so the frontend Sparkline can
        # reuse the date / runs keys without remapping.
        per_day: dict[str, int] = defaultdict(int)
        for r in records_sorted:
            key = _date_key(r.get("ts"))
            if key:
                per_day[key] += 1
        spark = [
            {"date": d, "runs": c}
            for d, c in sorted(per_day.items())
        ]

        # Decrypt the latest run's output and dispatch to the parser
        # registry. ``parse_for_agent`` is fail-soft — a raise
        # surfaces as ``None`` so the card falls back to the sparkline
        # instead of breaking the Dashboard.
        structured: dict[str, Any] | None = None
        output_preview = ""
        try:
            decoded = _decrypt_record(latest)
            output_md = decoded.get("output") or ""
            output_preview = (
                decoded.get("output_preview")
                or (output_md[:240] if isinstance(output_md, str) else "")
            )
            structured = parse_for_agent(slug, output_md if isinstance(output_md, str) else "")
        except Exception:  # noqa: BLE001 - never block the Dashboard
            structured = None

        per_agent_insights.append({
            "agent": slug,
            "runs": len(records_sorted),
            "latest_ts": latest_ts,
            "latest_output_preview": output_preview,
            "spark": spark,
            "structured": structured,
        })

    per_agent_insights.sort(
        key=lambda i: (i.get("latest_ts") or ""),
        reverse=True,
    )

    return {
        "window": canonical_window,
        "since": since,
        "scope": "user",  # explicit hint: payload is strictly the caller's data
        "username": me,
        "totals": {
            "runs": sum(b["runs"] for b in per_agent_list),
            "jira_bugs": bugs_total,
            "jira_comments": comments_total,
            "projects_active": len(projects_active),
            # Aggregate record count the user can verify against the
            # rendered feed — "Showing N of N" reassures them that we
            # didn't truncate. Mirrors len(recent) by construction.
            "activity_events": len(recent),
        },
        "per_agent": per_agent_list,
        "per_agent_insights": per_agent_insights,
        "daily": daily_list,
        "recent": recent,
    }


@router.get("/usage")
async def my_usage(
    limit: int = 500,
    since: str | None = None,
    agent: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Return the calling user's recent agent runs + per-agent / per-
    model rollups so the MyUsage page can show them where their tokens
    went.

    Filters mirror ``/api/admin/usage``:
        * ``limit``  newest-first cap (default 500)
        * ``since``  ISO-8601 timestamp; rows older than this are dropped
        * ``agent``  exact match on the agent slug

    The username filter is implicit — only the caller's rows are
    returned. Admins reading this endpoint see *their own* usage, not
    the cross-user feed (which lives at ``/api/admin/usage``).
    """
    me = (user or {}).get("username") or ""

    # Pull a reasonably wide window then narrow to the caller. We can't
    # filter by username at the Firestore query level without an index,
    # so this is the same client-side filter `list_usage` uses.
    fetch_limit = max(int(limit), 1) * 4

    if firestore_db.is_enabled():
        try:
            records = _read_firestore(fetch_limit)
        except Exception:
            records = _read_local(fetch_limit)
    else:
        records = _read_local(fetch_limit)

    # Restrict to the caller's rows BEFORE the rollup so the leaderboard
    # totals reflect the user's own usage, not the global window.
    records = [r for r in records if (r.get("username") or "") == me]

    if since:
        records = [r for r in records if (r.get("ts") or "") >= since]
    if agent:
        records = [r for r in records if r.get("agent") == agent]

    # Cap to the user-requested limit AFTER filtering — otherwise a
    # busy day in the global log can starve the user's view.
    records = records[: int(limit)]

    by_agent: dict[str, dict[str, Any]] = {}
    by_model: dict[str, dict[str, Any]] = {}
    totals = usage_empty_totals()
    out_records: list[dict[str, Any]] = []

    for r in records:
        # Decrypt INPUT/OUTPUT — the user owns these rows, so they get
        # to see the actual prompt and response in the modal. The admin
        # cross-user feed deliberately skips this for cost reasons.
        decoded = _decrypt_record(r)

        usage = decoded.get("usage") or None
        ag = decoded.get("agent") or "(unknown)"
        provider = decoded.get("provider") or ""
        model = decoded.get("model") or ""
        model_key = f"{provider}|{model}"

        agent_bucket = by_agent.setdefault(ag, usage_new_bucket("agent", ag))
        model_bucket = by_model.setdefault(
            model_key,
            usage_new_bucket("model", model, provider=provider),
        )
        usage_bump(agent_bucket, usage)
        usage_bump(model_bucket, usage)
        usage_bump(totals, usage)

        # Emit the four-field usage shape even for legacy records so
        # the frontend never has to backfill the reasoning column.
        if usage and "reasoning_tokens" not in usage:
            usage = {**usage, "reasoning_tokens": reasoning_for(usage)}

        out_records.append({
            "ts": decoded.get("ts"),
            "username": decoded.get("username") or me,
            "agent": ag,
            "provider": provider,
            "model": model,
            "project": decoded.get("project") or "",
            "cache_hit": bool(decoded.get("cache_hit", False)),
            "repaired": bool(decoded.get("repaired", False)),
            "usage": usage,
            # Full input/output (decrypted) for the modal — the admin
            # endpoint sends only `output_preview`. Both keys are
            # included so the shared RecentRunsTable just works.
            "input": decoded.get("input"),
            "output": decoded.get("output"),
            "output_preview": decoded.get("output_preview") or "",
        })

    return {
        "records": out_records,
        "summary": {
            "totals": totals,
            # Intentionally no `per_user` — there's only one user in
            # scope. Admin uses that bucket for their cross-user view.
            "per_agent": usage_ranked(list(by_agent.values())),
            "per_model": usage_ranked(list(by_model.values())),
        },
    }
