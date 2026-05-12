"""Server-side parsers that extract chart-ready structured data from
the markdown output of each agent.

The Dashboard's "Agent insights" grid calls ``parse_for_agent`` with
the latest decrypted run output for every agent slug the caller has
access to. Each parser is regex-based, fail-soft, and returns either
a ``{"kind": str, "data": ...}`` dict or ``None`` when the agent did
not emit the expected structure (early failures, abandoned streams,
free-form responses to short prompts, etc.). A ``None`` result tells
the frontend to fall back to the generic activity sparkline.

Design notes:

    * Patterns mirror the existing frontend parsers in
      ``frontend/src/components/insights/parsers.js`` so the Dashboard
      cards and the per-agent insight tabs read from the same numbers.
    * Every parser swallows its own exceptions. A regex blow-up on a
      malformed run must NEVER take the Dashboard down, so the dispatcher
      logs and returns ``None`` instead of propagating.
    * ``data`` payloads stay JSON-serialisable primitives only (numbers,
      strings, lists of dicts of primitives) so FastAPI can hand them
      straight to the client without a custom encoder.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Callable

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _pick_number(text: str, patterns: list[str]) -> float | None:
    """Return the first numeric capture group across *patterns*.

    Each pattern must have at least one capturing group; the first
    parseable float (commas stripped) wins. Returns ``None`` when no
    pattern matched.
    """
    for pat in patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if not m:
            continue
        try:
            return float(m.group(1).replace(",", ""))
        except (ValueError, IndexError):
            continue
    return None


def _safe_int(value: float | None) -> int:
    """Round a parsed float to int, treating ``None`` as zero."""
    return int(round(value or 0))


# ---------------------------------------------------------------------------
# Per-agent parsers
# ---------------------------------------------------------------------------

def parse_exec_report(md: str) -> dict[str, Any] | None:
    """``exec_report`` -> bars of Pass / Fail / Blocked counts.

    Mirrors ``parseExecutionMetrics`` in the frontend so the Dashboard
    bars and the per-agent Insights tab agree on the numbers.
    """
    if not md:
        return None
    lower = md.lower()
    passed = _pick_number(lower, [
        r"passed[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
        r"\bpassed\b[^\d]*?(\d[\d,]*)",
    ])
    failed = _pick_number(lower, [
        r"failed[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
        r"\bfailed\b[^\d]*?(\d[\d,]*)",
    ])
    blocked = _pick_number(lower, [
        r"blocked[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
        r"\bblocked\b[^\d]*?(\d[\d,]*)",
    ])
    not_run = _pick_number(lower, [
        r"not\s*run[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
        r"not\s*executed[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
        r"\bnot\s*run\b[^\d]*?(\d[\d,]*)",
    ])
    if passed is None and failed is None and blocked is None and not_run is None:
        return None
    return {
        "kind": "exec_bars",
        "data": {
            "pass": _safe_int(passed),
            "fail": _safe_int(failed),
            "blocked": _safe_int(blocked),
            "not_run": _safe_int(not_run),
        },
    }


def parse_closure_report(md: str) -> dict[str, Any] | None:
    """``closure_report`` -> KPI tile values (pass rate, automation %, open defects).

    Mirrors ``parseClosureKpi`` in the frontend.
    """
    if not md:
        return None
    pass_rate = _pick_number(md, [r"pass\s*rate[^\d]*?(\d{1,3}(?:\.\d+)?)\s*%"])
    automation = _pick_number(md, [r"automat\w*[^\d]*?(\d{1,3}(?:\.\d+)?)\s*%"])
    open_defects = _pick_number(md, [
        r"(?:open|outstanding)\s*defects?[^\d]*?(\d[\d,]*)",
    ])
    closed_defects = _pick_number(md, [
        r"defects?\s*closed[^\d]*?(\d[\d,]*)",
        r"closed\s*defects?[^\d]*?(\d[\d,]*)",
    ])
    if pass_rate is None and automation is None and open_defects is None and closed_defects is None:
        return None
    return {
        "kind": "closure_kpi",
        "data": {
            "pass_rate": pass_rate,
            "automation": automation,
            "open_defects": _safe_int(open_defects) if open_defects is not None else None,
            "closed_defects": _safe_int(closed_defects) if closed_defects is not None else None,
        },
    }


# Techniques the estimation agent is most likely to emit. Matches the
# frontend list so the two views stay aligned.
_TECHNIQUE_NAMES = [
    "Work Breakdown",
    "Three-Point",
    "Function Point",
    "Use-Case Point",
    "Ratio",
    "Delphi",
    "Wideband",
    "Top-Down",
    "Bottom-Up",
    "PERT",
]


def parse_estimation(md: str) -> dict[str, Any] | None:
    """``estimation`` -> list of {technique, hours} rows for a bar chart.

    Picks every technique that yielded a numeric value; needs at least
    two so the chart isn't a single bar (those are better surfaced as
    a KPI tile, which we keep client-side for now).
    """
    if not md:
        return None
    items: list[dict[str, Any]] = []
    for name in _TECHNIQUE_NAMES:
        pat = rf"{re.escape(name)}[^\n|]*[\|: ]\s*(\d[\d,.]*)\s*(hr|hour|hrs|h|day|days|d)?"
        m = re.search(pat, md, re.IGNORECASE)
        if not m:
            continue
        try:
            value = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        unit = (m.group(2) or "hrs").lower()
        items.append({"technique": name, "hours": value, "unit": unit})
    if len(items) < 2:
        return None
    return {"kind": "technique_compare", "data": items}


def parse_rtm(md: str) -> dict[str, Any] | None:
    """``rtm`` -> coverage donut. Prefers percentage values, then falls
    back to integer counts of covered vs. uncovered rows.
    """
    if not md:
        return None
    covered = _pick_number(md, [
        r"covered[^\d]*?(\d{1,3})\s*%",
        r"coverage[^\d]*?(\d{1,3})\s*%",
        r"covered[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
    ])
    uncovered = _pick_number(md, [
        r"not\s*covered[^\d]*?(\d{1,3})\s*%",
        r"uncovered[^\d]*?(\d{1,3})\s*%",
        r"not\s*covered[^|\d]*[:\|][^\d]*?(\d[\d,]*)",
    ])
    if covered is None and uncovered is None:
        return None
    cov = _safe_int(covered)
    unc = _safe_int(uncovered) if uncovered is not None else max(0, 100 - cov)
    return {
        "kind": "coverage_donut",
        "data": {"covered": cov, "uncovered": unc},
    }


_SEVERITY_BUCKETS = ["Critical", "High", "Major", "Medium", "Low", "Minor", "Trivial"]


def parse_bug_report(md: str) -> dict[str, Any] | None:
    """``bug_report`` -> severity donut.

    Looks for the "Severity: X" line and counts severity-style cells in
    any markdown table. A single defect report typically yields a 1-bar
    donut; that's intentional — the user can scan severity at a glance
    without opening the report.
    """
    if not md:
        return None
    counts: dict[str, int] = {b: 0 for b in _SEVERITY_BUCKETS}

    sev_line = re.search(r"\bseverity[^:\n]*[:\|]\s*([A-Za-z]+)", md, re.IGNORECASE)
    if sev_line:
        label = sev_line.group(1).strip().title()
        if label in counts:
            counts[label] += 1

    for row in re.finditer(r"^\s*\|([^\n]+)\|\s*$", md, re.MULTILINE):
        cells = [c.strip() for c in row.group(1).split("|")]
        for cell in cells:
            title = cell.title()
            if title in counts and not sev_line:
                counts[title] += 1

    non_zero = {k: v for k, v in counts.items() if v > 0}
    if not non_zero:
        return None
    return {"kind": "severity_donut", "data": non_zero}


def parse_testcase(md: str) -> dict[str, Any] | None:
    """``testcase`` -> mix of positive / negative / edge cases.

    Counts heading occurrences ("### Positive", etc.) AND inline labels
    ("Positive Case 1") so it works with both prompt variants the
    Test Case Development agent ships today.
    """
    if not md:
        return None
    mix = {
        "positive": len(re.findall(r"\bpositive(?:\s*(?:case|test|scenario)s?)?\b", md, re.IGNORECASE)),
        "negative": len(re.findall(r"\bnegative(?:\s*(?:case|test|scenario)s?)?\b", md, re.IGNORECASE)),
        "edge": len(re.findall(r"\bedge(?:\s*(?:case|test|scenario)s?)?\b", md, re.IGNORECASE)),
    }
    if sum(mix.values()) == 0:
        return None
    return {"kind": "case_mix", "data": mix}


def _checklist_counts(md: str) -> dict[str, int] | None:
    """Shared ``- [x]`` / ``- [ ]`` counter for smoke + regression."""
    checked = len(re.findall(r"-\s*\[x\]", md, re.IGNORECASE))
    unchecked = len(re.findall(r"-\s*\[\s\]", md))
    total = checked + unchecked
    if total == 0:
        return None
    return {"total": total, "checked": checked, "unchecked": unchecked}


def parse_smoke(md: str) -> dict[str, Any] | None:
    if not md:
        return None
    data = _checklist_counts(md)
    if not data:
        return None
    return {"kind": "checklist", "data": data}


def parse_regression(md: str) -> dict[str, Any] | None:
    if not md:
        return None
    data = _checklist_counts(md)
    if not data:
        return None
    return {"kind": "checklist", "data": data}


def parse_test_data(md: str) -> dict[str, Any] | None:
    """``test_data`` -> records per object.

    Pulls "Account: 50", "Contact - 25" style declarations. The agent
    also emits a CSV/JSON block; we don't try to count rows there
    because parsing CSV server-side risks misreading a header.
    """
    if not md:
        return None
    pattern = re.compile(
        r"^\s*[-*]?\s*([A-Z][A-Za-z0-9_]*)\s*[:\-\u2013]\s*(\d[\d,]*)\s*(?:records?)?\s*$",
        re.MULTILINE,
    )
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in pattern.finditer(md):
        obj = m.group(1)
        if obj.lower() in {"summary", "total", "note", "notes", "objects"}:
            continue
        if obj in seen:
            continue
        seen.add(obj)
        try:
            records = int(m.group(2).replace(",", ""))
        except ValueError:
            continue
        items.append({"object": obj, "records": records})
    if len(items) == 0:
        return None
    return {"kind": "records_per_object", "data": items[:12]}


def parse_automation_plan(md: str) -> dict[str, Any] | None:
    """``automation_plan`` -> manual vs automated hours split for ROI.

    Looks for "Manual: 120 hrs" + "Automated: 30 hrs" anywhere in the
    ROI / effort table. Falls back to "savings" + "automation" capture
    when only the savings figure is emitted.
    """
    if not md:
        return None
    manual = _pick_number(md, [
        r"manual[^\d\n]*?(\d[\d,.]*)\s*(?:hr|hour|hrs)",
        r"manual\s*effort[^\d]*?(\d[\d,.]*)",
    ])
    automated = _pick_number(md, [
        r"automat\w*[^\d\n]*?(\d[\d,.]*)\s*(?:hr|hour|hrs)",
        r"automat\w*\s*effort[^\d]*?(\d[\d,.]*)",
    ])
    if manual is None and automated is None:
        return None
    return {
        "kind": "roi_split",
        "data": {
            "manual_hours": manual or 0,
            "automated_hours": automated or 0,
        },
    }


def parse_uat_plan(md: str) -> dict[str, Any] | None:
    """``uat_plan`` -> personas x scenarios.

    Scans markdown headings (## / ###) ending in "persona" or containing
    "as a <role>" patterns, then counts the test-scenario / case lines
    in each section.
    """
    if not md:
        return None
    sections = re.split(r"^#{1,4}\s+", md, flags=re.MULTILINE)
    personas: list[dict[str, Any]] = []
    for sec in sections[1:]:
        first_line, _, body = sec.partition("\n")
        title = first_line.strip().rstrip(":")
        if not title:
            continue
        if not re.search(r"persona|as\s+(?:a|an)\s+", title, re.IGNORECASE):
            continue
        scenarios = len(re.findall(r"^\s*(?:[-*]|\d+\.)\s+", body, re.MULTILINE))
        if scenarios == 0:
            continue
        personas.append({"persona": title[:48], "scenarios": scenarios})
    if not personas:
        return None
    return {"kind": "personas", "data": personas[:10]}


def parse_rca(md: str) -> dict[str, Any] | None:
    """``rca`` -> count of 5-why steps + corrective/preventive actions."""
    if not md:
        return None
    whys = len(re.findall(r"^\s*(?:why\s*\d+|\d+\.\s*why)\b", md, re.IGNORECASE | re.MULTILINE))
    if whys == 0:
        whys = len(re.findall(r"^\s*\d+\.\s+", md, re.MULTILINE))
    corrective = len(re.findall(r"corrective[^\n]*action", md, re.IGNORECASE))
    preventive = len(re.findall(r"preventive[^\n]*action", md, re.IGNORECASE))
    actions = corrective + preventive
    if whys == 0 and actions == 0:
        return None
    return {
        "kind": "rca_summary",
        "data": {
            "whys": whys,
            "actions": actions,
            "corrective": corrective,
            "preventive": preventive,
        },
    }


# ---------------------------------------------------------------------------
# Registry + dispatcher
# ---------------------------------------------------------------------------

PARSERS: dict[str, Callable[[str], dict[str, Any] | None]] = {
    "exec_report":     parse_exec_report,
    "closure_report":  parse_closure_report,
    "estimation":      parse_estimation,
    "rtm":             parse_rtm,
    "bug_report":      parse_bug_report,
    "testcase":        parse_testcase,
    "smoke":           parse_smoke,
    "regression":      parse_regression,
    "test_data":       parse_test_data,
    "automation_plan": parse_automation_plan,
    "uat_plan":        parse_uat_plan,
    "rca":             parse_rca,
    # Agents without a bespoke parser stay absent from the registry.
    # The dashboard route checks ``slug in PARSERS`` before dispatching
    # and renders the generic activity sparkline otherwise.
}


def parse_for_agent(slug: str | None, md: str | None) -> dict[str, Any] | None:
    """Dispatch *md* to the parser registered for *slug*.

    Returns ``None`` when no parser is registered, no markdown was
    given, or the parser raised. Never propagates exceptions — a
    malformed run must not take the Dashboard down.
    """
    if not slug or not md:
        return None
    parser = PARSERS.get(slug)
    if parser is None:
        return None
    try:
        return parser(md)
    except Exception:  # noqa: BLE001 - parsers are fail-soft by design
        logger.exception("insight parser %s raised on a run output", slug)
        return None
