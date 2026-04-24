"""One-off migration: upload local project documents to Firebase Storage.

Walks ``backend/projects/<slug>/documents/*`` and, for each file:
  1. Uploads the bytes to ``projects/<slug>/documents/<filename>`` in the
     bucket configured by ``FIREBASE_STORAGE_BUCKET``.
  2. Writes per-document metadata into Firestore under
     ``projects/<slug>/documents/<filename>``.

Idempotent: re-running re-uploads bytes (no-op if the blob already exists is
NOT enforced — Firebase will overwrite with the same content) and overwrites
metadata with the same values, so it is safe to run multiple times.

Usage (from the repo root, with backend/.env pointing at Firestore + a bucket):

    python scripts/migrate_documents_to_firebase.py
    python scripts/migrate_documents_to_firebase.py --dry-run
    python scripts/migrate_documents_to_firebase.py --slug my-project

Run AFTER you have set ``STORAGE_BACKEND=firestore`` and
``FIREBASE_STORAGE_BUCKET`` in ``backend/.env``.
"""

from __future__ import annotations

import argparse
import mimetypes
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

# Make `import config`, `import core.*` resolve the same way uvicorn does.
sys.path.insert(0, str(BACKEND_DIR))

from config import settings  # noqa: E402
from core import firebase_storage, firestore_db  # noqa: E402
from core import project_manager as pm  # noqa: E402

PROJECTS_DIR = BACKEND_DIR / "projects"


def _iter_local_docs(slug_filter: str | None):
    """Yield (slug, file_path) pairs for every local project document."""
    if not PROJECTS_DIR.is_dir():
        return
    for project_dir in sorted(PROJECTS_DIR.iterdir()):
        if not project_dir.is_dir():
            continue
        slug = project_dir.name
        if slug_filter and slug != slug_filter:
            continue
        docs_dir = project_dir / "documents"
        if not docs_dir.is_dir():
            continue
        for file_path in sorted(docs_dir.iterdir()):
            if file_path.is_file():
                yield slug, file_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be uploaded without changing anything.",
    )
    parser.add_argument(
        "--slug",
        default=None,
        help="Limit migration to a single project slug.",
    )
    parser.add_argument(
        "--uploader",
        default="migration",
        help="Value to record in `uploaded_by` for each migrated file.",
    )
    args = parser.parse_args()

    # Sanity-check config so we fail fast with a useful message instead of a
    # cryptic firebase_admin error halfway through.
    if (settings.STORAGE_BACKEND or "").lower() != "firestore":
        print("ERROR: STORAGE_BACKEND must be 'firestore' in backend/.env", file=sys.stderr)
        return 2
    if not settings.FIREBASE_STORAGE_BUCKET:
        print(
            "ERROR: FIREBASE_STORAGE_BUCKET is not set in backend/.env "
            "(e.g. qa-studio-agent.appspot.com)",
            file=sys.stderr,
        )
        return 2
    if not firestore_db.is_enabled():
        print("ERROR: Firestore is not initialized. Check FIREBASE_CREDENTIALS_*.", file=sys.stderr)
        return 2

    pairs = list(_iter_local_docs(args.slug))
    if not pairs:
        print("No local documents to migrate.")
        return 0

    print(f"Migrating {len(pairs)} file(s) -> bucket {settings.FIREBASE_STORAGE_BUCKET}")
    if args.dry_run:
        print("(dry run; nothing will be uploaded)")

    uploaded = 0
    failed = 0
    for slug, file_path in pairs:
        rel = f"{slug}/{file_path.name}"
        size = file_path.stat().st_size
        print(f"  - {rel} ({size} bytes)", flush=True)
        if args.dry_run:
            continue
        try:
            content = file_path.read_bytes()
            content_type, _ = mimetypes.guess_type(file_path.name)
            info = firebase_storage.upload(
                slug, file_path.name, content, content_type or "application/octet-stream"
            )
            meta = {
                "filename": info["filename"],
                "size": info["size"],
                "content_type": info["content_type"],
                "storage_path": info["storage_path"],
                "uploaded_by": args.uploader,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }
            pm._fs_save_doc_meta(slug, meta)
            uploaded += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"    FAILED: {exc}", file=sys.stderr)

    print(
        f"Done. uploaded={uploaded} failed={failed} skipped={len(pairs) - uploaded - failed}"
    )
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
