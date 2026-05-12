import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AGENT_META, PATH_TO_AGENT } from '../../config/agentMeta'

// Reverse map: agent slug -> path. Built once at module load because
// PATH_TO_AGENT is static. Used to navigate the user back to the
// page that produces a given agent's output when they click a bar.
const AGENT_TO_PATH = Object.fromEntries(
  Object.entries(PATH_TO_AGENT).map(([path, slug]) => [slug, path]),
)

function labelFor(slug) {
  return AGENT_META[slug]?.label || slug
}

function ChartCard({ title, subtitle, children, empty }) {
  return (
    <div className="toon-card !p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="font-bold text-toon-navy text-sm">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-500">{subtitle}</div>}
        </div>
      </div>
      <div className="flex-1 min-h-[220px]">
        {empty ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 italic">
            No activity in this window yet.
          </div>
        ) : children}
      </div>
    </div>
  )
}

/**
 * Bar chart of agent runs per agent slug. Each bar is clickable and
 * navigates the user to that agent's page so they can drill from
 * "I ran the requirements agent 32 times" into the actual page that
 * produces those runs. Slugs without a matching path (admin-only or
 * legacy slugs) become non-clickable bars — the cursor stays default
 * to hint at it.
 */
export default function RunsByAgentChart({ rows = [] }) {
  const nav = useNavigate()
  const data = useMemo(() => {
    return (rows || [])
      .filter(r => r && (r.runs || 0) > 0)
      .map(r => ({
        agent: r.agent,
        label: labelFor(r.agent),
        runs: r.runs || 0,
      }))
  }, [rows])

  const onBarClick = (entry) => {
    if (!entry) return
    const slug = entry.agent || entry.payload?.agent
    const path = AGENT_TO_PATH[slug]
    if (path) nav(path)
  }

  return (
    <ChartCard
      title="Agent runs per agent"
      subtitle="Click a bar to open that agent"
      empty={data.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 28 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: '#475569' }}
            angle={-22}
            textAnchor="end"
            height={50}
            interval={0}
          />
          <YAxis tick={{ fontSize: 10, fill: '#475569' }} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'rgba(124,58,237,0.08)' }}
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
            formatter={(v) => [v, 'runs']}
            labelFormatter={(l) => `Agent: ${l}`}
          />
          <Bar
            dataKey="runs"
            fill="url(#runsFill)"
            radius={[8, 8, 0, 0]}
            onClick={onBarClick}
            cursor="pointer"
          />
          <defs>
            <linearGradient id="runsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#7c3aed" />
            </linearGradient>
          </defs>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
