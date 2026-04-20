import { motion, useReducedMotion } from 'framer-motion'

export default function DesignMascot({ size = 64 }) {
  const reduce = useReducedMotion()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <motion.g
        initial={{ rotate: 0 }}
        animate={reduce ? undefined : { rotate: [-4, 4, -4] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '32px 32px' }}
      >
        <path
          d="M22 8 L22 32 L14 50 Q14 56 20 56 L44 56 Q50 56 50 50 L42 32 L42 8 Z"
          fill="rgba(16,185,129,0.18)"
          stroke="#1e293b"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <line x1="22" y1="8" x2="42" y2="8" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
        <rect x="14" y="38" width="36" height="14" rx="0" fill="rgba(16,185,129,0.4)" />
      </motion.g>
      {[0, 1, 2].map((i) => (
        <motion.circle
          key={i}
          cx={26 + i * 6}
          cy={42}
          r={2 + (i % 2)}
          fill="white"
          stroke="#10b981"
          strokeWidth="1.4"
          initial={{ y: 0, opacity: 0 }}
          animate={reduce ? { opacity: 1 } : { y: [-4, -20], opacity: [0, 1, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }}
        />
      ))}
    </svg>
  )
}
