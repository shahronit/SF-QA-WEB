import { motion } from 'framer-motion'

export default function PageHeader({ icon, title, subtitle, gradient = 'from-toon-blue to-sky-500' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-4 mb-6"
    >
      <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-xl shadow-toon`}>
        {icon}
      </div>
      <div>
        <h1 className="text-2xl font-extrabold text-toon-navy">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
    </motion.div>
  )
}
