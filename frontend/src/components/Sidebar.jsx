import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import toast from 'react-hot-toast'
import logo from '../assets/logo.png'

const navItems = [
  { path: '/', label: 'Dashboard', icon: '🏠', color: 'bg-toon-blue' },
  { path: '/projects', label: 'Projects', icon: '📂', color: 'bg-toon-blue' },
  { path: '/requirements', label: 'Requirements', icon: '📝', color: 'bg-blue-600' },
  { path: '/testcases', label: 'Test Cases', icon: '🧪', color: 'bg-toon-mint' },
  { path: '/bugs', label: 'Bug Reports', icon: '🐛', color: 'bg-toon-coral' },
  { path: '/smoke', label: 'Smoke Tests', icon: '💨', color: 'bg-orange-400' },
  { path: '/regression', label: 'Regression', icon: '🔄', color: 'bg-toon-navy' },
  { path: '/estimation', label: 'Estimation', icon: '📊', color: 'bg-toon-purple' },
  { path: '/history', label: 'History', icon: '📜', color: 'bg-violet-500' },
]

const PROVIDER_ORDER = ['openai', 'gemini']
const PROVIDER_META = {
  openai: { icon: '🤖', label: 'ChatGPT', color: 'from-emerald-500 to-teal-400' },
  gemini: { icon: '💎', label: 'Gemini', color: 'from-blue-500 to-cyan-400' },
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const initials = user?.display_name?.split(' ').map(w => w[0]).join('').toUpperCase() || '?'
  const [providers, setProviders] = useState([])
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    api.get('/llm/providers').then(({ data }) => {
      setProviders(data.providers || [])
    }).catch(() => {})
  }, [])

  const activeProvider = providers.find(p => p.active)

  const handleSwitch = async (providerName) => {
    if (switching) return
    setSwitching(true)
    try {
      const { data } = await api.post('/llm/switch', { provider: providerName })
      setProviders(data.providers || [])
      const meta = PROVIDER_META[providerName] || {}
      toast.success(`Switched to ${meta.label || providerName}`)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to switch')
    } finally {
      setSwitching(false)
    }
  }

  return (
    <motion.aside
      initial={{ x: -260 }}
      animate={{ x: 0 }}
      className="toon-sidebar w-64 flex flex-col p-4"
    >
      <div className="flex items-center gap-3 mb-6 px-2">
        <img src={logo} alt="Logo" className="w-10 h-10 rounded-xl shadow-toon" />
        <div>
          <h1 className="font-extrabold text-toon-navy text-sm leading-tight">Salesforce QA</h1>
          <p className="text-xs text-gray-500">Studio</p>
        </div>
      </div>

      {/* LLM Provider Selector */}
      {providers.length > 0 && (
        <div className="mb-4 px-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-2 px-2">AI Engine</p>
          <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1">
            {PROVIDER_ORDER.filter(name => providers.some(p => p.provider === name)).map(name => {
              const p = providers.find(pr => pr.provider === name)
              const meta = PROVIDER_META[name] || { icon: '🔮', label: name, color: 'from-gray-400 to-gray-500' }
              return (
                <button
                  key={p.provider}
                  onClick={() => handleSwitch(p.provider)}
                  disabled={switching}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-all ${
                    p.active
                      ? `bg-gradient-to-r ${meta.color} text-white shadow-sm`
                      : 'text-gray-500 hover:bg-white hover:shadow-sm'
                  }`}
                  title={`${meta.label} (${p.model})`}
                >
                  <span>{meta.icon}</span>
                  <span>{meta.label}</span>
                </button>
              )
            })}
          </div>
          {activeProvider && (
            <p className="text-[10px] text-gray-400 text-center mt-1.5">
              {activeProvider.model}
            </p>
          )}
        </div>
      )}

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200 ${
                isActive
                  ? 'bg-toon-blue/10 text-toon-blue shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-toon-navy'
              }`
            }
          >
            <span className="text-lg">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-gray-100 pt-4 mt-4">
        <div className="flex items-center gap-3 px-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-toon-blue to-toon-purple text-white flex items-center justify-center font-bold text-sm">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-toon-navy truncate">{user?.display_name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.username}</p>
          </div>
        </div>
        <button onClick={logout} className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:text-toon-coral hover:bg-red-50 rounded-xl transition-all">
          🚪 Logout
        </button>
      </div>
    </motion.aside>
  )
}
