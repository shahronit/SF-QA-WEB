"""Master coordinator: RAG retrieval + multi-provider LLM for all agents.

Supported providers (intentionally limited to two — keep parity with
the deployment's licensed surface and the Sidebar dropdown):

    * Gemini      — Google native API (``GEMINI_API_KEY``)
    * Cursor CLI  — shells out to the locally-installed ``cursor-agent``
                    binary (auto-discovered from PATH /
                    %LOCALAPPDATA%\\cursor-agent on Windows,
                    ~/.local/bin on macOS/Linux)

The OpenAI / Anthropic / OpenRouter / Ollama adapter classes still
live in this module for future re-enablement, but ``deps.py`` no
longer instantiates them — which is why their ``__init__`` kwargs
are not surfaced on ``SFQAOrchestrator``.

Each provider exposes the same two methods — ``generate(model, ...)``
and ``stream(model, ...)`` — so the agent path is provider-agnostic.
The Sidebar dropdown picks a global ``(provider, model)`` pair; admins
can pin a per-agent override in the admin panel which takes precedence
on a per-call basis.

A given call resolves its (provider, model) in this order:
    1. Explicit per-call override on ``run_agent``/``stream_agent``.
    2. Per-user, per-agent admin override (``user_auth.model_overrides``).
    3. Per-agent smart default (``RECOMMENDED_DEFAULTS`` map below).
    4. Global ``self._active`` (from boot-time settings or /llm/switch).
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

logger = logging.getLogger(__name__)

from core import firestore_db, secret_fields
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

# Provider-agnostic output-discipline clamp appended at the END of
# every resolved system prompt (see ``_resolve_system_prompt``). The
# goal is that any model — Gemini OR any Cursor sub-model — produces
# the same parser-friendly artifact the agent template asks for, with
# zero conversational scaffolding. We target the three drift modes
# that break downstream consumers (Jira push, exports, deriveSummary):
#   1. Chatty preamble ("Sure! Here's…") that pollutes the first line.
#   2. Trailing meta-commentary ("Let me know if…") that confuses the
#      table-end heuristics in ``parse_testcases_markdown``.
#   3. Bonus explanation paragraphs around an artifact that's supposed
#      to be a single Markdown table or a fenced code block.
_OUTPUT_CONTRACT_CLAMP = (
    "OUTPUT CONTRACT — STRICT\n"
    "Respond with ONLY the requested artifact in the exact format the "
    "agent template above specifies. Do NOT add a preamble like "
    '"Here\'s…", "Of course…", "Sure…", "Certainly…", or any other '
    "conversational opener. Do NOT add closing remarks or "
    "meta-commentary like \"Let me know if you need…\". Do NOT explain "
    "your reasoning unless the agent template explicitly asks for it. "
    "Begin your response with the first character of the artifact "
    "(typically a heading marker `#`, a table pipe `|`, a fenced block "
    "opener ``` ``` ```, or the first character of the summary line if "
    "the template requires one). End your response with the last "
    "character of the artifact — no trailing prose, no signoff."
)

# ---------------------------------------------------------------------------
# Smart per-agent default model recommendations
# ---------------------------------------------------------------------------
#
# Each agent maps to an *ordered* list of (provider, model) pairs. The
# orchestrator walks the list at resolve-time and picks the first pair
# whose provider is registered AND whose model exists in that provider's
# catalog. If none match, the resolver falls through to the global
# ``self._active`` selection, so a deployment that only configures one
# provider still works without any code change.
#
# These defaults beat the global Sidebar pick but lose to per-user
# admin overrides — the resolution order is:
#
#     1. explicit per-call (provider_override / model_override)
#     2. per-user admin override (user_auth.model_overrides)
#     3. recommended default for this agent (THIS MAP)            <-- new
#     4. global active (self._active)
#
# The intent: when an admin hasn't pinned anything, every agent runs on
# the model best-suited to its task instead of whatever happens to be
# the global Sidebar pick. Admins still see the chip on the page header
# (PageHeader.jsx) telling them which model is actually being used.
#
# Recommendations are tunable per deployment via two env knobs:
#   * ``AGENT_RECOMMENDED_DEFAULTS``  — JSON map of
#       {agent: [[provider, model], ...]} that REPLACES this baseline
#   * ``AGENT_DEFAULTS_DISABLED``     — set to "1" / "true" to turn the
#       smart-defaults layer off entirely (every agent then runs on the
#       global Sidebar pick, just like before).
#
# Composite agents (``stlc_pack``, ``test_strategy``) are intentionally
# omitted — they fan out to other agents and each sub-agent picks its
# own default from this same map.
RECOMMENDED_DEFAULTS: dict[str, list[tuple[str, str]]] = {
    # Two-tier recommendations using ONLY the supported providers
    # (Gemini + Cursor CLI). Gemini is always the primary because:
    #   * it's the native Google API path — no subprocess overhead;
    #   * it works without an interactive ``cursor-agent login`` step;
    #   * it streams faster and supports our deterministic seed.
    #
    # Cursor CLI is the fallback so admins who route a specific user
    # via the override map can pick a Claude / GPT-flavoured model
    # that's still served through Cursor's seat — useful for cross-
    # checking output without juggling separate API keys.
    #
    # Reasoning-heavy agents -> gemini-2.5-pro;  cheap/fast agents ->
    # gemini-2.5-flash. Cursor fallback model picked to match the
    # workload (sonnet-4-thinking for deep reasoning, gpt-4o for
    # code, gpt-5-mini for cheap structured output).

    # -- Phase 1: Requirements ----------------------------------------------
    "requirement":      [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4-thinking")],
    # -- Phase 2: Planning --------------------------------------------------
    "test_plan":        [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4-thinking")],
    "estimation":       [("gemini", "gemini-2.5-flash"), ("cursor", "gpt-5-mini")],
    "automation_plan":  [("gemini", "gemini-2.5-pro"),   ("cursor", "gpt-5")],
    # -- Phase 3: Test Design / Data ---------------------------------------
    "testcase":         [("gemini", "gemini-2.5-pro"),   ("cursor", "gpt-4o")],
    "test_data":        [("gemini", "gemini-2.5-flash"), ("cursor", "gpt-5-mini")],
    "rtm":              [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4")],
    "copado_script":    [("gemini", "gemini-2.5-pro"),   ("cursor", "gpt-4o")],
    # -- Phase 4: Execution -------------------------------------------------
    "smoke":            [("gemini", "gemini-2.5-flash"), ("cursor", "gpt-5-mini")],
    "regression":       [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4-thinking")],
    "uat_plan":         [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4")],
    "bug_report":       [("gemini", "gemini-2.5-pro"),   ("cursor", "gpt-4o")],
    "exec_report":      [("gemini", "gemini-2.5-flash"), ("cursor", "gpt-5-mini")],
    # -- Phase 5: Closure ---------------------------------------------------
    "rca":              [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4-thinking")],
    "closure_report":   [("gemini", "gemini-2.5-pro"),   ("cursor", "sonnet-4")],
}


def _load_runtime_recommendations() -> dict[str, list[tuple[str, str]]]:
    """Merge baked-in defaults with the optional env-driven override map.

    Reads ``AGENT_RECOMMENDED_DEFAULTS`` from the process environment
    (deferred so unit tests can patch it) and shallow-merges it on top
    of ``RECOMMENDED_DEFAULTS``: any agent named in the env map fully
    replaces the baked-in entry; agents not named keep theirs.

    ``AGENT_DEFAULTS_DISABLED=1`` short-circuits to an empty dict so the
    resolver behaves like the legacy "always-use-global-active" path.
    """
    import os

    flag = (os.environ.get("AGENT_DEFAULTS_DISABLED") or "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return {}
    base: dict[str, list[tuple[str, str]]] = {
        k: list(v) for k, v in RECOMMENDED_DEFAULTS.items()
    }
    raw = os.environ.get("AGENT_RECOMMENDED_DEFAULTS") or ""
    if not raw.strip():
        return base
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning(
            "AGENT_RECOMMENDED_DEFAULTS is not valid JSON; ignoring.",
        )
        return base
    if not isinstance(parsed, dict):
        return base
    for agent, pairs in parsed.items():
        if not isinstance(pairs, list):
            continue
        cleaned: list[tuple[str, str]] = []
        for entry in pairs:
            if isinstance(entry, (list, tuple)) and len(entry) == 2:
                prov, mdl = entry[0], entry[1]
                if isinstance(prov, str) and isinstance(mdl, str):
                    cleaned.append((prov.strip(), mdl.strip()))
            elif isinstance(entry, dict):
                prov = (entry.get("provider") or "").strip()
                mdl = (entry.get("model") or "").strip()
                if prov and mdl:
                    cleaned.append((prov, mdl))
        if cleaned:
            base[agent] = cleaned
    return base


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


# Substrings (case-insensitive) that mean "this model is unusable from
# this provider — try the next one in the fallback chain". Covers the
# Gemini-style HTTP 404 envelope AND the cursor-agent stderr patterns
# (model alias not licensed for the seat, login required, rate limit,
# permission denied). Without the cursor-side patterns the fallback
# chain would just retry the same dead model `max_retries` times before
# giving up.
_SKIP_PATTERNS = (
    # HTTP / Gemini SDK
    "404", "not_found", "does not exist",
    # cursor-agent CLI stderr
    "model not found", "unknown model", "no models available",
    "not authenticated", "permission denied",
    "rate limit", "rate_limit", "quota exceeded",
)


def _should_skip_model(exc: Exception) -> bool:
    """Check if the error means this model is unusable — skip to next."""
    msg = str(exc).lower()
    return any(pat in msg for pat in _SKIP_PATTERNS)


# Conservative regexes for the leading / trailing chatter LLMs prepend
# even when explicitly told not to. Anchored on common openings so we
# never strip valid content (e.g. an agent template that legitimately
# starts with "Sure, the test plan is below" — that wording doesn't
# appear in any prompt we ship).
import re as _re  # local alias keeps the public re import unaffected
_LEADING_CHATTER_RE = _re.compile(
    r"^\s*(?:"
    r"sure[!,.\-:\s]"           # "Sure! Here's"
    r"|of\s+course\b"           # "Of course"
    r"|certainly\b"             # "Certainly"
    r"|absolutely\b"            # "Absolutely"
    r"|here\s+is\b"             # "Here is the test plan"
    r"|here'?s\b"               # "Here's the test plan"
    r"|below\s+is\b"            # "Below is..."
    r"|i'?ll\s+"                # "I'll generate"
    r"|i\s+will\s+"             # "I will generate"
    r"|let\s+me\s+"             # "Let me build"
    r"|happy\s+to\s+"           # "Happy to help"
    r"|great[!,.\-:\s]"         # "Great! Here we go"
    r"|okay[!,.\-:\s]"          # "Okay, here is"
    r"|got\s+it\b"              # "Got it. Here..."
    r")",
    _re.IGNORECASE,
)
_TRAILING_CHATTER_RE = _re.compile(
    r"^\s*(?:"
    r"let\s+me\s+know\b"
    r"|if\s+(?:you\s+)?need\b"
    r"|feel\s+free\b"
    r"|hope\s+(?:this\s+)?helps?\b"
    r"|i\s+hope\b"
    r"|don'?t\s+hesitate\b"
    r"|happy\s+(?:to\s+)?(?:help|assist)\b"
    r"|please\s+let\s+me\s+know\b"
    r"|thanks?[!,.\s]"
    r"|cheers[!,.\s]"
    r")",
    _re.IGNORECASE,
)
# A line is "structural" (= start of the actual artifact, do NOT strip)
# when it begins with markdown structure: heading, table pipe, fenced
# block opener, blockquote, numbered/bulleted list, bold marker, or a
# bare digit-period (atom-tagged summary line in bug_report).
_STRUCTURAL_LEAD_RE = _re.compile(
    r"^\s*(?:#|\||```|>|\*\s|-\s|\d+\.\s|\*\*|_[A-Z]|\[)"
)


def _strip_chatter(text: str) -> str:
    """Remove leading + trailing conversational scaffolding from LLM output.

    Walks line-by-line from the top until the first "structural" line
    (markdown heading, table, fenced code, list, blockquote) is hit,
    discarding any leading line that matches the chatter regex. Then
    walks from the bottom doing the same for trailing chatter.

    Conservative on purpose:
      * Stops the moment a structural line is reached so legitimate
        content is never trimmed.
      * Only strips lines that match the chatter regex; non-matching
        lines are kept and the walk stops immediately.
      * Returns the input unchanged when it begins/ends with structure
        already (the common Gemini case).

    This protects every downstream consumer that reads the first or
    last meaningful line — ``deriveSummary`` for Jira bugs, the table
    parser's row-detection heuristics, ``copado_script``'s
    ``### filename.ext`` extractor, and the export pipeline's section
    splitter.
    """
    if not text or not text.strip():
        return text
    lines = text.splitlines()

    # Forward strip — drop chatter lines until the first structural one.
    start = 0
    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            # Allow blank lines that follow a chatter line; bail on a
            # blank that follows an already-kept content line.
            if start < i:
                break
            start = i + 1
            continue
        if _STRUCTURAL_LEAD_RE.match(raw):
            start = i
            break
        if _LEADING_CHATTER_RE.match(raw):
            start = i + 1
            continue
        # Non-chatter, non-structural line → keep it and stop scanning.
        start = i
        break

    # Backward strip — drop trailing chatter / signoff lines.
    end = len(lines)
    for j in range(len(lines) - 1, max(start - 1, -1), -1):
        line = lines[j].strip()
        if not line:
            end = j
            continue
        if _STRUCTURAL_LEAD_RE.match(lines[j]):
            end = j + 1
            break
        if _TRAILING_CHATTER_RE.match(lines[j]):
            end = j
            continue
        end = j + 1
        break

    if start == 0 and end == len(lines):
        return text
    return "\n".join(lines[start:end]).strip("\n")


def _append_log(record: dict[str, Any]) -> None:
    """Persist an agent run record (Firestore or local JSONL).

    The bulky free-text fields (``input``, ``output``) are encrypted
    before persistence because they may contain ticket bodies, RAG
    snippets, customer data pasted by the user, or prompt-shaped LLM
    output that a database dump would otherwise expose verbatim. The
    short ``output_preview`` stays plaintext for the admin "History"
    UI but is intentionally truncated below to keep the leak tiny.
    """
    persisted = dict(record)
    for field in ("input", "output"):
        val = persisted.get(field)
        if isinstance(val, str) and val:
            try:
                persisted[field] = secret_fields.encrypt_secret(val)
            except Exception:  # noqa: BLE001
                # If encryption is misconfigured we'd rather drop the
                # transcript than leak plaintext to disk - the agent
                # already returned the result to the caller.
                logger.exception("Failed to encrypt agent_run %s", field)
                persisted[field] = ""
    if firestore_db.is_enabled():
        try:
            db = firestore_db.get_db()
            db.collection(firestore_db.AGENT_RUNS).add(persisted)
            return
        except Exception:
            pass
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(persisted, ensure_ascii=False) + "\n"
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line)


# ---------------------------------------------------------------------------
# Provider adapters
# ---------------------------------------------------------------------------
#
# Every concrete provider class conforms to ``LLMProvider`` so the
# orchestrator can dispatch the agent loop without knowing which SDK is
# being called. ``generate`` returns the full string, ``stream`` yields
# string fragments. ``model`` is *always* required so per-agent
# overrides can route to a specific model without first switching the
# global active provider.


class LLMProvider(Protocol):
    """Common interface every LLM adapter implements."""

    name: str
    label: str

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> str: ...

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> Iterator[str]: ...


def _coerce_usage(
    *,
    prompt_tokens: int | None,
    completion_tokens: int | None,
    total_tokens: int | None = None,
    source: str = "live",
) -> dict[str, Any]:
    """Build the canonical token-usage envelope every provider returns.

    All four LLM provider SDKs report token counts under different
    field names; this helper guarantees the same wire-format reaches
    the frontend regardless of which adapter generated the run. A
    missing count is reported as ``None`` (rendered as "—" in the UI)
    rather than zero so users can tell "we didn't get it" apart from
    "we used zero tokens" (impossible in practice but possible in tests).

    ``source`` annotates how the count was obtained:
        * ``"live"``      — pulled from the SDK response;
        * ``"estimated"`` — rough char-length heuristic (Cursor CLI);
        * ``"cached"``    — replayed from the response cache.
    """
    p = int(prompt_tokens) if prompt_tokens is not None else None
    c = int(completion_tokens) if completion_tokens is not None else None
    t = int(total_tokens) if total_tokens is not None else (
        (p or 0) + (c or 0) if (p is not None or c is not None) else None
    )
    return {
        "prompt_tokens": p,
        "completion_tokens": c,
        "total_tokens": t,
        "source": source,
    }


def _estimate_tokens(text: str) -> int:
    """Crude char-length token estimate for providers that don't report usage.

    Used by the Cursor CLI provider where the underlying CLI doesn't
    surface token accounting. The 4-chars-per-token rule is the same
    rough heuristic OpenAI documents for English; non-English content
    (CJK especially) over-counts by roughly 2x but the order of
    magnitude is still useful for "did this run a small or large
    prompt?" UX feedback.
    """
    if not text:
        return 0
    return max(1, len(text) // 4)


class _GeminiProvider:
    """Adapter for Google Gemini (google-genai SDK).

    Handles 2.5-series "thinking" models whose responses may include
    internal reasoning parts where ``resp.text`` returns None.
    """

    name = "gemini"
    label = "Google Gemini"

    def __init__(self, api_key: str) -> None:
        from google import genai
        self._client = genai.Client(api_key=api_key)
        # Populated by ``generate`` / ``stream`` after each call so the
        # orchestrator can attach token usage to history records and
        # the SSE stream's terminal ``usage`` event.
        self.last_usage: dict[str, Any] | None = None

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
        seed: int | None = None,
    ) -> Any:
        """Build GenerateContentConfig, adding thinking budget for 2.5 models.

        ``seed`` is forwarded when supported. Combined with
        ``temperature=0`` it gives the strongest reproducibility
        guarantee Gemini exposes today: identical INPUT → identical
        OUTPUT across calls. Older SDK versions silently ignore the
        kwarg, so callers stay safe.
        """
        from google.genai import types
        kwargs: dict[str, Any] = {
            "system_instruction": system_prompt,
            "temperature": temperature,
            "max_output_tokens": max_tokens,
        }
        # Pin top_p / top_k to fully greedy when temperature is 0 so the
        # remaining sampling-policy knobs don't reintroduce variance.
        if temperature <= 0.0:
            kwargs["top_p"] = 0.0
            kwargs["top_k"] = 1
        if seed is not None:
            try:
                # Best-effort; some SDK versions don't expose `seed` on
                # GenerateContentConfig. We probe by attempting the call
                # with the kwarg and falling back to the kwarg-less form.
                cfg = types.GenerateContentConfig(**kwargs, seed=int(seed))
                if "2.5" in model:
                    cfg.thinking_config = types.ThinkingConfig(thinking_budget=2048)
                return cfg
            except TypeError:
                pass
        if "2.5" in model:
            kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=2048)
        return types.GenerateContentConfig(**kwargs)

    @staticmethod
    def _extract_usage(resp: Any) -> dict[str, Any] | None:
        """Pull token counts out of a Gemini response.

        Gemini exposes usage as ``response.usage_metadata`` with
        ``prompt_token_count``, ``candidates_token_count``,
        ``total_token_count``. On streamed runs the *last* chunk
        carries the cumulative metadata; intermediate chunks may
        also have it but with growing counts so we always overwrite.
        """
        meta = getattr(resp, "usage_metadata", None)
        if meta is None:
            return None
        return _coerce_usage(
            prompt_tokens=getattr(meta, "prompt_token_count", None),
            completion_tokens=getattr(meta, "candidates_token_count", None),
            total_tokens=getattr(meta, "total_token_count", None),
        )

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> str:
        """Synchronous generation — returns full text."""
        self.last_usage = None
        config = self._build_config(
            system_prompt, temperature, max_tokens, model, seed=seed,
        )
        resp = self._client.models.generate_content(
            model=model, contents=user_content, config=config,
        )
        self.last_usage = self._extract_usage(resp)
        return self._extract_text(resp)

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> Iterator[str]:
        """Streaming generation — yields text chunks."""
        self.last_usage = None
        config = self._build_config(
            system_prompt, temperature, max_tokens, model, seed=seed,
        )
        for chunk in self._client.models.generate_content_stream(
            model=model, contents=user_content, config=config,
        ):
            usage = self._extract_usage(chunk)
            if usage is not None:
                # Each Gemini chunk carries the *cumulative* count, so
                # overwriting on every chunk leaves us with the final
                # totals once the stream completes.
                self.last_usage = usage
            piece = chunk.text or ""
            if piece:
                yield piece


class _OpenAIProvider:
    """Adapter for OpenAI Chat Completions (also used as the OpenRouter base).

    The OpenRouter subclass just overrides ``name`` / ``label`` and
    swaps the client's ``base_url`` so we don't duplicate streaming
    logic between the two.
    """

    name = "openai"
    label = "OpenAI"

    def __init__(
        self, api_key: str, *, base_url: str | None = None,
        default_headers: dict | None = None,
    ) -> None:
        from openai import OpenAI
        kwargs: dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        if default_headers:
            kwargs["default_headers"] = default_headers
        self._client = OpenAI(**kwargs)
        self.last_usage: dict[str, Any] | None = None

    def _messages(self, system_prompt: str, user_content: str) -> list[dict]:
        return [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]

    @staticmethod
    def _extract_usage(usage: Any) -> dict[str, Any] | None:
        """Translate an OpenAI ``usage`` object into our canonical dict."""
        if usage is None:
            return None
        return _coerce_usage(
            prompt_tokens=getattr(usage, "prompt_tokens", None),
            completion_tokens=getattr(usage, "completion_tokens", None),
            total_tokens=getattr(usage, "total_tokens", None),
        )

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> str:
        self.last_usage = None
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": self._messages(system_prompt, user_content),
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if seed is not None:
            kwargs["seed"] = int(seed)
        try:
            resp = self._client.chat.completions.create(**kwargs)
        except TypeError:
            kwargs.pop("seed", None)
            resp = self._client.chat.completions.create(**kwargs)
        self.last_usage = self._extract_usage(getattr(resp, "usage", None))
        choice = resp.choices[0] if resp.choices else None
        return (choice.message.content or "").strip() if choice else ""

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> Iterator[str]:
        self.last_usage = None
        # ``stream_options.include_usage=True`` makes the OpenAI streaming
        # API emit a final empty-choice chunk that carries the total
        # ``usage`` object — our only way to get token counts during
        # streaming. OpenRouter forwards the same flag when the
        # underlying model supports it.
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": self._messages(system_prompt, user_content),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if seed is not None:
            kwargs["seed"] = int(seed)
        try:
            stream = self._client.chat.completions.create(**kwargs)
        except TypeError:
            # Older client versions don't recognise ``stream_options`` —
            # retry without it. We lose token usage for the stream but
            # the run still completes.
            kwargs.pop("stream_options", None)
            try:
                stream = self._client.chat.completions.create(**kwargs)
            except TypeError:
                kwargs.pop("seed", None)
                stream = self._client.chat.completions.create(**kwargs)
        for chunk in stream:
            usage = self._extract_usage(getattr(chunk, "usage", None))
            if usage is not None:
                self.last_usage = usage
            try:
                # The terminal usage chunk carries an empty choices list;
                # guard so that doesn't raise.
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                piece = getattr(delta, "content", None) or ""
            except (IndexError, AttributeError):
                piece = ""
            if piece:
                yield piece


class _OpenRouterProvider(_OpenAIProvider):
    """OpenRouter — OpenAI-compatible API with a custom base_url."""

    name = "openrouter"
    label = "OpenRouter"

    def __init__(self, api_key: str) -> None:
        super().__init__(
            api_key,
            base_url="https://openrouter.ai/api/v1",
            default_headers={
                "HTTP-Referer": "https://qa-studio.local",
                "X-Title": "QA Studio",
            },
        )


class _AnthropicProvider:
    """Adapter for Anthropic Claude (anthropic SDK)."""

    name = "anthropic"
    label = "Anthropic Claude"

    def __init__(self, api_key: str) -> None:
        from anthropic import Anthropic
        self._client = Anthropic(api_key=api_key)
        self.last_usage: dict[str, Any] | None = None

    @staticmethod
    def _extract_usage(usage: Any) -> dict[str, Any] | None:
        if usage is None:
            return None
        return _coerce_usage(
            prompt_tokens=getattr(usage, "input_tokens", None),
            completion_tokens=getattr(usage, "output_tokens", None),
        )

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> str:
        # Anthropic doesn't support a seed param today; we accept it for
        # signature parity and silently ignore.
        del seed
        self.last_usage = None
        resp = self._client.messages.create(
            model=model,
            system=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": user_content}],
        )
        self.last_usage = self._extract_usage(getattr(resp, "usage", None))
        parts: list[str] = []
        for block in resp.content or []:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
        return "".join(parts).strip()

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> Iterator[str]:
        del seed
        self.last_usage = None
        with self._client.messages.stream(
            model=model,
            system=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            for piece in stream.text_stream:
                if piece:
                    yield piece
            # The Anthropic SDK aggregates the input + output token counts
            # on the final ``Message`` object once the stream completes.
            # Reading it after the loop guarantees we have the totals.
            try:
                final = stream.get_final_message()
                self.last_usage = self._extract_usage(getattr(final, "usage", None))
            except Exception:  # noqa: BLE001
                pass


class _OllamaProvider:
    """Adapter for a locally-running Ollama daemon (NDJSON stream)."""

    name = "ollama"
    label = "Ollama (local)"

    def __init__(self, base_url: str) -> None:
        self._base_url = (base_url or "http://localhost:11434").rstrip("/")
        self.last_usage: dict[str, Any] | None = None

    def _payload(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None,
    ) -> dict:
        options: dict[str, Any] = {
            "temperature": float(temperature),
            "num_predict": int(max_tokens),
        }
        if seed is not None:
            options["seed"] = int(seed)
        return {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            "options": options,
        }

    @staticmethod
    def _extract_usage(evt: dict) -> dict[str, Any] | None:
        """Read Ollama's NDJSON ``done`` event for prompt/eval token counts."""
        if not isinstance(evt, dict):
            return None
        prompt = evt.get("prompt_eval_count")
        completion = evt.get("eval_count")
        if prompt is None and completion is None:
            return None
        return _coerce_usage(
            prompt_tokens=prompt, completion_tokens=completion,
        )

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> str:
        import httpx
        self.last_usage = None
        body = self._payload(
            model, system_prompt, user_content, temperature, max_tokens, seed,
        )
        body["stream"] = False
        with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
            resp = client.post(f"{self._base_url}/api/chat", json=body)
            resp.raise_for_status()
            data = resp.json()
        self.last_usage = self._extract_usage(data)
        return ((data.get("message") or {}).get("content") or "").strip()

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> Iterator[str]:
        import httpx
        self.last_usage = None
        body = self._payload(
            model, system_prompt, user_content, temperature, max_tokens, seed,
        )
        body["stream"] = True
        with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
            with client.stream("POST", f"{self._base_url}/api/chat", json=body) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    try:
                        evt = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    piece = (evt.get("message") or {}).get("content") or ""
                    if piece:
                        yield piece
                    if evt.get("done"):
                        # Ollama only emits prompt_eval_count + eval_count
                        # on the terminal event when streaming completes.
                        usage = self._extract_usage(evt)
                        if usage is not None:
                            self.last_usage = usage
                        break


