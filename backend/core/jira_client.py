"""Jira Cloud REST API client for creating bug issues."""

from __future__ import annotations

import base64
import json
import logging
import re
import socket
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

# Network timeout (seconds) for every Jira REST call. Without this, urllib
# blocks indefinitely behind a corporate proxy / unreachable host and the UI
# eventually times out with no useful error.
JIRA_HTTP_TIMEOUT = 20


def _normalize_jira_url(jira_url: str) -> str:
    """Reduce *jira_url* to ``scheme://host`` for the REST API root.

    Accepts anything the user might paste — bare hostnames, full issue URLs
    (``https://acme.atlassian.net/browse/ABC-123``), board/project paths
    (``https://acme.atlassian.net/jira/software/projects/ABC/boards/1``), or
    URLs with extra query/fragment components — and returns just
    ``https://acme.atlassian.net``. The Jira Cloud REST API is always
    rooted at the tenant host, never at a sub-path.
    """
    raw = (jira_url or "").strip()
    if not raw:
        raise ConnectionError("Jira URL is empty.")
    if not raw.startswith(("http://", "https://")):
        raw = "https://" + raw
    parsed = urllib.parse.urlsplit(raw)
    host = parsed.netloc or parsed.path  # tolerate "host" with no scheme/path
    if not host:
        raise ConnectionError(f"Could not parse Jira URL: {jira_url!r}")
    scheme = parsed.scheme or "https"
    return f"{scheme}://{host}".rstrip("/")


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
                raw = resp.read().decode("utf-8", errors="replace")
                content_type = (resp.headers.get("Content-Type") or "").lower()
                final_url = resp.geturl()
                if not raw.strip():
                    return {}
                if "json" not in content_type:
                    snippet = raw.strip().replace("\n", " ")[:200]
                    log.warning(
                        "Jira returned non-JSON for %s %s (Content-Type=%r, final_url=%r): %s",
                        method, path, content_type, final_url, snippet,
                    )
                    hint = (
                        "Atlassian sent back HTML instead of JSON. "
                        "This usually means the Jira URL is wrong (use just "
                        "https://<your-tenant>.atlassian.net, no /browse/... or "
                        "/jira/... path), the tenant requires SSO/login that an "
                        "API token cannot complete, or the request was redirected "
                        "to a marketing/login page."
                    )
                    raise ConnectionError(
                        f"Jira API {method} {path} returned non-JSON "
                        f"(Content-Type={content_type or 'unknown'!r}, "
                        f"final_url={final_url!r}). {hint} "
                        f"First bytes: {snippet!r}"
                    )
                try:
                    return json.loads(raw)
                except json.JSONDecodeError as exc:
                    snippet = raw.strip().replace("\n", " ")[:200]
                    raise ConnectionError(
                        f"Jira API {method} {path} returned malformed JSON: "
                        f"{exc.msg}. First bytes: {snippet!r}"
                    ) from exc
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
        """Return simplified project list: [{key, name}, ...].

        Uses the paginated ``GET /rest/api/3/project/search`` endpoint.
        Atlassian deprecated the legacy ``GET /project`` endpoint — on
        many Cloud tenants it now silently returns an empty array
        instead of the projects visible to the user (same pattern as
        the ``/search`` → ``/search/jql`` deprecation handled below).

        We page through ``startAt`` until ``isLast`` is true (or, for
        very old responses without ``isLast``, until ``values`` is
        empty). Falls back to the legacy ``GET /project`` only if
        ``/project/search`` returns 404 — that endpoint does not exist
        on very old self-hosted Jira Server installations.
        """
        projects: list[dict[str, str]] = []
        seen_keys: set[str] = set()
        start_at = 0
        page_size = 50
        max_pages = 50  # 50 * 50 = 2500 projects, plenty for any tenant
        for _ in range(max_pages):
            path = f"/project/search?startAt={start_at}&maxResults={page_size}"
            try:
                data = self._request("GET", path)
            except ConnectionError as exc:
                # Only fall back to the legacy endpoint on a clean 404
                # (older Jira Server). Any other failure (auth, timeout,
                # SSO redirect) should bubble up as-is so the UI can show
                # a useful error.
                if "returned 404" in str(exc):
                    log.info(
                        "Jira /project/search returned 404; falling back "
                        "to legacy /project endpoint."
                    )
                    legacy = self._request("GET", "/project")
                    if isinstance(legacy, list):
                        return [
                            {"key": p["key"], "name": p.get("name", p["key"])}
                            for p in legacy
                        ]
                    return []
                raise
            if not isinstance(data, dict):
                break
            values = data.get("values") or []
            for p in values:
                key = p.get("key")
                if not key or key in seen_keys:
                    continue
                seen_keys.add(key)
                projects.append({"key": key, "name": p.get("name", key)})
            # Stop when the API tells us we're done, or when the page
            # came back empty (defensive — covers responses that omit
            # the ``isLast`` field).
            if data.get("isLast", True) or not values:
                break
            start_at += len(values)
        log.info("Jira list_projects returned %d project(s).", len(projects))
        return projects

    # ------------------------------------------------------------------
    # Issue search / browse
    # ------------------------------------------------------------------

    def list_issues(
        self,
        project_key: str,
        issue_type: str | None = None,
        max_results: int = 50,
        sprint_id: int | None = None,
        active_sprints_only: bool = False,
    ) -> list[dict[str, Any]]:
        """Browse issues for a project, optionally filtered by issue type and sprint.

        - ``sprint_id`` (when set) narrows to a single sprint via JQL
          ``sprint = {id}``.
        - ``active_sprints_only`` (when true and ``sprint_id`` is unset)
          narrows to currently-open sprints via ``sprint in openSprints()``.

        Returns a simplified list of {key, summary, status, issuetype, priority, assignee}.
        """
        jql_parts = [f"project = {project_key}"]
        if issue_type:
            jql_parts.append(f'issuetype = "{issue_type}"')
        if sprint_id is not None:
            jql_parts.append(f"sprint = {int(sprint_id)}")
        elif active_sprints_only:
            jql_parts.append("sprint in openSprints()")
        jql = " AND ".join(jql_parts) + " ORDER BY updated DESC"
        return self.search_issues(jql, max_results=max_results)

    def search_issues(self, jql: str, max_results: int = 50) -> list[dict[str, Any]]:
        """Run a JQL search and return simplified issue dicts.

        Uses the new ``POST /rest/api/3/search/jql`` endpoint. Atlassian
        removed the legacy ``GET /search`` API on 2025-05-01 (it now
        returns HTTP 410 Gone). The replacement is body-based and
        token-paginated; we still cap with ``maxResults`` to keep the
        UI responsive.
        """
        body = {
            "jql": jql,
            "maxResults": int(max_results),
            "fields": [
                "summary",
                "status",
                "issuetype",
                "priority",
                "assignee",
                "updated",
            ],
        }
        data = self._request("POST", "/search/jql", body)
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

    def _agile_get(self, path: str) -> dict[str, Any]:
        """Perform a GET against the Jira Agile REST API (``/rest/agile/1.0``).

        Kept separate from ``_request`` because the agile API lives at a
        different base path and returns slightly different error envelopes.
        Always returns a dict ({} on empty body).
        """
        url = f"{self.base_url}/rest/agile/1.0{path}"
        req = urllib.request.Request(url, method="GET")
        req.add_header("Authorization", self._auth_header)
        req.add_header("Accept", "application/json")
        req.add_header("User-Agent", "SF-QA-Studio/1.0")
        try:
            with urllib.request.urlopen(req, timeout=JIRA_HTTP_TIMEOUT) as resp:
                raw = resp.read().decode() or "{}"
                return json.loads(raw) if raw.strip() else {}
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

    def get_sprints(self, board_id: int) -> list[dict[str, Any]]:
        """Return active+future sprints for a board (uses agile API)."""
        data = self._agile_get(f"/board/{board_id}/sprint?state=active,future")
        return data.get("values", []) if isinstance(data, dict) else []

    def list_boards_for_project(self, project_key: str) -> list[dict[str, Any]]:
        """Return all agile boards (scrum + kanban) tied to *project_key*.

        Each entry: ``{id, name, type}`` where ``type`` is typically
        ``scrum`` or ``kanban``. Returns ``[]`` when the project has
        no boards or the agile API is unavailable.
        """
        data = self._agile_get(
            f"/board?projectKeyOrId={urllib.parse.quote(project_key)}"
        )
        result: list[dict[str, Any]] = []
        for b in (data.get("values") or []):
            if not isinstance(b, dict):
                continue
            result.append({
                "id": b.get("id"),
                "name": b.get("name", ""),
                "type": b.get("type", ""),
            })
        return result

    def list_sprints_for_project(
        self,
        project_key: str,
        state: str = "active,future",
    ) -> dict[str, Any]:
        """Auto-detect the project's first scrum board and return its sprints.

        Returns ``{board_id, board_name, sprints}`` on success, or
        ``{board_id: None, board_name: None, sprints: [], reason: "..."}``
        when no scrum board exists or the agile API is forbidden.

        Each sprint entry mirrors Jira's payload: ``{id, name, state,
        startDate, endDate, ...}`` so the frontend can render a useful
        label without further lookups.
        """
        try:
            boards = self.list_boards_for_project(project_key)
        except ConnectionError as exc:
            return {
                "board_id": None,
                "board_name": None,
                "sprints": [],
                "reason": f"agile_api_error: {exc}",
            }
        scrum_board = next(
            (b for b in boards if (b.get("type") or "").lower() == "scrum"),
            None,
        )
        if not scrum_board:
            return {
                "board_id": None,
                "board_name": None,
                "sprints": [],
                "reason": "no_scrum_board",
            }
        try:
            data = self._agile_get(
                f"/board/{int(scrum_board['id'])}/sprint?state={urllib.parse.quote(state)}"
            )
        except ConnectionError as exc:
            return {
                "board_id": scrum_board.get("id"),
                "board_name": scrum_board.get("name"),
                "sprints": [],
                "reason": f"sprint_fetch_error: {exc}",
            }
        sprints: list[dict[str, Any]] = []
        for s in (data.get("values") or []):
            if not isinstance(s, dict):
                continue
            sprints.append({
                "id": s.get("id"),
                "name": s.get("name", ""),
                "state": s.get("state", ""),
                "start_date": s.get("startDate"),
                "end_date": s.get("endDate"),
                "goal": s.get("goal"),
            })
        return {
            "board_id": scrum_board.get("id"),
            "board_name": scrum_board.get("name"),
            "sprints": sprints,
        }

    # ------------------------------------------------------------------
    # Full-detail fetch (parallel, partial-failure-isolated)
    # ------------------------------------------------------------------

    def get_full_issue(
        self,
        issue_key: str,
        gdrive_client: Any | None = None,
    ) -> dict[str, Any]:
        """Fetch all available detail categories for a Jira issue in parallel.

        Uses a ThreadPoolExecutor (max 8 workers) mirroring the p-limit(8)
        pattern from the spec.  Each category fetcher is isolated: a failure
        in one category records an error entry and does not abort the others.

        If a connected ``gdrive_client`` is supplied, any Google Drive URLs
        detected in the issue description, comments, remote links, or
        attachments are fetched in parallel and their extracted text is
        returned under ``gdrive_files``. ``gdrive_links_detected`` always
        surfaces the URLs so the UI can prompt for connection when no
        client is available.

        Returns a structured dict with a ``fetch_metadata`` summary,
        per-category results, and an ``errors`` list.
        """
        started = time.monotonic()
        errors: list[dict[str, Any]] = []

        # Core is fetched first — other categories are independent and only
        # need the issue key, so they can all run in parallel after this.
        core: dict[str, Any] = {}
        try:
            core = self._fetch_core(issue_key)
        except Exception as exc:  # noqa: BLE001
            errors.append({"category": "core", "reason": "NETWORK_ERROR", "message": str(exc)})

        parallel_tasks: dict[str, Any] = {
            "comments":     self._fetch_comments,
            "changelog":    self._fetch_changelog,
            "worklogs":     self._fetch_worklogs,
            "remote_links": self._fetch_remote_links,
            "watchers":     self._fetch_watchers,
            "votes":        self._fetch_votes,
            "transitions":  self._fetch_transitions,
        }

        results: dict[str, Any] = {"core": core}

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                executor.submit(fn, issue_key): name
                for name, fn in parallel_tasks.items()
            }
            for future in as_completed(futures):
                name = futures[future]
                try:
                    results[name] = future.result()
                except ConnectionError as exc:
                    msg = str(exc)
                    reason = (
                        "PERMISSION_DENIED" if "403" in msg else
                        "NOT_FOUND" if "404" in msg else
                        "RATE_LIMITED" if "429" in msg else
                        "NETWORK_ERROR"
                    )
                    results[name] = [] if name not in ("votes", "worklogs", "watchers") else {}
                    errors.append({"category": name, "reason": reason, "message": msg})
                except Exception as exc:  # noqa: BLE001
                    results[name] = []
                    errors.append({"category": name, "reason": "PARSE_ERROR", "message": str(exc)})

        # Derived categories — no extra HTTP calls
        results["participants"] = _derive_participants(
            core, results.get("comments", [])
        )

        # Extract sprint / epic / attachments / linked_issues / subtasks from raw fields
        raw_fields = core.pop("_raw_fields", {})
        results["attachments"] = _extract_attachments(raw_fields)
        results["linked_issues"] = _extract_linked_issues(raw_fields)
        results["subtasks"] = _extract_subtasks(raw_fields)
        results["sprint"] = _extract_sprint(raw_fields)

        epic_key = _extract_epic_key(raw_fields)
        results["epic"] = self._fetch_epic(epic_key) if epic_key else None

        # Google Drive auto-fetch — best-effort, non-fatal on failure.
        detected_gdrive = _extract_gdrive_links(
            core,
            results.get("comments", []),
            results.get("remote_links", []),
            results.get("attachments", []),
        )
        results["gdrive_links_detected"] = detected_gdrive
        results["gdrive_files"] = []
        if detected_gdrive and gdrive_client is not None:
            try:
                results["gdrive_files"] = gdrive_client.read_many(detected_gdrive)
            except Exception as exc:  # noqa: BLE001
                errors.append({
                    "category": "gdrive_files",
                    "reason": "NETWORK_ERROR",
                    "message": str(exc),
                })

        elapsed_ms = int((time.monotonic() - started) * 1000)
        failed_category_names = {e["category"] for e in errors}
        succeeded = [k for k in results if k not in ("errors", "fetch_metadata") and k not in failed_category_names]

        results["errors"] = errors
        results["fetch_metadata"] = {
            "issue_key": issue_key,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "duration_ms": elapsed_ms,
            "jira_base_url": self.base_url,
            "succeeded_categories": succeeded,
            "failed_categories": errors,
        }

        return results

    # ------------------------------------------------------------------
    # Private category fetchers
    # ------------------------------------------------------------------

    # System fields we already extract / surface explicitly above. Everything
    # else returned by Jira (including any future-added system field) flows
    # into ``custom_fields`` keyed by its display name when ``names`` lookup
    # succeeds, so nothing on the ticket is silently dropped.
    _CORE_KNOWN_SYSTEM_FIELDS = frozenset({
        "summary", "description", "issuetype", "status", "priority", "resolution",
        "assignee", "reporter", "creator", "project", "components", "labels",
        "fixVersions", "versions", "environment", "created", "updated", "duedate",
        "resolutiondate", "timeoriginalestimate", "timeestimate", "timespent",
        "aggregatetimespent", "votes", "watches", "subtasks", "attachment",
        "issuelinks", "parent", "security",
        # Already pulled into structured outputs by get_full_issue extractors:
        "comment", "worklog", "issuetype", "progress", "aggregateprogress",
        "workratio", "timetracking", "lastViewed", "statuscategorychangedate",
    })

    def _fetch_core(self, issue_key: str) -> dict[str, Any]:
        """Fetch enriched core issue fields with ``fields=*all``.

        Using ``*all`` makes Jira return every system AND custom field
        configured on the ticket — including tenant-specific custom fields
        like Acceptance Criteria, custom Story Points pickers, team-defined
        text fields, etc. We then label each ``customfield_XXXXX`` (and any
        unknown system field) via the top-level ``names`` map returned by
        ``expand=names`` and surface the labelled bag as ``custom_fields``
        on the returned core dict.

        The hard-coded Cloud-default IDs for sprint / epic / story points
        (10014/10016/10020) are kept as a fallback so the structured
        ``epic`` / ``sprint`` outputs in ``get_full_issue`` keep working
        on tenants that match those defaults.
        """
        data = self._request(
            "GET",
            f"/issue/{issue_key}?expand=renderedFields,names,schema&fields=*all",
        )
        fields = data.get("fields", {}) or {}
        names: dict[str, str] = data.get("names", {}) or {}
        description = fields.get("description")
        description_text = _adf_to_text(description) if isinstance(description, dict) else (description or "")

        parent = fields.get("parent")
        parent_info: dict[str, Any] | None = None
        if parent:
            parent_info = {
                "key": parent.get("key", ""),
                "summary": ((parent.get("fields") or {}).get("summary") or ""),
            }

        # Collect everything we did NOT explicitly extract above into a
        # labelled custom_fields map. This catches all `customfield_*` IDs
        # plus any system field we don't recognise, so the UI / LLM seed
        # see every value the ticket actually carries.
        custom_fields: dict[str, Any] = {}
        for fkey, fval in fields.items():
            if fkey in self._CORE_KNOWN_SYSTEM_FIELDS:
                continue
            if fval is None or fval == "" or fval == [] or fval == {}:
                continue
            label = names.get(fkey) or fkey
            custom_fields[label] = _flatten_field_value(fval)

        return {
            "key": data.get("key", issue_key),
            "summary": fields.get("summary", ""),
            "description": description_text,
            "issuetype": (fields.get("issuetype") or {}).get("name", ""),
            "status": (fields.get("status") or {}).get("name", ""),
            "status_category": ((fields.get("status") or {}).get("statusCategory") or {}).get("name", ""),
            "priority": (fields.get("priority") or {}).get("name", ""),
            "resolution": (fields.get("resolution") or {}).get("name"),
            "assignee": _person(fields.get("assignee")),
            "reporter": _person(fields.get("reporter")),
            "creator": _person(fields.get("creator")),
            "project": {
                "key": (fields.get("project") or {}).get("key", ""),
                "name": (fields.get("project") or {}).get("name", ""),
            },
            "components": [c.get("name", "") for c in (fields.get("components") or [])],
            "labels": fields.get("labels") or [],
            "fix_versions": [v.get("name", "") for v in (fields.get("fixVersions") or [])],
            "affects_versions": [v.get("name", "") for v in (fields.get("versions") or [])],
            "environment": fields.get("environment"),
            "created": fields.get("created"),
            "updated": fields.get("updated"),
            "due_date": fields.get("duedate"),
            "resolution_date": fields.get("resolutiondate"),
            "time_original_estimate": fields.get("timeoriginalestimate"),
            "time_estimate": fields.get("timeestimate"),
            "time_spent": fields.get("timespent"),
            "aggregate_time_spent": fields.get("aggregatetimespent"),
            "story_points": fields.get("customfield_10016"),
            "epic_link": fields.get("customfield_10014"),
            "parent": parent_info,
            "custom_fields": custom_fields,
            "url": f"{self.base_url}/browse/{data.get('key', issue_key)}",
            # Kept for extraction helpers in get_full_issue(); stripped before returning
            "_raw_fields": fields,
        }

    def _paginate(self, path: str, results_key: str, page_size: int = 100) -> list[dict[str, Any]]:
        """Generic offset paginator for Jira REST endpoints."""
        items: list[dict[str, Any]] = []
        start_at = 0
        while True:
            sep = "&" if "?" in path else "?"
            data = self._request("GET", f"{path}{sep}startAt={start_at}&maxResults={page_size}")
            if not isinstance(data, dict):
                break
            batch = data.get(results_key, []) or []
            items.extend(batch)
            total = data.get("total", 0)
            is_last = data.get("isLast", False)
            start_at += len(batch)
            if is_last or not batch or start_at >= total:
                break
        return items

    def _fetch_comments(self, issue_key: str) -> list[dict[str, Any]]:
        """Fetch all comments with ADF-to-text conversion."""
        entries = self._paginate(f"/issue/{issue_key}/comment?orderBy=created", "comments")
        result = []
        for c in entries:
            body = c.get("body")
            result.append({
                "id": c.get("id"),
                "author": _person(c.get("author")),
                "body": _adf_to_text(body) if isinstance(body, dict) else (body or ""),
                "created": c.get("created"),
                "updated": c.get("updated"),
                "visibility": c.get("visibility"),
                "jsd_public": c.get("jsdPublic"),
            })
        return result

    def _fetch_changelog(self, issue_key: str) -> list[dict[str, Any]]:
        """Fetch the full change history with pagination."""
        entries = self._paginate(f"/issue/{issue_key}/changelog", "values")
        return [
            {
                "id": entry.get("id"),
                "author": _person(entry.get("author")),
                "created": entry.get("created"),
                "items": [
                    {
                        "field": it.get("field"),
                        "field_type": it.get("fieldtype"),
                        "from": it.get("from"),
                        "from_string": it.get("fromString"),
                        "to": it.get("to"),
                        "to_string": it.get("toString"),
                    }
                    for it in (entry.get("items") or [])
                ],
            }
            for entry in entries
        ]

    def _fetch_worklogs(self, issue_key: str) -> dict[str, Any]:
        """Fetch worklog entries and aggregate total time spent."""
        entries = self._paginate(f"/issue/{issue_key}/worklog", "worklogs")
        total_seconds = sum(w.get("timeSpentSeconds", 0) for w in entries)
        return {
            "total_time_spent_seconds": total_seconds,
            "total_worklogs": len(entries),
            "entries": [
                {
                    "id": w.get("id"),
                    "author": _person(w.get("author")),
                    "comment": _adf_to_text(w["comment"]) if isinstance(w.get("comment"), dict) else (w.get("comment") or ""),
                    "started": w.get("started"),
                    "created": w.get("created"),
                    "updated": w.get("updated"),
                    "time_spent": w.get("timeSpent"),
                    "time_spent_seconds": w.get("timeSpentSeconds", 0),
                }
                for w in entries
            ],
        }

    def _fetch_remote_links(self, issue_key: str) -> list[dict[str, Any]]:
        """Fetch remote links (Confluence pages, external URLs, etc.)."""
        data = self._request("GET", f"/issue/{issue_key}/remotelink")
        if not isinstance(data, list):
            return []
        return [
            {
                "id": link.get("id"),
                "relationship": link.get("relationship"),
                "url": (link.get("object") or {}).get("url"),
                "title": (link.get("object") or {}).get("title"),
                "summary": (link.get("object") or {}).get("summary"),
                "resolved": ((link.get("object") or {}).get("status") or {}).get("resolved"),
            }
            for link in data
        ]

    def _fetch_watchers(self, issue_key: str) -> dict[str, Any]:
        """Fetch the watcher list and count."""
        data = self._request("GET", f"/issue/{issue_key}/watchers")
        if not isinstance(data, dict):
            return {"watch_count": 0, "watchers": []}
        return {
            "watch_count": data.get("watchCount", 0),
            "is_watching": data.get("isWatching", False),
            "watchers": [_person(w) for w in (data.get("watchers") or [])],
        }

    def _fetch_votes(self, issue_key: str) -> dict[str, Any]:
        """Fetch vote count for the issue."""
        data = self._request("GET", f"/issue/{issue_key}/votes")
        if not isinstance(data, dict):
            return {"votes": 0, "has_voted": False}
        return {
            "votes": data.get("votes", 0),
            "has_voted": data.get("hasVoted", False),
        }

    def _fetch_transitions(self, issue_key: str) -> list[dict[str, Any]]:
        """Fetch available status transitions."""
        data = self._request("GET", f"/issue/{issue_key}/transitions")
        if not isinstance(data, dict):
            return []
        return [
            {
                "id": t.get("id"),
                "name": t.get("name"),
                "to_status": (t.get("to") or {}).get("name"),
                "to_status_category": ((t.get("to") or {}).get("statusCategory") or {}).get("name"),
                "has_screen": t.get("hasScreen", False),
                "is_global": t.get("isGlobal", False),
            }
            for t in (data.get("transitions") or [])
        ]

    def _fetch_epic(self, epic_key: str) -> dict[str, Any] | None:
        """Fetch summary detail for the linked epic."""
        try:
            data = self._request(
                "GET",
                f"/issue/{epic_key}?fields=summary,status,assignee,duedate,customfield_10011",
            )
            fields = data.get("fields", {}) or {}
            return {
                "key": data.get("key", epic_key),
                "summary": fields.get("summary", ""),
                "status": (fields.get("status") or {}).get("name", ""),
                "assignee": _person(fields.get("assignee")),
                "due_date": fields.get("duedate"),
                "epic_name": fields.get("customfield_10011"),
            }
        except Exception:  # noqa: BLE001
            return None

    # ------------------------------------------------------------------
    # Bug creation
    # ------------------------------------------------------------------

    def _fetch_bug_field_whitelist(self, project_key: str) -> dict[str, Any]:
        """Return which Bug fields the target project actually accepts.

        Returns a dict shaped like::

            {
                "fields": {"summary", "priority", "labels", "components",
                           "environment", "versions", ...},
                "severity_field_id": "customfield_10010" or None,
            }

        Built from Jira's createmeta endpoint so projects that don't expose
        a Severity custom field, or projects that have customised which
        standard fields are required vs hidden, never 400 the create call.
        Cached per-instance so back-to-back bug pushes only pay one extra
        round-trip.
        """
        cache = getattr(self, "_bug_field_cache", None)
        if cache is None:
            cache = {}
            self._bug_field_cache = cache
        cached = cache.get(project_key)
        if cached is not None:
            return cached

        accepted_ids: set[str] = set()
        severity_id: str | None = None
        try:
            safe_key = urllib.parse.quote(project_key, safe="")
            data = self._request(
                "GET",
                f"/issue/createmeta?projectKeys={safe_key}"
                f"&issuetypeNames=Bug&expand=projects.issuetypes.fields",
            )
            for proj in (data or {}).get("projects", []) or []:
                for itype in proj.get("issuetypes", []) or []:
                    if (itype.get("name") or "").lower() != "bug":
                        continue
                    for fid, meta in (itype.get("fields") or {}).items():
                        accepted_ids.add(fid)
                        if (
                            severity_id is None
                            and fid.startswith("customfield_")
                            and (meta.get("name") or "").strip().lower() == "severity"
                        ):
                            severity_id = fid
        except Exception:  # noqa: BLE001
            # createmeta requires the "Browse projects" permission, which
            # most service accounts have but is occasionally missing on
            # locked-down workspaces. When the lookup fails we leave the
            # whitelist empty and let the actual create call decide what
            # to do — the standard fields below are universally accepted
            # so the bug still lands, just without Severity.
            log.warning(
                "createmeta lookup failed for %s; will only send standard Bug fields",
                project_key,
            )

        # When createmeta couldn't enumerate the project (empty set), fall
        # back to the universally-accepted standard Bug field set. Severity
        # is intentionally absent here because it's a custom field that
        # only exists when createmeta confirmed it.
        if not accepted_ids:
            accepted_ids = {
                "summary", "issuetype", "project", "description",
                "priority", "labels", "components", "environment", "versions",
            }

        result = {"fields": accepted_ids, "severity_field_id": severity_id}
        cache[project_key] = result
        return result

    def create_bug(
        self,
        project_key: str,
        summary: str,
        description_markdown: str,
        *,
        priority: str | None = None,
        severity: str | None = None,
        components: list[str] | None = None,
        labels: list[str] | None = None,
        environment: str | None = None,
        affects_versions: list[str] | None = None,
        rich_adf: bool = True,
    ) -> dict[str, str]:
        """Create a Bug issue and return ``{key, url}``.

        Description is sent as ADF (Atlassian Document Format) so Jira
        Cloud renders it properly. When *rich_adf* is true (the default
        for the bug-report flow) we use :func:`_markdown_to_adf_rich`
        which preserves headings, pipe tables, ordered/bulleted lists,
        fenced code blocks, and bold/italic/code marks - the layout the
        Astound bug-report agent emits. Set *rich_adf* to false to fall
        back to the simple paragraph-only converter.

        Optional structured fields (priority/severity/components/labels/
        environment/affects_versions) are intersected with the project's
        Bug createmeta before being added to the payload. Anything the
        project doesn't accept is silently dropped so a missing custom
        field never breaks the push.
        """
        if rich_adf:
            description_adf = _markdown_to_adf_rich(description_markdown)
        else:
            description_adf = _markdown_to_adf(description_markdown)

        whitelist = self._fetch_bug_field_whitelist(project_key)
        accepted = whitelist["fields"]
        severity_id = whitelist["severity_field_id"]

        fields: dict[str, Any] = {
            "project": {"key": project_key},
            "summary": summary,
            "issuetype": {"name": "Bug"},
            "description": description_adf,
        }

        priority_v = (priority or "").strip()
        if priority_v and "priority" in accepted:
            fields["priority"] = {"name": priority_v}

        if components and "components" in accepted:
            cleaned = [c.strip() for c in components if (c or "").strip()]
            if cleaned:
                fields["components"] = [{"name": c} for c in cleaned]

        if labels and "labels" in accepted:
            cleaned = [l.strip() for l in labels if (l or "").strip()]
            if cleaned:
                # Jira labels can't contain spaces; collapse to underscores
                # so a typo like "needs review" doesn't 400 the request.
                fields["labels"] = [l.replace(" ", "_") for l in cleaned]

        environment_v = (environment or "").strip()
        if environment_v and "environment" in accepted:
            # Environment is plain text in most Cloud configs but ADF in
            # some — send as ADF so both shapes accept it.
            fields["environment"] = _markdown_to_adf(environment_v)

        if affects_versions and "versions" in accepted:
            cleaned = [v.strip() for v in affects_versions if (v or "").strip()]
            if cleaned:
                fields["versions"] = [{"name": v} for v in cleaned]

        severity_v = (severity or "").strip()
        if severity_v and severity_id:
            # Severity is a CUSTOM field that varies per Jira install.
            # Cloud's "Severity" custom field expects {"value": "<name>"}
            # for the standard select option shape.
            fields[severity_id] = {"value": severity_v}

        payload = {"fields": fields}
        result = self._request("POST", "/issue", payload)
        issue_key = result.get("key", "")
        return {
            "key": issue_key,
            "url": f"{self.base_url}/browse/{issue_key}",
        }

    def add_comment(self, issue_key: str, body_markdown: str) -> dict[str, Any]:
        """Post a comment on an issue. Body is converted to ADF like descriptions."""
        key = (issue_key or "").strip()
        if not key:
            raise ConnectionError("issue key is required.")
        text = (body_markdown or "").strip()
        if not text:
            raise ConnectionError("comment body is empty.")
        payload = {"body": _markdown_to_adf(text)}
        safe_key = urllib.parse.quote(key, safe="")
        result = self._request("POST", f"/issue/{safe_key}/comment", payload)
        return {
            "id": str(result.get("id", "")),
            "self": result.get("self", ""),
            "issue_key": key,
        }

    def create_issue_link(
        self,
        link_type: str,
        inward_key: str,
        outward_key: str,
    ) -> None:
        """Create a Jira issue link of *link_type* between two issues.

        Maps to ``POST /rest/api/3/issueLink``. The ``inwardIssue`` is the
        new issue (e.g. the freshly created bug) and ``outwardIssue`` is
        the ticket the user picked. Jira derives the inward/outward verb
        labels from the link type (e.g. ``Relates`` ↔ ``relates to``).

        Raises :class:`ConnectionError` on HTTP / network failure so the
        caller can surface a per-issue error without aborting the whole
        bug-creation flow.
        """
        if not link_type or not inward_key or not outward_key:
            raise ConnectionError("link_type, inward_key, and outward_key are all required.")
        payload = {
            "type": {"name": link_type},
            "inwardIssue": {"key": inward_key},
            "outwardIssue": {"key": outward_key},
        }
        self._request("POST", "/issueLink", payload)

    def create_issue(
        self,
        project_key: str,
        summary: str,
        description_markdown: str = "",
        issuetype: str = "Test",
        description_adf: dict | None = None,
    ) -> dict[str, str]:
        """Create an issue of *issuetype* (default ``Test``) and return {key, url}.

        Used by the Test Management push flow to create native Jira test issues
        when the user does not have an Xray / Zephyr Scale add-on. Falls back
        cleanly when the project does not have the requested issue type — the
        Jira REST API returns a 400 with a descriptive message that the caller
        surfaces to the UI.

        If *description_adf* is provided it is used verbatim as the issue
        description (must be a valid ADF document); otherwise the
        *description_markdown* string is converted via the lossy
        :func:`_markdown_to_adf`. Callers that need rich formatting (bold,
        headings, ordered lists, code marks) should build ADF themselves and
        pass it via *description_adf*.
        """
        payload = {
            "fields": {
                "project": {"key": project_key},
                "summary": summary,
                "issuetype": {"name": issuetype},
                "description": description_adf if description_adf is not None else _markdown_to_adf(description_markdown),
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


# ---------------------------------------------------------------------------
# Rich markdown -> ADF converter
#
# Used by the bug-report Jira push (Astound Pentair format) so headings,
# pipe tables, ordered/bulleted lists, fenced code blocks, and inline
# bold / italic / code marks survive the round-trip into the Jira
# Description field. Hand-rolled so we don't add an external dependency.
# Anything we can't parse falls back to a regular paragraph node, so the
# output is always a valid ADF document.
# ---------------------------------------------------------------------------

# Inline mark patterns - applied in this order so ``code`` wins over
# ``**bold**`` (we don't want to double-mark text inside backticks).
_RICH_INLINE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"`([^`]+)`"), "code"),
    (re.compile(r"\*\*([^*\n]+)\*\*"), "strong"),
    (re.compile(r"(?<!\*)\*([^*\n]+)\*(?!\*)"), "em"),
    (re.compile(r"\b(https?://[^\s\)\]<>]+)"), "link"),
]


