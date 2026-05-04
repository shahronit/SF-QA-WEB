"""Native Jira ``Test`` issuetype push helpers.

This module is a thin orchestration layer: it builds a rich ADF
(Atlassian Document Format) description for a :class:`TestCase` and
delegates the actual HTTP call to the existing
:class:`core.jira_client.JiraClient`.

We do not introduce a new HTTP client here because Jira authentication
is already handled by the global Jira session (see
``backend/routers/jira.py``).
"""

from __future__ import annotations

import re
from typing import Any

from core.jira_client import JiraClient
from core.test_management.parser import TestCase


# ---------------------------------------------------------------------------
# ADF builders
# ---------------------------------------------------------------------------

# Strip any "Linked story: KEY" line that may have leaked into a free-text
# precondition / expected field. The link is now a real Jira issue link;
# echoing it inside the description would just be noise.
_LINKED_STORY_LINE_RE = re.compile(r"(?im)^\s*linked\s+story\s*:\s*\S+\s*$")


def _clean(text: str) -> str:
    if not text:
        return ""
    return _LINKED_STORY_LINE_RE.sub("", text).strip()


_BR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
# Break a cell on either a real newline or a "<number>. " boundary so cells
# that arrived on a single line (some LLM outputs skip <br> entirely) still
# split into individual items.
_NUMBERED_SPLIT_RE = re.compile(r"\n+|\s*(?=\b\d+[.)]\s)")
# Strip leading "1. " / "1) " markers from each resulting line so the ADF
# ordered list renders its own numbering instead of double-numbering.
_LEADING_NUM_RE = re.compile(r"^\s*\d+[.)]\s*")


def _split_lines(text: str) -> list[str]:
    """Split *text* into a clean list of one-liners.

    Agent-emitted ``Preconditions`` and ``Expected Result`` cells use the
    same ``"1. Foo<br>2. Bar"`` convention as test steps. We normalize all
    ``<br>`` variants to real newlines, split on either newlines or numbered
    boundaries, drop the leading list marker from each chunk, and trim.
    The caller can then render the result as a proper ordered list so the
    three sections look identical in Jira.
    """
    cleaned = _clean(text)
    if not cleaned:
        return []
    normalized = _BR_RE.sub("\n", cleaned)
    parts = _NUMBERED_SPLIT_RE.split(normalized)
    items: list[str] = []
    for p in parts:
        s = _LEADING_NUM_RE.sub("", p).strip(" -\u2022*\t")
        if s:
            items.append(s)
    return items


