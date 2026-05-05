"""Admin-only routes: user management + default prompt management.

Mounted at ``/api/admin``. Every route depends on ``get_admin_user``
so non-admin tokens get a clean 403. The admin panel UI lives at
``frontend/src/pages/Admin.jsx``.

Endpoints:

    GET    /users                       List all users + admin metadata
    PATCH  /users/{username}            Update is_admin / agent_access /
                                        menu_visibility / display_name
    DELETE /users/{username}            Remove a user (refuses last admin)

    GET    /agents/defaults             List baked + admin-overridden
                                        default prompts for every agent
                                        in both qa_modes
    PUT    /agents/{agent}/prompt       Save (or clear) the global
                                        default prompt for one agent x
                                        qa_mode

    GET    /users/{username}/prompts    Read all per-user prompt overrides
    PUT    /users/{username}/prompts/{agent}
                                        Save (or clear) a per-user prompt
                                        override for one agent x qa_mode

    GET    /users/{username}/models     Read all per-agent model overrides
    PUT    /users/{username}/models/{agent}
                                        Pin a (provider, model) for one
                                        agent (admin-only override that
                                        beats the global Sidebar pick)
    DELETE /users/{username}/models/{agent}
                                        Clear the per-agent override so
                                        the agent runs on the global
                                        active selection again
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import firestore_db, notifications, prompt_store, user_auth
from core.prompts.prompts import PROMPTS_GEN, PROMPTS_SF
from routers.deps import get_admin_user, get_orchestrator

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class UserPatch(BaseModel):
    """Admin-supplied patch for a single user document."""

    is_admin: bool | None = None
    agent_access: list[str] | None = None
    # Use Field default_factory via Pydantic v2 — but we don't actually
    # need a non-None sentinel here; None means "leave unchanged".
    menu_visibility: dict | None = None
    display_name: str | None = None
    # Per-agent {agent: {provider, model}} override map. Wholesale
    # write — pass the entire desired map, not a partial diff. The
    # dedicated /models endpoints below are usually a better fit for
    # one-agent edits because they preserve the rest of the map.
    model_overrides: dict | None = None


class PromptBody(BaseModel):
    """Body for PUT prompt endpoints. Empty / whitespace clears the override."""

    prompt: str | None = None


class ModelOverrideBody(BaseModel):
    """Body for PUT /users/{u}/models/{agent}.

    Both fields required when setting an override; leave blank or hit
    the DELETE endpoint to clear. Validation that the (provider, model)
    pair maps to a registered backend happens in the route handler so
    we can return a clean 400 with the configured catalog.
    """

    provider: str
    model: str


# ---------------------------------------------------------------------------
# /users — admin user management
# ---------------------------------------------------------------------------

@router.get("/users")
async def list_users(_admin: dict = Depends(get_admin_user)):
    """Return every registered user with their admin metadata."""
    return {"users": user_auth.list_users_public()}


@router.patch("/users/{username}")
async def patch_user(
    username: str, patch: UserPatch, admin: dict = Depends(get_admin_user),
):
    """Apply the admin-supplied patch to *username*.

    Drops keys that aren't in the admin-writable allow-list. Refuses to
    demote the last remaining admin (you'd lock yourself out).
    """
    body = patch.model_dump(exclude_none=True)
    if not body:
        raise HTTPException(400, "No supported fields to update")

    target = user_auth.get_user(username)
    if not target:
        raise HTTPException(404, f"Unknown user: {username}")

    # Soft-block demoting the last admin so the deployment never ends
    # up admin-less. We allow the admin to demote themselves only if
    # at least one OTHER admin exists.
    if (
        body.get("is_admin") is False
        and target.get("is_admin")
        and user_auth.count_admins() <= 1
    ):
        raise HTTPException(
            400,
            "Cannot demote the last remaining admin. Promote another user first.",
        )

    updated = user_auth.update_user(username, body)
    if not updated:
        raise HTTPException(404, f"Unknown user: {username}")
    return {"user": updated}


@router.delete("/users/{username}")
async def remove_user(username: str, admin: dict = Depends(get_admin_user)):
    """Delete a user. Refuses to remove the last remaining admin."""
    target = user_auth.get_user(username)
    if not target:
        raise HTTPException(404, f"Unknown user: {username}")
    if target.get("is_admin") and user_auth.count_admins() <= 1:
        raise HTTPException(
            400,
            "Cannot delete the last remaining admin. Promote another user first.",
        )
    if username.strip().lower() == admin.get("username", "").strip().lower():
        raise HTTPException(400, "You cannot delete your own account.")
    if not user_auth.delete_user(username):
        raise HTTPException(404, f"Unknown user: {username}")
    return {"deleted": username}


# ---------------------------------------------------------------------------
# /agents — global default prompt management
# ---------------------------------------------------------------------------

@router.get("/agents/defaults")
async def list_agent_defaults(_admin: dict = Depends(get_admin_user)):
    """Return the currently-effective default prompt for every agent.

    The response contains both the baked-in default (read from
    ``backend/core/prompts/prompts.py``) and the admin-set override
    (read from ``prompt_store``) for both qa_modes, so the admin UI
    can show "modified" badges and offer a Reset action.
    """
    overrides = prompt_store.list_defaults()
    out: list[dict[str, Any]] = []
    agents = sorted(set(PROMPTS_SF.keys()) | set(PROMPTS_GEN.keys()))
    for agent in agents:
        sf_baked = PROMPTS_SF.get(agent)
        gen_baked = PROMPTS_GEN.get(agent)
        sf_doc = overrides.get(f"{agent}__salesforce") or {}
        gen_doc = overrides.get(f"{agent}__general") or {}
        out.append({
            "agent": agent,
            "salesforce": {
                "baked": sf_baked,
                "override": sf_doc.get("prompt") if sf_doc.get("prompt") else None,
                "updated_by": sf_doc.get("updated_by"),
                "updated_at": sf_doc.get("updated_at"),
                "effective": sf_doc.get("prompt") or sf_baked,
            },
            "general": {
                "baked": gen_baked,
                "override": gen_doc.get("prompt") if gen_doc.get("prompt") else None,
                "updated_by": gen_doc.get("updated_by"),
                "updated_at": gen_doc.get("updated_at"),
                "effective": gen_doc.get("prompt") or gen_baked,
            },
        })
    return {"agents": out}


@router.put("/agents/{agent}/prompt")
async def put_agent_default(
    agent: str,
    body: PromptBody,
    qa_mode: str = "salesforce",
    admin: dict = Depends(get_admin_user),
):
    """Write (or clear with empty body) the default prompt for one agent."""
    if agent not in PROMPTS_SF and agent not in PROMPTS_GEN:
        raise HTTPException(404, f"Unknown agent: {agent}")
    prompt_store.set_default(agent, qa_mode, body.prompt, updated_by=admin.get("username"))
    return {
        "agent": agent,
        "qa_mode": ("general" if str(qa_mode).strip().lower() == "general" else "salesforce"),
        "cleared": not (body.prompt and body.prompt.strip()),
    }


# ---------------------------------------------------------------------------
# /users/{username}/prompts — per-user prompt overrides
# ---------------------------------------------------------------------------

@router.get("/users/{username}/prompts")
async def list_user_prompts(username: str, _admin: dict = Depends(get_admin_user)):
    """Return ``{agent: {salesforce?, general?}}`` for the given user."""
    full = user_auth.get_user_full(username)
    if not full:
        raise HTTPException(404, f"Unknown user: {username}")
    return {"username": full["username"], "prompt_overrides": full.get("prompt_overrides", {})}


@router.put("/users/{username}/prompts/{agent}")
async def put_user_prompt(
    username: str,
    agent: str,
    body: PromptBody,
    qa_mode: str = "salesforce",
    _admin: dict = Depends(get_admin_user),
):
    """Save (or clear with empty body) a per-user prompt override."""
    if agent not in PROMPTS_SF and agent not in PROMPTS_GEN:
        raise HTTPException(404, f"Unknown agent: {agent}")
    updated = user_auth.set_user_prompt_override(username, agent, qa_mode, body.prompt)
    if not updated:
        raise HTTPException(404, f"Unknown user: {username}")
    return {
        "user": updated,
        "agent": agent,
        "qa_mode": ("general" if str(qa_mode).strip().lower() == "general" else "salesforce"),
        "cleared": not (body.prompt and body.prompt.strip()),
    }


# ---------------------------------------------------------------------------
# /users/{username}/models — per-agent model overrides
# ---------------------------------------------------------------------------

@router.get("/users/{username}/models")
async def list_user_model_overrides(
    username: str, _admin: dict = Depends(get_admin_user),
):
    """Return ``{agent: {"provider", "model"}}`` for the given user."""
    full = user_auth.get_user_full(username)
    if not full:
        raise HTTPException(404, f"Unknown user: {username}")
    return {
        "username": full["username"],
        "model_overrides": full.get("model_overrides", {}),
    }


@router.put("/users/{username}/models/{agent}")
async def put_user_model_override(
    username: str,
    agent: str,
    body: ModelOverrideBody,
    _admin: dict = Depends(get_admin_user),
):
    """Pin a (provider, model) for *agent* on *username*.

    Validates the pair against the orchestrator's live catalog so the
    admin can't save an override that points at an un-registered
    provider (which would silently fall through to the global default
    on the next agent run, leaving the admin with no feedback).

    The agent slug is *not* validated against ``PROMPTS_SF`` /
    ``PROMPTS_GEN`` because composite agents (e.g. ``stlc_pack``) live
    in the frontend's ``AGENT_META`` catalog without a dedicated
    prompt entry — they orchestrate the others, and the per-agent
    overrides on those underlying agents already apply when the pack
    iterates them. Storing an override for an unknown slug is a no-op
    at run time, so accepting it here keeps the admin UI symmetric.
    """
    provider = (body.provider or "").strip()
    model = (body.model or "").strip()
    if not provider or not model:
        raise HTTPException(400, "Both 'provider' and 'model' are required.")

    orch = get_orchestrator()
    catalog = orch.available_providers()
    match = next((p for p in catalog if p["provider"] == provider), None)
    if not match:
        configured = [p["provider"] for p in catalog]
        raise HTTPException(
            400,
            f"Provider '{provider}' is not configured on this server. "
            f"Available: {configured}.",
        )
    if model not in (match.get("models") or []):
        raise HTTPException(
            400,
            f"Model '{model}' is not in the {provider} catalog. "
            f"Available: {match.get('models', [])}.",
        )

    updated = user_auth.set_user_model_override(username, agent, provider, model)
    if not updated:
        raise HTTPException(404, f"Unknown user: {username}")
    return {
        "user": updated,
        "agent": agent,
        "provider": provider,
        "model": model,
    }


@router.delete("/users/{username}/models/{agent}")
async def delete_user_model_override(
    username: str, agent: str, _admin: dict = Depends(get_admin_user),
):
    """Clear the per-agent model override so the agent uses the global default."""
    updated = user_auth.clear_user_model_override(username, agent)
    if not updated:
        raise HTTPException(404, f"Unknown user: {username}")
    return {"user": updated, "agent": agent, "cleared": True}


# ---------------------------------------------------------------------------
# /llm-cache — admin maintenance for the deterministic response cache
# ---------------------------------------------------------------------------

@router.delete("/llm-cache")
async def clear_llm_cache(_admin: dict = Depends(get_admin_user)):
    """Drop every memoised LLM response.

    Use this after editing many prompts at once or when you want every
    user's next agent run to hit the LLM fresh (e.g. to test a model
    upgrade). Single-prompt edits don't need a flush — changing the
    prompt automatically changes the cache key for that (agent, mode).
    """
    orch = get_orchestrator()
    cache = getattr(orch, "_cache", None)
    if cache is None:
        return {"cleared": False, "reason": "Cache is disabled (LLM_RESPONSE_CACHE_ENABLED=false)."}
    before = len(cache)
    cache.clear()
    return {"cleared": True, "entries_removed": before}


# ---------------------------------------------------------------------------
# /notifications — admin-only in-app notification feed
# ---------------------------------------------------------------------------

@router.get("/notifications")
async def list_notifications(
    unread_only: bool = False,
    limit: int = 50,
    admin: dict = Depends(get_admin_user),
):
    """Return notifications addressed to the *calling* admin.

    Each admin gets their own per-row read state, so we always scope
    by ``admin["username"]`` — admins cannot peek at each other's
    notification feed.
    """
    items = notifications.list_for_admin(
        admin["username"], unread_only=bool(unread_only), limit=int(limit),
    )
    return {"notifications": items}


@router.get("/notifications/unread-count")
async def get_unread_count(admin: dict = Depends(get_admin_user)):
    """Lightweight ``{count: N}`` poll endpoint for the bell badge."""
    return {"count": notifications.unread_count(admin["username"])}


@router.post("/notifications/{notif_id}/read")
async def mark_notification_read(
    notif_id: str, admin: dict = Depends(get_admin_user),
):
    """Mark a single notification as read for the calling admin."""
    flipped = notifications.mark_read(admin["username"], notif_id)
    if not flipped:
        # Either unknown id, wrong owner, or already-read — return 404
        # so the frontend can quietly drop the row from its cache.
        raise HTTPException(404, "Notification not found or already read")
    return {"id": notif_id, "read": True}


@router.post("/notifications/mark-all-read")
async def mark_all_notifications_read(admin: dict = Depends(get_admin_user)):
    """Mark every unread notification for the calling admin as read."""
    count = notifications.mark_all_read(admin["username"])
    return {"marked_read": count}


# ---------------------------------------------------------------------------
# /usage — admin-only token usage feed (across ALL users)
# ---------------------------------------------------------------------------

@router.get("/usage")
async def list_usage(
    limit: int = 500,
    since: str | None = None,
    username: str | None = None,
    agent: str | None = None,
    _admin: dict = Depends(get_admin_user),
):
    """Return cross-user agent run records plus per-user / per-agent / per-model token rollups.

    The Admin "Usage" tab uses this to surface which users + agents are
    burning the most tokens, which is otherwise invisible because the
    base ``/history`` endpoint never aggregates and is per-record only.

    Sensitive ``input`` / ``output`` fields are deliberately *not*
    decrypted here — admins only need metadata (timestamps, agent,
    provider/model, token counts) to investigate spend, and skipping
    the GCM unwrap keeps the endpoint cheap on big collections.

    Filters:
        * ``limit``     newest-first cap (default 500)
        * ``since``     ISO-8601 timestamp; rows older than this are dropped
        * ``username``  exact match (legacy rows without username are
                        bucketed as ``"(unknown)"`` and only returned
                        when ``username`` is empty)
        * ``agent``     exact match on the agent slug (e.g. ``testcase``)
    """
    from routers.history import _read_firestore, _read_local

    if firestore_db.is_enabled():
        try:
            records = _read_firestore(int(limit))
        except Exception:
            records = _read_local(int(limit))
    else:
        records = _read_local(int(limit))

    if since:
        records = [r for r in records if (r.get("ts") or "") >= since]
    if agent:
        records = [r for r in records if r.get("agent") == agent]
    if username:
        records = [r for r in records if (r.get("username") or "") == username]

    # Build the lightweight payload (no input/output) and the rollups
    # in a single pass so we don't iterate twice on large logs.
    by_user: dict[str, dict[str, Any]] = {}
    by_agent: dict[str, dict[str, Any]] = {}
    by_model: dict[str, dict[str, Any]] = {}
    totals = {"runs": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    out_records: list[dict[str, Any]] = []

    def _bump(bucket: dict[str, Any], usage: dict[str, Any] | None) -> None:
        bucket["runs"] += 1
        if not usage:
            return
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            try:
                bucket[key] += int(usage.get(key) or 0)
            except (TypeError, ValueError):
                pass

    for r in records:
        usage = r.get("usage") or None
        uname = r.get("username") or "(unknown)"
        ag = r.get("agent") or "(unknown)"
        provider = r.get("provider") or ""
        model = r.get("model") or ""
        # Compose a stable model bucket key so the table groups
        # rows by (provider, model) consistently across runs.
        model_key = f"{provider}|{model}"

        user_bucket = by_user.setdefault(
            uname,
            {"username": uname, "runs": 0, "prompt_tokens": 0,
             "completion_tokens": 0, "total_tokens": 0},
        )
        agent_bucket = by_agent.setdefault(
            ag,
            {"agent": ag, "runs": 0, "prompt_tokens": 0,
             "completion_tokens": 0, "total_tokens": 0},
        )
        model_bucket = by_model.setdefault(
            model_key,
            {"provider": provider, "model": model, "runs": 0,
             "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        )
        _bump(user_bucket, usage)
        _bump(agent_bucket, usage)
        _bump(model_bucket, usage)

        totals["runs"] += 1
        if usage:
            for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
                try:
                    totals[key] += int(usage.get(key) or 0)
                except (TypeError, ValueError):
                    pass

        out_records.append({
            "ts": r.get("ts"),
            "username": uname,
            "agent": ag,
            "provider": provider,
            "model": model,
            "project": r.get("project") or "",
            "cache_hit": bool(r.get("cache_hit", False)),
            "repaired": bool(r.get("repaired", False)),
            "usage": usage,
            "output_preview": r.get("output_preview") or "",
        })

    def _ranked(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # Sort by total_tokens desc, then runs desc, so the heaviest
        # spenders surface at the top of each leaderboard.
        return sorted(
            items,
            key=lambda x: (x.get("total_tokens", 0), x.get("runs", 0)),
            reverse=True,
        )

    return {
        "records": out_records,
        "summary": {
            "totals": totals,
            "per_user":  _ranked(list(by_user.values())),
            "per_agent": _ranked(list(by_agent.values())),
            "per_model": _ranked(list(by_model.values())),
        },
    }
