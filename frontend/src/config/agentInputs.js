// Centralized per-agent input field definitions.
//
// These arrays mirror the `fields=` props the per-agent pages already
// pass to `<AgentForm />` (see `frontend/src/pages/*.jsx`). They are
// the single source of truth Quick Pack uses to build per-tab Inputs
// panels and to validate "is this agent ready to run?" before bulk
// firing — so Quick Pack honours the exact same required-field rules
// every dedicated page already enforces.
//
// Field shape (subset of what AgentForm understands):
//   { key, label?, labelByMode?, hint?, type, rows?, placeholder?,
//     placeholderByMode?, options?, optionsByMode?, required?, advanced? }
//
// `required !== false && type !== 'select'` => required (matches the
// validation rule in `AgentForm.jsx` line 257). Selects are never
// required-blocking because they always default to their first option.

export const AGENT_FIELDS = {
  requirement: [
    { key: 'user_story', label: 'User story or feature description', type: 'textarea', rows: 8, placeholder: 'As a… I want… So that…' },
  ],

  test_plan: [
    {
      key: 'scope',
      labelByMode: {
        salesforce: 'Test scope (objects in scope)',
        general: 'Test scope (modules / entities)',
      },
      hint: "or pick a Jira project + sprint above and use 'Select all' / 'Use entire sprint as scope'",
      type: 'textarea',
      rows: 5,
      placeholderByMode: {
        salesforce: 'Describe features, modules, and Salesforce objects in scope...',
        general: 'Describe features, modules, and entities in scope...',
      },
    },
    {
      key: 'objectives',
      label: 'Test objectives',
      hint: 'leave blank — AI derives 3-5 SMART objectives from scope',
      type: 'textarea',
      rows: 3,
      placeholder: 'What are the goals of testing? e.g. Validate end-to-end flows, ensure data integrity...',
      required: false,
      advanced: true,
    },
    {
      key: 'constraints',
      label: 'Constraints & timelines',
      hint: 'feeds the Test Strategy schedule and risk sections',
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. 3-week timeline, 2 QA resources, sandbox-only',
        general: 'e.g. 3-week timeline, 2 QA resources, staging-only',
      },
      required: false,
      advanced: true,
    },
    {
      key: 'environments',
      label: 'Environments',
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. Dev sandbox, Full sandbox, UAT, Production',
        general: 'e.g. Dev, Staging, UAT, Production',
      },
      required: false,
      advanced: true,
    },
    {
      key: 'test_strategy_summary',
      label: 'Existing strategy summary (legacy)',
      hint: 'leave blank — AI drafts a strategy summary from scope and linked output',
      type: 'textarea',
      rows: 3,
      placeholder: 'Paste an existing strategy summary if you have one...',
      required: false,
      advanced: true,
    },
  ],

  estimation: [
    { key: 'test_cases', label: 'Test cases or scope description', type: 'textarea', rows: 6, placeholder: 'Paste test cases, user stories, or describe the testing scope here...' },
    { key: 'team_size', label: 'QA team size (headcount)', hint: 'leave blank — AI defaults to 4', type: 'text', placeholder: '2', required: false, advanced: true },
    { key: 'sprint_capacity_hrs', label: 'Hours per person per sprint', hint: 'leave blank — AI defaults to 60', type: 'text', placeholder: '40', required: false, advanced: true },
    { key: 'development_effort_hrs', label: 'Total development effort (hours) — for Ratio-Based estimation', type: 'text', placeholder: 'e.g. 500', required: false, advanced: true },
    { key: 'num_requirements', label: 'Number of requirements / use cases — for FPA & UCP estimation', hint: 'leave blank — derived from test cases', type: 'text', placeholder: 'e.g. 12', required: false, advanced: true },
  ],

  automation_plan: [
    { key: 'test_cases_or_scope', label: 'Test cases or automation scope', type: 'textarea', rows: 5, placeholder: 'Paste test cases to automate or describe the automation scope...' },
    {
      key: 'tools',
      label: 'Automation tools',
      hint: 'leave blank — AI picks a sensible default for this mode',
      type: 'text',
      placeholderByMode: {
        salesforce: 'Copado Robotic Testing, Provar, Selenium...',
        general: 'Playwright, Cypress, Robot+Selenium, Postman...',
      },
      required: false,
      advanced: true,
    },
    {
      key: 'team_skills',
      label: 'Team skills & experience',
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. 2 QA with Robot Framework, 1 SDET with Apex',
        general: 'e.g. 2 QA with Playwright, 1 SDET with Python + REST',
      },
      required: false,
      advanced: true,
    },
  ],

  testcase: [
    { key: 'requirements', label: 'Requirements or acceptance criteria', type: 'textarea', rows: 6, placeholder: 'Enter your acceptance criteria...' },
    {
      key: 'objects',
      labelByMode: {
        salesforce: 'Primary Salesforce objects',
        general: 'Primary entities / pages under test',
      },
      hint: 'leave blank — AI infers from the requirements',
      type: 'text',
      placeholderByMode: {
        salesforce: 'Lead, Opportunity, Case…',
        general: 'User, Order, Product, Cart…',
      },
      required: false,
      advanced: true,
    },
    { key: 'additional_context', label: 'Extra context', type: 'textarea', rows: 3, placeholder: 'Any additional context...', required: false, advanced: true },
  ],

  test_data: [
    {
      key: 'objects',
      labelByMode: {
        salesforce: 'Salesforce objects',
        general: 'Entities / tables to seed',
      },
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. Account, Contact, Opportunity, Custom_Object__c',
        general: 'e.g. users, orders, products, order_items',
      },
    },
    { key: 'record_count', label: 'Records per object', hint: 'leave blank — defaults to 10', type: 'text', placeholder: 'e.g. 10 (default)', required: false, advanced: true },
    {
      key: 'format',
      label: 'Output format',
      type: 'select',
      optionsByMode: {
        salesforce: ['CSV', 'SOQL_INSERT', 'JSON', 'APEX_TESTDATA'],
        general: ['CSV', 'SQL_INSERT', 'JSON'],
      },
      required: false,
      advanced: true,
    },
    { key: 'field_constraints', label: 'Field constraints', type: 'textarea', rows: 3, placeholder: 'e.g. Industry=Banking, AnnualRevenue>1000000, Stage in (Prospecting, Qualification)', required: false, advanced: true },
  ],

  rtm: [
    { key: 'requirements', label: 'Requirements / user stories', type: 'textarea', rows: 6, placeholder: 'Paste requirements here. e.g.\nREQ_001: User can log in with email and password\nREQ_002: System sends welcome email on registration' },
    { key: 'test_cases', label: 'Test cases', hint: 'leave blank — AI derives coverage from requirements + linked output', type: 'textarea', rows: 6, placeholder: 'Paste test cases here. e.g.\nTC_001: Verify successful login with valid credentials -> REQ_001\nTC_002: Verify invalid password shows error -> REQ_001', required: false, advanced: true },
    { key: 'defects', label: 'Defects', type: 'textarea', rows: 4, placeholder: 'Paste defect list. e.g.\nDEF_001: Login fails on Safari (TC_001, REQ_001)', required: false, advanced: true },
  ],

  copado_script: [
    {
      key: 'test_cases',
      label: 'Test cases / scenarios to automate',
      type: 'textarea',
      rows: 6,
      placeholder: 'Paste test case steps, acceptance criteria, or describe the scenarios to automate…',
    },
    {
      key: 'framework',
      labelByMode: {
        salesforce: 'Automation framework',
        general: 'Automation framework',
      },
      type: 'select',
      required: true,
      advanced: false,
      optionsByMode: {
        salesforce: [
          { value: 'Copado Robotic Testing (Robot Framework + QWeb/QForce)', label: 'Copado Robotic Testing — Robot Framework + QWeb/QForce (recommended for Salesforce)' },
          { value: 'Provar', label: 'Provar — dedicated Salesforce test automation (point-and-click + Apex)' },
          { value: 'UTAM (Salesforce UI Test Automation Model)', label: 'UTAM — Salesforce\'s official page-object UI framework' },
          { value: 'Playwright (TypeScript)', label: 'Playwright (TypeScript) — cross-browser, works with Lightning Experience' },
          { value: 'Cypress', label: 'Cypress — component + E2E, good Lightning support' },
          { value: 'Robot Framework + SeleniumLibrary', label: 'Robot Framework + SeleniumLibrary — keyword-driven web automation' },
          { value: 'Selenium (Java) + TestNG', label: 'Selenium (Java) + TestNG — traditional enterprise Java stack' },
          { value: 'Jest + @salesforce/lwc-jest', label: 'Jest + lwc-jest — LWC unit tests (component-level, no browser)' },
        ],
        general: [
          { value: 'Playwright (TypeScript)', label: 'Playwright (TypeScript) — recommended for modern web E2E' },
          { value: 'Cypress', label: 'Cypress — E2E + component testing' },
          { value: 'WebdriverIO (JavaScript)', label: 'WebdriverIO — flexible, supports Selenium & DevTools protocols' },
          { value: 'TestCafe', label: 'TestCafe — zero-dependency E2E, no WebDriver required' },
          { value: 'Robot Framework + SeleniumLibrary', label: 'Robot Framework + SeleniumLibrary — keyword-driven web automation' },
          { value: 'Selenium (Python) + pytest', label: 'Selenium (Python) + pytest — classic Python web automation' },
          { value: 'Pytest + Requests (API)', label: 'Pytest + Requests — REST / API functional testing' },
          { value: 'Postman / Newman (API)', label: 'Postman / Newman — collection-based API testing + CI runner' },
          { value: 'k6 (Load / Performance)', label: 'k6 — JavaScript-based load & performance testing' },
          { value: 'Appium (Mobile)', label: 'Appium — iOS / Android mobile automation' },
        ],
      },
    },
    {
      key: 'salesforce_objects',
      labelByMode: {
        salesforce: 'Salesforce objects under test',
        general: 'Entities / pages under test',
      },
      hint: 'leave blank — AI infers from the test cases',
      type: 'text',
      placeholderByMode: {
        salesforce: 'Lead, Opportunity, Account, Case…',
        general: 'User, Cart, Checkout, Order…',
      },
      required: false,
      advanced: true,
    },
    {
      key: 'login_url',
      labelByMode: {
        salesforce: 'Salesforce login URL',
        general: 'Application login URL',
      },
      type: 'text',
      placeholderByMode: {
        salesforce: 'https://yourdomain.my.salesforce.com',
        general: 'https://app.example.com',
      },
      required: false,
      advanced: true,
    },
  ],

  smoke: [
    {
      key: 'deployment_scope',
      labelByMode: {
        salesforce: 'What shipped this release? (objects, flows, profiles, components)',
        general: 'What shipped this release? (features, screens, APIs, components)',
      },
      hint:
        'AI generates production-ready smoke test cases from this scope — be specific. Every case will trace back here.',
      type: 'textarea',
      rows: 5,
      placeholderByMode: {
        salesforce:
          'e.g. New custom object Order__c, validation rule on Account.Industry, profile change for Sales Rep, LWC component on Opportunity record page…',
        general:
          'e.g. New /checkout page, updated cart API, role change for Standard User, password-reset flow…',
      },
    },
    {
      key: 'org_type',
      labelByMode: {
        salesforce: 'Where are you verifying?',
        general: 'Where are you verifying?',
      },
      type: 'select',
      optionsByMode: {
        salesforce: ['Full Sandbox', 'UAT', 'Staging', 'Production', 'Developer Sandbox'],
        general: ['Dev', 'Staging', 'UAT', 'Production'],
      },
      required: false,
      advanced: true,
    },
    {
      key: 'release_date',
      label: 'Release date',
      type: 'text',
      placeholder: 'YYYY-MM-DD',
      required: false,
      advanced: true,
    },
  ],

  regression: [
    {
      key: 'changed_features',
      labelByMode: {
        salesforce: 'What changed in this release? (objects, flows, validations, profiles)',
        general: 'What changed in this release? (features, APIs, business rules, roles)',
      },
      hint:
        'AI generates regression test cases tied 1:1 to what changed. Be specific so the suite stays focused.',
      type: 'textarea',
      rows: 4,
      placeholderByMode: {
        salesforce:
          'e.g. Updated Opportunity_Stage validation rule, refactored Account merge flow, new Apex trigger on Case…',
        general:
          'e.g. Updated checkout total calculation, refactored notification webhook, new role permission for Read-Only…',
      },
    },
    {
      key: 'impacted_areas',
      labelByMode: {
        salesforce:
          'Which other Salesforce areas might break? (related objects, flows, integrations)',
        general:
          'Which other product areas might break? (related entities, jobs, integrations)',
      },
      hint: 'leave blank — AI infers impact from what changed',
      type: 'textarea',
      rows: 3,
      placeholderByMode: {
        salesforce:
          'e.g. Account roll-up summary, Order trigger, integration to ERP, Sales Rep profile…',
        general:
          'e.g. Cart total calculation, fulfilment job, ERP webhook, Standard User permission…',
      },
      required: false,
      advanced: true,
    },
  ],

  uat_plan: [
    {
      key: 'business_scope',
      label: 'Business scope',
      type: 'textarea',
      rows: 5,
      placeholderByMode: {
        salesforce: 'Describe the business processes / features the business will validate. e.g. Lead-to-Cash, Service Console agent flow, Partner self-service onboarding...',
        general: 'Describe the business processes / features the business will validate. e.g. Order-to-Cash flow, customer support workflow, partner self-service onboarding...',
      },
    },
    {
      key: 'user_personas',
      label: 'User personas',
      hint: 'leave blank — AI derives 2-4 personas from the scope',
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. Sales Rep, Sales Manager, Service Agent, Partner Admin',
        general: 'e.g. End User, Customer Support Agent, Partner Admin',
      },
      required: false,
      advanced: true,
    },
    { key: 'acceptance_criteria', label: 'Acceptance criteria', type: 'textarea', rows: 4, placeholder: 'Paste known acceptance criteria from the user stories or business sign-off, one per line', required: false, advanced: true },
  ],

  // Quick Pack always uses the Full-form variant of bug_report so the
  // user can supply Steps / Expected / Actual when they want them; the
  // dedicated /bugs page still supports the Title-only mode.
  bug_report: [
    { key: 'bug_description', label: 'What went wrong?', type: 'textarea', rows: 4 },
    { key: 'steps', label: 'Steps to reproduce', hint: 'leave blank — AI drafts placeholder steps', type: 'textarea', rows: 4, required: false, advanced: true },
    { key: 'expected', label: 'Expected result', hint: 'leave blank — AI infers from description', type: 'textarea', rows: 2, required: false, advanced: true },
    { key: 'actual', label: 'Actual result', hint: 'leave blank — AI infers from description', type: 'textarea', rows: 2, required: false, advanced: true },
    {
      key: 'environment',
      label: 'Environment',
      type: 'select',
      optionsByMode: {
        salesforce: ['Full Sandbox', 'Partial Sandbox', 'Developer Sandbox', 'UAT', 'Production'],
        general: ['Dev', 'Staging', 'UAT', 'Production'],
      },
      required: false,
      advanced: true,
    },
  ],

  exec_report: [
    { key: 'executed', label: 'Test cases executed', type: 'text', placeholder: 'e.g. 124' },
    { key: 'passed', label: 'Passed', type: 'text', placeholder: 'e.g. 108' },
    { key: 'failed', label: 'Failed', type: 'text', placeholder: 'e.g. 12' },
    { key: 'cycle_name', label: 'Cycle name', hint: 'leave blank — AI auto-names with today\'s date', type: 'text', placeholder: 'e.g. Sprint 24 Regression, Release 2026.04 Smoke', required: false, advanced: true },
    { key: 'blocked', label: 'Blocked', hint: 'leave blank — defaults to 0', type: 'text', placeholder: 'e.g. 4', required: false, advanced: true },
    { key: 'defects_summary', label: 'Defects summary', type: 'textarea', rows: 4, placeholder: 'Paste defect IDs / titles / severity / status, one per line', required: false, advanced: true },
    {
      key: 'coverage_notes',
      label: 'Coverage notes',
      type: 'textarea',
      rows: 3,
      placeholderByMode: {
        salesforce: 'e.g. Account, Contact, Lead modules complete. Opportunity flow deferred to next cycle.',
        general: 'e.g. User, Order, Product modules complete. Checkout flow deferred to next cycle.',
      },
      required: false,
      advanced: true,
    },
  ],

  rca: [
    { key: 'symptoms', label: 'Symptoms / observations', type: 'textarea', rows: 5, placeholder: 'Describe what users see, error messages, frequency, screenshots, business impact...' },
    {
      key: 'defect_summary',
      label: 'Defect summary',
      hint: 'leave blank — AI derives a one-liner from the symptoms',
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. Opportunity stage does not auto-update after deal closure',
        general: 'e.g. Order status does not auto-update after checkout',
      },
      required: false,
      advanced: true,
    },
    {
      key: 'environment',
      label: 'Environment',
      type: 'text',
      placeholderByMode: {
        salesforce: 'e.g. Production, Sandbox UAT-2, Release 2026.04',
        general: 'e.g. Production, Staging-2, Release 2026.04',
      },
      required: false,
      advanced: true,
    },
    { key: 'recent_changes', label: 'Recent changes', type: 'textarea', rows: 4, placeholder: 'List recent deployments, config changes, data loads in the last 7 days', required: false, advanced: true },
  ],

  closure_report: [
    { key: 'cycle_summary', label: 'Cycle summary', type: 'textarea', rows: 5, placeholder: 'Describe what was tested, scope, dates, environments, team...' },
    { key: 'project_name', label: 'Project / release name', hint: 'leave blank — AI infers from cycle summary or linked output', type: 'text', placeholder: 'e.g. Release 2026.04', required: false, advanced: true },
    { key: 'metrics', label: 'Metrics', hint: 'leave blank — AI infers from linked Execution Report if present', type: 'textarea', rows: 5, placeholder: 'Planned vs executed counts, pass rate, automation %, defect counts, effort, schedule...', required: false, advanced: true },
    { key: 'open_defects', label: 'Open defects at closure', type: 'textarea', rows: 4, placeholder: 'List open defects with ID, title, severity, status, workaround', required: false, advanced: true },
    { key: 'lessons_learned', label: 'Lessons learned', type: 'textarea', rows: 4, placeholder: 'What went well, what did not, ideas for next cycle', required: false, advanced: true },
  ],
}

