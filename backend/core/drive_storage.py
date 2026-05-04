"""Google Drive (Shared Drive) storage adapter for project documents.

This is the live storage backend after the Firebase Storage → Drive
migration. It mirrors the public surface of ``firebase_storage.py`` so
``project_manager.py`` can swap to it without touching the indexer or
the Firestore metadata code path.

Layout in the Shared Drive:

    <SharedDrive>
        QA Studio Agents/             ← parent folder (configurable name)
            <project-display-or-slug>/    ← per-project sub-folder
                attached-doc-1.pdf
                attached-doc-2.docx

Auth: a Google Cloud service account whose JSON is the same one already
configured for Firebase (``FIREBASE_CREDENTIALS_PATH`` /
``FIREBASE_CREDENTIALS_JSON``). The service-account email **must** be
added to the Shared Drive as Content Manager (or higher) before the
first upload — that's the only piece of operator setup that this module
cannot do for itself.

Folder IDs are looked up lazily and cached in module state because Drive
folder lookups are expensive (each is a list query). The cache is
keyed by ``(slug, display_name)`` so the same project never re-hits
Drive for its folder ID after the first upload of the process.
"""

from __future__ import annotations

import io
import json
import logging
import mimetypes
import threading
from pathlib import Path
from typing import Any

from config import settings

log = logging.getLogger(__name__)

# Drive scope — full read/write so the same service account can list,
# create folders, upload, download, and delete. We don't need the
# narrower drive.file scope because we do create the parent + project
# folders ourselves at runtime.
_SCOPES = ["https://www.googleapis.com/auth/drive"]
_FOLDER_MIME = "application/vnd.google-apps.folder"

_service: Any = None
_parent_folder_id: str | None = None
_project_folder_cache: dict[str, str] = {}
_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Internal helpers                                                            #
# --------------------------------------------------------------------------- #


def _shared_drive_id() -> str:
    drive_id = (settings.GDRIVE_SHARED_DRIVE_ID or "").strip()
    if not drive_id:
        raise RuntimeError(
            "GDRIVE_SHARED_DRIVE_ID is not set. Add it to backend/.env. "
            "The service account in FIREBASE_CREDENTIALS_* must be added "
            "to that Shared Drive as Content Manager."
        )
    return drive_id


def _parent_folder_name() -> str:
    name = (settings.GDRIVE_PARENT_FOLDER_NAME or "QA Studio Agents").strip()
    return name or "QA Studio Agents"


def _load_credentials():
    """Build google-auth service-account credentials.

    Reuses the same service account JSON that powers Firestore /
    Firebase Storage today so operators don't have to manage two
    secrets. ``FIREBASE_CREDENTIALS_JSON`` (raw JSON env var) wins over
    ``FIREBASE_CREDENTIALS_PATH`` when both are set.
    """
    try:
        from google.oauth2 import service_account
    except ImportError as exc:
        raise RuntimeError(
            "google-auth is not installed. Run "
            "`pip install google-auth google-api-python-client`."
        ) from exc

    raw_json = (settings.FIREBASE_CREDENTIALS_JSON or "").strip()
    if raw_json:
        try:
            info = json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                "FIREBASE_CREDENTIALS_JSON is not valid JSON. Paste the "
                "full service-account file contents."
            ) from exc
        return service_account.Credentials.from_service_account_info(
            info, scopes=_SCOPES,
        )

    cred_path = (settings.FIREBASE_CREDENTIALS_PATH or "").strip()
    if cred_path:
        if not Path(cred_path).is_file():
            raise RuntimeError(
                f"Service-account credentials file not found at: {cred_path}"
            )
        return service_account.Credentials.from_service_account_file(
            cred_path, scopes=_SCOPES,
        )

    raise RuntimeError(
        "No service-account credentials provided. Set either "
        "FIREBASE_CREDENTIALS_JSON or FIREBASE_CREDENTIALS_PATH so the "
        "Google Drive adapter can authenticate."
    )


def _build_service() -> Any:
    """Return (or lazily create) the singleton Drive v3 service."""
    global _service
    if _service is not None:
        return _service
    try:
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise RuntimeError(
            "google-api-python-client is not installed. Run "
            "`pip install google-api-python-client`."
        ) from exc
    creds = _load_credentials()
    # cache_discovery=False silences the harmless 'file_cache' warning
    # the discovery client emits when running under newer oauth2client.
    _service = build("drive", "v3", credentials=creds, cache_discovery=False)
    return _service


def _drive_kwargs() -> dict[str, Any]:
    """Boilerplate every Shared-Drive-aware Drive call needs."""
    return {
        "supportsAllDrives": True,
        "includeItemsFromAllDrives": True,
        "corpora": "drive",
        "driveId": _shared_drive_id(),
    }


