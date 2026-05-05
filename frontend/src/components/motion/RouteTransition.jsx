import { motion, useReducedMotion } from 'framer-motion'
import { useLocation } from 'react-router-dom'

/**
 * Lightweight per-route fade/slide animation.
 *
 * Why no <AnimatePresence mode="wait">?
 *   The previous implementation wrapped the route tree in
 *   <AnimatePresence mode="wait" initial={false}> with a motion.div keyed
 *   by `location.pathname`. That combination + React 18 StrictMode +
 *   framer-motion 11 + React Router 6's <Outlet /> regularly left the
 *   ENTERING motion.div stuck at the `initial` state ({opacity:0, y:12}),
 *   so the user saw a blank page on every navigation until they
 *   triggered any other state change (the classic "manual refresh fixes
 *   it" symptom). The root cause is that <Outlet /> renders the NEW
 *   route's content into BOTH the exiting and entering motion.div during
 *   the brief overlap, and AnimatePresence's exit-then-enter sequencing
 *   races with React's commit phase, occasionally dropping the new
 *   child's animation start.
 *
 * Fix: skip AnimatePresence entirely and key the motion.div directly by
 * `location.pathname`. React unmounts the old tree and mounts a fresh
 * one synchronously, so the new motion.div always runs its
 * `initial → animate` transition on commit. No exit animation, no
 * waiting, no race — the new page paints immediately.
 */
export default function RouteTransition({ children }) {
  const location = useLocation()
  const reduce = useReducedMotion()

  if (reduce) {
    return <div key={location.pathname}>{children}</div>
  }

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}
