import Counter from '../motion/Counter'
import ProgressRing from '../motion/ProgressRing'
import { parseClosureKpi } from './parsers'

export default function ClosureKpiGrid({ content }) {
  const data = parseClosureKpi(content)
  if (!data) return null
  const { passRate, defectsClosed, defectsOpen, automationPct, effortHrs } = data

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-center">
        {passRate != null && (
          <div className="flex justify-center">
            <ProgressRing value={passRate} size={150} stroke={14} gradientFrom="#8b5cf6" gradientTo="#a855f7" label="Pass rate" />
          </div>
        )}
        {automationPct != null && (
          <div className="flex justify-center">
            <ProgressRing value={automationPct} size={150} stroke={14} gradientFrom="#06b6d4" gradientTo="#0ea5e9" label="Automation" />
          </div>
        )}
        {defectsClosed != null && (
          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-400 text-white shadow-toon-mint">
            <div className="text-[11px] uppercase tracking-wider font-bold opacity-95">Defects Closed</div>
            <div className="text-4xl font-extrabold mt-2"><Counter to={defectsClosed} /></div>
            {defectsOpen != null && (
              <div className="text-xs mt-1 opacity-90">
                <Counter to={defectsOpen} /> open with workarounds
              </div>
            )}
          </div>
        )}
      </div>

      {effortHrs != null && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-500/10 to-purple-500/10">
          <div className="text-xs uppercase tracking-wider font-bold text-gray-500">Actual effort logged</div>
          <div className="text-3xl font-extrabold text-toon-navy mt-1">
            <Counter to={effortHrs} suffix=" hrs" />
          </div>
        </div>
      )}
    </div>
  )
}
