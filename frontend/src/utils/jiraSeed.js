// Helpers for turning a resolved /api/jira/import-batch response into seed
// text + actionable error messages. Lifted from frontend/src/pages/QuickPack.jsx
// so AgentForm and the QuickPack page share one canonical implementation.

// Lite-mode renderer of an issue payload into seed text. Handles both the
// rich `/full` shape (envelope with `core` etc.) and the trimmed lite shape
// returned by GET /jira/issue/{key}.
export function jiraPayloadToText(issue) {
  if (!issue) return ''
  const isRich = !!(issue.core || issue.fetch_metadata)
  const c = isRich ? (issue.core || {}) : issue
  const lines = []
  const head = `Jira ${c.issuetype || 'Issue'} ${c.key || ''}: ${c.summary || ''}`.trim()
  if (head) lines.push(head)
  const status = []
  if (c.status) status.push(`Status: ${c.status}`)
  if (c.priority) status.push(`Priority: ${c.priority}`)
  if (status.length) lines.push(status.join(' | '))
  if (c.components?.length) lines.push(`Components: ${c.components.join(', ')}`)
  if (c.labels?.length) lines.push(`Labels: ${c.labels.join(', ')}`)
  if (c.environment) lines.push(`Environment: ${c.environment}`)
  lines.push('', 'Description:', (c.description || '(no description)').trim())
  if (isRich && Array.isArray(issue.subtasks) && issue.subtasks.length) {
    lines.push('', 'Sub-tasks:')
    for (const s of issue.subtasks) {
      const bits = [s.key, s.status ? `[${s.status}]` : '', s.summary].filter(Boolean)
      lines.push(`- ${bits.join(' ')}`)
    }
  }
  return lines.join('\n')
}

// One-line summary of a child issue (epic child or project bulk import row).
// Capped at 200 chars so a 100-row project import still fits comfortably in
// a textarea without overwhelming the agents.
export function childRowLine(c) {
  const tags = [c?.issuetype, c?.status].filter(Boolean).join('/')
  const head = `- ${c?.key || '?'}${tags ? ` [${tags}]` : ''} ${c?.summary || ''}`.trim()
  return head.length > 200 ? `${head.slice(0, 197)}…` : head
}

// Compose seed text for the shared Context box (or per-agent primary
// textarea) from a batch of resolved items. Issue/Epic primaries use the
// `jiraPayloadToText` helper; epic children and project rows are rendered
// as compact `KEY [type/status] summary` lines. Sections separated by
// `\n\n---\n\n` so downstream agents see clean boundaries between tickets.
export function seedTextFromBatch(items) {
  const sections = []
  for (const item of (items || [])) {
    if (item.kind === 'project') {
      const children = item.children || []
      const lines = [`Jira Project ${item.token} — ${children.length} issue(s):`]
      for (const c of children) lines.push(childRowLine(c))
      sections.push(lines.join('\n'))
      continue
    }
    const head = item.primary ? jiraPayloadToText(item.primary) : ''
    if (item.kind === 'epic' && item.children?.length) {
      const lines = [head, '', `Epic ${item.key} child issues (${item.children.length}):`]
      for (const c of item.children) lines.push(childRowLine(c))
      sections.push(lines.filter(Boolean).join('\n'))
      continue
    }
    if (head) sections.push(head)
  }
  return sections.join('\n\n---\n\n')
}

// Pull a usable error message out of an /api/jira/import-batch response.
// The endpoint returns 200 even on per-token failure, with each failed item
// carrying an `error` string. Callers want a single short reason to put in
// a toast when NOTHING in the batch worked. Returns:
//   { reason, tokenLabel } where `reason` is human-readable and
//   `tokenLabel` is the first failing token's key (or raw token).
export function summarizeBatchError(items, tokens = []) {
  const list = items || []
  const firstFailing = list.find(i => i?.error)
  if (firstFailing) {
    return {
      reason: firstFailing.error,
      tokenLabel: firstFailing.key || firstFailing.token || tokens[0] || '(unknown)',
    }
  }
  // No explicit error string but every token classified as 'unknown' — the
  // input simply didn't look like a Jira reference.
  if (list.length && list.every(i => i?.kind === 'unknown')) {
    return {
      reason: 'Input did not match a Jira issue or project key.',
      tokenLabel: tokens[0] || '(input)',
    }
  }
  return {
    reason: 'Jira returned no detail for any of the requested keys.',
    tokenLabel: tokens[0] || '(unknown)',
  }
}
