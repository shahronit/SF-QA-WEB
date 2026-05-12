import { useMemo } from 'react'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts'

const COLORS = ['#f97316', '#10b981']

function fmtHrs(v) {
  if (v == null) return '—'
  return `${Math.round(v)}h`
}

export default function RoiSplitChart({ data }) {
  const rows = useMemo(() => {
    if (!data) return []
    return [
      { name: 'Manual',    value: data.manual_hours    || 0 },
      { name: 'Automated', value: data.automated_hours || 0 },
    ].filter(r => r.value > 0)
  }, [data])

  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.value, 0)
  const automated = rows.find(r => r.name === 'Automated')?.value || 0
  const savings = total > 0 ? Math.round((automated / total) * 100) : 0

  return (
    <div className="flex items-center gap-3">
      <div className="relative" style={{ width: 130, height: 130 }}>
        <ResponsiveContainer width="100%" height="100%">
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
              formatter={(v, n) => [fmtHrs(v), n]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-base font-extrabold text-toon-navy tabular-nums">{savings}%</div>
          <div className="text-[9px] uppercase tracking-wider text-gray-500">auto</div>
        </div>
      </div>
      <div className="text-xs space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-500" />
          <span className="text-gray-600">Manual</span>
          <span className="ml-auto font-bold text-toon-navy tabular-nums">{fmtHrs(data.manual_hours)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-gray-600">Automated</span>
          <span className="ml-auto font-bold text-toon-navy tabular-nums">{fmtHrs(data.automated_hours)}</span>
        </div>
      </div>
    </div>
  )
}
