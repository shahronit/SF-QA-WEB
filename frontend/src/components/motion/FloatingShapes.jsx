import { useMemo } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

const PALETTES = {
  default: ['bg-toon-blue', 'bg-toon-coral', 'bg-toon-purple', 'bg-toon-yellow', 'bg-toon-mint'],
  cool: ['bg-sky-400', 'bg-indigo-400', 'bg-cyan-400', 'bg-blue-300'],
  warm: ['bg-rose-400', 'bg-orange-300', 'bg-amber-300', 'bg-pink-400'],
  light: ['bg-white', 'bg-white', 'bg-toon-yellow'],
}

export default function FloatingShapes({
  count = 4,
  palette = 'default',
  className = '',
  opacity = 0.18,
  minSize = 140,
  maxSize = 260,
  blur = true,
}) {
  const reduce = useReducedMotion()
  const colors = PALETTES[palette] || PALETTES.default

  const shapes = useMemo(() => {
    return Array.from({ length: count }).map((_, i) => {
      const size = Math.round(minSize + Math.random() * (maxSize - minSize))
      return {
        size,
        color: colors[i % colors.length],
        top: `${Math.round(Math.random() * 80) - 10}%`,
        left: `${Math.round(Math.random() * 80) - 10}%`,
        dx: 10 + Math.random() * 30,
        dy: 10 + Math.random() * 25,
        duration: 14 + Math.random() * 10,
        delay: Math.random() * 4,
      }
    })
  }, [count, palette, minSize, maxSize, colors])

  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {shapes.map((s, i) => (
        <motion.div
          key={i}
          className={`absolute rounded-full ${s.color} ${blur ? 'blur-3xl' : ''}`}
          style={{
            width: s.size,
            height: s.size,
            top: s.top,
            left: s.left,
            opacity,
          }}
          animate={
            reduce
              ? undefined
              : {
                  x: [0, s.dx, -s.dx * 0.6, 0],
                  y: [0, -s.dy, s.dy * 0.7, 0],
                }
          }
          transition={{
            repeat: Infinity,
            duration: s.duration,
            ease: 'easeInOut',
            delay: s.delay,
          }}
        />
      ))}
    </div>
  )
}
