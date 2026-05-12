import ExecBarsChart from './ExecBarsChart'
import ClosureKpiChart from './ClosureKpiChart'
import TechniqueCompareChart from './TechniqueCompareChart'
import CoverageDonutChart from './CoverageDonutChart'
import SeverityDonutChart from './SeverityDonutChart'
import CaseMixChart from './CaseMixChart'
import ChecklistProgressChart from './ChecklistProgressChart'
import RecordsPerObjectChart from './RecordsPerObjectChart'
import RoiSplitChart from './RoiSplitChart'
import PersonasChart from './PersonasChart'
import RcaSummaryChart from './RcaSummaryChart'
import ActivitySparkline from './ActivitySparkline'

/**
 * Map ``structured.kind`` (set by the backend parser registry) to the
 * React component that knows how to render that shape. Centralised
 * here so adding a new chart kind is a single import + entry; the
 * AgentInsightCard reads from this map without knowing the agent.
 */
export const AGENT_INSIGHT_REGISTRY = {
  exec_bars:          ExecBarsChart,
  closure_kpi:        ClosureKpiChart,
  technique_compare:  TechniqueCompareChart,
  coverage_donut:     CoverageDonutChart,
  severity_donut:     SeverityDonutChart,
  case_mix:           CaseMixChart,
  checklist:          ChecklistProgressChart,
  records_per_object: RecordsPerObjectChart,
  roi_split:          RoiSplitChart,
  personas:           PersonasChart,
  rca_summary:        RcaSummaryChart,
}

export {
  ActivitySparkline,
  ExecBarsChart,
  ClosureKpiChart,
  TechniqueCompareChart,
  CoverageDonutChart,
  SeverityDonutChart,
  CaseMixChart,
  ChecklistProgressChart,
  RecordsPerObjectChart,
  RoiSplitChart,
  PersonasChart,
  RcaSummaryChart,
}

/**
 * Return the chart component for a parsed ``structured`` payload, or
 * ``null`` when the kind is unknown (so the AgentInsightCard can fall
 * back to the activity sparkline without a special-case list).
 */
export function getInsightChart(structured) {
  if (!structured || !structured.kind) return null
  return AGENT_INSIGHT_REGISTRY[structured.kind] || null
}
