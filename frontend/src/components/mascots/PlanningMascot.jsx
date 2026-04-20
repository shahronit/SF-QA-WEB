import { motion, useReducedMotion } from 'framer-motion'

export default function PlanningMascot({ size = 64 }) {
  const reduce = useReducedMotion()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect x="12" y="12" width="34" height="44" rx="4" fill="white" stroke="#1e293b" strokeWidth="2" />
      <rect x="22" y="8" width="14" height="8" rx="2" fill="#6366f1" stroke="#1e293b" strokeWidth="2" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="18" y={24 + i * 10} width="3" height="3" rx="0.5" fill="white" stroke="#94a3b8" strokeWidth="1.5" />
          <motion.path
            d={`M18.4 ${25.5 + i * 10} L19.5 ${26.6 + i * 10} L21 ${24.8 + i * 10}`}
            stroke="#10b981"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: reduce ? 1 : 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.4, delay: 0.4 + i * 0.4, repeat: reduce ? 0 : Infinity, repeatDelay: 4 }}
          />
          <line x1="25" y1={25.5 + i * 10} x2={36 - i * 4} y2={25.5 + i * 10} stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ))}
    </svg>
  )
}
