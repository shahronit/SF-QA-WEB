"""Shared FastAPI dependencies: auth guard and orchestrator singleton.

The orchestrator is intentionally constructed with only two LLM
providers wired up — **Gemini** (native API) and **Cursor CLI**
(local subprocess). Other adapter classes still exist in
``core.orchestrator`` for future re-enablement, but their kwargs are
not surfaced here.

The Cursor binary path is **auto-discovered** so users don't have to
chase the install location across operating systems. ``CURSOR_AGENT_BIN``
in ``.env`` only needs to be set when the binary lives somewhere
non-standard.
"""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from core import user_auth
from core.orchestrator import SFQAOrchestrator

logger = logging.getLogger(__name__)

security = HTTPBearer()
_orchestrator: SFQAOrchestrator | None = None


def _split_csv(value: str) -> list[str]:
    """Split a comma-separated string into a trimmed list."""
    return [m.strip() for m in value.split(",") if m.strip()]


def _discover_cursor_bin(explicit: str = "") -> str:
    """Locate the locally-installed ``cursor-agent`` binary.

    Resolution order:
        1. ``explicit`` — value of ``CURSOR_AGENT_BIN`` from .env, when
           present AND the file actually exists. We deliberately fall
           through to auto-discovery when the explicit path is missing
           on disk so a stale .env entry (e.g. left over from an older
           Cursor install location) doesn't strand the provider.
        2. ``PATH`` — ``cursor-agent`` / ``cursor-agent.cmd`` /
           ``agent`` / ``agent.cmd`` in any PATH directory.
        3. Standard install locations — Windows: the official installer
           drops files into ``%LOCALAPPDATA%\\cursor-agent\\``; the IDE
           bundle ships a copy under
           ``%LOCALAPPDATA%\\Programs\\cursor\\``.
           macOS / Linux: the bash installer writes to
           ``~/.local/bin/cursor-agent`` (and creates an ``agent`` alias).

    Returns the first viable absolute path, or ``""`` when nothing is
    found — the orchestrator then leaves the Cursor provider
    unregistered (Sidebar dropdown shows Gemini only) instead of
    failing every agent run.
    """
    # 1. Honour an explicit, valid path first.
    explicit = (explicit or "").strip().strip('"').strip("'")
    if explicit and Path(explicit).is_file():
        return explicit
    if explicit:
        logger.warning(
            "CURSOR_AGENT_BIN points to %s which does not exist on this "
            "host — falling back to auto-discovery. Clear the .env "
            "value to silence this warning.",
            explicit,
        )

    # 2. PATH lookup. Probe both names because the installer creates
    # an ``agent`` alias for the canonical ``cursor-agent`` and either
    # may be picked up first depending on PATH ordering.
    path_candidates = ("cursor-agent", "agent")
    if os.name == "nt":
        # On Windows, shutil.which already resolves the .cmd / .exe
        # variants when PATHEXT is correctly set, but we add explicit
        # suffixes to defend against shells that don't (e.g. when the
        # process is launched from a stripped-down service environment).
        path_candidates = (
            "cursor-agent", "cursor-agent.cmd", "cursor-agent.exe",
            "agent", "agent.cmd", "agent.exe",
        )
    for name in path_candidates:
        found = shutil.which(name)
        if found:
            return found

    # 3. Well-known install locations per OS.
    candidates: list[Path] = []
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA", "")
        if local:
            base = Path(local)
            candidates.extend([
                # Official Windows installer (cursor.com/install?win32=true).
                base / "cursor-agent" / "cursor-agent.cmd",
                base / "cursor-agent" / "cursor-agent.exe",
                base / "cursor-agent" / "agent.cmd",
                # Cursor IDE bundle (often present alongside the editor).
                base / "Programs" / "cursor" / "cursor-agent.exe",
                base / "Programs" / "cursor" / "cursor-agent.cmd",
            ])
    else:
        # The Unix bash installer drops cursor-agent + agent alias here.
        home = Path.home()
        candidates.extend([
            home / ".local" / "bin" / "cursor-agent",
            home / ".local" / "bin" / "agent",
            home / ".cursor" / "bin" / "cursor-agent",
            Path("/usr/local/bin/cursor-agent"),
        ])

    for p in candidates:
        if p.is_file():
            return str(p)

    # Nothing found — caller will skip registering the Cursor provider.
    return ""


def get_orchestrator() -> SFQAOrchestrator:
    """Return (or lazily create) the singleton orchestrator.

    Only two providers are configured: Gemini (when ``GEMINI_API_KEY``
    is set) and Cursor CLI (when the binary is discoverable). Either
    one may be missing — leaving Gemini blank disables it; leaving
    the Cursor binary blank/uninstalled disables it. The Sidebar
    dropdown reflects exactly what's reachable.
    """
    global _orchestrator
    if _orchestrator is None:
        cursor_bin = _discover_cursor_bin(settings.CURSOR_AGENT_BIN)
        if cursor_bin:
            logger.info("cursor-agent resolved to %s", cursor_bin)
        else:
            logger.info(
                "cursor-agent not found on PATH or in standard locations "
                "— Cursor CLI provider will be skipped.",
            )
        _orchestrator = SFQAOrchestrator(
            provider=settings.LLM_PROVIDER,
            gemini_api_key=settings.GEMINI_API_KEY,
            gemini_model=settings.GEMINI_MODEL,
            gemini_fallbacks=_split_csv(settings.GEMINI_FALLBACK_MODELS),
            gemini_max_retries=settings.GEMINI_MAX_RETRIES,
            cursor_agent_bin=cursor_bin,
            cursor_agent_models=_split_csv(settings.CURSOR_AGENT_MODELS),
            cursor_agent_max_retries=settings.CURSOR_AGENT_MAX_RETRIES,
            cursor_agent_discover=settings.CURSOR_AGENT_DISCOVER,
            rag_top_k=settings.RAG_TOP_K,
            max_output_tokens=settings.MAX_OUTPUT_TOKENS,
            temperature=settings.TEMPERATURE,
            seed=settings.LLM_SEED,
            cache_enabled=settings.LLM_RESPONSE_CACHE_ENABLED,
            cache_max_entries=settings.LLM_RESPONSE_CACHE_MAX_ENTRIES,
        )
    return _orchestrator


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(security),
) -> dict:
    """Decode JWT from Authorization header and return the user dict."""
    payload = user_auth.decode_token(
        creds.credentials, settings.JWT_SECRET, settings.JWT_ALGORITHM
    )
    if not payload or "sub" not in payload:
        raise HTTPException(401, "Invalid or expired token")
    user = user_auth.get_user(payload["sub"])
    if not user:
        raise HTTPException(401, "User not found")
    return user


async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    """Allow only authenticated users with ``is_admin=True`` through.

    Anything mounted under ``/api/admin`` (or any other admin-only route)
    should depend on this so non-admins receive a clean 403 instead of
    silently succeeding. Mirrors the shape of ``get_current_user`` so
    callers can use the user dict the same way.
    """
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin privileges required")
    return user