/**
 * Field array (verbatim) for an agent slug, or [] if unknown.
 */
export function getAgentFields(slug) {
  return AGENT_FIELDS[slug] || []
}

/**
 * Keys of the fields the dedicated page treats as REQUIRED.
 *
 * Mirrors `AgentForm.jsx` line 257:
 *   `field.required !== false && field.type !== 'select'`
 *
 * Selects are never required-blocking because they always default to
 * their first option.
 */
export function getRequiredFieldKeys(slug) {
  const fields = getAgentFields(slug)
  return fields
    .filter(f => f.required !== false && f.type !== 'select')
    .map(f => f.key)
}

/**
 * Returns true when `values` satisfies every required field for the
 * agent. Used by Quick Pack's bulk Generate to skip agents whose
 * required inputs aren't filled, and by the per-tab Generate button
 * to enable/disable itself.
 */
export function isReadyToRun(slug, values) {
  const required = getRequiredFieldKeys(slug)
  if (required.length === 0) return true
  if (!values || typeof values !== 'object') return false
  return required.every(k => {
    const v = values[k]
    return typeof v === 'string' ? v.trim().length > 0 : !!v
  })
}

/**
 * Returns the list of REQUIRED keys that are currently missing from
 * `values`. Quick Pack uses this to render a tiny "Missing: a, b, c"
 * hint inside skipped tabs.
 */
export function getMissingRequiredKeys(slug, values) {
  const required = getRequiredFieldKeys(slug)
  if (required.length === 0) return []
  const v = values || {}
  return required.filter(k => {
    const x = v[k]
    return !(typeof x === 'string' ? x.trim().length > 0 : !!x)
  })
}
