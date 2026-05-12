function fmtPct(v) {
  if (v == null) return '—'
  return `${Math.round(v)}%`
}

function fmtCount(v) {
  if (v == null) return '—'
  return String(v)
}

function ProgressBar({ value }) {
  const pct = Math.max(0, Math.min(100, value || 0))
  return (
    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-violet-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/**
 * Three KPI tiles + a slim progress bar for Pass Rate. We deliberately
 * avoid recharts here — three numbers don't need a chart, and the tile
 * row reads naturally on a 280-px card.
 */
export default function ClosureKpiChart({ data }) {
  if (!data) return null
  const { pass_rate, automation, open_defects } = data
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Pass rate</div>
          <div className="text-lg font-extrabold text-emerald-700 tabular-nums">{fmtPct(pass_rate)}</div>
        </div>
        <div className="rounded-lg bg-violet-50 border border-violet-100 p-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700">Automation</div>
          <div className="text-lg font-extrabold text-violet-700 tabular-nums">{fmtPct(automation)}</div>
        </div>
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700">Open</div>
          <div className="text-lg font-extrabold text-rose-700 tabular-nums">{fmtCount(open_defects)}</div>
        </div>
      </div>
      {pass_rate != null && (
        <div>
          <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Pass rate</span>
            <span className="tabular-nums">{fmtPct(pass_rate)}</span>
          </div>
          <ProgressBar value={pass_rate} />
        </div>
      )}
    </div>
  )
}
