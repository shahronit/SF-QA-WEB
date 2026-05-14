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

    * ``GET  /cursor/status``  — probe ``cursor-agent --list-models``
      against the caller's slot so the Sidebar can show "you need to
      log in to Cursor" without surfacing other users' state.
    * ``POST /cursor/login``   — spawns ``cursor-agent login`` as a
      detached subprocess with HOME / USERPROFILE redirected to the
      caller's slot. On a local-dev install (which is where this app
      actually runs) the subprocess inherits the desktop session and
      opens the OAuth tab in the operator's browser, so the seat can
      be authenticated without dropping to a terminal.
    * ``POST /cursor/logout``  — wipes the caller's slot so the next
      cursor-agent call falls back to "Authentication required" and
      the Sidebar banner reappears.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys

from fastapi import APIRouter, Depends, HTTPException
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

    Returned shape (all keys always present so the client can render
    without null-checks):

        {
          "available":         bool,   # binary discoverable on this host?
          "logged_in":         bool,   # caller's seat passes --list-models?
          "binary":            str,    # absolute path to cursor-agent
          "model_count":       int,    # length of the discovered catalog
          "models":            list[str],  # first 8 ids, for the UI hint
          "reason":            str,    # diagnostic token when not logged_in
          "username":          str,    # echo of the caller for the UI
          "slot_initialized":  bool,   # has the user ever attempted login?
        }
    """
    orch = get_orchestrator()
    binary = _resolve_cursor_binary(orch)
    username = user.get("username") or ""
    slot_initialized = cursor_auth.slot_exists(username)
    if not binary:
        return {
            "available": False,
            "logged_in": False,
            "binary": "",
            "model_count": 0,
            "models": [],
            "reason": "binary_missing",
            "username": username,
            "slot_initialized": slot_initialized,
        }
    # Skip the probe for users who've never even attempted login — the
    # subprocess would correctly return "auth_required" but the spawn
    # is a measurable cost on the sidebar's first paint for every new
    # account, and the answer is foregone.
    if not slot_initialized:
        return {
            "available": True,
            "logged_in": False,
            "binary": binary,
            "model_count": 0,
            "models": [],
            "reason": "no_slot",
            "username": username,
            "slot_initialized": False,
        }
    try:
        logged_in, discovered, reason = _probe_cursor_auth(binary, username)
    except Exception:  # noqa: BLE001 — never let a probe failure 500 the UI
        logger.exception("cursor-agent --list-models probe failed for %s", username)
        return {
            "available": True,
            "logged_in": False,
            "binary": binary,
            "model_count": 0,
            "models": [],
            "reason": "probe_exception",
            "username": username,
            "slot_initialized": True,
        }
    return {
        "available": True,
        "logged_in": logged_in,
        "binary": binary,
        "model_count": len(discovered),
        "models": discovered[:8],
        "reason": reason,
        "username": username,
        "slot_initialized": True,
    }


@router.post("/cursor/login")
async def cursor_login(user: dict = Depends(get_current_user)):
    """Spawn ``cursor-agent login`` for the CALLING user.

    The subprocess inherits the desktop session, so on a local-dev
    install the OAuth tab opens in the operator's default browser
    without blocking the HTTP request. ``HOME`` / ``USERPROFILE`` are
    redirected to the caller's per-user slot so the resulting
    ``auth.json`` lands in that slot — every user authenticates their
    OWN Cursor account.

    Returns immediately with ``launched: true`` once the process is
    spawned — the caller is expected to poll ``/cursor/status`` (or
    just re-test an agent run) until ``logged_in`` flips to true.

    Headless deployments (Render et al.) can't open a browser; on
    those hosts users would need an alternative (e.g. an upload form
    for their own ``auth.json``) — not implemented here because this
    app is overwhelmingly run on the operator's own workstation.
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
    # call on every login.
    cursor_auth.slot_for(username)
    # Detach the child so it survives this request and keeps its own
    # window/handles for the OAuth browser dance. Without detaching,
    # closing the FastAPI worker (e.g. on --reload) kills the login
    # flow mid-handshake.
    spawn_env = cursor_auth.env_for(username)
    try:
        if os.name == "nt":
            DETACHED_PROCESS = 0x00000008  # noqa: N806 — Win32 constant
            CREATE_NEW_PROCESS_GROUP = 0x00000200  # noqa: N806
            CREATE_NO_WINDOW = 0x08000000  # noqa: N806
            creationflags = (
                DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
            )
            popen = subprocess.Popen(  # noqa: S603 — args are server-controlled
                [binary, "login"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=False,
                creationflags=creationflags,
                env=spawn_env,
            )
        else:
            popen = subprocess.Popen(  # noqa: S603 — args are server-controlled
                [binary, "login"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
                start_new_session=True,
                env=spawn_env,
            )
    except FileNotFoundError as exc:
        raise HTTPException(
            500,
            f"Failed to spawn cursor-agent login: binary at {binary} vanished. "
            "Reinstall Cursor and restart the server.",
        ) from exc
    except OSError as exc:
        raise HTTPException(
            500, f"Failed to spawn cursor-agent login: {exc}",
        ) from exc
    logger.info(
        "Spawned cursor-agent login for %s (pid=%s, binary=%s, platform=%s).",
        username, popen.pid, binary, sys.platform,
    )
    return {
        "launched": True,
        "pid": popen.pid,
        "binary": binary,
        "username": username,
        "message": (
            "Browser opened — complete the Cursor sign-in for YOUR account, "
            "then come back here and click 'Re-check'."
        ),
    }


@router.post("/cursor/logout")
async def cursor_logout(user: dict = Depends(get_current_user)):
    """Wipe the caller's Cursor credential slot.

    Idempotent — returning ``cleared=False`` when the slot didn't
    exist is informational, not an error.
    """
    username = user.get("username") or ""
    if not username:
        raise HTTPException(400, "Missing username on the auth token.")
    cleared = cursor_auth.clear_slot(username)
    if cleared:
        logger.info("Cleared cursor credentials for %s", username)
    return {"cleared": cleared, "username": username}
