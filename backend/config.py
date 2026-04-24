"""Application settings via pydantic-settings."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Centralised configuration — reads env vars / .env automatically."""

    PROJECT_ROOT: Path = Path(__file__).resolve().parent
    JWT_SECRET: str = "sf-qa-studio-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480

    LLM_PROVIDER: str = "gemini"

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-pro"
    GEMINI_FALLBACK_MODELS: str = "gemini-2.5-flash,gemini-2.0-flash"
    GEMINI_MAX_RETRIES: int = 3
    # Embeddings model used by the RAG vector store. The "models/" prefix is
    # required by the google-generativeai SDK / langchain-google-genai.
    GEMINI_EMBED_MODEL: str = "models/text-embedding-004"

    RAG_TOP_K: int = 3
    MAX_OUTPUT_TOKENS: int = 8192
    TEMPERATURE: float = 0.25

    STORAGE_BACKEND: str = "local"
    FIREBASE_CREDENTIALS_PATH: str = ""
    FIREBASE_CREDENTIALS_JSON: str = ""
    FIREBASE_PROJECT_ID: str = ""
    # Firebase Storage bucket for persisted project documents. Required when
    # STORAGE_BACKEND=firestore so uploaded files survive restarts and follow
    # shared projects across users/hosts.
    FIREBASE_STORAGE_BUCKET: str = ""

    GOOGLE_OAUTH_CLIENT_ID: str = ""
    GOOGLE_OAUTH_CLIENT_SECRET: str = ""
    GOOGLE_OAUTH_REDIRECT_URI: str = "http://localhost:8080/api/gdrive/callback"

    # MCP (Model Context Protocol) client settings. Cap how long we cache
    # fetched resources per (project, server) and how long any single MCP
    # request can take, so a slow/dead external server can't block agent
    # runs indefinitely.
    MCP_CACHE_TTL_SEC: int = 120
    MCP_REQUEST_TIMEOUT_SEC: int = 10

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
