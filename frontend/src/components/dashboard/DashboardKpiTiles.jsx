import { SummaryCard } from '../usage/UsageTables'

/**
 * Four-tile KPI strip rendered at the top of the Dashboard activity
 * section. Mirrors the visual treatment of `UsageSummaryStrip` so the
 * Dashboard and My Usage pages feel like siblings; the numbers, however,
 * are dashboard-specific (runs / bugs / comments / projects) instead of
 * token totals.
 */
export default function DashboardKpiTiles({ totals = {}, window = '30d', onWindowChange, loading = false }) {
  const windows = [
    { id: '7d',  label: '7 days'  },
    { id: '30d', label: '30 days' },
    { id: '90d', label: '90 days' },
    { id: 'all', label: 'All time' },
  ]
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold text-toon-navy flex items-center gap-3">
          <span className="w-2 h-6 rounded-full bg-gradient-to-b from-astound-cyan to-astound-violet" />
          <span>Your activity{loading ? ' …' : ''}</span>
        </h2>
        <div className="inline-flex rounded-xl bg-white shadow-toon border border-gray-100 p-1 text-xs">
          {windows.map(w => (
            <button
              key={w.id}
              onClick={() => onWindowChange?.(w.id)}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                window === w.id
                  ? 'bg-astound-grad text-white shadow-astound'
                  : 'text-toon-navy hover:bg-gray-100'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon="🏃"
          label="Agent runs"
          value={(totals.runs ?? 0).toLocaleString()}
          gradient="from-toon-blue to-cyan-400"
        />
        <SummaryCard
          icon="🐞"
          label="Bugs created in Jira"
          value={(totals.jira_bugs ?? 0).toLocaleString()}
          gradient="from-toon-coral to-red-400"
        />
        <SummaryCard
          icon="💬"
          label="Jira comments pushed"
          value={(totals.jira_comments ?? 0).toLocaleString()}
          gradient="from-emerald-500 to-teal-400"
        />
        <SummaryCard
          icon="🗂️"
          label="Projects touched"
          value={(totals.projects_active ?? 0).toLocaleString()}
          gradient="from-violet-500 to-fuchsia-500"
        />
      </div>
    </div>
  )
}
