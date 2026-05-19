"""Per-user Cursor CLI credential management.

The ``cursor-agent`` CLI authenticates by writing OAuth tokens into
``~/.cursor/auth.json``. To give every QA Studio user their OWN Cursor
seat, we redirect that directory per-user by overriding ``HOME``
(POSIX) / ``USERPROFILE`` (Windows) in the subprocess environment.
Each user gets a slot under ``backend/data/cursor-auth/<username>/``
where their personal ``.cursor/`` lives.

This module is the single source of truth for:

  * resolving the per-user slot path (``slot_for``),
  * building the subprocess env that points cursor-agent at it
    (``env_for``),
  * a contextvar-based "current cursor user" so providers running
    under ``orch.run_agent(username=...)`` automatically pick up the
    right credentials without changing the ``LLMProvider`` protocol
    signature.

Multi-user prod note: this design assumes the OAuth browser opens on
the server host (i.e. local-dev where the operator IS the user). For
headless deployments (e.g. Render) where the operator can't click in
the server's browser, users need an alternative such as uploading
their own ``auth.json`` — that path is intentionally not implemented
here because the bulk of this app runs on the operator's own
workstation.
"""

from __future__ import annotations

import base64
import binascii
import contextvars
import json
import logging
import os
import re
import shutil
import subprocess
import tarfile
import threading
import zipfile
from io import BytesIO
from pathlib import Path

from core import firestore_db, secret_fields

logger = logging.getLogger(__name__)

# All per-user Cursor credential slots live under here. Matches the
# existing data-dir convention used by user_auth / prompt_store /
# llm_cache so backups & .gitignore rules already cover it.
_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "cursor-auth"

# Context var the orchestrator sets at the start of run_agent /
# stream_agent so the cursor provider's subprocess inherits the right
# HOME / USERPROFILE without us having to thread ``username`` through
# the LLMProvider Protocol signature (which every provider shares).
_current_user: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "cursor_current_user", default=None,
)

# Marker substrings cursor-agent emits when the seat isn't
# authenticated. Centralised here so the status probe AND the
# orchestrator's _SKIP_PATTERNS pull from the same source of truth.
_AUTH_REQUIRED_MARKERS = (
    "authentication required",
    "agent login",
    "cursor_api_key",
    "not authenticated",
    "no models available",
)


def _sanitize(username: str) -> str:
    """Reduce a username to a safe filesystem segment.

    Usernames are unique per the user_auth store but may contain ``@``
    / ``.`` (email-style logins) which are still filesystem-safe; we
    strip anything that could escape the slot dir (``..``, slashes,
    NUL bytes etc.) just in case.
    """
    cleaned = re.sub(r"[^A-Za-z0-9._@-]+", "_", username.strip())
    # Cap length so an over-long username can't blow past common
    # filesystem path limits when joined with deeper subpaths.
    return cleaned[:64] or "user"


def slot_for(username: str | None) -> Path | None:
    """Return the credential slot for ``username``, creating it on first use.

    Returns ``None`` when ``username`` is falsy so callers can fall
    back to the server-global ``cursor-agent`` install (mostly useful
    for the boot-time model discovery probe which has no logged-in
    user yet).
    """
    if not username:
        return None
    slot = _DATA_DIR / _sanitize(username)
    slot.mkdir(parents=True, exist_ok=True)
    # Pre-create the ``.cursor`` subdir so cursor-agent's auth.json
    # write doesn't trip on missing parents the very first time we
    # run it.
    (slot / ".cursor").mkdir(parents=True, exist_ok=True)
    return slot


