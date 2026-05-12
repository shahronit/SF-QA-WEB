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
    // `actionLabel` is the human-readable verb shown on the page's
    // primary "Generate" button (AgentForm) and on each tab's idle
    // button in QA Test Artifacts. Keep it short and noun-y
    // ("Generate Requirements", "Generate Test Cases") instead of
    // echoing the full `label` so the button never wraps in narrow
    // viewports. Added everywhere so consumers can fall back to
    // ``meta.actionLabel || 'Generate'`` without a special-case list.
    actionLabel: 'Generate Requirements',
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
    actionLabel: 'Generate Test Plan',
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
    actionLabel: 'Generate Test Plan',
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
    actionLabel: 'Generate Estimation',
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
    actionLabel: 'Generate Automation Plan',
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
    actionLabel: 'Generate Test Cases',
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
    actionLabel: 'Generate Test Data',
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
    actionLabel: 'Generate RTM',
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
    actionLabel: 'Generate Automation Scripts',
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
    actionLabel: 'Generate Smoke Test Plan',
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
    actionLabel: 'Generate Regression Plan',
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
    actionLabel: 'Generate UAT Plan',
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
    actionLabel: 'Generate Bug Report',
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
    // Manual-input dependency: a defect report is only meaningful for an
    // actual observed bug (steps to reproduce, severity, environment).
    // Seeding it from a Jira *story* would produce a fictional defect.
    // Excluded from the QuickPack / StlcPack default-selected set so the
    // user has to opt in, matching their explicit intent.
    requiresManualInput: true,
    hints: [
      'Title-only mode infers steps and severity — verify "(inferred)" sections before submission.',
      'Connect Jira to push the report directly as an issue.',
    ],
    visual: 'sparkline',
  },
  exec_report: {
    label: 'Test Execution Report',
    actionLabel: 'Generate Execution Report',
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
    // Manual-input dependency: Pass/Fail/Blocked counts only exist
    // after a real test cycle has run; a Jira story can't supply them.
    requiresManualInput: true,
    hints: [
      'Pass/Fail/Blocked counts drive the Insights tab visualisation.',
      'A Go/No-Go recommendation is generated — share daily during cycles.',
    ],
    visual: 'execution_bars',
  },
  rca: {
    label: 'Root Cause Analysis',
    actionLabel: 'Generate RCA',
    phaseId: 'P5',
    icon: '🔍',
    iconKey3d: 'rca',
    gradient: 'from-rose-500 to-red-600',
    accentText: 'text-rose-600',
    primaryFieldKey: 'symptoms',
    // Manual-input dependency: RCA needs the actual observed symptoms
    // of a failure. There's nothing in a Jira story to derive that from.
    requiresManualInput: true,
    hints: [
      'Provide recent_changes (deployments, data loads) for a sharper timeline.',
      '5-Whys + Fishbone + corrective AND preventive actions are produced.',
    ],
    visual: 'sparkline',
  },
  closure_report: {
    label: 'Test Closure Report',
    actionLabel: 'Generate Closure Report',
    phaseId: 'P5',
    icon: '🏁',
    iconKey3d: 'closure_report',
    gradient: 'from-violet-500 to-purple-600',
    accentText: 'text-violet-600',
    primaryFieldKey: 'cycle_summary',
    // Manual-input dependency: closure metrics (pass rate, automation %,
    // open defects with workarounds) come from the post-execution cycle,
    // not from a Jira story.
    requiresManualInput: true,
    hints: [
      'Paste your final metrics — Pass Rate and Automation % power the KPI tiles.',
      'Open defects with workarounds inform the Go-live recommendation.',
    ],
    visual: 'closure_kpi',
  },
  stlc_pack: {
    label: '1-click STLC Pack',
    actionLabel: 'Generate STLC Pack',
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
  // Path renamed from `/quick-pack` -> `/qa-test-artifacts` (the page is
  // now "QA Test Artifacts"). The access slug stays `quick_pack` so
  // existing per-user `agent_access` documents don't need migration.
  '/qa-test-artifacts': 'quick_pack',
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
 * Return the per-agent primary action label (e.g. "Generate Test Cases",
 * "Generate Bug Report") used by AgentForm's idle Generate button and
 * by each tab on the QA Test Artifacts page. Falls back to the generic
 * verb so callers never need to special-case unknown / pre-release
 * slugs that haven't been added to AGENT_META yet.
 */
export function getAgentActionLabel(name, fallback = 'Generate') {
  const meta = AGENT_META[name]
  return (meta && meta.actionLabel) || fallback
}

/**
 * Return the ordered list of agent slugs the Quick Pack page should
 * actually run for *user*. Filters AGENT_META by:
 *   - dropping deprecated entries (e.g. legacy `test_strategy`),
 *   - dropping composite/non-runnable agents (`stlc_pack` —
 *     it's a pipeline, not a single LLM call backed by PROMPTS_*),
 *   - intersecting with `user.agent_access` using the same semantics
 *     `userCanAccessPath` enforces (admin bypass; null = full access;
 *     [] = none; [...] = explicit allow-list).
 * Order follows the `AGENT_META` declaration order so tab strips on
 * Quick Pack read top-down through the STLC phases.
 */
export function getRunnableAgentsForUser(user) {
  if (!user) return []
  const slugs = Object.keys(AGENT_META)
  return slugs.filter(slug => {
    const meta = AGENT_META[slug]
    if (!meta) return false
    if (meta.deprecated) return false
    if (slug === 'stlc_pack') return false
    if (user.is_admin) return true
    const allow = user.agent_access
    if (allow == null) return true
    return Array.isArray(allow) && allow.includes(slug)
  })
}

/**
 * True when *slug* declares `requiresManualInput: true` in AGENT_META.
 *
 * These are agents whose primary inputs (defect repro steps, Pass/Fail
 * counts, root-cause symptoms, closure metrics) only exist after the
 * test cycle has been run by a human. Seeding them from a Jira story
 * produces fictional output, so QuickPack and StlcPack drop them from
 * the *default* selected set — the user can still opt them in via the
 * tab strip or the "All" toggle.
 */
export function agentRequiresManualInput(slug) {
  const meta = AGENT_META[slug]
  return !!(meta && meta.requiresManualInput)
}

/**
 * Filter *slugs* down to the auto-runnable subset — drops every agent
 * that declares ``requiresManualInput: true``. Used as the first-run
 * default for QuickPack and StlcPack so the bulk Generate button only
 * fires the agents the Jira context can actually feed.
 */
export function pickAutoRunnableAgents(slugs) {
  if (!Array.isArray(slugs)) return []
  return slugs.filter(s => !agentRequiresManualInput(s))
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

// Canonical STLC ordering: Requirements (P1) -> Test Planning (P2) ->
// Test Case Development (P3) -> Test Execution (P4) -> Test Cycle
// Closure (P5). Agents without a phase (composite pipelines like
// stlc_pack) sort to the end. Pure data, no React.
const _PHASE_ORDER = ['P1', 'P2', 'P3', 'P4', 'P5']

function _phaseRank(slug) {
  const phaseId = AGENT_META[slug]?.phaseId
  if (!phaseId) return _PHASE_ORDER.length
  const idx = _PHASE_ORDER.indexOf(phaseId)
  return idx === -1 ? _PHASE_ORDER.length : idx
}

/**
 * Sort *slugs* into canonical STLC order (P1 -> P5, then unphased).
 * Ties are broken by AGENT_META declaration order so the relative
 * position of agents inside the same phase (e.g. requirement vs.
 * test_plan inside P1/P2) is stable run-to-run.
 *
 * Returns a NEW array — never mutates the input. Slugs missing from
 * AGENT_META keep their original position because they don't have a
 * stable phase rank we can compare against.
 */
export function stlcOrderedAgents(slugs) {
  if (!Array.isArray(slugs)) return []
  const decl = Object.keys(AGENT_META)
  return [...slugs].sort((a, b) => {
    const pa = _phaseRank(a)
    const pb = _phaseRank(b)
    if (pa !== pb) return pa - pb
    const da = decl.indexOf(a)
    const db = decl.indexOf(b)
    if (da === -1 && db === -1) return 0
    if (da === -1) return 1
    if (db === -1) return -1
    return da - db
  })
}

/**
 * Return *slugs* reordered so the user's currently-selected subset
 * appears first (in STLC order), followed by the rest (also in STLC
 * order). Used by the QA Test Artifacts tab strip so the tabs queued
 * for bulk Generate float to the front of the strip without removing
 * the unselected ones.
 *
 * `selected` may be an Array<string> or Set<string>; both are treated
 * identically. Slugs in *selected* that aren't in *slugs* are
 * ignored. Always returns a NEW array.
 */
export function selectedFirstStlcOrder(slugs, selected) {
  if (!Array.isArray(slugs)) return []
  const sel = selected instanceof Set
    ? selected
    : new Set(Array.isArray(selected) ? selected : [])
  const inSel = stlcOrderedAgents(slugs.filter(s => sel.has(s)))
  const rest = stlcOrderedAgents(slugs.filter(s => !sel.has(s)))
  return [...inSel, ...rest]
}
