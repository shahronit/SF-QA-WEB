import { useState } from 'react'

// Format an ISO timestamp as "YYYY-MM-DD HH:MM" for the meta grid. Returns
// the raw input on parse failure so we never throw out of the panel.
export function fmtDate(iso) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return iso
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}

// Render any custom-field value (primitive, option object, ADF dict, list of
// options, etc.) as a compact, human-friendly string.
export function renderCustomFieldValue(v) {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(renderCustomFieldValue).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    if (v.value) return String(v.value)
    if (v.name) return String(v.name)
    if (v.displayName) return String(v.displayName)
    if (v.key) return String(v.key)
    try { return JSON.stringify(v) } catch { return '[object]' }
  }
  return String(v)
}

// Pull a display name from either the rich person dict (/full) or the plain
// string (/issue lite). Returns '' when nothing usable is present.
export function personName(p) {
  if (!p) return ''
  if (typeof p === 'string') return p
  if (typeof p === 'object') return p.display_name || p.displayName || p.name || ''
  return ''
}

export function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Presentational Jira ticket detail card.
 *
 * Renders the rich `/full` payload (or the lite GET /issue/{key} shape) with
 * meta grid, description, sub-tasks, linked issues, attachments, comments and
 * tenant custom fields.
 *
 * Props:
 *   - detail          : the issue payload (required). Auto-detects rich vs
 *                       lite via `detail.core` / `detail.fetch_metadata`.
 *   - compact         : when true, the card collapses to a single-row header
 *                       (key + chips + summary + chevron). Click the chevron
 *                       (or anywhere on the header strip) to expand into the
 *                       same full layout used by `compact=false`. Defaults to
 *                       false. Used by multi-import lists.
 *   - defaultExpanded : when true and `compact` is set, the card starts in
 *                       the expanded state. No-op when `compact` is false.
 *   - onRemove        : when set, a small "Remove" link appears next to the
 *                       key in the header. Use to drop an imported ticket
 *                       from the form.
 */
