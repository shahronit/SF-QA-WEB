"""Per-agent output validators used by the auto-repair pipeline.

Each validator takes the raw LLM output (already chatter-stripped by
``orchestrator._strip_chatter``) and returns ``(is_valid, reason)``:

    * ``is_valid=True``  — the artifact will round-trip through every
      downstream consumer (Jira push, exporter, deriveSummary). No
      repair attempted.
    * ``is_valid=False`` — the orchestrator triggers ONE repair call
      using the same provider+model with a strict format clamp; the
      ``reason`` string is interpolated into the clamp so the model
      knows exactly what to fix.

Free-form / prose-only agents (e.g. ``estimation``, ``rtm``,
``test_plan``) deliberately have no validator: their output is too
heterogeneous to validate cheaply, and downstream consumers don't
parse them strictly.

Adding a new validator is intentionally easy:
    1. Write a callable matching ``OutputValidator``.
    2. Register it in ``VALIDATORS`` keyed by the agent slug.
The orchestrator picks it up the next time the module is imported.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    OutputValidator = Callable[[str], tuple[bool, str]]


# ---------------------------------------------------------------------------
# Pattern primitives reused across validators
# ---------------------------------------------------------------------------

# Matches a fenced code block opener (``` or ~~~) on its own line.
_FENCE_RE = re.compile(r"^\s*(?:`{3,}|~{3,})", re.MULTILINE)

# Matches the `### filename.ext` heading copado_script demands.
_FILE_HEADING_RE = re.compile(
    r"^#{2,4}\s+[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,8}\s*$",
    re.MULTILINE,
)


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

def _validate_testcase_table(text: str) -> tuple[bool, str]:
    """Verify the agent's output yields >= 1 parseable test case.

    Defers to ``test_management.parser.parse_testcases_markdown`` —
    the same parser the Native Jira push and the export pipeline
    use, so the validator and the downstream consumer can never
    disagree about what counts as a valid table. We only fail when
    ZERO cases are extractable; partial extraction (1 of 5 rows
    parseable) is treated as success because the parser handles
    minor row-level damage gracefully.
    """
    if not text or not text.strip():
        return False, "empty response (no test-case table found)"
    try:
        from core.test_management.parser import parse_testcases_markdown
    except Exception:  # noqa: BLE001
        # Parser not importable in this build — give the model a pass
        # rather than blocking generations on a bootstrap problem.
        return True, ""
    cases = parse_testcases_markdown(text)
    if cases:
        return True, ""
    # Distinguish "no table at all" from "table with wrong columns"
    # so the repair clamp can be specific.
    has_pipe_table = bool(re.search(r"^\s*\|.+\|\s*$", text, re.MULTILINE))
    if has_pipe_table:
        reason = (
            "the response contains a markdown pipe table but its column "
            "headers do not match the required test-case schema "
            "(must include at least one of: ID/Title/Scenario, plus "
            "Steps and Expected Result columns)"
        )
    else:
        reason = (
            "the response does not contain a markdown pipe table — "
            "test cases must be emitted as a single GFM table with "
            "columns for ID, Title, Preconditions, Steps, Expected "
            "Result, Priority, and Type at minimum"
        )
    return False, reason


def _validate_split_doc(text: str) -> tuple[bool, str]:
    """For smoke / regression: require Part 1 narrative + Part 2 table.

    Smoke and regression agents produce a two-part document:
        Part 1 — narrative checklist of scenarios
        Part 2 — markdown test-case table (parseable by
                 ``parse_testcases_markdown``)

    We verify Part 2 strictly (the parser depends on it) and treat
    Part 1 leniently (any prose ahead of the table counts).
    """
    if not text or not text.strip():
        return False, "empty response"
    table_ok, reason = _validate_testcase_table(text)
    if not table_ok:
        return False, (
            f"Part 2 (the test-case table) is missing or malformed: {reason}"
        )
    # Sanity: there should be SOMETHING before the first pipe-table row,
    # since Part 1 (the narrative checklist) is required by the prompt.
    first_table_match = re.search(r"^\s*\|.+\|\s*$", text, re.MULTILINE)
    if first_table_match:
        before = text[: first_table_match.start()].strip()
        if not before or len(before) < 40:
            return False, (
                "Part 1 (the scenario narrative / checklist) is missing "
                "before the test-case table"
            )
    return True, ""


def _validate_bug_summary(text: str) -> tuple[bool, str]:
    """Bug-report needs an extractable summary line + a metadata table.

    The Jira bug push uses ``deriveSummary`` (frontend) which reads the
    first ``#`` heading or first non-empty line. We verify that the
    first meaningful line resolves to something usable AND that the
    metadata pipe table exists (the prompt promises both).
    """
    if not text or not text.strip():
        return False, "empty response"
    # First non-empty line should be a heading OR a one-liner that
    # could function as a summary. Reject obvious chatter that slipped
    # past the stripper.
    first = ""
    for line in text.splitlines():
        if line.strip():
            first = line.strip()
            break
    if not first:
        return False, "no first line found"
    bad_starts = ("sure", "of course", "here is", "here's", "certainly", "okay")
    if first.lower().startswith(bad_starts):
        return False, (
            f"first line is conversational chatter ({first[:40]!r}); "
            "the bug summary must be the first character of the artifact"
        )
    # Need at least one pipe-table row (the metadata block).
    if not re.search(r"^\s*\|.+\|\s*$", text, re.MULTILINE):
        return False, (
            "no markdown pipe table found — the bug-report template "
            "requires a metadata pipe table (Issue Type / Severity / "
            "Affected Component / etc.) immediately under the summary line"
        )
    return True, ""


def _validate_script_files(text: str) -> tuple[bool, str]:
    """copado_script: at least one ``### filename.ext`` + matching code fence.

    The prompt demands one fenced code block per generated file,
    headed by a ``### filename.ext`` heading so a downstream tool
    (or human) can extract files mechanically.
    """
    if not text or not text.strip():
        return False, "empty response"
    file_headings = _FILE_HEADING_RE.findall(text)
    fences = _FENCE_RE.findall(text)
    if not file_headings:
        return False, (
            "no `### filename.ext` headings found — every generated "
            "script file must be preceded by its own filename heading "
            "(e.g. `### LoginTest.cls`)"
        )
    if not fences:
        return False, (
            "no fenced code blocks found — each `### filename.ext` "
            "heading must be followed by exactly one fenced code "
            "block containing the file body"
        )
    # Loose pairing check: at least one fence per heading. We can't
    # require an exact 1:1 because some prompts allow a final summary
    # table after the file blocks.
    if len(fences) < len(file_headings):
        return False, (
            f"found {len(file_headings)} filename headings but only "
            f"{len(fences) // 2} fenced code blocks — every file heading "
            "must be paired with a fenced code block"
        )
    return True, ""


# ---------------------------------------------------------------------------
# Registry — orchestrator looks up by agent slug
# ---------------------------------------------------------------------------

VALIDATORS: dict[str, Callable[[str], tuple[bool, str]]] = {
    "testcase":      _validate_testcase_table,
    "smoke":         _validate_split_doc,
    "regression":    _validate_split_doc,
    "bug_report":    _validate_bug_summary,
    "copado_script": _validate_script_files,
}