def _rich_inline_text(text: str) -> list[dict[str, Any]]:
    """Convert a single line of markdown to a list of ADF inline nodes.

    Splits *text* on the inline mark patterns and emits ``text`` nodes with
    appropriate ``marks``. Plain segments produce unmarked ``text`` nodes.
    Returns ``[{"type": "text", "text": ""}]`` when *text* is empty so the
    caller can always wrap the result in a paragraph.
    """
    if not text:
        return [{"type": "text", "text": ""}]

    # Find every inline match across all patterns, then walk left-to-right
    # picking the earliest non-overlapping match each time.
    nodes: list[dict[str, Any]] = []
    cursor = 0
    while cursor < len(text):
        best: tuple[int, int, str, str] | None = None  # (start, end, mark, payload)
        for pattern, mark in _RICH_INLINE_PATTERNS:
            m = pattern.search(text, cursor)
            if not m:
                continue
            if best is None or m.start() < best[0]:
                best = (m.start(), m.end(), mark, m.group(1))
        if best is None:
            nodes.append({"type": "text", "text": text[cursor:]})
            break
        if best[0] > cursor:
            nodes.append({"type": "text", "text": text[cursor:best[0]]})
        if best[2] == "link":
            nodes.append({
                "type": "text",
                "text": best[3],
                "marks": [{"type": "link", "attrs": {"href": best[3]}}],
            })
        else:
            nodes.append({
                "type": "text",
                "text": best[3],
                "marks": [{"type": best[2]}],
            })
        cursor = best[1]

    return nodes or [{"type": "text", "text": ""}]


