import { motion, useReducedMotion } from 'framer-motion'

export default function ClosureMascot({ size = 64 }) {
  const reduce = useReducedMotion()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <motion.g
        initial={{ y: 0 }}
        animate={reduce ? undefined : { y: [0, -1.5, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M22 14 L42 14 L42 24 Q42 32 32 34 Q22 32 22 24 Z"
          fill="rgba(245,158,11,0.7)"
          stroke="#1e293b"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M42 18 Q50 18 50 24 Q50 28 44 28" stroke="#1e293b" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M22 18 Q14 18 14 24 Q14 28 20 28" stroke="#1e293b" strokeWidth="2" fill="none" strokeLinecap="round" />
        <rect x="28" y="34" width="8" height="8" fill="rgba(245,158,11,0.7)" stroke="#1e293b" strokeWidth="2" />
        <rect x="20" y="42" width="24" height="6" rx="1" fill="#fde68a" stroke="#1e293b" strokeWidth="2" />
        <rect x="16" y="48" width="32" height="4" rx="1" fill="#1e293b" />
      </motion.g>
      {[
        { x: 12, y: 14, d: 0 },
        { x: 50, y: 12, d: 0.6 },
        { x: 14, y: 36, d: 1.2 },
        { x: 52, y: 38, d: 1.8 },
      ].map((s, i) => (
        <motion.g
          key={i}
          initial={{ scale: 0, opacity: 0 }}
          animate={reduce ? { scale: 1, opacity: 1 } : { scale: [0, 1, 0], opacity: [0, 1, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: s.d, ease: 'easeOut' }}
          style={{ transformOrigin: `${s.x}px ${s.y}px` }}
        >
          <path d={`M${s.x} ${s.y - 3} L${s.x + 1} ${s.y - 1} L${s.x + 3} ${s.y} L${s.x + 1} ${s.y + 1} L${s.x} ${s.y + 3} L${s.x - 1} ${s.y + 1} L${s.x - 3} ${s.y} L${s.x - 1} ${s.y - 1} Z`} fill="#fcd34d" />
        </motion.g>
      ))}
    </svg>
  )
}
