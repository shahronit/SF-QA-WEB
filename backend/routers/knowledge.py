"""Knowledge base build and status routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from rag.embedder import SalesforceVectorStore
from rag.ingestor import SalesforceKnowledgeIngestor
from routers.deps import get_current_user, get_orchestrator

router = APIRouter()


@router.post("/build")
async def build_kb(user=Depends(get_current_user)):
    """Ingest knowledge base documents and build the global vector store."""
    # Release the global Chroma client before replacing files on disk (Windows locks).
    orch = get_orchestrator()
    orch.reload_rag()
    ingestor = SalesforceKnowledgeIngestor()
    docs = ingestor.load_all()
    if not docs:
        return {"chunks": 0, "message": "No documents found"}
    vs = SalesforceVectorStore()
    vs.build(docs)
    orch.reload_rag()
    return {"chunks": len(docs), "message": f"Indexed {len(docs)} chunks"}


@router.get("/status")
async def kb_status(user=Depends(get_current_user)):
    """Return RAG readiness and chunk count."""
    orch = get_orchestrator()
    return orch.rag_status()
