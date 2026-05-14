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

import contextvars
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path

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

    On Windows, ``HOMEDRIVE``/``HOMEPATH`` are set as a belt-and-braces
    fallback for libraries that read those instead of ``USERPROFILE``.
    """
    env = dict(base_env if base_env is not None else os.environ)
    slot = slot_for(username)
    if slot is None:
        return env
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


def clear_slot(username: str | None) -> bool:
    """Delete the user's cursor credentials. Backs the logout endpoint.

    Returns True when something was actually removed, False when the
    slot didn't exist (idempotent — safe to call repeatedly).
    """
    if not username:
        return False
    slot = _DATA_DIR / _sanitize(username)
    if not slot.exists():
        return False
    try:
        shutil.rmtree(slot, ignore_errors=False)
    except OSError:
        logger.exception("Failed to fully clear cursor slot for %s", username)
        # Best-effort: keep going so a partial cleanup still flips the
        # status to "not logged in" on the next probe.
        shutil.rmtree(slot, ignore_errors=True)
    return True


def slot_exists(username: str | None) -> bool:
    """Cheap existence check used by /cursor/status to avoid a subprocess
    spawn for users who've never even attempted login.
    """
    if not username:
        return False
    return (_DATA_DIR / _sanitize(username) / ".cursor").exists()
