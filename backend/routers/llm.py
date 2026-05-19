"""LLM provider listing and switching routes.

The Sidebar's "AI Engine" dropdown calls these endpoints to:
    * list every configured provider and its model catalog (``/providers``);
    * pin a (provider, model) pair as the global active selection
      (``/switch``);
    * resolve the *effective* (provider, model) for a given agent so an
      agent page can show a small "Will run on X (admin override)" pill
      when the calling user has a per-agent override set (``/effective``).

Cursor CLI integration also lives here. Each authenticated QA Studio
user has their own per-user Cursor credential slot under
``backend/data/cursor-auth/<username>/``, and the routes below
manipulate ONLY the caller's own slot:

    * ``GET  /cursor/status``              — probe ``cursor-agent
      --list-models`` against the caller's slot so the Sidebar can
      show "you need to log in to Cursor" without surfacing other
      users' state.
    * ``POST /cursor/login``               — local-dev only: spawn
      ``cursor-agent login`` detached with HOME / USERPROFILE
      redirected to the caller's slot. Inherits the desktop session
      so the OAuth tab opens in the operator's browser.
    * ``POST /cursor/upload-credentials``  — headless-prod (Render
      etc.): user runs ``cursor-agent login`` on their own laptop
      then uploads the resulting ``auth.json`` (or a tarball/zip of
      their whole ``~/.cursor/``) here. The server lands it in the
      caller's slot exactly as if the browser flow had run on the
      server. Works in EVERY deployment mode.
    * ``POST /cursor/logout``              — wipes the caller's slot
      so the next cursor-agent call falls back to "Authentication
      required" and the Sidebar banner reappears.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from core import cursor_auth, user_auth
from routers.deps import get_current_user, get_orchestrator

logger = logging.getLogger(__name__)

router = APIRouter()


class SwitchRequest(BaseModel):
    """Payload for switching the LLM provider.

    ``model`` is optional — when omitted the orchestrator uses the
    provider's default model (the first entry in its catalog). This
    keeps the legacy single-provider switch payload working.
    """

    provider: str
    model: str | None = None


@router.get("/providers")
async def list_providers(_user=Depends(get_current_user)):
    """Return every configured provider, its full model catalog, and the
    currently-active (provider, model) pair."""
    orch = get_orchestrator()
    return {
        "providers": orch.available_providers(),
        "active": orch.active_selection(),
    }


@router.post("/switch")
async def switch_provider(body: SwitchRequest, _user=Depends(get_current_user)):
    """Switch the global active (provider, model) at runtime.

    Refuses unknown providers / models with a clean 400 listing the
    configured catalog so the client can render a helpful toast.
    """
    orch = get_orchestrator()
    if not orch.switch_active(body.provider, body.model):
        catalog = orch.available_providers()
        configured = [
            {"provider": p["provider"], "models": p.get("models", [])}
            for p in catalog
        ]
        raise HTTPException(
            400,
            f"Provider '{body.provider}' or model '{body.model or '(default)'}' "
            f"is not configured. Available: {configured}. "
            "Set the API key in backend/.env or pick from the listed models.",
        )
    return {
        "active": orch.active_selection(),
        "providers": orch.available_providers(),
    }


@router.get("/effective")
async def get_effective_model(
    agent_name: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Resolve which (provider, model) *agent_name* will run on for *user*.

    ``source`` tells the UI whether the answer comes from the global
    Sidebar selection (``"global"``) or from a per-agent admin override
    (``"override"``); the agent page uses this to decide whether to
    show the small "admin override" pill next to the engine name.
    """
    orch = get_orchestrator()
    active = orch.active_selection()
    override = None
    if agent_name and user.get("username"):
        override = user_auth.get_user_model_override(user["username"], agent_name)
    if override:
        return {
            "agent_name": agent_name,
            "provider": override["provider"],
            "model": override["model"],
            "source": "override",
        }
    return {
        "agent_name": agent_name,
        "provider": active.get("provider", ""),
        "model": active.get("model", ""),
        "source": "global",
    }


