import { useMemo } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const WINDOW_TO_DAYS = { '7d': 7, '30d': 30, '90d': 90 }

function pad2(n) { return String(n).padStart(2, '0') }

// Build the full date axis for *window* (most recent first day -> today).
// We zero-fill the in-between gaps so the line chart doesn't visually
// "skip" a quiet day — important when the user is checking whether
// they used the tool yesterday.
function buildAxis(windowKey, rows) {
  const map = new Map((rows || []).map(r => [r.date, r]))
  const days = WINDOW_TO_DAYS[windowKey]
  if (!days) {
    // 'all' / unknown — just use whatever the API returned, sorted.
    return (rows || [])
      .slice()
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      .map(r => ({ date: r.date, runs: r.runs || 0, jira_pushes: r.jira_pushes || 0 }))
  }
  const out = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
    const existing = map.get(key)
    out.push({
      date: key,
      runs: existing?.runs || 0,
      jira_pushes: existing?.jira_pushes || 0,
    })
  }
  return out
}

function shortLabel(iso) {
  if (!iso) return ''
  return iso.slice(5) // MM-DD — chart x-axis stays compact
}

/**
 * Two-series line chart of daily agent runs and Jira pushes over the
 * selected window. Gaps are zero-filled for the 7d/30d/90d windows so
 * the chart accurately represents idle days; the "all-time" view skips
 * zero-filling because the date range is unbounded.
 */
export default function DailyActivityChart({ rows = [], window = '30d' }) {
  const data = useMemo(() => buildAxis(window, rows), [rows, window])
  const empty = data.every(d => (d.runs || 0) === 0 && (d.jira_pushes || 0) === 0)
  return (
    <div className="toon-card !p-4 h-full flex flex-col">
      <div className="font-bold text-toon-navy text-sm">Daily activity</div>
      <div className="text-[11px] text-gray-500 mb-2">
        Agent runs and Jira pushes per day for the selected window.
      </div>
      <div className="flex-1 min-h-[240px]">
        {empty ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400 italic">
            No activity to chart yet — run an agent to seed your timeline.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: -12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
              <XAxis dataKey="date" tickFormatter={shortLabel} tick={{ fontSize: 10, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 10, fill: '#475569' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: '1px solid #e5e7eb', fontSize: 12 }}
                labelFormatter={(l) => `Date: ${l}`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="runs"
                name="Agent runs"
                stroke="#7c3aed"
                strokeWidth={2.4}
                dot={{ r: 3 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="jira_pushes"
                name="Jira pushes"
                stroke="#f43f5e"
                strokeWidth={2.4}
                dot={{ r: 3 }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
