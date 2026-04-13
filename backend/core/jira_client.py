"""Jira Cloud REST API client for creating bug issues."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class JiraClient:
    """Minimal Jira Cloud client using Basic Auth (email + API token)."""

    def __init__(self, jira_url: str, email: str, api_token: str) -> None:
        self.base_url = jira_url.rstrip("/")
        creds = base64.b64encode(f"{email}:{api_token}".encode()).decode()
        self._auth_header = f"Basic {creds}"

    def _request(self, method: str, path: str, body: dict | None = None) -> dict[str, Any]:
        """Execute an authenticated request against the Jira REST API."""
        url = f"{self.base_url}/rest/api/3{path}"
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self._auth_header)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        try:
            with urllib.request.urlopen(req) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode() if exc.fp else ""
            raise ConnectionError(
                f"Jira API {method} {path} returned {exc.code}: {err_body[:500]}"
            ) from exc
        except urllib.error.URLError as exc:
            raise ConnectionError(f"Cannot reach Jira: {exc}") from exc

    def list_projects(self) -> list[dict[str, str]]:
        """Return simplified project list: [{key, name}, ...]."""
        data = self._request("GET", "/project")
        if isinstance(data, list):
            return [{"key": p["key"], "name": p.get("name", p["key"])} for p in data]
        return []

    def create_bug(
        self,
        project_key: str,
        summary: str,
        description_markdown: str,
    ) -> dict[str, str]:
        """Create a Bug issue and return {key, url}.

        Description is sent as ADF (Atlassian Document Format) so Jira
        Cloud renders it properly.
        """
        payload = {
            "fields": {
                "project": {"key": project_key},
                "summary": summary,
                "issuetype": {"name": "Bug"},
                "description": _markdown_to_adf(description_markdown),
            }
        }
        result = self._request("POST", "/issue", payload)
        issue_key = result.get("key", "")
        return {
            "key": issue_key,
            "url": f"{self.base_url}/browse/{issue_key}",
        }


def _markdown_to_adf(text: str) -> dict[str, Any]:
    """Convert markdown text to a minimal ADF document.

    Jira Cloud API v3 requires description in Atlassian Document Format.
    We split by paragraphs and wrap each in a paragraph node with a text
    node so the content renders readably.
    """
    paragraphs = text.split("\n\n") if text else [""]
    content_nodes: list[dict[str, Any]] = []
    for para in paragraphs:
        stripped = para.strip()
        if not stripped:
            continue
        content_nodes.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": stripped}],
        })
    if not content_nodes:
        content_nodes.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": "(empty)"}],
        })
    return {
        "version": 1,
        "type": "doc",
        "content": content_nodes,
    }
