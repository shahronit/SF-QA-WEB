import { useEffect, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'

const PIECES = ['✨', '🎉', '⭐', '💫', '🌟', '🎊']

export default function Confetti({ trigger = 0, count = 14, duration = 1200 }) {
  const reduce = useReducedMotion()
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!trigger || reduce) return
    setShow(true)
    const t = setTimeout(() => setShow(false), duration)
    return () => clearTimeout(t)
  }, [trigger, duration, reduce])

  if (reduce) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] overflow-hidden">
      <AnimatePresence>
        {show && (
          <>
            {Array.from({ length: count }).map((_, i) => {
              const piece = PIECES[i % PIECES.length]
              const startX = 20 + Math.random() * 60
              const dx = (Math.random() - 0.5) * 60
              const dy = -30 - Math.random() * 50
              const rot = (Math.random() - 0.5) * 360
              return (
                <motion.span
                  key={`${trigger}-${i}`}
                  className="absolute text-2xl select-none"
                  style={{ left: `${startX}vw`, bottom: '40vh' }}
                  initial={{ opacity: 0, scale: 0.4, rotate: 0 }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    scale: [0.4, 1.1, 1, 0.8],
                    x: [`0vw`, `${dx}vw`],
                    y: [`0vh`, `${dy}vh`],
                    rotate: rot,
                  }}
                  transition={{ duration: duration / 1000, ease: 'easeOut' }}
                  exit={{ opacity: 0 }}
                >
                  {piece}
                </motion.span>
              )
            })}
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
