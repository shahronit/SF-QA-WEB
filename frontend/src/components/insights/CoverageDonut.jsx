import ProgressRing from '../motion/ProgressRing'
import { parseCoverage } from './parsers'

export default function CoverageDonut({ content }) {
  const data = parseCoverage(content)
  if (!data) return null
  const { covered, partial, notCovered } = data

  return (
    <div className="flex flex-col sm:flex-row items-center gap-8">
      <ProgressRing
        value={covered}
        max={100}
        size={180}
        stroke={16}
        gradientFrom="#10b981"
        gradientTo="#06b6d4"
        label="Covered"
      />
      <div className="flex-1 space-y-3">
        {[
          { label: 'Covered', value: covered, color: 'bg-emerald-500' },
          { label: 'Partial', value: partial, color: 'bg-amber-400' },
          { label: 'Not Covered', value: notCovered, color: 'bg-rose-400' },
        ].map(row => (
          <div key={row.label} className="flex items-center gap-3">
            <span className={`w-3.5 h-3.5 rounded-full ${row.color}`} />
            <span className="flex-1 text-sm font-semibold text-toon-navy">{row.label}</span>
            <span className="text-sm font-extrabold text-toon-navy tabular-nums">{Math.round(row.value)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
