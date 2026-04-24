"""Per-project MCP server CRUD + connection-test endpoints.

These routes are mounted under `/api/projects/{slug}/mcp` so the URL
shape mirrors the existing project document and index endpoints. Every
mutating call goes through `_require_project_access` so only the project
owner or an explicitly-shared user can change which MCP servers feed the
RAG layer for that project.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config import settings
from core import mcp_client, project_manager as pm
from routers.deps import get_current_user

router = APIRouter()


def _require_project_access(slug: str, username: str) -> dict:
    """Mirror of routers.projects._require_project_access.

    Inlined rather than imported to avoid a circular import between the
    two router modules; both keep the same semantics.
    """
    meta = pm.get_metadata(slug)
    if meta is None:
        raise HTTPException(404, "Project not found")
    if "owner" not in meta:
        return meta
    if meta.get("owner") == username or username in (meta.get("shared_with") or []):
        return meta
    raise HTTPException(403, "You do not have access to this project")


class McpServerPayload(BaseModel):
    """Body for POST /servers and PATCH /servers/{id}.

    `headers` is `{header_name: header_value}` — used by the SSE client
    for auth (e.g. `{"Authorization": "Bearer ..."}`). `enabled=False`
    keeps the row but skips it from RAG fetches.
    """

    name: str = Field(default="", max_length=200)
    url: str = Field(default="", max_length=2048)
    headers: dict[str, str] | None = None
    enabled: bool | None = None


@router.get("/{slug}/mcp/servers")
async def list_servers(slug: str, user=Depends(get_current_user)):
    """Return every configured MCP server for the project."""
    _require_project_access(slug, user["username"])
    return {"servers": pm.list_mcp_servers(slug)}


@router.post("/{slug}/mcp/servers")
async def add_server(
    slug: str,
    body: McpServerPayload,
    user=Depends(get_current_user),
):
    """Add a new MCP SSE server. URL is required; everything else is optional."""
    _require_project_access(slug, user["username"])
    if not body.url.strip():
        raise HTTPException(422, "MCP server requires a non-empty URL")
    try:
        server = pm.add_mcp_server(
            slug,
            {
                "name": body.name or body.url,
                "url": body.url,
                "headers": body.headers or {},
                "enabled": True if body.enabled is None else body.enabled,
            },
            created_by=user["username"],
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return {"server": server}


@router.patch("/{slug}/mcp/servers/{server_id}")
async def patch_server(
    slug: str,
    server_id: str,
    body: McpServerPayload,
    user=Depends(get_current_user),
):
    """Toggle enabled, rename, or replace headers on an existing server."""
    _require_project_access(slug, user["username"])
    payload: dict = {}
    if body.name: payload["name"] = body.name
    if body.url: payload["url"] = body.url
    if body.headers is not None: payload["headers"] = body.headers
    if body.enabled is not None: payload["enabled"] = body.enabled
    if not payload:
        raise HTTPException(422, "No fields to update")
    server = pm.update_mcp_server(slug, server_id, payload)
    if server is None:
        raise HTTPException(404, "MCP server not found")
    return {"server": server}


@router.delete("/{slug}/mcp/servers/{server_id}")
async def delete_server(slug: str, server_id: str, user=Depends(get_current_user)):
    """Remove a server config and drop its cached resources."""
    _require_project_access(slug, user["username"])
    if not pm.delete_mcp_server(slug, server_id):
        raise HTTPException(404, "MCP server not found")
    return {"ok": True}


@router.post("/{slug}/mcp/servers/{server_id}/test")
async def test_server(slug: str, server_id: str, user=Depends(get_current_user)):
    """Probe an MCP server: returns reachability + first few resource URIs.

    Used by the project settings UI's "Test connection" button. Caps the
    network budget at MCP_REQUEST_TIMEOUT_SEC so a wedged server never
    holds up the request thread.
    """
    _require_project_access(slug, user["username"])
    server = pm.get_mcp_server(slug, server_id)
    if server is None:
        raise HTTPException(404, "MCP server not found")
    timeout = float(settings.MCP_REQUEST_TIMEOUT_SEC or 10.0)
    try:
        result = await asyncio.wait_for(
            mcp_client.test_connection(
                server.get("url", ""),
                server.get("headers") or {},
                timeout=timeout,
            ),
            timeout=timeout + 5.0,
        )
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"Timed out after {timeout}s"}
    return result