# ---------------------------------------------------------------------------
# Cursor CLI auth helpers — PER USER
# ---------------------------------------------------------------------------
#
# Each authenticated QA Studio user owns a credential slot under
# ``backend/data/cursor-auth/<username>/``. The three routes below
# only ever read / write the caller's own slot:
#
#   * /cursor/status — probes cursor-agent --list-models with HOME /
#     USERPROFILE redirected to the caller's slot, so the answer is
#     "is THIS user logged in to Cursor?" — not the server-wide state.
#   * /cursor/login  — spawns ``cursor-agent login`` with the same env
#     redirect so the OAuth lands in the caller's slot.
#   * /cursor/logout — wipes the caller's slot.
# ---------------------------------------------------------------------------


def _is_headless() -> bool:
    """Return True when this host has no desktop session for an OAuth flow.

    The browser-spawn path (``POST /cursor/login``) only works when the
    server inherits a desktop session — i.e. on a developer's own
    workstation. On Render, headless Linux servers, or anywhere
    deliberately marked headless via ``QA_HEADLESS=true``, the
    subprocess would have no browser to open and the user would be
    stuck. The status route surfaces this as ``can_browser_login`` so
    the UI can hide the futile button and steer users to the upload
    flow instead.

    Detection order (any one match = headless):
      1. ``RENDER`` env var (Render sets this to "true" on every
         instance).
      2. ``QA_HEADLESS=true`` — explicit operator override.
      3. POSIX host with no ``DISPLAY`` or ``WAYLAND_DISPLAY`` (a
         common signal that there's no GUI session attached).

    Windows hosts always have a desktop session by default (we're
    almost always running on a developer workstation there), so they
    fall through to "not headless" unless the operator opts in.
    """
    if os.environ.get("RENDER", "").lower() in ("true", "1", "yes"):
        return True
    if os.environ.get("QA_HEADLESS", "").lower() in ("true", "1", "yes"):
        return True
    if os.name == "posix" and not (
        os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
    ):
        return True
    return False


def _resolve_cursor_binary(orch) -> str:
    """Return the cursor-agent path the orchestrator is configured with.

    Falls back to PATH lookup when the orchestrator never registered a
    cursor provider (e.g. binary wasn't discoverable at boot but is
    available now) so /cursor/login still works after a fresh install
    without a server restart.
    """
    provider = orch._providers.get("cursor")  # type: ignore[attr-defined]
    if provider is not None:
        bin_path = getattr(provider, "_binary", "") or ""
        if bin_path:
            return bin_path
    # Best-effort PATH fallback — keeps the login endpoint useful
    # even when the provider failed to register at boot.
    for name in ("cursor-agent", "cursor-agent.cmd", "agent", "agent.cmd"):
        found = shutil.which(name)
        if found:
            return found
    return ""


def _probe_cursor_auth(
    binary: str, username: str | None,
) -> tuple[bool, list[str], str]:
    """Run ``cursor-agent --list-models`` against the user's slot.

    Returns ``(logged_in, models, reason)``. We deliberately do NOT use
    ``_CursorAgentProvider.discover_models`` here because that helper
    falls back to parsing ``--help`` for a legacy ``--model {a,b,c}``
    choices block, which would falsely report "logged in" on older
    CLI builds whose help text advertises models the seat doesn't
    actually have access to until OAuth completes. The status banner
    needs a strict signal.

    ``reason`` is a short token the client can surface for diagnostics
    when the probe fails — never shown in the happy path.
    """
    try:
        result = subprocess.run(  # noqa: S603 — args server-controlled
            [binary, "--list-models"],
            capture_output=True, text=True, encoding="utf-8",
            timeout=8, check=False,
            env=cursor_auth.env_for(username),
        )
    except FileNotFoundError:
        return False, [], "binary_missing"
    except subprocess.TimeoutExpired:
        return False, [], "timeout"
    except OSError as exc:
        return False, [], f"oserror:{exc.errno}"

    blob = ((result.stdout or "") + "\n" + (result.stderr or "")).strip()
    blob_low = blob.lower()
    # Newer builds print "Authentication required. Please run 'agent
    # login' first, or set CURSOR_API_KEY environment variable." on
    # stderr; older builds print "No models available for this
    # account." or "Not authenticated.". Treat any of those as "not
    # logged in" rather than "broken" so the UI shows the right
    # remediation prompt.
    auth_markers = (
        "authentication required",
        "agent login",
        "cursor_api_key",
        "not authenticated",
        "no models available",
    )
    if any(marker in blob_low for marker in auth_markers):
        return False, [], "auth_required"

    models: list[str] = []
    for raw in blob.splitlines():
        tok = raw.strip().strip("*").strip("-").strip()
        if not tok or " " in tok or "\t" in tok:
            continue
        low = tok.lower()
        if low.startswith(("#", "error", "available")):
            continue
        models.append(tok)
    models = sorted(set(models))
    if not models:
        return False, [], "empty_catalog"
    return True, models, "ok"


