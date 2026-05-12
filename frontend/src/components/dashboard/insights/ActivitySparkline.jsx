import { useMemo } from 'react'
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

/**
 * Generic per-agent activity sparkline. Used as the body of any agent
 * card whose latest run didn't yield a structured chart, and as a
 * secondary chart underneath the bespoke ones when the parent passes
 * ``compact={true}``.
 *
 * Renders an area chart over ``spark = [{date, runs}, ...]``; falls
 * back to an empty-state hint when the agent has no runs in the
 * window.
 */
export default function ActivitySparkline({ spark, compact = false, height }) {
  const rows = useMemo(() => {
    if (!Array.isArray(spark)) return []
    return spark.map(r => ({ date: r.date, runs: r.runs || 0 }))
  }, [spark])

  const h = height || (compact ? 60 : 130)

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-[11px] text-gray-400 italic"
        style={{ height: h }}
      >
        No runs in this window.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={h}>
      <AreaChart data={rows} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id={`sparkFill-${compact ? 'c' : 'f'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.6} />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={compact ? false : { fontSize: 9, fill: '#94a3b8' }}
          tickFormatter={(d) => (d ? String(d).slice(5) : '')}
          axisLine={!compact}
          tickLine={!compact}
          height={compact ? 0 : 18}
        />
        <YAxis hide allowDecimals={false} />
        <Tooltip
          contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 11 }}
          formatter={(v) => [v, 'runs']}
          labelFormatter={(l) => `Date: ${l}`}
        />
        <Area
          type="monotone"
          dataKey="runs"
          stroke="#7c3aed"
          strokeWidth={1.8}
          fill={`url(#sparkFill-${compact ? 'c' : 'f'})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
