"""Project CRUD, document storage, and per-project vector-store management."""

from __future__ import annotations

import gc
import json
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rag.embedder import SalesforceVectorStore
from rag.ingestor import SalesforceKnowledgeIngestor

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECTS_DIR = PROJECT_ROOT / "projects"
PROJECT_STORES_DIR = PROJECT_ROOT / "rag" / "project_stores"


def _slugify(name: str) -> str:
    """Turn a human project name into a filesystem-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return slug or "project"


def _meta_path(slug: str) -> Path:
    """Return the path to a project's metadata.json."""
    return PROJECTS_DIR / slug / "metadata.json"


def _docs_dir(slug: str) -> Path:
    """Return the path to a project's documents directory."""
    return PROJECTS_DIR / slug / "documents"


def _store_dir(slug: str) -> Path:
    """Return the path to a project's vector store directory."""
    return PROJECT_STORES_DIR / slug


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def list_projects(username: str | None = None) -> list[dict[str, Any]]:
    """Return metadata dicts visible to *username*.

    A project is visible when any of the following is true:
    - *username* is None (backward-compat / no auth mode)
    - the project has no ``owner`` field (legacy project — visible to all)
    - ``owner == username``
    - ``username in shared_with``
    """
    results: list[dict[str, Any]] = []
    if not PROJECTS_DIR.is_dir():
        return results
    for child in sorted(PROJECTS_DIR.iterdir()):
        mp = child / "metadata.json"
        if mp.is_file():
            try:
                meta = json.loads(mp.read_text("utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if username is None:
                results.append(meta)
            elif "owner" not in meta:
                results.append(meta)
            elif meta["owner"] == username or username in meta.get("shared_with", []):
                results.append(meta)
    return results


def create_project(name: str, description: str = "", owner: str = "") -> str:
    """Create folder structure + metadata.json; return the slug."""
    slug = _slugify(name)
    docs = _docs_dir(slug)
    docs.mkdir(parents=True, exist_ok=True)
    meta: dict[str, Any] = {
        "slug": slug,
        "name": name,
        "description": description,
        "created": datetime.now(timezone.utc).isoformat(),
        "owner": owner,
        "shared_with": [],
    }
    _meta_path(slug).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return slug


def delete_project(slug: str) -> None:
    """Remove the project folder and its vector store entirely.

    Retries up to 3 times with a short delay to handle lingering
    ChromaDB file locks on Windows.
    """
    gc.collect()
    for target in (PROJECTS_DIR / slug, _store_dir(slug)):
        if not target.is_dir():
            continue
        for attempt in range(3):
            try:
                shutil.rmtree(target)
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.5 * (attempt + 1))
        else:
            shutil.rmtree(target, ignore_errors=True)


def get_metadata(slug: str) -> dict[str, Any] | None:
    """Read project metadata or return None if missing."""
    mp = _meta_path(slug)
    if not mp.is_file():
        return None
    try:
        return json.loads(mp.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def is_owner(slug: str, username: str) -> bool:
    """True when *username* owns the project (or project has no owner)."""
    meta = get_metadata(slug)
    if meta is None:
        return False
    return meta.get("owner", "") == username or "owner" not in meta


def share_project(slug: str, target_username: str) -> bool:
    """Grant *target_username* access to the project. Returns True on change."""
    meta = get_metadata(slug)
    if meta is None:
        return False
    shared: list[str] = meta.get("shared_with", [])
    if target_username in shared:
        return False
    shared.append(target_username)
    meta["shared_with"] = shared
    _meta_path(slug).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return True


def unshare_project(slug: str, target_username: str) -> bool:
    """Revoke *target_username* access. Returns True on change."""
    meta = get_metadata(slug)
    if meta is None:
        return False
    shared: list[str] = meta.get("shared_with", [])
    if target_username not in shared:
        return False
    shared.remove(target_username)
    meta["shared_with"] = shared
    _meta_path(slug).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return True


def claim_ownership(slug: str, username: str) -> bool:
    """Set owner on a legacy project that has no owner yet."""
    meta = get_metadata(slug)
    if meta is None:
        return False
    if meta.get("owner"):
        return False
    meta["owner"] = username
    meta.setdefault("shared_with", [])
    _meta_path(slug).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return True


# ---------------------------------------------------------------------------
# Document management
# ---------------------------------------------------------------------------

def save_file(slug: str, filename: str, content: bytes) -> str:
    """Persist a raw file upload to the project's documents folder."""
    docs = _docs_dir(slug)
    docs.mkdir(parents=True, exist_ok=True)
    dest = docs / filename
    dest.write_bytes(content)
    return filename


def list_documents(slug: str) -> list[str]:
    """Return filenames inside the project's documents folder."""
    docs = _docs_dir(slug)
    if not docs.is_dir():
        return []
    return sorted(p.name for p in docs.iterdir() if p.is_file())


def delete_document(slug: str, filename: str) -> None:
    """Remove a single document file from the project."""
    target = _docs_dir(slug) / filename
    if target.is_file():
        target.unlink()


# ---------------------------------------------------------------------------
# Per-project RAG index
# ---------------------------------------------------------------------------

def build_project_index(slug: str) -> int:
    """Ingest project documents into a dedicated ChromaDB store. Returns chunk count."""
    docs_path = _docs_dir(slug)
    ingestor = SalesforceKnowledgeIngestor(knowledge_base_path=docs_path)
    chunks = ingestor.load_all()
    if not chunks:
        return 0
    store_path = _store_dir(slug)
    if store_path.is_dir():
        gc.collect()
        for attempt in range(3):
            try:
                shutil.rmtree(store_path)
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.5 * (attempt + 1))
        else:
            shutil.rmtree(store_path, ignore_errors=True)
    vs = SalesforceVectorStore(persist_dir=store_path)
    vs.build(chunks)
    return len(chunks)


def get_project_vector_store(slug: str) -> SalesforceVectorStore:
    """Return a vector store pointed at the project's persist dir."""
    return SalesforceVectorStore(persist_dir=_store_dir(slug))


def project_index_ready(slug: str) -> bool:
    """True when the project has an indexed vector store with chunks."""
    return get_project_vector_store(slug).is_ready()
