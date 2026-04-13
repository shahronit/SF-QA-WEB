import { motion } from 'framer-motion'

export default function ToonCard({ children, className = '', delay = 0, onClick }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay }}
      whileHover={{ y: -4, boxShadow: '0 12px 40px rgba(56,189,248,0.18)' }}
      className={`toon-card ${className}`}
      onClick={onClick}
    >
      {children}
    </motion.div>
  )
}
