import { useState, useEffect, useMemo } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import toast from 'react-hot-toast'
import logo from '../assets/logo.png'

const utilityItems = [
  { path: '/', label: 'Dashboard', icon: '🏠' },
  { path: '/projects', label: 'Projects', icon: '📂' },
  { path: '/history', label: 'History', icon: '📜' },
]

const navGroups = [
  {
    id: 'manual',
    phase: 'Manual QA',
    icon: '🧪',
    accent: 'from-blue-500 to-indigo-500',
    items: [
      { path: '/requirements',   label: 'Requirements Analysis', icon: '📝' },
      { path: '/test-plan',      label: 'Test Plan & Strategy',  icon: '📋' },
      { path: '/testcases',      label: 'Test Case Dev',         icon: '🧪' },
      { path: '/smoke',          label: 'Smoke Test Plan - Checklist',       icon: '💨' },
      { path: '/regression',     label: 'Regression Test Plan - Checklist',    icon: '🔄' },
      { path: '/bugs',           label: 'Defect Reports',        icon: '🐛' },
      { path: '/closure-report', label: 'Closure Report',        icon: '🏁' },
    ],
  },
  {
    id: 'advanced',
    phase: 'Advanced QA Agents',
    icon: '⚙️',
    accent: 'from-violet-500 to-fuchsia-500',
    items: [
      { path: '/estimation',       label: 'Effort Estimation',     icon: '📊' },
      { path: '/automation-plan',  label: 'Automation Plan',       icon: '🤖' },
      { path: '/test-data',        label: 'Test Data Preparation', icon: '🧬' },
      { path: '/rtm',              label: 'RTM',                   icon: '🧭' },
      { path: '/copado-scripts',   label: 'Automation Scripts',    icon: '⚡' },
      { path: '/uat-plan',         label: 'UAT & Sign-off',        icon: '🤝' },
      { path: '/execution-report', label: 'Execution Report',      icon: '📈' },
      { path: '/rca',              label: 'Root Cause Analysis',   icon: '🔍' },
      { path: '/stlc-pack',        label: '1-click STLC Pack',     icon: '🚀' },
    ],
  },
]

const PROVIDER_ORDER = ['gemini']
const PROVIDER_META = {
  gemini: { icon: '💎', label: 'Gemini Pro', color: 'from-blue-500 to-cyan-400' },
}

export default function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const initials = user?.display_name?.split(' ').map(w => w[0]).join('').toUpperCase() || '?'
  const [providers, setProviders] = useState([])
  const [switching, setSwitching] = useState(false)

  const activeGroupId = useMemo(() => {
    const match = navGroups.find(g => g.items.some(it => location.pathname === it.path || location.pathname.startsWith(it.path + '/')))
    return match?.id || null
  }, [location.pathname])

  const [openGroups, setOpenGroups] = useState(() => (activeGroupId ? { [activeGroupId]: true } : {}))

  useEffect(() => {
    if (activeGroupId) {
      setOpenGroups(prev => (prev[activeGroupId] ? prev : { ...prev, [activeGroupId]: true }))
    }
  }, [activeGroupId])

  const toggleGroup = (id) => {
    setOpenGroups(prev => ({ ...prev, [id]: !prev[id] }))
  }

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
          <h1 className="font-extrabold text-toon-navy text-sm leading-tight">QA Studio</h1>
          <p className="text-xs text-gray-500">AI Test Artifacts</p>
        </div>
      </div>

      {/* LLM Provider Selector */}
      {providers.length > 0 && (
        <div className="mb-4 px-1">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-2 px-2">AI Engine</p>
          <div className="flex gap-1.5 bg-gray-100 rounded-2xl p-1 relative">
            {PROVIDER_ORDER.filter(name => providers.some(p => p.provider === name)).map(name => {
              const p = providers.find(pr => pr.provider === name)
              const meta = PROVIDER_META[name] || { icon: '🔮', label: name, color: 'from-gray-400 to-gray-500' }
              return (
                <button
                  key={p.provider}
                  onClick={() => handleSwitch(p.provider)}
                  disabled={switching}
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl text-xs font-bold transition-colors ${
                    p.active ? 'text-white' : 'text-gray-500 hover:text-toon-navy'
                  }`}
                  title={`${meta.label} (${p.model})`}
                >
                  {p.active && (
                    <motion.span
                      layoutId="providerPill"
                      className={`absolute inset-0 bg-gradient-to-r ${meta.color} rounded-xl shadow-sm`}
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative">{meta.icon}</span>
                  <span className="relative">{meta.label}</span>
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

      <nav className="flex-1 space-y-1 overflow-y-auto min-h-0 pr-1">
        <div className="space-y-0.5">
          {utilityItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-semibold transition-colors ${
                  isActive ? 'text-toon-blue' : 'text-gray-600 hover:text-toon-navy hover:bg-gray-50'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="navHighlightUtility"
                      className="absolute inset-0 bg-toon-blue/10 rounded-2xl shadow-sm"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative text-base">{item.icon}</span>
                  <span className="relative">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>

        {navGroups.map((group) => {
          const isOpen = !!openGroups[group.id]
          const isActiveGroup = group.id === activeGroupId
          return (
            <div key={group.id} className="pt-2">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={isOpen}
                className={`group w-full flex items-center gap-2 px-3 py-2 rounded-2xl transition-all duration-200 ${
                  isActiveGroup
                    ? 'bg-gradient-to-r from-gray-50 to-white shadow-sm'
                    : 'hover:bg-gray-50'
                }`}
              >
                <motion.span
                  className={`w-7 h-7 rounded-xl bg-gradient-to-br ${group.accent} flex items-center justify-center text-white text-xs shadow-sm`}
                  animate={isActiveGroup ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                  transition={isActiveGroup ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
                >
                  {group.icon}
                </motion.span>
                <span className={`flex-1 text-left text-[11px] uppercase tracking-wider font-extrabold ${isActiveGroup ? 'text-toon-navy' : 'text-gray-500 group-hover:text-toon-navy'}`}>
                  {group.phase}
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-gray-400 text-xs"
                >
                  ▶
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    key="content"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-0.5 pl-3 mt-1 ml-3 border-l border-gray-100">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          className={({ isActive }) =>
                            `relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-semibold transition-colors ${
                              isActive ? 'text-toon-blue' : 'text-gray-600 hover:text-toon-navy hover:bg-gray-50'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {isActive && (
                                <motion.span
                                  layoutId={`navHighlight-${group.id}`}
                                  className="absolute inset-0 bg-toon-blue/10 rounded-2xl shadow-sm"
                                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                />
                              )}
                              <span className="relative text-base">{item.icon}</span>
                              <span className="relative">{item.label}</span>
                            </>
                          )}
                        </NavLink>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
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
