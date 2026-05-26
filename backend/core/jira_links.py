"""Tiny helpers for detecting Jira issue keys inside free-form text.

Used by the STLC pack router (to seed agents from a pasted Jira ticket) and
by the `/api/jira/resolve` endpoint (to power on-blur auto-fetch in the UI).
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# Jira Cloud key shape: a project key (letter then 1+ letters/digits/_) + '-'
# + digits. Real Jira project keys are conventionally uppercase and may
# contain underscores (e.g. ``MY_PROJ``); we accept either case here and
# normalise to upper-case at the call site so downstream API calls always
# use the canonical form Jira expects.
#
# Examples that match: ABC-1, ABC123-99, AB12-7, ket-1, MY_PROJ-42
# Examples that do NOT match (intentional): A-1 (single-char prefix is
# not a valid Jira project key), 9-1 (must start with a letter).
JIRA_KEY_RE = re.compile(r"\b([A-Za-z][A-Za-z0-9_]+-\d+)\b")

# Canonical first line that the AgentForm's ``jiraIssueToText`` writes
# at the top of every Jira-seeded agent input:
#     "Jira <issuetype> <KEY>: <summary>"
# e.g. "Jira Story ABC-123: Implement the OAuth flow".
# We anchor on ``^Jira`` (multi-line) so a bare key buried mid-prose
# doesn't get mis-attributed to a sibling ticket. The summary may
# contain any printable char except newline, so we use a non-greedy
# ``.+?`` clamped to the end of the line.
JIRA_HEADER_RE = re.compile(
    r"^Jira\s+\S+\s+([A-Za-z][A-Za-z0-9_]+-\d+):\s*(.+?)\s*$",
    re.MULTILINE,
)


def extract_jira_key(text: str | None, base_url: str | None = None) -> str | None:
    """Return the first Jira issue key found in *text*, or None.

    Recognises:
      - Bare keys, e.g. "blocked by ABC-123 today".
      - Browse URLs, e.g. "https://acme.atlassian.net/browse/ABC-123".

    Matching is case-insensitive — pasted lower-case keys (``abc-12``) are
    accepted and the result is normalised to upper-case so downstream
    Jira REST calls always use the canonical key shape. Project keys
    containing underscores (``MY_PROJ-42``) are also accepted.

    When *base_url* is supplied, URLs whose host does not match the connected
    Jira instance are still accepted (we trust the embedded key) — this keeps
    the helper useful for users who paste links from a different Jira tenant.
    The argument is reserved for future stricter matching.
    """
    if not text:
        return None
    text = str(text)

    for token in text.split():
        if "://" in token:
            try:
                parsed = urlparse(token)
            except ValueError:
                continue
            path_match = JIRA_KEY_RE.search(parsed.path or "")
            if path_match:
                return path_match.group(1).upper()

    bare_match = JIRA_KEY_RE.search(text)
    if bare_match:
        return bare_match.group(1).upper()
    return None


def extract_jira_meta(text) -> tuple[str | None, str | None]:
    """Return ``(key, summary)`` sniffed from a free-form agent input.

    The AgentForm's ``jiraIssueToText`` helper writes a canonical
    first line whenever the user pulled context from a Jira issue:

        Jira Story ABC-123: Implement the OAuth flow

    This helper recognises that header and returns both the upper-
    cased key AND the trimmed summary so the History UI can render a
    rich "KEY -- Summary" chip without an extra Jira API round-trip.

    Accepts either a string OR a dict. Agent runs persist the user
    input as a dict (``{requirements: "...", objects: "...", ...}``);
    ``str(dict)`` mangles the layout so the multiline ``^Jira`` anchor
    can never match -- when given a dict we recurse over its string
    values joined with newlines so the canonical header is anchored
    at the start of its own line.

    Falls back to ``extract_jira_key(text)`` when the canonical header
    isn't present (e.g. legacy runs, or inputs where the user merely
    mentioned a key in free prose) -- in that case ``summary`` is
    ``None`` but the key still drops in.

    Always returns a tuple so callers can unpack unconditionally.
    """
    if text is None:
        return None, None
    if isinstance(text, dict):
        # Join the dict's string values with newlines so the MULTILINE
        # ``^Jira`` anchor can match a header that lives inside one of
        # the values (e.g. ``requirements`` or ``description``). Non-
        # string values are ignored -- they never carry the canonical
        # Jira header line.
        parts = [v for v in text.values() if isinstance(v, str) and v]
        if not parts:
            return None, None
        return extract_jira_meta("\n".join(parts))
    text = str(text)
    if not text:
        return None, None
    header_match = JIRA_HEADER_RE.search(text)
    if header_match:
        key = header_match.group(1).upper()
        summary = header_match.group(2).strip()
        return key, (summary or None)
    return extract_jira_key(text), None