export default function JiraTicketCard({
  detail,
  compact = false,
  defaultExpanded = false,
  onRemove,
}) {
  const [showAllComments, setShowAllComments] = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [showAllCustom, setShowAllCustom] = useState(false)
  // Non-compact mode behaves as if always expanded so the rest of the
  // component reads from a single `showFullBody` boolean.
  const [expanded, setExpanded] = useState(defaultExpanded || !compact)
  const showFullBody = !compact || expanded

  if (!detail) return null

  const isRich = !!(detail.core || detail.fetch_metadata)
  const c = isRich ? (detail.core || {}) : detail
  const url = c.url || detail.url
  const description = (c.description || '').trim()
  // Compact-but-expanded matches the non-compact description budget so the
  // card looks pixel-identical to the closure_report preview once unfolded.
  const descLimit = !showFullBody ? 400 : 1200
  const longDesc = description.length > descLimit
  const visibleDesc = !longDesc || descExpanded ? description : `${description.slice(0, descLimit)}…`

  const subtasks = (isRich ? detail.subtasks : c.subtasks) || []
  const linkedIssues = isRich ? (detail.linked_issues || []) : []
  const attachments = isRich ? (detail.attachments || []) : []
  const allComments = isRich ? (detail.comments || []) : []
  const recentComments = showAllComments ? allComments : allComments.slice(-3)
  const sprint = isRich ? detail.sprint : null
  const epic = isRich ? detail.epic : null

  const customEntries = isRich && c.custom_fields && typeof c.custom_fields === 'object'
    ? Object.entries(c.custom_fields).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
    : []
  const visibleCustom = showAllCustom ? customEntries : customEntries.slice(0, 6)

  const metaRows = [
    ['Assignee', personName(c.assignee)],
    ['Reporter', personName(c.reporter)],
    ['Priority', c.priority],
    ['Resolution', c.resolution],
    ['Created', fmtDate(c.created)],
    ['Updated', fmtDate(c.updated)],
    ['Due', c.due_date || c.duedate],
    ['Resolved', fmtDate(c.resolution_date || c.resolutiondate)],
    ['Sprint', sprint?.name && `${sprint.name}${sprint.state ? ` (${sprint.state})` : ''}`],
    ['Epic', epic?.key && `${epic.key}${epic.summary ? ` — ${epic.summary}` : ''}`],
    ['Story Points', c.story_points],
    ['Components', c.components?.length ? c.components.join(', ') : ''],
    ['Labels', c.labels?.length ? c.labels.join(', ') : ''],
    ['Fix Versions', c.fix_versions?.length ? c.fix_versions.join(', ') : ''],
    ['Affects Versions', c.affects_versions?.length ? c.affects_versions.join(', ') : ''],
    ['Environment', c.environment],
    ['Parent', c.parent?.key && `${c.parent.key}${c.parent.summary ? ` — ${c.parent.summary}` : ''}`],
  ].filter(([, v]) => v != null && v !== '' && v !== false)

  // The chevron toggle is *only* meaningful when the card supports
  // collapsing. Non-compact callers stay clean — no extra chrome.
  const toggle = compact ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse ticket details' : 'Expand ticket details'}
      title={expanded ? 'Collapse' : 'Expand'}
      className="text-[11px] text-gray-400 hover:text-toon-blue px-1 leading-none"
    >
      <span className={`inline-block transition-transform ${expanded ? 'rotate-90' : ''}`}>▸</span>
    </button>
  ) : null

  return (
    <div className="space-y-3 text-xs">
      {/* Header strip — always visible so a collapsed compact card still
          shows enough to identify the ticket. Click anywhere on the strip
          (except the explicit Remove button) to toggle expand in compact
          mode; the chevron mirrors the same action. */}
      <div
        className={`flex items-start gap-2 flex-wrap ${compact ? 'cursor-pointer select-none' : ''}`}
        onClick={compact ? () => setExpanded(v => !v) : undefined}
        role={compact ? 'button' : undefined}
        tabIndex={compact ? 0 : undefined}
        onKeyDown={compact ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setExpanded(v => !v)
          }
        } : undefined}
      >
        {toggle}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-bold text-toon-blue hover:underline"
          >
            {c.key} ↗
          </a>
        ) : (
          <span className="text-xs font-bold text-toon-blue">{c.key}</span>
        )}
        {c.issuetype && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{c.issuetype}</span>
        )}
        {c.status && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{c.status}</span>
        )}
        {c.priority && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">{c.priority}</span>
        )}
        {/* Inline summary in collapsed compact mode so users see what's in
            the row without expanding. The non-compact / expanded path
            renders the bigger <h4> below. */}
        {compact && !expanded && c.summary && (
          <span className="text-[11px] text-toon-navy font-semibold truncate flex-1 min-w-[120px]" title={c.summary}>
            {c.summary}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="ml-auto text-[10px] text-toon-coral hover:underline font-semibold"
          >
            Remove
          </button>
        )}
      </div>

      {/* Everything below is hidden in compact-collapsed mode. */}
      {showFullBody && (
        <>
      <h4 className="text-sm font-bold text-toon-navy">{c.summary}</h4>

      {/* Meta grid */}
      {metaRows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 bg-gray-50 rounded-lg p-2 border border-gray-100">
          {metaRows.map(([label, val]) => (
            <div key={label} className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold">{label}</div>
              <div className="text-[11px] text-gray-700 truncate" title={String(val)}>{val}</div>
            </div>
          ))}
        </div>
      )}

      {/* Description */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1">Description</div>
        <pre className="text-[11px] text-gray-700 whitespace-pre-wrap bg-gray-50 p-2 rounded border border-gray-100 max-h-48 overflow-auto">
          {visibleDesc || '(no description)'}
        </pre>
        {longDesc && (
          <button
            type="button"
            onClick={() => setDescExpanded(e => !e)}
            className="text-[10px] text-toon-blue hover:underline mt-1 font-semibold"
          >
            {descExpanded ? 'Show less' : `Show full description (${description.length.toLocaleString()} chars)`}
          </button>
        )}
      </div>

      <>
          {/* Sub-tasks */}
          {subtasks.length > 0 && (
            <details className="border border-gray-100 rounded-lg" open>
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-bold text-toon-navy bg-gray-50 rounded-t-lg">
                Sub-tasks ({subtasks.length})
              </summary>
              <ul className="px-3 py-2 space-y-1">
                {subtasks.map(s => (
                  <li key={s.key} className="flex items-start gap-2">
                    <span className="text-[10px] font-bold text-toon-blue">{s.key}</span>
                    {s.status && <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-50 text-emerald-700">{s.status}</span>}
                    <span className="text-[11px] text-gray-700 flex-1">{s.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Linked issues */}
          {linkedIssues.length > 0 && (
            <details className="border border-gray-100 rounded-lg">
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-bold text-toon-navy bg-gray-50 rounded-t-lg">
                Linked issues ({linkedIssues.length})
              </summary>
              <ul className="px-3 py-2 space-y-1">
                {linkedIssues.map((l, i) => (
                  <li key={`${l.key}-${i}`} className="flex items-start gap-2">
                    <span className="text-[10px] text-gray-500 italic">{l.label || l.type || 'related to'}</span>
                    <span className="text-[10px] font-bold text-toon-blue">{l.key}</span>
                    <span className="text-[11px] text-gray-700 flex-1">{l.summary}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <details className="border border-gray-100 rounded-lg">
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-bold text-toon-navy bg-gray-50 rounded-t-lg">
                Attachments ({attachments.length})
              </summary>
              <ul className="px-3 py-2 space-y-1">
                {attachments.map((a, i) => (
                  <li key={`${a.filename || a.name}-${i}`} className="flex items-center gap-2">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noreferrer" className="text-[11px] text-toon-blue hover:underline truncate">
                        {a.filename || a.name || 'file'}
                      </a>
                    ) : (
                      <span className="text-[11px] text-gray-700 truncate">{a.filename || a.name || 'file'}</span>
                    )}
                    {a.size != null && <span className="text-[10px] text-gray-400">{fmtBytes(a.size)}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Comments */}
          {allComments.length > 0 && (
            <details className="border border-gray-100 rounded-lg" open>
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-bold text-toon-navy bg-gray-50 rounded-t-lg flex items-center justify-between">
                <span>Comments ({allComments.length})</span>
                {allComments.length > 3 && (
                  <span
                    onClick={(e) => { e.preventDefault(); setShowAllComments(s => !s) }}
                    className="text-[10px] text-toon-blue hover:underline font-semibold"
                  >
                    {showAllComments ? 'Show recent only' : `Show all ${allComments.length}`}
                  </span>
                )}
              </summary>
              <ul className="px-3 py-2 space-y-2">
                {recentComments.map((cm, i) => (
                  <li key={i} className="border-l-2 border-toon-blue/30 pl-2">
                    <div className="text-[10px] text-gray-500">
                      <span className="font-bold text-toon-navy">{personName(cm.author) || 'unknown'}</span>
                      {cm.created && <span className="ml-2">{fmtDate(cm.created)}</span>}
                    </div>
                    <pre className="text-[11px] text-gray-700 whitespace-pre-wrap mt-0.5">
                      {(cm.body || '').trim()}
                    </pre>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Custom fields */}
          {customEntries.length > 0 && (
            <details className="border border-gray-100 rounded-lg" open>
              <summary className="cursor-pointer px-2 py-1.5 text-[11px] font-bold text-toon-navy bg-gray-50 rounded-t-lg flex items-center justify-between">
                <span>Custom fields ({customEntries.length})</span>
                {customEntries.length > 6 && (
                  <span
                    onClick={(e) => { e.preventDefault(); setShowAllCustom(s => !s) }}
                    className="text-[10px] text-toon-blue hover:underline font-semibold"
                  >
                    {showAllCustom ? 'Show fewer' : `Show all ${customEntries.length}`}
                  </span>
                )}
              </summary>
              <dl className="px-3 py-2 space-y-1">
                {visibleCustom.map(([label, val]) => (
                  <div key={label} className="grid grid-cols-3 gap-2">
                    <dt className="text-[10px] uppercase tracking-wide text-gray-400 font-bold col-span-1 truncate" title={label}>{label}</dt>
                    <dd className="text-[11px] text-gray-700 col-span-2 whitespace-pre-wrap break-words">{renderCustomFieldValue(val)}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
      </>
        </>
      )}
    </div>
  )
}
