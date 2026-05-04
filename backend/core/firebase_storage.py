"""DEPRECATED — Firebase Storage adapter for project documents.

Replaced by :mod:`backend.core.drive_storage` (Google Workspace Shared
Drive via service account). Kept on disk only so the optional
``scripts/migrate_firebase_to_drive.py`` script can still read existing
Firebase Storage objects during the one-shot migration and so any
out-of-tree code that still imports it can be located.

NEW CODE MUST NOT IMPORT THIS MODULE. ``project_manager.py`` no longer
references it. Once the migration script has been run in production
this file is safe to delete (planned follow-up PR).

Original behaviour: files live under
``projects/{slug}/documents/{filename}`` in the bucket configured by
``FIREBASE_STORAGE_BUCKET``. The Firebase Admin app is initialized once
via ``firestore_db.get_db()`` (which now passes the bucket name to
``initialize_app``), so this module simply borrows that app.
"""

from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
from typing import Any

from config import settings
from core import firestore_db

log = logging.getLogger(__name__)

_bucket: Any = None


def _doc_path(slug: str, filename: str) -> str:
    """Canonical blob path for a project document."""
    # Filenames are not slugged so the user sees the original name back.
    # Slashes inside a filename would create accidental sub-folders, so we
    # collapse them here.
    safe = filename.replace("\\", "_").replace("/", "_")
    return f"projects/{slug}/documents/{safe}"


def _prefix(slug: str) -> str:
    """Bucket prefix for all docs of a project (used by list / delete-all)."""
    return f"projects/{slug}/documents/"


def _bucket_candidates(configured: str) -> list[str]:
    """Return the configured bucket plus its sibling naming-convention alias.

    Firebase projects created before Sept 2024 default to
    ``<project-id>.appspot.com`` while newer ones get
    ``<project-id>.firebasestorage.app``. Either name resolves to the same
    project but only one bucket actually exists. Operators routinely paste
    the wrong one into ``FIREBASE_STORAGE_BUCKET`` and then watch every
    upload 404, so we transparently fall back to the alternate name.
    """
    cands = [configured]
    if configured.endswith(".appspot.com"):
        cands.append(configured[: -len(".appspot.com")] + ".firebasestorage.app")
    elif configured.endswith(".firebasestorage.app"):
        cands.append(configured[: -len(".firebasestorage.app")] + ".appspot.com")
    return cands


def _probe_bucket(bucket: Any) -> None:
    """Issue the cheapest possible call that reaches the bucket itself.

    ``bucket.list_blobs(max_results=1)`` returns an iterator that defers the
    HTTP call until iterated; pulling the first page forces it to hit GCS
    so we surface ``NotFound`` (the bucket doesn't exist) versus other
    auth errors at *resolution* time rather than on every upload.
    """
    next(bucket.list_blobs(max_results=1).pages, None)


def get_bucket() -> Any:
    """Return (or lazily create) the singleton Firebase Storage bucket.

    Resolves the actual usable bucket once: tries the configured name,
    then the modern/legacy alternative naming. If neither resolves, raises
    a single error that lists everything attempted so operators can fix
    ``FIREBASE_STORAGE_BUCKET`` (or grant the service account access to
    the right project).
    """
    global _bucket
    if _bucket is not None:
        return _bucket

    if not settings.FIREBASE_STORAGE_BUCKET:
        raise RuntimeError(
            "FIREBASE_STORAGE_BUCKET is not set. Add it to backend/.env, e.g. "
            "FIREBASE_STORAGE_BUCKET=qa-studio-agent.firebasestorage.app"
        )

    # Touch the Firestore client first; that triggers `initialize_app` with
    # the storageBucket option set, so storage.bucket() below returns the
    # right bucket without a second initialization.
    firestore_db.get_db()

    try:
        from firebase_admin import storage
    except ImportError as exc:
        raise RuntimeError(
            "firebase-admin is not installed. Run `pip install firebase-admin`."
        ) from exc

    candidates = _bucket_candidates(settings.FIREBASE_STORAGE_BUCKET)
    last_err: Exception | None = None
    for name in candidates:
        try:
            bucket = storage.bucket(name=name)
            _probe_bucket(bucket)
        except Exception as exc:  # noqa: BLE001
            last_err = exc
            log.warning("Firebase Storage bucket %r unreachable: %s", name, exc)
            continue
        if name != settings.FIREBASE_STORAGE_BUCKET:
            log.warning(
                "Configured FIREBASE_STORAGE_BUCKET=%r does not exist; "
                "using %r instead. Update your .env to silence this warning.",
                settings.FIREBASE_STORAGE_BUCKET, name,
            )
        _bucket = bucket
        return _bucket

    raise RuntimeError(
        "Firebase Storage bucket not reachable. Tried: "
        + ", ".join(candidates)
        + f". Last error: {last_err}. "
        "Open the Firebase console → Storage and copy the exact bucket name "
        "into FIREBASE_STORAGE_BUCKET in backend/.env."
    )


