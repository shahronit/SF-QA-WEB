import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import ToonCard from '../components/ToonCard'
import logo from '../assets/logo.png'

const tiles = [
  { path: '/projects', icon: '📂', title: 'Projects', desc: 'Manage project docs & scope', gradient: 'from-toon-blue to-sky-500', shadow: 'shadow-toon' },
  { path: '/requirements', icon: '📝', title: 'Requirements', desc: 'User stories to analysis', gradient: 'from-blue-600 to-blue-500', shadow: 'shadow-toon' },
  { path: '/testcases', icon: '🧪', title: 'Test Cases', desc: 'Generate coverage tables', gradient: 'from-toon-mint to-emerald-400', shadow: 'shadow-toon-mint' },
  { path: '/bugs', icon: '🐛', title: 'Bug Reports', desc: 'AI-assisted defect reports', gradient: 'from-toon-coral to-red-400', shadow: 'shadow-toon-coral' },
  { path: '/smoke', icon: '💨', title: 'Smoke Tests', desc: 'Post-release validation', gradient: 'from-orange-400 to-toon-yellow', shadow: 'shadow-toon-yellow' },
  { path: '/regression', icon: '🔄', title: 'Regression', desc: 'Change impact analysis', gradient: 'from-toon-navy to-blue-700', shadow: 'shadow-toon' },
  { path: '/estimation', icon: '📊', title: 'Estimation', desc: 'Effort hours with buffer', gradient: 'from-toon-purple to-violet-400', shadow: 'shadow-toon-purple' },
  { path: '/history', icon: '📜', title: 'History', desc: 'Review past agent runs', gradient: 'from-violet-500 to-purple-400', shadow: 'shadow-toon-purple' },
]

export default function Hub() {
  const nav = useNavigate()

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-toon-navy via-blue-600 to-toon-blue rounded-toon-lg p-8 mb-8 text-white relative overflow-hidden"
      >
        <div className="toon-blob w-60 h-60 bg-white -top-20 -right-10 absolute !opacity-10" />
        <div className="toon-blob w-40 h-40 bg-toon-yellow bottom-0 left-1/2 absolute !opacity-10" />
        <div className="relative z-10 flex items-center gap-5">
          <motion.img
            src={logo}
            className="w-16 h-16 rounded-2xl bg-white/20 p-2 shadow-lg"
            animate={{ y: [0, -6, 0] }}
            transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
          />
          <div>
            <h1 className="text-2xl font-extrabold">Salesforce QA Studio</h1>
            <p className="opacity-90 mt-1">AI-powered test artifacts for Salesforce teams</p>
          </div>
        </div>
        <div className="flex gap-3 mt-5 relative z-10">
          {['6 AI Agents', 'RAG Grounded', 'Local LLM'].map(label => (
            <span key={label} className="bg-white/15 backdrop-blur px-4 py-1.5 rounded-xl text-sm font-semibold border border-white/20">
              {label}
            </span>
          ))}
        </div>
      </motion.div>

      <h2 className="text-lg font-extrabold text-toon-navy mb-4 flex items-center gap-2">
        <span>Quick Launch</span>
        <span className="flex-1 h-0.5 bg-gradient-to-r from-toon-blue/20 to-transparent rounded" />
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tiles.map((tile, i) => (
          <ToonCard key={tile.path} delay={i * 0.05} onClick={() => nav(tile.path)} className="cursor-pointer">
            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tile.gradient} flex items-center justify-center text-white text-lg mb-3 ${tile.shadow}`}>
              {tile.icon}
            </div>
            <h3 className="font-bold text-toon-navy">{tile.title}</h3>
            <p className="text-sm text-gray-500 mt-1">{tile.desc}</p>
          </ToonCard>
        ))}
      </div>
    </div>
  )
}
