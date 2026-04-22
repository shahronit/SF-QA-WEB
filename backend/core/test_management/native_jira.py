"""Native Jira ``Test`` issuetype push helpers.

This module is a thin orchestration layer: it owns the formatting of a
:class:`TestCase` into a Markdown description and delegates the actual
HTTP call to the existing :class:`core.jira_client.JiraClient`.

We do not introduce a new HTTP client here because Jira authentication is
already handled by the global Jira session (see ``backend/routers/jira.py``).
"""

from __future__ import annotations

from core.jira_client import JiraClient
from core.test_management.parser import TestCase


def _testcase_to_markdown(tc: TestCase) -> str:
    """Render *tc* as a human-readable Jira description (Markdown)."""
    parts: list[str] = []
    if tc.id:
        parts.append(f"**Test ID:** {tc.id}")
    if tc.priority:
        parts.append(f"**Priority:** {tc.priority}")
    if tc.type:
        parts.append(f"**Type:** {tc.type}")
    if tc.preconditions:
        parts.append(f"\n**Preconditions:**\n{tc.preconditions}")
    if tc.steps:
        steps_md = "\n".join(f"{i + 1}. {step}" for i, step in enumerate(tc.steps))
        parts.append(f"\n**Steps:**\n{steps_md}")
    if tc.expected:
        parts.append(f"\n**Expected Result:**\n{tc.expected}")
    if not parts:
        parts.append("(no detail provided)")
    return "\n".join(parts)


def push_test_case(
    client: JiraClient,
    project_key: str,
    tc: TestCase,
    issuetype: str = "Test",
) -> dict[str, str]:
    """Create one native Jira issue (``issuetype`` defaults to ``Test``)."""
    summary = tc.title or tc.id or "(untitled test case)"
    description = _testcase_to_markdown(tc)
    return client.create_issue(
        project_key=project_key,
        summary=summary,
        description_markdown=description,
        issuetype=issuetype,
    )
