"""Tiny helpers for detecting Jira issue keys inside free-form text.

Used by the STLC pack router (to seed agents from a pasted Jira ticket) and
by the `/api/jira/resolve` endpoint (to power on-blur auto-fetch in the UI).
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

# Standard Jira Cloud key shape: 2+ uppercase letters/digits + '-' + digits.
# Examples that match: ABC-1, ABC123-99, AB12-7
# Examples that do NOT match (intentional): A-1, abc-1, ABC_1
JIRA_KEY_RE = re.compile(r"\b([A-Z][A-Z0-9]+-\d+)\b")


def extract_jira_key(text: str | None, base_url: str | None = None) -> str | None:
    """Return the first Jira issue key found in *text*, or None.

    Recognises:
      - Bare keys, e.g. "blocked by ABC-123 today".
      - Browse URLs, e.g. "https://acme.atlassian.net/browse/ABC-123".

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
                return path_match.group(1)

    bare_match = JIRA_KEY_RE.search(text)
    if bare_match:
        return bare_match.group(1)
    return None