def env_for(
    username: str | None,
    base_env: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build a subprocess env that redirects cursor-agent to the user's slot.

    Falls back to the inherited environment when ``username`` is None,
    so legacy server-global behaviour still works for callers that
    don't pass user context (e.g. discovery at boot).

    Auto-hydrates the slot from the persistence store on first use
    after a fresh container start — this is what makes uploaded
    credentials survive Render's ephemeral filesystem. The hydration
    is best-effort: failures log a warning but don't block the env
    build, since cursor-agent will then correctly report
    "authentication required" and the orchestrator will fall back to
    Gemini.

    On Windows, ``HOMEDRIVE``/``HOMEPATH`` are set as a belt-and-braces
    fallback for libraries that read those instead of ``USERPROFILE``.
    """
    env = dict(base_env if base_env is not None else os.environ)
    slot = slot_for(username)
    if slot is None:
        return env
    # Lazy hydration: if the local slot doesn't have an auth.json
    # (because the container is fresh / disk was wiped), try to
    # restore from the persistent store before cursor-agent reads it.
    try:
        _maybe_hydrate_from_persistence(username, slot)
    except Exception:  # noqa: BLE001 — never block the call path
        logger.exception(
            "cursor credential hydration failed for %s (continuing without).",
            username,
        )
    slot_str = str(slot)
    # Node's ``os.homedir()`` resolves ``USERPROFILE`` first on Windows
    # and ``HOME`` on POSIX. Set both so cursor-agent treats the slot
    # as the user's home no matter which platform we're on.
    env["HOME"] = slot_str
    env["USERPROFILE"] = slot_str
    if os.name == "nt":
        # Split "C:\Users\foo\..." into drive + path so anything that
        # falls back to HOMEDRIVE+HOMEPATH still resolves into the slot.
        drive, sep, rest = slot_str.partition(":")
        if sep:
            env["HOMEDRIVE"] = drive + ":"
            env["HOMEPATH"] = rest or "\\"
    return env


def get_current_user() -> str | None:
    """Return the username the active orchestrator call was made for."""
    return _current_user.get()


def set_current_user(username: str | None):
    """Push ``username`` onto the contextvar; return a token for ``reset``."""
    return _current_user.set(username)


def reset_current_user(token) -> None:
    """Pop the contextvar back to its previous value."""
    _current_user.reset(token)


def _list_models_blob(binary: str, username: str | None) -> tuple[str, str]:
    """Run ``cursor-agent --list-models`` and return (combined_blob, low_blob)."""
    try:
        result = subprocess.run(  # noqa: S603 — args are server-controlled
            [binary, "--list-models"], capture_output=True, text=True,
            encoding="utf-8", timeout=8, check=False,
            env=env_for(username),
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return "", ""
    blob = (result.stdout or "") + "\n" + (result.stderr or "")
    return blob, blob.lower()


def is_logged_in(binary: str, username: str | None) -> bool:
    """Strict probe: does ``cursor-agent --list-models`` return any models?

    Returns ``False`` for the unauthenticated case (auth markers in
    the output, or empty parseable catalog) and ``True`` only when at
    least one plausible model id appears.
    """
    if not binary:
        return False
    blob, blob_low = _list_models_blob(binary, username)
    if not blob:
        return False
    if any(marker in blob_low for marker in _AUTH_REQUIRED_MARKERS):
        return False
    for raw in blob.splitlines():
        tok = raw.strip().strip("*").strip("-").strip()
        if not tok or " " in tok or "\t" in tok:
            continue
        low = tok.lower()
        if low.startswith(("#", "error", "available")):
            continue
        return True
    return False


def discover_models_for(binary: str, username: str | None) -> list[str]:
    """List models cursor-agent advertises for the user's seat.

    Mirrors the parsing logic of ``is_logged_in`` but returns the full
    catalog instead of a yes/no signal. Returns ``[]`` when the seat
    isn't authenticated or the probe fails — callers should merge with
    a static fallback catalog so the dropdown stays useful.
    """
    if not binary:
        return []
    blob, blob_low = _list_models_blob(binary, username)
    if not blob:
        return []
    if any(marker in blob_low for marker in _AUTH_REQUIRED_MARKERS):
        return []
    models: list[str] = []
    for raw in blob.splitlines():
        tok = raw.strip().strip("*").strip("-").strip()
        if not tok or " " in tok or "\t" in tok:
            continue
        low = tok.lower()
        if low.startswith(("#", "error", "available")):
            continue
        models.append(tok)
    return sorted(set(models))


def slot_exists(username: str | None) -> bool:
    """Cheap existence check used by /cursor/status to avoid a subprocess
    spawn for users who've never even attempted login.
    """
    if not username:
        return False
    return (_DATA_DIR / _sanitize(username) / ".cursor").exists()


# ---------------------------------------------------------------------------
# Credential upload — headless prod (Render etc.) workflow
# ---------------------------------------------------------------------------
#
# On a headless server there is no desktop session for ``cursor-agent
# login`` to open a browser into, so the browser-spawn path documented
# above silently fails. The escape hatch is for each user to run
# ``cursor-agent login`` ONCE on their own laptop and upload the
# resulting ``auth.json`` (or a tarball / zip of their whole
# ``~/.cursor/`` directory) to the QA Studio server, which lands it in
# the user's per-user slot exactly as if the browser flow had run on
# the server.
#
# The two helpers below are the security-sensitive bits: they validate
# the upload, refuse path-traversal members in archives, and write
# atomically so a partially-uploaded blob can't bork an existing
# working seat.
# ---------------------------------------------------------------------------


def install_auth_json(username: str | None, blob: bytes) -> Path:
    """Write an uploaded ``auth.json`` into the user's slot.

    Validates the payload is well-formed JSON (cursor-agent would
    choke on a corrupt file at the next call so we'd rather reject
    here, with a clear error, than silently break the next agent
    run). Writes via a temp file + atomic rename so a half-uploaded
    request can't replace a previously-working auth file with junk.

    Returns the final path of ``auth.json`` for logging convenience.
    Raises ``ValueError`` on any validation failure so the caller can
    surface a 400 to the client.
    """
    if not username:
        raise ValueError("install_auth_json: username is required")
    try:
        decoded = blob.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError(
            "Uploaded file is not valid UTF-8 text. If you exported a "
            "tarball of ~/.cursor, upload it as .tgz instead.",
        ) from exc
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Uploaded file isn't valid JSON: {exc.msg} (line {exc.lineno}). "
            "Make sure you uploaded the auth.json file from ~/.cursor/.",
        ) from exc
    if not isinstance(parsed, dict):
        raise ValueError(
            "auth.json must be a JSON object at the top level — got "
            f"{type(parsed).__name__}.",
        )
    slot = slot_for(username)
    if slot is None:
        raise ValueError("Could not create the per-user credential slot.")
    auth_path = slot / ".cursor" / "auth.json"
    auth_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = auth_path.with_suffix(".json.tmp")
    # Round-trip through json.dumps so we strip any trailing junk and
    # land a canonical representation (matches what `cursor-agent
    # login` would have written natively).
    tmp_path.write_text(json.dumps(parsed), encoding="utf-8")
    tmp_path.replace(auth_path)
    return auth_path


def _is_safe_archive_member(name: str) -> bool:
    """Reject absolute paths and ``..`` segments in archive members.

    Belt-and-braces guard so a maliciously-crafted upload can't escape
    the user's credential slot and write into the rest of the
    filesystem.
    """
    if not name or name in (".", "/"):
        return False
    norm = name.replace("\\", "/").lstrip("./")
    if norm.startswith("/"):
        return False
    parts = Path(norm).parts
    return ".." not in parts and not any(p.startswith("/") for p in parts)


def install_auth_archive(username: str | None, blob: bytes, filename: str) -> Path:
    """Extract an uploaded ``.tgz`` / ``.tar.gz`` / ``.tar`` / ``.zip``
    bundle of ``~/.cursor/`` contents into the user's slot.

    Hardened against path traversal — any member with an absolute
    path or ``..`` segment is rejected outright, and the resolved
    extraction path of every member must stay within the target
    directory.

    Returns the final ``.cursor/`` directory path. Raises
    ``ValueError`` on any validation failure.
    """
    if not username:
        raise ValueError("install_auth_archive: username is required")
    slot = slot_for(username)
    if slot is None:
        raise ValueError("Could not create the per-user credential slot.")
    target = slot / ".cursor"
    target.mkdir(parents=True, exist_ok=True)
    target_resolved = target.resolve()

    fname_low = (filename or "").lower()
    bio = BytesIO(blob)
    members_extracted = 0
    try:
        if fname_low.endswith(".zip"):
            with zipfile.ZipFile(bio) as zf:
                for info in zf.infolist():
                    if info.is_dir():
                        continue
                    if not _is_safe_archive_member(info.filename):
                        raise ValueError(
                            f"Refused unsafe archive member: {info.filename!r}",
                        )
                    dest = (target / info.filename).resolve()
                    if not str(dest).startswith(str(target_resolved)):
                        raise ValueError(
                            f"Refused path-traversal member: {info.filename!r}",
                        )
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(info, "r") as src, dest.open("wb") as out:
                        shutil.copyfileobj(src, out)
                    members_extracted += 1
        else:
            # tar / tar.gz / tgz — let tarfile auto-detect compression.
            with tarfile.open(fileobj=bio, mode="r:*") as tf:
                for member in tf.getmembers():
                    if not member.isfile():
                        # Skip directories, symlinks, devices etc. — we
                        # only want plain files in a cursor auth bundle.
                        continue
                    if not _is_safe_archive_member(member.name):
                        raise ValueError(
                            f"Refused unsafe archive member: {member.name!r}",
                        )
                    dest = (target / member.name).resolve()
                    if not str(dest).startswith(str(target_resolved)):
                        raise ValueError(
                            f"Refused path-traversal member: {member.name!r}",
                        )
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    src = tf.extractfile(member)
                    if src is None:
                        continue
                    with src, dest.open("wb") as out:
                        shutil.copyfileobj(src, out)
                    members_extracted += 1
    except (tarfile.TarError, zipfile.BadZipFile) as exc:
        raise ValueError(
            f"Uploaded archive is not a valid tar/zip: {exc}",
        ) from exc

    if members_extracted == 0:
        raise ValueError(
            "Archive extracted no files. Make sure you packed the "
            "contents of ~/.cursor/ (not the parent dir).",
        )
    if not (target / "auth.json").exists():
        # Don't fail — some seats may store auth under a different
        # filename — but warn so the caller can surface a hint if
        # cursor-agent still reports "not authenticated".
        logger.warning(
            "Archive upload for %s extracted %d files but no auth.json — "
            "cursor-agent may still report 'not authenticated'.",
            username, members_extracted,
        )
    return target


# ---------------------------------------------------------------------------
# Persistence — survive Render's ephemeral filesystem
# ---------------------------------------------------------------------------
#
# Render (and any other PaaS without a persistent disk attached) wipes
# the container filesystem on every restart, redeploy, or idle
# scale-down. Without a side-channel, every user would have to
# re-upload their auth.json each time the container cycles — usually
# multiple times a day on the free/starter plans.
#
# We solve that by snapshotting the user's ``.cursor/`` directory to:
#
#   * Firestore (collection ``cursor_credentials``, doc per user) when
#     STORAGE_BACKEND=firestore — encrypted via secret_fields so the
#     OAuth token never lands in plaintext at rest.
#   * A local JSON sidecar (``data/cursor-auth/_persisted.json``) when
#     STORAGE_BACKEND=local — same shape, different durable store.
#
# The snapshot is a dict { relative_path: base64(file_bytes) } so we
# capture EVERY file inside ``.cursor/`` — some cursor-agent builds
# need more than just auth.json (e.g. a refresh token cache).
#
# Hydration runs lazily from ``env_for`` whenever the local slot
# misses ``.cursor/auth.json`` so the first cursor-agent call after a
# restart re-materialises the credentials transparently. A per-user
# lock prevents a thundering-herd of concurrent requests from racing
# to write the same files.
# ---------------------------------------------------------------------------

_PERSIST_LOCAL_FILE = _DATA_DIR / "_persisted.json"
# Per-user hydrate locks — prevents simultaneous requests from
# racing to write the same .cursor/ contents during cold-start
# fan-out. Keyed by sanitised username so the lock acquisition is
# itself thread-safe via the dict.setdefault idiom.
_HYDRATE_LOCKS: dict[str, threading.Lock] = {}
_HYDRATE_LOCKS_GUARD = threading.Lock()
# Per-user "we already tried to hydrate this slot during the current
# container lifetime" flag — keeps env_for() cheap on hot paths
# (every cursor-agent generate / stream call) by skipping the disk
# probe + Firestore round-trip after the first miss.
_HYDRATED_USERS: set[str] = set()


def _hydrate_lock(username: str) -> threading.Lock:
    """Return (or create) the per-user hydrate lock."""
    key = _sanitize(username)
    with _HYDRATE_LOCKS_GUARD:
        lock = _HYDRATE_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _HYDRATE_LOCKS[key] = lock
        return lock


def _snapshot_slot(slot: Path) -> dict[str, str]:
    """Return { relative_path: base64(contents) } for every file under
    ``<slot>/.cursor/``.

    Empty dict when the .cursor directory is empty — the caller treats
    that as "no credentials to persist" and skips the write.
    """
    root = slot / ".cursor"
    if not root.exists():
        return {}
    out: dict[str, str] = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        # Cap individual file size at 256 KiB — auth.json is ~1 KB
        # so anything larger is almost certainly cache bloat we don't
        # need to mirror. Keeps Firestore doc size well under the
        # 1 MiB hard limit.
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > 256 * 1024:
            logger.warning(
                "Skipping %s (%d bytes) from persistence snapshot — over 256 KiB cap.",
                path, size,
            )
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        rel = path.relative_to(root).as_posix()
        # Sanity: refuse any rel path that escapes (defensive — rglob
        # under root shouldn't produce these, but a malicious symlink
        # in the slot could).
        if rel.startswith("/") or ".." in Path(rel).parts:
            continue
        out[rel] = base64.b64encode(data).decode("ascii")
    return out


def _materialise_snapshot(slot: Path, snapshot: dict[str, str]) -> int:
    """Inverse of _snapshot_slot — write decoded bytes back to disk.

    Returns the number of files written. Atomic per-file via temp +
    rename so a concurrent reader (cursor-agent) never sees a
    half-written auth.json.
    """
    if not snapshot:
        return 0
    root = slot / ".cursor"
    root.mkdir(parents=True, exist_ok=True)
    root_resolved = root.resolve()
    written = 0
    for rel, b64 in snapshot.items():
        if not isinstance(rel, str) or not isinstance(b64, str):
            continue
        if rel.startswith("/") or ".." in Path(rel).parts:
            continue
        try:
            data = base64.b64decode(b64, validate=True)
        except (ValueError, binascii.Error):
            # base64.b64decode raises binascii.Error on invalid input;
            # ValueError covers other corruption modes.
            logger.warning("Bad base64 in persisted snapshot key=%s; skipping.", rel)
            continue
        dest = (root / rel).resolve()
        if not str(dest).startswith(str(root_resolved)):
            logger.warning("Refusing path-traversal entry: %s", rel)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(dest)
        written += 1
    return written


def _local_load_all_persisted() -> dict[str, dict[str, str]]:
    """Read the local JSON sidecar (or return {} when missing/corrupt)."""
    if not _PERSIST_LOCAL_FILE.is_file():
        return {}
    try:
        raw = json.loads(_PERSIST_LOCAL_FILE.read_text("utf-8"))
    except (json.JSONDecodeError, OSError):
        logger.exception("Persisted cursor-credentials file is unreadable.")
        return {}
    if not isinstance(raw, dict):
        return {}
    return raw


def _local_save_all_persisted(data: dict[str, dict[str, str]]) -> None:
    """Atomic-write the local JSON sidecar."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _PERSIST_LOCAL_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(_PERSIST_LOCAL_FILE)


def _persist_snapshot(username: str, snapshot: dict[str, str]) -> bool:
    """Write a slot snapshot to whichever persistent store is configured.

    The snapshot is wrapped as a single JSON blob and encrypted with
    secret_fields so the OAuth token never lands in plaintext at rest
    (Firestore + local-file paths both encrypted when an
    ENCRYPTION_MASTER_KEY is set; otherwise stored as-is, mirroring
    the rest of the user store).

    Returns True on a successful write.
    """
    if not username:
        return False
    if not snapshot:
        # Empty slot — nothing meaningful to persist. Treat as a
        # no-op rather than writing an empty doc.
        return False
    key = _sanitize(username)
    blob = json.dumps(snapshot, separators=(",", ":"))
    encrypted = secret_fields.encrypt_secret(blob) or blob
    payload = {
        "username": username,
        "blob": encrypted,
        "files": sorted(snapshot.keys()),
    }
    try:
        if firestore_db.is_enabled():
            db = firestore_db.get_db()
            db.collection(firestore_db.CURSOR_CREDENTIALS).document(key).set(payload)
        else:
            store = _local_load_all_persisted()
            store[key] = payload
            _local_save_all_persisted(store)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to persist cursor credentials for %s.", username,
        )
        return False
    logger.info(
        "Persisted cursor credentials for %s (%d files, backend=%s).",
        username, len(snapshot),
        "firestore" if firestore_db.is_enabled() else "local",
    )
    return True


