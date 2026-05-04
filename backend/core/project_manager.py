"""Project CRUD, document storage, and per-project vector-store management."""

from __future__ import annotations

import gc
import json
import logging
import re
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from core import drive_storage, firestore_db, secret_box, secret_fields
from rag.embedder import SalesforceVectorStore
from rag.ingestor import SalesforceKnowledgeIngestor

log = logging.getLogger(__name__)

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
    ChromaDB file locks on Windows. Also wipes the project's Drive
    folder and its Firestore documents subcollection so we don't leave
    orphaned data behind.
    """
    # Capture display name before we delete metadata — drive_storage
    # uses it (with the slug suffix) as the folder label.
    display_name = (get_metadata(slug) or {}).get("name")
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
            _fs_delete_documents(slug)
        except Exception as exc:  # noqa: BLE001
            log.warning("Failed to clear Firestore documents for %s: %s", slug, exc)
        try:
            drive_storage.delete_all(slug, display_name=display_name)
        except Exception as exc:  # noqa: BLE001
            log.warning("Failed to clear Drive folder for %s: %s", slug, exc)
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
#
# Storage strategy:
#   STORAGE_BACKEND=firestore  -> bytes in a Google Workspace Shared Drive
#                                 (GDRIVE_SHARED_DRIVE_ID), metadata in
#                                 Firestore subcollection projects/{slug}/documents.
#                                 Drive folder layout:
#                                   <SharedDrive>/QA Studio Agents/<project>/file
#                                 Each metadata row carries `drive_file_id`
#                                 + `web_view_link` so the UI can deep-link
#                                 and the indexer can stream the bytes.
#                                 Only `delete_document` ever removes them.
#   STORAGE_BACKEND=local      -> bytes on local disk under projects/{slug}/documents
#                                 (dev-only fallback).
# ---------------------------------------------------------------------------

def _docs_collection(slug: str):
    """Return the Firestore subcollection for a project's documents."""
    db = firestore_db.get_db()
    return (
        db.collection(firestore_db.PROJECTS)
        .document(slug)
        .collection(firestore_db.PROJECT_DOCUMENTS)
    )


def _fs_save_doc_meta(slug: str, meta: dict[str, Any]) -> None:
    """Upsert per-document metadata in the Firestore subcollection."""
    doc_id = meta["filename"]
    _docs_collection(slug).document(doc_id).set(meta)


def _fs_delete_doc_meta(slug: str, filename: str) -> None:
    """Remove a single document metadata entry."""
    _docs_collection(slug).document(filename).delete()


def _fs_list_doc_meta(slug: str) -> list[dict[str, Any]]:
    """Return every document metadata entry for a project."""
    return [d.to_dict() for d in _docs_collection(slug).stream() if d.exists]


def _fs_delete_documents(slug: str) -> None:
    """Wipe the entire documents subcollection (used by delete_project)."""
    coll = _docs_collection(slug)
    # Batch deletes are cheap enough; subcollections are typically small.
    for doc in coll.stream():
        doc.reference.delete()


def _save_to_local_disk_only(
    slug: str,
    filename: str,
    content: bytes,
    uploader: str | None,
    content_type: str | None,
) -> dict[str, Any]:
    """Write *content* to the project's on-disk docs folder and return meta.

    Used only by the dev-mode ``STORAGE_BACKEND=local`` path. Cloud
    deployments now go straight to Drive via :func:`save_file`; there is
    no local-disk fallback when Drive is unreachable — uploads fail loudly
    so the operator notices and fixes the Drive setup. The IndexedDB
    sidecar in the browser remains the user-side safety net.
    """
    docs = _docs_dir(slug)
    docs.mkdir(parents=True, exist_ok=True)
    safe_name = filename.replace("\\", "_").replace("/", "_")
    dest = docs / safe_name
    dest.write_bytes(content)
    return {
        "filename": safe_name,
        "size": len(content),
        "content_type": content_type or "",
        "uploaded_by": uploader or "",
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }


