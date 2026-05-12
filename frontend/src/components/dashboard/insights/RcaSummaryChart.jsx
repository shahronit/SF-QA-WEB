/**
 * RCA cards are mostly narrative — the only counts worth surfacing are
 * how deep the 5-Whys went and how many corrective/preventive actions
 * the agent emitted. Render as two pills + a thin "depth" indicator
 * so the user can spot a half-finished RCA at a glance.
 */
export default function RcaSummaryChart({ data }) {
  if (!data) return null
  const whys = data.whys || 0
  const actions = data.actions || 0
  const corrective = data.corrective || 0
  const preventive = data.preventive || 0
  const depth = Math.min(whys, 7)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-rose-50 border border-rose-100 p-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-rose-700">Why-depth</div>
          <div className="text-lg font-extrabold text-rose-700 tabular-nums">{whys}</div>
        </div>
        <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2">
          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700">Actions</div>
          <div className="text-lg font-extrabold text-emerald-700 tabular-nums">{actions}</div>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[10px] text-gray-500 mb-1">
          <span>5-Whys depth</span>
          <span className="tabular-nums">{whys}/5</span>
        </div>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className={`flex-1 h-1.5 rounded-full ${i < depth ? 'bg-rose-500' : 'bg-gray-200'}`}
            />
          ))}
        </div>
      </div>
      {(corrective > 0 || preventive > 0) && (
        <div className="text-[11px] text-gray-500 flex gap-3">
          {corrective > 0 && <span><span className="font-bold text-toon-navy">{corrective}</span> corrective</span>}
          {preventive > 0 && <span><span className="font-bold text-toon-navy">{preventive}</span> preventive</span>}
        </div>
      )}
    </div>
  )
}
