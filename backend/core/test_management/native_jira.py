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


def _testcase_to_adf(tc: TestCase) -> dict[str, Any]:
    """Render *tc* as a rich Atlassian Document Format document."""
    blocks: list[dict[str, Any]] = []

    # Header line: bold labels + code-marked TC ID, separated by " | "
    header_runs: list[dict[str, Any]] = []
    if tc.id:
        if header_runs:
            header_runs.append(_text_node(" | "))
        header_runs.append(_bold("Test ID: "))
        header_runs.append(_code(tc.id))
    if tc.priority:
        if header_runs:
            header_runs.append(_text_node(" | "))
        header_runs.append(_bold("Priority: "))
        header_runs.append(_text_node(tc.priority))
    if tc.type:
        if header_runs:
            header_runs.append(_text_node(" | "))
        header_runs.append(_bold("Type: "))
        header_runs.append(_text_node(tc.type))
    if header_runs:
        blocks.append(_paragraph(header_runs))

    pre_lines = _split_lines(tc.preconditions)
    if pre_lines:
        blocks.append(_heading(3, "Preconditions"))
        blocks.append(_ordered_list(pre_lines))

    step_items = [s.strip() for s in (tc.steps or []) if s and s.strip()]
    if step_items:
        blocks.append(_heading(3, "Test Steps"))
        blocks.append(_ordered_list(step_items))

    exp_lines = _split_lines(tc.expected)
    if exp_lines:
        blocks.append(_heading(3, "Expected Result"))
        blocks.append(_ordered_list(exp_lines))

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
