"""LLM provider listing and switching routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from routers.deps import get_current_user, get_orchestrator

router = APIRouter()


class SwitchRequest(BaseModel):
    """Payload for switching the LLM provider."""

    provider: str


@router.get("/providers")
async def list_providers(user=Depends(get_current_user)):
    """Return all configured LLM providers and their models."""
    orch = get_orchestrator()
    return {"providers": orch.available_providers()}


@router.post("/switch")
async def switch_provider(body: SwitchRequest, user=Depends(get_current_user)):
    """Switch the active LLM provider at runtime."""
    orch = get_orchestrator()
    if not orch.switch_provider(body.provider):
        configured = [p["provider"] for p in orch.available_providers()]
        raise HTTPException(
            400,
            f"Provider '{body.provider}' is not configured. "
            f"Available: {configured}. Set the API key in backend/.env.",
        )
    return {
        "active": body.provider,
        "model": orch.model_name,
        "providers": orch.available_providers(),
    }
