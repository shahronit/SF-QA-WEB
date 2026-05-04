"""Markdown -> structured test-case parser.

The test-case agents (``testcase``, ``smoke``, ``regression``) emit Markdown
that contains one or more pipe-separated tables. Each row of those tables is
a single test case. Column orders vary slightly between prompts but always
include something resembling: ID, Title/Scenario, Preconditions, Steps,
Expected Result, Priority, Type. This parser is deliberately tolerant — it
lower-cases & fuzzy-matches header names and skips any tables whose headers
do not look like test cases (so we don't mis-parse a generic risk-matrix or
RTM table that happens to share the report).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any


# Column-name aliases. The keys are the canonical fields we expose in the
# output; the values are header substrings (lower-cased) we accept for that
# column. The first match wins.
# Order matters: more specific aliases first so that "Test Step" (header)
# is not eaten by the generic "step" rule before "test step" is tried.
# Within each tuple the longer / more specific alias should appear first.
_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "id":            ("tc id", "test id", "case id", "tc#", "tc no", "id"),
    "title":         ("title", "scenario", "test case", "summary", "name"),
    "preconditions": ("precondition", "pre-condition", "pre condition", "pre-req", "prereq", "setup"),
    "steps":         ("test step", "step", "procedure", "actions", "action"),
    "expected":      ("expected result", "expected outcome", "expected"),
    # Per-step Test Data column. Must come BEFORE `description` so the
    # generic "data" alias doesn't eat columns named just "Data" that are
    # actually descriptions.
    "test_data":     ("test data", "data"),
    # Short narrative distinct from the title; round-trips through the
    # pop-out editor and into the native Jira ADF body.
    "description":   ("description",),
    "priority":      ("priority",),
    # Astound severity ladder column - keep separate from priority so the
    # GEN-mode 15-column table populates both.
    "severity":      ("severity",),
    "type":          ("test type", "type", "category", "kind"),
    "labels":        ("labels", "label", "tags"),
    "component":     ("component", "module", "feature", "area"),
}

# A test-case-looking table needs at least these canonical columns. Without
# at least one of (steps, expected) AND a title-like column we treat the
# table as something else (RTM, risk register, environments, etc.).
_REQUIRED_FIELDS = ("title",)
_AT_LEAST_ONE_OF = ("steps", "expected")


@dataclass
class TestCase:
    id: str = ""
    title: str = ""
    preconditions: str = ""
    steps: list[str] = field(default_factory=list)
    expected: str = ""
    priority: str = ""
    type: str = ""
    # Per-step test data, aligned 1:1 with `steps` when the agent emits a
    # `1. data<br>2. data<br>...` Test Data cell. Empty list means the
    # agent did not provide a Test Data column or every step needed `-`.
    step_data: list[str] = field(default_factory=list)
    # Optional fields surfaced by the Pentair-style test-case row. They
    # round-trip through the Native Jira ADF body so the pushed ticket
    # carries the same metadata the agent / pop-out editor produced.
    test_data: str = ""
    description: str = ""
    labels: str = ""
    component: str = ""
    severity: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Match an entire markdown table — header row, separator row, then 1+ data
# rows. We use a non-greedy scan; tables are separated by a blank line.
_TABLE_RE = re.compile(
    r"(?:^|\n)(\|[^\n]*\|\s*\n\|\s*[-:|\s]+\|\s*\n(?:\|[^\n]*\|\s*\n?)+)",
    re.MULTILINE,
)


def _split_row(row: str) -> list[str]:
    """Split a markdown table row into trimmed cell strings.

    Drops the leading and trailing empty cells produced by the bracketing
    pipes (``| a | b |`` -> ``["a", "b"]``).
    """
    cells = [c.strip() for c in row.strip().strip("|").split("|")]
    return cells


def _canonical_field(header: str) -> str | None:
    """Return the canonical field name for *header*, or None if unknown."""
    h = header.lower().strip()
    for canonical, aliases in _HEADER_ALIASES.items():
        for alias in aliases:
            if alias in h:
                return canonical
    return None


def _split_steps(raw: str) -> list[str]:
    """Split a steps cell into individual numbered steps.

    The agents emit steps in several flavours: ``"1. Foo<br>2. Bar"``,
    ``"1) Foo \\n 2) Bar"``, ``"- Foo \\n - Bar"``, or just ``"Foo. Bar."``.
    We try each in order and fall back to a single-step list.
    """
    if not raw:
        return []
    text = raw.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = text.strip()
    if not text:
        return []

    numbered = re.split(r"\n+|\s*(?=\b\d+[.)]\s)", text)
    steps = [re.sub(r"^\s*\d+[.)]\s*", "", s).strip(" -•*\t") for s in numbered if s.strip()]
    steps = [s for s in steps if s]
    if len(steps) > 1:
        return steps

    bulleted = [re.sub(r"^\s*[-•*]\s*", "", s).strip() for s in text.split("\n")]
    bulleted = [s for s in bulleted if s]
    if len(bulleted) > 1:
        return bulleted

    return [text]


def _split_step_data(raw: str) -> list[str]:
    """Split a per-step Test Data cell into one entry per step.

    Mirrors the layout the testcase prompts ask the LLM to emit:

        ``1. Lead.Country = "Germany"<br>2. -<br>3. Lead.LastName = "Test"``

    Unlike :func:`_split_steps`, a literal ``-`` placeholder is preserved
    as an empty string so the output stays aligned 1:1 with the Test
    Steps cell. This matters because the Native Jira push uses these
    values to populate the per-step Test Data column - dropping the
    placeholder would shift every subsequent row by one.

    Returns a list whose length matches the number of `1.`, `2.`, ...
    items found in the cell, or an empty list when no numbered shape is
    detected (in which case the caller should fall back to the raw
    case-level Test Data string).
    """
    if not raw:
        return []
    text = raw.replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n").strip()
    if not text:
        return []

    # Split on either real newlines or before a "<digit>. " boundary so
    # cells that arrived on a single line still split into items.
    parts = re.split(r"\n+|\s*(?=\b\d+[.)]\s)", text)
    items: list[str] = []
    for chunk in parts:
        if not chunk.strip():
            continue
        # Strip the leading "N. " marker but KEEP "-" as an empty value
        # so the per-step alignment is preserved.
        cleaned = re.sub(r"^\s*\d+[.)]\s*", "", chunk).strip()
        if cleaned == "-":
            cleaned = ""
        items.append(cleaned)

    # Need at least 2 items to look like a per-step list; otherwise the
    # cell is a single case-level value and the caller should treat it
    # as such.
    if len(items) < 2:
        return []
    return items


def parse_testcases_markdown(md: str) -> list[TestCase]:
    """Parse all test-case tables found in *md* into :class:`TestCase` objects.

    Returns an empty list if no test-case-shaped tables are detected.
    Tables that look like RTMs, risk registers, environments, etc. are
    skipped — they don't satisfy ``_REQUIRED_FIELDS`` + ``_AT_LEAST_ONE_OF``.
    """
    if not md:
        return []

    cases: list[TestCase] = []
    for match in _TABLE_RE.finditer(md):
        block = match.group(1)
        rows = [r for r in block.split("\n") if r.strip().startswith("|")]
        if len(rows) < 3:
            continue

        header_cells = _split_row(rows[0])
        column_map: dict[int, str] = {}
        # Keep only the FIRST column that maps to each canonical field. This
        # matters for the testcase / smoke / regression schemas where multiple
        # headers can share an alias (e.g. "Expected Result" + "Actual Result"
        # both contain the substring "result"; "Priority" + "Severity" both
        # appear in the General-mode 15-column shape). Without this, the
        # later column would silently overwrite the earlier one and TM push
        # would receive the wrong cell content.
        seen_canonicals: set[str] = set()
        for idx, h in enumerate(header_cells):
            canonical = _canonical_field(h)
            if canonical and canonical not in seen_canonicals:
                column_map[idx] = canonical
                seen_canonicals.add(canonical)

        if not all(req in column_map.values() for req in _REQUIRED_FIELDS):
            continue
        if not any(opt in column_map.values() for opt in _AT_LEAST_ONE_OF):
            continue

        # rows[1] is the separator, rows[2:] are data rows.
        for raw in rows[2:]:
            cells = _split_row(raw)
            if not any(c.strip() for c in cells):
                continue
            tc = TestCase()
            for idx, value in enumerate(cells):
                canonical = column_map.get(idx)
                if not canonical:
                    continue
                if canonical == "steps":
                    tc.steps = _split_steps(value)
                elif canonical == "test_data":
                    # Preserve the raw cell for the "case-level Test Data"
                    # row in the metadata block. Also split it 1:1 with
                    # steps via :func:`_split_step_data`, which keeps the
                    # alignment intact (literal `-` becomes "" instead of
                    # being dropped).
                    tc.test_data = value.strip()
                    tc.step_data = _split_step_data(value)
                else:
                    setattr(tc, canonical, value.strip())
            if not tc.title and not tc.steps:
                continue
            cases.append(tc)

    return cases
