import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AGENT_META, PATH_TO_AGENT } from '../../config/agentMeta'
import Icon3D from '../icons/Icon3D'
import {
  ActivitySparkline,
  getInsightChart,
} from './insights'

// Reverse map: agent slug -> sidebar path. Built once at module load
// because PATH_TO_AGENT is static. Cards without a registered path
// (admin-only or composite agents) render as non-clickable cards.
const AGENT_TO_PATH = Object.fromEntries(
  Object.entries(PATH_TO_AGENT).map(([path, slug]) => [slug, path]),
)

function timeAgo(iso) {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const diff = Date.now() - then
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

/**
 * One Dashboard "Agent insights" tile — header + bespoke chart body +
 * footer. Renders a structured chart from the registry when the
 * backend successfully parsed the agent's latest output, otherwise
 * falls back to the per-agent activity sparkline so the user still
 * sees a heartbeat for that agent.
 *
 * The whole card is clickable (navigates to the agent's page), but
 * Recharts tooltip elements stop pointer-events bubbling so the user
 * can hover bars/slices without accidentally navigating.
 */
export default function AgentInsightCard({ slug, insight }) {
  const nav = useNavigate()
  const meta = AGENT_META[slug] || {}
  const label = meta.label || slug
  const iconName = meta.iconKey3d || 'sparkles'
  const path = AGENT_TO_PATH[slug] || null
  const runs = insight?.runs || 0
  const structured = insight?.structured || null
  const spark = insight?.spark || []
  const latestTs = insight?.latest_ts || null

  const ChartComp = useMemo(() => getInsightChart(structured), [structured])

  const handleOpen = () => {
    if (path) nav(path)
  }

  const empty = runs === 0

  return (
    <div
      role={path ? 'button' : undefined}
      tabIndex={path ? 0 : -1}
      onClick={path ? handleOpen : undefined}
      onKeyDown={(e) => {
        if (!path) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleOpen()
        }
      }}
      className={`toon-card !p-4 h-full flex flex-col ${
        path ? 'cursor-pointer hover:shadow-lg transition-shadow' : ''
      }`}
      aria-label={`${label} insights`}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-100 flex items-center justify-center">
          <Icon3D name={iconName} size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-extrabold text-toon-navy truncate">{label}</div>
          <div className="text-[11px] text-gray-500 flex items-center gap-2">
            <span className="tabular-nums">{runs} run{runs === 1 ? '' : 's'}</span>
            <span aria-hidden="true">·</span>
            <span>{empty ? 'no runs yet' : `last ${timeAgo(latestTs)}`}</span>
          </div>
        </div>
        {structured?.kind && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-100 text-[9px] font-bold uppercase tracking-wider text-emerald-700"
            title="Parsed structured data from the latest run"
          >
            insight
          </span>
        )}
      </div>

      {/* Body — bespoke chart when available, else sparkline.
          Pointer-events isolation lets the chart tooltips work without
          firing the card's onClick (the chart sits in its own div). */}
      <div
        className="flex-1 min-h-[120px]"
        onClick={(e) => {
          // Clicks INSIDE the chart shouldn't navigate; only the card
          // surface around it should. Recharts dispatches a click on
          // pie / bar elements that would otherwise bubble.
          e.stopPropagation()
        }}
      >
        {empty ? (
          <div className="h-full min-h-[100px] flex items-center justify-center text-center text-[11px] text-gray-400 italic px-2">
            No runs yet — run this agent to see insights here.
          </div>
        ) : ChartComp ? (
          <ChartComp data={structured.data} />
        ) : (
          <ActivitySparkline spark={spark} />
        )}
      </div>

      {/* Secondary sparkline under the structured chart so users still
          see their cadence. Skipped when we're already showing the
          fallback sparkline OR when the agent has no runs. */}
      {!empty && ChartComp && spark.length > 1 && (
        <div className="mt-2 -mx-1">
          <ActivitySparkline spark={spark} compact height={42} />
        </div>
      )}

      {/* Footer — explicit "Open" affordance for cards without a path
          (keeps the card looking clickable even if the click does
          nothing) and a hint when one is available. */}
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[11px] text-gray-500 truncate">
          {meta.phaseId ? `Phase ${meta.phaseId.slice(1)}` : 'Workflow'}
        </div>
        {path ? (
          <span className="text-[11px] font-bold text-astound-violet">
            Open →
          </span>
        ) : (
          <span className="text-[11px] text-gray-300">—</span>
        )}
      </div>
    </div>
  )
}
