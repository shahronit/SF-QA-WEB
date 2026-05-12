import { useMemo } from 'react'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

export default function RecordsPerObjectChart({ data }) {
  const rows = useMemo(() => {
    if (!Array.isArray(data)) return []
    return data
      .filter(d => d && d.records > 0)
      .slice(0, 8)
      .map(d => ({ object: d.object, records: d.records }))
  }, [data])

  if (rows.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 22)}>
      <BarChart layout="vertical" data={rows} margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#475569' }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="object"
          width={80}
          tick={{ fontSize: 10, fill: '#475569' }}
        />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
          formatter={(v) => [v, 'records']}
        />
        <Bar dataKey="records" fill="#10b981" radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
