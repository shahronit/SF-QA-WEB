import { motion, useReducedMotion } from 'framer-motion'

export default function ExecutionMascot({ size = 64 }) {
  const reduce = useReducedMotion()
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <motion.g
        initial={{ y: 0 }}
        animate={reduce ? undefined : { y: [0, -3, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path
          d="M32 8 Q40 14 40 28 L40 40 L24 40 L24 28 Q24 14 32 8 Z"
          fill="white"
          stroke="#1e293b"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="32" cy="24" r="4" fill="rgba(249,115,22,0.4)" stroke="#1e293b" strokeWidth="1.6" />
        <path d="M24 38 L18 48 L26 44 Z" fill="white" stroke="#1e293b" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M40 38 L46 48 L38 44 Z" fill="white" stroke="#1e293b" strokeWidth="1.6" strokeLinejoin="round" />
      </motion.g>
      <motion.path
        d="M28 42 Q30 50 28 56 M32 42 Q34 52 32 58 M36 42 Q38 50 36 56"
        stroke="#f97316"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        initial={{ opacity: 0.6, scaleY: 0.9 }}
        animate={reduce ? undefined : { opacity: [0.6, 1, 0.6], scaleY: [0.85, 1.15, 0.9] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: '32px 42px' }}
      />
    </svg>
  )
}
