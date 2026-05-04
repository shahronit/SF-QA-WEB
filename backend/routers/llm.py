"""LLM provider listing and switching routes.

The Sidebar's "AI Engine" dropdown calls these endpoints to:
    * list every configured provider and its model catalog (``/providers``);
    * pin a (provider, model) pair as the global active selection
      (``/switch``);
    * resolve the *effective* (provider, model) for a given agent so an
      agent page can show a small "Will run on X (admin override)" pill
      when the calling user has a per-agent override set (``/effective``).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core import user_auth
from routers.deps import get_current_user, get_orchestrator

router = APIRouter()


class SwitchRequest(BaseModel):
    """Payload for switching the LLM provider.

    ``model`` is optional — when omitted the orchestrator uses the
    provider's default model (the first entry in its catalog). This
    keeps the legacy single-provider switch payload working.
    """

    provider: str
    model: str | None = None


@router.get("/providers")
async def list_providers(_user=Depends(get_current_user)):
    """Return every configured provider, its full model catalog, and the
    currently-active (provider, model) pair."""
    orch = get_orchestrator()
    return {
        "providers": orch.available_providers(),
        "active": orch.active_selection(),
    }


@router.post("/switch")
async def switch_provider(body: SwitchRequest, _user=Depends(get_current_user)):
    """Switch the global active (provider, model) at runtime.

    Refuses unknown providers / models with a clean 400 listing the
    configured catalog so the client can render a helpful toast.
    """
    orch = get_orchestrator()
    if not orch.switch_active(body.provider, body.model):
        catalog = orch.available_providers()
        configured = [
            {"provider": p["provider"], "models": p.get("models", [])}
            for p in catalog
        ]
        raise HTTPException(
            400,
            f"Provider '{body.provider}' or model '{body.model or '(default)'}' "
            f"is not configured. Available: {configured}. "
            "Set the API key in backend/.env or pick from the listed models.",
        )
    return {
        "active": orch.active_selection(),
        "providers": orch.available_providers(),
    }


@router.get("/effective")
async def get_effective_model(
    agent_name: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Resolve which (provider, model) *agent_name* will run on for *user*.

    ``source`` tells the UI whether the answer comes from the global
    Sidebar selection (``"global"``) or from a per-agent admin override
    (``"override"``); the agent page uses this to decide whether to
    show the small "admin override" pill next to the engine name.
    """
    orch = get_orchestrator()
    active = orch.active_selection()
    override = None
    if agent_name and user.get("username"):
        override = user_auth.get_user_model_override(user["username"], agent_name)
    if override:
        return {
            "agent_name": agent_name,
            "provider": override["provider"],
            "model": override["model"],
            "source": "override",
        }
    return {
        "agent_name": agent_name,
        "provider": active.get("provider", ""),
        "model": active.get("model", ""),
        "source": "global",
    }
