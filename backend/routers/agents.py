"""Agent execution routes with SSE streaming support.

Both ``/run`` (blocking JSON) and ``/stream`` (Server-Sent Events) endpoints
execute the synchronous orchestrator inside a thread pool so they never block
Uvicorn's single-threaded event loop — concurrent users get responsive APIs
while long LLM calls are in flight.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.concurrency import run_in_threadpool

from routers.deps import get_current_user, get_orchestrator

router = APIRouter()

# SSE headers that prevent buffering by proxies/browsers so tokens arrive live.
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


class AgentRequest(BaseModel):
    """Payload for running an agent."""

    user_input: dict
    project_slug: str | None = None


@router.post("/{agent_name}/run")
async def run_agent(
    agent_name: str, body: AgentRequest, user=Depends(get_current_user)
):
    """Run an agent end-to-end and return the full result.

    The synchronous orchestrator is executed in a threadpool so the event
    loop remains free for other requests (health checks, SSE heartbeats,
    parallel agent calls, etc.) while the LLM is working.
    """
    orch = get_orchestrator()
    orch.set_project(body.project_slug)
    try:
        result = await run_in_threadpool(orch.run_agent, agent_name, body.user_input)
    except KeyError:
        raise HTTPException(400, f"Unknown agent: {agent_name}")
    return {"result": result, "agent": agent_name}


@router.post("/{agent_name}/stream")
async def stream_agent(
    agent_name: str, body: AgentRequest, user=Depends(get_current_user)
):
    """Stream agent output as Server-Sent Events.

    A background thread pulls chunks from the sync iterator and feeds them
    through an ``asyncio.Queue`` so the event loop stays responsive while
    the LLM streams tokens.
    """
    orch = get_orchestrator()
    orch.set_project(body.project_slug)
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def _producer() -> None:
        """Run the sync generator in a worker thread, push chunks to the queue."""
        try:
            for chunk in orch.stream_agent(agent_name, body.user_input):
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"event": "token", "data": json.dumps({"text": chunk})},
                )
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"event": "done", "data": json.dumps({"status": "complete"})},
            )
        except Exception as exc:  # noqa: BLE001
            loop.call_soon_threadsafe(
                queue.put_nowait,
                {"event": "error", "data": json.dumps({"error": str(exc)})},
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    async def event_generator():
        """Drain the queue and yield SSE events to the client."""
        # Launch the producer without awaiting it so streaming starts immediately.
        asyncio.create_task(run_in_threadpool(_producer))
        while True:
            item = await queue.get()
            if item is None:
                return
            yield item

    return EventSourceResponse(event_generator(), headers=_SSE_HEADERS)
