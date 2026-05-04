import { motion, useReducedMotion } from 'framer-motion'
import { useRef, useState } from 'react'

/**
 * <Tilt3D max={8} glare>
 *   <div className="astound-card-light">…</div>
 * </Tilt3D>
 *
 * Wraps a card-shaped child. On hover, rotates the card on its X/Y
 * axes based on cursor position (max ±`max` degrees) with a smooth
 * spring. Optionally overlays a glossy specular highlight that tracks
 * the cursor too.
 *
 * Honours prefers-reduced-motion (renders the child untouched).
 */
export default function Tilt3D({
  children,
  max = 8,
  glare = true,
  className = '',
}) {
  const reduce = useReducedMotion()
  const ref = useRef(null)
  const [tilt, setTilt] = useState({ x: 0, y: 0, gx: 50, gy: 50 })

  if (reduce) {
    return <div className={className}>{children}</div>
  }

  const onMove = (e) => {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width
    const py = (e.clientY - rect.top) / rect.height
    setTilt({
      x: (py - 0.5) * -2 * max,
      y: (px - 0.5) * 2 * max,
      gx: px * 100,
      gy: py * 100,
    })
  }
  const reset = () => setTilt({ x: 0, y: 0, gx: 50, gy: 50 })

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={`relative ${className}`}
      style={{ perspective: 1000, transformStyle: 'preserve-3d' }}
      animate={{ rotateX: tilt.x, rotateY: tilt.y }}
      transition={{ type: 'spring', stiffness: 180, damping: 16 }}
    >
      {children}
      {glare && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-200"
          style={{
            background: `radial-gradient(circle at ${tilt.gx}% ${tilt.gy}%, rgba(255,255,255,0.35), transparent 55%)`,
            opacity: tilt.x === 0 && tilt.y === 0 ? 0 : 0.7,
            mixBlendMode: 'overlay',
          }}
        />
      )}
    </motion.div>
  )
}
