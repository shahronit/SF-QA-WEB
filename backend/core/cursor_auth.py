"""Per-user Cursor CLI credential management.

The ``cursor-agent`` CLI authenticates by writing OAuth tokens to its
platform-conventional app-data directory:

  * Windows : ``%APPDATA%\\Cursor\\auth.json``
                (= ``C:\\Users\\<u>\\AppData\\Roaming\\Cursor\\auth.json``)
  * macOS   : ``~/Library/Application Support/Cursor/auth.json``
  * Linux   : ``$XDG_CONFIG_HOME/Cursor/auth.json``
                (default ``~/.config/Cursor/auth.json``)

Older builds also dropped files under ``~/.cursor/`` so we keep that
location as a recognised secondary path for the auth probe + the
auth.json-upload flow.

To give every QA Studio user their OWN Cursor seat, we redirect those
directories per-user by overriding ``HOME`` / ``USERPROFILE`` /
``APPDATA`` / ``LOCALAPPDATA`` / ``XDG_CONFIG_HOME`` in the
subprocess environment to point inside the user's slot at
``backend/data/cursor-auth/<username>/``.

The single most common bug here was forgetting to redirect ``APPDATA``
on Windows: ``USERPROFILE`` redirection alone was NOT enough because
Windows resolves ``%APPDATA%`` independently (not from
``%USERPROFILE%\\AppData\\Roaming``). With the old code,
``cursor-agent login`` happily wrote ``auth.json`` to the OS-user's
real ``%APPDATA%`` while QA Studio kept looking for it under the slot
— and surfaced "Sign-in didn't complete" even when the cursor-agent
process had clearly logged in. The current code overrides APPDATA too
and recognises the modern location as a first-class auth path.

This module is the single source of truth for:

  * resolving the per-user slot path (``slot_for``),
  * building the subprocess env that points cursor-agent at it
    (``env_for``),
  * detecting where cursor-agent dropped ``auth.json`` after a fresh
    login (``_auth_paths_for_slot``),
  * a contextvar-based "current cursor user" so providers running
    under ``orch.run_agent(username=...)`` automatically pick up the
    right credentials without changing the ``LLMProvider`` protocol
    signature.

Multi-user prod note: the browser-less login flow (the Sidebar's
Re-Login button) works on every platform because the OAuth tab opens
in the USER's browser, not the server's. The headless deployment
escape hatch (auth.json upload) is implemented below — see
``install_auth_json`` / ``install_auth_archive``.
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
import sys
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

# Pattern emitted by ``cursor-agent login`` (with NO_OPEN_BROWSER=1)
# that contains the OAuth URL the user needs to visit. Verified
# empirically: cursor-agent prints
#     "Open a browser and navigate to this link: https://cursor.com/loginDeepControl?challenge=...&uuid=...&mode=login&redirectTarget=cli"
# then polls cursor.com until the auth completes. We extract the URL
# from any line containing it (line prefix may shift between
# cursor-agent versions, so we match the URL substring directly).
_LOGIN_URL_PATTERN = re.compile(
    r"https://[^\s]*cursor\.com/loginDeepControl[^\s]*",
    re.IGNORECASE,
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


def _cursor_data_subpath() -> str:
    """Slot-relative path of the directory that contains ``Cursor/auth.json``.

    Mirrors Electron's ``app.getPath('appData')`` semantics — that's
    where ``cursor-agent`` writes its OAuth tokens after a fresh login
    on the current OS:

      * Windows : ``AppData/Roaming``         (relative to ``%APPDATA%``)
      * macOS   : ``Library/Application Support``
      * Linux   : ``.config``                 (relative to ``$XDG_CONFIG_HOME``
                                               which defaults to ``~/.config``)

    cursor-agent itself appends ``Cursor/auth.json`` so the full
    per-slot path becomes ``<slot>/<this>/Cursor/auth.json``.
    """
    if os.name == "nt":
        return "AppData/Roaming"
    if sys.platform == "darwin":
        return "Library/Application Support"
    return ".config"


def _auth_paths_for_slot(slot: Path) -> list[Path]:
    """Every plausible ``auth.json`` location inside ``slot``.

    The first entry is the *modern* OS-specific path that
    ``cursor-agent login`` writes on the current host. The second is
    the legacy ``~/.cursor/auth.json`` path — kept as a fallback so:

      * older cursor-agent builds (which DID write there) keep working,
      * the auth.json-upload flow that historically landed files at
        the legacy path still satisfies the "is the user signed in?"
        probe even after the upgrade,
      * cross-OS slot snapshots (e.g. uploaded from a Windows laptop,
        hydrated on a Render Linux container) keep working.
    """
    return [
        slot / _cursor_data_subpath() / "Cursor" / "auth.json",
        slot / ".cursor" / "auth.json",
    ]


def slot_for(username: str | None) -> Path | None:
    """Return the credential slot for ``username``, creating it on first use.

    Returns ``None`` when ``username`` is falsy so callers can fall
    back to the server-global ``cursor-agent`` install (mostly useful
    for the boot-time model discovery probe which has no logged-in
    user yet).

    Pre-creates BOTH the legacy ``.cursor/`` subdir AND the modern
    ``<cursor-data-subpath>/Cursor/`` subdir so cursor-agent's first
    write doesn't trip on missing parent directories — the binary
    expects the parent of its target ``auth.json`` to already exist
    on some platforms.
    """
    if not username:
        return None
    slot = _DATA_DIR / _sanitize(username)
    slot.mkdir(parents=True, exist_ok=True)
    (slot / ".cursor").mkdir(parents=True, exist_ok=True)
    (slot / _cursor_data_subpath() / "Cursor").mkdir(parents=True, exist_ok=True)
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

    Per-platform overrides (so the auth.json path cursor-agent writes
    to actually lands inside the slot):

      * Windows : ``USERPROFILE`` + ``HOMEDRIVE``/``HOMEPATH`` (for
        libs that read those) + ``APPDATA``/``LOCALAPPDATA`` (where
        cursor-agent ACTUALLY writes ``auth.json`` — Windows resolves
        ``%APPDATA%`` independently of ``%USERPROFILE%`` so just
        redirecting the latter was not enough).
      * macOS   : ``HOME``  (``Library/Application Support`` is
        derived from ``HOME`` natively).
      * Linux   : ``HOME`` + ``XDG_CONFIG_HOME`` (the latter is set
        explicitly because operators sometimes customise it to point
        outside ``$HOME``, which would defeat the slot redirection).
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
        # Critical: cursor-agent persists auth.json under
        # ``%APPDATA%\Cursor\``, NOT ``~/.cursor\``. Without this
        # redirect the freshly-written tokens leak into the OS-user's
        # real %APPDATA%, the per-slot probe never sees them, and the
        # UI shows "Sign-in didn't complete" even when the browser
        # OAuth has obviously succeeded.
        env["APPDATA"] = str(slot / "AppData" / "Roaming")
        env["LOCALAPPDATA"] = str(slot / "AppData" / "Local")
    else:
        # Linux: ``cursor-agent`` reads $XDG_CONFIG_HOME (defaulting to
        # ``~/.config``) for the Cursor sub-tree. Set it explicitly so
        # operators who've remapped XDG dirs elsewhere don't bypass
        # the slot redirection. On macOS the default location lives
        # under ``$HOME/Library/Application Support`` which is already
        # redirected by the ``HOME`` override above, so we don't need
        # an extra var there.
        env["XDG_CONFIG_HOME"] = str(slot / ".config")
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

    True iff the per-user slot directory itself exists — covers both
    the legacy ``.cursor/`` subdir and the modern OS-specific
    ``AppData/Roaming/Cursor`` (Windows) /
    ``Library/Application Support/Cursor`` (macOS) /
    ``.config/Cursor`` (Linux) layouts that ``slot_for`` pre-creates
    on the first login attempt.
    """
    if not username:
        return False
    return (_DATA_DIR / _sanitize(username)).exists()


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

    Lands the file at EVERY candidate path returned by
    ``_auth_paths_for_slot`` so:

      * cursor-agent on the running OS finds it via the modern
        (Windows / macOS / Linux) app-data path,
      * the legacy ``.cursor/auth.json`` location is also populated
        so cross-OS hydration (e.g. credentials uploaded from a
        Windows laptop, then mounted into a Linux container) still
        works.

    Returns the modern (OS-specific) path for logging convenience.
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
            "tarball of ~/.cursor or %APPDATA%\\Cursor, upload it as "
            ".tgz instead.",
        ) from exc
    try:
        parsed = json.loads(decoded)
    except json.JSONDecodeError as exc:
        raise ValueError(
            f"Uploaded file isn't valid JSON: {exc.msg} (line {exc.lineno}). "
            "Make sure you uploaded the auth.json file from your local "
            "Cursor install (see the upload hint in the sidebar for the "
            "OS-specific path).",
        ) from exc
    if not isinstance(parsed, dict):
        raise ValueError(
            "auth.json must be a JSON object at the top level — got "
            f"{type(parsed).__name__}.",
        )
    slot = slot_for(username)
    if slot is None:
        raise ValueError("Could not create the per-user credential slot.")
    # Round-trip through json.dumps so we strip any trailing junk and
    # land a canonical representation (matches what `cursor-agent
    # login` would have written natively).
    canonical = json.dumps(parsed)
    primary: Path | None = None
    for auth_path in _auth_paths_for_slot(slot):
        auth_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = auth_path.with_suffix(".json.tmp")
        tmp_path.write_text(canonical, encoding="utf-8")
        tmp_path.replace(auth_path)
        if primary is None:
            primary = auth_path
    if primary is None:  # defensive — _auth_paths_for_slot always returns ≥1
        raise ValueError("No auth.json target paths resolved for the slot.")
    return primary


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
            "contents of ~/.cursor/ (or %APPDATA%\\Cursor\\), not the "
            "parent dir.",
        )
    # Mirror the freshly-extracted ``auth.json`` (if any) into EVERY
    # known auth path so the running OS's cursor-agent can find it via
    # the modern app-data location, even when the user uploaded a
    # tarball produced on a different OS.
    extracted_auth = target / "auth.json"
    if extracted_auth.exists():
        try:
            canonical_blob = extracted_auth.read_bytes()
            for dest in _auth_paths_for_slot(slot):
                if dest == extracted_auth:
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                tmp = dest.with_suffix(dest.suffix + ".tmp")
                tmp.write_bytes(canonical_blob)
                tmp.replace(dest)
        except OSError:
            logger.exception(
                "Failed to mirror archive auth.json across slot paths for %s",
                username,
            )
    elif not any(p.exists() for p in _auth_paths_for_slot(slot)):
        # No auth.json at the legacy archive root AND none of the
        # canonical slot locations either — warn so the caller can
        # surface a hint if cursor-agent still reports "not
        # authenticated".
        logger.warning(
            "Archive upload for %s extracted %d files but no auth.json "
            "landed at any recognised location — cursor-agent may still "
            "report 'not authenticated'.",
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
# We solve that by snapshotting the user's slot to:
#
#   * Firestore (collection ``cursor_credentials``, doc per user) when
#     STORAGE_BACKEND=firestore — encrypted via secret_fields so the
#     OAuth token never lands in plaintext at rest.
#   * A local JSON sidecar (``data/cursor-auth/_persisted.json``) when
#     STORAGE_BACKEND=local — same shape, different durable store.
#
# The snapshot is a dict { slot_relative_path: base64(file_bytes) } so
# we capture every file inside BOTH the legacy ``.cursor/`` dir AND
# the modern OS-specific Cursor data dir (e.g.
# ``AppData/Roaming/Cursor/`` on Windows). Some cursor-agent builds
# need more than just auth.json (e.g. a refresh-token cache, the
# statsig client state) — capturing both roots makes us tolerant of
# whichever layout the running build happens to use.
#
# Hydration runs lazily from ``env_for`` whenever the local slot
# misses every recognised ``auth.json`` location so the first
# cursor-agent call after a restart re-materialises the credentials
# transparently. A per-user lock prevents a thundering-herd of
# concurrent requests from racing to write the same files.
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


def _snapshot_roots(slot: Path) -> list[tuple[Path, str]]:
    """Directories under *slot* whose contents we capture in a snapshot.

    Returns a list of ``(root, key_prefix)`` pairs. ``key_prefix`` is
    the path the snapshot keys use so we can rebuild the full slot
    layout on hydration:

      * the modern OS-specific Cursor data dir
        (``AppData/Roaming/Cursor`` on Windows etc.),
      * the legacy ``.cursor/`` directory (for uploaded credentials
        and the various ``agent-cli-state.json`` / ``cli-config.json``
        files cursor-agent has historically written there).
    """
    modern_prefix = f"{_cursor_data_subpath()}/Cursor"
    return [
        (slot / modern_prefix, modern_prefix),
        (slot / ".cursor", ".cursor"),
    ]


def _snapshot_slot(slot: Path) -> dict[str, str]:
    """Return { slot_relative_path: base64(contents) } for every file in
    the snapshot roots under ``slot``.

    Empty dict when both roots are empty (or non-existent) — the
    caller treats that as "no credentials to persist" and skips the
    write.

    Snapshot keys are recorded relative to the SLOT ROOT (so e.g.
    ``.cursor/auth.json`` or ``AppData/Roaming/Cursor/auth.json``).
    The materialiser below knows how to translate legacy
    relative-to-``.cursor`` keys (no slash, no prefix) so existing
    persisted snapshots still hydrate cleanly after this upgrade.
    """
    out: dict[str, str] = {}
    for root, prefix in _snapshot_roots(slot):
        if not root.exists():
            continue
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
            rel_in_root = path.relative_to(root).as_posix()
            key = f"{prefix}/{rel_in_root}"
            # Sanity: refuse any rel path that escapes (defensive — rglob
            # under root shouldn't produce these, but a malicious symlink
            # in the slot could).
            if key.startswith("/") or ".." in Path(key).parts:
                continue
            out[key] = base64.b64encode(data).decode("ascii")
    return out


def _materialise_snapshot(slot: Path, snapshot: dict[str, str]) -> int:
    """Inverse of ``_snapshot_slot`` — write decoded bytes back to disk.

    Handles both:

      * new-format keys (relative to the slot — e.g.
        ``.cursor/auth.json`` or
        ``AppData/Roaming/Cursor/auth.json``),
      * legacy-format keys (just a filename relative to ``.cursor/``,
        as written by the pre-Apr-2026 snapshot code).

    Legacy keys are detected by the absence of any path separator
    AND the absence of a ``.cursor`` / app-data prefix, and rewritten
    to live under ``.cursor/`` so post-upgrade hydration produces the
    same layout the snapshot was taken from. After restoring legacy
    keys we ALSO mirror ``.cursor/auth.json`` (if present) into the
    current OS's modern Cursor data dir so a freshly-hydrated user
    can sign in without re-uploading on the new layout.

    Returns the number of files written. Atomic per-file via temp +
    rename so a concurrent reader (cursor-agent) never sees a
    half-written auth.json.
    """
    if not snapshot:
        return 0
    slot.mkdir(parents=True, exist_ok=True)
    slot_resolved = slot.resolve()
    written = 0
    saw_modern_auth = False
    for raw_key, b64 in snapshot.items():
        if not isinstance(raw_key, str) or not isinstance(b64, str):
            continue
        # Normalise Windows-style separators to POSIX, but otherwise
        # leave the key untouched for the traversal checks below.
        key = raw_key.replace("\\", "/")
        # Legacy snapshot keys are a bare relative-to-``.cursor/`` path
        # (e.g. ``auth.json`` or ``state/foo.json``). They never start
        # with ``.cursor/`` or the platform app-data prefix because
        # the old snapshotter scanned ``<slot>/.cursor/`` directly.
        # Detect them by checking if the key matches a known prefix —
        # if not, treat as legacy.
        modern_prefix = f"{_cursor_data_subpath()}/Cursor/"
        if not (key.startswith(".cursor/") or key.startswith(modern_prefix)):
            key = f".cursor/{key}"
        if key.startswith("/") or ".." in Path(key).parts:
            logger.warning("Refusing path-traversal entry: %s", raw_key)
            continue
        try:
            data = base64.b64decode(b64, validate=True)
        except (ValueError, binascii.Error):
            # base64.b64decode raises binascii.Error on invalid input;
            # ValueError covers other corruption modes.
            logger.warning("Bad base64 in persisted snapshot key=%s; skipping.", raw_key)
            continue
        dest = (slot / key).resolve()
        if not str(dest).startswith(str(slot_resolved)):
            logger.warning("Refusing path-traversal entry: %s", raw_key)
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(dest)
        written += 1
        if key == f"{modern_prefix}auth.json":
            saw_modern_auth = True
    # Cross-OS portability: if the snapshot only contained the legacy
    # ``.cursor/auth.json`` (typical for snapshots taken before the
    # APPDATA-redirection fix), ALSO mirror it into the current OS's
    # modern Cursor data dir so the running cursor-agent finds it
    # without an extra re-upload step.
    if not saw_modern_auth:
        legacy_auth = slot / ".cursor" / "auth.json"
        modern_auth = slot / _cursor_data_subpath() / "Cursor" / "auth.json"
        if legacy_auth.exists() and not modern_auth.exists():
            try:
                modern_auth.parent.mkdir(parents=True, exist_ok=True)
                tmp = modern_auth.with_suffix(modern_auth.suffix + ".tmp")
                tmp.write_bytes(legacy_auth.read_bytes())
                tmp.replace(modern_auth)
                written += 1
            except OSError:
                logger.exception(
                    "Failed to mirror legacy auth.json into modern Cursor "
                    "data dir after hydration (slot=%s).", slot,
                )
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
    auth_files = _auth_paths_for_slot(slot)
    # Fast path: slot already has at least one recognised auth.json,
    # nothing to do — mark hydrated so we don't probe again.
    if any(p.exists() for p in auth_files):
        _HYDRATED_USERS.add(key)
        return False
    # Serialise concurrent hydration attempts for the same user — if
    # ten requests fan out on cold start they should all wait while
    # ONE materialises the snapshot.
    with _hydrate_lock(username):
        # Double-check after acquiring the lock — another thread may
        # have just hydrated us.
        if any(p.exists() for p in auth_files):
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
    # Cancel any in-flight login subprocess for the same user — its
    # output is no longer useful if the user is logging out, and we
    # don't want a stale process re-creating an auth.json after we
    # just wiped the slot.
    cancel_login(username)
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


# ---------------------------------------------------------------------------
# Browser-less ``cursor-agent login`` sessions
# ---------------------------------------------------------------------------
#
# On a headless server we can't let cursor-agent open the OAuth tab in
# the server's own browser — there isn't one — so we run it with
# ``NO_OPEN_BROWSER=1`` and surface the printed sign-in URL to the
# caller. The cursor-agent process keeps polling cursor.com until the
# user completes auth in *their* browser, at which point it writes
# ``auth.json`` into the user's slot and exits cleanly. We snapshot
# the resulting slot to the persistent store so Render's ephemeral
# filesystem can't wipe the freshly-signed-in user out from under us
# on the next restart.
#
# State is kept in a module-level dict keyed by username so the
# frontend can poll for progress (``/cursor/login-status``) and so a
# double-clicked "Re-Login" button doesn't spawn a second process.

# Public state shape (mirrored to /cursor/login-status JSON). Keep
# strings short — the frontend re-uses these as toast text fallbacks.
_LoginSessionState = dict  # alias for readability


_LOGIN_SESSIONS: dict[str, _LoginSessionState] = {}
_LOGIN_SESSIONS_LOCK = threading.Lock()
# How long we'll block the /cursor/login HTTP request waiting for the
# URL line to appear in cursor-agent's stdout. Empirically the line
# shows up within ~2 seconds on a warm machine; 15s is the upper
# bound for cold-start / Render's slower hosts.
_LOGIN_URL_WAIT_SECONDS = 15.0
# Hard cap on how long a single login session can stay "in_progress"
# before we give up on it. The user typically completes OAuth within
# 60s — past 10 minutes it's almost certainly an abandoned tab and
# we'd rather time out than leak a subprocess on the host.
_LOGIN_OVERALL_TIMEOUT_SECONDS = 10 * 60


def _login_session_snapshot(state: _LoginSessionState) -> dict:
    """Return a JSON-safe copy of *state* for /cursor/login-status.

    Stripping the live Popen / Thread handles is required because
    they're not serialisable.
    """
    out = {
        k: v for k, v in state.items()
        if k not in {"_proc", "_thread", "_log_buf"}
    }
    return out


def get_login_session(username: str | None) -> dict | None:
    """Public read-only view of the user's current login session
    (or ``None`` when no session is active or recently completed).

    Used by the /cursor/login-status route — the frontend polls this
    every ~2 seconds while the user is on the sign-in tab.
    """
    if not username:
        return None
    key = _sanitize(username)
    with _LOGIN_SESSIONS_LOCK:
        state = _LOGIN_SESSIONS.get(key)
        if state is None:
            return None
        return _login_session_snapshot(state)


def cancel_login(username: str | None) -> bool:
    """Terminate any in-flight cursor-agent login process for *username*.

    Called by ``clear_slot`` (so logout invalidates an in-progress
    login) and exposed via the router for the frontend's "Cancel"
    button on the Re-Login modal.
    """
    if not username:
        return False
    key = _sanitize(username)
    with _LOGIN_SESSIONS_LOCK:
        state = _LOGIN_SESSIONS.get(key)
        if state is None:
            return False
        proc = state.get("_proc")
    if proc is None:
        return False
    try:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
    except (OSError, ProcessLookupError):
        pass
    with _LOGIN_SESSIONS_LOCK:
        state = _LOGIN_SESSIONS.get(key)
        if state is not None and state.get("status") in {"pending", "in_progress"}:
            state["status"] = "cancelled"
            state["message"] = "Login cancelled by user."
    return True


def _read_until_url(proc: subprocess.Popen, log_buf: list[bytes]) -> str | None:
    """Read from *proc*'s stdout until the cursor.com login URL appears
    (or the read times out / process exits).

    Captures every byte read into *log_buf* so callers can dump it on
    failure for debugging. Returns the URL string when found, ``None``
    otherwise.
    """
    if proc.stdout is None:
        return None
    deadline = __import__("time").time() + _LOGIN_URL_WAIT_SECONDS
    accumulated = b""
    while True:
        if proc.poll() is not None:
            # Process exited before printing a URL — bail out so the
            # caller can surface the captured stderr to the user.
            break
        remaining = deadline - __import__("time").time()
        if remaining <= 0:
            break
        try:
            chunk = proc.stdout.read1(1024) if hasattr(proc.stdout, "read1") else proc.stdout.read(1024)
        except (OSError, ValueError):
            break
        if not chunk:
            # EOF — wait briefly then re-check the deadline.
            __import__("time").sleep(0.05)
            continue
        log_buf.append(chunk)
        accumulated += chunk
        match = _LOGIN_URL_PATTERN.search(accumulated.decode("utf-8", errors="replace"))
        if match:
            return match.group(0).strip().rstrip(",.;)")
    return None


def _wait_for_login_completion(
    username: str,
    proc: subprocess.Popen,
    log_buf: list[bytes],
) -> None:
    """Background-thread worker that waits for cursor-agent to exit
    after the URL has been surfaced.

    On clean exit (rc == 0 and ``auth.json`` materialised) we
    snapshot the slot into the persistent store so the credentials
    survive a Render restart. On any failure we record the captured
    output on the session state so the frontend can show it.
    """
    key = _sanitize(username)
    try:
        rc = proc.wait(timeout=_LOGIN_OVERALL_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except (OSError, ProcessLookupError):
            pass
        with _LOGIN_SESSIONS_LOCK:
            state = _LOGIN_SESSIONS.get(key)
            if state is not None:
                state["status"] = "timeout"
                state["message"] = (
                    "Login timed out after 10 minutes. Click Re-Login to try again."
                )
        return
    # Drain any remaining stdout so the captured log is complete.
    try:
        if proc.stdout is not None:
            tail = proc.stdout.read() or b""
            if tail:
                log_buf.append(tail)
    except (OSError, ValueError):
        pass
    slot = slot_for(username)
    # cursor-agent writes ``auth.json`` to its OS-specific app-data
    # directory (``%APPDATA%\Cursor`` on Windows etc.) — see
    # ``_auth_paths_for_slot`` for the full list. Recognise EITHER the
    # modern OR the legacy location so the success path doesn't
    # falsely report "Sign-in didn't complete" while the freshly-
    # written tokens sit at the new path.
    auth_landed = slot is not None and any(
        p.exists() for p in _auth_paths_for_slot(slot)
    )
    if rc == 0 and auth_landed:
        # Mirror the freshly-written auth.json into Firestore /
        # local sidecar so the next container restart can re-hydrate.
        # ``persist_slot`` walks both the modern + legacy auth paths
        # via ``_snapshot_roots`` so wherever cursor-agent actually
        # landed the file gets captured.
        try:
            persist_slot(username)
        except Exception:  # noqa: BLE001
            logger.exception(
                "Persisting freshly logged-in cursor slot failed for %s",
                username,
            )
        with _LOGIN_SESSIONS_LOCK:
            state = _LOGIN_SESSIONS.get(key)
            if state is not None:
                state["status"] = "success"
                state["message"] = (
                    "Cursor sign-in complete. You can close the sign-in tab."
                )
                # Drop the URL once we're done — keeping it around in
                # state is just noise for the status endpoint.
                state.pop("login_url", None)
        return
    # Failure path: surface the last 1 KiB of captured output so the
    # user sees the actual cursor-agent error instead of a generic
    # "login failed" toast.
    tail = b"".join(log_buf)[-1024:].decode("utf-8", errors="replace")
    with _LOGIN_SESSIONS_LOCK:
        state = _LOGIN_SESSIONS.get(key)
        if state is not None:
            state["status"] = "failed"
            state["message"] = (
                f"cursor-agent exited {rc} without writing auth.json. "
                "See server logs."
            )
            state["error_tail"] = tail
    logger.warning(
        "cursor-agent login failed for %s (rc=%s, auth_landed=%s, tail=%r)",
        username, rc, auth_landed, tail,
    )


def start_login(
    username: str,
    binary: str,
    extra_env: dict[str, str] | None = None,
) -> dict:
    """Start a browser-less ``cursor-agent login`` session for *username*.

    Returns a JSON-safe state dict containing at least:
      * ``status``: 'in_progress' | 'failed' (when we couldn't even spawn)
      * ``login_url``: the cursor.com URL to navigate to (when status is in_progress)
      * ``message``: human-readable summary
      * ``pid``: the subprocess id (advisory; not a security primitive)

    If a session is already live for the same user, we return its
    current state instead of spawning a duplicate. Idempotent in the
    face of an impatient user double-clicking Re-Login.
    """
    if not username:
        raise ValueError("start_login: username required")
    key = _sanitize(username)
    with _LOGIN_SESSIONS_LOCK:
        existing = _LOGIN_SESSIONS.get(key)
        if existing is not None and existing.get("status") == "in_progress":
            proc = existing.get("_proc")
            # Only reuse when the process is actually still alive
            # (zombie sessions get cleared below).
            if proc is not None and proc.poll() is None:
                return _login_session_snapshot(existing)
            # Process died unnoticed — fall through and spawn fresh.
            _LOGIN_SESSIONS.pop(key, None)
    slot = slot_for(username)
    if slot is None:
        raise ValueError("start_login: could not resolve slot for username")
    spawn_env = env_for(username, base_env=None)
    spawn_env["NO_OPEN_BROWSER"] = "1"
    # NO_BROWSER is the legacy name used by some cursor-agent
    # versions; setting both is harmless and forward-compatible.
    spawn_env["NO_BROWSER"] = "1"
    if extra_env:
        spawn_env.update(extra_env)
    # On Windows, cursor-agent is shipped as a .cmd shim — Popen
    # needs shell=True (or the resolved .cmd absolute path) for the
    # shim to execute. ``shell=True`` is the most portable answer
    # across Windows/POSIX.
    #
    # We deliberately DO NOT set DETACHED_PROCESS / CREATE_NO_WINDOW
    # on Windows here, even though the old fire-and-forget login
    # code did. Those flags strip the child's stdio inheritance,
    # which breaks ``stdout=PIPE`` (cursor-agent's writes either
    # block or vanish). The trade-off is that the child runs under
    # the FastAPI worker process group, so a uvicorn reload kills
    # the login flow — fine, since the user just clicks Re-Login
    # again. On POSIX ``start_new_session=True`` is still set so a
    # SIGHUP to the worker doesn't take the login process down with
    # it on the common case.
    start_new_session = os.name != "nt"
    try:
        proc = subprocess.Popen(  # noqa: S603 — args are server-controlled
            [binary, "login"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            env=spawn_env,
            bufsize=0,
            shell=os.name == "nt",
            start_new_session=start_new_session,
        )
    except (FileNotFoundError, OSError) as exc:
        logger.exception("Failed to spawn cursor-agent login for %s", username)
        raise RuntimeError(
            f"Could not spawn cursor-agent: {exc}. Reinstall Cursor and retry.",
        ) from exc
    log_buf: list[bytes] = []
    url = _read_until_url(proc, log_buf)
    state: _LoginSessionState = {
        "status": "in_progress",
        "pid": proc.pid,
        "binary": binary,
        "started_at": __import__("time").time(),
        "login_url": url,
        "message": (
            "Open the link in a new tab and sign in to your Cursor account."
            if url else
            "cursor-agent did not print a sign-in URL within the time budget."
        ),
        "_proc": proc,
    }
    if url is None:
        # No URL — the spawn either crashed or output something we
        # don't recognise. Bail out and surface the captured tail.
        tail = b"".join(log_buf)[-1024:].decode("utf-8", errors="replace")
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except (subprocess.TimeoutExpired, OSError):
            try:
                proc.kill()
            except (OSError, ProcessLookupError):
                pass
        state["status"] = "failed"
        state["message"] = (
            "cursor-agent didn't print a sign-in URL. "
            "Check the server logs for details."
        )
        state["error_tail"] = tail
        with _LOGIN_SESSIONS_LOCK:
            _LOGIN_SESSIONS[key] = state
        return _login_session_snapshot(state)
    # Spawn the completion-waiter thread so the cursor-agent process
    # doesn't linger after the user finishes OAuth in their browser.
    waiter = threading.Thread(
        target=_wait_for_login_completion,
        args=(username, proc, log_buf),
        daemon=True,
        name=f"cursor-login-wait-{key}",
    )
    state["_thread"] = waiter
    state["_log_buf"] = log_buf
    with _LOGIN_SESSIONS_LOCK:
        _LOGIN_SESSIONS[key] = state
    waiter.start()
    return _login_session_snapshot(state)
