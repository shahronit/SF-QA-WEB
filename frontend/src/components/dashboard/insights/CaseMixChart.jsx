import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const COLORS = {
  Positive: '#10b981',
  Negative: '#ef4444',
  Edge:     '#8b5cf6',
}

export default function CaseMixChart({ data }) {
  const rows = useMemo(() => {
    if (!data) return []
    return [
      { name: 'Positive', value: data.positive || 0 },
      { name: 'Negative', value: data.negative || 0 },
      { name: 'Edge',     value: data.edge     || 0 },
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
          formatter={(v, _n, ctx) => [v, ctx?.payload?.name]}
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
