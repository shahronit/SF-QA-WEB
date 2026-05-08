import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Shared usage primitives lifted out of `pages/Admin.jsx` so the admin
// "Usage" tab and the per-user "My Usage" page render the same tables
// and chips with no fork. Introduced when the Reasoning column was
// added — having a single source of truth keeps PROMPT + COMPLETION +
// REASONING = TOTAL math consistent in both surfaces.

// Compact token formatter — same rules ReportPanel/History use.
//   < 1k         → "473"
//   1k–10k       → "1,234"
//   ≥ 10k        → "12.5k"
//   null/NaN     → "—"
export function fmtTokens(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const v = Number(n)
  if (v < 1000) return String(v)
  if (v < 10000) return v.toLocaleString()
  return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

// "2026-05-04T12:34:56.789Z" → "2026-05-04 12:34:56" so a row stays
// narrow without losing the seconds precision needed when correlating
// two near-simultaneous runs.
export function fmtTs(ts) {
  if (!ts) return ''
  return String(ts).slice(0, 19).replace('T', ' ')
}

// Reasoning residual = total - prompt - completion. Recomputed here
// (not just trusted from the wire) so legacy records written before
// the backend started emitting `reasoning_tokens` still reconcile in
// the table. Floored at 0 — a wonky provider report that says
// total < prompt + completion can't produce a negative cell.
export function reasoningOf(usage) {
  if (!usage) return 0
  const r = Number(usage.reasoning_tokens || 0)
  if (r > 0) return r
  const t = Number(usage.total_tokens || 0)
  const p = Number(usage.prompt_tokens || 0)
  const c = Number(usage.completion_tokens || 0)
  return Math.max(0, t - p - c)
}

// Single tile in the headline strip above the leaderboards. Used by
// both Admin Usage and My Usage with the same five tiles (Runs,
// Prompt, Completion, Reasoning, Total) so the math reconciles
// visually before the user even scans a table.
export function SummaryCard({ icon, label, value, subtitle, gradient }) {
  return (
    <div className="toon-card !p-3">
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-base shadow-toon`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            {label}
          </div>
          <div className="text-xl font-extrabold text-toon-navy tabular-nums">
            {value}
          </div>
          {subtitle && (
            <div className="text-[10px] text-gray-400 tabular-nums">{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Five-tile usage summary (Runs / Prompt / Completion / Reasoning /
// Total). Pulled into a helper so Admin and My Usage render the same
// layout — the `totals` object comes from /admin/usage or /me/usage.
export function UsageSummaryStrip({ totals = {} }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <SummaryCard
        icon="🏃"
        label="Total runs"
        value={(totals.runs ?? 0).toLocaleString()}
        gradient="from-toon-blue to-cyan-400"
      />
      <SummaryCard
        icon="⬇️"
        label="Prompt tokens"
        value={fmtTokens(totals.prompt_tokens)}
        subtitle={(totals.prompt_tokens ?? 0).toLocaleString()}
        gradient="from-emerald-500 to-teal-400"
      />
      <SummaryCard
        icon="⬆️"
        label="Completion tokens"
        value={fmtTokens(totals.completion_tokens)}
        subtitle={(totals.completion_tokens ?? 0).toLocaleString()}
        gradient="from-amber-500 to-orange-400"
      />
      <SummaryCard
        icon="🧠"
        label="Reasoning tokens"
        value={fmtTokens(totals.reasoning_tokens)}
        subtitle={(totals.reasoning_tokens ?? 0).toLocaleString()}
        gradient="from-fuchsia-500 to-rose-400"
      />
      <SummaryCard
        icon="🪙"
        label="Total tokens"
        value={fmtTokens(totals.total_tokens)}
        subtitle={(totals.total_tokens ?? 0).toLocaleString()}
        gradient="from-violet-500 to-fuchsia-500"
      />
    </div>
  )
}

/**
 * Leaderboard table for usage rollups. One row per user / agent /
 * model with PROMPT, COMPLETION, REASONING, TOTAL columns. The
 * Reasoning column is displayed in a muted tone so it reads as
 * "supporting detail" — the headline is still TOTAL.
 *
 * Props:
 *   - title:        Section heading.
 *   - rows:         Array of bucket objects.
 *   - nameKey:      Field on each row used for the first column value.
 *   - nameLabel:    Header text for the first column.
 *   - renderName:   Optional `(name, row) => ReactNode` for richer cells.
 *   - emptyHint:    Text shown when `rows` is empty.
 *   - onRowClick:   Optional `(row) => void`. When set, rows render
 *                   as buttons (focus ring, cursor-pointer) and call
 *                   the callback on click — used by Admin Usage to
 *                   filter the Recent runs table to a specific
 *                   agent / user.
 */
export function RankingTable({
  title, rows, nameKey, nameLabel,
  renderName, emptyHint, onRowClick,
}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const clickable = typeof onRowClick === 'function'
  return (
    <div className="toon-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-bold text-toon-navy">{title}</span>
        <span className="text-xs text-gray-500">{safeRows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-bold">{nameLabel}</th>
              <th className="text-right px-3 py-2 font-bold">Runs</th>
              <th className="text-right px-3 py-2 font-bold">Prompt</th>
              <th className="text-right px-3 py-2 font-bold">Completion</th>
              <th
                className="text-right px-3 py-2 font-bold"
                title="Provider-reported residual (Gemini thinking / cached-context tokens)."
              >
                Reasoning
              </th>
              <th
                className="text-right px-3 py-2 font-bold"
                title="Provider total = PROMPT + COMPLETION + REASONING."
              >
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {safeRows.map((row, i) => {
              const name = row[nameKey]
              return (
                <tr
                  key={i}
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  onKeyDown={clickable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick(row)
                    }
                  } : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? 'button' : undefined}
                  aria-label={clickable ? `Drill into ${name || '(unknown)'}` : undefined}
                  className={`hover:bg-gray-50 ${
                    clickable
                      ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-astound-violet/40'
                      : ''
                  }`}
                >
                  <td className="px-3 py-2 font-semibold text-toon-navy">
                    {renderName ? renderName(name, row) : (name || '(unknown)')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(row.runs ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(row.prompt_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(row.completion_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fuchsia-700/80">
                    {fmtTokens(row.reasoning_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-extrabold">
                    {fmtTokens(row.total_tokens)}
                  </td>
                </tr>
              )
            })}
            {safeRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-sm text-gray-400">
                  {emptyHint || 'Nothing to show.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Per-run feed used at the bottom of both Usage surfaces. Adds a
 * Reasoning column between Completion and Total so each row's math
 * reconciles in isolation. When `onRowClick` is supplied, a row is
 * keyboard-actionable and triggers the callback — Admin uses this to
 * pop a metadata-only modal; My Usage uses it to pop a full
 * input/output modal because the user owns those rows.
 */
export function RecentRunsTable({
  records, loading, onRowClick, agentLabel,
  rowsLabel = 'rows',
}) {
  const list = Array.isArray(records) ? records : []
  const clickable = typeof onRowClick === 'function'
  return (
    <div className="toon-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-toon-navy">Recent runs</span>
          <span className="text-xs text-gray-500">
            {loading ? 'loading…' : `${list.length} ${rowsLabel}`}
          </span>
        </div>
        {clickable && list.length > 0 && (
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
            Click a row for details
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-bold">When</th>
              <th className="text-left px-3 py-2 font-bold">User</th>
              <th className="text-left px-3 py-2 font-bold">Agent</th>
              <th className="text-left px-3 py-2 font-bold">Model</th>
              <th className="text-right px-3 py-2 font-bold">Prompt</th>
              <th className="text-right px-3 py-2 font-bold">Completion</th>
              <th
                className="text-right px-3 py-2 font-bold"
                title="Provider-reported residual (Gemini thinking / cached-context tokens)."
              >
                Reasoning
              </th>
              <th
                className="text-right px-3 py-2 font-bold"
                title="Provider total = PROMPT + COMPLETION + REASONING."
              >
                Total
              </th>
              <th className="text-center px-3 py-2 font-bold">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {list.map((r, i) => {
              const usage = r.usage || {}
              const reasoning = usage.reasoning_tokens ?? reasoningOf(usage)
              return (
                <tr
                  key={i}
                  onClick={clickable ? () => onRowClick(r) : undefined}
                  onKeyDown={clickable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick(r)
                    }
                  } : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? 'button' : undefined}
                  className={`hover:bg-gray-50 ${
                    clickable
                      ? 'cursor-pointer focus:outline-none focus:ring-2 focus:ring-astound-violet/40'
                      : ''
                  }`}
                >
                  <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                    {fmtTs(r.ts)}
                  </td>
                  <td className="px-3 py-2 font-semibold text-toon-navy">
                    {r.username || <span className="text-gray-400">(unknown)</span>}
                  </td>
                  <td className="px-3 py-2">
                    {agentLabel ? (agentLabel(r.agent) || r.agent) : r.agent}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    <span className="text-gray-400">{r.provider || '—'}</span>
                    <span className="opacity-40 mx-1">·</span>
                    <span>{r.model || '—'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(usage.prompt_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(usage.completion_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fuchsia-700/80">
                    {fmtTokens(reasoning)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-extrabold">
                    {fmtTokens(usage.total_tokens)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="inline-flex items-center gap-1">
                      {r.cache_hit && (
                        <span
                          title="Replayed from response cache"
                          className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold"
                        >
                          cached
                        </span>
                      )}
                      {r.repaired && (
                        <span
                          title="Auto-repair pass kicked in"
                          className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold"
                        >
                          repaired
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!loading && list.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-400">
                  No runs match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// One pill-shaped chip describing an active server-side filter, with
// an inline "×" that calls `onClear`. Multiple chips render in the
// row above Recent runs so the user can see what's narrowing the
// table at a glance.
export function FilterChip({ label, value, onClear }) {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-violet-50 text-violet-700 border border-violet-200">
      <span className="opacity-70">{label}:</span>
      <span className="font-mono">{value}</span>
      <button
        type="button"
        onClick={onClear}
        className="ml-1 text-violet-500 hover:text-toon-coral"
        aria-label={`Clear ${label} filter`}
      >
        ×
      </button>
    </span>
  )
}

/**
 * Modal that pops over the Usage tab when the user clicks a Recent-
 * runs row. Shows EVERYTHING we know about the run:
 *   - timestamp, user, agent, provider/model, project
 *   - all four token counts (incl. Reasoning) so the math reconciles
 *   - cache / repair flags
 *   - the run's input (when present — only My Usage decrypts these)
 *   - the run's output OR the truncated `output_preview` from the
 *     admin endpoint, rendered as plain markdown.
 *
 * Closes on Esc, backdrop click, or the X button. The ReportPanel
 * import is deferred to the consumer (`renderOutput` prop) so this
 * component stays lightweight and reusable in pages that don't pull
 * the full ReportPanel chunk.
 */
export function RunDetailsModal({
  run, onClose, agentLabel, renderOutput,
}) {
  useEffect(() => {
    if (!run) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, onClose])

  if (!run) return null
  const usage = run.usage || {}
  const reasoning = usage.reasoning_tokens ?? reasoningOf(usage)
  const inputObj = run.input
  const inputText = run.output ?? run.output_preview ?? ''

  return (
    <AnimatePresence>
      <motion.div
        key="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          key="modal-panel"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl bg-white shadow-2xl border border-astound-violet/20 flex flex-col"
        >
          <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-0.5">
                Run details
              </div>
              <h3 className="font-extrabold text-toon-navy text-lg truncate">
                {agentLabel ? (agentLabel(run.agent) || run.agent) : run.agent}
                <span className="text-gray-400 font-normal ml-2">
                  {fmtTs(run.ts)}
                </span>
              </h3>
              <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-gray-500">
                <span><span className="font-bold text-toon-navy">User:</span> {run.username || '(unknown)'}</span>
                <span className="opacity-40">·</span>
                <span>
                  <span className="font-bold text-toon-navy">Model:</span>
                  {' '}{run.provider || '—'} · {run.model || '—'}
                </span>
                {run.project && (
                  <>
                    <span className="opacity-40">·</span>
                    <span><span className="font-bold text-toon-navy">Project:</span> {run.project}</span>
                  </>
                )}
                {run.cache_hit && (
                  <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold">
                    cached
                  </span>
                )}
                {run.repaired && (
                  <span className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold">
                    repaired
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-400 hover:text-toon-coral text-xl leading-none px-2 py-1"
              aria-label="Close run details"
            >
              ×
            </button>
          </div>

          {/* Token grid — same four counts as the row, expanded so the
              user can see the underlying integers, not just the "12.5k"
              short form. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-5 py-3 bg-gray-50 border-b border-gray-100">
            <TokenPill label="Prompt" value={usage.prompt_tokens} accent="text-emerald-700" />
            <TokenPill label="Completion" value={usage.completion_tokens} accent="text-amber-700" />
            <TokenPill label="Reasoning" value={reasoning} accent="text-fuchsia-700" />
            <TokenPill label="Total" value={usage.total_tokens} accent="text-violet-700" bold />
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {inputObj && (
              <section>
                <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                  Input
                </div>
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-2xl p-3 overflow-x-auto whitespace-pre-wrap break-words text-toon-navy">
{typeof inputObj === 'string' ? inputObj : JSON.stringify(inputObj, null, 2)}
                </pre>
              </section>
            )}
            <section>
              <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-1">
                {run.output ? 'Output' : 'Output preview'}
              </div>
              {renderOutput ? (
                renderOutput(inputText, run)
              ) : (
                <pre className="text-xs bg-gray-50 border border-gray-200 rounded-2xl p-3 overflow-x-auto whitespace-pre-wrap break-words text-gray-700">
{inputText || '(no output captured)'}
                </pre>
              )}
            </section>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function TokenPill({ label, value, accent, bold }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
      <div className={`text-lg tabular-nums ${bold ? 'font-extrabold' : 'font-bold'} ${accent || 'text-toon-navy'}`}>
        {fmtTokens(value)}
      </div>
      <div className="text-[10px] text-gray-400 tabular-nums">
        {(value ?? 0).toLocaleString()}
      </div>
    </div>
  )
}
