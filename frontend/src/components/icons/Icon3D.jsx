import { motion, useReducedMotion } from 'framer-motion'
import { useRef, useState } from 'react'

/**
 * <Icon3D name="testcase" size={36} float />
 *
 * Hand-authored "3D" SVG icons with multi-stop gradients, inner-glow
 * highlights, and a soft drop shadow so they read as gradient-rendered
 * isometric icons (no PNG bundle, no extra dependency, ~25 KB total
 * for the whole set).
 *
 * Props
 * -----
 * name   - one of the keys in ICONS below.
 * size   - rendered pixel size (square). Default 28.
 * float  - true => idle bobbing animation (1.5 px amplitude).
 * spin   - true => slow continuous rotation.
 * tilt   - true => mouse-tracked 3D tilt on hover (max 12 degrees).
 * className - extra Tailwind classes on the wrapper.
 *
 * All animations honour `prefers-reduced-motion` automatically via
 * framer-motion's `useReducedMotion` hook.
 */
export default function Icon3D({
  name,
  size = 28,
  float = false,
  spin = false,
  tilt = false,
  className = '',
}) {
  const reduce = useReducedMotion()
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const ref = useRef(null)

  const Renderer = ICONS[name] || ICONS.sparkles

  const handleMove = (e) => {
    if (!tilt || reduce || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    setTx(py * -12)
    setTy(px * 12)
  }
  const reset = () => { setTx(0); setTy(0) }

  const animate = {}
  const transition = {}
  if (!reduce) {
    if (float) {
      animate.y = [0, -1.5, 0]
      transition.y = { duration: 2.6, repeat: Infinity, ease: 'easeInOut' }
    }
    if (spin) {
      animate.rotate = [0, 360]
      transition.rotate = { duration: 14, repeat: Infinity, ease: 'linear' }
    }
  }

  return (
    <motion.span
      ref={ref}
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        width: size,
        height: size,
        perspective: 600,
        transformStyle: 'preserve-3d',
      }}
      animate={animate}
      transition={transition}
      onPointerMove={handleMove}
      onPointerLeave={reset}
    >
      <motion.span
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          transformStyle: 'preserve-3d',
        }}
        animate={tilt && !reduce ? { rotateX: tx, rotateY: ty } : { rotateX: 0, rotateY: 0 }}
        transition={{ type: 'spring', stiffness: 180, damping: 14 }}
      >
        <Renderer size={size} />
      </motion.span>
    </motion.span>
  )
}

// ---------------------------------------------------------------------------
// Shared SVG defs — drop shadow, inner highlight, etc. Each icon gets a
// unique gradient id so multiple icons on the same page don't share fills.
// ---------------------------------------------------------------------------

const DefsBase = ({ id, stops, shadow = true }) => (
  <defs>
    <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
      {stops.map((s, i) => (
        <stop key={i} offset={s.o} stopColor={s.c} />
      ))}
    </linearGradient>
    <radialGradient id={`${id}-hi`} cx="35%" cy="30%" r="55%">
      <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
      <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
    </radialGradient>
    {shadow && (
      <filter id={`${id}-shadow`} x="-30%" y="-10%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0F0E1A" floodOpacity="0.28" />
      </filter>
    )}
  </defs>
)

// ---------------------------------------------------------------------------
// Icon catalogue. Each is a small SVG with two layers: a coloured shape
// using the gradient fill, and a soft white highlight on top so it reads
// as 3D. Coordinates are tuned for a 64x64 viewBox.
// ---------------------------------------------------------------------------

