"""Export agent output to Markdown, Excel, and CSV formats."""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SF_HEADER_FILL = "FF0070D2"


def export_markdown(content: str, path: str | Path) -> Path:
    """Write raw markdown content to a file and return its path."""
    p = Path(path)
    p.write_text(content, encoding="utf-8")
    return p


def _style_header_row(ws: Any, ncols: int) -> None:
    """Apply Salesforce-blue header styling to the first row."""
    fill = PatternFill(start_color=SF_HEADER_FILL, end_color=SF_HEADER_FILL, fill_type="solid")
    font = Font(color="FFFFFF", bold=True)
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill = fill
        cell.font = font
        cell.alignment = Alignment(vertical="center", wrap_text=True)


def export_workbook_bytes(sheets: dict[str, list[dict[str, Any]]]) -> bytes:
    """Build an .xlsx with one sheet per key; each value is a list of row dicts (openpyxl)."""
    wb = Workbook()
    first = True
    for sheet_name, rows in sheets.items():
        name = sheet_name[:31] or "Sheet1"
        if first:
            ws = wb.active
            ws.title = name
            first = False
        else:
            ws = wb.create_sheet(title=name)
        if not rows:
            ws.cell(row=1, column=1, value="(No data)")
            continue
        headers = list(rows[0].keys())
        for col, h in enumerate(headers, start=1):
            ws.cell(row=1, column=col, value=h)
        _style_header_row(ws, len(headers))
        for r, row in enumerate(rows, start=2):
            for c, h in enumerate(headers, start=1):
                val = row.get(h, "")
                cell = ws.cell(row=r, column=c, value=val)
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        for c in range(1, len(headers) + 1):
            ws.column_dimensions[get_column_letter(c)].width = min(48, max(12, len(str(headers[c - 1])) + 4))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_text_sheet_bytes(title: str, body: str, sheet_name: str = "Export") -> bytes:
    """Create a single-sheet Excel file with a title row and body text."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name[:31]
    ws.cell(row=1, column=1, value=title)
    ws.cell(row=2, column=1, value=body)
    ws.cell(row=1, column=1).font = Font(bold=True, color="FFFFFF")
    hdr = PatternFill(start_color=SF_HEADER_FILL, end_color=SF_HEADER_FILL, fill_type="solid")
    ws.cell(row=1, column=1).fill = hdr
    for cell in (ws["A1"], ws["A2"]):
        cell.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def sanitize_filename(name: str) -> str:
    """Return a filesystem-safe lowercase stem."""
    return re.sub(r"[^\w\-]", "_", name).lower()


def export_to_markdown(content: str, agent_name: str) -> bytes:
    """Prefix agent output with a title block for download."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    header = (
        f"# Salesforce QA Agent — {agent_name.title()}\n"
        f"> Generated: {timestamp}\n\n---\n\n"
    )
    return (header + content).encode("utf-8")


def export_to_excel(content: str, agent_name: str) -> bytes:
    """Prefer the first markdown table as rows; otherwise dump full text to one sheet."""
    from core.table_parse import parse_first_markdown_table

    rows = parse_first_markdown_table(content)
    sheet = (agent_name or "export")[:31] or "Export"
    if rows:
        return export_workbook_bytes({sheet: rows})
    return export_text_sheet_bytes(sheet, content, "Export")


def export_to_csv(content: str) -> bytes:
    """Extract the first markdown table and return CSV bytes, or full text as single-column CSV."""
    from core.table_parse import parse_first_markdown_table

    rows = parse_first_markdown_table(content)
    buf = io.StringIO()
    writer = csv.writer(buf)
    if rows:
        headers = list(rows[0].keys())
        writer.writerow(headers)
        for row in rows:
            writer.writerow([row.get(h, "") for h in headers])
    else:
        writer.writerow(["Content"])
        for line in content.splitlines():
            writer.writerow([line])
    return buf.getvalue().encode("utf-8")
