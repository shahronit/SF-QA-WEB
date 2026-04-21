import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

/**
 * GeneratingScene
 *
 * Self-contained "3D-style" SVG scene of a stylized boy hunched over a
 * laptop, used as a waiting / loading visual while an AI agent streams
 * its result. No external assets, no network calls, no extra deps.
 *
 * The illusion of depth comes from:
 *   - CSS perspective + a slow rotateY on the desk surface
 *   - Layered SVG with isometric-ish skew on the laptop and floor
 *   - Soft layered drop-shadows under the figure and laptop
 *   - Multiple animated layers (head bob, hands typing, screen lines,
 *     ambient sparkles, floating thought bubbles)
 *
 * Props:
 *   - size: 'lg' (default, full hero) | 'sm' (compact header banner)
 *   - caption: optional override of the default caption
 *   - subCaption: optional sub-line (defaults to a rotating tip)
 */

const TIPS = [
  'Drafting structured Markdown tables…',
  'Cross-checking against your inputs…',
  'Inferring sensible defaults for blank fields…',
  'Polishing the report for stakeholders…',
  'Almost there — finalising the output…',
]

export default function GeneratingScene({
  size = 'lg',
  caption,
  subCaption,
}) {
  const reduce = useReducedMotion()
  const [tipIdx, setTipIdx] = useState(0)

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setTipIdx((i) => (i + 1) % TIPS.length), 2400)
    return () => clearInterval(id)
  }, [reduce])

  const isLg = size === 'lg'
  const sceneHeight = isLg ? 260 : 130
  const sceneWidth = isLg ? 320 : 180

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`toon-card ${isLg ? 'mt-6 px-6 py-8 sm:py-10' : 'mt-4 px-4 py-3'} flex ${isLg ? 'flex-col' : 'flex-row'} items-center justify-center gap-${isLg ? '6' : '4'}`}
    >
      <div
        className="relative shrink-0"
        style={{
          width: sceneWidth,
          height: sceneHeight,
          perspective: '900px',
          perspectiveOrigin: '50% 70%',
        }}
      >
        <Scene reduce={reduce} sceneWidth={sceneWidth} sceneHeight={sceneHeight} />
      </div>

      <div className={`text-center ${isLg ? '' : 'text-left'}`}>
        <motion.h3
          className={`font-extrabold text-toon-navy ${isLg ? 'text-2xl' : 'text-base'}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.15 }}
        >
          {caption || (isLg ? 'AI agent is generating your report…' : 'Generating…')}
        </motion.h3>
        {isLg && (
          <motion.p
            key={tipIdx}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="mt-2 text-sm text-gray-500 min-h-[1.25rem]"
          >
            {subCaption || TIPS[tipIdx]}
          </motion.p>
        )}
        <ShimmerDots reduce={reduce} compact={!isLg} />
      </div>
    </motion.div>
  )
}

/* ---------------------------------------------------------------- */
/* The 3D-ish boy + laptop scene                                     */
/* ---------------------------------------------------------------- */

function Scene({ reduce, sceneWidth, sceneHeight }) {
  // 3D wobble on the whole stage gives the "isometric / live render" feel
  const stageAnim = reduce
    ? { rotateY: 0, rotateX: 0 }
    : {
        rotateY: [-6, 6, -6],
        rotateX: [-2, 2, -2],
      }

  return (
    <motion.div
      className="absolute inset-0"
      style={{ transformStyle: 'preserve-3d' }}
      animate={stageAnim}
      transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Ambient sparkles floating around the figure */}
      {!reduce && <Sparkles width={sceneWidth} height={sceneHeight} />}

      <svg
        viewBox="0 0 320 260"
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          {/* Shadow under everything for grounding */}
          <radialGradient id="floorShadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(30, 58, 95, 0.30)" />
            <stop offset="70%" stopColor="rgba(30, 58, 95, 0.08)" />
            <stop offset="100%" stopColor="rgba(30, 58, 95, 0)" />
          </radialGradient>

          {/* Body / hoodie */}
          <linearGradient id="hoodie" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#60A5FA" />
            <stop offset="100%" stopColor="#2563EB" />
          </linearGradient>

          {/* Skin */}
          <linearGradient id="skin" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFD7B5" />
            <stop offset="100%" stopColor="#F0B98B" />
          </linearGradient>

          {/* Hair */}
          <linearGradient id="hair" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3B2A1F" />
            <stop offset="100%" stopColor="#1F140C" />
          </linearGradient>

          {/* Laptop body */}
          <linearGradient id="laptopBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E5E7EB" />
            <stop offset="100%" stopColor="#9CA3AF" />
          </linearGradient>

          {/* Laptop screen glow */}
          <linearGradient id="screen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1E3A5F" />
            <stop offset="100%" stopColor="#0F172A" />
          </linearGradient>

          <linearGradient id="screenGlow" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#A78BFA" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Floor / contact shadow ellipse */}
        <ellipse cx="160" cy="240" rx="110" ry="14" fill="url(#floorShadow)" />

        {/* ============== Body bob group ==============
             Whole character + laptop bobs gently as if breathing */}
        <motion.g
          animate={reduce ? {} : { y: [0, -2, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          {/* Legs (drawn flat under the desk implication) */}
          <path
            d="M118 215 L118 232 Q118 240 126 240 L150 240 Q158 240 158 232 L158 215 Z"
            fill="#1E3A5F"
            opacity="0.85"
          />
          <path
            d="M162 215 L162 232 Q162 240 170 240 L196 240 Q204 240 204 232 L204 215 Z"
            fill="#1E3A5F"
            opacity="0.85"
          />

          {/* Torso / hoodie */}
          <path
            d="M108 158
               Q108 138 130 134
               L190 134
               Q212 138 212 158
               L212 218
               Q212 226 204 226
               L116 226
               Q108 226 108 218 Z"
            fill="url(#hoodie)"
          />

          {/* Hoodie chest stripe / drawstring */}
          <path
            d="M156 144 L156 168 M164 144 L164 168"
            stroke="#1E3A5F"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.65"
          />

          {/* Neck */}
          <rect x="148" y="118" width="24" height="20" rx="6" fill="url(#skin)" />

          {/* ============= Head with subtle bob ============= */}
          <motion.g
            animate={
              reduce
                ? {}
                : {
                    rotate: [-3, 3, -3],
                    y: [0, -1.5, 0],
                  }
            }
            transition={{
              duration: 3.2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            style={{ transformOrigin: '160px 110px' }}
          >
            {/* Head */}
            <ellipse cx="160" cy="100" rx="34" ry="36" fill="url(#skin)" />

            {/* Hair cap */}
            <path
              d="M126 96
                 Q126 64 160 62
                 Q194 64 194 96
                 Q194 84 184 80
                 Q176 92 160 92
                 Q144 92 136 80
                 Q126 84 126 96 Z"
              fill="url(#hair)"
            />

            {/* Ear */}
            <ellipse cx="127" cy="105" rx="4" ry="6" fill="url(#skin)" />

            {/* Eyes (blink) */}
            <Eye cx={148} cy={106} reduce={reduce} delay={0} />
            <Eye cx={170} cy={106} reduce={reduce} delay={0.2} />

            {/* Brow concentration line */}
            <path
              d="M144 96 Q148 92 152 96"
              stroke="#1F140C"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />
            <path
              d="M166 96 Q170 92 174 96"
              stroke="#1F140C"
              strokeWidth="1.6"
              fill="none"
              strokeLinecap="round"
            />

            {/* Mouth — small focused line */}
            <path
              d="M152 122 Q160 126 168 122"
              stroke="#7C2D12"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />

            {/* Headphones arc — gives a "developer" vibe */}
            <path
              d="M124 96 Q160 60 196 96"
              stroke="#1E3A5F"
              strokeWidth="6"
              fill="none"
              strokeLinecap="round"
              opacity="0.85"
            />
            <rect x="118" y="92" width="10" height="22" rx="4" fill="#1E3A5F" />
            <rect x="192" y="92" width="10" height="22" rx="4" fill="#1E3A5F" />
          </motion.g>

          {/* ============= Arms ============= */}
          {/* Left arm */}
          <path
            d="M112 168
               Q98 188 110 210
               Q116 218 128 214
               L142 196
               Q132 184 124 178 Z"
            fill="url(#hoodie)"
          />
          {/* Right arm */}
          <path
            d="M208 168
               Q222 188 210 210
               Q204 218 192 214
               L178 196
               Q188 184 196 178 Z"
            fill="url(#hoodie)"
          />

          {/* ============= Hands typing ============= */}
          <TypingHand cx={132} cy={210} reduce={reduce} delay={0} />
          <TypingHand cx={188} cy={210} reduce={reduce} delay={0.18} />
        </motion.g>

        {/* ============== Laptop ============== */}
        <g>
          {/* Base / keyboard plate — slight perspective via skew */}
          <g transform="translate(88,206) skewX(-8)">
            <rect width="144" height="14" rx="3" fill="url(#laptopBody)" />
            <rect width="144" height="3" y="11" rx="1.5" fill="#6B7280" />
          </g>

          {/* Lid (screen) — drawn as an upright trapezoid */}
          <g transform="translate(96,148)">
            <path
              d="M0 60 L12 0 L116 0 L128 60 Z"
              fill="#374151"
            />
            <rect x="14" y="4" width="100" height="52" rx="3" fill="url(#screen)" />
            {/* Glow overlay */}
            <rect x="14" y="4" width="100" height="52" rx="3" fill="url(#screenGlow)" opacity="0.6" />
            {/* Streaming code lines */}
            <ScreenLines reduce={reduce} />
            {/* Webcam dot */}
            <circle cx="64" cy="2" r="1.2" fill="#9CA3AF" />
          </g>
        </g>

        {/* ============== Thought bubble with ✨ ============== */}
        {!reduce && <ThoughtBubble />}
      </svg>
    </motion.div>
  )
}

/* ---------------- Sub-components ---------------- */

function Eye({ cx, cy, reduce, delay }) {
  if (reduce) {
    return <circle cx={cx} cy={cy} r="3" fill="#1F140C" />
  }
  return (
    <motion.ellipse
      cx={cx}
      cy={cy}
      rx="3"
      ry="3"
      fill="#1F140C"
      animate={{ ry: [3, 0.4, 3, 3, 3] }}
      transition={{
        duration: 4.5,
        repeat: Infinity,
        times: [0, 0.05, 0.1, 0.95, 1],
        ease: 'easeInOut',
        delay,
      }}
    />
  )
}

function TypingHand({ cx, cy, reduce, delay }) {
  return (
    <motion.g
      animate={
        reduce
          ? {}
          : {
              y: [0, -3, 0, -2, 0],
              rotate: [0, -4, 0, 3, 0],
            }
      }
      transition={{
        duration: 0.65,
        repeat: Infinity,
        ease: 'easeInOut',
        delay,
      }}
      style={{ transformOrigin: `${cx}px ${cy}px` }}
    >
      <ellipse cx={cx} cy={cy} rx="11" ry="8" fill="url(#skin)" />
    </motion.g>
  )
}

function ScreenLines({ reduce }) {
  // Ten faux "code lines" with varied widths that pulse into existence
  // top-to-bottom, evoking streaming output.
  const lines = [
    { x: 20, w: 60, color: '#38BDF8' },
    { x: 22, w: 78, color: '#A78BFA' },
    { x: 24, w: 50, color: '#34D399' },
    { x: 22, w: 84, color: '#F87171' },
    { x: 20, w: 70, color: '#38BDF8' },
    { x: 24, w: 58, color: '#FBBF24' },
    { x: 22, w: 88, color: '#A78BFA' },
    { x: 20, w: 64, color: '#34D399' },
  ]
  return (
    <g>
      {lines.map((l, i) => (
        <motion.rect
          key={i}
          x={l.x}
          y={12 + i * 5.5}
          height="3"
          rx="1.5"
          fill={l.color}
          initial={{ width: 0, opacity: 0.2 }}
          animate={
            reduce
              ? { width: l.w, opacity: 0.7 }
              : { width: [0, l.w, l.w, 0], opacity: [0.25, 0.95, 0.95, 0.25] }
          }
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.12,
            times: [0, 0.45, 0.85, 1],
          }}
        />
      ))}
    </g>
  )
}

function Sparkles({ width, height }) {
  // A handful of floating sparkles that drift and twinkle
  const items = [
    { left: '8%', top: '10%', size: 14, delay: 0, dur: 3.4 },
    { left: '82%', top: '14%', size: 12, delay: 0.4, dur: 3.0 },
    { left: '90%', top: '50%', size: 10, delay: 1.0, dur: 4.0 },
    { left: '4%', top: '60%', size: 11, delay: 1.6, dur: 3.6 },
    { left: '70%', top: '4%', size: 9, delay: 0.8, dur: 4.2 },
  ]
  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      style={{ width, height }}
    >
      {items.map((it, i) => (
        <motion.span
          key={i}
          className="absolute select-none"
          style={{ left: it.left, top: it.top, fontSize: it.size }}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{
            opacity: [0, 1, 1, 0],
            scale: [0.6, 1, 1, 0.6],
            y: [0, -10, -16, -22],
            rotate: [0, 12, -8, 0],
          }}
          transition={{
            duration: it.dur,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: it.delay,
          }}
        >
          ✨
        </motion.span>
      ))}
    </div>
  )
}

function ThoughtBubble() {
  return (
    <motion.g
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: [0, 1, 1, 0], y: [4, 0, -2, -8] }}
      transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <circle cx="222" cy="52" r="3" fill="#FFF" stroke="#CBD5E1" strokeWidth="1" />
      <circle cx="232" cy="44" r="5" fill="#FFF" stroke="#CBD5E1" strokeWidth="1" />
      <ellipse cx="252" cy="30" rx="22" ry="14" fill="#FFF" stroke="#CBD5E1" strokeWidth="1" />
      <text
        x="252"
        y="34"
        textAnchor="middle"
        fontSize="14"
        fill="#1E3A5F"
        fontWeight="700"
      >
        ⚙️ AI
      </text>
    </motion.g>
  )
}

function ShimmerDots({ reduce, compact = false }) {
  return (
    <div
      className={`mt-${compact ? '1' : '3'} flex items-center justify-center gap-1.5`}
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className={`inline-block ${compact ? 'w-1.5 h-1.5' : 'w-2 h-2'} rounded-full bg-toon-blue`}
          animate={
            reduce
              ? { opacity: 0.6 }
              : { y: [0, -4, 0], opacity: [0.4, 1, 0.4] }
          }
          transition={{
            duration: 0.9,
            repeat: Infinity,
            delay: i * 0.12,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  )
}
