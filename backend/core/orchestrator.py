"""Master coordinator: RAG retrieval + Google Gemini LLM for all agents.

Calls Gemini via the google-genai SDK with automatic retry, exponential
backoff, and a model fallback chain (e.g. 2.5-pro -> 2.5-flash -> 2.0-flash).
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

from core import firestore_db
from core.prompts.prompts import (
    PROMPTS_GEN,
    PROMPTS_SF,
    _PROJECT_SCOPE,
    _SCOPE_ONLY,
)
from rag.retriever import RAGRetriever

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOG_PATH = PROJECT_ROOT / "logs" / "agent_log.jsonl"

_RETRYABLE_CODES = {503, 429, 500, 502}


def _is_retryable(exc: Exception) -> bool:
    """Check whether the exception is a transient error worth retrying."""
    msg = str(exc)
    for code in _RETRYABLE_CODES:
        if str(code) in msg:
            return True
    for keyword in ("UNAVAILABLE", "RESOURCE_EXHAUSTED", "overloaded",
                    "high demand", "rate_limit", "Rate limit"):
        if keyword in msg:
            return True
    return False


def _should_skip_model(exc: Exception) -> bool:
    """Check if the error means this model doesn't exist — skip to next."""
    msg = str(exc)
    return "404" in msg or "NOT_FOUND" in msg or "does not exist" in msg


def _append_log(record: dict[str, Any]) -> None:
    """Persist an agent run record to Firestore (when enabled) or to disk."""
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.AGENT_RUNS).add(record)
            return
        except Exception:
            pass
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False) + "\n"
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line)


# ---------------------------------------------------------------------------
# Provider adapters
# ---------------------------------------------------------------------------