def _rich_paragraph(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": _rich_inline_text(text)}


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_ORDERED_RE = re.compile(r"^\s*\d+[.)]\s+(.+)$")
_BULLET_RE = re.compile(r"^\s*[-*+]\s+(.+)$")
_FENCE_RE = re.compile(r"^```(\w+)?\s*$")
_TABLE_HR_RE = re.compile(r"^\s*\|?\s*[:\-\|\s]+\s*\|?\s*$")


def _split_table_row(row: str) -> list[str]:
    """Split a markdown pipe-table row into trimmed cell strings."""
    return [c.strip() for c in row.strip().strip("|").split("|")]


def _build_table_node(headers: list[str], data_rows: list[list[str]]) -> dict[str, Any]:
    """Build an ADF table node from plain-string headers + rows."""
    def _cell(text: str, header: bool) -> dict[str, Any]:
        return {
            "type": "tableHeader" if header else "tableCell",
            "attrs": {},
            "content": [_rich_paragraph(text)],
        }

    rows: list[dict[str, Any]] = [
        {"type": "tableRow", "content": [_cell(h, header=True) for h in headers]},
    ]
    for row in data_rows:
        # Pad / trim cells so every row has the same width as the header.
        cells = list(row) + [""] * max(0, len(headers) - len(row))
        cells = cells[: len(headers)]
        rows.append({"type": "tableRow", "content": [_cell(c, header=False) for c in cells]})
    return {
        "type": "table",
        "attrs": {"isNumberColumnEnabled": False, "layout": "default"},
        "content": rows,
    }


def _list_node(kind: str, items: list[str]) -> dict[str, Any]:
    """Build an ordered or bulleted list from a list of item strings."""
    return {
        "type": "orderedList" if kind == "ordered" else "bulletList",
        "content": [
            {
                "type": "listItem",
                "content": [_rich_paragraph(it)],
            }
            for it in items
        ],
    }


def _markdown_to_adf_rich(text: str) -> dict[str, Any]:
    """Best-effort rich markdown -> ADF document.

    Handles:

    - ATX headings (`# H1` ... `### H3`)
    - Ordered / bulleted lists (consecutive `1.` / `- ` / `* ` lines)
    - Pipe tables (`| a | b |\n| --- | --- |\n| 1 | 2 |`)
    - Fenced code blocks with optional language tag
    - Inline `**bold**`, `*italic*`, `` `code` ``, and bare URLs
    - Anything else (plain prose) becomes a `paragraph` node

    Falls back to the simple :func:`_markdown_to_adf` shape on empty input
    so callers always get a valid ADF document.
    """
    if not text or not text.strip():
        return _markdown_to_adf(text or "")

    lines = text.replace("\r\n", "\n").split("\n")
    blocks: list[dict[str, Any]] = []

    i = 0
    n = len(lines)
    in_code = False
    code_lang: str | None = None
    code_buf: list[str] = []

    def _flush_code() -> None:
        nonlocal code_buf, code_lang
        if not code_buf and not code_lang:
            return
        node: dict[str, Any] = {
            "type": "codeBlock",
            "attrs": {"language": code_lang} if code_lang else {},
            "content": [{"type": "text", "text": "\n".join(code_buf)}],
        }
        blocks.append(node)
        code_buf = []
        code_lang = None

    while i < n:
        raw = lines[i]
        line = raw.rstrip()

        # Fenced code block - flush whatever we're inside until the
        # closing fence, regardless of any other syntax.
        fence = _FENCE_RE.match(line.strip())
        if fence:
            if in_code:
                _flush_code()
                in_code = False
            else:
                in_code = True
                code_lang = fence.group(1)
            i += 1
            continue
        if in_code:
            code_buf.append(raw)
            i += 1
            continue

        # Blank line - paragraph separator.
        if not line.strip():
            i += 1
            continue

        # Heading.
        h = _HEADING_RE.match(line)
        if h:
            level = min(len(h.group(1)), 6)
            blocks.append({
                "type": "heading",
                "attrs": {"level": level},
                "content": _rich_inline_text(h.group(2).strip()),
            })
            i += 1
            continue

        # Pipe table - require a separator on the next line.
        if line.lstrip().startswith("|") and i + 1 < n and _TABLE_HR_RE.match(lines[i + 1].strip()):
            headers = _split_table_row(line)
            data_rows: list[list[str]] = []
            j = i + 2
            while j < n and lines[j].lstrip().startswith("|"):
                data_rows.append(_split_table_row(lines[j]))
                j += 1
            blocks.append(_build_table_node(headers, data_rows))
            i = j
            continue

        # Ordered list (consume all consecutive ordered-list lines).
        ord_m = _ORDERED_RE.match(line)
        if ord_m:
            items: list[str] = [ord_m.group(1).strip()]
            j = i + 1
            while j < n:
                nxt = lines[j].rstrip()
                m2 = _ORDERED_RE.match(nxt)
                if m2:
                    items.append(m2.group(1).strip())
                    j += 1
                    continue
                break
            blocks.append(_list_node("ordered", items))
            i = j
            continue

        # Bulleted list.
        bul_m = _BULLET_RE.match(line)
        if bul_m:
            items = [bul_m.group(1).strip()]
            j = i + 1
            while j < n:
                nxt = lines[j].rstrip()
                m2 = _BULLET_RE.match(nxt)
                if m2:
                    items.append(m2.group(1).strip())
                    j += 1
                    continue
                break
            blocks.append(_list_node("bullet", items))
            i = j
            continue

        # Default - paragraph. Glue consecutive non-blank, non-syntactic
        # lines into one paragraph (markdown soft wraps).
        para_lines: list[str] = [line]
        j = i + 1
        while j < n:
            nxt = lines[j].rstrip()
            if not nxt.strip():
                break
            if _HEADING_RE.match(nxt) or _ORDERED_RE.match(nxt) or _BULLET_RE.match(nxt):
                break
            if _FENCE_RE.match(nxt.strip()):
                break
            if nxt.lstrip().startswith("|"):
                break
            para_lines.append(nxt)
            j += 1
        blocks.append(_rich_paragraph(" ".join(s.strip() for s in para_lines)))
        i = j

    # Close any open code block at EOF (malformed markdown but keep going).
    if in_code:
        _flush_code()

    if not blocks:
        return _markdown_to_adf(text)

    return {"version": 1, "type": "doc", "content": blocks}


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


# ---------------------------------------------------------------------------
# Full-issue extraction helpers (module-level, called from get_full_issue)
# ---------------------------------------------------------------------------

def _person(raw: Any) -> dict[str, str] | None:
    """Normalise a Jira user object to a minimal dict."""
    if not raw or not isinstance(raw, dict):
        return None
    return {
        "account_id": raw.get("accountId", ""),
        "display_name": raw.get("displayName", ""),
        "email": raw.get("emailAddress", ""),
        "avatar_url": (raw.get("avatarUrls") or {}).get("48x48", ""),
    }


def _flatten_field_value(val: Any) -> Any:
    """Flatten an arbitrary Jira field value for the ``custom_fields`` map.

    Jira returns custom-field values in a wide variety of shapes:

    * Primitives (str/int/float/bool) — passed through unchanged.
    * ADF documents (``{"type": "doc", "content": [...]}``) — flattened to
      plain text via ``_adf_to_text`` so downstream LLM seeds and the UI
      detail panel get readable content instead of nested JSON.
    * Single options (``{"value": "X"}``, ``{"name": "Y"}``) — reduced to
      the human-visible label.
    * User objects — reduced to ``displayName`` so person-typed custom
      fields don't dump avatar URLs and account IDs into the prompt.
    * Lists — flattened element-wise; if every element reduces to a string
      we join them with ``, `` for compact rendering, otherwise we keep
      the list of dicts intact for the UI to render.
    * Anything else — returned as-is so the caller can decide.
    """
    if val is None:
        return None
    if isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, dict):
        # ADF document
        if val.get("type") == "doc":
            return _adf_to_text(val)
        # Option-ish shape (single-select, radio, version, component, ...)
        for k in ("value", "name", "displayName"):
            if isinstance(val.get(k), str) and val.get(k):
                return val[k]
        # User object
        if val.get("accountId") and val.get("displayName"):
            return val.get("displayName")
        # Fall back to the raw dict so the UI can still render it
        return val
    if isinstance(val, list):
        flat = [_flatten_field_value(v) for v in val]
        if all(isinstance(x, (str, int, float, bool)) or x is None for x in flat):
            return ", ".join(str(x) for x in flat if x not in (None, ""))
        return flat
    return val


