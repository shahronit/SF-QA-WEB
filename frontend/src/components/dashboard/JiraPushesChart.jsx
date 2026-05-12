import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AGENT_META, PATH_TO_AGENT } from '../../config/agentMeta'

const AGENT_TO_PATH = Object.fromEntries(
  Object.entries(PATH_TO_AGENT).map(([path, slug]) => [slug, path]),
)

function labelFor(slug) {
  if (!slug || slug === '(unknown)') return 'Other'
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
            No Jira pushes in this window yet. Create a bug from a Defect Report to see it here.
          </div>
        ) : children}
      </div>
    </div>
  )
}

/**
 * Stacked bar chart of Jira pushes (bugs + comments) per source agent.
 * Each bar is clickable; clicking opens the source agent's page so the
 * user can re-run or push another from there. Only agents that
 * actually pushed at least once in the window are rendered, keeping
 * the X axis readable.
 */
export default function JiraPushesChart({ rows = [] }) {
  const nav = useNavigate()
  const data = useMemo(() => {
    return (rows || [])
      .filter(r => r && ((r.jira_bugs || 0) + (r.jira_comments || 0)) > 0)
      .map(r => ({
        agent: r.agent,
        label: labelFor(r.agent),
        bugs: r.jira_bugs || 0,
        comments: r.jira_comments || 0,
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
      title="Jira pushes per agent"
      subtitle="Bugs created and comments posted — click a bar to open the source agent"
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
            cursor={{ fill: 'rgba(244,63,94,0.08)' }}
            contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="bugs"
            stackId="jira"
            fill="#f43f5e"
            name="Bugs"
            radius={[0, 0, 0, 0]}
            onClick={onBarClick}
            cursor="pointer"
          />
          <Bar
            dataKey="comments"
            stackId="jira"
            fill="#10b981"
            name="Comments"
            radius={[8, 8, 0, 0]}
            onClick={onBarClick}
            cursor="pointer"
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
