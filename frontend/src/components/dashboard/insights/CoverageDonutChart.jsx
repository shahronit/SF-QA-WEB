import { useMemo } from 'react'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts'

const COLORS = ['#10b981', '#f43f5e']

export default function CoverageDonutChart({ data }) {
  const rows = useMemo(() => {
    if (!data) return []
    const out = [
      { name: 'Covered',   value: data.covered   || 0 },
      { name: 'Uncovered', value: data.uncovered || 0 },
    ].filter(r => r.value > 0)
    return out
  }, [data])

  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  const covered = rows.find(r => r.name === 'Covered')?.value || 0
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={140}>
        <PieChart>
          <Pie
            data={rows}
            innerRadius={38}
            outerRadius={60}
            paddingAngle={2}
            dataKey="value"
            stroke="none"
          >
            {rows.map((row, idx) => (
              <Cell key={row.name} fill={COLORS[idx % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(v, n) => [v, n]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="text-xl font-extrabold text-toon-navy tabular-nums">{pct}%</div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500">covered</div>
      </div>
    </div>
  )
}
