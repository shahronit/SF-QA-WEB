"""Export routes: convert agent output to Excel, CSV, Markdown, or PDF."""

from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from core import exporter
from routers.deps import get_current_user

router = APIRouter()
log = logging.getLogger(__name__)

# Strip every non-ASCII / unsafe char from agent_name before it lands in
# the Content-Disposition header. Some browsers (Safari especially) reject
# the whole response if the filename contains an unescaped quote, semicolon
# or non-ASCII glyph, which the user perceives as "download failed".
_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(stem: str, ext: str) -> str:
    """Return ``QA_{stem}.{ext}`` with *stem* coerced to filename-safe ASCII."""
    cleaned = _FILENAME_SAFE_RE.sub("_", stem or "export").strip("._-") or "export"
    return f"QA_{cleaned[:80]}.{ext}"


class ExportRequest(BaseModel):
    """Payload containing markdown content to export.

    ``selected_columns`` is an optional `{table_index_str: [header, …]}`
    map produced by the frontend column picker. The key is the table's
    0-based index in source order; only the listed headers survive in the
    downloaded artifact. Tables whose index is missing from the map (or
    when the map itself is omitted) are passed through unchanged.
    """

    content: str
    agent_name: str = "export"
    selected_columns: dict[str, list[str]] | None = Field(default=None)


def _build_response(data: bytes, media_type: str, filename: str) -> Response:
    """Wrap *data* in a download response with the given disposition."""
    return Response(
        content=data,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _run_export(format_name: str, fn, *args) -> bytes:
    """Invoke an exporter callable and translate failures to a clean 500.

    Without this wrapper any ValueError from openpyxl (bad sheet name) or
    pisa (malformed HTML) bubbles up as an opaque 500 with no body — and
    because the frontend asks for ``responseType: 'blob'`` the user sees
    a generic "Download failed" toast with no clue how to fix it. Logging
    + a structured detail surfaces the real cause both server-side and in
    the toast.
    """
    try:
        return fn(*args)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — surface to client + logs
        log.exception("Export %s failed", format_name)
        raise HTTPException(
            status_code=500,
            detail=f"{format_name.upper()} export failed: {exc}",
        ) from exc


@router.post("/excel")
async def export_excel(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as an Excel workbook."""
    data = _run_export(
        "excel",
        exporter.export_to_excel,
        body.content, body.agent_name, body.selected_columns,
    )
    return _build_response(
        data,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        _safe_filename(body.agent_name, "xlsx"),
    )


@router.post("/csv")
async def export_csv(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as a CSV file."""
    data = _run_export(
        "csv",
        exporter.export_to_csv,
        body.content, body.selected_columns,
    )
    return _build_response(
        data,
        "text/csv",
        _safe_filename(body.agent_name, "csv"),
    )


@router.post("/markdown")
async def export_md(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as a Markdown file."""
    data = _run_export(
        "markdown",
        exporter.export_to_markdown,
        body.content, body.agent_name, body.selected_columns,
    )
    return _build_response(
        data,
        "text/markdown",
        _safe_filename(body.agent_name, "md"),
    )


@router.post("/pdf")
async def export_pdf(body: ExportRequest, user=Depends(get_current_user)):
    """Export content as a styled PDF rendered from markdown."""
    data = _run_export(
        "pdf",
        exporter.export_to_pdf,
        body.content, body.agent_name, body.selected_columns,
    )
    return _build_response(
        data,
        "application/pdf",
        _safe_filename(body.agent_name, "pdf"),
    )