@router.get("/cursor/status")
async def cursor_status(user: dict = Depends(get_current_user)):
    """Probe the caller's Cursor seat and report auth state.

    ``logged_in`` is inferred from ``cursor-agent --list-models`` run
    against the caller's per-user credential slot — so each user sees
    their OWN auth state, not a global one. Probe is skipped (and the
    UI shows "log in to Cursor" instead) when the slot has never been
    initialised so we never spawn a subprocess for a fresh account.

    ``can_browser_login`` reports whether the new browser-less login
    flow is supported (Always ``True`` whenever a cursor-agent binary
    is installed — the OAuth flow uses cursor.com opened in the
    USER's browser, not the server's, so headless deployments work
    identically to local-dev). ``is_headless`` is kept for diagnostic
    purposes / UI copy hints.

    Returned shape (all keys always present so the client can render
    without null-checks):

        {
          "available":           bool,   # binary discoverable on this host?
          "logged_in":           bool,   # caller's seat passes --list-models?
          "binary":              str,    # absolute path to cursor-agent
          "model_count":         int,    # length of the discovered catalog
          "models":              list[str],  # first 8 ids, for the UI hint
          "reason":              str,    # diagnostic token when not logged_in
          "username":            str,    # echo of the caller for the UI
          "slot_initialized":    bool,   # has the user ever attempted login?
          "is_headless":         bool,   # server has no GUI session?
          "can_browser_login":   bool,   # OAuth-via-user-browser flow available?
        }
    """
    orch = get_orchestrator()
    binary = _resolve_cursor_binary(orch)
    username = user.get("username") or ""
    slot_initialized = cursor_auth.slot_exists(username)
    headless = _is_headless()

    def _base() -> dict:
        return {
            "username": username,
            "slot_initialized": slot_initialized,
            "is_headless": headless,
            # The new browser-less login flow works wherever the
            # cursor-agent binary is installed — the OAuth tab opens
            # in the USER's browser, not the server's, so headless
            # is no longer a blocker. We only flip this to False when
            # the binary itself is missing (handled below).
            "can_browser_login": bool(binary),
        }

    if not binary:
        return {
            **_base(),
            # When the binary is missing the browser-less flow can't
            # run either — flip the flag so the UI offers the upload
            # fallback instead.
            "can_browser_login": False,
            "available": False,
            "logged_in": False,
            "binary": "",
            "model_count": 0,
            "models": [],
            "reason": "binary_missing",
        }
    # Skip the probe for users who've never even attempted login — the
    # subprocess would correctly return "auth_required" but the spawn
    # is a measurable cost on the sidebar's first paint for every new
    # account, and the answer is foregone.
    if not slot_initialized:
        return {
            **_base(),
            "available": True,
            "logged_in": False,
            "binary": binary,
            "model_count": 0,
            "models": [],
            "reason": "no_slot",
        }
    try:
        logged_in, discovered, reason = _probe_cursor_auth(binary, username)
    except Exception:  # noqa: BLE001 — never let a probe failure 500 the UI
        logger.exception("cursor-agent --list-models probe failed for %s", username)
        return {
            **_base(),
            "available": True,
            "logged_in": False,
            "binary": binary,
            "model_count": 0,
            "models": [],
            "reason": "probe_exception",
        }
    return {
        **_base(),
        "available": True,
        "logged_in": logged_in,
        "binary": binary,
        "model_count": len(discovered),
        "models": discovered[:8],
        "reason": reason,
    }


