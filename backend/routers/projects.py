"""Project CRUD, file upload, index building, and sharing routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from core import project_manager as pm
from routers.deps import get_current_user, get_orchestrator

router = APIRouter()


class CreateProjectRequest(BaseModel):
    """Fields for creating a new project."""

    name: str
    description: str = ""


class ShareRequest(BaseModel):
    """Target user for share / unshare operations."""

    target_username: str


@router.get("/")
async def list_projects(user=Depends(get_current_user)):
    """List projects visible to the authenticated user."""
    return {"projects": pm.list_projects(username=user["username"])}


@router.post("/")
async def create_project(body: CreateProjectRequest, user=Depends(get_current_user)):
    """Create a new project."""
    slug = pm.create_project(body.name, body.description, owner=user["username"])
    return {"slug": slug, "name": body.name}


@router.get("/{slug}")
async def get_project(slug: str, user=Depends(get_current_user)):
    """Retrieve project metadata, document list, and index status."""
    meta = pm.get_metadata(slug)
    if not meta:
        raise HTTPException(404, "Project not found")
    docs = pm.list_documents(slug)
    indexed = pm.project_index_ready(slug)
    return {"metadata": meta, "documents": docs, "indexed": indexed}


@router.delete("/{slug}")
async def delete_project(slug: str, user=Depends(get_current_user)):
    """Delete a project (owner only)."""
    if not pm.is_owner(slug, user["username"]):
        raise HTTPException(403, "Only the owner can delete")
    orch = get_orchestrator()
    orch.reload_project_rag(slug)
    pm.delete_project(slug)
    return {"deleted": True}


@router.post("/{slug}/upload")
async def upload_files(
    slug: str,
    files: list[UploadFile] = File(...),
    user=Depends(get_current_user),
):
    """Upload one or more documents to a project."""
    saved = []
    for f in files:
        content = await f.read()
        pm.save_file(slug, f.filename, content)
        saved.append(f.filename)
    return {"saved": saved}


@router.delete("/{slug}/documents/{filename}")
async def delete_document(slug: str, filename: str, user=Depends(get_current_user)):
    """Remove a single document from a project."""
    pm.delete_document(slug, filename)
    return {"deleted": filename}


@router.post("/{slug}/build-index")
async def build_index(slug: str, user=Depends(get_current_user)):
    """Ingest project documents into a ChromaDB vector store."""
    count = pm.build_project_index(slug)
    orch = get_orchestrator()
    orch.reload_project_rag(slug)
    return {"chunks": count}


@router.post("/{slug}/share")
async def share(slug: str, body: ShareRequest, user=Depends(get_current_user)):
    """Grant another user access to this project (owner only)."""
    if not pm.is_owner(slug, user["username"]):
        raise HTTPException(403, "Only the owner can share")
    pm.share_project(slug, body.target_username)
    return {"shared_with": body.target_username}


@router.post("/{slug}/unshare")
async def unshare(slug: str, body: ShareRequest, user=Depends(get_current_user)):
    """Revoke another user's access to this project (owner only)."""
    if not pm.is_owner(slug, user["username"]):
        raise HTTPException(403, "Only the owner can unshare")
    pm.unshare_project(slug, body.target_username)
    return {"unshared": body.target_username}
