import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import FloatingShapes from './motion/FloatingShapes'
import { Mascot } from './mascots'
import { getAgent, getPhase } from '../config/agentMeta'

export default function PageHeader({
  agentName,
  icon,
  title,
  subtitle,
  gradient = 'from-toon-blue to-sky-500',
}) {
  const meta = agentName ? getAgent(agentName) : null
  const phase = meta ? getPhase(meta.phaseId) : null

  const finalIcon = icon || meta?.icon || '✨'
  const finalTitle = title || meta?.label || 'Agent'
  const finalSubtitle = subtitle || (phase ? phase.label : '')
  const finalGradient = meta?.gradient || gradient
  const hints = meta?.hints || []

  const [hintIdx, setHintIdx] = useState(0)
  useEffect(() => {
    if (hints.length < 2) return
    const id = setInterval(() => setHintIdx((i) => (i + 1) % hints.length), 5000)
    return () => clearInterval(id)
  }, [hints.length])

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-toon-lg mb-6"
    >
      <div className={`relative bg-gradient-to-br ${finalGradient} text-white p-6`}>
        <FloatingShapes count={3} palette="light" opacity={0.16} minSize={120} maxSize={260} />

        <div className="relative z-10 flex items-start gap-4">
          <motion.div
            className="w-14 h-14 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center text-2xl shadow-toon flex-shrink-0"
            initial={{ scale: 0.6, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
            whileHover={{ rotate: [0, -8, 8, 0], transition: { duration: 0.5 } }}
          >
            {finalIcon}
          </motion.div>

          <div className="flex-1 min-w-0">
            {phase && (
              <motion.span
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="inline-block bg-white/20 backdrop-blur px-3 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-extrabold mb-1.5"
              >
                {phase.label}
              </motion.span>
            )}
            <motion.h1
              className="text-2xl font-extrabold leading-tight"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              {finalTitle}
            </motion.h1>
            {finalSubtitle && !phase && (
              <motion.p
                className="text-sm opacity-90 mt-1"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 0.9, x: 0 }}
                transition={{ delay: 0.25 }}
              >
                {finalSubtitle}
              </motion.p>
            )}
            {hints.length > 0 && (
              <div className="mt-3 h-6 relative">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={hintIdx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="absolute inset-0 flex items-center gap-2 text-xs font-semibold opacity-95"
                  >
                    <span className="inline-flex w-5 h-5 rounded-full bg-white/25 items-center justify-center text-[11px]">
                      💡
                    </span>
                    <span className="truncate">{hints[hintIdx]}</span>
                  </motion.div>
                </AnimatePresence>
              </div>
            )}
          </div>

          {phase && (
            <div className="hidden md:block opacity-90 flex-shrink-0">
              <Mascot name={phase.mascot} size={64} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
