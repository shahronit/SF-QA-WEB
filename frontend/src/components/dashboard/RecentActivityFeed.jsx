import { useNavigate } from 'react-router-dom'
import { AGENT_META, PATH_TO_AGENT } from '../../config/agentMeta'
import { useJira } from '../../context/JiraContext'

const AGENT_TO_PATH = Object.fromEntries(
  Object.entries(PATH_TO_AGENT).map(([path, slug]) => [slug, path]),
)

function fmtTs(ts) {
  if (!ts) return ''
  // ISO -> "YYYY-MM-DD HH:MM" (UTC). Keeps rows narrow without losing
  // enough resolution to disambiguate same-day events.
  return String(ts).slice(0, 16).replace('T', ' ')
}

function labelFor(slug) {
  if (!slug || slug === '(unknown)') return 'Other'
  return AGENT_META[slug]?.label || slug
}

function Pill({ children, tone }) {
  const tones = {
    run: 'bg-toon-blue/10 text-toon-blue border-toon-blue/20',
    bug: 'bg-toon-coral/10 text-toon-coral border-toon-coral/20',
    comment: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${tones[tone] || tones.run}`}>
      {children}
    </span>
  )
}

/**
 * Mixed feed of every agent run + Jira push the calling user produced
 * in the selected window. Rows are clickable — runs and comments open
 * the source agent's page; Jira bugs open the issue itself in a new
 * tab so the user can review what they pushed.
 *
 * Scoped strictly to the calling user at the backend (storage-layer
 * ``where("username", "==", me)`` query), so the list only ever
 * contains the caller's records — no need for a client-side filter.
 *
 * The full list (capped only by the backend's per-user storage read
 * limit) is rendered inside a scrollable container so the user can
 * audit every action they took this window, not just the last 10.
 */
export default function RecentActivityFeed({ rows = [] }) {
  const nav = useNavigate()
  const { jiraUrl } = useJira()

  if (!rows || rows.length === 0) {
    return (
      <div className="toon-card !p-4">
        <div className="font-bold text-toon-navy text-sm mb-1">Recent activity</div>
        <div className="text-xs text-gray-400 italic">
          Every agent run and Jira push you make in this window will appear here.
        </div>
      </div>
    )
  }

  const openRow = (row) => {
    if (row.kind === 'jira' && row.issue_key && jiraUrl) {
      const base = jiraUrl.replace(/\/+$/, '')
      window.open(`${base}/browse/${row.issue_key}`, '_blank', 'noopener')
      return
    }
    const path = AGENT_TO_PATH[row.agent]
    if (path) nav(path)
  }

  // Split totals across the three kinds so the header counter
  // matches what the user sees on the KPI tiles. Cheap to compute
  // even for thousands of rows.
  const runCount = rows.filter(r => r.kind === 'run').length
  const bugCount = rows.filter(r => r.kind === 'jira' && r.subkind === 'bug').length
  const commentCount = rows.filter(r => r.kind === 'jira' && r.subkind === 'comment').length

  return (
    <div className="toon-card !p-4">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <div className="font-bold text-toon-navy text-sm">
            Your activity in this window
          </div>
          <div className="text-[11px] text-gray-500">
            Every action you took, newest first. Click a row to jump back to the agent or open the Jira issue.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold whitespace-nowrap">
          <span className="px-2 py-0.5 rounded-full bg-toon-blue/10 text-toon-blue border border-toon-blue/20 tabular-nums">
            {runCount} run{runCount === 1 ? '' : 's'}
          </span>
          {bugCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-toon-coral/10 text-toon-coral border border-toon-coral/20 tabular-nums">
              {bugCount} bug{bugCount === 1 ? '' : 's'}
            </span>
          )}
          {commentCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 tabular-nums">
              {commentCount} comment{commentCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </div>
      <div className="divide-y divide-gray-100 max-h-[480px] overflow-y-auto pr-1">
        {rows.map((row, idx) => {
          const isJira = row.kind === 'jira'
          const tone = isJira ? (row.subkind === 'comment' ? 'comment' : 'bug') : 'run'
          // Build a single secondary line of metadata that survives
          // truncation on narrow viewports. Cache hits and "repaired"
          // (auto-fallback after a 503) are surfaced inline so users
          // can see when a run was served from cache or rescued.
          const meta = []
          meta.push(labelFor(row.agent))
          if (row.project) meta.push(row.project)
          if (row.model) meta.push(row.model)
          if (row.linked_issue_key) meta.push(`linked ${row.linked_issue_key}`)
          if (row.cache_hit) meta.push('cache')
          if (row.repaired) meta.push('repaired')
          return (
            <button
              key={`${row.ts}-${idx}`}
              type="button"
              onClick={() => openRow(row)}
              className="w-full text-left py-2 flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
            >
              <Pill tone={tone}>
                {isJira ? (row.subkind === 'comment' ? 'Comment' : 'Bug') : 'Run'}
              </Pill>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-toon-navy truncate">
                  {row.summary || labelFor(row.agent)}
                </div>
                <div className="text-[11px] text-gray-500 truncate">
                  {meta.join(' · ')}
                </div>
              </div>
              <div className="text-[11px] text-gray-400 tabular-nums whitespace-nowrap">
                {fmtTs(row.ts)}
              </div>
            </button>
          )
        })}
      </div>
      <div className="mt-2 text-[10px] text-gray-400 text-right">
        Showing {rows.length} event{rows.length === 1 ? '' : 's'} — strictly your own data.
      </div>
    </div>
  )
}