def _load_persisted_snapshot(username: str) -> dict[str, str] | None:
    """Inverse of _persist_snapshot — fetch the user's last-saved snapshot."""
    if not username:
        return None
    key = _sanitize(username)
    payload: dict | None = None
    try:
        if firestore_db.is_enabled():
            db = firestore_db.get_db()
            doc = db.collection(firestore_db.CURSOR_CREDENTIALS).document(key).get()
            if doc.exists:
                payload = doc.to_dict() or {}
        else:
            store = _local_load_all_persisted()
            payload = store.get(key)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to load persisted cursor credentials for %s.", username,
        )
        return None
    if not payload:
        return None
    blob = payload.get("blob")
    if not isinstance(blob, str) or not blob:
        return None
    decrypted = secret_fields.decrypt_secret(blob) or blob
    try:
        snapshot = json.loads(decrypted)
    except json.JSONDecodeError:
        logger.exception(
            "Persisted cursor blob for %s is not valid JSON.", username,
        )
        return None
    if not isinstance(snapshot, dict):
        return None
    return {k: v for k, v in snapshot.items() if isinstance(k, str) and isinstance(v, str)}


def _delete_persisted_snapshot(username: str) -> bool:
    """Wipe the user's persistent snapshot — called on logout."""
    if not username:
        return False
    key = _sanitize(username)
    try:
        if firestore_db.is_enabled():
            db = firestore_db.get_db()
            db.collection(firestore_db.CURSOR_CREDENTIALS).document(key).delete()
        else:
            store = _local_load_all_persisted()
            if key in store:
                store.pop(key, None)
                _local_save_all_persisted(store)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Failed to delete persisted cursor credentials for %s.", username,
        )
        return False
    # Reset the per-process "already hydrated" marker so a subsequent
    # upload + restart cycle re-hydrates correctly.
    _HYDRATED_USERS.discard(key)
    return True


