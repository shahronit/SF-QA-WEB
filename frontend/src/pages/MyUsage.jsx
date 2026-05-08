import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../api/client'
import PageHeader from '../components/PageHeader'
import ReportPanel from '../components/ReportPanel'
import { AGENT_META } from '../config/agentMeta'
import {
  RankingTable,
  RecentRunsTable,
  RunDetailsModal,
  UsageSummaryStrip,
  FilterChip,
} from '../components/usage/UsageTables'

// Same agent universe as Admin so the filter dropdown lists exactly
// what the backend emits. Deprecated agents are skipped — a row for
// one of them only appears in the user's table if they actually ran it
// before it was retired, and we keep the filter list focused on the
// agents the user can run today.
const RUNNABLE_AGENTS = Object.entries(AGENT_META)
  .filter(([, meta]) => !meta.deprecated)
  .map(([slug, meta]) => ({ slug, label: meta.label || slug }))
const AGENT_LABEL = Object.fromEntries(RUNNABLE_AGENTS.map(a => [a.slug, a.label]))

/**
 * "My Usage" — every authenticated user gets the same five-tile
 * summary, agent + model leaderboards, and per-run feed the admin
 * sees, but scoped to their own runs. Clicking a row in Recent runs
 * opens a modal with the user's actual decrypted INPUT and the OUTPUT
 * rendered through `ReportPanel` (the same renderer the user saw at
 * generate time) so they can re-read what they got.
 *
 * Deliberately uses the same shared components as the admin page —
 * keeps PROMPT + COMPLETION + REASONING = TOTAL math identical in both
 * surfaces and means a future column lands on both pages at once.
 */
export default function MyUsage() {
  const [data, setData] = useState({
    records: [],
    summary: { totals: {}, per_agent: [], per_model: [] },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ limit: 500, agent: '', since: '' })
  const [selectedRun, setSelectedRun] = useState(null)

  const reload = async (overrides) => {
    setLoading(true)
    setError('')
    try {
      const f = overrides || filters
      const params = {}
      if (f.limit) params.limit = f.limit
      if (f.agent) params.agent = f.agent
      if (f.since) params.since = new Date(f.since).toISOString()
      const { data: payload } = await api.get('/me/usage', { params })
      setData({
        records: payload?.records || [],
        summary: payload?.summary || { totals: {}, per_agent: [], per_model: [] },
      })
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to load usage'
      setError(String(detail))
      toast.error(detail)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])
  useEffect(() => {
    reload(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.agent, filters.since, filters.limit])

  const clearFilter = (key) => setFilters(f => ({ ...f, [key]: '' }))
  const totals = data.summary.totals || {}
  const hasFilter = !!(filters.agent || filters.since)

  return (
    <div>
      <PageHeader
        icon="🪙"
        title="My Usage"
        subtitle="Token spend across your own agent runs"
        gradient="from-fuchsia-500 to-rose-400"
      />

      <div className="space-y-4">
        <UsageSummaryStrip totals={totals} />

        {/* Filters — narrower than admin (no username field, since we
            already know whose page this is). */}
        <div className="toon-card !py-3">
          <div className="flex items-end gap-3 flex-wrap">
            <FilterField label="Agent">
              <select
                className="toon-input !py-1.5 !px-2 text-sm"
                value={filters.agent}
                onChange={e => setFilters(f => ({ ...f, agent: e.target.value }))}
              >
                <option value="">All</option>
                {RUNNABLE_AGENTS.map(a => (
                  <option key={a.slug} value={a.slug}>{a.label}</option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Since">
              <input
                type="date"
                className="toon-input !py-1.5 !px-2 text-sm"
                value={filters.since}
                onChange={e => setFilters(f => ({ ...f, since: e.target.value }))}
              />
            </FilterField>
            <FilterField label="Limit">
              <select
                className="toon-input !py-1.5 !px-2 text-sm"
                value={filters.limit}
                onChange={e => setFilters(f => ({ ...f, limit: Number(e.target.value) }))}
              >
                {[100, 250, 500, 1000, 2000].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </FilterField>
            <button
              type="button"
              onClick={() => reload()}
              disabled={loading}
              className="toon-btn toon-btn-blue text-sm py-2 px-4"
            >
              {loading ? '…' : '↻ Apply'}
            </button>
            {hasFilter && (
              <button
                type="button"
                onClick={() => setFilters({ limit: 500, agent: '', since: '' })}
                className="text-xs font-semibold text-gray-500 hover:text-toon-coral"
              >
                Clear filters
              </button>
            )}
          </div>
          {error && (
            <div className="mt-2 text-xs text-toon-coral font-semibold">{error}</div>
          )}
        </div>

        {hasFilter && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">
              Filtered to
            </span>
            {filters.agent && (
              <FilterChip
                label="agent"
                value={AGENT_LABEL[filters.agent] || filters.agent}
                onClear={() => clearFilter('agent')}
              />
            )}
            {filters.since && (
              <FilterChip
                label="since"
                value={filters.since}
                onClear={() => clearFilter('since')}
              />
            )}
          </div>
        )}

        {/* Two leaderboards (agent + model). Click a row to filter the
            Recent runs feed below to that agent. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <RankingTable
            title="By agent"
            rows={data.summary.per_agent}
            nameKey="agent"
            nameLabel="Agent"
            renderName={(name) => AGENT_LABEL[name] || name}
            emptyHint="You haven't run any agents yet."
            onRowClick={(r) => setFilters(f => ({ ...f, agent: r.agent || '' }))}
          />
          <RankingTable
            title="By model"
            rows={data.summary.per_model}
            nameKey="model"
            nameLabel="Model"
            renderName={(_name, row) => (
              <span>
                <span className="text-gray-500">{row.provider || '—'}</span>
                <span className="opacity-40 mx-1">·</span>
                <span>{row.model || '—'}</span>
              </span>
            )}
            emptyHint="No model usage in this window."
          />
        </div>

        <RecentRunsTable
          records={data.records}
          loading={loading}
          agentLabel={(slug) => AGENT_LABEL[slug] || slug}
          onRowClick={(r) => setSelectedRun(r)}
        />

        <RunDetailsModal
          run={selectedRun}
          onClose={() => setSelectedRun(null)}
          agentLabel={(slug) => AGENT_LABEL[slug] || slug}
          renderOutput={(content, run) => {
            // Always render the user's own output through ReportPanel so
            // the markdown matches what they saw at generate time
            // (tables, headings, code blocks). Falls through to a plain
            // pre-tag only when the run has no captured output at all.
            const md = run.output || content
            if (!md) {
              return (
                <div className="text-sm text-gray-400 italic">
                  No output captured for this run.
                </div>
              )
            }
            return (
              <ReportPanel
                content={md}
                agentName={run.agent || ''}
              />
            )
          }}
        />
      </div>
    </div>
  )
}

// Tiny labelled-field wrapper, identical to the one in Admin.jsx —
// duplicating the four-line component here is cheaper than introducing
// a new shared module just for this.
function FilterField({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </span>
      {children}
    </label>
  )
}