def _text_node(text: str, marks: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    node: dict[str, Any] = {"type": "text", "text": text}
    if marks:
        node["marks"] = marks
    return node


def _bold(text: str) -> dict[str, Any]:
    return _text_node(text, [{"type": "strong"}])


def _code(text: str) -> dict[str, Any]:
    return _text_node(text, [{"type": "code"}])


def _paragraph(content: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "paragraph", "content": content}


def _heading(level: int, text: str) -> dict[str, Any]:
    return {
        "type": "heading",
        "attrs": {"level": level},
        "content": [_text_node(text)],
    }


def _ordered_list(items: list[str]) -> dict[str, Any]:
    return {
        "type": "orderedList",
        "content": [
            {
                "type": "listItem",
                "content": [_paragraph([_text_node(item)])],
            }
            for item in items
        ],
    }


# ---------------------------------------------------------------------------
# ADF table helpers
#
# Atlassian Cloud's ADF schema represents a table as:
#
#   {"type": "table", "attrs": {"isNumberColumnEnabled": False, "layout": "default"},
#    "content": [
#       {"type": "tableRow", "content": [<cells>]},
#       ...
#    ]}
#
# Each cell is a `tableHeader` or `tableCell` whose `content` is a list of
# block nodes (we always wrap text in a `paragraph`). The Pentair test-plan
# template renders test cases as a single per-case Jira issue whose
# description contains a small Field/Value metadata table plus a per-step
# Steps table (`# | Action | Test Data | Expected Result`) - we mirror
# that layout here.
# ---------------------------------------------------------------------------


def _table_cell(text: str, header: bool = False) -> dict[str, Any]:
    """Wrap *text* in a single ADF tableCell / tableHeader."""
    para = _paragraph([_text_node(text or "")])
    return {
        "type": "tableHeader" if header else "tableCell",
        "attrs": {},
        "content": [para],
    }


def _table_cell_rich(content: list[dict[str, Any]], header: bool = False) -> dict[str, Any]:
    """Wrap a pre-built list of inline nodes in a tableCell / tableHeader."""
    para = _paragraph(content or [_text_node("")])
    return {
        "type": "tableHeader" if header else "tableCell",
        "attrs": {},
        "content": [para],
    }


def _table_row(cells: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "tableRow", "content": cells}


def _table(headers: list[str], rows: list[list[str]]) -> dict[str, Any]:
    """Build an ADF table from plain-string headers + plain-string rows."""
    header_row = _table_row([_table_cell(h, header=True) for h in headers])
    data_rows = [
        _table_row([_table_cell(c) for c in row]) for row in rows
    ]
    return {
        "type": "table",
        "attrs": {"isNumberColumnEnabled": False, "layout": "default"},
        "content": [header_row, *data_rows],
    }


def _step_data_for_index(tc: TestCase, idx: int, total: int) -> str:
    """Pick the Test Data cell for the *idx*-th step (1-based externally).

    The agent emits a per-step `step_data` list aligned 1:1 with `steps`.
    When that list is shorter than `steps` the remaining steps fall back
    to the case-level `test_data` string (only the LAST step receives it,
    so the column doesn't repeat the same case-level value on every row).
    Returns ``""`` when no value applies, which renders as an empty cell.
    """
    sd = list(tc.step_data or [])
    if idx < len(sd):
        val = (sd[idx] or "").strip()
        if val and val != "-":
            return val
        return ""
    # No per-step value at this index. Surface the case-level test_data
    # only on the last step so the column does not repeat a single value
    # on every row.
    if idx == total - 1:
        case_data = (tc.test_data or "").strip()
        # Skip case-level data if it looks like the per-step list (it
        # then duplicates step_data and would only confuse the table).
        if case_data and not case_data.lstrip().startswith("1."):
            return case_data
    return ""


def _expected_for_index(tc: TestCase, exp_lines: list[str], idx: int, total: int) -> str:
    """Pick the Expected Result for the *idx*-th step.

    Mirrors the Test Data logic: per-step values when the agent supplies
    them 1:1, otherwise pin the single case-level expected to the last
    row only so the column doesn't repeat.
    """
    if idx < len(exp_lines):
        return (exp_lines[idx] or "").strip()
    if idx == total - 1 and exp_lines:
        # Single-line expected -- pin to the last step.
        return (exp_lines[-1] or "").strip()
    return ""


def _testcase_to_adf(tc: TestCase) -> dict[str, Any]:
    """Render *tc* as a rich Atlassian Document Format document.

    Layout (per the Pentair Astound test-plan template):

      1. Header paragraph: bold labels for ID / Priority / Severity / Type.
      2. Metadata table: Field | Value rows (Component / Story Ref /
         Test Data (case-level) / Labels) - skip rows whose value is empty.
      3. Preconditions ordered list.
      4. Steps ADF table: # | Action | Test Data | Expected Result.
      5. Description paragraph (when present).
    """
    blocks: list[dict[str, Any]] = []

    # 1. Header paragraph
    header_runs: list[dict[str, Any]] = []
    if tc.id:
        header_runs.append(_bold("Test ID: "))
        header_runs.append(_code(tc.id))
    if tc.priority:
        if header_runs:
            header_runs.append(_text_node(" | "))
        header_runs.append(_bold("Priority: "))
        header_runs.append(_text_node(tc.priority))
    if getattr(tc, "severity", ""):
        if header_runs:
            header_runs.append(_text_node(" | "))
        header_runs.append(_bold("Severity: "))
        header_runs.append(_text_node(tc.severity))
    if tc.type:
        if header_runs:
            header_runs.append(_text_node(" | "))
        header_runs.append(_bold("Type: "))
        header_runs.append(_text_node(tc.type))
    if header_runs:
        blocks.append(_paragraph(header_runs))

    # 2. Metadata table - only emit when at least one row has data.
    metadata_rows: list[list[str]] = []
    component = (getattr(tc, "component", "") or "").strip()
    if component:
        metadata_rows.append(["Component", component])
    labels = (getattr(tc, "labels", "") or "").strip()
    if labels:
        metadata_rows.append(["Labels", labels])
    case_test_data = (getattr(tc, "test_data", "") or "").strip()
    # Case-level Test Data only goes in the metadata block when it is
    # genuinely a single value, not a `1. ...<br>2. ...` step-aligned
    # blob (which already populates the Steps table column).
    if case_test_data and not case_test_data.lstrip().startswith("1."):
        # Strip any embedded <br> for the metadata line so it stays
        # readable; the per-step column (if any) preserves the breakdown.
        flat = _BR_RE.sub(", ", case_test_data)
        metadata_rows.append(["Test Data", flat])
    if metadata_rows:
        blocks.append(_heading(3, "Metadata"))
        blocks.append(_table(["Field", "Value"], metadata_rows))

    # 3. Preconditions ordered list.
    pre_lines = _split_lines(tc.preconditions)
    if pre_lines:
        blocks.append(_heading(3, "Preconditions"))
        blocks.append(_ordered_list(pre_lines))

    # 4. Steps table.
    step_items = [s.strip() for s in (tc.steps or []) if s and s.strip()]
    exp_lines = _split_lines(tc.expected)
    if step_items:
        total = len(step_items)
        rows: list[list[str]] = []
        for idx, action in enumerate(step_items):
            data_cell = _step_data_for_index(tc, idx, total)
            expected_cell = _expected_for_index(tc, exp_lines, idx, total)
            rows.append([str(idx + 1), action, data_cell, expected_cell])
        blocks.append(_heading(3, "Test Steps"))
        blocks.append(_table(["#", "Action", "Test Data", "Expected Result"], rows))
    elif exp_lines:
        # Steps were absent but we still want the Expected Result section
        # so the ticket carries the validation criteria.
        blocks.append(_heading(3, "Expected Result"))
        blocks.append(_ordered_list(exp_lines))

    # 5. Description paragraph (Pentair adds a free-text Description column).
    description = (getattr(tc, "description", "") or "").strip()
    if description:
        blocks.append(_heading(3, "Description"))
        blocks.append(_paragraph([_text_node(description)]))

    if not blocks:
        blocks.append(_paragraph([_text_node("(no detail provided)")]))

    return {"version": 1, "type": "doc", "content": blocks}


# ---------------------------------------------------------------------------
# Push entry point
# ---------------------------------------------------------------------------

def push_test_case(
    client: JiraClient,
    project_key: str,
    tc: TestCase,
    issuetype: str = "Test",
    user_story_key: str | None = None,
    link_type: str = "Test",
) -> dict[str, str]:
    """Create one native Jira issue (``issuetype`` defaults to ``Test``).

    When *user_story_key* is provided, also create a real Jira issue link
    of type *link_type* (default ``"Test"``) so the new test issue shows
    "tests STORY-123" in Jira and the user story shows
    "is tested by TEST-456". Falls back to the universally-available
    ``"Relates"`` link type if the project does not have ``"Test"``
    configured.

    Per-row link status is merged into the returned dict:

    - ``link_to``: the requested user-story key (always set on success)
    - ``link_type``: the link type that actually succeeded
    - ``link_warning``: present when we fell back to ``"Relates"``
    - ``link_error``: present when both the requested type and the
      fallback failed (the issue itself is still created)
    """
    summary = tc.title or tc.id or "(untitled test case)"
    adf = _testcase_to_adf(tc)
    created: dict[str, Any] = client.create_issue(
        project_key=project_key,
        summary=summary,
        description_adf=adf,
        issuetype=issuetype,
    )

    story = (user_story_key or "").strip()
    if not story:
        return created

    try:
        client.create_issue_link(
            link_type=link_type,
            inward_key=created["key"],
            outward_key=story,
        )
        created["link_to"] = story
        created["link_type"] = link_type
        return created
    except ConnectionError as exc:
        # Some Jira projects don't ship the "Test" link type -- fall back
        # to the universally-available "Relates" so the traceability link
        # still exists, even if the verb is generic.
        try:
            client.create_issue_link(
                link_type="Relates",
                inward_key=created["key"],
                outward_key=story,
            )
            created["link_to"] = story
            created["link_type"] = "Relates"
            created["link_warning"] = (
                f"'{link_type}' link type unavailable; used 'Relates' instead. ({exc})"
            )
            return created
        except ConnectionError as exc2:
            created["link_to"] = story
            created["link_error"] = str(exc2)
            return created
