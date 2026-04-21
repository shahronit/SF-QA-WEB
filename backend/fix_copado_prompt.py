"""One-off script to replace the old copado_script prompt body."""

NEW_BODY = r'''### A. Copado Robotic Testing (Robot Framework + QWeb/QForce)
*Triggered when `framework` contains "Copado".*
File extension: `.robot`. Libraries: `QWeb`, `QForce`, `String`.

**Allowed keywords — use ONLY these, never invent:**

Navigation: `Appstate`, `LaunchApp`, `GoTo`, `ClickText`, `ClickText … anchor=`
Input: `TypeText`, `TypeText … anchor=`, `Picklist`, `UseModal On`, `UseModal Off`
Verification: `VerifyText`, `VerifyText … timeout=120s`, `VerifyField`, `VerifyTitle`, `IsText`, `VerifyNoText`
Utility: `Sleep`, `Set Library Search Order`, `SetConfig DefaultTimeout`, `SetConfig LineBreak`
Cleanup: `ClickText    Show more actions` → `ClickText    Delete` → `ClickText    Delete` (confirm dialog)

Test-case rules:
- `[Documentation]` and `[Tags]` required on every test.
- First keyword: `Appstate    Home` then `LaunchApp    <AppName>`.
- `UseModal    On` before any modal; `UseModal    Off` immediately after.
- Every action must be followed by a verification step — never leave an action unvalidated.
- `timeout=120s` on `VerifyText` that waits for list views or reports.

---

### B. Robot Framework + SeleniumLibrary
*Triggered when `framework` contains "SeleniumLibrary".*
File extension: `.robot`. Library: `SeleniumLibrary`.

Use: `Open Browser`, `Go To`, `Input Text`, `Click Element`, `Select From List By Label`,
`Wait Until Page Contains`, `Wait Until Element Is Visible`, `Element Should Be Visible`,
`Element Should Not Be Visible`, `Close Browser`.
Locate elements with CSS/XPath selectors stored as `*** Variables ***`.
`[Documentation]` and `[Tags]` required on every test.

---

### C. Playwright (TypeScript)
*Triggered when `framework` contains "Playwright".*
File extension: `.spec.ts`. Import: `import {{ test, expect }} from '@playwright/test';`

- `test.describe` blocks per feature / entity.
- `page.goto(loginUrl)` as first step in each test.
- Prefer role-based locators: `page.getByRole(...)`, `page.getByLabel(...)`, `page.getByText(...)`.
- Assertions: `expect(locator).toBeVisible()`, `.toHaveText(...)`, `.toHaveValue(...)`, `.toHaveURL(...)`.
- Shared login in `test.beforeEach`; extract to `helpers/auth.ts`.
- No `page.waitForTimeout()` — use `expect(locator).toBeVisible()` or `page.waitForSelector`.
- `test.afterEach` for data cleanup where applicable.

---

### D. Cypress
*Triggered when `framework` contains "Cypress".*
File extension: `.cy.ts`. Add `/// <reference types="cypress" />` at the top.

- `describe` + `it` block structure.
- `cy.visit(loginUrl)` as first command.
- Prefer `cy.contains(...)`, `cy.get('[data-testid=...]')`.
- Assertions: `.should('be.visible')`, `.should('have.text', '...')`, `.should('have.value', '...')`.
- `beforeEach` with `cy.session` for login; `afterEach` for cleanup.
- Use `cy.intercept` + `cy.wait('@alias')` instead of hard `cy.wait(ms)`.

---

### E. Selenium (Python) + pytest
*Triggered when `framework` contains "Selenium (Python)".*
File extension: `.py`. Imports: `from selenium import webdriver`, `from selenium.webdriver.common.by import By`,
`from selenium.webdriver.support.ui import WebDriverWait`, `from selenium.webdriver.support import expected_conditions as EC`, `import pytest`.

- Page Object Model — one class per page in `pages/` subdirectory.
- All waits: `WebDriverWait(driver, 10).until(EC.visibility_of_element_located((By.CSS_SELECTOR, '...')))`.
- `@pytest.fixture` for browser setup/teardown in `conftest.py`.
- Every test function prefixed `test_`.

---

### F. Pytest + Requests (API testing)
*Triggered when `framework` contains "Pytest + Requests".*
File extension: `.py`. Imports: `import requests`, `import pytest`.

- `BASE_URL` constant at top; `session` fixture in `conftest.py` handles authentication.
- Assert `response.status_code`, then assert specific JSON fields.
- Use `@pytest.mark.parametrize` for data-driven cases.

---

## Step-by-step completeness rule (CRITICAL)

1. **No ellipsis** — never write `...`, `# more steps here`, `# add your steps`, or similar placeholders. Write the actual step.
2. **No pseudocode** — every line must be a real keyword / function call / assertion using the chosen framework's API.
3. **Every assertion concrete** — specify exact text, value, or state; tag with `(inferred)` only when input is truly silent, and always provide a realistic default.
4. **Complete file structure** — Settings/imports, Variables/constants, all test cases/functions, all helper keywords/functions. Nothing omitted.

---

## Output format rules (CRITICAL — follow exactly)

Emit each file using this EXACT pattern:

### <filename>.<ext>

<One sentence description of what this file covers.>

```<language_tag>
<COMPLETE file contents — ALL sections concatenated in ONE block>
```

---

*(Repeat for the next file.)*

Anti-fragmentation rules — never break these:

1. The filename MUST be a real `###` Markdown heading. Never plain text, never inline code.
2. ALL file contents live inside ONE fenced code block per file — never split a file across multiple fences.
3. Never emit `**Setting**`, `**Variables**`, `**Test Cases**`, or `**Keywords**` outside a fenced code block.
4. Language tag per framework: `robot` for Robot Framework, `typescript` for Playwright/Cypress, `python` for Selenium/Pytest.
5. Separate files with a `---` horizontal rule placed AFTER the closing fence.

Emit the shared helper file first (`common.robot` / `helpers/auth.ts` / `conftest.py`), then each test-suite file.

At the very end, output the **Test Suite Summary Table** as a single Markdown table:

| Suite File | Test Cases | Entities / Objects Covered | Tags / Markers |
|------------|-----------|---------------------------|----------------|

End with **Confidence Level:** (Low / Medium / High) plus one sentence rationale.'''

MARKER_START = '\n---\n\n### File Structure Rules\n'
MARKER_END = 'End with **Confidence Level:** (Low / Medium / High) plus one sentence rationale.""",'

path = 'core/prompts/prompts.py'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

idx_start = content.find(MARKER_START)
idx_end = content.find(MARKER_END)

if idx_start == -1 or idx_end == -1:
    print(f'MARKERS NOT FOUND: start={idx_start}, end={idx_end}')
else:
    # Replace the old section with new body
    new_content = (
        content[:idx_start + 1]  # keep the newline before ---
        + NEW_BODY
        + '""",'
        + content[idx_end + len(MARKER_END):]
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print('Done. Replaced old copado_script body.')
    # Verify
    with open(path, 'r', encoding='utf-8') as f:
        verify = f.read()
    if 'Framework dispatch — choose EXACTLY ONE' in verify and 'File Structure Rules' not in verify:
        print('Verification PASSED.')
    else:
        print('Verification FAILED.')
