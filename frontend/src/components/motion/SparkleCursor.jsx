import { useEffect, useRef } from 'react'

/**
 * Small canvas overlay that emits gradient sparkles trailing the cursor.
 * Used only on the Login page to echo the reference portal's sparkle
 * motif without imposing a global perf cost.
 *
 * Honours `prefers-reduced-motion`: renders nothing in that case.
 */
export default function SparkleCursor() {
  const canvasRef = useRef(null)
  const sparkles = useRef([])
  const rafRef = useRef(0)
  const reduceRef = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reduceRef.current = !!mq?.matches
    if (reduceRef.current) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    const COLORS = ['#7B61FF', '#FF3D8B', '#43E5F4']

    const onMove = (e) => {
      if (sparkles.current.length > 80) return
      // Emit 1 sparkle every few mousemoves; rng-throttle so the field
      // looks alive but not noisy.
      if (Math.random() > 0.45) {
        sparkles.current.push({
          x: e.clientX + (Math.random() - 0.5) * 8,
          y: e.clientY + (Math.random() - 0.5) * 8,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -0.4 - Math.random() * 0.6,
          life: 0,
          ttl: 60 + Math.random() * 30,
          size: 1.5 + Math.random() * 2.5,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        })
      }
    }
    window.addEventListener('pointermove', onMove)

    const tick = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      sparkles.current = sparkles.current.filter((s) => s.life < s.ttl)
      for (const s of sparkles.current) {
        s.life += 1
        s.x += s.vx
        s.y += s.vy
        const alpha = 1 - s.life / s.ttl
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size * alpha, 0, Math.PI * 2)
        ctx.fillStyle = s.color
        ctx.globalAlpha = alpha * 0.85
        ctx.shadowBlur = 12
        ctx.shadowColor = s.color
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.shadowBlur = 0
      rafRef.current = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  if (reduceRef.current) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 50, mixBlendMode: 'screen' }}
    />
  )
}
