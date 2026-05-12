import { useMemo } from 'react'
import {
  Cell, Pie, PieChart, ResponsiveContainer, Tooltip,
} from 'recharts'

const SEVERITY_COLOR = {
  Critical: '#dc2626',
  High:     '#f97316',
  Major:    '#f59e0b',
  Medium:   '#eab308',
  Low:      '#22c55e',
  Minor:    '#10b981',
  Trivial:  '#94a3b8',
}

export default function SeverityDonutChart({ data }) {
  const rows = useMemo(() => {
    if (!data || typeof data !== 'object') return []
    return Object.entries(data)
      .filter(([, v]) => (v || 0) > 0)
      .map(([name, value]) => ({ name, value }))
  }, [data])

  if (rows.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={140}>
      <PieChart>
        <Pie
          data={rows}
          innerRadius={36}
          outerRadius={58}
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {rows.map((row) => (
            <Cell key={row.name} fill={SEVERITY_COLOR[row.name] || '#7c3aed'} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
          formatter={(v, n) => [v, n]}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
