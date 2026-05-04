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

    # --- Cursor CLI — second supported LLM provider --------------------
    # The deployment intentionally exposes only Gemini (native API,
    # above) and Cursor CLI (shells out to the locally-installed
    # ``cursor-agent`` binary). OpenAI / Anthropic / OpenRouter / Ollama
    # are NOT registered: the upstream provider classes still exist in
    # orchestrator.py for future re-enablement, but they're never
    # instantiated by deps.py.
    #
    # CURSOR_AGENT_BIN: leave blank to auto-discover. ``deps.py`` walks
    # the standard install locations on Windows / macOS / Linux:
    #     * PATH                                 (cursor-agent / agent)
    #     * %LOCALAPPDATA%\cursor-agent\         (Windows official)
    #     * %LOCALAPPDATA%\Programs\cursor\      (Windows IDE bundle)
    #     * ~/.local/bin/                        (macOS / Linux)
    # Setting this explicitly is only useful when you've installed the
    # CLI to a non-standard location.
    #
    # CURSOR_AGENT_MODELS lists every model the dropdown will offer.
    # When CURSOR_AGENT_DISCOVER=true (default), the orchestrator also
    # asks ``cursor-agent --list-models`` for its per-seat catalog at
    # boot and merges it with this list — that way the dropdown always
    # reflects whatever the installed CLI actually supports.
    CURSOR_AGENT_BIN: str = ""
    # Static catalog used as a floor when the live `cursor-agent
    # --list-models` probe fails (e.g. user not yet logged in). Once
    # the user runs `cursor-agent login`, the boot-time discovery
    # merges the *actual* per-account model list in, so the dropdown
    # always reflects what their seat is entitled to.
    CURSOR_AGENT_MODELS: str = (
        # Auto + Cursor in-house models
        "auto,composer-1,sonic,"
        # OpenAI family (cursor-agent naming)
        "gpt-5,gpt-5-codex,gpt-5-fast,gpt-5-mini,gpt-4.1,gpt-4o,"
        "o3,o3-mini,o4-mini,"
        # Anthropic family — cursor-agent uses the short "sonnet-4"
        # style aliases as well as the long ones; both are valid -m
        # values.
        "sonnet-4,sonnet-4-thinking,opus-4,haiku-4,"
        "claude-sonnet-4.5,claude-opus-4.1,claude-haiku-4.5,"
        "claude-3.7-sonnet,claude-3.5-sonnet,"
        # Google family
        "gemini-2.5-pro,gemini-2.5-flash,"
        # xAI family
        "grok-4,grok-code-fast-1"
    )
    # Default 2 (was 1): subprocess overhead is real but a single
    # retry is too aggressive when transient errors (auth-token
    # refresh, brief network hiccup) are the most common cursor-agent
    # failure mode. Permanent errors (model not licensed, login wall,
    # rate limit) short-circuit the loop via the orchestrator's
    # _SKIP_PATTERNS so we don't spin on them.
    CURSOR_AGENT_MAX_RETRIES: int = 2
    # When true (default), also probe `cursor-agent --help` at boot to
    # discover any extra models the installed CLI advertises and merge
    # them into the dropdown catalog. Set false to keep the dropdown
    # strictly equal to CURSOR_AGENT_MODELS above.
    CURSOR_AGENT_DISCOVER: bool = True

    RAG_TOP_K: int = 3
    MAX_OUTPUT_TOKENS: int = 8192
    # Default to greedy decoding (temperature=0.0) so identical INPUT
    # produces identical OUTPUT — users explicitly want reproducible
    # results. Set TEMPERATURE>0 in .env if you want creativity.
    TEMPERATURE: float = 0.0
    # Fixed seed forwarded to Gemini's GenerateContentConfig so even
    # the small amount of randomness left at temperature=0 is pinned.
    # Change this number to deliberately re-roll cached prompts.
    LLM_SEED: int = 7
    # When True (default), cache LLM outputs by hash of (agent, qa_mode,
    # project, input, effective_system_prompt) and replay on identical
    # subsequent calls. The cache lives in backend/data/llm_cache.json.
    LLM_RESPONSE_CACHE_ENABLED: bool = True
    # Soft cap on cache entries; oldest entries are evicted FIFO once
    # this is exceeded. Increase if you have lots of distinct agents.
    LLM_RESPONSE_CACHE_MAX_ENTRIES: int = 1000

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

    # --- Google Drive (Shared Drive) — primary storage for project docs ---
    # The service account in FIREBASE_CREDENTIALS_PATH / _JSON must be added
    # to this Shared Drive as Content Manager (or higher) before uploads work.
    # Layout in Drive: <SharedDrive>/<GDRIVE_PARENT_FOLDER_NAME>/<project-folder>/file.
    GDRIVE_SHARED_DRIVE_ID: str = ""
    GDRIVE_PARENT_FOLDER_NAME: str = "QA Studio Agents"

    # MCP (Model Context Protocol) client settings. Cap how long we cache
    # fetched resources per (project, server) and how long any single MCP
    # request can take, so a slow/dead external server can't block agent
    # runs indefinitely.
    MCP_CACHE_TTL_SEC: int = 120
    MCP_REQUEST_TIMEOUT_SEC: int = 10

    # AES-256-GCM encryption-at-rest for sensitive Firestore / local-JSON
    # fields (Jira/GDrive/Xray/Zephyr tokens, MCP auth headers, agent
    # run transcripts, per-user prompt overrides).
    #
    # ENCRYPTION_MASTER_KEY: 32-byte key as base64 (44 chars including
    #   padding) or hex (64 chars). Generate with:
    #     python -m scripts.gen_encryption_key
    #   Leave empty to disable encryption (development convenience —
    #   data is then stored in plaintext).
    # ENCRYPTION_OLD_KEYS: optional comma-separated list of retired keys
    #   used only for decrypting legacy ciphertext. New writes always use
    #   ENCRYPTION_MASTER_KEY, so rotations drain organically.
    ENCRYPTION_MASTER_KEY: str = ""
    ENCRYPTION_OLD_KEYS: str = ""

    class Config:
        # Resolve the .env file relative to *this* file (backend/) so the
        # process picks it up regardless of the cwd it was launched from.
        # (Without this, `uvicorn ... --app-dir backend` started from the
        # repo root would silently miss every value, including
        # GEMINI_API_KEY, breaking RAG embeddings + agent runs.)
        env_file = str(Path(__file__).resolve().parent / ".env")
        env_file_encoding = "utf-8"
        # Tolerate undeclared keys so legacy entries (e.g. OPENAI_*
        # left over from the pre-Gemini migration) don't crash boot.
        # New settings are added explicitly to the Settings model;
        # anything else is simply ignored.
        extra = "ignore"


settings = Settings()
