"""Shared FastAPI dependencies: auth guard and orchestrator singleton."""

from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings
from core import user_auth
from core.orchestrator import SFQAOrchestrator

security = HTTPBearer()
_orchestrator: SFQAOrchestrator | None = None


def _split_csv(value: str) -> list[str]:
    """Split a comma-separated string into a trimmed list."""
    return [m.strip() for m in value.split(",") if m.strip()]


def get_orchestrator() -> SFQAOrchestrator:
    """Return (or lazily create) the singleton orchestrator."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = SFQAOrchestrator(
            provider=settings.LLM_PROVIDER,
            gemini_api_key=settings.GEMINI_API_KEY,
            gemini_model=settings.GEMINI_MODEL,
            gemini_fallbacks=_split_csv(settings.GEMINI_FALLBACK_MODELS),
            gemini_max_retries=settings.GEMINI_MAX_RETRIES,
            openai_api_key=settings.OPENAI_API_KEY,
            openai_model=settings.OPENAI_MODEL,
            openai_fallbacks=_split_csv(settings.OPENAI_FALLBACK_MODELS),
            openai_max_retries=settings.OPENAI_MAX_RETRIES,
            rag_top_k=settings.RAG_TOP_K,
            max_output_tokens=settings.MAX_OUTPUT_TOKENS,
            temperature=settings.TEMPERATURE,
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
