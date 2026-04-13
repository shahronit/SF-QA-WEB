"""Thin RAG retriever over `SalesforceVectorStore`."""

from __future__ import annotations

from rag.embedder import SalesforceVectorStore


class RAGRetriever:
    """Lazy-load persisted Chroma and return grounded context blocks."""

    def __init__(self) -> None:
        self.vs = SalesforceVectorStore()
        self._loaded = False
        self._project_stores: dict[str, SalesforceVectorStore] = {}

    def _ensure_loaded(self) -> None:
        """Load the global vector store if not yet loaded."""
        if self._loaded:
            return
        try:
            self.vs.load()
        except Exception:  # noqa: BLE001 — missing index is normal before first build
            pass
        self._loaded = True

    def _ensure_project_loaded(self, slug: str) -> SalesforceVectorStore:
        """Lazy-load a project-specific vector store."""
        if slug not in self._project_stores:
            from core.project_manager import get_project_vector_store
            self._project_stores[slug] = get_project_vector_store(slug)
        vs = self._project_stores[slug]
        if vs.db is None:
            try:
                vs.load()
            except Exception:  # noqa: BLE001
                pass
        return vs

    def reload(self) -> None:
        """Forget the in-memory client so the next call reloads from disk (e.g. after ingest)."""
        self.vs.db = None
        self._loaded = False

    def reload_project(self, slug: str) -> None:
        """Close the Chroma client and drop cached project store."""
        vs = self._project_stores.pop(slug, None)
        if vs is not None and vs.db is not None:
            client = getattr(vs.db, "_client", None)
            if client is not None:
                close_fn = getattr(client, "close", None)
                if callable(close_fn):
                    try:
                        close_fn()
                    except Exception:  # noqa: BLE001
                        pass
            vs.db = None

    def get_context(self, query: str, k: int = 4) -> str:
        """Retrieve relevant Salesforce knowledge for any agent query."""
        self._ensure_loaded()
        if not self.vs.is_ready():
            return (
                "=== RELEVANT SALESFORCE KNOWLEDGE ===\n"
                "(No vector store found. Run **Setup Knowledge Base** first, "
                "and ensure `ollama pull nomic-embed-text`.)\n"
                "====================================="
            )
        try:
            context = self.vs.retrieve(query, k=k, include_source=True)
        except Exception as exc:  # noqa: BLE001
            context = f"(Retrieval error: {exc})"
        return (
            f"=== RELEVANT SALESFORCE KNOWLEDGE ===\n{context}\n"
            "====================================="
        )

    def get_project_context(self, query: str, project_slug: str, k: int = 3) -> str:
        """Retrieve from a project-specific vector store."""
        vs = self._ensure_project_loaded(project_slug)
        if not vs.is_ready():
            return ""
        try:
            return vs.retrieve(query, k=k, include_source=True)
        except Exception as exc:  # noqa: BLE001
            return f"(Project retrieval error: {exc})"

    def get_combined_context(
        self,
        query: str,
        project_slug: str | None = None,
        global_k: int = 2,
        project_k: int = 3,
    ) -> str:
        """Merge global SF knowledge and project documents into one context block.

        When *project_slug* is None this behaves like ``get_context`` with
        *global_k* snippets.
        """
        self._ensure_loaded()

        global_ctx = ""
        if self.vs.is_ready():
            try:
                global_ctx = self.vs.retrieve(
                    query, k=global_k, include_source=True,
                )
            except Exception as exc:  # noqa: BLE001
                global_ctx = f"(Retrieval error: {exc})"

        project_ctx = ""
        if project_slug:
            project_ctx = self.get_project_context(query, project_slug, k=project_k)

        sections: list[str] = []
        if project_ctx:
            sections.append(
                f"=== PROJECT DOCUMENTS ===\n{project_ctx}\n"
                "========================="
            )
        if global_ctx:
            sections.append(
                f"=== SALESFORCE KNOWLEDGE (background reference) ===\n{global_ctx}\n"
                "==================================================="
            )
        if not sections:
            sections.append(
                "=== RELEVANT KNOWLEDGE ===\n"
                "(No indexed knowledge available. Build the global Knowledge base "
                "or upload project documents first.)\n"
                "=========================="
            )
        return "\n\n".join(sections)

    def is_ready(self) -> bool:
        """Whether the global vector store is built and queryable."""
        self._ensure_loaded()
        return self.vs.is_ready()

    def chunk_count(self) -> int:
        """Number of indexed chunks in the global store (0 if not built)."""
        self._ensure_loaded()
        return self.vs.chunk_count()