def save_file(
    slug: str,
    filename: str,
    content: bytes,
    uploader: str | None = None,
    content_type: str | None = None,
) -> dict[str, Any]:
    """Persist a document upload.

    Returns the metadata dict written. When Firestore is enabled the
    bytes go to a Google Workspace Shared Drive (under
    ``QA Studio Agents/<project>/<filename>``) and the metadata
    (``drive_file_id`` + ``web_view_link`` + size / content-type) is
    written to the Firestore documents subcollection. Drive failures
    are surfaced to the caller — there is no transparent local-disk
    fallback. The browser-side IndexedDB sidecar still keeps a copy
    on the user's device for the no-network case.
    """
    if firestore_db.is_enabled():
        display_name = (get_metadata(slug) or {}).get("name")
        info = drive_storage.upload(
            slug, filename, content, content_type, display_name=display_name,
        )
        meta = {
            "filename": info["filename"],
            "size": info["size"],
            "content_type": info["content_type"],
            "drive_file_id": info.get("drive_file_id", ""),
            "web_view_link": info.get("web_view_link", ""),
            "uploaded_by": uploader or "",
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        _fs_save_doc_meta(slug, meta)
        return meta

    return _save_to_local_disk_only(slug, filename, content, uploader, content_type)


def list_documents(slug: str) -> list[dict[str, Any]]:
    """Return rich document metadata for a project, newest first.

    Always returns a list of dicts shaped:
        {filename, size, content_type, uploaded_by, uploaded_at}

    The frontend keys off `filename` and renders the optional fields when
    present, so this is back-compatible with the prior list-of-strings API
    via simple object access.
    """
    if firestore_db.is_enabled():
        items = _fs_list_doc_meta(slug)
        items.sort(key=lambda m: m.get("uploaded_at") or "", reverse=True)
        return items

    docs = _docs_dir(slug)
    if not docs.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for p in sorted(docs.iterdir()):
        if not p.is_file():
            continue
        try:
            stat = p.stat()
            uploaded = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            size = stat.st_size
        except OSError:
            uploaded, size = "", 0
        out.append({
            "filename": p.name,
            "size": size,
            "content_type": "",
            "uploaded_by": "",
            "uploaded_at": uploaded,
        })
    return out


def delete_document(slug: str, filename: str) -> None:
    """Remove a single document. Only ever called via the explicit DELETE route.

    Best-effort: a missing Drive object or Firestore row should never
    block the rest of the cleanup. The browser-side IndexedDB sidecar
    is cleared by the frontend separately.
    """
    if firestore_db.is_enabled():
        display_name = (get_metadata(slug) or {}).get("name")
        try:
            drive_storage.delete(slug, filename, display_name=display_name)
        except Exception as exc:  # noqa: BLE001
            log.debug("Drive delete %s/%s skipped: %s", slug, filename, exc)
        try:
            _fs_delete_doc_meta(slug, filename)
        except Exception as exc:  # noqa: BLE001
            log.warning("Failed to remove Firestore doc meta %s/%s: %s", slug, filename, exc)
        return
    target = _docs_dir(slug) / filename
    if target.is_file():
        target.unlink()


# ---------------------------------------------------------------------------
# Per-project RAG index
# ---------------------------------------------------------------------------

def _materialize_docs_for_indexing(slug: str) -> tuple[Path, tempfile.TemporaryDirectory | None]:
    """Return a Path the ingestor can scan + an optional tempdir to clean up.

    For Firestore-backed projects we download every Drive object into a
    temp dir so existing on-disk loaders (PyPDFLoader, openpyxl, etc.)
    keep working without each one needing a Drive-aware variant.

    For local-disk projects we just point at the existing folder.
    """
    if firestore_db.is_enabled():
        tmp = tempfile.TemporaryDirectory(prefix=f"sf-qa-rag-{slug}-")
        display_name = (get_metadata(slug) or {}).get("name")
        try:
            drive_storage.download_all_to(slug, tmp.name, display_name=display_name)
        except Exception as exc:  # noqa: BLE001
            log.warning(
                "Drive download for index of %s failed (%s) — re-index "
                "will return zero chunks until Drive is reachable.",
                slug, exc,
            )
        return Path(tmp.name), tmp
    return _docs_dir(slug), None


def build_project_index(slug: str) -> int:
    """Ingest project documents into a dedicated ChromaDB store. Returns chunk count."""
    docs_path, tmp_handle = _materialize_docs_for_indexing(slug)
    try:
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
    finally:
        if tmp_handle is not None:
            try:
                tmp_handle.cleanup()
            except Exception:  # noqa: BLE001
                pass


def get_project_vector_store(slug: str) -> SalesforceVectorStore:
    """Return a vector store pointed at the project's persist dir."""
    return SalesforceVectorStore(persist_dir=_store_dir(slug))


def project_index_ready(slug: str) -> bool:
    """True when the project has an indexed vector store with chunks."""
    return get_project_vector_store(slug).is_ready()


# ---------------------------------------------------------------------------
# MCP servers — per-project, persisted in Firestore subcollection
# `projects/{slug}/mcp_servers`. Local-disk fallback stores a JSON list
# alongside metadata.json so single-machine dev keeps working.
# ---------------------------------------------------------------------------


def _mcp_collection(slug: str):
    """Return the Firestore subcollection for a project's MCP servers."""
    db = firestore_db.get_db()
    return (
        db.collection(firestore_db.PROJECTS)
        .document(slug)
        .collection(firestore_db.MCP_SERVERS)
    )


def _local_mcp_path(slug: str) -> Path:
    return PROJECTS_DIR / slug / "mcp_servers.json"


def _read_local_mcp(slug: str) -> list[dict[str, Any]]:
    path = _local_mcp_path(slug)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text("utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write_local_mcp(slug: str, servers: list[dict[str, Any]]) -> None:
    path = _local_mcp_path(slug)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(servers, indent=2), encoding="utf-8")


def _encrypt_server_for_storage(server: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of *server* whose ``headers`` is an encrypted JSON blob.

    MCP auth headers (``Authorization: Bearer ...``, signed cookies,
    etc.) are the most sensitive part of an MCP config. We encrypt the
    entire dict as a single JSON string so even header *names* are
    hidden — leaking that a server uses ``X-Internal-Token`` is itself
    a clue. When encryption is disabled, ``headers`` is left as the
    plain dict so a fresh dev install keeps working.
    """
    out = dict(server)
    headers = out.get("headers")
    if headers and isinstance(headers, dict) and secret_box.is_enabled():
        out["headers"] = secret_fields.encrypt_secret(json.dumps(headers))
    return out


def _decrypt_server_from_storage(server: dict[str, Any]) -> dict[str, Any]:
    """Inverse of :func:`_encrypt_server_for_storage`.

    Tolerates both shapes (encrypted string or legacy plain dict) so
    rows written before encryption was enabled still load.
    """
    out = dict(server)
    headers = out.get("headers")
    if isinstance(headers, str) and secret_box.is_encrypted(headers):
        try:
            decoded = secret_fields.decrypt_secret(headers)
            out["headers"] = json.loads(decoded) if decoded else {}
        except Exception:
            log.exception("MCP headers decrypt failed for server %s", server.get("id"))
            out["headers"] = {}
    elif headers is None:
        out["headers"] = {}
    return out


def _normalize_server_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Coerce a partial server payload to the canonical wire shape.

    Strips unknown keys, normalizes types, defaults `enabled=True` so a
    fresh server starts feeding RAG immediately. `url` and `name` must
    already be present and non-empty when this is called from `add`; the
    `update` path tolerates partials and merges on top of the existing doc.
    """
    out: dict[str, Any] = {}
    if "name" in payload: out["name"] = str(payload["name"]).strip()
    if "url" in payload: out["url"] = str(payload["url"]).strip()
    if "enabled" in payload: out["enabled"] = bool(payload["enabled"])
    headers = payload.get("headers")
    if headers is not None:
        if not isinstance(headers, dict):
            raise ValueError("headers must be a dict of string->string")
        out["headers"] = {str(k): str(v) for k, v in headers.items()}
    return out


def list_mcp_servers(slug: str) -> list[dict[str, Any]]:
    """Return all MCP server configs for a project (oldest first).

    Decrypts any encrypted ``headers`` blobs on the way out so callers
    (mcp_source, the test endpoint) always see a plain dict.
    """
    if firestore_db.is_enabled():
        items: list[dict[str, Any]] = []
        for d in _mcp_collection(slug).stream():
            if not d.exists:
                continue
            data = d.to_dict() or {}
            data.setdefault("id", d.id)
            items.append(_decrypt_server_from_storage(data))
        items.sort(key=lambda m: m.get("created_at") or "")
        return items
    return [_decrypt_server_from_storage(s) for s in _read_local_mcp(slug)]


def add_mcp_server(slug: str, payload: dict[str, Any], created_by: str = "") -> dict[str, Any]:
    """Insert a new MCP server. Generates a stable `id` if absent.

    Raises ValueError when the payload is missing the `url` (the only
    field we can't fabricate a sane default for). Invalidates the
    in-memory MCP fetch cache so the next agent run picks the new
    server up immediately.
    """
    norm = _normalize_server_payload(payload)
    if not norm.get("url"):
        raise ValueError("MCP server requires a non-empty `url`")
    norm.setdefault("name", norm["url"])
    norm.setdefault("enabled", True)
    norm.setdefault("headers", {})
    server = {
        "id": str(payload.get("id") or uuid.uuid4().hex[:12]),
        "name": norm["name"],
        "url": norm["url"],
        "headers": norm.get("headers", {}),
        "enabled": norm["enabled"],
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    persisted = _encrypt_server_for_storage(server)
    if firestore_db.is_enabled():
        _mcp_collection(slug).document(server["id"]).set(persisted)
    else:
        existing = _read_local_mcp(slug)
        existing.append(persisted)
        _write_local_mcp(slug, existing)
    _invalidate_mcp_cache(slug)
    return server


def update_mcp_server(slug: str, server_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """Patch an existing server. Returns the merged doc or None if missing.

    The merge happens in plaintext (decrypt the stored row first, then
    overlay the partial payload, then re-encrypt). This means a PATCH
    that doesn't touch ``headers`` keeps the existing headers intact
    rather than reading back the ciphertext as if it were the new
    plaintext value.
    """
    norm = _normalize_server_payload(payload)
    if firestore_db.is_enabled():
        ref = _mcp_collection(slug).document(server_id)
        snap = ref.get()
        if not snap.exists:
            return None
        existing = _decrypt_server_from_storage(snap.to_dict() or {})
        merged = {**existing, **norm}
        merged["id"] = server_id
        ref.set(_encrypt_server_for_storage(merged))
        _invalidate_mcp_cache(slug)
        return merged

    existing_list = _read_local_mcp(slug)
    found = None
    for i, raw in enumerate(existing_list):
        if raw.get("id") == server_id:
            current = _decrypt_server_from_storage(raw)
            merged = {**current, **norm, "id": server_id}
            existing_list[i] = _encrypt_server_for_storage(merged)
            found = merged
            break
    if found is None:
        return None
    _write_local_mcp(slug, existing_list)
    _invalidate_mcp_cache(slug)
    return found


def delete_mcp_server(slug: str, server_id: str) -> bool:
    """Remove a single MCP server. Returns True when something was deleted."""
    if firestore_db.is_enabled():
        ref = _mcp_collection(slug).document(server_id)
        snap = ref.get()
        if not snap.exists:
            return False
        ref.delete()
        _invalidate_mcp_cache(slug)
        return True

    existing = _read_local_mcp(slug)
    next_list = [s for s in existing if s.get("id") != server_id]
    if len(next_list) == len(existing):
        return False
    _write_local_mcp(slug, next_list)
    _invalidate_mcp_cache(slug)
    return True


def get_mcp_server(slug: str, server_id: str) -> dict[str, Any] | None:
    """Convenience accessor for the test endpoint."""
    for s in list_mcp_servers(slug):
        if s.get("id") == server_id:
            return s
    return None


def _invalidate_mcp_cache(slug: str) -> None:
    """Drop cached MCP fetches for *slug* so config changes take effect.

    Imported lazily to avoid a circular import at module load time
    (mcp_source -> project_manager -> mcp_source). Failures here are
    non-fatal — worst case the stale cache expires within MCP_CACHE_TTL_SEC.
    """
    try:
        from rag import mcp_source
        mcp_source.invalidate_cache(slug=slug)
    except Exception as exc:  # noqa: BLE001
        log.debug("MCP cache invalidate skipped for %s: %s", slug, exc)
