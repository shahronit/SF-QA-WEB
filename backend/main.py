"""QA Studio — single-server FastAPI + React SPA."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from config import settings
from core import secret_box

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create required directories and validate the encryption key on startup."""
    for d in ("data", "logs", "projects", "knowledge_base"):
        (settings.PROJECT_ROOT / d).mkdir(parents=True, exist_ok=True)
    # Fail loudly if ENCRYPTION_MASTER_KEY is set but malformed — otherwise
    # we'd silently fall back to plaintext storage for "encrypted" fields.
    # An unset key is fine here (encryption simply stays off).
    try:
        secret_box.validate_or_raise()
        if secret_box.is_enabled():
            logger.info("Field encryption: ENABLED (AES-256-GCM)")
        else:
            logger.warning(
                "Field encryption: DISABLED — sensitive fields will be "
                "stored in plaintext. Set ENCRYPTION_MASTER_KEY to enable."
            )
    except secret_box.EncryptionError as exc:
        raise RuntimeError(
            f"Invalid ENCRYPTION_MASTER_KEY: {exc}. Generate a new one with "
            "`python -m scripts.gen_encryption_key`."
        ) from exc
    yield


app = FastAPI(title="QA Studio API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
from routers import auth, agents, projects, history, jira, salesforce, knowledge, exports, llm, stlc_pack, gdrive, test_management, mcp, admin  # noqa: E402

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
# MCP routes share the projects/{slug} URL space — mounted alongside so
# the path is /api/projects/{slug}/mcp/servers, matching the plan.
app.include_router(mcp.router, prefix="/api/projects", tags=["mcp"])
app.include_router(history.router, prefix="/api/history", tags=["history"])
app.include_router(jira.router, prefix="/api/jira", tags=["jira"])
app.include_router(gdrive.router, prefix="/api/gdrive", tags=["gdrive"])
app.include_router(salesforce.router, prefix="/api/sf", tags=["salesforce"])
app.include_router(knowledge.router, prefix="/api/kb", tags=["knowledge"])
app.include_router(exports.router, prefix="/api/exports", tags=["exports"])
app.include_router(llm.router, prefix="/api/llm", tags=["llm"])
app.include_router(stlc_pack.router, prefix="/api/stlc", tags=["stlc"])
app.include_router(test_management.router, prefix="/api/test-management", tags=["test-management"])
# Admin panel API: every route guarded by get_admin_user.
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])


@app.get("/api/health")
async def health():
    """Simple health check endpoint."""
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# SPA: serve React frontend from backend/static/
# ---------------------------------------------------------------------------
if STATIC_DIR.is_dir() and INDEX_HTML.is_file():

    @app.get("/")
    async def root():
        """Serve the SPA entry point."""
        return FileResponse(INDEX_HTML, media_type="text/html")

    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="static-assets")

    @app.exception_handler(404)
    async def spa_fallback(request: Request, exc):
        """Return index.html for any unmatched route so React Router handles it."""
        if request.url.path.startswith("/api"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return FileResponse(INDEX_HTML, media_type="text/html")
