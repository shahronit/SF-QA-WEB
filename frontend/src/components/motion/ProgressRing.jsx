import { motion, useReducedMotion } from 'framer-motion'
import Counter from './Counter'

export default function ProgressRing({
  value = 0,
  max = 100,
  size = 140,
  stroke = 12,
  gradientFrom = '#10b981',
  gradientTo = '#06b6d4',
  trackColor = '#e5e7eb',
  label = '',
  suffix = '%',
}) {
  const reduce = useReducedMotion()
  const pct = Math.max(0, Math.min(1, value / max))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const dash = c * pct
  const gid = `pr-grad-${Math.round(Math.random() * 1e6)}`

  return (
    <div className="inline-flex flex-col items-center justify-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <defs>
            <linearGradient id={gid} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradientFrom} />
              <stop offset="100%" stopColor={gradientTo} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={`url(#${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${c} ${c}`}
            initial={{ strokeDashoffset: reduce ? c - dash : c }}
            animate={{ strokeDashoffset: c - dash }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-extrabold text-toon-navy">
            <Counter to={Math.round(value)} suffix={suffix} />
          </div>
          {label && <div className="text-[11px] uppercase tracking-wider text-gray-400 font-bold mt-0.5">{label}</div>}
        </div>
      </div>
    </div>
  )
}