def persist_slot(username: str | None) -> bool:
    """Snapshot the user's current slot to the persistence store.

    Public entry point used by the upload + login routes after a
    successful install. Idempotent — safe to call repeatedly.
    """
    if not username:
        return False
    slot = slot_for(username)
    if slot is None:
        return False
    snapshot = _snapshot_slot(slot)
    if not snapshot:
        logger.info(
            "persist_slot: %s slot is empty; nothing to persist.", username,
        )
        return False
    return _persist_snapshot(username, snapshot)


def _maybe_hydrate_from_persistence(username: str | None, slot: Path) -> bool:
    """Re-materialise the user's .cursor/ from the persistence store
    when the local slot has lost it (e.g. fresh container after a
    Render restart).

    Called from ``env_for`` on every cursor-agent invocation so the
    first call after a restart silently recovers the user's seat.

    Skipped on hot paths: once we've checked a user's slot during
    this container's lifetime we don't probe again (tracked in
    ``_HYDRATED_USERS``) — subsequent calls go straight to the env
    build without disk / Firestore round-trips.
    """
    if not username:
        return False
    key = _sanitize(username)
    if key in _HYDRATED_USERS:
        return False
    auth_file = slot / ".cursor" / "auth.json"
    # Fast path: slot already has the file, nothing to do — mark
    # hydrated so we don't probe again.
    if auth_file.exists():
        _HYDRATED_USERS.add(key)
        return False
    # Serialise concurrent hydration attempts for the same user — if
    # ten requests fan out on cold start they should all wait while
    # ONE materialises the snapshot.
    with _hydrate_lock(username):
        # Double-check after acquiring the lock — another thread may
        # have just hydrated us.
        if auth_file.exists():
            _HYDRATED_USERS.add(key)
            return False
        snapshot = _load_persisted_snapshot(username)
        if not snapshot:
            # No persisted state — mark hydrated so we don't keep
            # paying the lookup cost on every call. Re-attempts after
            # a successful upload reset the flag via persist_slot.
            _HYDRATED_USERS.add(key)
            return False
        written = _materialise_snapshot(slot, snapshot)
        _HYDRATED_USERS.add(key)
        if written:
            logger.info(
                "Hydrated cursor credentials for %s (%d files restored).",
                username, written,
            )
            return True
    return False


def clear_slot(username: str | None) -> bool:  # noqa: F811 — overrides the simple definition above
    """Wipe the user's cursor credentials from BOTH the local slot AND
    the persistence store.

    Re-declared here (overriding the earlier slot-only version) so
    /cursor/logout, which calls this single function, also clears the
    persistent copy — otherwise a logout followed by a container
    restart would silently re-hydrate the user back in.

    Returns True when something was actually removed in either store.
    """
    if not username:
        return False
    key = _sanitize(username)
    # Reset the per-process hydration cache eagerly so a subsequent
    # upload + restart re-runs the hydration path.
    _HYDRATED_USERS.discard(key)
    slot_removed = False
    slot = _DATA_DIR / key
    if slot.exists():
        try:
            shutil.rmtree(slot, ignore_errors=False)
            slot_removed = True
        except OSError:
            logger.exception("Failed to fully clear cursor slot for %s", username)
            shutil.rmtree(slot, ignore_errors=True)
            slot_removed = True
    persisted_removed = _delete_persisted_snapshot(username)
    return slot_removed or persisted_removed
