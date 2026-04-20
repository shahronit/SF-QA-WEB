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

from core import firestore_db
from rag.embedder import SalesforceVectorStore
from rag.ingestor import SalesforceKnowledgeIngestor

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PROJECTS_DIR = PROJECT_ROOT / "projects"
PROJECT_STORES_DIR = PROJECT_ROOT / "rag" / "project_stores"


# ---------------------------------------------------------------------------
# Firestore metadata helpers
# ---------------------------------------------------------------------------

def _fs_get(slug: str) -> dict[str, Any] | None:
    """Fetch a project metadata document from Firestore."""
    db = firestore_db.get_db()
    doc = db.collection(firestore_db.PROJECTS).document(slug).get()
    return doc.to_dict() if doc.exists else None


def _fs_set(slug: str, meta: dict[str, Any]) -> None:
    """Persist metadata to Firestore."""
    db = firestore_db.get_db()
    db.collection(firestore_db.PROJECTS).document(slug).set(meta)


def _fs_delete(slug: str) -> None:
    """Delete a project metadata document."""
    db = firestore_db.get_db()
    db.collection(firestore_db.PROJECTS).document(slug).delete()


def _fs_list() -> list[dict[str, Any]]:
    """Return all project metadata documents."""
    db = firestore_db.get_db()
    return [d.to_dict() for d in db.collection(firestore_db.PROJECTS).stream()]


def _read_local_meta(slug: str) -> dict[str, Any] | None:
    """Read local metadata.json or return None."""
    mp = _meta_path(slug)
    if not mp.is_file():
        return None
    try:
        return json.loads(mp.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_local_meta(slug: str, meta: dict[str, Any]) -> None:
    """Write metadata.json to the local project folder."""
    _meta_path(slug).parent.mkdir(parents=True, exist_ok=True)
    _meta_path(slug).write_text(json.dumps(meta, indent=2), encoding="utf-8")


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

def _save_meta(slug: str, meta: dict[str, Any]) -> None:
    """Persist metadata to the active backend (Firestore or local JSON)."""
    if firestore_db.is_enabled():
        _fs_set(slug, meta)
    else:
        _write_local_meta(slug, meta)


def list_projects(username: str | None = None) -> list[dict[str, Any]]:
    """Return metadata dicts visible to *username*.

    A project is visible when any of the following is true:
    - *username* is None (backward-compat / no auth mode)
    - the project has no ``owner`` field (legacy project — visible to all)
    - ``owner == username``
    - ``username in shared_with``
    """
    if firestore_db.is_enabled():
        all_meta = _fs_list()
    else:
        all_meta = []
        if PROJECTS_DIR.is_dir():
            for child in sorted(PROJECTS_DIR.iterdir()):
                meta = _read_local_meta(child.name)
                if meta is not None:
                    all_meta.append(meta)

    if username is None:
        return all_meta
    return [
        m for m in all_meta
        if "owner" not in m
        or m.get("owner") == username
        or username in m.get("shared_with", [])
    ]


def create_project(name: str, description: str = "", owner: str = "") -> str:
    """Create folder structure + metadata; return the slug."""
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
    _save_meta(slug, meta)
    return slug


def delete_project(slug: str) -> None:
    """Remove the project folder, its vector store, and its metadata.

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
    if firestore_db.is_enabled():
        try:
            _fs_delete(slug)
        except Exception:
            pass


def get_metadata(slug: str) -> dict[str, Any] | None:
    """Read project metadata or return None if missing."""
    if firestore_db.is_enabled():
        return _fs_get(slug)
    return _read_local_meta(slug)


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
    shared: list[str] = list(meta.get("shared_with", []))
    if target_username in shared:
        return False
    shared.append(target_username)
    meta["shared_with"] = shared
    _save_meta(slug, meta)
    return True


def unshare_project(slug: str, target_username: str) -> bool:
    """Revoke *target_username* access. Returns True on change."""
    meta = get_metadata(slug)
    if meta is None:
        return False
    shared: list[str] = list(meta.get("shared_with", []))
    if target_username not in shared:
        return False
    shared.remove(target_username)
    meta["shared_with"] = shared
    _save_meta(slug, meta)
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
    _save_meta(slug, meta)
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