@router.post("/cursor/login")
async def cursor_login(user: dict = Depends(get_current_user)):
    """Start a browser-less ``cursor-agent login`` for the calling user.

    Spawns ``cursor-agent login`` with ``NO_OPEN_BROWSER=1`` and
    captures the cursor.com sign-in URL it prints to stdout. The
    subprocess keeps running in the background, polling cursor.com
    until the user completes OAuth in their browser, at which point
    ``auth.json`` lands in the user's slot and a background thread
    auto-snapshots it to Firestore so the credentials survive a
    Render restart.

    The HTTP response returns IMMEDIATELY with the sign-in URL the
    frontend should open in a new tab. The frontend then polls
    ``GET /cursor/login-status`` every ~2 seconds until status flips
    to ``success`` (or ``failed`` / ``cancelled`` / ``timeout``).

    The same flow works on a developer laptop AND on headless Render
    deployments — the user's browser is what completes the OAuth, not
    the server's.
    """
    orch = get_orchestrator()
    binary = _resolve_cursor_binary(orch)
    username = user.get("username") or ""
    if not binary:
        raise HTTPException(
            400,
            "cursor-agent binary is not installed on this host. Install "
            "Cursor (https://cursor.com/install) and restart the server.",
        )
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")
    # Materialise the slot first so cursor-agent has a place to write
    # its auth.json. ``slot_for`` is idempotent so this is safe to
    # call on every login attempt.
    cursor_auth.slot_for(username)
    try:
        session = cursor_auth.start_login(username, binary)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(500, str(exc)) from exc
    logger.info(
        "Started cursor-agent login for %s (pid=%s, status=%s, url=%s).",
        username, session.get("pid"), session.get("status"),
        bool(session.get("login_url")),
    )
    if session.get("status") == "failed":
        # Bubble the captured tail back so the user sees the actual
        # error instead of a generic 500.
        raise HTTPException(
            500,
            session.get("message")
            or "cursor-agent failed to start the login flow.",
        )
    return {
        "status": session.get("status"),
        "login_url": session.get("login_url"),
        "message": session.get("message"),
        "pid": session.get("pid"),
        "username": username,
    }


@router.get("/cursor/login-status")
async def cursor_login_status(user: dict = Depends(get_current_user)):
    """Return the state of the caller's in-flight cursor-agent login.

    The frontend polls this every ~2s while the user is on the
    cursor.com sign-in tab. Returns ``status: "idle"`` when no
    session exists (either never started, or already cleaned up).
    """
    username = user.get("username") or ""
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")
    session = cursor_auth.get_login_session(username)
    if session is None:
        return {"status": "idle", "username": username}
    session["username"] = username
    return session


@router.post("/cursor/login-cancel")
async def cursor_login_cancel(user: dict = Depends(get_current_user)):
    """Abort an in-flight cursor-agent login (the user closed the modal,
    or wants to retry with a different account).

    Idempotent — returning ``cancelled: false`` is informational.
    """
    username = user.get("username") or ""
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")
    cancelled = cursor_auth.cancel_login(username)
    return {"cancelled": cancelled, "username": username}


@router.post("/cursor/logout")
async def cursor_logout(user: dict = Depends(get_current_user)):
    """Wipe the caller's Cursor credential slot.

    Clears BOTH the local slot AND the persistent snapshot (Firestore
    or local JSON sidecar) — otherwise the next container restart
    would silently re-hydrate the user back in via env_for's lazy
    hydration. Idempotent: returns ``cleared=False`` when nothing
    needed removing.
    """
    username = user.get("username") or ""
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")
    cleared = cursor_auth.clear_slot(username)
    if cleared:
        logger.info("Cleared cursor credentials for %s", username)
    return {"cleared": cleared, "username": username}


@router.post("/cursor/persist")
async def cursor_persist(user: dict = Depends(get_current_user)):
    """Re-snapshot the caller's current slot into the persistent store.

    Called by the Sidebar after the browser-login button on local-dev
    completes, so any credentials cursor-agent just wrote get mirrored
    to Firestore / the local sidecar and survive the next container
    restart. Idempotent — safe to call on every Re-check too if we
    want to be paranoid.
    """
    username = user.get("username") or ""
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")
    persisted = cursor_auth.persist_slot(username)
    return {"persisted": persisted, "username": username}


# Cap upload size to 2 MiB — a real cursor-agent auth.json is ~1 KB
# and a whole ``~/.cursor/`` tarball with cache directories is still
# well under a megabyte. Anything bigger is almost certainly a wrong
# file (or an attack); fail fast with a clear 413 instead of letting
# us churn through arbitrary garbage on disk.
_MAX_UPLOAD_BYTES = 2 * 1024 * 1024


