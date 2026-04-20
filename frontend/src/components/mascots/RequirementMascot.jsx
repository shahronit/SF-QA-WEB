import { motion, useReducedMotion } from 'framer-motion'

export default function RequirementMascot({ size = 64 }) {
  const reduce = useReducedMotion()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <motion.rect
        x="14" y="10" width="32" height="42" rx="4"
        fill="white" stroke="#1e293b" strokeWidth="2"
        initial={{ y: 0 }}
        animate={reduce ? undefined : { y: [0, -1, 0] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <line x1="20" y1="20" x2="40" y2="20" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="26" x2="38" y2="26" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="32" x2="35" y2="32" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="38" x2="40" y2="38" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
      <motion.g
        initial={{ rotate: 0 }}
        animate={reduce ? undefined : { rotate: [-6, 8, -6] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '44px 38px' }}
      >
        <circle cx="44" cy="38" r="10" fill="rgba(59,130,246,0.2)" stroke="#3b82f6" strokeWidth="3" />
        <line x1="51" y1="45" x2="58" y2="54" stroke="#1e293b" strokeWidth="3" strokeLinecap="round" />
      </motion.g>
    </svg>
  )
}
