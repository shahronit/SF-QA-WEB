import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const COLORS = {
  Pass: '#10b981',
  Fail: '#ef4444',
  Blocked: '#f59e0b',
  'Not run': '#94a3b8',
}

export default function ExecBarsChart({ data }) {
  const rows = useMemo(() => {
    if (!data) return []
    return [
      { name: 'Pass',    value: data.pass    || 0 },
      { name: 'Fail',    value: data.fail    || 0 },
      { name: 'Blocked', value: data.blocked || 0 },
      { name: 'Not run', value: data.not_run || 0 },
    ].filter(r => r.value > 0)
  }, [data])

  if (rows.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={rows} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} />
        <YAxis tick={{ fontSize: 10, fill: '#475569' }} allowDecimals={false} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
          formatter={(v, _name, ctx) => [v, ctx?.payload?.name]}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]}>
          {rows.map((r) => (
            <Cell key={r.name} fill={COLORS[r.name] || '#7c3aed'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
