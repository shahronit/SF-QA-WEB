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

    LLM_PROVIDER: str = "openai"

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_FALLBACK_MODELS: str = "gpt-4o-mini,gpt-3.5-turbo"
    OPENAI_MAX_RETRIES: int = 3

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-pro"
    GEMINI_FALLBACK_MODELS: str = "gemini-2.5-flash,gemini-2.0-flash"
    GEMINI_MAX_RETRIES: int = 3

    RAG_TOP_K: int = 3
    MAX_OUTPUT_TOKENS: int = 8192
    TEMPERATURE: float = 0.25

    STORAGE_BACKEND: str = "local"
    FIREBASE_CREDENTIALS_PATH: str = ""
    FIREBASE_CREDENTIALS_JSON: str = ""
    FIREBASE_PROJECT_ID: str = ""

    GOOGLE_OAUTH_CLIENT_ID: str = ""
    GOOGLE_OAUTH_CLIENT_SECRET: str = ""
    GOOGLE_OAUTH_REDIRECT_URI: str = "http://localhost:8080/api/gdrive/callback"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