const ICONS = {
  // Utility — Dashboard / home
  home: ({ size }) => {
    const id = 'i-home'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#7B61FF' }, { o: '100%', c: '#43E5F4' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M10 30 L32 10 L54 30 L54 50 Q54 56 48 56 L40 56 L40 42 Q40 38 36 38 L28 38 Q24 38 24 42 L24 56 L16 56 Q10 56 10 50 Z"
                fill={`url(#${id}-fill)`} />
          <path d="M10 30 L32 10 L54 30 L54 50 Q54 56 48 56 L40 56 L40 42 Q40 38 36 38 L28 38 Q24 38 24 42 L24 56 L16 56 Q10 56 10 50 Z"
                fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Utility — Projects (folder)
  folder: ({ size }) => {
    const id = 'i-folder'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FBBF24' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M8 18 Q8 12 14 12 L26 12 L32 18 L50 18 Q56 18 56 24 L56 48 Q56 54 50 54 L14 54 Q8 54 8 48 Z"
                fill={`url(#${id}-fill)`} />
          <path d="M8 18 Q8 12 14 12 L26 12 L32 18 L50 18 Q56 18 56 24 L56 48 Q56 54 50 54 L14 54 Q8 54 8 48 Z"
                fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Utility — History
  history: ({ size }) => {
    const id = 'i-history'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#43E5F4' }, { o: '100%', c: '#7B61FF' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <circle cx="32" cy="32" r="22" fill={`url(#${id}-fill)`} />
          <circle cx="32" cy="32" r="22" fill={`url(#${id}-hi)`} />
          <path d="M32 18 L32 32 L42 38" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    )
  },

  // Utility — Admin (shield)
  shield: ({ size }) => {
    const id = 'i-shield'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FF3D8B' }, { o: '100%', c: '#7B61FF' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M32 8 L52 16 L52 34 Q52 50 32 58 Q12 50 12 34 L12 16 Z"
                fill={`url(#${id}-fill)`} />
          <path d="M32 8 L52 16 L52 34 Q52 50 32 58 Q12 50 12 34 L12 16 Z"
                fill={`url(#${id}-hi)`} />
          <path d="M22 32 L29 39 L42 26" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </g>
      </svg>
    )
  },

  // Utility — Bell
  bell: ({ size }) => {
    const id = 'i-bell'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FBBF24' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M16 44 Q14 38 14 30 Q14 18 24 12 Q28 8 32 8 Q36 8 40 12 Q50 18 50 30 Q50 38 48 44 L52 50 L12 50 Z"
                fill={`url(#${id}-fill)`} />
          <path d="M16 44 Q14 38 14 30 Q14 18 24 12 Q28 8 32 8 Q36 8 40 12 Q50 18 50 30 Q50 38 48 44 L52 50 L12 50 Z"
                fill={`url(#${id}-hi)`} />
          <path d="M26 54 Q26 60 32 60 Q38 60 38 54 Z" fill={`url(#${id}-fill)`} />
        </g>
      </svg>
    )
  },

  // Utility — Sparkles (fallback / hero accent)
  sparkles: ({ size }) => {
    const id = 'i-sparkles'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#7B61FF' }, { o: '50%', c: '#FF3D8B' }, { o: '100%', c: '#43E5F4' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M32 6 L36 24 L54 28 L36 32 L32 50 L28 32 L10 28 L28 24 Z" fill={`url(#${id}-fill)`} />
          <path d="M32 6 L36 24 L54 28 L36 32 L32 50 L28 32 L10 28 L28 24 Z" fill={`url(#${id}-hi)`} />
          <circle cx="50" cy="50" r="4" fill="#fff" opacity="0.85" />
          <circle cx="14" cy="50" r="2.5" fill="#fff" opacity="0.7" />
        </g>
      </svg>
    )
  },

  // Agent — Requirements (clipboard with pen)
  requirement: ({ size }) => {
    const id = 'i-req'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#38BDF8' }, { o: '100%', c: '#7B61FF' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <rect x="14" y="12" width="36" height="44" rx="6" fill={`url(#${id}-fill)`} />
          <rect x="14" y="12" width="36" height="44" rx="6" fill={`url(#${id}-hi)`} />
          <rect x="22" y="8" width="20" height="10" rx="3" fill="#1E3A5F" opacity="0.65" />
          <rect x="20" y="26" width="24" height="3" rx="1.5" fill="#fff" opacity="0.85" />
          <rect x="20" y="34" width="20" height="3" rx="1.5" fill="#fff" opacity="0.7" />
          <rect x="20" y="42" width="16" height="3" rx="1.5" fill="#fff" opacity="0.55" />
        </g>
      </svg>
    )
  },

  // Agent — Test plan (rocket)
  test_plan: ({ size }) => {
    const id = 'i-tp'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#43E5F4' }, { o: '100%', c: '#7B61FF' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M32 6 Q44 14 44 32 L44 44 L20 44 L20 32 Q20 14 32 6 Z" fill={`url(#${id}-fill)`} />
          <path d="M32 6 Q44 14 44 32 L44 44 L20 44 L20 32 Q20 14 32 6 Z" fill={`url(#${id}-hi)`} />
          <circle cx="32" cy="26" r="5" fill="#fff" opacity="0.95" />
          <circle cx="32" cy="26" r="3" fill="#7B61FF" />
          <path d="M20 44 L14 56 L26 50 Z" fill="#FF3D8B" />
          <path d="M44 44 L50 56 L38 50 Z" fill="#FF3D8B" />
        </g>
      </svg>
    )
  },

  // Agent — Test cases (test tube)
  testcase: ({ size }) => {
    const id = 'i-tc'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#34D399' }, { o: '100%', c: '#43E5F4' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M22 8 L42 8 L42 14 L40 14 L40 46 Q40 56 32 56 Q24 56 24 46 L24 14 L22 14 Z" fill={`url(#${id}-fill)`} />
          <path d="M22 8 L42 8 L42 14 L40 14 L40 46 Q40 56 32 56 Q24 56 24 46 L24 14 L22 14 Z" fill={`url(#${id}-hi)`} />
          <circle cx="32" cy="42" r="3" fill="#fff" opacity="0.8" />
          <circle cx="29" cy="36" r="2" fill="#fff" opacity="0.6" />
          <circle cx="35" cy="38" r="1.6" fill="#fff" opacity="0.7" />
        </g>
      </svg>
    )
  },

  // Agent — Smoke test (cloud / fire)
  smoke: ({ size }) => {
    const id = 'i-smoke'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FBBF24' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M32 8 Q22 18 26 28 Q14 28 14 40 Q14 52 28 52 L40 52 Q54 52 54 40 Q54 30 44 28 Q48 18 32 8 Z" fill={`url(#${id}-fill)`} />
          <path d="M32 8 Q22 18 26 28 Q14 28 14 40 Q14 52 28 52 L40 52 Q54 52 54 40 Q54 30 44 28 Q48 18 32 8 Z" fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Agent — Regression (cycle arrows)
  regression: ({ size }) => {
    const id = 'i-reg'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#7B61FF' }, { o: '100%', c: '#1E3A5F' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M32 12 A20 20 0 0 1 52 32 L46 32 L54 42 L62 32 L56 32 A24 24 0 0 0 32 8 Z" fill={`url(#${id}-fill)`} />
          <path d="M32 52 A20 20 0 0 1 12 32 L18 32 L10 22 L2 32 L8 32 A24 24 0 0 0 32 56 Z" fill={`url(#${id}-fill)`} />
          <path d="M32 12 A20 20 0 0 1 52 32 L46 32 L54 42 L62 32 L56 32 A24 24 0 0 0 32 8 Z" fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Agent — Bug report (bug)
  bug_report: ({ size }) => {
    const id = 'i-bug'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#F87171' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <ellipse cx="32" cy="36" rx="14" ry="18" fill={`url(#${id}-fill)`} />
          <ellipse cx="32" cy="36" rx="14" ry="18" fill={`url(#${id}-hi)`} />
          <path d="M22 22 L14 14 M42 22 L50 14 M18 36 L8 36 M46 36 L56 36 M22 50 L14 56 M42 50 L50 56" stroke="#1E3A5F" strokeWidth="3" strokeLinecap="round" />
          <circle cx="27" cy="32" r="2" fill="#fff" />
          <circle cx="37" cy="32" r="2" fill="#fff" />
        </g>
      </svg>
    )
  },

  // Agent — Closure report (flag)
  closure_report: ({ size }) => {
    const id = 'i-cls'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#A78BFA' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <rect x="12" y="8" width="4" height="50" rx="2" fill="#1E3A5F" />
          <path d="M16 10 L52 10 L46 22 L52 34 L16 34 Z" fill={`url(#${id}-fill)`} />
          <path d="M16 10 L52 10 L46 22 L52 34 L16 34 Z" fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Agent — Effort estimation (chart bars)
  estimation: ({ size }) => {
    const id = 'i-est'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#A78BFA' }, { o: '100%', c: '#43E5F4' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <rect x="10" y="36" width="10" height="20" rx="3" fill={`url(#${id}-fill)`} />
          <rect x="27" y="22" width="10" height="34" rx="3" fill={`url(#${id}-fill)`} />
          <rect x="44" y="10" width="10" height="46" rx="3" fill={`url(#${id}-fill)`} />
          <rect x="10" y="36" width="10" height="20" rx="3" fill={`url(#${id}-hi)`} />
          <rect x="27" y="22" width="10" height="34" rx="3" fill={`url(#${id}-hi)`} />
          <rect x="44" y="10" width="10" height="46" rx="3" fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Agent — Automation plan (robot head)
  automation_plan: ({ size }) => {
    const id = 'i-bot'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FF3D8B' }, { o: '100%', c: '#7B61FF' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <rect x="14" y="18" width="36" height="32" rx="8" fill={`url(#${id}-fill)`} />
          <rect x="14" y="18" width="36" height="32" rx="8" fill={`url(#${id}-hi)`} />
          <circle cx="32" cy="12" r="3" fill="#FBBF24" />
          <line x1="32" y1="14" x2="32" y2="18" stroke="#1E3A5F" strokeWidth="2" />
          <circle cx="24" cy="32" r="4" fill="#fff" />
          <circle cx="40" cy="32" r="4" fill="#fff" />
          <circle cx="24" cy="32" r="2" fill="#1E3A5F" />
          <circle cx="40" cy="32" r="2" fill="#1E3A5F" />
          <rect x="22" y="40" width="20" height="3" rx="1.5" fill="#fff" opacity="0.8" />
        </g>
      </svg>
    )
  },

  // Agent — Test data (database)
  test_data: ({ size }) => {
    const id = 'i-data'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#34D399' }, { o: '100%', c: '#43E5F4' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <ellipse cx="32" cy="14" rx="20" ry="6" fill={`url(#${id}-fill)`} />
          <path d="M12 14 L12 30 Q12 36 32 36 Q52 36 52 30 L52 14" fill={`url(#${id}-fill)`} />
          <ellipse cx="32" cy="30" rx="20" ry="6" fill={`url(#${id}-hi)`} opacity="0.45" />
          <path d="M12 30 L12 46 Q12 52 32 52 Q52 52 52 46 L52 30" fill={`url(#${id}-fill)`} />
          <ellipse cx="32" cy="46" rx="20" ry="6" fill={`url(#${id}-hi)`} opacity="0.45" />
        </g>
      </svg>
    )
  },

  // Agent — RTM (compass / map)
  rtm: ({ size }) => {
    const id = 'i-rtm'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#43E5F4' }, { o: '100%', c: '#7B61FF' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <circle cx="32" cy="32" r="24" fill={`url(#${id}-fill)`} />
          <circle cx="32" cy="32" r="24" fill={`url(#${id}-hi)`} />
          <path d="M32 14 L40 32 L32 50 L24 32 Z" fill="#fff" />
          <circle cx="32" cy="32" r="3" fill="#1E3A5F" />
        </g>
      </svg>
    )
  },

  // Agent — Copado / lightning
  copado_script: ({ size }) => {
    const id = 'i-copado'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FBBF24' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <path d="M34 4 L14 36 L28 36 L24 60 L48 28 L34 28 Z" fill={`url(#${id}-fill)`} />
          <path d="M34 4 L14 36 L28 36 L24 60 L48 28 L34 28 Z" fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Agent — UAT (handshake)
  uat_plan: ({ size }) => {
    const id = 'i-uat'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FF3D8B' }, { o: '100%', c: '#A78BFA' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <circle cx="20" cy="22" r="8" fill={`url(#${id}-fill)`} />
          <circle cx="44" cy="22" r="8" fill={`url(#${id}-fill)`} />
          <path d="M8 50 Q8 36 20 36 Q26 36 30 40 Q34 36 44 36 Q56 36 56 50 L56 56 L8 56 Z" fill={`url(#${id}-fill)`} />
          <path d="M8 50 Q8 36 20 36 Q26 36 30 40 Q34 36 44 36 Q56 36 56 50 L56 56 L8 56 Z" fill={`url(#${id}-hi)`} />
        </g>
      </svg>
    )
  },

  // Agent — Execution report (line chart)
  exec_report: ({ size }) => {
    const id = 'i-exec'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#FBBF24' }, { o: '100%', c: '#F87171' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <rect x="8" y="8" width="48" height="48" rx="8" fill={`url(#${id}-fill)`} />
          <rect x="8" y="8" width="48" height="48" rx="8" fill={`url(#${id}-hi)`} />
          <path d="M14 44 L24 32 L34 38 L48 18" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <circle cx="14" cy="44" r="2.5" fill="#fff" />
          <circle cx="24" cy="32" r="2.5" fill="#fff" />
          <circle cx="34" cy="38" r="2.5" fill="#fff" />
          <circle cx="48" cy="18" r="2.5" fill="#fff" />
        </g>
      </svg>
    )
  },

  // Agent — RCA (magnifying glass)
  rca: ({ size }) => {
    const id = 'i-rca'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#F87171' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <circle cx="26" cy="26" r="16" fill={`url(#${id}-fill)`} />
          <circle cx="26" cy="26" r="16" fill={`url(#${id}-hi)`} />
          <circle cx="26" cy="26" r="9" fill="#1E3A5F" opacity="0.25" />
          <rect x="38" y="40" width="20" height="6" rx="3" fill={`url(#${id}-fill)`} transform="rotate(45 38 40)" />
        </g>
      </svg>
    )
  },

  // Agent — STLC pack (gift / package)
  stlc_pack: ({ size }) => {
    const id = 'i-stlc'
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <DefsBase id={id} stops={[{ o: '0%', c: '#7B61FF' }, { o: '100%', c: '#FF3D8B' }]} />
        <g filter={`url(#${id}-shadow)`}>
          <rect x="8" y="22" width="48" height="36" rx="6" fill={`url(#${id}-fill)`} />
          <rect x="8" y="22" width="48" height="36" rx="6" fill={`url(#${id}-hi)`} />
          <rect x="28" y="22" width="8" height="36" fill="#fff" opacity="0.9" />
          <rect x="8" y="34" width="48" height="6" fill="#fff" opacity="0.85" />
          <path d="M22 22 Q16 14 22 10 Q30 8 32 22 Q34 8 42 10 Q48 14 42 22 Z" fill={`url(#${id}-fill)`} />
        </g>
      </svg>
    )
  },
}

export const ICON3D_NAMES = Object.keys(ICONS)
