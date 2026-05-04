export const PHASES = {
  P1: { id: 'P1', label: 'Phase 1 — Requirement Analysis', mascot: 'RequirementMascot', accent: 'from-blue-500 to-indigo-500' },
  P2: { id: 'P2', label: 'Phase 2 — Test Planning', mascot: 'PlanningMascot', accent: 'from-indigo-500 to-cyan-500' },
  P3: { id: 'P3', label: 'Phase 3 — Test Case Development', mascot: 'DesignMascot', accent: 'from-emerald-500 to-teal-500' },
  P4: { id: 'P4', label: 'Phase 4 — Test Execution', mascot: 'ExecutionMascot', accent: 'from-orange-500 to-red-500' },
  P5: { id: 'P5', label: 'Phase 5 — Test Cycle Closure', mascot: 'ClosureMascot', accent: 'from-violet-500 to-purple-600' },
}

// `primaryFieldKey` tells the unified AgentForm UI which declared field
// is the agent's main "Context" textarea — the one the redesigned form
// renders prominently above the collapsible Advanced details section
// and into which Jira imports are dropped. When absent (or when the
// resolver can't find a matching field at runtime) AgentForm falls back
// to the legacy heuristic (first textarea whose key matches
// requirement|story|description|scope|test_cases|test_cases_or_scope,
// else the first textarea, else the first non-select field).
//
// `primaryFieldByMode` lets a single agent pick a different primary
// field per QA mode or sub-mode (the Defect Reports page swaps fields
// between Title-only and Full-form, but they're never both rendered at
// the same time, so the resolver still finds a match either way).
export const AGENT_META = {
  requirement: {
    label: 'Requirements Analysis',
    phaseId: 'P1',
    icon: '📝',
    iconKey3d: 'requirement',
    gradient: 'from-blue-600 to-blue-500',
    accentText: 'text-blue-600',
    primaryFieldKey: 'user_story',
    hints: [
      'Paste the raw user story — this agent will tag objects, fields and risks for you.',
      'Use the Confidence Level footer to decide whether to ask the BA for clarifications.',
    ],
    visual: 'sparkline',
  },
  test_strategy: {
    label: 'Test Plan & Strategy',
    phaseId: 'P2',
    icon: '📋',
    iconKey3d: 'test_plan',
    gradient: 'from-cyan-500 to-teal-500',
    accentText: 'text-cyan-600',
    deprecated: true,
    hints: [
      'This agent has been merged into Test Plan & Strategy — use the Test Plan page.',
    ],
    visual: 'sparkline',
  },
  test_plan: {
    label: 'Test Plan & Strategy',
    phaseId: 'P2',
    icon: '📋',
    iconKey3d: 'test_plan',
    gradient: 'from-cyan-500 to-teal-500',
    accentText: 'text-cyan-600',
    primaryFieldKey: 'scope',
    hints: [
      'Produces both an IEEE 829 Test Strategy (Part A) and a formal Test Plan (Part B).',
      'Tip: link a Requirements Analysis run to seed the strategy with real risks.',
      'Schedule and Risk tables are emitted — export to Excel for PMO review.',
    ],
    visual: 'sparkline',
  },
  estimation: {
    label: 'Test Effort Estimation',
    phaseId: 'P2',
    icon: '📊',
    iconKey3d: 'estimation',
    gradient: 'from-toon-purple to-violet-400',
    accentText: 'text-violet-600',
    primaryFieldKey: 'test_cases',
    hints: [
      'Provide development_effort_hrs to unlock Ratio-Based estimation.',
      'Provide num_requirements to unlock Function Point + Use-Case Point estimates.',
    ],
    visual: 'technique_compare',
  },
  automation_plan: {
    label: 'Test Automation Plan',
    phaseId: 'P2',
    icon: '🤖',
    iconKey3d: 'automation_plan',
    gradient: 'from-rose-500 to-pink-500',
    accentText: 'text-rose-600',
    primaryFieldKey: 'test_cases_or_scope',
    hints: [
      'Mention Copado Robotic Testing in tools to get framework-specific guidance.',
      'ROI table is generated — share with leadership to justify automation spend.',
    ],
    visual: 'sparkline',
  },
  testcase: {
    label: 'Test Case Development',
    phaseId: 'P3',
    icon: '🧪',
    iconKey3d: 'testcase',
    gradient: 'from-toon-mint to-emerald-400',
    accentText: 'text-emerald-600',
    primaryFieldKey: 'requirements',
    hints: [
      'Each Acceptance Criterion produces multiple positive, negative and edge test cases.',
      'Step 1 always navigates to the relevant Salesforce app — automation-ready.',
    ],
    visual: 'sparkline',
  },
  test_data: {
    label: 'Test Data Preparation',
    phaseId: 'P3',
    icon: '🧬',
    iconKey3d: 'test_data',
    gradient: 'from-emerald-500 to-teal-500',
    accentText: 'text-emerald-600',
    primaryFieldKey: 'objects',
    hints: [
      'Try Account, Contact, Opportunity together — relationships are wired automatically.',
      'CSV is best for Data Loader; APEX_TESTDATA gives you a unit-test factory class.',
    ],
    visual: 'data_preview',
  },
  rtm: {
    label: 'Requirements Traceability Matrix',
    phaseId: 'P3',
    icon: '🧭',
    iconKey3d: 'rtm',
    gradient: 'from-sky-500 to-cyan-500',
    accentText: 'text-sky-600',
    primaryFieldKey: 'requirements',
    hints: [
      'Paste both requirements and test cases — coverage gaps are flagged automatically.',
      'Add defects to enable the third Defect Linkage matrix.',
    ],
    visual: 'coverage_donut',
  },
  copado_script: {
    label: 'Automation Scripts',
    phaseId: 'P3',
    icon: '⚡',
    iconKey3d: 'copado_script',
    gradient: 'from-amber-500 to-orange-600',
    accentText: 'text-amber-600',
    primaryFieldKey: 'test_cases',
    hints: [
      'Pick your framework first — Copado CRT, Playwright, Cypress, Selenium, or Robot Framework.',
      'Chain a Test Cases result so the scripts mirror your validated scenarios exactly.',
    ],
    visual: 'sparkline',
  },
  smoke: {
    label: 'Smoke Test Plan - Checklist',
    phaseId: 'P4',
    icon: '💨',
    iconKey3d: 'smoke',
    gradient: 'from-orange-400 to-toon-yellow',
    accentText: 'text-orange-600',
    primaryFieldKey: 'deployment_scope',
    hints: [
      'Login to your sandbox first to feed org_metadata for object/flow coverage.',
      'Both a checklist and a structured table are produced — export to Excel.',
    ],
    visual: 'sparkline',
  },
  regression: {
    label: 'Regression Test Plan - Checklist',
    phaseId: 'P4',
    icon: '🔄',
    iconKey3d: 'regression',
    gradient: 'from-toon-navy to-blue-700',
    accentText: 'text-blue-700',
    primaryFieldKey: 'changed_features',
    hints: [
      'List changed_features precisely — every test case will trace back to them.',
      'Cross-object relationships and bulk scenarios are auto-included.',
    ],
    visual: 'sparkline',
  },
  uat_plan: {
    label: 'UAT Plan & Sign-off',
    phaseId: 'P4',
    icon: '🤝',
    iconKey3d: 'uat_plan',
    gradient: 'from-fuchsia-500 to-pink-500',
    accentText: 'text-fuchsia-600',
    primaryFieldKey: 'business_scope',
    hints: [
      'Steps are written in business language so end-users can execute them.',
      'A sign-off sheet is included — export to PDF/Markdown for stakeholders.',
    ],
    visual: 'sparkline',
  },
  bug_report: {
    label: 'Defect Reports',
    phaseId: 'P4',
    icon: '🐛',
    iconKey3d: 'bug_report',
    gradient: 'from-toon-coral to-red-400',
    accentText: 'text-rose-600',
    // BugReports.jsx swaps between two field arrays — Title-only mode
    // exposes only `bug_title` (text input) while Full Form exposes
    // `bug_description` (textarea). The resolver matches whichever
    // exists in the current `fields` prop, so listing both keys here
    // means it always finds the right one for the rendered mode.
    primaryFieldKey: ['bug_description', 'bug_title'],
    hints: [
      'Title-only mode infers steps and severity — verify "(inferred)" sections before submission.',
      'Connect Jira to push the report directly as an issue.',
    ],
    visual: 'sparkline',
  },
  exec_report: {
    label: 'Test Execution Report',
    phaseId: 'P4',
    icon: '📈',
    iconKey3d: 'exec_report',
    gradient: 'from-orange-500 to-red-500',
    accentText: 'text-orange-600',
    // No "narrative" textarea on this agent — every primary field is
    // a count. We surface `coverage_notes` as the Context box because
    // it is the only true free-text input and it carries the seed text
    // through to the prompt. The required count fields stay in the
    // Advanced disclosure (with a "N required" badge).
    primaryFieldKey: 'coverage_notes',
    hints: [
      'Pass/Fail/Blocked counts drive the Insights tab visualisation.',
      'A Go/No-Go recommendation is generated — share daily during cycles.',
    ],
    visual: 'execution_bars',
  },
  rca: {
    label: 'Root Cause Analysis',
    phaseId: 'P5',
    icon: '🔍',
    iconKey3d: 'rca',
    gradient: 'from-rose-500 to-red-600',
    accentText: 'text-rose-600',
    primaryFieldKey: 'symptoms',
    hints: [
      'Provide recent_changes (deployments, data loads) for a sharper timeline.',
      '5-Whys + Fishbone + corrective AND preventive actions are produced.',
    ],
    visual: 'sparkline',
  },
  closure_report: {
    label: 'Test Closure Report',
    phaseId: 'P5',
    icon: '🏁',
    iconKey3d: 'closure_report',
    gradient: 'from-violet-500 to-purple-600',
    accentText: 'text-violet-600',
    primaryFieldKey: 'cycle_summary',
    hints: [
      'Paste your final metrics — Pass Rate and Automation % power the KPI tiles.',
      'Open defects with workarounds inform the Go-live recommendation.',
    ],
    visual: 'closure_kpi',
  },
  stlc_pack: {
    label: '1-click STLC Pack',
    phaseId: null,
    icon: '🚀',
    iconKey3d: 'stlc_pack',
    gradient: 'from-violet-500 to-fuchsia-500',
    accentText: 'text-fuchsia-600',
    hints: [
      'Paste a Jira ticket key (e.g. ABC-123) or a raw user story to seed the entire pack.',
      'Five core agents run end-to-end: Requirements → Plan → Cases → Execution → Closure.',
    ],
    visual: 'sparkline',
  },
}

