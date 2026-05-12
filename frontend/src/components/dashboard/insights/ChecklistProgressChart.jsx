/**
 * Smoke / Regression checklists: render as a radial-style progress
 * ring drawn with two stacked half-circles. Recharts' `RadialBarChart`
 * is overkill for "X of N done"; a hand-rolled SVG ring keeps the
 * card tight and consistent with the other small visuals.
 */
export default function ChecklistProgressChart({ data }) {
  if (!data || !data.total) return null
  const total = data.total || 0
  const checked = Math.min(data.checked || 0, total)
  const pct = total > 0 ? checked / total : 0
  const size = 110
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * pct

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#e5e7eb"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="url(#checklistGrad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="18"
          fontWeight="800"
          fill="#0f172a"
        >
          {Math.round(pct * 100)}%
        </text>
        <defs>
          <linearGradient id="checklistGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
      </svg>
      <div>
        <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500">Checklist</div>
        <div className="text-base font-extrabold text-toon-navy tabular-nums">
          {checked} / {total}
        </div>
        <div className="text-[11px] text-gray-500">
          {total - checked} pending
        </div>
      </div>
    </div>
  )
}
