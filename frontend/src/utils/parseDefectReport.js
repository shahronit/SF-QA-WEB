// Markdown -> structured defect-report extractor.
//
// The bug_report agent emits an Astound-format markdown blob that starts
// with a single H1 (the human-readable defect title), followed by a
// metadata pipe-table, the Pentair description block, and a paste-ready
// fenced JIRA section. Both the Defect Card on the report panel and the
// JiraBugPush modal need the same parsed view, so this helper lives
// outside both components.
//
// Output shape:
//
//   {
//     title:           string,                       // first H1, fallback
//     metadata:        Record<string, string>,       // lowercased key -> value
//     priority:        string,                       // canonical (e.g. "High")
//     severity:        string,                       // canonical (e.g. "Major")
//     components:      string[],                     // split on commas
//     labels:          string[],                     // split on commas
//     environment:     string,
//     affectsVersions: string[],                     // split on commas
//     linkedStory:     string,                       // ABC-123 or ""
//     reporter:        string,
//     assignee:        string,
//     sprint:          string,
//     description:     {
//       steps:        string[],
//       expected:     string,
//       actual:       string,
//       additional:   string,
//     },
//     rationale:       string,                       // joined Section 4 quotes
//     jiraFenced:      string,                       // Section 5 paste-ready
//   }
//
// All fields are guaranteed to exist; values default to "" / [] when the
// source is missing or marked with the literal "-" placeholder.

const DASH_VALUES = new Set(['', '-', '–', '—', 'n/a', 'na', 'none', 'null'])

const PRIORITY_CANONICAL = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  med: 'Medium',
  low: 'Low',
  lowest: 'Lowest',
  // Old-school terms map to the closest standard rung so the chip still
  // renders even if the agent slipped to legacy vocabulary.
  blocker: 'Highest',
  critical: 'High',
  major: 'High',
  minor: 'Low',
  trivial: 'Lowest',
}

const SEVERITY_CANONICAL = {
  blocker: 'Critical',
  critical: 'Critical',
  major: 'Major',
  high: 'Major',
  medium: 'Minor',
  minor: 'Minor',
  low: 'Minor',
  trivial: 'Trivial',
  cosmetic: 'Trivial',
}

function isDash(v) {
  return DASH_VALUES.has(String(v || '').trim().toLowerCase())
}

function csv(value) {
  if (!value || isDash(value)) return []
  return String(value)
    .split(/[,;]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !isDash(s))
}

function canonical(map, value) {
  if (!value || isDash(value)) return ''
  const key = String(value).trim().toLowerCase().replace(/[^a-z]/g, '')
  return map[key] || String(value).trim()
}

