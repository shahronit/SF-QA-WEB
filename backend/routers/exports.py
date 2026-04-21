"""Export routes: convert agent output to Excel, CSV, Markdown, or PDF."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from core import exporter
from routers.deps import get_current_user

router = APIRouter()


class ExportRequest(BaseModel):
    """Payload containing markdown content to export."""

    content: str
    agent_name: str = "export"


@router.post("/excel")
async def export_excel(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as an Excel workbook."""
    data = exporter.export_to_excel(body.content, body.agent_name)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=QA_{body.agent_name}.xlsx"
        },
    )


@router.post("/csv")
async def export_csv(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as a CSV file."""
    data = exporter.export_to_csv(body.content)
    return Response(
        content=data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=QA_{body.agent_name}.csv"
        },
    )


@router.post("/markdown")
async def export_md(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as a Markdown file."""
    data = exporter.export_to_markdown(body.content, body.agent_name)
    return Response(
        content=data,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f"attachment; filename=QA_{body.agent_name}.md"
        },
    )


@router.post("/pdf")
async def export_pdf(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as a styled PDF rendered from markdown."""
    data = exporter.export_to_pdf(body.content, body.agent_name)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=QA_{body.agent_name}.pdf"
        },
    )
