"""Xray Cloud REST API client.

Xray Cloud uses an OAuth-style two-step flow:
  1. POST /api/v2/authenticate with ``{client_id, client_secret}`` returns a
     bearer JWT (the response body is the raw token string in quotes).
  2. All subsequent calls send ``Authorization: Bearer <token>``.

Test creation goes through ``POST /api/v2/import/test/bulk`` which accepts a
list of test definitions and returns a list of newly-created Jira issue
keys. Each test definition includes the destination Jira project key and
optional ``steps``, so we keep the call surface minimal.
"""

from __future__ import annotations

import json
import socket
import ssl
import urllib.error
import urllib.request
from typing import Any

XRAY_BASE_URL = "https://xray.cloud.getxray.app"
XRAY_HTTP_TIMEOUT = 30


class XrayClient:
    """Minimal Xray Cloud API client."""

    def __init__(self, client_id: str, client_secret: str) -> None:
        cid = (client_id or "").strip()
        secret = (client_secret or "").strip()
        if not cid or not secret:
            raise ConnectionError("Xray client_id and client_secret are required.")
        self._client_id = cid
        self._client_secret = secret
        self._token: str | None = None

    def _authenticate(self) -> str:
        if self._token:
            return self._token
        url = f"{XRAY_BASE_URL}/api/v2/authenticate"
        body = json.dumps({
            "client_id": self._client_id,
            "client_secret": self._client_secret,
        }).encode()
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "SF-QA-Studio/1.0")
        try:
            with urllib.request.urlopen(req, timeout=XRAY_HTTP_TIMEOUT) as resp:
                raw = resp.read().decode("utf-8", errors="replace").strip()
        except urllib.error.HTTPError as exc:
            err_body = ""
            try:
                err_body = exc.read().decode() if exc.fp else ""
            except Exception:
                pass
            raise ConnectionError(
                f"Xray authentication returned {exc.code}: {err_body[:300] or exc.reason}"
            ) from exc
        except (socket.timeout, urllib.error.URLError, ssl.SSLError) as exc:
            raise ConnectionError(f"Cannot reach Xray Cloud: {exc}") from exc

        token = raw.strip().strip('"')
        if not token:
            raise ConnectionError("Xray returned an empty authentication token.")
        self._token = token
        return token

    def verify(self) -> bool:
        """Force an authentication round-trip — used by /connect/xray to
        confirm the credentials before saving the session."""
        self._authenticate()
        return True

    def _request(self, method: str, path: str, body: dict | list | None = None) -> Any:
        token = self._authenticate()
        url = f"{XRAY_BASE_URL}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "SF-QA-Studio/1.0")
        try:
            with urllib.request.urlopen(req, timeout=XRAY_HTTP_TIMEOUT) as resp:
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
                f"Xray API {method} {path} returned {exc.code}: {err_body[:300] or exc.reason}"
            ) from exc
        except (socket.timeout, urllib.error.URLError, ssl.SSLError) as exc:
            raise ConnectionError(f"Cannot reach Xray Cloud: {exc}") from exc

    def create_test(
        self,
        project_key: str,
        title: str,
        steps: list[dict[str, str]],
        preconditions: str = "",
        priority: str = "",
    ) -> dict[str, str]:
        """Create a single Manual test in *project_key* and return ``{key, url}``.

        ``steps`` is a list of ``{action, data, result}`` dicts. ``data`` is
        sent empty when not supplied (Xray accepts blank strings).
        """
        fields: dict[str, Any] = {
            "summary": title,
            "project": {"key": project_key},
        }
        if priority:
            fields["priority"] = {"name": priority}
        if preconditions:
            # Xray ignores unknown fields, so this is safe even when the
            # destination project doesn't have a precondition issue type.
            fields["description"] = preconditions

        payload = {
            "fields": fields,
            "testtype": "Manual",
            "steps": steps,
        }
        result = self._request("POST", "/api/v2/import/test", payload)
        if isinstance(result, dict):
            key = result.get("key") or result.get("issueKey") or ""
            jira_url = result.get("self", "")
            return {
                "key": key,
                "url": jira_url or (f"https://{key.split('-', 1)[0]}.atlassian.net/browse/{key}" if key else ""),
            }
        return {"key": "", "url": ""}