// Order matters — the backend STLC pack runs agents in this exact sequence.
export const STLC_PACK_AGENTS = [
  'requirement',
  'test_plan',
  'testcase',
  'exec_report',
  'closure_report',
]

// Map sidebar / Hub URL paths to the canonical agent slug used by the
// admin panel's `agent_access` allow-list. Anything not in this map
// (utility tiles like /projects, /history, /admin) is excluded from
// the access check and always shown.
export const PATH_TO_AGENT = {
  '/requirements': 'requirement',
  '/test-plan': 'test_plan',
  '/testcases': 'testcase',
  '/smoke': 'smoke',
  '/regression': 'regression',
  '/bugs': 'bug_report',
  '/closure-report': 'closure_report',
  '/estimation': 'estimation',
  '/automation-plan': 'automation_plan',
  '/test-data': 'test_data',
  '/rtm': 'rtm',
  '/copado-scripts': 'copado_script',
  '/uat-plan': 'uat_plan',
  '/execution-report': 'exec_report',
  '/rca': 'rca',
  '/stlc-pack': 'stlc_pack',
}

/**
 * Return true when *user* is allowed to see the agent that backs
 * *path*. Utility paths not in PATH_TO_AGENT (Projects, History,
 * Admin, Hub) always pass — they're filtered separately by
 * is_admin / role checks.
 *
 * agent_access semantics:
 *   - null  → no restriction (default for new users)
 *   - []    → no agents allowed
 *   - [...] → only those slugs allowed
 *
 * Admins always see everything regardless of their own allow-list
 * so they can sanity-test before granting access to others.
 */
