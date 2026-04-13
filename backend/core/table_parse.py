"""Parse Markdown pipe tables into structured row dicts."""

from __future__ import annotations


def parse_first_markdown_table(text: str) -> list[dict[str, str]] | None:
    """Return rows as dicts from the first pipe-style markdown table, or None."""
    lines = [ln.rstrip() for ln in text.splitlines()]
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if "|" not in line or line.count("|") < 2:
            i += 1
            continue
        header_cells = [c.strip() for c in line.strip("|").split("|")]
        header = [h for h in header_cells if h]
        if not header:
            i += 1
            continue
        i += 1
        if i >= len(lines):
            return None
        sep = lines[i].strip()
        if "|" not in sep or not all(ch in "-|: \t" for ch in sep.replace("|", "")):
            i += 1
            continue
        i += 1
        rows: list[dict[str, str]] = []
        while i < len(lines):
            raw = lines[i].strip()
            if "|" not in raw or not raw.strip("|").strip():
                break
            if set(raw.replace("|", "").replace(" ", "").replace("\t", "")) <= {"-", ":"}:
                break
            cells = [c.strip() for c in raw.strip("|").split("|")]
            if len(cells) < len(header):
                i += 1
                continue
            row_dict = {header[j]: cells[j] for j in range(len(header))}
            rows.append(row_dict)
            i += 1
        return rows or None
    return None
