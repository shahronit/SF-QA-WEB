"""One-shot migration: Firebase Storage → Google Drive Shared Drive.

Reads every project's `documents` subcollection from Firestore, downloads
each blob from Firebase Storage (or local disk for legacy ``local_only``
rows), uploads it into the new Drive layout via :mod:`backend.core.drive_storage`,
and rewrites the Firestore metadata so the live app sees the Drive object.

This script is intentionally NOT wired into any startup path. Run it
manually exactly once after:

  1. Provisioning ``GDRIVE_SHARED_DRIVE_ID`` in ``backend/.env``.
  2. Adding the Firebase service-account email to that Shared Drive
     as Content Manager (or higher).
  3. Verifying ``backend/core/drive_storage.upload`` works end-to-end
     against a fresh project.

Usage::

    cd backend
    py -3 ../scripts/migrate_firebase_to_drive.py            # dry-run, prints plan
    py -3 ../scripts/migrate_firebase_to_drive.py --apply    # actually migrate
    py -3 ../scripts/migrate_firebase_to_drive.py --apply --slug tns_b2b_commerce

The script is idempotent: a project that already has Drive metadata
(``drive_file_id`` populated for every doc) is skipped automatically.
Files that ended up on local disk (``local_only=True``) are uploaded
straight from ``backend/projects/<slug>/documents``.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path


def _bootstrap() -> None:
    """Make the backend package importable when invoked as a script."""
    here = Path(__file__).resolve()
    backend = here.parent.parent / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


_bootstrap()

# Imports that depend on `backend` being on sys.path:
from core import drive_storage, firebase_storage, firestore_db  # noqa: E402
from core import project_manager  # noqa: E402

log = logging.getLogger("migrate_firebase_to_drive")


def _iter_project_slugs() -> list[str]:
    db = firestore_db.get_db()
    return [doc.id for doc in db.collection("projects").stream()]


def _project_already_migrated(metas: list[dict]) -> bool:
    """A project is considered migrated if every doc has a Drive ID."""
    if not metas:
        return True
    return all((m.get("drive_file_id") or "").strip() for m in metas)


def _read_bytes_for(slug: str, meta: dict) -> bytes | None:
    """Pull the blob from whichever side currently has it.

    Order of preference:
      1. Firebase Storage (``storage_path`` set) — happy path.
      2. Local disk (``local_only`` flag) — was uploaded while Storage
         was unreachable, kept on disk by the old fallback.
      3. Local disk by filename — last-ditch attempt for rows that
         predate the metadata schema change.
    """
    name = meta.get("filename") or ""
    if not name:
        return None

    if meta.get("storage_path"):
        try:
            return firebase_storage.download(slug, name)
        except Exception as exc:  # noqa: BLE001
            log.warning("Firebase Storage download failed for %s/%s: %s", slug, name, exc)

    local = project_manager._docs_dir(slug) / name
    if local.is_file():
        try:
            return local.read_bytes()
        except OSError as exc:
            log.warning("Local read failed for %s/%s: %s", slug, name, exc)
    return None


def _migrate_project(slug: str, *, apply: bool) -> tuple[int, int]:
    """Migrate a single project. Returns (uploaded, skipped)."""
    metas = project_manager._fs_list_doc_meta(slug)
    if _project_already_migrated(metas):
        log.info("[%s] already on Drive — %d docs, skipping", slug, len(metas))
        return 0, len(metas)

    display_name = (project_manager.get_metadata(slug) or {}).get("name")
    uploaded = 0
    skipped = 0
    for meta in metas:
        name = meta.get("filename") or ""
        if not name:
            skipped += 1
            continue
        if (meta.get("drive_file_id") or "").strip():
            skipped += 1
            continue

        log.info("[%s] %s — preparing migration", slug, name)
        if not apply:
            skipped += 1
            continue

        content = _read_bytes_for(slug, meta)
        if content is None:
            log.warning("[%s] %s — bytes not found in Storage or local disk", slug, name)
            skipped += 1
            continue

        info = drive_storage.upload(
            slug, name, content,
            content_type=meta.get("content_type") or None,
            display_name=display_name,
        )
        new_meta = {
            "filename": info["filename"],
            "size": info["size"],
            "content_type": info["content_type"],
            "drive_file_id": info.get("drive_file_id", ""),
            "web_view_link": info.get("web_view_link", ""),
            "uploaded_by": meta.get("uploaded_by") or "",
            "uploaded_at": meta.get("uploaded_at") or "",
        }
        project_manager._fs_save_doc_meta(slug, new_meta)
        uploaded += 1
        log.info("[%s] %s — uploaded to Drive (%s)", slug, name, info.get("drive_file_id"))

    return uploaded, skipped


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually upload + rewrite Firestore. Default is dry-run.",
    )
    parser.add_argument(
        "--slug", action="append", default=[],
        help="Limit migration to specific project slug(s). Repeatable.",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    if not firestore_db.is_enabled():
        log.error("Firestore is not configured — nothing to migrate.")
        return 1

    slugs = args.slug or _iter_project_slugs()
    if not slugs:
        log.info("No projects found in Firestore.")
        return 0

    total_up = 0
    total_skip = 0
    for slug in slugs:
        try:
            up, skip = _migrate_project(slug, apply=args.apply)
        except Exception as exc:  # noqa: BLE001
            log.exception("[%s] migration failed: %s", slug, exc)
            continue
        total_up += up
        total_skip += skip

    mode = "APPLIED" if args.apply else "DRY-RUN"
    log.info("Migration %s: %d uploaded, %d skipped", mode, total_up, total_skip)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
