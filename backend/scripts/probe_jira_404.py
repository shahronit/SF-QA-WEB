"""Sanity-check the new 404-explanation path in JiraClient.

Loads the encrypted Jira session for *username* from Firestore (same path
the runtime uses), calls get_full_issue() on a deliberately bad key, and
prints the resulting error string so we can verify it no longer leaks
the REST URL.

Usage (run from repo root with the backend venv on PATH):
    python -m backend.scripts.probe_jira_404 ronit.shah TNS-76
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make `backend/` importable when invoked as a script (`python backend/scripts/...`).
HERE = Path(__file__).resolve().parents[1]
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from core.jira_client import JiraClient  # noqa: E402
from routers.jira import _load_session  # noqa: E402


def main() -> int:
    username = sys.argv[1] if len(sys.argv) > 1 else "ronit.shah"
    key = sys.argv[2] if len(sys.argv) > 2 else "TNS-76"
    session = _load_session(username)
    if not session:
        print(f"[probe] no Jira session stored for {username!r}")
        return 1
    client = JiraClient(session["jira_url"], session["email"], session["api_token"])
    print(f"[probe] tenant : {client.base_url}")
    print(f"[probe] key    : {key}")
    try:
        client.get_full_issue(key)
    except Exception as exc:  # noqa: BLE001 - we want every failure mode here
        print(f"[probe] error  : {exc}")
        return 0
    print("[probe] unexpected success (issue actually fetched)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
