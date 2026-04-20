import { motion, useReducedMotion } from 'framer-motion'
import Counter from './Counter'

export default function BarStat({
  label,
  value = 0,
  total = 100,
  suffix = '',
  gradient = 'from-toon-blue to-sky-400',
  delay = 0,
  badge = null,
  highlight = false,
}) {
  const reduce = useReducedMotion()
  const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0
  const percentLabel = `${Math.round(pct * 100)}%`

  return (
    <div className={`p-3 rounded-2xl ${highlight ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border border-amber-200' : 'bg-white/60'}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-toon-navy">{label}</span>
          {badge && (
            <span className="text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full bg-amber-200 text-amber-700">
              {badge}
            </span>
          )}
        </div>
        <div className="text-sm font-extrabold text-toon-navy tabular-nums">
          <Counter to={value} suffix={suffix} />
          <span className="text-gray-400 font-semibold ml-2 text-xs">{percentLabel}</span>
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <motion.div
          className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
          initial={{ width: reduce ? `${pct * 100}%` : 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.9, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  )
}
