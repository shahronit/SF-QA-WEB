"""Fetch live Salesforce org metadata and return as structured text for agent input."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


LOGIN_PRODUCTION = "Production (login.salesforce.com)"
LOGIN_SANDBOX = "Sandbox (test.salesforce.com)"
LOGIN_CUSTOM = "Custom Domain"

_LOGIN_URLS = {
    LOGIN_PRODUCTION: "https://login.salesforce.com",
    LOGIN_SANDBOX: "https://test.salesforce.com",
}

_SOAP_LOGIN_BODY = """\
<?xml version="1.0" encoding="utf-8"?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema"
              xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
              xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>{username}</n1:username>
      <n1:password>{password}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>"""


class SFOrgFetcher:
    """Connect to a Salesforce org and return metadata as a text summary (no file I/O).

    Authentication uses the SOAP login API so **no Connected App** (client ID /
    secret) is required — only username, password, and security token.
    """

    def __init__(
        self,
        username: str,
        password: str,
        security_token: str = "",
        login_type: str = LOGIN_PRODUCTION,
        custom_domain: str = "",
    ) -> None:
        self.username = username
        self.password = password
        self.security_token = security_token
        self.login_type = login_type
        self.custom_domain = custom_domain.strip().rstrip("/")
        self.access_token: str | None = None
        self.instance_url: str = ""
        self.org_id: str = ""

    def _login_url(self) -> str:
        """Resolve the SOAP login endpoint base URL."""
        if self.login_type == LOGIN_CUSTOM and self.custom_domain:
            domain = self.custom_domain
            if not domain.startswith("https://"):
                domain = f"https://{domain}"
            return domain
        return _LOGIN_URLS.get(self.login_type, "https://login.salesforce.com")

    def authenticate(self) -> bool:
        """SOAP partner-API login. Returns True on success.

        No Connected App is needed — this uses the standard SOAP endpoint
        that every Salesforce org exposes out of the box.
        """
        body = _SOAP_LOGIN_BODY.format(
            username=_xml_escape(self.username),
            password=_xml_escape(f"{self.password}{self.security_token}"),
        )
        url = f"{self._login_url()}/services/Soap/u/59.0"
        req = urllib.request.Request(url, data=body.encode("utf-8"), method="POST")
        req.add_header("Content-Type", "text/xml; charset=utf-8")
        req.add_header("SOAPAction", "login")
        try:
            with urllib.request.urlopen(req) as resp:
                xml = resp.read().decode("utf-8")
                self.access_token = _xml_tag(xml, "sessionId")
                server_url = _xml_tag(xml, "serverUrl")
                self.instance_url = server_url.split("/services/")[0] if server_url else ""
                self.org_id = _xml_tag(xml, "organizationId") or ""
                if not self.access_token:
                    raise ConnectionError("Login succeeded but no sessionId returned.")
                return True
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode() if exc.fp else ""
            msg = _xml_tag(err_body, "faultstring") or err_body[:400]
            raise ConnectionError(f"Salesforce login failed: {msg}") from exc
        except urllib.error.URLError as exc:
            raise ConnectionError(f"Salesforce login failed: {exc}") from exc

    def _api_get(self, endpoint: str) -> dict[str, Any]:
        """Authenticated GET to the Salesforce REST API."""
        if not self.access_token:
            raise RuntimeError("Not authenticated -- call authenticate() first")
        url = f"{self.instance_url}{endpoint}"
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {self.access_token}")
        req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())

    def _fetch_objects(self) -> list[str]:
        """Return names of queryable standard + custom objects."""
        data = self._api_get("/services/data/v59.0/sobjects/")
        return sorted(
            obj["name"]
            for obj in data.get("sobjects", [])
            if obj.get("queryable") and (obj.get("custom") or obj["name"] in _CORE_OBJECTS)
        )

    def _fetch_validation_rules(self) -> list[dict[str, str]]:
        """Return active validation rules (object, name, description)."""
        query = (
            "SELECT+EntityDefinition.QualifiedApiName,ValidationName,"
            "Description,Active+FROM+ValidationRule+WHERE+Active=true"
        )
        try:
            data = self._api_get(f"/services/data/v59.0/tooling/query/?q={query}")
            return [
                {
                    "object": r.get("EntityDefinition", {}).get("QualifiedApiName", ""),
                    "name": r.get("ValidationName", ""),
                    "description": r.get("Description") or "",
                }
                for r in data.get("records", [])
            ]
        except Exception:  # noqa: BLE001
            return []

    def _fetch_flows(self) -> list[dict[str, str]]:
        """Return active flows (label, type, description)."""
        query = (
            "SELECT+MasterLabel,Description,ProcessType,Status"
            "+FROM+FlowDefinition+WHERE+ActiveVersionId!=null"
        )
        try:
            data = self._api_get(f"/services/data/v59.0/tooling/query/?q={query}")
            return [
                {
                    "label": r.get("MasterLabel", ""),
                    "type": r.get("ProcessType", ""),
                    "description": r.get("Description") or "",
                }
                for r in data.get("records", [])
            ]
        except Exception:  # noqa: BLE001
            return []

    def _fetch_profiles_and_perms(self) -> dict[str, list[str]]:
        """Return profile names and permission set names."""
        result: dict[str, list[str]] = {"profiles": [], "permission_sets": []}
        try:
            prof = self._api_get("/services/data/v59.0/query/?q=SELECT+Name+FROM+Profile")
            result["profiles"] = sorted(r["Name"] for r in prof.get("records", []))
        except Exception:  # noqa: BLE001
            pass
        try:
            perm = self._api_get(
                "/services/data/v59.0/query/?q=SELECT+Label+FROM+PermissionSet"
                "+WHERE+IsOwnedByProfile=false"
            )
            result["permission_sets"] = sorted(
                r.get("Label", r.get("Name", "")) for r in perm.get("records", [])
            )
        except Exception:  # noqa: BLE001
            pass
        return result

    def org_label(self) -> str:
        """Human-readable label for the connected org (available after auth)."""
        url = self.instance_url
        if "--" in url:
            parts = url.split("//", 1)[-1].split(".")
            return parts[0].replace("--", " / ")
        return url.split("//", 1)[-1].split(".")[0] if url else "unknown"

    def is_sandbox(self) -> bool:
        """Best-effort check whether the connected org is a sandbox."""
        lower = self.instance_url.lower()
        return "sandbox" in lower or "--" in lower or ".cs" in lower

    def fetch_summary(self) -> str:
        """Authenticate then pull key metadata and return a single text block.

        Raises on auth failure; individual section failures are silently skipped
        so a partial summary is still useful.
        """
        self.authenticate()

        env_tag = "Sandbox" if self.is_sandbox() else "Production"
        sections: list[str] = [
            f"=== SALESFORCE ORG METADATA ===",
            f"**Connected to:** {self.instance_url} ({env_tag})",
        ]

        objects = self._fetch_objects()
        if objects:
            sections.append(f"**Objects ({len(objects)}):** {', '.join(objects)}")

        rules = self._fetch_validation_rules()
        if rules:
            lines = [f"  - {r['object']}.{r['name']}: {r['description']}" for r in rules[:60]]
            sections.append(f"**Validation Rules ({len(rules)}):**\n" + "\n".join(lines))

        flows = self._fetch_flows()
        if flows:
            lines = [f"  - {f['label']} ({f['type']}): {f['description']}" for f in flows[:60]]
            sections.append(f"**Flows ({len(flows)}):**\n" + "\n".join(lines))

        pp = self._fetch_profiles_and_perms()
        if pp["profiles"]:
            sections.append(f"**Profiles ({len(pp['profiles'])}):** {', '.join(pp['profiles'])}")
        if pp["permission_sets"]:
            sections.append(
                f"**Permission Sets ({len(pp['permission_sets'])}):** "
                f"{', '.join(pp['permission_sets'][:40])}"
            )

        sections.append("=== END ORG METADATA ===")
        return "\n\n".join(sections)


_CORE_OBJECTS = frozenset({
    "Account", "Contact", "Lead", "Opportunity", "Case", "Task", "Event",
    "Campaign", "Contract", "Order", "Product2", "Pricebook2",
    "PricebookEntry", "Quote", "User", "Profile", "PermissionSet",
    "ContentDocument", "ContentVersion", "EmailMessage", "FeedItem",
})


def _xml_escape(text: str) -> str:
    """Escape special chars for safe XML embedding."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _xml_tag(xml: str, tag: str) -> str:
    """Extract the text content of the first occurrence of *tag* from raw XML."""
    match = re.search(rf"<[^>]*{re.escape(tag)}[^>]*>([^<]+)</", xml)
    return match.group(1) if match else ""
