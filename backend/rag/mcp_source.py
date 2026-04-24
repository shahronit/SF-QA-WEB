"""Per-project MCP-resource fetcher used as an extra RAG context source.

`MCPSource(slug).fetch(query, k=…)` returns a list of LangChain
`Document` objects assembled from every enabled MCP server configured on
the project. Results are cached for `MCP_CACHE_TTL_SEC` so back-to-back
agent runs against the same project don't hammer external servers, and
each network call is bounded by `MCP_REQUEST_TIMEOUT_SEC`.

Failures are intentionally soft — `fetch` logs and returns an empty list
on any exception. The orchestrator treats MCP context as additive: a
flaky MCP server must never block an agent run.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import settings
from core import mcp_client

logger = logging.getLogger(__name__)

# Cache key: (project_slug, server_url). Value: (epoch_inserted, [Document]).
# Module-level so it survives across requests in the same Uvicorn worker.
_CACHE: dict[tuple[str, str], tuple[float, list[Document]]] = {}


@dataclass
class _ServerSpec:
    id: str
    name: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    enabled: bool = True


def _splitter() -> RecursiveCharacterTextSplitter:
    # Match `ingestor.py` so MCP chunks behave like file-backed chunks
    # for the LLM (similar window, similar overlap).
    return RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)


async def _gather_one(spec: _ServerSpec) -> list[Document]:
    """Fetch every resource on a single MCP server and chunk into Documents."""
    timeout = float(settings.MCP_REQUEST_TIMEOUT_SEC or 10.0)
    try:
        resources = await mcp_client.list_resources(spec.url, spec.headers, timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        logger.warning("MCP %s (%s): list_resources failed: %s", spec.name, spec.url, exc)
        return []

    splitter = _splitter()
    docs: list[Document] = []
    # Read resources sequentially per-server. Most MCP servers can't
    # cope with parallel SSE reads, and serial keeps `timeout` bounded
    # to a sane per-resource budget.
    for r in resources:
        uri = r.get("uri")
        if not uri:
            continue
        try:
            text = await mcp_client.read_resource(spec.url, spec.headers, uri, timeout=timeout)
        except Exception as exc:  # noqa: BLE001
            logger.warning("MCP %s: read_resource(%s) failed: %s", spec.name, uri, exc)
            continue
        text = (text or "").strip()
        if not text:
            continue
        meta_base = {
            "source": f"mcp://{spec.name}/{uri}",
            "mcp_server": spec.name,
            "mcp_uri": uri,
            "mcp_resource_name": r.get("name") or uri,
        }
        for chunk in splitter.split_text(text):
            docs.append(Document(page_content=chunk, metadata=dict(meta_base)))
    return docs


class MCPSource:
    """Per-project MCP fetcher, cached across calls."""

    def __init__(self, slug: str) -> None:
        self.slug = slug

    def _server_specs(self) -> list[_ServerSpec]:
        # Imported lazily to avoid a circular import: project_manager
        # already depends on rag/embedder via build_index, and we don't
        # want to drag the embeddings module into every MCP fetch.
        try:
            from core import project_manager as pm
        except Exception as exc:  # noqa: BLE001
            logger.warning("MCPSource: project_manager unavailable: %s", exc)
            return []
        try:
            raw = pm.list_mcp_servers(self.slug)
        except Exception as exc:  # noqa: BLE001
            logger.warning("MCPSource(%s): list_mcp_servers failed: %s", self.slug, exc)
            return []
        out: list[_ServerSpec] = []
        for entry in raw or []:
            if not entry.get("enabled", True):
                continue
            url = (entry.get("url") or "").strip()
            if not url:
                continue
            out.append(_ServerSpec(
                id=str(entry.get("id") or ""),
                name=str(entry.get("name") or url),
                url=url,
                headers=dict(entry.get("headers") or {}),
                enabled=True,
            ))
        return out

    async def _fetch_async(self) -> list[Document]:
        specs = self._server_specs()
        if not specs:
            return []
        ttl = float(settings.MCP_CACHE_TTL_SEC or 120.0)
        now = time.time()

        # Per-server cache so toggling one server on doesn't expire the
        # cache for unrelated, still-fresh servers.
        all_docs: list[Document] = []
        to_fetch: list[_ServerSpec] = []
        for spec in specs:
            ck = (self.slug, spec.url)
            cached = _CACHE.get(ck)
            if cached and now - cached[0] < ttl:
                all_docs.extend(cached[1])
            else:
                to_fetch.append(spec)

        if to_fetch:
            results = await asyncio.gather(
                *[_gather_one(spec) for spec in to_fetch],
                return_exceptions=True,
            )
            for spec, res in zip(to_fetch, results):
                if isinstance(res, Exception):
                    logger.warning("MCPSource(%s): %s failed: %s", self.slug, spec.name, res)
                    _CACHE[(self.slug, spec.url)] = (now, [])
                    continue
                _CACHE[(self.slug, spec.url)] = (now, res)
                all_docs.extend(res)
        return all_docs

    def fetch(self, query: str, k: int = 5) -> list[Document]:
        """Synchronous facade so callers in sync code (orchestrator) can use it.

        We don't actually do similarity search here — we return up to *k*
        chunks per server. The orchestrator already pairs MCP context
        with the local Chroma top-K, so what matters is bounded volume,
        not relevance ranking. If MCP servers grow large enough that
        per-server top-K starts to bite, we can plug them through the
        same embeddings model used by the project store.
        """
        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop and loop.is_running():
                # Called from inside an event loop (e.g. FastAPI handler).
                # Shouldn't happen in our orchestrator path which is sync,
                # but guard so we don't deadlock.
                future = asyncio.run_coroutine_threadsafe(self._fetch_async(), loop)
                docs = future.result(timeout=float(settings.MCP_REQUEST_TIMEOUT_SEC or 10.0) * 4)
            else:
                docs = asyncio.run(self._fetch_async())
        except Exception as exc:  # noqa: BLE001
            logger.warning("MCPSource.fetch(%s) failed: %s", self.slug, exc)
            return []

        # Naive top-k: keep the first k chunks per server so context size
        # stays bounded irrespective of how many resources a server lists.
        if k <= 0:
            return docs
        per_server: dict[str, int] = {}
        out: list[Document] = []
        for d in docs:
            srv = d.metadata.get("mcp_server", "?")
            if per_server.get(srv, 0) >= k:
                continue
            per_server[srv] = per_server.get(srv, 0) + 1
            out.append(d)
        # Suppress unused arg lint when callers don't pass query yet.
        _ = query
        return out


def invalidate_cache(slug: str | None = None, url: str | None = None) -> None:
    """Drop cached MCP results so the next fetch re-queries upstream.

    Called by the project_manager / mcp router when a server is added,
    edited, or deleted so the agent UI immediately reflects the change.
    """
    if slug is None and url is None:
        _CACHE.clear()
        return
    keys = list(_CACHE.keys())
    for k in keys:
        if slug is not None and k[0] != slug:
            continue
        if url is not None and k[1] != url:
            continue
        _CACHE.pop(k, None)
