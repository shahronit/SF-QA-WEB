"""Jira Cloud REST API client for creating bug issues."""

from __future__ import annotations

import base64
import json
import logging
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

log = logging.getLogger(__name__)

# Network timeout (seconds) for every Jira REST call. Without this, urllib
# blocks indefinitely behind a corporate proxy / unreachable host and the UI
# eventually times out with no useful error.
JIRA_HTTP_TIMEOUT = 20


def _normalize_jira_url(jira_url: str) -> str:
    """Strip whitespace + trailing slash and prepend ``https://`` when missing."""
    url = (jira_url or "").strip().rstrip("/")
    if not url:
        raise ConnectionError("Jira URL is empty.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


class JiraClient:
    """Minimal Jira Cloud client using Basic Auth (email + API token)."""

    def __init__(self, jira_url: str, email: str, api_token: str) -> None:
        self.base_url = _normalize_jira_url(jira_url)
        if not (email or "").strip():
            raise ConnectionError("Jira email is required.")
        if not (api_token or "").strip():
            raise ConnectionError("Jira API token is required.")
        creds = base64.b64encode(
            f"{email.strip()}:{api_token.strip()}".encode()
        ).decode()
        self._auth_header = f"Basic {creds}"

    def _request(
        self,
        method: str,
        path: str,
        body: dict | None = None,
        api_version: str = "3",
    ) -> Any:
        """Execute an authenticated request against the Jira REST API."""
        url = f"{self.base_url}/rest/api/{api_version}{path}"
        data = json.dumps(body).encode() if body else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self._auth_header)
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "SF-QA-Studio/1.0")
        try:
            with urllib.request.urlopen(req, timeout=JIRA_HTTP_TIMEOUT) as resp:
                raw = resp.read().decode()
                return json.loads(raw) if raw.strip() else {}
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode() if exc.fp else ""
            except Exception:
                pass
            log.warning("Jira HTTPError %s for %s %s: %s", exc.code, method, path, err_body[:500])
            raise ConnectionError(
                f"Jira API {method} {path} returned {exc.code}: {err_body[:500] or exc.reason}"
            ) from exc
        except ssl.SSLError as exc:
            log.warning("Jira SSL error for %s %s: %s", method, path, exc)
            raise ConnectionError(
                f"SSL error reaching Jira ({self.base_url}): {exc}. "
                "If you are behind a corporate proxy, verify the URL and TLS trust store."
            ) from exc
        except socket.timeout as exc:
            log.warning("Jira timeout (%ss) for %s %s", JIRA_HTTP_TIMEOUT, method, path)
            raise ConnectionError(
                f"Jira request timed out after {JIRA_HTTP_TIMEOUT}s "
                f"({method} {self.base_url}{path}). Check the URL and your network."
            ) from exc
        except urllib.error.URLError as exc:
            log.warning("Jira URLError for %s %s: %s", method, path, exc)
            raise ConnectionError(
                f"Cannot reach Jira at {self.base_url}: {exc.reason if hasattr(exc, 'reason') else exc}"
            ) from exc
        except Exception as exc:  # noqa: BLE001 - last-resort safety net
            log.exception("Unexpected Jira error for %s %s", method, path)
            raise ConnectionError(
                f"Unexpected error calling Jira ({type(exc).__name__}): {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # Projects
    # ------------------------------------------------------------------

    def list_projects(self) -> list[dict[str, str]]:
        """Return simplified project list: [{key, name}, ...]."""
        data = self._request("GET", "/project")
        if isinstance(data, list):
            return [{"key": p["key"], "name": p.get("name", p["key"])} for p in data]
        return []

    # ------------------------------------------------------------------
    # Issue search / browse
    # ------------------------------------------------------------------

    def list_issues(
        self,
        project_key: str,
        issue_type: str | None = None,
        max_results: int = 50,
    ) -> list[dict[str, Any]]:
        """Browse issues for a project, optionally filtered by issue type.

        Returns a simplified list of {key, summary, status, issuetype, priority, assignee}.
        """
        jql_parts = [f"project = {project_key}"]
        if issue_type:
            jql_parts.append(f'issuetype = "{issue_type}"')
        jql = " AND ".join(jql_parts) + " ORDER BY updated DESC"
        return self.search_issues(jql, max_results=max_results)

    def search_issues(self, jql: str, max_results: int = 50) -> list[dict[str, Any]]:
        """Run a JQL search and return simplified issue dicts."""
        params = urllib.parse.urlencode({
            "jql": jql,
            "maxResults": str(max_results),
            "fields": "summary,status,issuetype,priority,assignee,updated",
        })
        data = self._request("GET", f"/search?{params}")
        issues = data.get("issues", []) if isinstance(data, dict) else []
        return [_summarize_issue(it) for it in issues]

    def get_issue(self, issue_key: str) -> dict[str, Any]:
        """Fetch full issue detail for downstream agent input."""
        data = self._request("GET", f"/issue/{issue_key}")
        if not isinstance(data, dict):
            return {}
        fields = data.get("fields", {}) or {}
        description = fields.get("description")
        if isinstance(description, dict):
            description_text = _adf_to_text(description)
        else:
            description_text = description or ""
        subtasks = []
        for sub in fields.get("subtasks", []) or []:
            sf = sub.get("fields", {}) or {}
            subtasks.append({
                "key": sub.get("key"),
                "summary": sf.get("summary", ""),
                "status": (sf.get("status", {}) or {}).get("name", ""),
            })
        return {
            "key": data.get("key", issue_key),
            "summary": fields.get("summary", ""),
            "description": description_text,
            "status": (fields.get("status", {}) or {}).get("name", ""),
            "issuetype": (fields.get("issuetype", {}) or {}).get("name", ""),
            "priority": (fields.get("priority", {}) or {}).get("name", ""),
            "assignee": (fields.get("assignee", {}) or {}).get("displayName", ""),
            "reporter": (fields.get("reporter", {}) or {}).get("displayName", ""),
            "labels": fields.get("labels", []) or [],
            "components": [c.get("name", "") for c in fields.get("components", []) or []],
            "subtasks": subtasks,
            "url": f"{self.base_url}/browse/{data.get('key', issue_key)}",
        }

    def get_sprints(self, board_id: int) -> list[dict[str, Any]]:
        """Return active+future sprints for a board (uses agile API)."""
        url = f"{self.base_url}/rest/agile/1.0/board/{board_id}/sprint?state=active,future"
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", self._auth_header)
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "SF-QA-Studio/1.0")
        try:
            with urllib.request.urlopen(req, timeout=JIRA_HTTP_TIMEOUT) as resp:
                data = json.loads(resp.read().decode() or "{}")
                return data.get("values", [])
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode() if exc.fp else ""
            except Exception:
                pass
            raise ConnectionError(
                f"Jira agile API returned {exc.code}: {err_body[:500] or exc.reason}"
            ) from exc
        except (socket.timeout, urllib.error.URLError, ssl.SSLError) as exc:
            raise ConnectionError(f"Cannot reach Jira agile API: {exc}") from exc

    # ------------------------------------------------------------------
    # Bug creation
    # ------------------------------------------------------------------

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


def _summarize_issue(issue: dict[str, Any]) -> dict[str, Any]:
    """Flatten a raw Jira issue into the small dict used by the frontend."""
    fields = issue.get("fields", {}) or {}
    return {
        "key": issue.get("key", ""),
        "summary": fields.get("summary", ""),
        "status": (fields.get("status", {}) or {}).get("name", ""),
        "issuetype": (fields.get("issuetype", {}) or {}).get("name", ""),
        "priority": (fields.get("priority", {}) or {}).get("name", ""),
        "assignee": (fields.get("assignee", {}) or {}).get("displayName", ""),
        "updated": fields.get("updated", ""),
    }


def _adf_to_text(node: Any) -> str:
    """Best-effort flatten of an ADF document tree to plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, list):
        return "\n".join(_adf_to_text(n) for n in node)
    if not isinstance(node, dict):
        return ""
    node_type = node.get("type", "")
    if node_type == "text":
        return node.get("text", "")
    children = node.get("content", [])
    text = _adf_to_text(children)
    if node_type in {"paragraph", "heading"}:
        text += "\n"
    elif node_type == "listItem":
        text = f"- {text.strip()}\n"
    elif node_type in {"bulletList", "orderedList"}:
        pass
    return text
