import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export default function TechniqueCompareChart({ data }) {
  const rows = useMemo(() => {
    if (!Array.isArray(data)) return []
    return data
      .filter(d => d && d.hours > 0)
      .map(d => ({ name: d.technique, hours: d.hours, unit: d.unit || 'hrs' }))
      .slice(0, 8)
  }, [data])

  if (rows.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 24)}>
      <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#475569' }} />
        <YAxis
          type="category"
          dataKey="name"
          width={92}
          tick={{ fontSize: 10, fill: '#475569' }}
        />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
          formatter={(v, _n, ctx) => [`${v} ${ctx?.payload?.unit || 'hrs'}`, 'Estimate']}
        />
        <Bar dataKey="hours" fill="#8b5cf6" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
