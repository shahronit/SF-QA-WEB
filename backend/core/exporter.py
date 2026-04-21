"""Export agent output to Markdown, Excel, CSV, and PDF formats."""

from __future__ import annotations

import csv
import html as _html
import io
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SF_HEADER_FILL = "FF0070D2"
SF_HEADER_HEX = "#0070D2"

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^\s*(```|~~~)")


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


def split_markdown_sections(content: str) -> list[dict[str, str]]:
    """Split markdown into sections keyed by heading.

    A new section begins on every ATX heading line (``#`` to ``######``) that is
    *not* inside a fenced code block. Anything before the first heading is kept
    as a ``(Preamble)`` section so no content is lost. Each returned dict has
    ``Section Title`` and ``Markdown Content`` keys; the heading line itself is
    preserved at the top of the content for round-tripping.
    """
    sections: list[dict[str, str]] = []
    current_title = "(Preamble)"
    current_lines: list[str] = []
    in_fence = False

    def _flush() -> None:
        text = "\n".join(current_lines).strip("\n")
        if text or sections:
            sections.append(
                {"Section Title": current_title, "Markdown Content": text}
            )

    for raw_line in (content or "").splitlines():
        if _FENCE_RE.match(raw_line):
            in_fence = not in_fence
            current_lines.append(raw_line)
            continue
        m = _HEADING_RE.match(raw_line) if not in_fence else None
        if m:
            _flush()
            current_title = m.group(2).strip() or "(Untitled)"
            current_lines = [raw_line]
        else:
            current_lines.append(raw_line)
    _flush()

    cleaned: list[dict[str, str]] = []
    for sec in sections:
        if sec["Section Title"] == "(Preamble)" and not sec["Markdown Content"].strip():
            continue
        cleaned.append(sec)
    if not cleaned and (content or "").strip():
        cleaned.append({"Section Title": "(Content)", "Markdown Content": content})
    return cleaned


def export_to_excel(content: str, agent_name: str) -> bytes:
    """Build an .xlsx with one row per markdown section.

    Columns are ``Section Title`` and ``Markdown Content``; each cell carries
    the raw markdown text for that section so the file is editable as plain
    markdown but viewable as a structured grid.
    """
    rows = split_markdown_sections(content)
    sheet = (agent_name or "export")[:31] or "Export"
    if not rows:
        rows = [{"Section Title": "(Empty)", "Markdown Content": ""}]
    return export_workbook_bytes({sheet: rows})


def export_to_csv(content: str) -> bytes:
    """Return CSV bytes with one row per markdown section.

    Header row is ``Section Title,Markdown Content``; each subsequent row holds
    the raw markdown text for one section.
    """
    rows = split_markdown_sections(content)
    if not rows:
        rows = [{"Section Title": "(Empty)", "Markdown Content": ""}]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Section Title", "Markdown Content"])
    for row in rows:
        writer.writerow([row.get("Section Title", ""), row.get("Markdown Content", "")])
    return buf.getvalue().encode("utf-8")


_PDF_CSS = f"""
@page {{ size: A4; margin: 18mm 16mm 20mm 16mm; @frame footer {{
    -pdf-frame-content: footer; bottom: 8mm; margin-left: 16mm; margin-right: 16mm; height: 10mm;
}} }}
body {{ font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #1a1a1a; line-height: 1.45; }}
h1 {{ color: {SF_HEADER_HEX}; font-size: 22pt; border-bottom: 2pt solid {SF_HEADER_HEX};
       padding-bottom: 4pt; margin-top: 0; }}
h2 {{ color: {SF_HEADER_HEX}; font-size: 16pt; margin-top: 18pt; border-bottom: 0.5pt solid #cfd9e3; padding-bottom: 2pt; }}
h3 {{ color: #16325c; font-size: 13pt; margin-top: 14pt; }}
h4, h5, h6 {{ color: #16325c; margin-top: 10pt; }}
p {{ margin: 6pt 0; }}
ul, ol {{ margin: 6pt 0 6pt 18pt; }}
li {{ margin-bottom: 2pt; }}
code {{ font-family: Courier, monospace; background: #f4f6f9; padding: 1pt 3pt; border-radius: 2pt; }}
pre {{ font-family: Courier, monospace; background: #f4f6f9; padding: 8pt; border: 0.5pt solid #d8dde6;
       border-radius: 3pt; white-space: pre-wrap; font-size: 9pt; }}
blockquote {{ border-left: 3pt solid {SF_HEADER_HEX}; padding-left: 8pt; color: #4a5568; margin: 8pt 0; }}
table {{ border-collapse: collapse; width: 100%; margin: 8pt 0; }}
th {{ background: {SF_HEADER_HEX}; color: #ffffff; padding: 5pt 6pt; text-align: left;
      border: 0.5pt solid {SF_HEADER_HEX}; font-size: 9.5pt; }}
td {{ padding: 4pt 6pt; border: 0.5pt solid #d8dde6; vertical-align: top; font-size: 9.5pt; }}
.header-banner {{ color: #6b7280; font-size: 9pt; margin-bottom: 12pt; }}
.footer {{ color: #94a3b8; font-size: 8pt; text-align: center; }}
hr {{ border: 0; border-top: 0.5pt solid #cfd9e3; margin: 12pt 0; }}
"""


def export_to_pdf(content: str, agent_name: str) -> bytes:
    """Render markdown content to a styled PDF document.

    Markdown is converted to HTML (with GitHub-flavoured table support) and
    then rendered with xhtml2pdf/pisa. The output uses Salesforce-blue
    accents to match the rest of the app.
    """
    import markdown as md
    from xhtml2pdf import pisa

    html_body = md.markdown(
        content or "",
        extensions=["tables", "fenced_code", "sane_lists", "toc", "nl2br"],
        output_format="html5",
    )
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    title = f"Salesforce QA Agent — {(agent_name or 'export').replace('_', ' ').title()}"
    safe_title = _html.escape(title)
    safe_agent = _html.escape(agent_name or "export")
    safe_ts = _html.escape(timestamp)

    document = f"""<!DOCTYPE html>
<html><head><meta charset=\"utf-8\"><style>{_PDF_CSS}</style></head>
<body>
<div id=\"footer\" class=\"footer\">QA Studio • {safe_agent} • {safe_ts} • Page <pdf:pagenumber/> of <pdf:pagecount/></div>
<h1>{safe_title}</h1>
<div class=\"header-banner\">Generated {safe_ts}</div>
<hr/>
{html_body}
</body></html>"""

    buf = io.BytesIO()
    result = pisa.CreatePDF(src=io.StringIO(document), dest=buf, encoding="utf-8")
    if result.err:
        raise RuntimeError(f"PDF generation failed ({result.err} errors)")
    return buf.getvalue()
