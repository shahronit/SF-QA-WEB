export const PHASES = {
  P1: { id: 'P1', label: 'Phase 1 — Requirement Analysis', mascot: 'RequirementMascot', accent: 'from-blue-500 to-indigo-500' },
  P2: { id: 'P2', label: 'Phase 2 — Test Planning', mascot: 'PlanningMascot', accent: 'from-indigo-500 to-cyan-500' },
  P3: { id: 'P3', label: 'Phase 3 — Test Case Development', mascot: 'DesignMascot', accent: 'from-emerald-500 to-teal-500' },
  P4: { id: 'P4', label: 'Phase 4 — Test Execution', mascot: 'ExecutionMascot', accent: 'from-orange-500 to-red-500' },
  P5: { id: 'P5', label: 'Phase 5 — Test Cycle Closure', mascot: 'ClosureMascot', accent: 'from-violet-500 to-purple-600' },
}

export const AGENT_META = {
  requirement: {
    label: 'Requirements Analysis',
    phaseId: 'P1',
    icon: '📝',
    gradient: 'from-blue-600 to-blue-500',
    accentText: 'text-blue-600',
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
    gradient: 'from-cyan-500 to-teal-500',
    accentText: 'text-cyan-600',
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
    gradient: 'from-toon-purple to-violet-400',
    accentText: 'text-violet-600',
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
    gradient: 'from-rose-500 to-pink-500',
    accentText: 'text-rose-600',
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
    gradient: 'from-toon-mint to-emerald-400',
    accentText: 'text-emerald-600',
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
    gradient: 'from-emerald-500 to-teal-500',
    accentText: 'text-emerald-600',
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
    gradient: 'from-sky-500 to-cyan-500',
    accentText: 'text-sky-600',
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
    gradient: 'from-amber-500 to-orange-600',
    accentText: 'text-amber-600',
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
    gradient: 'from-orange-400 to-toon-yellow',
    accentText: 'text-orange-600',
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
    gradient: 'from-toon-navy to-blue-700',
    accentText: 'text-blue-700',
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
    gradient: 'from-fuchsia-500 to-pink-500',
    accentText: 'text-fuchsia-600',
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
    gradient: 'from-toon-coral to-red-400',
    accentText: 'text-rose-600',
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
    gradient: 'from-orange-500 to-red-500',
    accentText: 'text-orange-600',
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
    gradient: 'from-rose-500 to-red-600',
    accentText: 'text-rose-600',
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
    gradient: 'from-violet-500 to-purple-600',
    accentText: 'text-violet-600',
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

export function getAgent(name) {
  return AGENT_META[name] || null
}

export function getPhase(phaseId) {
  return PHASES[phaseId] || null
}

export function getAgentPhase(name) {
  const a = AGENT_META[name]
  return a ? PHASES[a.phaseId] : null
}
