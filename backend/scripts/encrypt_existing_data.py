"""Idempotent backfill — re-encrypt every plaintext sensitive field at rest.

Read the lazy-migration story in :mod:`core.secret_fields` for context:
every read-then-write cycle organically upgrades a row from plaintext
to ciphertext. This script is the "do it now" shortcut so an operator
who just enabled encryption (set ``ENCRYPTION_MASTER_KEY``) can ensure
no plaintext lingers.

Run from the ``backend/`` directory:

    python -m scripts.encrypt_existing_data --dry-run
    python -m scripts.encrypt_existing_data

Touched collections / files:

* ``users`` (Firestore) and ``data/users.json`` — per-user prompt overrides
* ``jira_sessions`` (Firestore)
* ``gdrive_sessions`` (Firestore)
* ``xray_sessions`` / ``zephyr_sessions`` (Firestore)
* ``projects/<slug>/mcp_servers`` (Firestore) and ``projects/<slug>/mcp_servers.json``
* ``agent_runs`` (Firestore) and ``logs/agent_log.jsonl``

Idempotent: the helpers in :mod:`core.secret_fields` skip values that
already carry the ``enc:v1:`` envelope. A second run reports zero
changes when everything is already encrypted.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core import (  # noqa: E402 — sys.path hack above is intentional
    firestore_db,
    notifications,  # imported only to confirm storage layer wires up
    secret_box,
    secret_fields,
    user_auth,
)


# ---------------------------------------------------------------------------
# Counters
# ---------------------------------------------------------------------------

class Stats:
    """Per-collection encryption counters with a tidy str() summary."""

    def __init__(self) -> None:
        self.touched: dict[str, int] = {}
        self.skipped: dict[str, int] = {}

    def hit(self, collection: str) -> None:
        self.touched[collection] = self.touched.get(collection, 0) + 1

    def skip(self, collection: str) -> None:
        self.skipped[collection] = self.skipped.get(collection, 0) + 1

    def __str__(self) -> str:
        lines = ["Backfill summary:"]
        names = sorted(set(self.touched) | set(self.skipped))
        for name in names:
            lines.append(
                f"  {name}: encrypted {self.touched.get(name, 0)}, "
                f"already-encrypted {self.skipped.get(name, 0)}"
            )
        if not names:
            lines.append("  (nothing to migrate)")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _has_plaintext_value(payload: dict | None, *, exclude: set[str]) -> bool:
    """True when *payload* has any non-excluded string that's not yet encrypted."""
    if not payload:
        return False
    for k, v in payload.items():
        if k in exclude:
            continue
        if isinstance(v, str) and v and not secret_box.is_encrypted(v):
            return True
    return False


# ---------------------------------------------------------------------------
# Migrators (one per storage shape)
# ---------------------------------------------------------------------------

def migrate_session_collection(
    collection_name: str, plaintext_fields: set[str], stats: Stats, dry_run: bool,
) -> None:
    """Re-encrypt every doc in a one-doc-per-username session collection."""
    if not firestore_db.is_enabled():
        return
    db = firestore_db.get_db()
    for snap in db.collection(collection_name).stream():
        if not snap.exists:
            continue
        raw = snap.to_dict() or {}
        if not _has_plaintext_value(raw, exclude=plaintext_fields):
            stats.skip(collection_name)
            continue
        stats.hit(collection_name)
        if dry_run:
            continue
        cleaned = secret_fields.encrypt_dict_values(
            raw, exclude=plaintext_fields,
        )
        db.collection(collection_name).document(snap.id).set(cleaned)


def migrate_users_firestore(stats: Stats, dry_run: bool) -> None:
    """Re-encrypt every user's ``prompt_overrides`` in Firestore."""
    if not firestore_db.is_enabled():
        return
    db = firestore_db.get_db()
    for snap in db.collection(firestore_db.USERS).stream():
        if not snap.exists:
            continue
        raw = snap.to_dict() or {}
        overrides = raw.get("prompt_overrides") or {}
        if not _user_has_plaintext_prompt(overrides):
            stats.skip("users.prompt_overrides")
            continue
        stats.hit("users.prompt_overrides")
        if dry_run:
            continue
        # _fs_save_user re-encrypts via the standard write path.
        user_auth._fs_save_user(snap.id, raw)


def _user_has_plaintext_prompt(overrides: dict | None) -> bool:
    if not isinstance(overrides, dict):
        return False
    for by_mode in overrides.values():
        if not isinstance(by_mode, dict):
            continue
        for prompt in by_mode.values():
            if isinstance(prompt, str) and prompt and not secret_box.is_encrypted(prompt):
                return True
    return False