def _escape_q(value: str) -> str:
    """Escape a value used inside a Drive q= query string.

    Drive treats backslashes and single quotes as literals only when
    escaped, so any folder/file name containing a quote (rare but
    possible for display names like ``Q1 'Beta'``) must be sanitized
    before going into the query.
    """
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _find_folder(name: str, parent_id: str) -> str | None:
    svc = _build_service()
    safe = _escape_q(name)
    q = (
        f"name = '{safe}' and "
        f"mimeType = '{_FOLDER_MIME}' and "
        f"'{parent_id}' in parents and "
        f"trashed = false"
    )
    resp = svc.files().list(
        q=q,
        fields="files(id, name)",
        pageSize=10,
        **_drive_kwargs(),
    ).execute()
    files = resp.get("files") or []
    return files[0]["id"] if files else None


def _create_folder(name: str, parent_id: str) -> str:
    svc = _build_service()
    body = {
        "name": name,
        "mimeType": _FOLDER_MIME,
        "parents": [parent_id],
    }
    folder = svc.files().create(
        body=body,
        fields="id",
        supportsAllDrives=True,
    ).execute()
    return folder["id"]


def _get_parent_folder_id() -> str:
    """Find or create the parent ``QA Studio Agents`` folder."""
    global _parent_folder_id
    if _parent_folder_id:
        return _parent_folder_id
    with _lock:
        if _parent_folder_id:
            return _parent_folder_id
        drive_id = _shared_drive_id()
        name = _parent_folder_name()
        existing = _find_folder(name, drive_id)
        _parent_folder_id = existing or _create_folder(name, drive_id)
        if existing:
            log.debug("Drive: reusing existing parent folder %r (%s)", name, existing)
        else:
            log.info("Drive: created parent folder %r in Shared Drive %s", name, drive_id)
        return _parent_folder_id


def _project_folder_label(slug: str, display_name: str | None) -> str:
    """Folder name shown to humans in Drive.

    Display name (e.g. ``TNS B2B Commerce``) is friendlier than the
    slug; the slug is appended in parentheses as a stable disambiguator
    so two projects with the same display name still get unique
    folders.
    """
    label = (display_name or slug or "").strip()
    if not label:
        return slug
    if label == slug:
        return slug
    return f"{label} ({slug})"


def _get_project_folder_id(slug: str, display_name: str | None) -> str:
    """Find or create the per-project folder under the parent."""
    if not slug:
        raise RuntimeError("project slug is required for Drive storage")
    with _lock:
        if slug in _project_folder_cache:
            return _project_folder_cache[slug]
        parent_id = _get_parent_folder_id()
        label = _project_folder_label(slug, display_name)
        existing = _find_folder(label, parent_id)
        folder_id = existing or _create_folder(label, parent_id)
        _project_folder_cache[slug] = folder_id
        if existing:
            log.debug("Drive: reusing project folder %r (%s)", label, folder_id)
        else:
            log.info("Drive: created project folder %r (%s)", label, folder_id)
        return folder_id


def _safe_filename(filename: str) -> str:
    """Collapse path separators inside a filename — Drive treats them
    as plain characters, but we want the user's original look back."""
    return filename.replace("\\", "_").replace("/", "_")


def _find_file_in_project(slug: str, filename: str, display_name: str | None = None) -> dict[str, Any] | None:
    svc = _build_service()
    folder_id = _get_project_folder_id(slug, display_name)
    safe = _escape_q(_safe_filename(filename))
    q = (
        f"name = '{safe}' and "
        f"'{folder_id}' in parents and "
        f"trashed = false"
    )
    resp = svc.files().list(
        q=q,
        fields="files(id, name, mimeType, size, webViewLink)",
        pageSize=5,
        **_drive_kwargs(),
    ).execute()
    files = resp.get("files") or []
    return files[0] if files else None


# --------------------------------------------------------------------------- #
# Public surface — mirrors backend/core/firebase_storage.py                   #
# --------------------------------------------------------------------------- #


def upload(
    slug: str,
    filename: str,
    content: bytes,
    content_type: str | None = None,
    display_name: str | None = None,
) -> dict[str, Any]:
    """Upload bytes for a project document to Drive.

    Returns metadata that ``project_manager`` persists in Firestore so
    that subsequent listings, deletes, and re-indexes can address the
    file by Drive ID without re-listing the folder. If a file with the
    same name already exists, it is replaced (delete + create) — Drive
    allows duplicate names within a folder, so we eagerly clean up to
    keep the user's expectation of "one file = one row".
    """
    try:
        from googleapiclient.http import MediaInMemoryUpload
    except ImportError as exc:
        raise RuntimeError(
            "google-api-python-client is not installed. Run "
            "`pip install google-api-python-client`."
        ) from exc

    svc = _build_service()
    folder_id = _get_project_folder_id(slug, display_name)
    safe_name = _safe_filename(filename)
    if not content_type:
        guessed, _ = mimetypes.guess_type(safe_name)
        content_type = guessed or "application/octet-stream"

    # Replace if it already exists — keep a single canonical row per name.
    existing = _find_file_in_project(slug, safe_name, display_name)
    if existing:
        try:
            svc.files().delete(
                fileId=existing["id"],
                supportsAllDrives=True,
            ).execute()
        except Exception:  # noqa: BLE001
            log.warning(
                "Drive: failed to delete existing %r (%s) before re-upload",
                safe_name, existing.get("id"),
            )

    media = MediaInMemoryUpload(content, mimetype=content_type, resumable=False)
    body = {"name": safe_name, "parents": [folder_id]}
    file = svc.files().create(
        body=body,
        media_body=media,
        fields="id, name, mimeType, size, webViewLink",
        supportsAllDrives=True,
    ).execute()

    return {
        "filename": safe_name,
        "size": int(file.get("size") or len(content)),
        "content_type": file.get("mimeType") or content_type,
        "drive_file_id": file.get("id"),
        "web_view_link": file.get("webViewLink") or "",
    }


