"""LangChain Chroma vector store backed by Google Gemini embeddings."""

from __future__ import annotations

import logging
from pathlib import Path

from langchain_community.vectorstores import Chroma
from langchain_core.documents import Document

from config import settings

log = logging.getLogger(__name__)


def _make_embeddings():
    """Build the Gemini embeddings client used by RAG.

    Hard requirement on GEMINI_API_KEY — no silent fallback to OpenAI/Ollama,
    by design. We surface a clear error so the operator knows exactly what
    to set in backend/.env.
    """
    key = (settings.GEMINI_API_KEY or "").strip()
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY is required for RAG embeddings. "
            "Set it in backend/.env and restart the server."
        )
    try:
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
    except ImportError as exc:
        raise RuntimeError(
            "langchain-google-genai is not installed. "
            "Run `pip install langchain-google-genai` (or "
            "`pip install -r backend/requirements.txt`) and restart."
        ) from exc
    model = (settings.GEMINI_EMBED_MODEL or "models/text-embedding-004").strip()
    return GoogleGenerativeAIEmbeddings(model=model, google_api_key=key)


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