# ---------------------------------------------------------------------------
# Google Drive link detection
# ---------------------------------------------------------------------------
# Matches any docs.google.com or drive.google.com URL. Trailing punctuation
# common in prose (`,`, `.`, `)`, etc.) and angle brackets are excluded so
# we don't pull garbage chars into the captured URL.
_GDRIVE_URL_RE = re.compile(
    r"https?://(?:docs|drive)\.google\.com/[^\s\"'<>)\]]+",
    re.IGNORECASE,
)


def _scan_for_gdrive(text: Any, sink: list[str]) -> None:
    """Append every Google Drive URL found in *text* to *sink* (in-order)."""
    if not text:
        return
    if isinstance(text, str):
        for match in _GDRIVE_URL_RE.findall(text):
            sink.append(match.rstrip(".,;:"))
    elif isinstance(text, dict):
        for value in text.values():
            _scan_for_gdrive(value, sink)
    elif isinstance(text, list):
        for item in text:
            _scan_for_gdrive(item, sink)


def _extract_gdrive_links(
    core: dict[str, Any],
    comments: list[dict[str, Any]],
    remote_links: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
) -> list[str]:
    """Return unique Google Drive URLs found anywhere in the issue payload.

    Scans the issue description, every comment body, every remote link URL,
    and any attachment that looks like an external link (e.g. paperclip
    pasted as a Google Drive URL rather than an uploaded binary).
    Order is preserved from first occurrence.
    """
    sink: list[str] = []

    if isinstance(core, dict):
        _scan_for_gdrive(core.get("description"), sink)
        _scan_for_gdrive(core.get("environment"), sink)

    for comment in comments or []:
        if isinstance(comment, dict):
            _scan_for_gdrive(comment.get("body"), sink)

    for link in remote_links or []:
        if not isinstance(link, dict):
            continue
        _scan_for_gdrive(link.get("url"), sink)
        _scan_for_gdrive(link.get("title"), sink)
        _scan_for_gdrive(link.get("summary"), sink)

    for att in attachments or []:
        if not isinstance(att, dict):
            continue
        # Some teams paste Drive URLs as the "filename"/"url" of an attachment
        # link rather than uploading a binary; catch both fields.
        _scan_for_gdrive(att.get("url"), sink)
        _scan_for_gdrive(att.get("filename"), sink)

    seen: set[str] = set()
    unique: list[str] = []
    for url in sink:
        if url not in seen:
            seen.add(url)
            unique.append(url)
    return unique


