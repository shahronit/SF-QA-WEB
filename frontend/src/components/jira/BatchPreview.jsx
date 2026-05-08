import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import JiraTicketCard from '../JiraTicketCard'

// Compact rows used by both Project and Epic children. Truncates to 10 rows
// by default with a "Show all N" toggle so a 100-issue project import
// doesn't blow out the card height.
function ChildIssueList({ items }) {
  const [showAll, setShowAll] = useState(false)
  if (!items?.length) return <div className="text-xs text-gray-400 italic">No child issues.</div>
  const visible = showAll ? items : items.slice(0, 10)
  return (
    <div className="space-y-0.5">
      {visible.map((c) => (
        <div key={c.key} className="flex items-baseline gap-2 text-xs">
          <span className="font-mono font-bold text-violet-700">{c.key}</span>
          {(c.issuetype || c.status) && (
            <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded">
              {[c.issuetype, c.status].filter(Boolean).join(' • ')}
            </span>
          )}
          <span className="truncate text-gray-700">{c.summary || ''}</span>
        </div>
      ))}
      {items.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 text-[11px] font-extrabold text-violet-600 hover:text-violet-800"
        >
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  )
}

// Compact card used when the resolved batch item has no rich primary
// payload — i.e. for project-key tokens. Mirrors `JiraTicketCard`'s header
// (key chip + remove button) without the meta grid / sub-tabs since there
// is no single "ticket" to show.
function ProjectChildrenCard({ token, kind, items, onRemove }) {
  const label = kind === 'project' ? 'Project' : 'Epic'
  return (
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex items-center gap-1 text-[11px] font-extrabold uppercase tracking-wider text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-md">
            {label}
          </span>
          <span className="font-mono font-extrabold text-toon-navy">{token}</span>
          <span className="text-xs text-gray-500">
            {items.length} issue{items.length === 1 ? '' : 's'}
          </span>
        </div>
        <ChildIssueList items={items} />
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-xs font-bold text-gray-400 hover:text-red-500 transition-colors"
          aria-label={`Remove ${token}`}
        >
          ✕
        </button>
      )}
    </div>
  )
}

// Children list rendered under an Epic's primary `JiraTicketCard`.
function EpicChildrenList({ items, epicKey }) {
  if (!items?.length) return null
  return (
    <div className="mt-3 pl-3 border-l-2 border-violet-200">
      <div className="text-[11px] font-extrabold uppercase tracking-wider text-violet-700 mb-1.5">
        Epic {epicKey} children ({items.length})
      </div>
      <ChildIssueList items={items} />
    </div>
  )
}

/**
 * Renders the imported-Jira preview area shared by QuickPack and the
 * per-agent AgentForm: one card per resolved batch item (issue / epic /
 * project). `items` is the array returned by /api/jira/import-batch
 * filtered down to entries that produced something usable.
 *
 * Props:
 *   - items:           array of resolved batch items.
 *   - onRemoveIndex:   (index) => void — slice that index out of `items`.
 *   - onClearAll:      optional () => void — when present, renders a
 *                      "Clear all" affordance above the list.
 *   - title:           optional headline shown when items.length > 1.
 *   - className:       optional outer wrapper class (defaults to a
 *                      flush-with-card layout).
 */
export default function BatchPreview({
  items = [],
  onRemoveIndex,
  onClearAll,
  title = null,
  className = '',
}) {
  if (!items.length) return null
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key="batch-preview"
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.2 }}
        className={`overflow-hidden ${className}`}
      >
        {(title || (items.length > 1 && onClearAll)) && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
              {title || `Imported ${items.length} ticket${items.length === 1 ? '' : 's'}`}
            </span>
            {items.length > 1 && onClearAll && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-[11px] text-toon-coral hover:underline font-semibold"
              >
                Clear all
              </button>
            )}
          </div>
        )}
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div
              key={`${item.token}-${idx}`}
              className="rounded-2xl border border-gray-200 bg-gray-50 p-3"
            >
              {item.primary ? (
                <JiraTicketCard
                  detail={item.primary}
                  compact
                  defaultExpanded={false}
                  onRemove={onRemoveIndex ? (() => onRemoveIndex(idx)) : undefined}
                />
              ) : (
                <ProjectChildrenCard
                  token={item.token}
                  kind={item.kind}
                  items={item.children || []}
                  onRemove={onRemoveIndex ? (() => onRemoveIndex(idx)) : undefined}
                />
              )}
              {item.kind === 'epic' && item.children?.length > 0 && (
                <EpicChildrenList items={item.children} epicKey={item.key} />
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

export { ChildIssueList, ProjectChildrenCard, EpicChildrenList }
