"""Seed a handful of varied agent_run rows into Firestore for UI testing.

Used to repopulate the History page after a wipe so the user can
verify the new Jira-chip title, per-project sections, per-section
agent filters, and Custom Prompt editor without re-running every
agent by hand.

Run from the backend folder with the venv's python:

    backend\\venv\\Scripts\\python.exe scripts\\seed_history.py

Idempotency: each row carries a ``seed=True`` flag so a follow-up
``clear-seed`` mode can wipe just the seed rows without touching real
data (not implemented here -- the user clears via the UI button).
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make ``core`` importable when this script is invoked directly.
BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from core import firestore_db  # noqa: E402


# Canonical "Jira <issuetype> KEY: summary" header that the AgentForm
# writes when the user pulls context from a Jira ticket. ``extract_jira_meta``
# anchors on ``^Jira`` (MULTILINE) so the line must be at the start of a
# value within the user_input dict.
def jira_header(issuetype: str, key: str, summary: str) -> str:
    return f"Jira {issuetype} {key}: {summary}\n\n"


# Each seed row is (offset_minutes_back_from_now, record_payload).
# Timestamps are spread across roughly the last 5 days so per-project
# sections sort by most-recent activity and the "freshest section
# opens by default" logic in the UI has a clear winner.
def build_records():
    now = datetime.now(timezone.utc)

    def ts(minutes_back: int) -> str:
        return (now - timedelta(minutes=minutes_back)).isoformat()

    seed_user = "ronit.shah"

    rows = [
        # -- Project: tns_b2b_commerce (most recent activity) ---------------
        {
            "ts": ts(15),
            "agent": "testcase",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "project": "tns_b2b_commerce",
            "username": seed_user,
            "input": {
                "requirements": (
                    jira_header("Story", "TNSB2B-101", "Implement OAuth login flow")
                    + "Acceptance criteria:\n- Users can log in with Google and Microsoft\n"
                    "- Existing email/password login keeps working\n"
                    "- Failed OAuth attempts surface a clear error toast"
                ),
                "qa_mode": "salesforce",
            },
            "output": (
                "# Test Cases — OAuth Login\n\n"
                "| ID | Title | Steps | Expected |\n"
                "|----|-------|-------|----------|\n"
                "| TC-01 | Successful Google sign-in | 1. Click 'Sign in with Google'... | "
                "User lands on dashboard |\n"
                "| TC-02 | Microsoft sign-in for existing user | ... | Account auto-linked |\n"
                "| TC-03 | OAuth provider returns error | ... | Toast displayed |\n"
            ),
            "output_preview": (
                "Test Cases for OAuth Login flow covering Google, Microsoft, and error paths"
            ),
            "cache_hit": False,
            "usage": {"prompt_tokens": 1820, "completion_tokens": 950, "total_tokens": 2770},
            "repaired": False,
            "jira_key": "TNSB2B-101",
            "jira_summary": "Implement OAuth login flow",
            "seed": True,
        },
        {
            "ts": ts(45),
            "agent": "bug_report",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "project": "tns_b2b_commerce",
            "username": seed_user,
            "input": {
                "bug_description": (
                    jira_header("Bug", "TNSB2B-205", "Cart total miscalculates with coupon")
                    + "When a 10% coupon is applied to a cart that already has a "
                    "B2B contract discount, the displayed total is the pre-discount "
                    "amount minus 10% of itself instead of the contract price minus "
                    "10% of the contract price."
                ),
                "qa_mode": "salesforce",
            },
            "output": (
                "# Defect Report — TNSB2B-205\n\n"
                "**Summary:** Cart total miscalculates when a 10% coupon stacks "
                "with a B2B contract discount.\n\n"
                "**Steps to Reproduce:**\n"
                "1. Log in as a B2B contract customer.\n"
                "2. Add any contracted SKU to the cart.\n"
                "3. Apply coupon `SAVE10`.\n"
                "4. Observe the displayed total.\n\n"
                "**Expected:** Total = (contract price) * 0.9.\n"
                "**Actual:**  Total = (list price - 10% of list price)."
            ),
            "output_preview": "Defect: cart total wrong when stacking 10% coupon with B2B contract discount",
            "cache_hit": False,
            "usage": {"prompt_tokens": 980, "completion_tokens": 420, "total_tokens": 1400},
            "repaired": False,
            "jira_key": "TNSB2B-205",
            "jira_summary": "Cart total miscalculates with coupon",
            "seed": True,
        },
        {
            "ts": ts(2 * 60),
            "agent": "smoke",
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "project": "tns_b2b_commerce",
            "username": seed_user,
            "input": {
                # No Jira header anywhere -- the row should fall back to
                # the output_preview as its title in the redesigned UI.
                "requirements": (
                    "Pre-prod smoke checklist for the May 26 deployment. "
                    "Hit the storefront landing page, search box, PDP, "
                    "cart, and checkout. Verify SSO still routes to "
                    "Okta and that the order confirmation email fires."
                ),
                "qa_mode": "salesforce",
            },
            "output": (
                "# Smoke Test Plan — May 26 Deployment\n\n"
                "1. Storefront landing page loads under 2s\n"
                "2. Search returns hits for 'laptop'\n"
                "3. PDP shows price + stock\n"
                "4. Cart accepts an item\n"
                "5. Guest checkout flows to confirmation\n"
                "6. SSO redirects to Okta and back\n"
                "7. Order confirmation email arrives in mailtrap\n"
            ),
            "output_preview": (
                "Pre-prod smoke checklist covering landing, search, PDP, cart, "
                "checkout, SSO, and confirmation email"
            ),
            "cache_hit": False,
            "usage": {"prompt_tokens": 640, "completion_tokens": 310, "total_tokens": 950},
            "repaired": False,
            # No jira_key on disk -- backfill will return (None, None)
            # because the input has no canonical header. This row exercises
            # the "no Jira, use output_preview as title" branch.
            "seed": True,
        },
        {
            "ts": ts(5 * 60),
            "agent": "regression",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "project": "tns_b2b_commerce",
            "username": seed_user,
            "input": {
                # Bare key buried in prose -- no canonical header, so the
                # chip should show "TNSB2B-42" with NO summary.
                "requirements": (
                    "Regression coverage after the TNSB2B-42 patch lands. "
                    "Focus on the order management screens, since that's "
                    "what the fix touched."
                ),
                "qa_mode": "salesforce",
            },
            "output": (
                "# Regression Test Plan — Post TNSB2B-42 Patch\n\n"
                "## Order Management\n"
                "- Create order with mixed product/service lines\n"
                "- Edit order quantity after submission\n"
                "- Cancel order and verify refund queue\n"
            ),
            "output_preview": "Regression plan focused on order management screens after TNSB2B-42 patch",
            "cache_hit": False,
            "usage": {"prompt_tokens": 510, "completion_tokens": 280, "total_tokens": 790},
            "repaired": False,
            # Backfill should populate jira_key=TNSB2B-42, jira_summary=None
            "seed": True,
        },
        {
            "ts": ts(22 * 60),
            "agent": "test_strategy",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "project": "tns_b2b_commerce",
            "username": seed_user,
            "input": {
                "context": (
                    jira_header("Epic", "TNSB2B-9", "B2B storefront launch readiness")
                    + "Cross-functional QA strategy for the Q3 storefront launch. "
                    "Includes Salesforce CPQ, Commerce Cloud, and the custom "
                    "OMS bridge. Three-week test window before go-live."
                ),
                "qa_mode": "salesforce",
            },
            "output": (
                "# Test Plan & Strategy — B2B Storefront Launch\n\n"
                "## Scope\n"
                "- Salesforce CPQ quote-to-cash\n"
                "- Commerce Cloud storefront UI\n"
                "- Custom OMS bridge sync\n\n"
                "## Phases\n"
                "1. Component testing\n2. Integration testing\n3. UAT\n4. Pre-prod smoke\n"
            ),
            "output_preview": "QA strategy covering CPQ, Commerce Cloud, and the custom OMS bridge",
            "cache_hit": True,
            "usage": {"prompt_tokens": 1450, "completion_tokens": 720, "total_tokens": 2170},
            "repaired": False,
            "jira_key": "TNSB2B-9",
            "jira_summary": "B2B storefront launch readiness",
            "seed": True,
        },
        # -- Project: acme_storefront ----------------------------------------
        {
            "ts": ts(3 * 24 * 60),
            "agent": "requirement",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "project": "acme_storefront",
            "username": seed_user,
            "input": {
                "user_story": (
                    jira_header("Story", "ACME-12", "Add wishlist to product detail page")
                    + "As a shopper, I want to save products to a wishlist from the PDP "
                    "so I can revisit them later from any device."
                ),
                "qa_mode": "general",
            },
            "output": (
                "# Requirements Analysis — ACME-12\n\n"
                "## Functional Requirements\n"
                "- Wishlist toggle button on every PDP\n"
                "- Wishlists persist per authenticated user\n"
                "- Guests get a session-scoped wishlist that prompts to sign in\n\n"
                "## Non-functional\n"
                "- Add-to-wishlist round-trips in < 500ms\n"
                "- A11y: button is keyboard reachable and announces state\n"
            ),
            "output_preview": "Functional + non-functional breakdown of the wishlist user story",
            "cache_hit": False,
            "usage": {"prompt_tokens": 730, "completion_tokens": 410, "total_tokens": 1140},
            "repaired": False,
            "jira_key": "ACME-12",
            "jira_summary": "Add wishlist to product detail page",
            "seed": True,
        },
        {
            "ts": ts(4 * 24 * 60),
            "agent": "test_closure",
            "provider": "gemini",
            "model": "gemini-2.5-flash",
            "project": "acme_storefront",
            "username": seed_user,
            "input": {
                "context": (
                    "Sprint 23 (May 5 - May 19) wrap-up. 38 stories closed, "
                    "11 bugs found and fixed, 3 deferred to Sprint 24. UAT "
                    "sign-off received on May 18."
                ),
                "qa_mode": "general",
            },
            "output": (
                "# Test Closure Report — Sprint 23\n\n"
                "**Coverage:** 96% of in-sprint stories tested\n"
                "**Defects:** 11 found, 8 fixed, 3 deferred\n"
                "**UAT Sign-off:** May 18\n"
                "**Recommendation:** Approve release to production\n"
            ),
            "output_preview": "Sprint 23 wrap-up: 96% coverage, 11 bugs, 3 deferred, UAT signed off May 18",
            "cache_hit": False,
            "usage": {"prompt_tokens": 540, "completion_tokens": 260, "total_tokens": 800},
            "repaired": False,
            "seed": True,
        },
        # -- No project ------------------------------------------------------
        {
            "ts": ts(8 * 60),
            "agent": "exec_report",
            "provider": "gemini",
            "model": "gemini-2.5-pro",
            "project": None,
            "username": seed_user,
            "input": {
                "context": (
                    jira_header("Task", "GEN-9", "Compile weekly QA execution report")
                    + "Roll up across all active projects: number of test cases run, "
                    "pass/fail/blocked counts, defect inflow, and aging."
                ),
                "qa_mode": "general",
            },
            "output": (
                "# Weekly QA Execution Report\n\n"
                "## Headline\n"
                "- 412 cases executed (340 pass, 58 fail, 14 blocked)\n"
                "- 27 new defects, 19 closed\n"
                "- Average defect age trending down (4.1d -> 3.6d)\n"
            ),
            "output_preview": "Weekly execution roll-up across all active projects",
            "cache_hit": False,
            "usage": {"prompt_tokens": 880, "completion_tokens": 430, "total_tokens": 1310},
            "repaired": False,
            "jira_key": "GEN-9",
            "jira_summary": "Compile weekly QA execution report",
            "seed": True,
        },
    ]
    return rows


def main():
    if not firestore_db.is_enabled():
        print("Firestore is not enabled in settings; nothing to seed.")
        return 1
    db = firestore_db.get_db()
    rows = build_records()
    for r in rows:
        db.collection(firestore_db.AGENT_RUNS).add(r)
        proj = r.get("project") or "(no project)"
        print(f"  + {r['ts']}  {r['agent']:<15}  {proj}")
    print(f"\nSeeded {len(rows)} rows into agent_runs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
