"""Thin async wrapper around the official `mcp` Python SDK.

We only support the SSE transport on purpose. Stdio servers would require
us to spawn arbitrary local commands as configured by end-users, which
turns "add MCP server" into "remote code execution by config" — a non-
starter for a multi-tenant web app. SSE keeps everything HTTP and means
operators only have to reason about outbound network traffic.

The public API is:

    async def list_resources(url, headers, timeout) -> list[dict]
    async def read_resource(url, headers, uri, timeout) -> str
    async def test_connection(url, headers, timeout) -> dict

Each helper opens a fresh ClientSession, runs one operation, and tears it
down. That's intentionally chatty (each call pays the SSE handshake)
because MCPSource caches results upstream — the cost lives once per
cache miss, not per agent prompt token.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


def _coerce_text(content: Any) -> str:
    """Best-effort flatten of an MCP `Content` payload to a plain string.

    The SDK returns either a list of `TextContent`/`ImageContent` (each
    with a `.text` / `.data` attr) or a bare string depending on the
    server. We stringify the text-bearing ones and skip binaries since
    the RAG layer only consumes text.
    """
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out: list[str] = []
        for item in content:
            text = getattr(item, "text", None)
            if text:
                out.append(str(text))
                continue
            # Fallback: some servers return dict-shaped content blocks.
            if isinstance(item, dict) and item.get("text"):
                out.append(str(item["text"]))
        return "\n\n".join(out)
    text = getattr(content, "text", None)
    if text:
        return str(text)
    return ""


async def _open_session(url: str, headers: dict[str, str] | None):
    """Yield a fresh `(read, write, ClientSession)` for one operation.

    Returns an async-context-manager triple so callers can `async with`
    the session. We import lazily so the rest of the backend keeps
    booting even if the optional `mcp` dependency isn't installed yet
    (the install step ships in `pip install -r requirements.txt`).
    """
    from mcp import ClientSession
    from mcp.client.sse import sse_client

    return sse_client(url, headers=headers or {}), ClientSession


async def list_resources(
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> list[dict[str, Any]]:
    """Connect to *url* (SSE) and return the server's resource catalog.

    Each entry is `{uri, name, description, mimeType}` so the caller
    (frontend test panel, RAG fetcher) can enumerate without binding to
    the SDK's internal types. Wrapped in `asyncio.wait_for` so a stuck
    server raises `asyncio.TimeoutError` rather than hanging the request.
    """
    sse_cm, ClientSession = await _open_session(url, headers)
    try:
        async with asyncio.timeout(timeout):
            async with sse_cm as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.list_resources()
                    out: list[dict[str, Any]] = []
                    for r in getattr(result, "resources", []) or []:
                        out.append({
                            "uri": str(getattr(r, "uri", "") or ""),
                            "name": getattr(r, "name", "") or "",
                            "description": getattr(r, "description", "") or "",
                            "mime_type": getattr(r, "mimeType", "") or "",
                        })
                    return out
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP list_resources(%s) failed: %s", url, exc)
        raise


async def read_resource(
    url: str,
    headers: dict[str, str] | None,
    uri: str,
    timeout: float = 10.0,
) -> str:
    """Read the body of *uri* from the MCP server at *url* as plain text."""
    sse_cm, ClientSession = await _open_session(url, headers)
    try:
        async with asyncio.timeout(timeout):
            async with sse_cm as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    result = await session.read_resource(uri)
                    contents = getattr(result, "contents", None)
                    if isinstance(contents, list):
                        # Each content block can have its own .text /
                        # .blob; we concatenate the text ones.
                        return "\n\n".join(
                            _coerce_text([c]) for c in contents
                        ).strip()
                    return _coerce_text(contents)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP read_resource(%s, %s) failed: %s", url, uri, exc)
        raise


async def test_connection(
    url: str,
    headers: dict[str, str] | None = None,
    timeout: float = 10.0,
) -> dict[str, Any]:
    """Return `{ok, server_name, resource_count, sample}` for an MCP URL.

    `sample` is the first few resource URIs so the UI can show a quick
    proof that the server is alive and reachable from our network.
    Failures are wrapped to `{ok: False, error: str}` so router code can
    pass the dict straight back to the user without bespoke exception
    plumbing.
    """
    try:
        resources = await list_resources(url, headers, timeout=timeout)
        return {
            "ok": True,
            "resource_count": len(resources),
            "sample": [r["uri"] for r in resources[:5]],
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}
