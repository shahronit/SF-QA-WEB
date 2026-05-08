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

from typing import Any

from fastapi import APIRouter, Depends

from core import firestore_db
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