@router.post("/cursor/upload-credentials")
async def cursor_upload_credentials(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """Land a user-uploaded ``auth.json`` (or ``~/.cursor/`` tarball)
    into the caller's per-user slot.

    The workflow this unblocks is the ONLY way to authenticate on
    headless deployments (Render etc.) where the browser-spawn login
    route has nowhere to surface the OAuth tab:

      1. On the user's own laptop: install Cursor, run
         ``cursor-agent login`` once, complete the browser OAuth.
      2. Locate ``~/.cursor/auth.json`` (macOS / Linux) or
         ``%USERPROFILE%\\.cursor\\auth.json`` (Windows).
      3. Upload that file via this endpoint — or, if cursor-agent
         needs more than the auth.json (e.g. a refresh-token cache),
         pack the whole directory with
         ``tar -C ~/.cursor -czf cursor-auth.tgz .`` and upload the
         tarball.

    Detected by file extension. ``.json`` is treated as auth.json;
    ``.tgz`` / ``.tar.gz`` / ``.tar`` / ``.zip`` as a bundle to
    extract into the slot's ``.cursor/`` directory. Anything else
    falls back to JSON parsing so users who renamed the file still
    get a useful error message.

    Re-uploading replaces the existing slot atomically — no need to
    log out first.
    """
    username = user.get("username") or ""
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")

    # Read up to the cap + 1 byte so we can detect over-cap uploads
    # without buffering the full payload first.
    content = await file.read(_MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(400, "Uploaded file is empty.")
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            413,
            f"Upload too large ({len(content)} bytes); the per-user "
            f"limit is {_MAX_UPLOAD_BYTES} bytes. A real cursor-agent "
            "auth.json is well under 4 KB.",
        )

    fname_low = (file.filename or "").lower()
    archive_suffixes = (".tgz", ".tar.gz", ".tar", ".zip")
    is_archive = fname_low.endswith(archive_suffixes)

    try:
        if is_archive:
            target = cursor_auth.install_auth_archive(
                username, content, fname_low,
            )
            installed_kind = "archive"
        else:
            target = cursor_auth.install_auth_json(username, content)
            installed_kind = "auth_json"
    except ValueError as exc:
        # Bubble validation errors back to the client as 400s so the
        # toast surfaces the actual problem (bad JSON, unsafe tar,
        # etc.) instead of a generic "upload failed".
        raise HTTPException(400, str(exc)) from exc
    except Exception:  # noqa: BLE001
        logger.exception("Failed to install cursor credentials for %s", username)
        raise HTTPException(
            500, "Failed to install credentials on the server. See logs.",
        )

    # Snapshot the fresh slot to the persistent store (Firestore or
    # local JSON sidecar) so the upload survives Render's ephemeral
    # filesystem. Best-effort: a persistence failure here just means
    # the user might have to re-upload after the next restart, but
    # the current session still works because the local slot is set.
    try:
        cursor_auth.persist_slot(username)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Persisted snapshot failed for %s; local slot is still set.",
            username,
        )

    logger.info(
        "Installed cursor credentials for %s (kind=%s, src=%s, bytes=%d, target=%s).",
        username, installed_kind, file.filename, len(content), target,
    )

    # Probe the freshly-installed seat so the UI can flip its state
    # immediately without an extra round-trip.
    orch = get_orchestrator()
    binary = _resolve_cursor_binary(orch)
    logged_in = False
    model_count = 0
    if binary:
        try:
            logged_in_, models_, _ = _probe_cursor_auth(binary, username)
            logged_in = logged_in_
            model_count = len(models_)
        except Exception:  # noqa: BLE001
            logger.exception(
                "Post-upload probe failed for %s; status route will retry.",
                username,
            )

    return {
        "installed": True,
        "kind": installed_kind,
        "username": username,
        "logged_in": logged_in,
        "model_count": model_count,
        "message": (
            "Credentials installed. You should now be signed in to Cursor."
            if logged_in
            else
            "Credentials installed but cursor-agent still reports "
            "'not authenticated'. Double-check you uploaded the correct "
            "auth.json (or a full ~/.cursor tarball)."
        ),
    }
