"""Disk-backed memoization cache for LLM agent outputs.

Why cache?
----------
Users explicitly want **identical INPUT to produce identical OUTPUT**.
Even with ``temperature=0`` and a fixed ``seed`` Gemini still has
small sources of variance (model-server scheduling, mixture-of-experts
routing, fallback chain choosing a different model on retry, etc.).
Memoising on a stable key gives a hard guarantee: as long as the user
hasn't changed the agent input, the prompt, or the project scope,
they see the same artifact byte-for-byte.

Cache key
---------
SHA-256 over a canonical JSON blob of:

    {
        "agent": <slug>,
        "qa_mode": "salesforce" | "general",
        "project": <project_slug or "">,
        "input":  <user_input dict, sorted-keys>,
        "system_prompt": <effective_system_prompt>,
        "provider": <provider name>,   # e.g. "gemini" / "openai"
        "model":    <model id>,        # e.g. "gpt-4o" / "claude-..."
    }

We deliberately do NOT include the RAG context blob in the key — for
identical (project, input) the retriever returns the same context, so
mixing it in would just be noise. We also do NOT include the username
in the key directly: per-user prompt overrides already mutate the
``system_prompt`` field, which is in the key.

``provider`` and ``model`` are part of the key so swapping models
(globally via the Sidebar dropdown, or per-agent via the admin model
overrides) does NOT collide with cached output from a different
backend — different model, different output, different key.

Invariants
----------
- Cache is best-effort: a corrupt / missing file is silently rebuilt.
- FIFO eviction once ``max_entries`` is exceeded so the file size stays
  bounded for long-lived deployments.
- Atomic writes (temp file + rename) so a crash mid-write doesn't
  leave a half-written JSON.
- Concurrent multi-worker writes can race; the worst that happens is
  one entry overwrites another. The cache is non-critical so we do
  not take a file lock.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_FILE = _DATA_DIR / "llm_cache.json"


def _stable_dump(value: Any) -> str:
    """JSON-serialise *value* with sorted keys for stable hashing."""
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def make_key(
    agent: str,
    qa_mode: str,
    project: str | None,
    user_input: dict[str, Any],
    system_prompt: str,
    *,
    provider: str = "",
    model: str = "",
) -> str:
    """Return a stable SHA-256 hex digest of the canonical request shape.

    ``provider`` and ``model`` are keyword-only so legacy callers that
    don't yet pass them keep working. Adding these fields changes the
    canonical JSON shape, so existing cache entries created before the
    multi-provider rollout will become orphaned (a one-time cold
    cache); this is intentional — cached output from one model should
    never replay for a request that's now routed to a different one.
    """
    payload = {
        "agent": agent,
        "qa_mode": "general" if str(qa_mode or "").strip().lower() == "general" else "salesforce",
        "project": project or "",
        "input": user_input or {},
        "system_prompt": system_prompt or "",
        "provider": str(provider or ""),
        "model": str(model or ""),
    }
    blob = _stable_dump(payload).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


class LLMResponseCache:
    """JSON-file-backed FIFO cache of (key -> output, model, ts, agent)."""

    def __init__(self, *, max_entries: int = 1000, path: Path | None = None) -> None:
        self.max_entries = max(1, int(max_entries))
        self.path = path or _FILE
        self._lock = threading.Lock()
        # In-memory mirror so reads never re-parse the JSON file.
        self._store: dict[str, dict[str, Any]] = self._load()

    # -- public --

    def get(self, key: str) -> str | None:
        """Return the cached output for *key* or None if absent."""
        with self._lock:
            entry = self._store.get(key)
            return entry.get("output") if entry else None

    def get_full(self, key: str) -> dict[str, Any] | None:
        """Return the full cached entry (output + usage + metadata).

        Used by the orchestrator on cache-hit so the SSE 'usage' event
        replays whatever token counts the original generation produced
        — same generation → same UI badge — instead of forcing a fresh
        '0 / 0 / 0 cached' fallback every time.
        """
        with self._lock:
            entry = self._store.get(key)
            return dict(entry) if entry else None

    def set(
        self, key: str, *, output: str, agent: str, model: str,
        usage: dict[str, Any] | None = None,
    ) -> None:
        """Store / overwrite *key* with the given output and metadata.

        ``usage`` is the canonical token-usage envelope produced by the
        provider adapter. Stored verbatim so cache hits return the same
        token chip the user saw on the original (uncached) run.
        """
        record: dict[str, Any] = {
            "output": output,
            "agent": agent,
            "model": model,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        if usage is not None:
            record["usage"] = usage
        with self._lock:
            self._store[key] = record
            self._evict_if_needed()
            self._save()

    def invalidate(self, key: str) -> None:
        """Remove a single entry (used by tests / manual flush)."""
        with self._lock:
            if key in self._store:
                self._store.pop(key, None)
                self._save()

    def clear(self) -> None:
        """Drop every entry (admin-flush use case)."""
        with self._lock:
            self._store = {}
            self._save()

    def __len__(self) -> int:  # pragma: no cover - debugging only
        with self._lock:
            return len(self._store)

    # -- internal --

    def _load(self) -> dict[str, dict[str, Any]]:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            return {}
        if not self.path.is_file():
            return {}
        try:
            data = json.loads(self.path.read_text("utf-8"))
            if isinstance(data, dict):
                return data
        except (json.JSONDecodeError, OSError):
            pass
        return {}

    def _save(self) -> None:
        """Atomically persist the in-memory mirror to disk."""
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps(self._store, ensure_ascii=False), encoding="utf-8",
            )
            os.replace(tmp, self.path)
        except OSError:
            # Cache is best-effort; ignore disk write failures.
            pass

    def _evict_if_needed(self) -> None:
        """FIFO eviction once the store grows beyond ``max_entries``."""
        if len(self._store) <= self.max_entries:
            return
        # Sort by timestamp (oldest first), then drop the excess.
        ordered = sorted(
            self._store.items(),
            key=lambda kv: kv[1].get("ts", ""),
        )
        excess = len(self._store) - self.max_entries
        for k, _ in ordered[:excess]:
            self._store.pop(k, None)
