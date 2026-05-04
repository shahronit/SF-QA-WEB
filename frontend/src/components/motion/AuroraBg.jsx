import { motion, useReducedMotion } from 'framer-motion'

/**
 * Animated aurora-mesh backdrop used by the Login hero and Layout
 * shell. Two soft-blurred conic blobs drift independently over a deep
 * Astound surface, producing a subtle "northern lights" feel.
 *
 * Props
 * -----
 * intensity - 'full' (login hero) | 'soft' (Layout shell). Default 'soft'.
 * fixed     - render with `position: fixed` so it sits behind the whole app.
 *
 * Honours prefers-reduced-motion: when reduced, blobs render statically
 * and the conic mesh stops spinning. Pointer events are always disabled.
 */
export default function AuroraBg({ intensity = 'soft', fixed = false }) {
  const reduce = useReducedMotion()
  const opacity = intensity === 'full' ? 1 : 0.55

  const wrapperBase = fixed ? 'fixed' : 'absolute'

  return (
    <div
      aria-hidden
      className={`${wrapperBase} inset-0 overflow-hidden pointer-events-none`}
      style={{ opacity, zIndex: 0 }}
    >
      {/* Static conic mesh fallback / base layer. */}
      <div
        className="absolute inset-0 bg-astound-aurora"
      />

      {/* Slowly rotating conic glow on top of the mesh. */}
      {!reduce && (
        <motion.div
          className="absolute -inset-1/3 opacity-50 mix-blend-screen"
          style={{
            background:
              'conic-gradient(from 0deg, rgba(123,97,255,0.45), rgba(255,61,139,0.4), rgba(67,229,244,0.35), rgba(123,97,255,0.45))',
            filter: 'blur(80px)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 32, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Drifting accent blobs. */}
      <motion.div
        className="absolute w-[40rem] h-[40rem] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(255,61,139,0.45) 0%, transparent 65%)',
          filter: 'blur(60px)',
          top: '-10%',
          left: '-15%',
        }}
        animate={reduce ? {} : { x: [0, 60, -20, 0], y: [0, 30, 60, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute w-[34rem] h-[34rem] rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(67,229,244,0.4) 0%, transparent 65%)',
          filter: 'blur(60px)',
          bottom: '-15%',
          right: '-10%',
        }}
        animate={reduce ? {} : { x: [0, -50, 20, 0], y: [0, -30, -60, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}