export function userCanAccessPath(user, path) {
  if (!user) return false
  if (user.is_admin) return true
  const agent = PATH_TO_AGENT[path]
  if (!agent) return true
  const allow = user.agent_access
  if (allow == null) return true
  return Array.isArray(allow) && allow.includes(agent)
}

export function getAgent(name) {
  return AGENT_META[name] || null
}

/**
 * Resolve the "Context" textarea field for an agent given the live
 * `fields` array currently rendered by the page. Matching priority:
 *   1. AGENT_META[agent].primaryFieldKey (string OR array of fallbacks);
 *      the first key that exists in `fields` wins.
 *   2. The first textarea whose key matches the legacy heuristic
 *      (requirement|story|description|scope|test_cases|test_cases_or_scope).
 *   3. The first textarea in `fields`.
 *   4. The first non-select field in `fields`.
 * Returns the matching field object or null when nothing fits.
 */
export function resolvePrimaryField(agent, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return null
  const meta = AGENT_META[agent] || {}
  const declared = meta.primaryFieldKey
  const candidates = Array.isArray(declared)
    ? declared
    : declared
      ? [declared]
      : []
  for (const key of candidates) {
    const hit = fields.find(f => f && f.key === key)
    if (hit) return hit
  }
  const textareas = fields.filter(f => f && f.type === 'textarea')
  const heuristic = textareas.find(f =>
    /requirement|story|description|scope|test_cases|test_cases_or_scope/i.test(f.key),
  )
  if (heuristic) return heuristic
  if (textareas.length > 0) return textareas[0]
  return fields.find(f => f && f.type !== 'select') || null
}

export function getPhase(phaseId) {
  return PHASES[phaseId] || null
}

export function getAgentPhase(name) {
  const a = AGENT_META[name]
  return a ? PHASES[a.phaseId] : null
}
