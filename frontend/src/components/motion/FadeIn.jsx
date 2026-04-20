import { motion, useReducedMotion } from 'framer-motion'

export default function FadeIn({
  children,
  delay = 0,
  duration = 0.45,
  y = 12,
  x = 0,
  className = '',
  as = 'div',
}) {
  const reduce = useReducedMotion()
  const Comp = motion[as] || motion.div
  if (reduce) {
    return <Comp className={className}>{children}</Comp>
  }
  return (
    <Comp
      initial={{ opacity: 0, y, x }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{ duration, ease: [0.16, 1, 0.3, 1], delay }}
      className={className}
    >
      {children}
    </Comp>
  )
}