def _extract_attachments(fields: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract attachment metadata from core issue fields."""
    return [
        {
            "id": att.get("id"),
            "filename": att.get("filename"),
            "author": _person(att.get("author")),
            "created": att.get("created"),
            "size": att.get("size"),
            "mime_type": att.get("mimeType"),
            "url": att.get("content"),
            "thumbnail": att.get("thumbnail"),
        }
        for att in (fields.get("attachment") or [])
    ]


def _extract_linked_issues(fields: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract issue links from core fields."""
    links = []
    for link in (fields.get("issuelinks") or []):
        link_type = (link.get("type") or {})
        if link.get("outwardIssue"):
            issue = link["outwardIssue"]
            direction = "outward"
            label = link_type.get("outward", "")
        elif link.get("inwardIssue"):
            issue = link["inwardIssue"]
            direction = "inward"
            label = link_type.get("inward", "")
        else:
            continue
        f = issue.get("fields", {}) or {}
        links.append({
            "id": link.get("id"),
            "type": link_type.get("name", ""),
            "direction": direction,
            "label": label,
            "key": issue.get("key", ""),
            "summary": f.get("summary", ""),
            "status": (f.get("status") or {}).get("name", ""),
            "priority": (f.get("priority") or {}).get("name", ""),
            "issuetype": (f.get("issuetype") or {}).get("name", ""),
            "assignee": _person(f.get("assignee")),
        })
    return links


def _extract_subtasks(fields: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract sub-tasks from core fields."""
    result = []
    for sub in (fields.get("subtasks") or []):
        sf = sub.get("fields", {}) or {}
        result.append({
            "key": sub.get("key", ""),
            "summary": sf.get("summary", ""),
            "status": (sf.get("status") or {}).get("name", ""),
            "priority": (sf.get("priority") or {}).get("name", ""),
            "issuetype": (sf.get("issuetype") or {}).get("name", ""),
            "assignee": _person(sf.get("assignee")),
        })
    return result


def _extract_sprint(fields: dict[str, Any]) -> dict[str, Any] | None:
    """Extract sprint info from customfield_10020 (Jira Software)."""
    sprint_field = fields.get("customfield_10020")
    if not sprint_field:
        return None
    # The field can be a list of sprint objects or a single object
    if isinstance(sprint_field, list):
        # Take the most recent (last) sprint
        sprint_raw = sprint_field[-1] if sprint_field else None
    elif isinstance(sprint_field, dict):
        sprint_raw = sprint_field
    else:
        return None
    if not sprint_raw or not isinstance(sprint_raw, dict):
        return None
    return {
        "id": sprint_raw.get("id"),
        "name": sprint_raw.get("name"),
        "state": sprint_raw.get("state"),
        "start_date": sprint_raw.get("startDate"),
        "end_date": sprint_raw.get("endDate"),
        "complete_date": sprint_raw.get("completeDate"),
        "goal": sprint_raw.get("goal"),
        "board_id": sprint_raw.get("boardId") or sprint_raw.get("originBoardId"),
    }


def _extract_epic_key(fields: dict[str, Any]) -> str | None:
    """Return the epic issue key from customfield_10014 (Epic Link), if present."""
    epic_link = fields.get("customfield_10014")
    if isinstance(epic_link, str) and epic_link.strip():
        return epic_link.strip()
    # Newer Jira uses parent for epics
    parent = fields.get("parent")
    if isinstance(parent, dict):
        parent_fields = parent.get("fields", {}) or {}
        if (parent_fields.get("issuetype") or {}).get("name", "").lower() == "epic":
            return parent.get("key")
    return None


def _derive_participants(
    core: dict[str, Any],
    comments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build a deduplicated participant list from all available sources."""
    seen: dict[str, dict[str, Any]] = {}

    def _add(person: dict[str, Any] | None, role: str) -> None:
        if not person:
            return
        aid = person.get("account_id", "")
        if not aid:
            return
        if aid not in seen:
            seen[aid] = {**person, "roles": [role]}
        elif role not in seen[aid]["roles"]:
            seen[aid]["roles"].append(role)

    _add(core.get("assignee"), "assignee")
    _add(core.get("reporter"), "reporter")
    _add(core.get("creator"), "creator")
    for comment in comments:
        _add(comment.get("author"), "commenter")

    return list(seen.values())
