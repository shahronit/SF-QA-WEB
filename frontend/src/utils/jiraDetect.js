// Lightweight Jira-key detector used to short-circuit the /jira/resolve
// roundtrip on every textarea blur. Mirrors backend/core/jira_links.py.
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/

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