def delete(slug: str, filename: str, display_name: str | None = None) -> None:
    """Delete a single project document on Drive (no-op if missing)."""
    svc = _build_service()
    safe = _safe_filename(filename)
    existing = _find_file_in_project(slug, safe, display_name)
    if not existing:
        log.debug("delete(%s/%s) ignored — not found in Drive", slug, safe)
        return
    try:
        svc.files().delete(
            fileId=existing["id"],
            supportsAllDrives=True,
        ).execute()
    except Exception:  # noqa: BLE001
        # Treat as idempotent (e.g. concurrent delete won the race).
        log.debug("delete(%s/%s) ignored — Drive returned an error", slug, safe)


def delete_all(slug: str, display_name: str | None = None) -> int:
    """Delete the entire per-project folder in Drive. Returns count.

    We delete the folder (Drive cascades children) rather than walking
    each file because it's atomic and one API call. The cache entry is
    invalidated so a future upload re-creates the folder.
    """
    svc = _build_service()
    try:
        folder_id = _get_project_folder_id(slug, display_name)
    except Exception:  # noqa: BLE001
        return 0

    # Count children so callers can log a useful number.
    count = 0
    try:
        page_token = None
        while True:
            resp = svc.files().list(
                q=f"'{folder_id}' in parents and trashed = false",
                fields="files(id), nextPageToken",
                pageToken=page_token,
                pageSize=1000,
                **_drive_kwargs(),
            ).execute()
            count += len(resp.get("files") or [])
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    except Exception:  # noqa: BLE001
        log.debug("delete_all: failed to count children of %s", folder_id)

    try:
        svc.files().delete(
            fileId=folder_id,
            supportsAllDrives=True,
        ).execute()
    except Exception:  # noqa: BLE001
        log.warning("delete_all: failed to delete folder %s", folder_id)
        return 0
    finally:
        _project_folder_cache.pop(slug, None)
    return count


def download_all_to(
    slug: str,
    dest_dir: str | Path,
    display_name: str | None = None,
) -> list[Path]:
    """Materialize every project document into *dest_dir*.

    Used by the re-index pipeline so the existing on-disk ingestor
    (PyPDFLoader, openpyxl, etc.) keeps operating on real files
    without each loader needing a Drive-aware variant.
    """
    try:
        from googleapiclient.http import MediaIoBaseDownload
    except ImportError as exc:
        raise RuntimeError(
            "google-api-python-client is not installed. Run "
            "`pip install google-api-python-client`."
        ) from exc

    svc = _build_service()
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []

    try:
        folder_id = _get_project_folder_id(slug, display_name)
    except Exception:  # noqa: BLE001
        return out

    page_token = None
    while True:
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields="files(id, name, mimeType), nextPageToken",
            pageToken=page_token,
            pageSize=1000,
            **_drive_kwargs(),
        ).execute()
        for f in resp.get("files") or []:
            name = f.get("name") or ""
            file_id = f.get("id")
            if not file_id or not name:
                continue
            target = dest / _safe_filename(name)
            try:
                request = svc.files().get_media(
                    fileId=file_id,
                    supportsAllDrives=True,
                )
                buf = io.BytesIO()
                downloader = MediaIoBaseDownload(buf, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
                target.write_bytes(buf.getvalue())
                out.append(target)
            except Exception as exc:  # noqa: BLE001
                # Don't fail the whole re-index over one bad file —
                # log and skip so the rest still indexes.
                log.warning(
                    "Drive: failed to download %s/%s for indexing: %s",
                    slug, name, exc,
                )
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out


def list_files(slug: str, display_name: str | None = None) -> list[dict[str, Any]]:
    """List documents in Drive for a project (used by migration / debug)."""
    svc = _build_service()
    try:
        folder_id = _get_project_folder_id(slug, display_name)
    except Exception:  # noqa: BLE001
        return []
    out: list[dict[str, Any]] = []
    page_token = None
    while True:
        resp = svc.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            fields=(
                "files(id, name, mimeType, size, webViewLink, modifiedTime),"
                " nextPageToken"
            ),
            pageToken=page_token,
            pageSize=1000,
            **_drive_kwargs(),
        ).execute()
        for f in resp.get("files") or []:
            out.append({
                "filename": f.get("name") or "",
                "size": int(f.get("size") or 0),
                "content_type": f.get("mimeType") or "",
                "drive_file_id": f.get("id") or "",
                "web_view_link": f.get("webViewLink") or "",
                "updated": f.get("modifiedTime") or None,
            })
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out
