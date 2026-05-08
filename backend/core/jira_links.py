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