def migrate_users_local(stats: Stats, dry_run: bool) -> None:
    """Re-encrypt prompt_overrides in the local users.json."""
    path = ROOT / "data" / "users.json"
    if not path.is_file():
        return
    try:
        raw = json.loads(path.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        return
    if not isinstance(raw, dict):
        return
    changed = False
    for username, user in raw.items():
        overrides = (user or {}).get("prompt_overrides") or {}
        if _user_has_plaintext_prompt(overrides):
            stats.hit("local users.json")
            changed = True
        else:
            stats.skip("local users.json")
    if changed and not dry_run:
        # Round-trip through the storage helpers so encryption happens
        # via the canonical write path (avoids double-encoding).
        decrypted = user_auth._local_load_users()
        user_auth._local_save_users(decrypted)


def migrate_mcp_servers(stats: Stats, dry_run: bool) -> None:
    """Re-encrypt MCP headers across every project."""
    from core import project_manager as pm

    if firestore_db.is_enabled():
        db = firestore_db.get_db()
        for proj in db.collection(firestore_db.PROJECTS).stream():
            if not proj.exists:
                continue
            slug = proj.id
            for srv in pm._mcp_collection(slug).stream():
                if not srv.exists:
                    continue
                raw = srv.to_dict() or {}
                headers = raw.get("headers")
                if isinstance(headers, dict) and headers:
                    stats.hit("mcp_servers")
                    if not dry_run:
                        pm._mcp_collection(slug).document(srv.id).set(
                            pm._encrypt_server_for_storage(raw)
                        )
                else:
                    stats.skip("mcp_servers")
        return

    projects_dir = ROOT / "projects"
    if not projects_dir.is_dir():
        return
    for project_dir in projects_dir.iterdir():
        if not project_dir.is_dir():
            continue
        path = project_dir / "mcp_servers.json"
        if not path.is_file():
            continue
        try:
            servers = json.loads(path.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if not isinstance(servers, list):
            continue
        changed = False
        out: list[dict] = []
        for srv in servers:
            headers = (srv or {}).get("headers")
            if isinstance(headers, dict) and headers:
                stats.hit("local mcp_servers.json")
                changed = True
                out.append(pm._encrypt_server_for_storage(srv))
            else:
                stats.skip("local mcp_servers.json")
                out.append(srv)
        if changed and not dry_run:
            path.write_text(json.dumps(out, indent=2), encoding="utf-8")


def migrate_agent_runs(stats: Stats, dry_run: bool) -> None:
    """Re-encrypt the ``input`` and ``output`` fields of every agent run."""
    if firestore_db.is_enabled():
        db = firestore_db.get_db()
        for snap in db.collection(firestore_db.AGENT_RUNS).stream():
            if not snap.exists:
                continue
            raw = snap.to_dict() or {}
            needs = any(
                isinstance(raw.get(f), str)
                and raw.get(f)
                and not secret_box.is_encrypted(raw.get(f))
                for f in ("input", "output")
            )
            if not needs:
                stats.skip("agent_runs")
                continue
            stats.hit("agent_runs")
            if dry_run:
                continue
            cleaned = dict(raw)
            for field in ("input", "output"):
                v = cleaned.get(field)
                if isinstance(v, str) and v and not secret_box.is_encrypted(v):
                    cleaned[field] = secret_fields.encrypt_secret(v)
            snap.reference.set(cleaned)
        return

    log_path = ROOT / "logs" / "agent_log.jsonl"
    if not log_path.is_file():
        return
    lines = [ln for ln in log_path.read_text("utf-8").splitlines() if ln.strip()]
    new_lines: list[str] = []
    changed = False
    for ln in lines:
        try:
            rec = json.loads(ln)
        except json.JSONDecodeError:
            new_lines.append(ln)
            continue
        needs = any(
            isinstance(rec.get(f), str)
            and rec.get(f)
            and not secret_box.is_encrypted(rec.get(f))
            for f in ("input", "output")
        )
        if needs:
            stats.hit("local agent_log.jsonl")
            changed = True
            for field in ("input", "output"):
                v = rec.get(field)
                if isinstance(v, str) and v and not secret_box.is_encrypted(v):
                    rec[field] = secret_fields.encrypt_secret(v)
            new_lines.append(json.dumps(rec, ensure_ascii=False))
        else:
            stats.skip("local agent_log.jsonl")
            new_lines.append(ln)
    if changed and not dry_run:
        log_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    """CLI entry point — returns 0 on success, 1 when encryption is disabled."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would change without writing anything.",
    )
    args = parser.parse_args()

    if not secret_box.is_enabled():
        print(
            "ENCRYPTION_MASTER_KEY is not set or invalid. Generate one with "
            "`python -m scripts.gen_encryption_key`, add it to backend/.env, "
            "and re-run."
        )
        return 1

    stats = Stats()
    print(f"Storage backend: {'firestore' if firestore_db.is_enabled() else 'local JSON'}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'WRITE'}")

    # Jira: only api_token is sensitive.
    migrate_session_collection(
        firestore_db.JIRA_SESSIONS,
        plaintext_fields={"jira_url", "email", "last_project", "last_issue_type", "created", "updated"},
        stats=stats,
        dry_run=args.dry_run,
    )
    # Google Drive: access_token, refresh_token, client_secret.
    migrate_session_collection(
        firestore_db.GDRIVE_SESSIONS,
        plaintext_fields={"token_uri", "scopes", "expiry", "client_id", "user_email", "email", "last_folder", "created", "updated"},
        stats=stats,
        dry_run=args.dry_run,
    )
    # Xray: client_secret.
    migrate_session_collection(
        firestore_db.XRAY_SESSIONS,
        plaintext_fields={"base_url", "client_id", "project_key", "project_id", "created", "updated", "last_project"},
        stats=stats,
        dry_run=args.dry_run,
    )
    # Zephyr: api_token.
    migrate_session_collection(
        firestore_db.ZEPHYR_SESSIONS,
        plaintext_fields={"base_url", "project_key", "project_id", "created", "updated", "last_project"},
        stats=stats,
        dry_run=args.dry_run,
    )
    migrate_users_firestore(stats, dry_run=args.dry_run)
    migrate_users_local(stats, dry_run=args.dry_run)
    migrate_mcp_servers(stats, dry_run=args.dry_run)
    migrate_agent_runs(stats, dry_run=args.dry_run)

    print(stats)
    if args.dry_run and any(stats.touched.values()):
        print("\nRe-run without --dry-run to commit these changes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
