import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mascot } from './mascots'
import Icon3D from './icons/Icon3D'
import AuroraBg from './motion/AuroraBg'
import { getAgent, getPhase } from '../config/agentMeta'
import api from '../api/client'

/**
 * Astound-branded page header. Uses the agent's iconKey3d + gradient text
 * over a deep aurora panel so every agent page opens with the same visual
 * grammar as the Hub hero. Falls back to a plain emoji + cream surface
 * when the caller doesn't pass an `agentName` (e.g. utility pages).
 */
export default function PageHeader({
  agentName,
  icon,
  title,
  subtitle,
  gradient = 'from-toon-blue to-sky-500',
}) {
  const meta = agentName ? getAgent(agentName) : null
  const phase = meta ? getPhase(meta.phaseId) : null

  const iconKey3d = meta?.iconKey3d
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

  // Resolve which (provider, model) THIS agent will actually run on
  // for the calling user. Lets us surface a small "admin override"
  // pill so the user understands why their Sidebar engine pick is
  // being bypassed for this one agent. Silently skips the request
  // when there's no agent slug (e.g. Hub / utility pages).
  const [effective, setEffective] = useState(null)
  useEffect(() => {
    if (!agentName) {
      setEffective(null)
      return
    }
    let cancelled = false
    api.get('/llm/effective', { params: { agent_name: agentName } })
      .then(({ data }) => { if (!cancelled) setEffective(data || null) })
      .catch(() => { if (!cancelled) setEffective(null) })
    return () => { cancelled = true }
  }, [agentName])

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="relative overflow-hidden rounded-toon-lg mb-6"
    >
      <div className="relative bg-astound-deep text-white p-6">
        <AuroraBg intensity="full" />

        <div className="relative z-10 flex items-start gap-4">
          <motion.div
            className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${finalGradient} backdrop-blur flex items-center justify-center text-2xl shadow-astound flex-shrink-0 ring-1 ring-white/20`}
            initial={{ scale: 0.6, rotate: -10 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
          >
            {iconKey3d
              ? <Icon3D name={iconKey3d} size={42} float tilt />
              : <span>{finalIcon}</span>}
          </motion.div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              {phase && (
                <motion.span
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="inline-block bg-white/10 backdrop-blur px-3 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-extrabold border border-white/15"
                >
                  {phase.label}
                </motion.span>
              )}
              {effective?.model && (
                <motion.span
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.18 }}
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                    effective.source === 'override'
                      ? 'bg-astound-magenta/20 border-astound-magenta/60 text-white'
                      : 'bg-white/10 border-white/15 text-white/90'
                  }`}
                  title={
                    effective.source === 'override'
                      ? `Pinned by admin to ${effective.provider} / ${effective.model} for this agent`
                      : `Global Sidebar selection: ${effective.provider} / ${effective.model}`
                  }
                >
                  <Icon3D name="sparkles" size={10} />
                  <span className="font-mono">{effective.model}</span>
                  {effective.source === 'override' && (
                    <span className="uppercase tracking-wider opacity-95">override</span>
                  )}
                </motion.span>
              )}
            </div>
            <motion.h1
              className="font-display text-2xl lg:text-3xl font-extrabold leading-tight"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
            >
              <span className="astound-text-grad">{finalTitle}</span>
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
                    <span className="inline-flex w-5 h-5 rounded-full bg-white/15 items-center justify-center">
                      <Icon3D name="sparkles" size={12} />
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