class _GeminiProvider:
    """Adapter for Google Gemini (google-genai SDK).

    Handles 2.5-series "thinking" models whose responses may include
    internal reasoning parts where ``resp.text`` returns None.
    """

    name = "gemini"

    def __init__(self, api_key: str) -> None:
        from google import genai
        self._client = genai.Client(api_key=api_key)

    @staticmethod
    def _extract_text(resp: Any) -> str:
        """Extract text from a Gemini response, handling thinking models."""
        if resp.text:
            return resp.text.strip()
        # Fallback: iterate candidate parts for actual text content
        try:
            parts = resp.candidates[0].content.parts
            texts = [p.text for p in parts if hasattr(p, "text") and p.text and not getattr(p, "thought", False)]
            if texts:
                return "\n".join(texts).strip()
        except (IndexError, AttributeError):
            pass
        return ""

    @staticmethod
    def _build_config(
        system_prompt: str, temperature: float, max_tokens: int, model: str,
    ) -> Any:
        """Build GenerateContentConfig, adding thinking budget for 2.5 models."""
        from google.genai import types
        kwargs: dict[str, Any] = {
            "system_instruction": system_prompt,
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        if "2.5" in model:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=2048)
        return types.GenerateContentConfig(**kwargs)

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int,
    ) -> str:
        """Synchronous generation — returns full text."""
        config = self._build_config(system_prompt, temperature, max_tokens, model)
        resp = self._client.models.generate_content(
            model=model, contents=user_content, config=config,
        )
        return self._extract_text(resp)

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int,
    ) -> Iterator[str]:
        """Streaming generation — yields text chunks."""
        config = self._build_config(system_prompt, temperature, max_tokens, model)
        for chunk in self._client.models.generate_content_stream(
            model=model, contents=user_content, config=config,
        ):
            piece = chunk.text or ""
            if piece:
                yield piece


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class SFQAOrchestrator:
    """Retrieve Salesforce KB context, then call Google Gemini for generation."""

    def __init__(
        self,
        *,
        provider: str = "gemini",
        gemini_api_key: str = "",
        gemini_model: str = "gemini-2.5-pro",
        gemini_fallbacks: list[str] | None = None,
        gemini_max_retries: int = 3,
        rag_top_k: int = 3,
        max_output_tokens: int = 8192,
        temperature: float = 0.25,
    ) -> None:
        self.retriever = RAGRetriever()
        self.rag_top_k = rag_top_k
        self.max_output_tokens = max_output_tokens
        self.temperature = temperature
        self._active_project: str | None = None

        self._providers: dict[str, _GeminiProvider] = {}
        self._model_chains: dict[str, list[str]] = {}
        self._max_retries_map: dict[str, int] = {}

        if gemini_api_key:
            self._providers["gemini"] = _GeminiProvider(gemini_api_key)
            self._model_chains["gemini"] = [gemini_model] + (gemini_fallbacks or [])
            self._max_retries_map["gemini"] = gemini_max_retries

        self._active_provider = provider if provider in self._providers else next(
            iter(self._providers), "gemini"
        )

    # -- public helpers --

    @property
    def provider_name(self) -> str:
        """Currently active LLM provider name."""
        return self._active_provider

    @property
    def model_name(self) -> str:
        """Primary model name for the active provider."""
        chain = self._model_chains.get(self._active_provider, [])
        return chain[0] if chain else "unknown"

    def available_providers(self) -> list[dict[str, Any]]:
        """Return list of configured providers with their models."""
        result = []
        for name, _prov in self._providers.items():
            chain = self._model_chains.get(name, [])
            result.append({
                "provider": name,
                "label": "Google Gemini",
                "model": chain[0] if chain else "",
                "fallbacks": chain[1:] if len(chain) > 1 else [],
                "active": name == self._active_provider,
            })
        return result

    def switch_provider(self, provider: str) -> bool:
        """Switch the active LLM provider. Returns True if successful."""
        if provider not in self._providers:
            return False
        self._active_provider = provider
        return True

    def set_project(self, slug: str | None) -> None:
        """Switch the active project context (None = global only)."""
        self._active_project = slug

    # -- internal --

    def _get_provider(self) -> _GeminiProvider:
        """Return the active provider instance."""
        prov = self._providers.get(self._active_provider)
        if not prov:
            raise RuntimeError(
                f"LLM provider '{self._active_provider}' is not configured. "
                f"Set GEMINI_API_KEY in backend/.env."
            )
        return prov

    def _build_messages(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None = None,
    ) -> tuple[str, str]:
        """Build (system_prompt, user_block) for a given agent call.

        When *system_prompt_override* is a non-empty string, it replaces the
        baked-in ``PROMPTS[agent_name]``. The marker swap that adapts the
        prompt to project mode still runs on the override (no-op if the
        marker isn't present), so user-edited prompts inherit the same
        scope handling as the defaults. We hard-cap overrides at 32 KB to
        prevent accidental abuse — that's roughly twice the size of our
        longest baked-in prompt.
        """
        # Normalise qa_mode to one of {"salesforce", "general"} (default salesforce
        # for back-compat with callers that pre-date the toggle).
        qa_mode_raw = str(user_input.get("qa_mode") or "salesforce").strip().lower()
        qa_mode = "general" if qa_mode_raw == "general" else "salesforce"
        # Ensure the value the prompt sees is the normalised one.
        normalised_input = {**user_input, "qa_mode": qa_mode}

        query = " ".join(
            str(v) for k, v in normalised_input.items()
            if k != "qa_mode" and str(v).strip()
        )

        if self._active_project:
            context = self.retriever.get_combined_context(
                query or agent_name,
                project_slug=self._active_project,
                global_k=max(1, self.rag_top_k - 1),
                project_k=self.rag_top_k,
            )
            # MCP servers configured on this project augment the local RAG
            # context with whatever resources external tools (GitHub,
            # Confluence, custom MCP servers, …) expose. Failures must
            # NOT block the agent — a flaky external server should at
            # worst leave us with the existing local Chroma context.
            try:
                from rag.mcp_source import MCPSource
                mcp_docs = MCPSource(self._active_project).fetch(
                    query or agent_name,
                    k=self.rag_top_k,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "MCP context fetch failed for project %s: %s",
                    self._active_project, exc,
                )
                mcp_docs = []
            if mcp_docs:
                # Group by server so the LLM can attribute claims back to
                # the originating MCP source. We label each block once so
                # the prompt stays compact even if a single server
                # returned several chunks.
                by_server: dict[str, list[str]] = {}
                for d in mcp_docs:
                    srv = d.metadata.get("mcp_server", "MCP")
                    by_server.setdefault(srv, []).append(d.page_content.strip())
                blocks: list[str] = []
                for srv, parts in by_server.items():
                    blocks.append(
                        f"### MCP CONTEXT (from {srv})\n" + "\n\n---\n\n".join(parts)
                    )
                context = (context or "").rstrip() + "\n\n" + "\n\n".join(blocks)
            scope_instructions = (
                "Instructions: You are in PROJECT MODE. "
                "Project documents are authoritative scope — derive artifacts from them. "
                "Salesforce knowledge is background reference only. "
                "Combine project documents with the user's INPUT to produce the best answer. "
                "Cite source documents where applicable. "
                "Output Markdown only — no HTML tags."
            )
        else:
            context = self.retriever.get_context(query or agent_name, k=self.rag_top_k)
            scope_instructions = (
                "Instructions: Stay strictly within the INPUT fields for scope and facts. "
                "Use retrieved context only to support Salesforce terminology or limits that apply "
                "to what the user already stated. Output Markdown only — no HTML tags."
            )

        # Mode-specific affirmations are kept short — the prompt body is now
        # mode-specific (PROMPTS_SF vs PROMPTS_GEN), so we only need a one-line
        # reminder in the user block, not the dual-mode instruction wall we used
        # to inject when there was a single conditional prompt per agent.
        if qa_mode == "salesforce":
            scope_instructions += " Salesforce QA mode is active."
        else:
            scope_instructions += (
                " General QA mode is active — produce product-agnostic artefacts; "
                "never mention Salesforce, Apex, SOQL, Lightning, Copado, or any "
                "Salesforce cloud names."
            )

        override = (system_prompt_override or "").strip()
        if override:
            if len(override) > 32_000:
                raise ValueError(
                    "system_prompt_override exceeds the 32 000-character limit."
                )
            system_prompt = override
        else:
            prompts_dict = PROMPTS_GEN if qa_mode == "general" else PROMPTS_SF
            if agent_name not in prompts_dict:
                raise KeyError(
                    f"Unknown agent '{agent_name}' for qa_mode='{qa_mode}'."
                )
            system_prompt = prompts_dict[agent_name]
        if self._active_project:
            system_prompt = system_prompt.replace(_SCOPE_ONLY, _PROJECT_SCOPE)

        compact_input = json.dumps(normalised_input, ensure_ascii=False, separators=(",", ":"))
        user_block = f"{context}\n\nINPUT:\n{compact_input}\n\n{scope_instructions}"
        return system_prompt, user_block

    def _call_with_retry(self, system_prompt: str, user_block: str) -> str:
        """Try each model in the fallback chain with exponential backoff retries."""
        provider = self._get_provider()
        chain = self._model_chains.get(self._active_provider, [])
        max_retries = self._max_retries_map.get(self._active_provider, 3)
        last_error: Exception | None = None

        for model in chain:
            for attempt in range(max_retries):
                try:
                    return provider.generate(
                        model, system_prompt, user_block,
                        self.temperature, self.max_output_tokens,
                    )
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _should_skip_model(exc):
                        break
                    if not _is_retryable(exc):
                        raise
                    wait = min(2 ** attempt * 2, 30)
                    time.sleep(wait)

        raise last_error  # type: ignore[misc]

    def _stream_with_fallback(self, system_prompt: str, user_block: str) -> Iterator[str]:
        """Stream from each model in the fallback chain, retrying on transient errors."""
        provider = self._get_provider()
        chain = self._model_chains.get(self._active_provider, [])
        max_retries = self._max_retries_map.get(self._active_provider, 3)
        last_error: Exception | None = None

        for model in chain:
            for attempt in range(max_retries):
                try:
                    for piece in provider.stream(
                        model, system_prompt, user_block,
                        self.temperature, self.max_output_tokens,
                    ):
                        yield piece
                    return
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _should_skip_model(exc):
                        break
                    if not _is_retryable(exc):
                        raise
                    wait = min(2 ** attempt * 2, 30)
                    time.sleep(wait)

        raise last_error  # type: ignore[misc]

    # -- public agent methods --

    def run_agent(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None = None,
    ) -> str:
        """Run one agent end-to-end: RAG query from flattened input, then LLM."""
        if agent_name not in PROMPTS_SF:
            raise KeyError(f"Unknown agent: {agent_name}. Valid: {list(PROMPTS_SF)}")

        if not self._providers:
            return (
                "**Error:** No LLM provider is configured. "
                "Set `GEMINI_API_KEY` in `backend/.env`."
            )

        system_prompt, user_block = self._build_messages(
            agent_name, user_input, system_prompt_override
        )
        content = ""
        try:
            content = self._call_with_retry(system_prompt, user_block)
        except Exception as exc:  # noqa: BLE001
            content = (
                f"**Error calling Gemini:** `{exc}`\n\n"
                "The model may be temporarily overloaded. "
                "Please wait a moment and try again."
            )
        finally:
            _append_log({
                "ts": datetime.now(timezone.utc).isoformat(),
                "agent": agent_name,
                "provider": self._active_provider,
                "model": self.model_name,
                "project": self._active_project,
                "input": user_input,
                "output": content,
                "output_preview": content[:500],
            })
        return content

    def stream_agent(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None = None,
    ) -> Iterator[str]:
        """Stream decoded tokens; logs the joined result when the stream completes."""
        if agent_name not in PROMPTS_SF:
            yield f"Unknown agent: {agent_name}"
            return
        if not self._providers:
            yield "**Error:** No LLM provider is configured. Set `GEMINI_API_KEY` in `backend/.env`."
            return

        try:
            system_prompt, user_block = self._build_messages(
                agent_name, user_input, system_prompt_override
            )
        except ValueError as exc:
            yield f"**Error:** {exc}"
            return
        collected: list[str] = []
        try:
            for piece in self._stream_with_fallback(system_prompt, user_block):
                collected.append(piece)
                yield piece
        except Exception as exc:  # noqa: BLE001
            err = (
                f"**Error calling Gemini:** `{exc}`\n\n"
                "The model may be temporarily overloaded. "
                "Please wait a moment and try again."
            )
            collected.append(err)
            yield err
        finally:
            full = "".join(collected)
            _append_log({
                "ts": datetime.now(timezone.utc).isoformat(),
                "agent": agent_name,
                "provider": self._active_provider,
                "model": self.model_name,
                "project": self._active_project,
                "input": user_input,
                "output": full,
                "output_preview": full[:500],
            })

    # -- utility --

    def reload_rag(self) -> None:
        """Reload vector store from disk (call after rebuilding the knowledge base)."""
        self.retriever.reload()

    def reload_project_rag(self, slug: str) -> None:
        """Drop cached project store so next access re-reads from disk."""
        self.retriever.reload_project(slug)

    def rag_status(self) -> dict[str, Any]:
        """Return RAG readiness info."""
        return {
            "is_ready": self.retriever.is_ready(),
            "chunk_count": self.retriever.chunk_count(),
            "provider": self._active_provider,
            "model": self.model_name,
            "available_providers": self.available_providers(),
            "active_project": self._active_project,
        }
