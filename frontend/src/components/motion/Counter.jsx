import { useEffect, useRef } from 'react'
import { animate, useMotionValue, useTransform, useReducedMotion } from 'framer-motion'

export default function Counter({
  to = 0,
  from = 0,
  duration = 0.9,
  decimals = 0,
  suffix = '',
  prefix = '',
  className = '',
}) {
  const reduce = useReducedMotion()
  const mv = useMotionValue(reduce ? to : from)
  const rounded = useTransform(mv, (v) => {
    const n = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()
    return `${prefix}${n}${suffix}`
  })
  const ref = useRef(null)

  useEffect(() => {
    if (reduce) {
      if (ref.current) ref.current.textContent = `${prefix}${decimals > 0 ? to.toFixed(decimals) : Math.round(to).toLocaleString()}${suffix}`
      return
    }
    const controls = animate(mv, to, { duration, ease: [0.16, 1, 0.3, 1] })
    const unsub = rounded.on('change', (v) => {
      if (ref.current) ref.current.textContent = v
    })
    return () => {
      controls.stop()
      unsub()
    }
  }, [to, duration, decimals, prefix, suffix, reduce, mv, rounded])

  return <span ref={ref} className={className}>{`${prefix}0${suffix}`}</span>
}
