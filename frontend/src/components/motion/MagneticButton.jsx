import { motion, useReducedMotion } from 'framer-motion'
import { useRef, useState } from 'react'

/**
 * <MagneticButton radius={140} strength={0.4}>
 *   <button className="astound-btn-grad">Sign in</button>
 * </MagneticButton>
 *
 * Wraps any clickable element. On `pointermove` within `radius` px of
 * the button center, translates the inner content toward the cursor
 * with a spring. Falls back to a normal pass-through wrapper when the
 * user prefers reduced motion.
 *
 * Notes
 * -----
 * - The wrapper is `inline-block` so it doesn't disturb flex/grid
 *   parents; submit buttons inside <form> still trigger correctly.
 * - We don't intercept clicks: any `onClick`/`type="submit"` on the
 *   inner child fires normally.
 */
export default function MagneticButton({
  children,
  radius = 120,
  strength = 0.35,
  className = '',
}) {
  const reduce = useReducedMotion()
  const ref = useRef(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const onMove = (e) => {
    if (reduce || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = e.clientX - cx
    const dy = e.clientY - cy
    const dist = Math.hypot(dx, dy)
    if (dist > radius) {
      if (pos.x !== 0 || pos.y !== 0) setPos({ x: 0, y: 0 })
      return
    }
    setPos({ x: dx * strength, y: dy * strength })
  }
  const reset = () => setPos({ x: 0, y: 0 })

  return (
    <span
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={`inline-block ${className}`}
    >
      <motion.span
        className="inline-block"
        animate={{ x: pos.x, y: pos.y }}
        transition={{ type: 'spring', stiffness: 220, damping: 18, mass: 0.6 }}
      >
        {children}
      </motion.span>
    </span>
  )
}
