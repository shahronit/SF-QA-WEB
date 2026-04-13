"""Agent execution routes with SSE streaming support."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from routers.deps import get_current_user, get_orchestrator

router = APIRouter()


class AgentRequest(BaseModel):
    """Payload for running an agent."""

    user_input: dict
    project_slug: str | None = None


@router.post("/{agent_name}/run")
async def run_agent(
    agent_name: str, body: AgentRequest, user=Depends(get_current_user)
):
    """Run an agent synchronously and return the full result."""
    orch = get_orchestrator()
    orch.set_project(body.project_slug)
    try:
        result = orch.run_agent(agent_name, body.user_input)
    except KeyError:
        raise HTTPException(400, f"Unknown agent: {agent_name}")
    return {"result": result, "agent": agent_name}


@router.post("/{agent_name}/stream")
async def stream_agent(
    agent_name: str, body: AgentRequest, user=Depends(get_current_user)
):
    """Stream agent output as Server-Sent Events."""
    orch = get_orchestrator()
    orch.set_project(body.project_slug)

    async def event_generator():
        """Yield SSE events from the synchronous streaming iterator."""
        try:
            for chunk in orch.stream_agent(agent_name, body.user_input):
                yield {"event": "token", "data": json.dumps({"text": chunk})}
            yield {"event": "done", "data": json.dumps({"status": "complete"})}
        except Exception as e:
            yield {"event": "error", "data": json.dumps({"error": str(e)})}

    return EventSourceResponse(event_generator())
