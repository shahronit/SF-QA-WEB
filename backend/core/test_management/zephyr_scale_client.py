"""Zephyr Scale (SmartBear) Cloud REST API client.

Zephyr Scale Cloud is a separate service from Jira; authentication is a
single bearer token issued at https://api.zephyrscale.smartbear.com/v2.

Test cases are created one-by-one via ``POST /v2/testcases`` with a body
that requires ``projectKey`` and ``name``. Test steps are added via a
follow-up call to ``POST /v2/testcases/{testCaseKey}/teststeps``.
"""

from __future__ import annotations

import json
import socket
import ssl
import urllib.error
import urllib.request
from typing import Any

ZEPHYR_BASE_URL = "https://api.zephyrscale.smartbear.com/v2"
ZEPHYR_HTTP_TIMEOUT = 30


class ZephyrScaleClient:
    """Minimal Zephyr Scale Cloud client."""

    def __init__(self, api_token: str, jira_url: str = "") -> None:
        token = (api_token or "").strip()
        if not token:
            raise ConnectionError("Zephyr Scale API token is required.")
        self._token = token
        # Used only to build a UI-friendly URL for newly-created test cases.
        self._jira_url = (jira_url or "").rstrip("/")

    def _request(self, method: str, path: str, body: dict | None = None) -> Any:
        url = f"{ZEPHYR_BASE_URL}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self._token}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "SF-QA-Studio/1.0")
        try:
            with urllib.request.urlopen(req, timeout=ZEPHYR_HTTP_TIMEOUT) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                if not raw.strip():
                    return {}
                try:
                    return json.loads(raw)
                except json.JSONDecodeError:
                    return raw
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode() if exc.fp else ""
            except Exception:
                pass
            raise ConnectionError(
                f"Zephyr Scale {method} {path} returned {exc.code}: {err_body[:300] or exc.reason}"
            ) from exc
        except (socket.timeout, urllib.error.URLError, ssl.SSLError) as exc:
            raise ConnectionError(f"Cannot reach Zephyr Scale: {exc}") from exc

    def verify(self) -> bool:
        """Cheap call used by /connect/zephyr to confirm the token works."""
        self._request("GET", "/healthcheck")
        return True

    def create_test_case(
        self,
        project_key: str,
        title: str,
        steps: list[str],
        preconditions: str = "",
        priority: str = "",
    ) -> dict[str, str]:
        """Create a test case + its steps and return ``{key, url}``."""
        body: dict[str, Any] = {
            "projectKey": project_key,
            "name": title or "(untitled)",
        }
        if preconditions:
            body["objective"] = preconditions
        if priority:
            body["priorityName"] = priority

        result = self._request("POST", "/testcases", body)
        if not isinstance(result, dict):
            return {"key": "", "url": ""}
        key = result.get("key", "")

        if key and steps:
            steps_body = {
                "mode": "OVERWRITE",
                "items": [
                    {"inline": {"description": s, "expectedResult": ""}}
                    for s in steps
                ],
            }
            try:
                self._request("POST", f"/testcases/{key}/teststeps", steps_body)
            except ConnectionError:
                # Steps are best-effort — the test case itself is already
                # created, so we still return the key.
                pass

        url = result.get("self") or ""
        if not url and self._jira_url and key:
            url = f"{self._jira_url}/projects/{project_key}?selectedItem=com.atlassian.plugins.atlassian-connect-plugin:com.kanoah.test-manager__main-project-page#!/testCase/{key}"

        return {"key": key, "url": url}
