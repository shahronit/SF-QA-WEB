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
_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "id":            ("id", "tc id", "test id", "case id", "tc#", "tc no"),
    "title":         ("title", "scenario", "test case", "summary", "name", "description"),
    "preconditions": ("precondition", "pre-condition", "pre condition", "pre-req", "prereq", "setup"),
    "steps":         ("step", "test step", "procedure", "actions", "action"),
    "expected":      ("expected", "expected result", "expected outcome", "result"),
    "priority":      ("priority", "severity"),
    "type":          ("type", "test type", "category", "kind"),
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
                else:
                    setattr(tc, canonical, value.strip())
            if not tc.title and not tc.steps:
                continue
            cases.append(tc)

    return cases