class _CursorAgentProvider:
    """Adapter that shells out to the local ``cursor-agent`` CLI.

    Each call spawns ``cursor-agent -p "<prompt>" -m <model>
    --output-format stream-json`` and parses the streaming JSON events.
    Only enabled when ``CURSOR_AGENT_BIN`` is set (or the binary is
    discoverable on PATH). The system prompt and the user content are
    concatenated into a single prompt because ``cursor-agent`` does not
    expose a separate system-message slot in its CLI flags.
    """

    name = "cursor"
    label = "Cursor (CLI)"

    def __init__(self, binary: str | None = None) -> None:
        # Resolve the binary now so callers see a clear error at boot
        # time rather than mid-stream. We keep the original string so
        # subprocess.run can re-resolve it later if PATH changes.
        self._binary = binary or shutil.which("cursor-agent") or "cursor-agent"
        self.last_usage: dict[str, Any] | None = None
        # Probe `cursor-agent --help` once at construction so we know
        # which sampling / formatting flags this CLI version actually
        # accepts. Older builds silently choke on unknown flags so
        # gating each forward on the discovered set keeps us forward-
        # AND backward-compatible. Failure is silent — we behave as
        # if no flags are supported (current legacy behavior).
        self._supported_flags: set[str] = self._discover_flags()

    @classmethod
    def _discover_flags(cls, binary: str | None = None) -> set[str]:
        """Probe `cursor-agent --help` for supported control flags.

        We look for the long-form flags the orchestrator wants to
        forward (sampling controls + structured-output mode). When
        the help text is unreachable (binary missing, login wall,
        timeout) we return an empty set so every call site falls
        back to the no-flag legacy path.
        """
        bin_path = binary or shutil.which("cursor-agent") or "cursor-agent"
        try:
            result = subprocess.run(
                [bin_path, "--help"], capture_output=True, text=True,
                encoding="utf-8", timeout=8, check=False,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            return set()
        blob = ((result.stdout or "") + "\n" + (result.stderr or "")).lower()
        candidates = (
            "--temperature", "--seed", "--max-tokens",
            "--top-p", "--output-format",
        )
        return {flag for flag in candidates if flag in blob}

    @classmethod
    def discover_models(cls, binary: str | None = None) -> list[str]:
        """Best-effort: list models the installed cursor-agent supports.

        Probes the CLI's documented model-listing flags in priority
        order:

        1. ``cursor-agent --list-models`` — the official non-interactive
           flag (works without authentication; returns "No models
           available for this account." until the user runs
           ``cursor-agent login``, which we then treat as zero models
           rather than a parse error).
        2. ``cursor-agent models`` — same data, exposed as a sub-command
           on newer builds.
        3. ``cursor-agent --help`` parsed for an explicit
           ``--model {a,b,c}`` choices block (legacy builds).

        Returns an empty list when the binary is missing, the call
        times out, the user isn't logged in, or nothing parseable
        shows up — the orchestrator merges this with the static
        catalog so a discovery failure never strips models out of
        the dropdown.
        """
        bin_path = binary or shutil.which("cursor-agent") or "cursor-agent"
        # Cap each probe so a hung CLI can't stall server boot. The
        # cursor-agent JS bootstrap can take several seconds on cold
        # start so 8s gives it room without blocking boot for long.
        timeout = 8

        def _run(args: list[str]) -> str:
            try:
                result = subprocess.run(
                    [bin_path, *args], capture_output=True, text=True,
                    encoding="utf-8", timeout=timeout, check=False,
                )
            except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
                return ""
            return (result.stdout or "") + "\n" + (result.stderr or "")

        def _parse_lines(blob: str) -> list[str]:
            """Pull plausible model IDs out of a CLI line-list."""
            out: list[str] = []
            for line in blob.splitlines():
                tok = line.strip().strip("*").strip("-").strip()
                if not tok:
                    continue
                low = tok.lower()
                # Reject the unauthenticated empty-state message and
                # any other human-prose lines.
                if "no models" in low or low.startswith("available"):
                    continue
                if low.startswith("#") or low.startswith("error"):
                    continue
                # Model ids are always single tokens (no whitespace).
                if " " in tok or "\t" in tok:
                    continue
                out.append(tok)
            return out

        # 1. --list-models (preferred — explicit non-interactive flag)
        models = _parse_lines(_run(["--list-models"]))
        if models:
            return sorted(set(models))

        # 2. `models` sub-command
        models = _parse_lines(_run(["models"]))
        if models:
            return sorted(set(models))

        # 3. legacy `--model {a,b,c}` choices block in --help text
        import re

        help_text = _run(["--help"])
        match = re.search(r"--?m(?:odel)?\s*\{([^}]+)\}", help_text)
        if match:
            candidates = [m.strip() for m in match.group(1).split(",")]
            models = [m for m in candidates if m and " " not in m]
        return sorted(set(models))

    @staticmethod
    def _build_prompt(system_prompt: str, user_content: str) -> str:
        # No dedicated system-message flag — fold the system prompt
        # into a single labelled block so the model still sees it.
        return (
            f"# SYSTEM\n{system_prompt}\n\n# USER\n{user_content}\n"
        )

    def _call_args(
        self, model: str, *,
        temperature: float | None = None,
        seed: int | None = None,
        max_tokens: int | None = None,
        output_format: str | None = None,
    ) -> list[str]:
        """Build the CLI argument list for a generation/stream call.

        Sampling + formatting flags are added ONLY when the installed
        ``cursor-agent`` actually advertises them in ``--help``. This
        keeps reproducibility parity with Gemini (when supported)
        without breaking older CLI builds that would crash on an
        unknown flag. ``temperature=0`` is always forwarded when the
        flag exists so the deterministic-decode guarantee carries
        across providers.
        """
        args: list[str] = []
        # "auto" / "default" lets cursor-agent pick whichever model is
        # licensed on the seat; otherwise forward the explicit choice.
        if model and model.lower() not in {"auto", "default"}:
            args.extend(["-m", model])
        if temperature is not None and "--temperature" in self._supported_flags:
            args.extend(["--temperature", f"{float(temperature):.2f}"])
        if seed is not None and "--seed" in self._supported_flags:
            args.extend(["--seed", str(int(seed))])
        if max_tokens is not None and "--max-tokens" in self._supported_flags:
            args.extend(["--max-tokens", str(int(max_tokens))])
        if output_format and "--output-format" in self._supported_flags:
            args.extend(["--output-format", output_format])
        return args

    @staticmethod
    def _extract_usage_from_event(evt: dict) -> dict[str, Any] | None:
        """Pull token counts from a cursor-agent stream-json event when present.

        The cursor-agent ``stream-json`` schema embeds a ``usage``
        object on the terminal ``result`` / ``end_turn`` event with
        keys mirroring OpenAI's (``input_tokens``, ``output_tokens``).
        We probe a few likely locations because Cursor's CLI schema is
        not part of any stable public contract. Returns the count
        marked ``source="live"`` so the UI chip renders mint instead
        of amber.
        """
        if not isinstance(evt, dict):
            return None
        usage = evt.get("usage")
        if not isinstance(usage, dict):
            usage = (evt.get("message") or {}).get("usage") if isinstance(evt.get("message"), dict) else None
        if not isinstance(usage, dict):
            return None
        prompt = usage.get("input_tokens") or usage.get("prompt_tokens")
        completion = usage.get("output_tokens") or usage.get("completion_tokens")
        if prompt is None and completion is None:
            return None
        # ``source="live"`` marks this as a real provider count so the
        # chip on the report panel reads mint/"live" rather than amber/
        # "~est". _coerce_usage's default source is already "live", but
        # being explicit guards against future helper changes.
        return _coerce_usage(
            prompt_tokens=prompt, completion_tokens=completion,
            source="live",
        )

    def _stream_wallclock_budget_seconds(self) -> float:
        """Conservative ceiling on a single cursor-agent stream call.

        The Gemini SDK has its own per-call timeout; for Cursor we
        derive one from the orchestrator-level ``max_output_tokens``
        budget (treating each token as ~40ms of wall time on the
        slowest sub-models, plus a flat 60s startup grace). This
        prevents a hung subprocess from holding an SSE connection
        open indefinitely.
        """
        # Defaults assume the orchestrator's standard 8K token budget
        # → ~5 min ceiling. We expose this as a method (not a constant)
        # so tests / future tunings can monkey-patch it cleanly.
        return 60.0 + 8192 * 0.04

    def generate(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> str:
        self.last_usage = None
        prompt = self._build_prompt(system_prompt, user_content)
        # Prefer JSON output so we get the same live ``usage`` envelope
        # the streaming path already parses. Older cursor-agent builds
        # that don't advertise --output-format fall back to the legacy
        # plain-text path with token estimation.
        prefer_json = "--output-format" in self._supported_flags
        cmd = [
            self._binary, "-p", prompt,
            *self._call_args(
                model,
                temperature=temperature,
                seed=seed,
                max_tokens=max_tokens,
                output_format="json" if prefer_json else None,
            ),
        ]
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, encoding="utf-8",
                check=False, timeout=300,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "cursor-agent binary not found. Install Cursor and set "
                "CURSOR_AGENT_BIN in backend/.env."
            ) from exc
        if result.returncode != 0:
            raise RuntimeError(
                f"cursor-agent exited {result.returncode}: "
                f"{(result.stderr or '').strip() or 'no stderr'}"
            )
        stdout = (result.stdout or "").strip()

        # JSON envelope path — extract text + live usage if both are
        # present. cursor-agent returns either a single JSON object
        # (``{ result, usage, ... }``) or a JSON array of events; we
        # tolerate both.
        if prefer_json and stdout:
            text, live_usage = self._parse_json_envelope(stdout)
            if text or live_usage is not None:
                self.last_usage = live_usage or _coerce_usage(
                    prompt_tokens=_estimate_tokens(prompt),
                    completion_tokens=_estimate_tokens(text),
                    source="estimated",
                )
                return text or stdout

        # Legacy plain-text fallback — estimate counts so the chip
        # always shows *something* and tag the source as "estimated".
        self.last_usage = _coerce_usage(
            prompt_tokens=_estimate_tokens(prompt),
            completion_tokens=_estimate_tokens(stdout),
            source="estimated",
        )
        return stdout

    def _parse_json_envelope(
        self, blob: str,
    ) -> tuple[str, dict[str, Any] | None]:
        """Extract response text + usage from a cursor-agent JSON dump.

        Schemas observed in the wild:
          * ``{"result": "...", "usage": {input_tokens, output_tokens}}``
          * ``{"text": "...", "usage": {...}}``
          * ``{"message": {"content": "...", "usage": {...}}}``
          * ``[{event...}, {event...}, {result event with usage}]``

        Returns ``("", None)`` when nothing parseable is found so the
        caller can fall back to the raw stdout.
        """
        try:
            parsed = json.loads(blob)
        except json.JSONDecodeError:
            return "", None

        def _scan(obj: Any) -> tuple[str, dict[str, Any] | None]:
            if isinstance(obj, dict):
                text = ""
                if isinstance(obj.get("result"), str):
                    text = obj["result"]
                elif isinstance(obj.get("text"), str):
                    text = obj["text"]
                elif isinstance(obj.get("message"), dict):
                    inner = obj["message"].get("content")
                    if isinstance(inner, str):
                        text = inner
                usage = self._extract_usage_from_event(obj)
                return text, usage
            if isinstance(obj, list):
                acc_text: list[str] = []
                final_usage: dict[str, Any] | None = None
                for evt in obj:
                    t, u = _scan(evt)
                    if t:
                        acc_text.append(t)
                    if u is not None:
                        final_usage = u
                return "".join(acc_text), final_usage
            return "", None

        return _scan(parsed)

    def stream(
        self, model: str, system_prompt: str, user_content: str,
        temperature: float, max_tokens: int, seed: int | None = None,
    ) -> Iterator[str]:
        # subprocess streams aren't natively async-iterable; spawn the
        # process synchronously and read its stdout line-by-line so the
        # outer SSE loop can yield tokens as they arrive.
        self.last_usage = None
        prompt = self._build_prompt(system_prompt, user_content)
        cmd = [
            self._binary, "-p", prompt,
            *self._call_args(
                model,
                temperature=temperature,
                seed=seed,
                max_tokens=max_tokens,
                output_format="stream-json",
            ),
        ]
        try:
            proc = subprocess.Popen(  # noqa: S603 - args are constants
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except FileNotFoundError as exc:
            raise RuntimeError(
                "cursor-agent binary not found. Install Cursor and set "
                "CURSOR_AGENT_BIN in backend/.env."
            ) from exc
        collected_text: list[str] = []
        live_usage: dict[str, Any] | None = None
        # Wall-clock budget — kill the subprocess if cursor-agent
        # hangs (e.g. waiting on a re-auth prompt) so we don't leak
        # the HTTP connection.
        deadline = time.monotonic() + self._stream_wallclock_budget_seconds()
        timed_out = False
        try:
            assert proc.stdout is not None
            for raw in proc.stdout:
                if time.monotonic() > deadline:
                    timed_out = True
                    break
                line = raw.strip()
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                except json.JSONDecodeError:
                    # Plain-text fallback for older cursor-agent builds
                    # that don't emit JSON when --output-format is
                    # ignored — yield the raw line so the user still
                    # sees output.
                    collected_text.append(raw)
                    yield raw
                    continue
                # Best-effort schema match: every text-like event is
                # forwarded so we stay robust if Cursor changes their
                # event names. Known shapes: {"type": "text_delta",
                # "delta": "..."}, {"type": "assistant", "text": "..."}.
                piece = (
                    evt.get("delta")
                    or evt.get("text")
                    or (evt.get("message") or {}).get("content")
                    or ""
                )
                if isinstance(piece, str) and piece:
                    collected_text.append(piece)
                    yield piece
                # Sniff for a usage payload on every event — the CLI
                # currently puts it on the terminal "result" event but
                # we don't depend on that being the schema forever.
                live = self._extract_usage_from_event(evt)
                if live is not None:
                    live_usage = live
            if timed_out:
                # Force-stop the runaway process and surface a clean
                # error envelope to the orchestrator's retry layer.
                try:
                    proc.kill()
                except Exception:  # noqa: BLE001
                    pass
                raise RuntimeError(
                    f"cursor-agent stream exceeded "
                    f"{self._stream_wallclock_budget_seconds():.0f}s wall-clock budget"
                )
            proc.wait(timeout=10)
            if proc.returncode not in (0, None):
                err = (proc.stderr.read() if proc.stderr else "").strip()
                raise RuntimeError(
                    f"cursor-agent exited {proc.returncode}: {err or 'no stderr'}"
                )
        finally:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass
            # Prefer the CLI's reported counts when we found them;
            # otherwise estimate from char totals so the user always
            # sees *something* in the token chip for cursor runs.
            if live_usage is not None:
                self.last_usage = live_usage
            else:
                self.last_usage = _coerce_usage(
                    prompt_tokens=_estimate_tokens(prompt),
                    completion_tokens=_estimate_tokens("".join(collected_text)),
                    source="estimated",
                )


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

class SFQAOrchestrator:
    """Retrieve KB context, then call the active LLM provider for generation."""

    def __init__(
        self,
        *,
        provider: str = "gemini",
        gemini_api_key: str = "",
        gemini_model: str = "gemini-2.5-pro",
        gemini_fallbacks: list[str] | None = None,
        gemini_max_retries: int = 3,
        # Cursor CLI is the only other supported provider. The other
        # adapter classes (_OpenAIProvider, _AnthropicProvider,
        # _OpenRouterProvider, _OllamaProvider) intentionally still
        # exist below, but their __init__ kwargs are NOT exposed here
        # — the deployment runs gemini + cursor exclusively. Re-add
        # the kwargs here AND the registration block below to bring
        # any of them back without rewriting client code.
        cursor_agent_bin: str = "",
        cursor_agent_models: list[str] | None = None,
        # Default 2 (was 1): subprocess overhead is real but a single
        # retry is too aggressive when transient errors are the most
        # common cursor-agent failure mode (auth-token refresh, brief
        # network hiccup). Skip-on-model-error in _should_skip_model
        # still short-circuits the loop for permanent failures.
        cursor_agent_max_retries: int = 2,
        # When True, also probe the installed cursor-agent CLI for its
        # built-in model catalog and merge it with cursor_agent_models.
        # Failure is silent so the dropdown always at least reflects
        # the static list.
        cursor_agent_discover: bool = True,
        rag_top_k: int = 3,
        max_output_tokens: int = 8192,
        temperature: float = 0.0,
        seed: int | None = 7,
        cache_enabled: bool = True,
        cache_max_entries: int = 1000,
    ) -> None:
        self.retriever = RAGRetriever()
        self.rag_top_k = rag_top_k
        self.max_output_tokens = max_output_tokens
        self.temperature = temperature
        self.seed = seed
        self._active_project: str | None = None
        # Lazy-initialised LLM response cache. Importing here keeps the
        # cache module truly optional: tests that patch the orchestrator
        # don't need to know about it.
        self._cache = None
        if cache_enabled:
            try:
                from core.llm_cache import LLMResponseCache
                self._cache = LLMResponseCache(max_entries=cache_max_entries)
            except Exception:  # noqa: BLE001
                self._cache = None

        # Provider catalog: every registered provider lives in
        # ``_providers`` keyed by name (the same key used by the API
        # surface and the per-agent override records). ``_models_by_provider``
        # is the dropdown catalog; the first entry per provider is its
        # default model.
        self._providers: dict[str, LLMProvider] = {}
        self._models_by_provider: dict[str, list[str]] = {}
        self._max_retries_map: dict[str, int] = {}

        if gemini_api_key:
            self._register(
                _GeminiProvider(gemini_api_key),
                models=[gemini_model] + (gemini_fallbacks or []),
                max_retries=gemini_max_retries,
            )

        if cursor_agent_bin:
            try:
                # Merge the static catalog with whatever cursor-agent
                # itself reports — keeps the dropdown current as Cursor
                # rolls out new models without requiring a code change.
                # ``auto`` always stays first so the default selection
                # delegates the model pick to the CLI.
                static = list(cursor_agent_models or ["auto"])
                discovered: list[str] = []
                if cursor_agent_discover:
                    try:
                        discovered = _CursorAgentProvider.discover_models(
                            cursor_agent_bin,
                        )
                    except Exception:  # noqa: BLE001
                        logger.exception(
                            "cursor-agent model discovery failed; "
                            "falling back to static catalog.",
                        )
                merged: list[str] = []
                seen: set[str] = set()
                for m in static + discovered:
                    if m and m not in seen:
                        seen.add(m)
                        merged.append(m)
                self._register(
                    _CursorAgentProvider(cursor_agent_bin),
                    models=merged or ["auto"],
                    max_retries=cursor_agent_max_retries,
                )
            except Exception:  # noqa: BLE001
                logger.exception("Failed to register Cursor CLI provider; skipping.")

        # Pick the global active (provider, model). Falls back to the
        # first registered provider if the requested one is missing so
        # a misconfigured LLM_PROVIDER doesn't lock the deployment out.
        chosen = provider if provider in self._providers else next(
            iter(self._providers), "gemini"
        )
        first_model = (self._models_by_provider.get(chosen) or [""])[0]
        self._active: dict[str, str] = {"provider": chosen, "model": first_model}

        # Smart per-agent defaults (admin-overridable). Loaded once at
        # boot from baked-in constants + the AGENT_RECOMMENDED_DEFAULTS
        # env JSON. _resolve_provider_and_model walks this AFTER the
        # admin override but BEFORE falling back to self._active.
        self._recommended_defaults: dict[str, list[tuple[str, str]]] = (
            _load_runtime_recommendations()
        )

    def _register(
        self, provider: LLMProvider, *, models: list[str], max_retries: int,
    ) -> None:
        """Register a provider + its model catalog + retry budget."""
        cleaned = [m.strip() for m in (models or []) if m and m.strip()]
        if not cleaned:
            return
        self._providers[provider.name] = provider
        self._models_by_provider[provider.name] = cleaned
        self._max_retries_map[provider.name] = max(1, int(max_retries))

    # -- public helpers --

    @property
    def provider_name(self) -> str:
        """Currently active LLM provider name."""
        return self._active.get("provider", "")

    @property
    def model_name(self) -> str:
        """Currently active model name."""
        return self._active.get("model", "") or "unknown"

    def available_providers(self) -> list[dict[str, Any]]:
        """Return every configured provider with its full model catalog.

        The Sidebar dropdown groups by provider and shows every model
        in ``models``; ``model`` (singular) is the default model for
        that provider, kept for back-compat with older clients that
        only render a flat pill list.
        """
        result = []
        for name, prov in self._providers.items():
            models = self._models_by_provider.get(name, [])
            default_model = models[0] if models else ""
            active = name == self._active.get("provider")
            result.append({
                "provider": name,
                "label": getattr(prov, "label", name.title()),
                "model": (
                    self._active.get("model", default_model)
                    if active else default_model
                ),
                "models": list(models),
                "fallbacks": models[1:] if len(models) > 1 else [],
                "active": active,
            })
        return result

    def active_selection(self) -> dict[str, str]:
        """Return the currently-active ``{provider, model}`` pair."""
        return dict(self._active)

    def switch_active(self, provider: str, model: str | None = None) -> bool:
        """Switch the global active (provider, model). Returns True if applied.

        ``model=None`` falls back to the provider's first catalog entry
        (its default model). Unknown providers / models return False.
        """
        if provider not in self._providers:
            return False
        catalog = self._models_by_provider.get(provider, [])
        if not catalog:
            return False
        chosen_model = (model or "").strip() or catalog[0]
        if chosen_model not in catalog:
            return False
        self._active = {"provider": provider, "model": chosen_model}
        return True

    def switch_provider(self, provider: str) -> bool:
        """Back-compat alias for ``switch_active(provider)``."""
        return self.switch_active(provider)

    def set_project(self, slug: str | None) -> None:
        """Switch the active project context (None = global only)."""
        self._active_project = slug

    # -- internal --

    def _pick_recommended_default(
        self, agent_name: str | None,
    ) -> tuple[str, str] | None:
        """Walk the agent's recommendation list and return the first registered match.

        Returns ``None`` when:
            * the agent isn't in the recommendation map (e.g. composite
              ``stlc_pack``);
            * no recommended (provider, model) pair maps to a configured
              provider on this deployment.

        The resolver then falls through to ``self._active``, preserving
        legacy single-provider behaviour.
        """
        if not agent_name:
            return None
        recs = self._recommended_defaults.get(agent_name) or []
        for prov_name, mdl in recs:
            if prov_name not in self._providers:
                continue
            catalog = self._models_by_provider.get(prov_name, [])
            if mdl in catalog:
                return prov_name, mdl
        return None

    def _resolve_provider_and_model(
        self,
        agent_name: str | None,
        username: str | None,
        provider_override: str | None = None,
        model_override: str | None = None,
    ) -> tuple[LLMProvider, str, list[str]]:
        """Pick (provider_obj, model, fallbacks) for this call.

        Resolution order:
            1. Explicit per-call (``provider_override``, ``model_override``).
            2. Per-user, per-agent admin override (``user_auth.model_overrides``).
            3. Per-agent smart default (``RECOMMENDED_DEFAULTS``) — the
               orchestrator picks the highest-ranked recommended pair
               whose provider is registered AND whose model exists in
               that provider's catalog.
            4. The orchestrator's global ``self._active`` selection.

        Falls back to the global active when the desired override
        points at a provider/model that isn't registered, so a stale
        admin record doesn't break the deployment.
        """
        active = self._active
        chosen_provider = provider_override or None
        chosen_model = model_override or None

        if not chosen_provider and agent_name and username:
            try:
                from core import user_auth
                rec = user_auth.get_user_model_override(username, agent_name)
            except Exception:  # noqa: BLE001
                rec = None
            if rec:
                chosen_provider = rec.get("provider") or None
                chosen_model = rec.get("model") or None

        # Per-agent smart default — wins over global active so a
        # well-suited model runs even when the admin hasn't pinned one.
        if not chosen_provider:
            picked = self._pick_recommended_default(agent_name)
            if picked is not None:
                chosen_provider, chosen_model = picked

        if not chosen_provider or chosen_provider not in self._providers:
            chosen_provider = active.get("provider")
        if not chosen_provider or chosen_provider not in self._providers:
            raise RuntimeError(
                "No LLM provider is configured. Set at least GEMINI_API_KEY "
                "(or another provider key) in backend/.env."
            )

        catalog = self._models_by_provider.get(chosen_provider, [])
        if not chosen_model or chosen_model not in catalog:
            chosen_model = (
                active.get("model") if chosen_provider == active.get("provider")
                else None
            )
        if not chosen_model or chosen_model not in catalog:
            chosen_model = catalog[0] if catalog else ""

        provider_obj = self._providers[chosen_provider]
        # Fallback chain: try the chosen model first, then walk the
        # rest of the catalog skipping duplicates so a 404 on the
        # primary doesn't strand the agent.
        rest = [m for m in catalog if m != chosen_model]
        return provider_obj, chosen_model, rest

    def _get_provider(self) -> LLMProvider:
        """Return the currently-active provider (back-compat shim)."""
        prov, _model, _fallbacks = self._resolve_provider_and_model(None, None)
        return prov

    def _resolve_system_prompt(
        self,
        agent_name: str,
        qa_mode: str,
        system_prompt_override: str | None = None,
        username: str | None = None,
    ) -> str:
        """Run only the four-layer prompt-resolution chain.

        Extracted from ``_build_messages`` so callers (the cache lookup
        in particular) can compute the effective system prompt — and
        therefore the cache key — without paying for the RAG retrieval
        step. The marker swap that adapts the prompt to project mode
        runs here too so the resolved string we hash is the exact one
        we'll send to the LLM if we miss the cache.
        """
        # Layer 1 — explicit per-request override.
        per_request = (system_prompt_override or "").strip()
        if per_request:
            if len(per_request) > 32_000:
                raise ValueError(
                    "system_prompt_override exceeds the 32 000-character limit."
                )
            resolved: str | None = per_request
        else:
            resolved = None

        # Layer 2 — per-user override.
        if resolved is None and username:
            try:
                from core import user_auth
                user_override = user_auth.get_user_prompt_override(
                    username, agent_name, qa_mode,
                )
            except Exception:
                user_override = None
            if user_override and user_override.strip():
                resolved = user_override

        # Layer 3 — global admin default.
        if resolved is None:
            try:
                from core import prompt_store
                admin_default = prompt_store.get_default(agent_name, qa_mode)
            except Exception:
                admin_default = None
            if admin_default and admin_default.strip():
                resolved = admin_default

        # Layer 4 — baked-in default.
        if resolved is None:
            prompts_dict = PROMPTS_GEN if qa_mode == "general" else PROMPTS_SF
            if agent_name not in prompts_dict:
                raise KeyError(
                    f"Unknown agent '{agent_name}' for qa_mode='{qa_mode}'."
                )
            resolved = prompts_dict[agent_name]

        if self._active_project:
            resolved = resolved.replace(_SCOPE_ONLY, _PROJECT_SCOPE)
        # Provider-agnostic output-discipline clamp. Appended AFTER the
        # full agent template so it's the last thing the model reads
        # before the user block — most LLMs weight late-in-prompt
        # instructions higher. Disproportionately benefits chatty
        # OpenAI / Anthropic sub-models routed via Cursor (gpt-5,
        # sonnet-4-thinking, opus-4) without hurting Gemini, which
        # already follows format instructions tightly. Cache keys
        # auto-invalidate because make_key() hashes the resolved
        # system prompt.
        resolved = resolved.rstrip() + "\n\n" + _OUTPUT_CONTRACT_CLAMP
        return resolved

    def _build_messages(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None = None,
        username: str | None = None,
    ) -> tuple[str, str]:
        """Build (system_prompt, user_block) for a given agent call.

        Prompt resolution order (highest priority wins):

            1. *system_prompt_override* — explicit per-request override
               from the API caller (e.g. the Test Cases "Customize
               prompt" toggle). Capped at 32 KB.
            2. Per-user override — ``users/{username}.prompt_overrides
               [agent][qa_mode]`` set via the admin panel for one user.
            3. Global admin default — written via the admin panel and
               persisted by ``prompt_store`` (Firestore or local JSON).
            4. Baked-in default in ``backend/core/prompts/prompts.py``.

        The marker swap that adapts the prompt to project mode runs on
        whichever string wins (no-op when the marker isn't present), so
        custom prompts inherit the same scope handling as the defaults.
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

        # Anti-hallucination guard rails — applied to every agent call,
        # both project-mode and standalone-mode. Phrased explicitly so
        # the model treats imported Jira blobs (description, comments,
        # attachments, custom fields, sub-tasks) as authoritative and
        # stops asking clarifying questions whose answers are already
        # in the INPUT.
        anti_halluc = (
            " Treat the INPUT as authoritative — including any imported "
            "Jira ticket blocks (description, comments, attachments, "
            "sub-tasks, custom fields, acceptance criteria). Do NOT invent "
            "values, do NOT assume facts beyond what is stated, and do NOT "
            "raise clarification questions for anything already covered in "
            "INPUT (description / comments / attachments / custom fields). "
            "When a required detail is genuinely absent, write "
            "'Not specified — clarify with stakeholder' verbatim instead "
            "of guessing. Output must be reproducible: identical INPUT must "
            "produce identical OUTPUT."
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
        scope_instructions += anti_halluc

        # The four-layer resolution lives in ``_resolve_system_prompt``
        # so the cache lookup (which only needs the prompt + input, not
        # the RAG context) can reuse it without computing the user
        # block twice.
        system_prompt = self._resolve_system_prompt(
            agent_name, qa_mode, system_prompt_override, username,
        )

        compact_input = json.dumps(normalised_input, ensure_ascii=False, separators=(",", ":"))
        user_block = f"{context}\n\nINPUT:\n{compact_input}\n\n{scope_instructions}"
        return system_prompt, user_block

    def _call_with_retry(
        self,
        system_prompt: str,
        user_block: str,
        provider: LLMProvider,
        primary_model: str,
        fallback_models: list[str],
    ) -> str:
        """Try each model in the fallback chain with exponential backoff retries."""
        chain = [primary_model] + (fallback_models or [])
        max_retries = self._max_retries_map.get(provider.name, 3)
        last_error: Exception | None = None

        for model in chain:
            if not model:
                continue
            for attempt in range(max_retries):
                try:
                    return provider.generate(
                        model, system_prompt, user_block,
                        self.temperature, self.max_output_tokens,
                        seed=self.seed,
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

    def _stream_with_fallback(
        self,
        system_prompt: str,
        user_block: str,
        provider: LLMProvider,
        primary_model: str,
        fallback_models: list[str],
    ) -> Iterator[str]:
        """Stream from each model in the fallback chain, retrying on transient errors."""
        chain = [primary_model] + (fallback_models or [])
        max_retries = self._max_retries_map.get(provider.name, 3)
        last_error: Exception | None = None

        for model in chain:
            if not model:
                continue
            for attempt in range(max_retries):
                try:
                    for piece in provider.stream(
                        model, system_prompt, user_block,
                        self.temperature, self.max_output_tokens,
                        seed=self.seed,
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

    def _cache_lookup(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None,
        username: str | None,
        provider: str,
        model: str,
    ) -> tuple[str | None, str, dict[str, Any] | None]:
        """Return ``(cached_output, cache_key, cached_usage)``.

        The key is always computed (and returned) so callers can store
        the freshly-generated output under the same key on a miss
        without recomputing the resolution chain. Returns ``(None, "", None)``
        when caching is disabled. ``provider`` and ``model`` are mixed
        into the key so swapping models invalidates the cache for that
        request shape (different backend, different output).

        The third tuple slot is the cached token-usage envelope (or
        ``None`` if not present — entries created before token tracking
        was added simply lack it). Re-emitted on cache hits so the UI
        shows the same chip the original generation produced rather
        than a "0 tokens" placeholder.
        """
        # NOTE: `LLMResponseCache.__len__` is defined, so `bool(self._cache)`
        # is False when the cache is *empty* (Python falls back to len==0).
        # That made cache writes silently no-op on a fresh deploy until at
        # least one entry was somehow seeded externally. We always test
        # `is None` instead of relying on truthiness for the same reason
        # in the write-path below.
        if self._cache is None:
            return None, "", None
        try:
            qa_raw = str(user_input.get("qa_mode") or "salesforce").strip().lower()
            qa_mode = "general" if qa_raw == "general" else "salesforce"
            system_prompt = self._resolve_system_prompt(
                agent_name, qa_mode, system_prompt_override, username,
            )
            from core.llm_cache import make_key
            key = make_key(
                agent_name, qa_mode, self._active_project,
                {**user_input, "qa_mode": qa_mode}, system_prompt,
                provider=provider, model=model,
            )
            full = self._cache.get_full(key)
            if not full:
                return None, key, None
            cached_usage = full.get("usage")
            if isinstance(cached_usage, dict):
                # Mark the source as 'cached' so the chip reads
                # "Cached" instead of "Live" without losing the count.
                cached_usage = {**cached_usage, "source": "cached"}
            else:
                cached_usage = None
            return full.get("output"), key, cached_usage
        except Exception:  # noqa: BLE001
            return None, "", None

    def _record_usage(
        self,
        usage_box: dict[str, Any] | None,
        *,
        provider_name: str,
        model: str,
        usage: dict[str, Any] | None,
        cached: bool = False,
        repaired: bool = False,
    ) -> None:
        """Populate the caller-supplied ``usage_box`` with the run's metadata.

        Threadsafe by construction: each request handler creates a
        fresh ``usage_box`` and passes it down, so concurrent agent
        runs never share state. ``usage_box`` is optional — internal
        callers (e.g. the STLC pack) that don't care about token
        accounting just pass ``None`` and we no-op.

        ``repaired=True`` signals that the orchestrator ran the
        auto-repair pass (validator failed → one extra LLM call with a
        strict format clamp). The UI surfaces this as an "Auto-repaired"
        chip so users know why their token count is higher than usual.
        """
        if usage_box is None:
            return
        usage_box["provider"] = provider_name
        usage_box["model"] = model
        usage_box["cached"] = bool(cached)
        usage_box["repaired"] = bool(repaired)
        if usage is None:
            usage_box["usage"] = None
        else:
            usage_box["usage"] = dict(usage)

    def _maybe_repair(
        self,
        *,
        agent_name: str,
        content: str,
        provider: LLMProvider,
        model: str,
        fallbacks: list[str],
        system_prompt: str,
        user_block: str,
        stream: bool,
    ) -> tuple[str, bool]:
        """Run one repair pass when the agent's validator rejects ``content``.

        Returns ``(final_content, was_repaired)``. Free-form agents
        (no validator registered) and content that already validates
        return ``(content, False)`` unchanged.

        On a validation failure we synthesize a strict format clamp
        explaining what went wrong, prepend it to the user block, and
        re-run the *same* provider+model so token cost / determinism
        guarantees stay aligned with the original call. The repaired
        output is also chatter-stripped before being returned so any
        residual preamble from the second pass is removed.

        This is invoked from both ``run_agent`` and ``stream_agent``;
        the ``stream`` flag is currently informational (kept so a
        future implementation can tee tokens to the live SSE channel
        instead of returning them all at once).
        """
        # Avoid the import cycle: validators live in their own module
        # so prompts.py doesn't pull a parser dependency.
        from core import output_validators

        validator = output_validators.VALIDATORS.get(agent_name)
        if validator is None:
            return content, False
        try:
            ok, reason = validator(content)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Output validator for %s raised: %s — skipping repair.",
                agent_name, exc,
            )
            return content, False
        if ok:
            return content, False

        # Synthesize the repair clamp. Stay specific so the model knows
        # exactly what to fix (avoids it making up new format rules).
        repair_clamp = (
            "\n\n---\n"
            "REPAIR PASS — your previous response did not match the "
            "required format.\n"
            f"Specifically: {reason}\n"
            "Re-emit your response containing ONLY the artifact in the "
            "exact format the agent template above specifies. No "
            "preamble. No closing remarks. No explanations. No second "
            "version. Begin with the first character of the artifact "
            "and end with its last character."
        )
        repaired_user_block = user_block + repair_clamp

        try:
            repaired = self._call_with_retry(
                system_prompt, repaired_user_block,
                provider, model, fallbacks,
            )
        except Exception as exc:  # noqa: BLE001
            # Repair itself failed — return the original (chatter-
            # stripped) content. The downstream parser will surface
            # the failure to the user, who can re-run manually.
            logger.warning(
                "Auto-repair pass failed for %s on %s/%s: %s",
                agent_name, provider.name, model, exc,
            )
            return content, False
        repaired = _strip_chatter(repaired)
        if not repaired or repaired.startswith("**Error"):
            return content, False
        return repaired, True

    def run_agent(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None = None,
        username: str | None = None,
        *,
        provider_override: str | None = None,
        model_override: str | None = None,
        usage_box: dict[str, Any] | None = None,
    ) -> str:
        """Run one agent end-to-end: RAG query from flattened input, then LLM.

        Reproducibility shortcut: when the response cache is enabled
        and the (agent, qa_mode, project, input, effective system
        prompt, provider, model) tuple has been seen before, the
        cached output is returned verbatim without a fresh LLM call.
        This is the primary mechanism behind "identical INPUT →
        identical OUTPUT" because the LLM provider may still vary
        slightly even at temperature 0.

        ``username`` (when supplied by the API layer) is forwarded into
        the prompt-resolution chain so per-user overrides set via the
        admin panel take effect for that user only. The same username
        is used to look up the per-agent (provider, model) override.

        ``usage_box`` (when supplied) is mutated in place to carry back
        the resolved ``provider`` / ``model`` and the token-usage
        envelope from the underlying provider call (or the cached one
        on a hit). This is the threadsafe channel through which the
        ``/api/agents/{a}/run`` route surfaces token counts to the UI.
        """
        if agent_name not in PROMPTS_SF:
            raise KeyError(f"Unknown agent: {agent_name}. Valid: {list(PROMPTS_SF)}")

        if not self._providers:
            return (
                "**Error:** No LLM provider is configured. "
                "Set `GEMINI_API_KEY` in `backend/.env`."
            )

        provider, model, fallbacks = self._resolve_provider_and_model(
            agent_name, username, provider_override, model_override,
        )

        cached, cache_key, cached_usage = self._cache_lookup(
            agent_name, user_input, system_prompt_override, username,
            provider=provider.name, model=model,
        )
        if cached is not None:
            self._record_usage(
                usage_box, provider_name=provider.name, model=model,
                usage=cached_usage, cached=True,
            )
            _append_log({
                "ts": datetime.now(timezone.utc).isoformat(),
                "agent": agent_name,
                "provider": provider.name,
                "model": model,
                "project": self._active_project,
                # Stamp the caller so the admin Usage tab can attribute
                # token totals back to a specific user. Legacy rows
                # without this field bucket as "(unknown)" in the UI.
                "username": username,
                "input": user_input,
                "output": cached,
                # Tight 80-char preview so the History UI can show a
                # one-line summary without leaking sensitive content.
                # The full output stays available (encrypted) under
                # the `output` field above.
                "output_preview": cached[:80],
                "cache_hit": True,
                "usage": cached_usage,
                # Cached replays of repaired outputs are still
                # "repaired" artifacts as far as the chip is concerned,
                # but we don't track that on the cache row itself —
                # default to False so the field is always present.
                "repaired": False,
            })
            return cached

        system_prompt, user_block = self._build_messages(
            agent_name, user_input, system_prompt_override, username=username,
        )
        content = ""
        errored = False
        try:
            content = self._call_with_retry(
                system_prompt, user_block, provider, model, fallbacks,
            )
        except Exception as exc:  # noqa: BLE001
            errored = True
            content = (
                f"**Error calling {provider.label}:** `{exc}`\n\n"
                "The model may be temporarily overloaded. "
                "Please wait a moment and try again."
            )
        # Strip leading / trailing conversational chatter so every
        # downstream consumer (parser, deriveSummary, exporter) sees a
        # clean artifact regardless of which provider produced it. No-
        # op when the LLM already complied with the OUTPUT CONTRACT.
        if not errored:
            content = _strip_chatter(content)
        # Auto-repair pass: if the agent has a registered output
        # validator and the output failed it, re-run once with a
        # strict format clamp. Mutates ``content`` + sets
        # ``usage_box.repaired`` so the UI can surface the chip.
        repaired = False
        if not errored:
            content, repaired = self._maybe_repair(
                agent_name=agent_name,
                content=content,
                provider=provider,
                model=model,
                fallbacks=fallbacks,
                system_prompt=system_prompt,
                user_block=user_block,
                stream=False,
            )
        # Capture usage AFTER the provider call so retries that swap
        # models still report the *successful* model's token counts.
        live_usage = getattr(provider, "last_usage", None)
        self._record_usage(
            usage_box, provider_name=provider.name, model=model,
            usage=live_usage, cached=False, repaired=repaired,
        )
        try:
            _append_log({
                "ts": datetime.now(timezone.utc).isoformat(),
                "agent": agent_name,
                "provider": provider.name,
                "model": model,
                "project": self._active_project,
                "username": username,
                "input": user_input,
                "output": content,
                # See the cached-branch comment above — the preview is
                # deliberately short so the encrypted full output
                # remains the only complete copy of the transcript.
                "output_preview": content[:80],
                "cache_hit": False,
                "usage": live_usage,
                "repaired": repaired,
            })
        except Exception:  # noqa: BLE001
            logger.exception("Failed to append agent_run log")
        # Only cache successful generations — error stubs would
        # otherwise stick around and disguise transient failures.
        # ``self._cache is not None`` (rather than truthiness) because
        # the cache class implements __len__ — an empty cache evaluates
        # falsy and would silently swallow every write on a fresh deploy.
        if (
            self._cache is not None and cache_key
            and content
            and not errored
            and not content.startswith("**Error")
        ):
            self._cache.set(
                cache_key, output=content,
                agent=agent_name, model=model,
                usage=live_usage,
            )
        return content

    def stream_agent(
        self,
        agent_name: str,
        user_input: dict[str, Any],
        system_prompt_override: str | None = None,
        username: str | None = None,
        *,
        provider_override: str | None = None,
        model_override: str | None = None,
        usage_box: dict[str, Any] | None = None,
    ) -> Iterator[str]:
        """Stream decoded tokens; logs the joined result when the stream completes.

        Same cache shortcut as ``run_agent``: when the cache has a hit
        for the request signature we replay the stored output as a
        single chunk so the SSE client receives the identical text
        without round-tripping the LLM.

        ``username`` (when supplied by the API layer) is forwarded into
        the prompt-resolution chain — same semantics as ``run_agent``.

        ``usage_box`` (when supplied) carries the resolved
        ``provider``/``model`` and the token-usage envelope back to
        the SSE producer so it can emit a final ``usage`` event after
        the stream completes. We deliberately don't yield the usage
        through the iterator itself — that would force every consumer
        (e.g. the STLC pack producer that just concatenates string
        chunks) to learn a new event protocol. The shared mutable
        box is threadsafe because each request creates its own.
        """
        if agent_name not in PROMPTS_SF:
            yield f"Unknown agent: {agent_name}"
            return
        if not self._providers:
            yield "**Error:** No LLM provider is configured. Set `GEMINI_API_KEY` in `backend/.env`."
            return

        try:
            provider, model, fallbacks = self._resolve_provider_and_model(
                agent_name, username, provider_override, model_override,
            )
        except RuntimeError as exc:
            yield f"**Error:** {exc}"
            return

        cached, cache_key, cached_usage = self._cache_lookup(
            agent_name, user_input, system_prompt_override, username,
            provider=provider.name, model=model,
        )
        if cached is not None:
            yield cached
            self._record_usage(
                usage_box, provider_name=provider.name, model=model,
                usage=cached_usage, cached=True,
            )
            _append_log({
                "ts": datetime.now(timezone.utc).isoformat(),
                "agent": agent_name,
                "provider": provider.name,
                "model": model,
                "project": self._active_project,
                "username": username,
                "input": user_input,
                "output": cached,
                "output_preview": cached[:500],
                "cache_hit": True,
                "usage": cached_usage,
                "repaired": False,
            })
            return

        try:
            system_prompt, user_block = self._build_messages(
                agent_name, user_input, system_prompt_override, username=username,
            )
        except ValueError as exc:
            yield f"**Error:** {exc}"
            return
        collected: list[str] = []
        errored = False
        try:
            for piece in self._stream_with_fallback(
                system_prompt, user_block, provider, model, fallbacks,
            ):
                collected.append(piece)
                yield piece
        except Exception as exc:  # noqa: BLE001
            errored = True
            err = (
                f"**Error calling {provider.label}:** `{exc}`\n\n"
                "The model may be temporarily overloaded. "
                "Please wait a moment and try again."
            )
            collected.append(err)
            yield err
        # ----- post-stream cleanup + optional auto-repair -----
        # The user has now seen the live stream. Chatter-strip the
        # joined buffer so the cached / logged version is clean even
        # if the stream had a chatty preamble. Then run the validator;
        # if it fails, do ONE repair pass and stream the repaired
        # output to the user behind a separator so they understand
        # what changed. The cached entry stores the repaired version
        # only — replays come back clean without the original or the
        # separator.
        full_raw = "".join(collected)
        repaired_flag = False
        final_content = full_raw
        if not errored:
            stripped = _strip_chatter(full_raw)
            try:
                final_content, repaired_flag = self._maybe_repair(
                    agent_name=agent_name,
                    content=stripped,
                    provider=provider,
                    model=model,
                    fallbacks=fallbacks,
                    system_prompt=system_prompt,
                    user_block=user_block,
                    stream=True,
                )
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Auto-repair pass blew up for %s; keeping original.",
                    agent_name,
                )
                final_content = stripped
            if repaired_flag:
                # Flush the repaired content to the live SSE stream
                # behind a clear visual separator so the user can see
                # what the parser-friendly version looks like.
                notice = (
                    "\n\n---\n\n"
                    "_Auto-reformatted to match the required output structure._\n\n"
                )
                yield notice
                yield final_content
        try:
            live_usage = getattr(provider, "last_usage", None)
            self._record_usage(
                usage_box, provider_name=provider.name, model=model,
                usage=live_usage, cached=False, repaired=repaired_flag,
            )
            try:
                _append_log({
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "agent": agent_name,
                    "provider": provider.name,
                    "model": model,
                    "project": self._active_project,
                    "username": username,
                    "input": user_input,
                    # Persist the FINAL (clean / repaired) artifact, not
                    # the raw streamed buffer — replays should serve the
                    # parser-friendly version directly.
                    "output": final_content,
                    "output_preview": final_content[:500],
                    "cache_hit": False,
                    "usage": live_usage,
                    "repaired": repaired_flag,
                })
            except Exception:  # noqa: BLE001
                logger.exception("Failed to append agent_run log")
            # See run_agent: `is not None` because the cache type defines
            # __len__ and would evaluate falsy when empty, breaking the
            # initial seed write on every fresh deployment.
            if (
                self._cache is not None and cache_key
                and final_content
                and not errored
                and not final_content.startswith("**Error")
            ):
                self._cache.set(
                    cache_key, output=final_content,
                    agent=agent_name, model=model,
                    usage=live_usage,
                )
        except Exception:  # noqa: BLE001
            logger.exception("stream_agent post-cleanup failed")

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
            "provider": self.provider_name,
            "model": self.model_name,
            "available_providers": self.available_providers(),
            "active_project": self._active_project,
        }