// Extract the title from the first H1, falling back to the first non-empty
// line so a stray model that drops the H1 still produces a readable title
// (the validator catches missing H1s and triggers auto-repair, but this
// keeps the UI from rendering nothing in the meantime).
function extractTitle(lines) {
  for (const ln of lines) {
    const m = ln.match(/^#\s+(.+?)\s*$/)
    if (m) return m[1].trim()
  }
  for (const ln of lines) {
    const s = ln.trim()
    if (!s) continue
    // Skip the atom-tagged Section 1 sentence — it has parenthetical
    // letter tags that look noisy as a title.
    if (/^\d+\.\s/.test(s)) continue
    if (/^(?:#{2,}|\||```|>|\*\s|-\s)/.test(s)) continue
    return s.replace(/[#*_`>]/g, '').trim()
  }
  return ''
}

// Walk pipe-table rows, returning a lowercased-key dict. Skips header
// (`| Field | Value |`) and divider (`|---|---|`) rows automatically.
function extractMetadata(text) {
  const out = {}
  const re = /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm
  let m
  while ((m = re.exec(text)) !== null) {
    const key = m[1].trim()
    const value = m[2].trim()
    if (!key || /^-+$/.test(key) || /^[-:\s]+$/.test(value)) continue
    if (key.toLowerCase() === 'field' && value.toLowerCase() === 'value') continue
    if (isDash(value)) {
      out[key.toLowerCase()] = ''
      continue
    }
    out[key.toLowerCase()] = value
  }
  return out
}

// Split the Pentair description block on its bold subheaders. We capture
// everything between `**Steps to reproduce:**` and the next bold subheader
// (or the start of Section 4), then strip leading bullets / numbering.
function extractDescription(text) {
  const headers = [
    { key: 'steps', re: /\*\*Steps to reproduce:\*\*/i },
    { key: 'actual', re: /\*\*Actual results?:\*\*/i },
    { key: 'expected', re: /\*\*Expected results?:\*\*/i },
    { key: 'additional', re: /\*\*Additional information:\*\*/i },
  ]
  // Build an index of where each header starts; a header that doesn't
  // appear has index -1 and is skipped.
  const positions = headers
    .map(h => {
      const m = h.re.exec(text)
      return m ? { key: h.key, start: m.index, headerEnd: m.index + m[0].length } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
  // Stop boundary is the start of Section 4 (Priority & Severity rationale)
  // or Section 5 (JIRA paste-ready), whichever comes first.
  const stopMatch = text.match(/^###\s*(?:4\.|5\.)/m)
  const stopAt = stopMatch ? text.indexOf(stopMatch[0]) : text.length

  const out = { steps: [], expected: '', actual: '', additional: '' }
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i]
    const next = positions[i + 1]
    const sliceEnd = Math.min(next ? next.start : stopAt, stopAt)
    const body = text.slice(cur.headerEnd, sliceEnd).trim()
    if (cur.key === 'steps') {
      out.steps = body
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(Boolean)
        // Strip leading "1. " / "1) " / "- " markers so the UI can re-emit
        // them as a real <ol>.
        .map(l => l.replace(/^(?:\d+[.)]|[-*])\s*/, '').trim())
        .filter(Boolean)
    } else {
      out[cur.key] = body
        .split(/\r?\n/)
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean)
        .join('\n')
    }
  }
  return out
}

// Section 4 is "Priority & Severity rationale" — typically a blockquote.
function extractRationale(text) {
  const m = text.match(/###\s*4\.[^\n]*\n([\s\S]*?)(?=\n###\s*5\.|\n*$)/)
  if (!m) return ''
  return m[1]
    .split(/\r?\n/)
    .map(l => l.replace(/^>\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
}

// Section 5 paste-ready fenced block. Returns the inner contents only
// (without the surrounding ``` fences) so the modal can show it raw.
function extractJiraFenced(text) {
  const m = text.match(/###\s*5\.[^\n]*\n[\s\S]*?```([\s\S]*?)```/)
  if (!m) return ''
  return m[1].trim()
}

export function parseDefectReport(markdown) {
  const text = markdown || ''
  const lines = text.split(/\r?\n/)
  const title = extractTitle(lines)
  const metadata = extractMetadata(text)
  const description = extractDescription(text)
  const rationale = extractRationale(text)
  const jiraFenced = extractJiraFenced(text)

  const priority = canonical(PRIORITY_CANONICAL, metadata['priority'])
  const severity = canonical(SEVERITY_CANONICAL, metadata['severity'])
  const components = csv(metadata['component'] || metadata['components'])
  const labels = csv(metadata['labels'] || metadata['label'])
  const affectsVersions = csv(
    metadata['affects version']
      || metadata['affects versions']
      || metadata['build / version']
      || metadata['build/version']
      || metadata['version']
  )
  const linkedRaw = (metadata['linked story'] || '').trim()
  const linkedStory = /^[A-Z][A-Z0-9_]+-\d+$/i.test(linkedRaw)
    ? linkedRaw.toUpperCase()
    : ''

  return {
    title,
    metadata,
    priority,
    severity,
    components,
    labels,
    environment: metadata['environment'] || '',
    affectsVersions,
    linkedStory,
    reporter: metadata['reporter'] || '',
    assignee: metadata['assignee'] || '',
    sprint: metadata['sprint'] || '',
    browser: metadata['browser / device'] || metadata['browser/device'] || metadata['browser'] || '',
    project: metadata['project'] || '',
    description,
    rationale,
    jiraFenced,
  }
}

// Re-build a clean Description markdown for the Jira push body — only the
// Pentair sections, no metadata table, no rationale, no fenced block.
// Keeps Jira Description focused on Steps / Expected / Actual / Additional
// since the structured fields are now lifted to real Jira properties.
export function buildJiraDescription(parsed) {
  const blocks = []
  if (parsed.description.steps.length) {
    blocks.push('**Steps to reproduce:**')
    blocks.push(parsed.description.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'))
  }
  if (parsed.description.actual) {
    blocks.push('**Actual results:**')
    blocks.push(parsed.description.actual)
  }
  if (parsed.description.expected) {
    blocks.push('**Expected results:**')
    blocks.push(parsed.description.expected)
  }
  if (parsed.description.additional) {
    blocks.push('**Additional information:**')
    blocks.push(parsed.description.additional)
  }
  return blocks.join('\n\n').trim()
}
