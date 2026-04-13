"""Load and chunk knowledge-base documents for RAG."""

from __future__ import annotations

import json
import os
from pathlib import Path

from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from langchain_community.document_loaders import (
    CSVLoader,
    JSONLoader,
    PyPDFLoader,
    UnstructuredWordDocumentLoader,
)


class SalesforceKnowledgeIngestor:
    """Walk `knowledge_base/` and produce chunked LangChain `Document` lists."""

    def __init__(self, knowledge_base_path: str | Path | None = None) -> None:
        root = Path(__file__).resolve().parents[1]
        self.kb_path = Path(knowledge_base_path) if knowledge_base_path else root / "knowledge_base"
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=50,
            separators=["\n\n", "\n", ".", " "],
        )

    def load_all(self) -> list[Document]:
        """Load every supported file under the KB path and return split documents."""
        docs: list[Document] = []
        if not self.kb_path.is_dir():
            return self.splitter.split_documents(docs)
        for root, _, files in os.walk(self.kb_path):
            for file in files:
                if file == ".gitkeep":
                    continue
                path = Path(root) / file
                docs.extend(self._load_file(path))
        return self.splitter.split_documents(docs)

    def _load_file(self, path: Path) -> list[Document]:
        """Load a single file based on its extension."""
        ext = path.suffix.lower().lstrip(".")
        try:
            if ext == "pdf":
                return PyPDFLoader(str(path)).load()
            if ext == "csv":
                return CSVLoader(str(path)).load()
            if ext in ("doc", "docx"):
                return UnstructuredWordDocumentLoader(str(path)).load()
            if ext == "json":
                return self._load_json(path)
            if ext in ("md", "txt", "markdown"):
                text = path.read_text(encoding="utf-8", errors="replace")
                return [Document(page_content=text, metadata={"source": str(path)})]
        except Exception as exc:  # noqa: BLE001 — surface in UI/logs
            print(f"Failed to load {path}: {exc}")
        return []

    def _load_json(self, path: Path) -> list[Document]:
        """Try multiple JSON loading strategies."""
        try:
            return JSONLoader(str(path), jq_schema=".", text_content=False).load()
        except Exception:
            try:
                return JSONLoader(str(path), jq_schema=".[]", text_content=False).load()
            except Exception:
                raw = path.read_text(encoding="utf-8", errors="replace")
                data = json.loads(raw)
                return [Document(page_content=json.dumps(data, indent=2), metadata={"source": str(path)})]
