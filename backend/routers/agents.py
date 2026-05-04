"""Agent execution routes with SSE streaming support.

Both ``/run`` (blocking JSON) and ``/stream`` (Server-Sent Events) endpoints
execute the synchronous orchestrator inside a thread pool so they never block
Uvicorn's single-threaded event loop — concurrent users get responsive APIs
while long LLM calls are in flight.

Per-user agent visibility is enforced here too: when the calling user has
an ``agent_access`` allow-list configured by an admin, any request for an
agent outside that list returns 403. The frontend hides those nav items
already, but server-side enforcement protects against direct URL hits and
forged requests.
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


def _ensure_agent_access(user: dict, agent_name: str) -> None:
    """Raise 403 when *user* has an allow-list that excludes *agent_name*.

    ``agent_access`` semantics:
        * ``None`` (default for new users) — no restriction; user sees
          every enabled agent.
        * ``[]`` — explicit empty list = no agents allowed.
        * ``["agent_a", "agent_b", ...]`` — only those agents allowed.

    Admins bypass the check so they can sanity-test agents they have
    not added to their own allow-list (their job is to manage access
    for everyone else).
    """
    if user.get("is_admin"):
        return
    access = user.get("agent_access")
    if access is None:
        return  # no allow-list = full access
    if agent_name not in access:
        raise HTTPException(
            403,
            f"Your account is not permitted to use the '{agent_name}' agent. "
            "Ask an administrator to grant access from the admin panel.",
        )

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
    # Optional, per-request override of the system prompt. Used by the
    # Test Case Development "Customize prompt" toggle. Capped server-side
    # in the orchestrator (see ``_build_messages``). The default prompt
    # in ``backend/core/prompts/prompts.py`` is never modified.
    system_prompt_override: str | None = None


@router.get("/{agent_name}/prompt")
async def get_agent_prompt(
    agent_name: str,
    qa_mode: str = "salesforce",
    user=Depends(get_current_user),
):
    """Return the raw default system prompt for *agent_name* in the given QA mode.

    The frontend uses this so it can show the user the default prompt
    (read-only) and pre-fill the customise textarea. We deliberately
    return the raw string with no project-scope substitution so the
    user sees exactly what ships with the app.

    ``qa_mode`` accepts ``"salesforce"`` (default) or ``"general"`` and
    selects between ``PROMPTS_SF`` and ``PROMPTS_GEN`` so each mode can
    be customised independently in the UI.
    """
    from core.prompts.prompts import PROMPTS_GEN, PROMPTS_SF

    mode = "general" if str(qa_mode).strip().lower() == "general" else "salesforce"
    src = PROMPTS_GEN if mode == "general" else PROMPTS_SF
    if agent_name not in src:
        raise HTTPException(404, f"Unknown agent: {agent_name}")
    return {"agent": agent_name, "qa_mode": mode, "prompt": src[agent_name]}


@router.post("/{agent_name}/run")
async def run_agent(
    agent_name: str, body: AgentRequest, user=Depends(get_current_user)
):
    """Run an agent end-to-end and return the full result.

    The synchronous orchestrator is executed in a threadpool so the event
    loop remains free for other requests (health checks, SSE heartbeats,
    parallel agent calls, etc.) while the LLM is working.

    Response shape: ``{result, agent, provider, model, cached, usage}``.
    ``usage`` is a ``{prompt_tokens, completion_tokens, total_tokens,
    source}`` envelope (``source`` ∈ {"live","estimated","cached"}).
    Each request gets its own ``usage_box`` so concurrent runs don't
    collide on a shared singleton.
    """
    _ensure_agent_access(user, agent_name)
    orch = get_orchestrator()
    orch.set_project(body.project_slug)
    usage_box: dict = {}
    try:
        result = await run_in_threadpool(
            orch.run_agent,
            agent_name,
            body.user_input,
            body.system_prompt_override,
            user.get("username"),
            usage_box=usage_box,
        )
    except KeyError:
        raise HTTPException(400, f"Unknown agent: {agent_name}")
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    return {
        "result": result,
        "agent": agent_name,
        "provider": usage_box.get("provider"),
        "model": usage_box.get("model"),
        "cached": usage_box.get("cached", False),
        # ``repaired`` is True when the orchestrator's auto-repair
        # pass kicked in (validator on the original output failed and
        # we re-ran with a strict format clamp). Frontend renders an
        # "Auto-repaired" chip so users understand why their token
        # count is higher than usual on this particular run.
        "repaired": usage_box.get("repaired", False),
        "usage": usage_box.get("usage"),
    }


@router.post("/{agent_name}/stream")
async def stream_agent(
    agent_name: str, body: AgentRequest, user=Depends(get_current_user)
):
    """Stream agent output as Server-Sent Events.

    A background thread pulls chunks from the sync iterator and feeds them
    through an ``asyncio.Queue`` so the event loop stays responsive while
    the LLM streams tokens.
    """
    _ensure_agent_access(user, agent_name)
    orch = get_orchestrator()
    orch.set_project(body.project_slug)
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    # Per-request mutable container the orchestrator fills in with the
    # resolved (provider, model, usage) tuple when the stream is done.
    # We then emit a terminal SSE 'usage' event so the frontend can
    # render the token chip on the report panel.
    usage_box: dict[str, Any] = {}

    def _producer() -> None:
        """Run the sync generator in a worker thread, push chunks to the queue."""
        try:
            for chunk in orch.stream_agent(
                agent_name,
                body.user_input,
                body.system_prompt_override,
                user.get("username"),
                usage_box=usage_box,
            ):
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {"event": "token", "data": json.dumps({"text": chunk})},
                )
            # Emit usage BEFORE done so the client can update the chip
            # while the "complete" event drives any post-stream UX
            # (confetti, history refresh, etc.). Only emit when at
            # least one of the resolution slots is populated — saves
            # a wasted SSE frame on early-error paths.
            if usage_box.get("provider"):
                loop.call_soon_threadsafe(
                    queue.put_nowait,
                    {
                        "event": "usage",
                        "data": json.dumps({
                            "provider": usage_box.get("provider"),
                            "model": usage_box.get("model"),
                            "cached": bool(usage_box.get("cached", False)),
                            # Frontend renders an "Auto-repaired" chip
                            # when this is True (orchestrator ran a
                            # second LLM call to fix format drift).
                            "repaired": bool(usage_box.get("repaired", False)),
                            "usage": usage_box.get("usage"),
                        }),
                    },
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
