// Lightweight Jira-key detector used to short-circuit the /jira/resolve
// roundtrip on every textarea blur. Mirrors backend/core/jira_links.py.
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/

// Bare project key (no `-N` suffix). Mirrors PROJECT_KEY_RE in
// backend/routers/jira.py so token classification stays consistent on
// both sides — required by QA Workbench's multi-import field.
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]{1,9}$/

export function extractJiraKey(text) {
  if (!text || typeof text !== 'string') return null
  for (const token of text.split(/\s+/)) {
    if (token.includes('://')) {
      try {
        const url = new URL(token)
        const m = url.pathname.match(JIRA_KEY_RE)
        if (m) return m[1]
      } catch {
        // not a real URL — fall through
      }
    }
  }
  const m = text.match(JIRA_KEY_RE)
  return m ? m[1] : null
}

export function hasJiraKey(text) {
  return extractJiraKey(text) !== null
}

// Split a free-form Jira input into individual tokens. Accepts comma- or
// newline-separated values; trims whitespace and drops empty entries.
// Used by QA Workbench's multi-import field to feed /api/jira/import-batch.
export function splitJiraTokens(text) {
  if (!text || typeof text !== 'string') return []
  return text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean)
}

// Classify a single token. Returns one of:
//   { kind: 'issue',   value: 'ABC-12' }   — bare key or browse URL
//   { kind: 'project', value: 'ABC' }      — bare project key (no `-N`)
//   { kind: 'unknown', value: <input> }    — anything else
// The 'epic' kind is decided server-side after the issue has been fetched
// (we can't tell from the key alone; epics share the issue-key shape).
export function classifyJiraToken(token) {
  const trimmed = (token || '').trim()
  if (!trimmed) return { kind: 'unknown', value: '' }
  const key = extractJiraKey(trimmed)
  if (key) return { kind: 'issue', value: key }
  if (PROJECT_KEY_RE.test(trimmed)) return { kind: 'project', value: trimmed }
  return { kind: 'unknown', value: trimmed }
}
