"""Admin-managed default prompts (overrides the in-code PROMPTS dicts).

Storage strategy mirrors ``user_auth``: Firestore when ``STORAGE_BACKEND``
is ``firestore`` and a local JSON file (``backend/data/agent_prompt_defaults.json``)
otherwise. Document IDs are ``{agent}__{qa_mode}`` so the admin can edit
the Salesforce and General defaults independently for the same agent.

Resolution order (used by ``orchestrator._build_messages``):

    1. per-request ``system_prompt_override`` from the API caller
    2. per-user override (``users/{username}.prompt_overrides[agent][mode]``)
    3. global admin default written here
    4. baked-in default in ``backend/core/prompts/prompts.py``

Admins write/clear via ``set_default()``; the orchestrator only reads
via ``get_default()``. Empty / blank prompts are treated as "no
override" so the in-code default still wins after a clear.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core import firestore_db

_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_FILE = _DATA_DIR / "agent_prompt_defaults.json"

_COLLECTION = "agent_prompt_defaults"


def _doc_id(agent: str, qa_mode: str) -> str:
    """Return the canonical document key for (agent, qa_mode)."""
    mode = "general" if str(qa_mode or "").strip().lower() == "general" else "salesforce"
    return f"{agent}__{mode}"


# ---------------------------------------------------------------------------
# Local JSON fallback
# ---------------------------------------------------------------------------

def _local_load() -> dict[str, dict]:
    """Read the local JSON store, returning {} on missing/invalid file."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not _FILE.is_file():
        return {}
    try:
        return json.loads(_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _local_save(store: dict[str, dict]) -> None:
    """Persist the local JSON store."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    _FILE.write_text(json.dumps(store, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_default(agent: str, qa_mode: str) -> str | None:
    """Return the admin-set default for (agent, qa_mode) or None.

    Empty/blank stored prompts are treated as "no override" so the
    in-code default still wins (avoids the surprise where saving an
    empty prompt accidentally silences the agent).
    """
    doc_id = _doc_id(agent, qa_mode)
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            snap = db.collection(_COLLECTION).document(doc_id).get()
            if not snap.exists:
                return None
            doc = snap.to_dict() or {}
            val = doc.get("prompt") or ""
            return val if val.strip() else None
        except Exception:
            return None
    store = _local_load()
    val = (store.get(doc_id) or {}).get("prompt") or ""
    return val if val.strip() else None


def list_defaults() -> dict[str, dict[str, Any]]:
    """Return ``{doc_id: {agent, qa_mode, prompt, updated_*}}`` for all keys."""
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            return {d.id: (d.to_dict() or {}) for d in db.collection(_COLLECTION).stream()}
        except Exception:
            return {}
    return _local_load()


def set_default(
    agent: str, qa_mode: str, prompt: str | None, updated_by: str | None = None,
) -> None:
    """Write or clear the admin default for (agent, qa_mode).

    Passing ``None`` or an empty/whitespace string deletes the document
    (Firestore) or removes the key (local) so subsequent reads fall
    back to the in-code default.
    """
    doc_id = _doc_id(agent, qa_mode)
    mode = "general" if str(qa_mode or "").strip().lower() == "general" else "salesforce"
    if not prompt or not str(prompt).strip():
        if firestore_db.is_enabled():
            try:
                db = firestore_db.get_db()
                db.collection(_COLLECTION).document(doc_id).delete()
            except Exception:
                pass
            return
        store = _local_load()
        store.pop(doc_id, None)
        _local_save(store)
        return

    record = {
        "agent": agent,
        "qa_mode": mode,
        "prompt": str(prompt),
        "updated_by": updated_by or "",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(_COLLECTION).document(doc_id).set(record)
        except Exception:
            pass
        return
    store = _local_load()
    store[doc_id] = record
    _local_save(store)
