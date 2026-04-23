"""LangChain Chroma: prefer OpenAI embeddings when configured, else Ollama."""

from __future__ import annotations

import logging
from pathlib import Path

from langchain_community.embeddings import OllamaEmbeddings, OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document

from config import settings

log = logging.getLogger(__name__)

# Small / cheap; matches typical ChatGPT API setups (same key as the LLM).
_RAG_OPENAI_EMBED_MODEL = "text-embedding-3-small"
_ollama_fallback_logged = False


def _make_embeddings():
    """Use OpenAI embeddings when *OPENAI_API_KEY* is set; otherwise Ollama."""
    global _ollama_fallback_logged
    key = (settings.OPENAI_API_KEY or "").strip()
    if key:
        return OpenAIEmbeddings(
            model=_RAG_OPENAI_EMBED_MODEL,
            openai_api_key=key,
        )
    if not _ollama_fallback_logged:
        _ollama_fallback_logged = True
        log.warning(
            "RAG: OPENAI_API_KEY not set; using Ollama (nomic-embed-text) for embeddings. "
            "Set OPENAI_API_KEY in .env to re-index without a local Ollama server."
        )
    return OllamaEmbeddings(model="nomic-embed-text")


class SalesforceVectorStore:
    """Persist Chroma under `./rag/vector_store` relative to the project root."""

    def __init__(self, persist_dir: str | Path | None = None) -> None:
        root = Path(__file__).resolve().parents[1]
        self.persist_dir = Path(persist_dir) if persist_dir else root / "rag" / "vector_store"
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.embeddings = _make_embeddings()
        self.db: Chroma | None = None

    def build(self, documents: list[Document]) -> None:
        """Build vector store from LangChain documents and persist."""
        print(f"Building vector store from {len(documents)} chunks...")
        self.db = Chroma.from_documents(
            documents=documents,
            embedding=self.embeddings,
            persist_directory=str(self.persist_dir),
        )
        persist_fn = getattr(self.db, "persist", None)
        if callable(persist_fn):
            persist_fn()
        print("Vector store built and saved.")

    def load(self) -> "SalesforceVectorStore":
        """Load an existing on-disk Chroma index."""
        self.db = Chroma(
            persist_directory=str(self.persist_dir),
            embedding_function=self.embeddings,
        )
        return self

    def retrieve(self, query: str, k: int = 4, *, include_source: bool = False) -> str:
        """Return top-K chunk texts joined for prompt injection.

        When *include_source* is True each chunk is annotated with its
        ``source`` metadata so the LLM (and user) can trace claims.
        """
        if not self.db:
            self.load()
        assert self.db is not None
        results = self.db.similarity_search(query, k=k)
        parts: list[str] = []
        for doc in results:
            text = doc.page_content
            if include_source:
                src = doc.metadata.get("source", "unknown")
                page = doc.metadata.get("page")
                label = Path(src).name if src != "unknown" else src
                if page is not None:
                    label = f"{label}, page {page}"
                text = f"(Source: {label})\n{text}"
            parts.append(text)
        return "\n\n---\n\n".join(parts)

    def chunk_count(self) -> int:
        """Return persisted vector count, or 0 if the store is missing or empty."""
        if self.db is None:
            try:
                self.load()
            except Exception:  # noqa: BLE001
                return 0
        if self.db is None:
            return 0
        try:
            coll = getattr(self.db, "_collection", None)
            if coll is not None:
                return int(coll.count())
        except Exception:  # noqa: BLE001
            pass
        try:
            data = self.db.get()
            return len(data.get("ids") or [])
        except Exception:  # noqa: BLE001
            return 0

    def is_ready(self) -> bool:
        """True when the on-disk index exists and has at least one chunk."""
        return self.chunk_count() > 0