def upload(
    slug: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> dict[str, Any]:
    """Upload bytes for a project document. Returns metadata dict."""
    bucket = get_bucket()
    blob = bucket.blob(_doc_path(slug, filename))
    if not content_type:
        guessed, _ = mimetypes.guess_type(filename)
        content_type = guessed or "application/octet-stream"
    blob.upload_from_string(content, content_type=content_type)
    return {
        "filename": filename,
        "size": len(content),
        "content_type": content_type,
        "storage_path": blob.name,
    }


def download(slug: str, filename: str) -> bytes:
    """Read the bytes of a single project document."""
    bucket = get_bucket()
    blob = bucket.blob(_doc_path(slug, filename))
    if not blob.exists():
        raise FileNotFoundError(f"Document not found in storage: {filename}")
    return blob.download_as_bytes()


def delete(slug: str, filename: str) -> None:
    """Delete a single project document blob (no-op if already gone)."""
    bucket = get_bucket()
    blob = bucket.blob(_doc_path(slug, filename))
    try:
        blob.delete()
    except Exception:  # noqa: BLE001
        # Trying to delete a missing blob raises; treat as idempotent.
        log.debug("delete(%s/%s) ignored (blob missing)", slug, filename)


def delete_all(slug: str) -> int:
    """Delete every blob under projects/{slug}/documents/. Returns count."""
    bucket = get_bucket()
    count = 0
    # Bucket.list_blobs returns an iterator; materialize per page to delete.
    for blob in bucket.list_blobs(prefix=_prefix(slug)):
        try:
            blob.delete()
            count += 1
        except Exception:  # noqa: BLE001
            log.warning("Failed to delete %s during project cleanup", blob.name)
    return count


def list_blobs(slug: str) -> list[dict[str, Any]]:
    """List documents in storage for a project (used by migration / debug)."""
    bucket = get_bucket()
    out: list[dict[str, Any]] = []
    for blob in bucket.list_blobs(prefix=_prefix(slug)):
        # Strip the prefix to get back the original filename.
        name = blob.name.split("/")[-1]
        if not name:
            continue
        out.append({
            "filename": name,
            "size": int(blob.size or 0),
            "content_type": blob.content_type or "",
            "storage_path": blob.name,
            "updated": blob.updated.isoformat() if blob.updated else None,
        })
    return out


def download_all_to(slug: str, dest_dir: str | Path) -> list[Path]:
    """Materialize every project document into *dest_dir*.

    Used by the re-index pipeline so the existing on-disk ingestor
    (PyPDFLoader, openpyxl, etc.) can keep operating on real files without
    each loader needing a Firebase-aware variant.
    """
    bucket = get_bucket()
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    for blob in bucket.list_blobs(prefix=_prefix(slug)):
        name = blob.name.split("/")[-1]
        if not name:
            continue
        target = dest / name
        blob.download_to_filename(str(target))
        out.append(target)
    return out
