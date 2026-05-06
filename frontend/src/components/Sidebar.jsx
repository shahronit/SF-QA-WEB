import { useState, useEffect, useMemo, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../context/AuthContext'
import { userCanAccessPath } from '../config/agentMeta'
import api from '../api/client'
import toast from 'react-hot-toast'
import logo from '../assets/logo.png'
import Icon3D from './icons/Icon3D'

const utilityItems = [
  { path: '/',           label: 'Dashboard',    iconKey3d: 'home' },
  // QA Workbench (slug `quick_pack` in admin access) lives at the top
  // alongside the utility tiles so users hit the headline action first.
  // The render below filters this entry out via userCanAccessPath when
  // the admin has revoked access, while Dashboard/Projects/History stay
  // unconditionally visible.
  { path: '/quick-pack', label: 'QA Workbench', iconKey3d: 'sparkles' },
  { path: '/projects',   label: 'Projects',     iconKey3d: 'folder' },
  { path: '/history',    label: 'History',      iconKey3d: 'history' },
]

const navGroups = [
  {
    id: 'manual',
    phase: 'Manual QA',
    iconKey3d: 'testcase',
    accent: 'from-astound-violet to-astound-cyan',
    items: [
      { path: '/requirements',   label: 'Requirements Analysis',           iconKey3d: 'requirement' },
      { path: '/test-plan',      label: 'Test Plan & Strategy',            iconKey3d: 'test_plan' },
      { path: '/testcases',      label: 'Test Case Dev',                   iconKey3d: 'testcase' },
      { path: '/smoke',          label: 'Smoke Test Plan - Checklist',     iconKey3d: 'smoke' },
      { path: '/regression',     label: 'Regression Test Plan - Checklist',iconKey3d: 'regression' },
      { path: '/bugs',           label: 'Defect Reports',                  iconKey3d: 'bug_report' },
      { path: '/closure-report', label: 'Closure Report',                  iconKey3d: 'closure_report' },
    ],
  },
  {
    id: 'advanced',
    phase: 'Advanced QA Agents',
    iconKey3d: 'sparkles',
    accent: 'from-astound-magenta to-astound-violet',
    items: [
      { path: '/estimation',       label: 'Effort Estimation',     iconKey3d: 'estimation' },
      { path: '/automation-plan',  label: 'Automation Plan',       iconKey3d: 'automation_plan' },
      { path: '/test-data',        label: 'Test Data Preparation', iconKey3d: 'test_data' },
      { path: '/rtm',              label: 'RTM',                   iconKey3d: 'rtm' },
      { path: '/copado-scripts',   label: 'Automation Scripts',    iconKey3d: 'copado_script' },
      { path: '/uat-plan',         label: 'UAT & Sign-off',        iconKey3d: 'uat_plan' },
      { path: '/execution-report', label: 'Execution Report',      iconKey3d: 'exec_report' },
      { path: '/rca',              label: 'Root Cause Analysis',   iconKey3d: 'rca' },
      { path: '/stlc-pack',        label: '1-click STLC Pack',     iconKey3d: 'stlc_pack' },
    ],
  },
]

// Visual metadata for the two supported providers. The backend
// (deps.py) only ever registers gemini + cursor, so the dropdown is
// intentionally restricted to these. If a future provider is added
// on the backend, append it here — anything the API returns that's
// missing from this map still renders with a generic gradient
// + sparkle icon, so display will degrade gracefully.
const PROVIDER_META = {
  gemini: { label: 'Google Gemini', short: 'Gemini', iconKey3d: 'sparkles', accent: 'from-astound-cyan to-astound-violet' },
  cursor: { label: 'Cursor (CLI)',  short: 'Cursor', iconKey3d: 'sparkles', accent: 'from-astound-magenta to-astound-violet' },
}

// Pretty label for a (provider, model) pair. Falls back to the raw
// model id so an unrecognised provider still reads cleanly in the UI.
const providerLabel = (name) => PROVIDER_META[name]?.label || name
const providerShort = (name) => PROVIDER_META[name]?.short || name
const providerAccent = (name) =>
  PROVIDER_META[name]?.accent || 'from-astound-violet to-astound-cyan'

export default function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const initials = user?.display_name?.split(' ').map(w => w[0]).join('').toUpperCase() || '?'
  const [providers, setProviders] = useState([])
  const [active, setActive] = useState({ provider: '', model: '' })
  const [switching, setSwitching] = useState(false)
  const [enginePickerOpen, setEnginePickerOpen] = useState(false)
  // Outside-click handle so the engine popover behaves like a real menu.
  const enginePickerRef = useRef(null)

  // Filter the static navGroups by the current user's admin-managed
  // visibility rules: hide whole groups via menu_visibility[group.id]
  // (manual / advanced) and individual items via agent_access. Admins
  // always see everything (so they can configure on behalf of others).
  const visibleGroups = useMemo(() => {
    if (!user) return []
    const menu = user.menu_visibility || { manual: true, advanced: true }
    return navGroups
      .filter(g => user.is_admin || menu[g.id] !== false)
      .map(g => ({
        ...g,
        items: g.items.filter(it => userCanAccessPath(user, it.path)),
      }))
      .filter(g => g.items.length > 0)
  }, [user])

  const activeGroupId = useMemo(() => {
    const match = visibleGroups.find(g => g.items.some(it => location.pathname === it.path || location.pathname.startsWith(it.path + '/')))
    return match?.id || null
  }, [location.pathname, visibleGroups])

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
      if (data.active) setActive(data.active)
    }).catch(() => {})
  }, [])

  // Close the picker on any outside click. The popover is mounted next
  // to the trigger so a single ref covers both.
  useEffect(() => {
    if (!enginePickerOpen) return
    const handler = (e) => {
      if (enginePickerRef.current && !enginePickerRef.current.contains(e.target)) {
        setEnginePickerOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [enginePickerOpen])

  const handleSwitch = async (providerName, model) => {
    if (switching) return
    setSwitching(true)
    try {
      const { data } = await api.post('/llm/switch', { provider: providerName, model })
      setProviders(data.providers || [])
      if (data.active) setActive(data.active)
      setEnginePickerOpen(false)
      toast.success(`Switched to ${providerShort(providerName)} · ${model}`)
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
      className="toon-sidebar w-64 flex flex-col p-4 relative z-[2]"
    >
      <div className="flex items-center gap-3 mb-6 px-2">
        <img src={logo} alt="QA Studio" className="w-10 h-10 rounded-xl shadow-astound-glow ring-1 ring-astound-violet/30" />
        <div className="min-w-0">
          <h1 className="font-display font-extrabold text-toon-navy text-base leading-tight">QA Studio</h1>
          <p className="text-[10px] uppercase tracking-[0.18em] text-astound-violet font-bold">
            by Astound Digital
          </p>
        </div>
      </div>

      {/* AI Engine selector — grouped combobox showing every configured
          (provider, model). Replaces the legacy pill bar that could only
          render one provider at a time. */}
      {providers.length > 0 && (
        <div className="mb-4 px-1 relative" ref={enginePickerRef}>
          <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-2 px-2">
            AI Engine
          </p>
          <button
            type="button"
            onClick={() => setEnginePickerOpen(o => !o)}
            disabled={switching}
            aria-expanded={enginePickerOpen}
            className={`group w-full flex items-center gap-2 px-2.5 py-2 rounded-2xl text-left bg-white/70 hover:bg-white border border-astound-violet/20 hover:border-astound-violet/40 shadow-sm transition-all ${
              switching ? 'opacity-60 cursor-wait' : ''
            }`}
          >
            <span
              className={`w-7 h-7 rounded-xl bg-gradient-to-br ${providerAccent(active.provider)} flex items-center justify-center shadow-sm flex-shrink-0`}
            >
              <Icon3D name={PROVIDER_META[active.provider]?.iconKey3d || 'sparkles'} size={14} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] font-extrabold text-toon-navy truncate">
                {providerShort(active.provider) || 'Select engine'}
              </span>
              <span className="block text-[10px] text-gray-500 font-mono truncate">
                {active.model || '—'}
              </span>
            </span>
            <motion.span
              animate={{ rotate: enginePickerOpen ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-gray-400 text-xs flex-shrink-0"
              aria-hidden="true"
            >
              ▾
            </motion.span>
          </button>
          <AnimatePresence>
            {enginePickerOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="absolute left-1 right-1 mt-1 z-30 max-h-[60vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-astound-violet/15 p-2 space-y-2"
                role="listbox"
              >
                {providers.map(p => (
                  <div key={p.provider}>
                    <div className="flex items-center gap-2 px-2 pt-1 pb-1.5">
                      <span
                        className={`w-5 h-5 rounded-md bg-gradient-to-br ${providerAccent(p.provider)} flex items-center justify-center flex-shrink-0`}
                      >
                        <Icon3D
                          name={PROVIDER_META[p.provider]?.iconKey3d || 'sparkles'}
                          size={10}
                        />
                      </span>
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-gray-500 flex-1">
                        {providerLabel(p.provider)}
                      </span>
                      {p.active && (
                        <span className="text-[9px] font-bold text-astound-violet uppercase tracking-wider">
                          active
                        </span>
                      )}
                    </div>
                    <div className="space-y-0.5">
                      {(p.models && p.models.length ? p.models : [p.model]).filter(Boolean).map(m => {
                        const isActive = p.active && active.model === m
                        return (
                          <button
                            key={`${p.provider}::${m}`}
                            type="button"
                            onClick={() => handleSwitch(p.provider, m)}
                            disabled={switching}
                            role="option"
                            aria-selected={isActive}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left text-xs transition-colors ${
                              isActive
                                ? 'bg-astound-grad text-white shadow-sm'
                                : 'text-toon-navy hover:bg-astound-mist/60'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-astound-violet/30'}`} />
                            <span className="flex-1 truncate font-mono">{m}</span>
                            {isActive && (
                              <span className="text-[10px] font-bold uppercase tracking-wider opacity-90">
                                ✓
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <div className="pt-1.5 mt-1 border-t border-astound-violet/10 px-2 text-[10px] text-gray-400">
                  Admins can pin a different model per agent in <span className="font-bold text-astound-violet">Admin → Models</span>.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto min-h-0 pr-1">
        <div className="space-y-0.5">
          {utilityItems
            // Dashboard/Projects/History stay unconditionally visible;
            // only QA Workbench is gated by the admin-managed
            // `quick_pack` access slug. Anything else added here that
            // is missing from PATH_TO_AGENT also passes through (the
            // helper returns true for unmapped utility paths).
            .filter((item) => userCanAccessPath(user, item.path))
            .map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'text-white shadow-astound'
                    : 'text-gray-600 hover:text-toon-navy hover:bg-astound-mist/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="navHighlightUtility"
                      className="absolute inset-0 bg-astound-grad rounded-2xl"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative">
                    <Icon3D name={item.iconKey3d} size={20} float />
                  </span>
                  <span className="relative">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          {/* Admin nav item — visible only to administrators. Lives
              alongside the other utility items (Dashboard, Projects,
              History) so it's the same visual rank as the rest of
              the navigation. */}
          {user?.is_admin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-semibold transition-all ${
                  isActive
                    ? 'text-white shadow-astound'
                    : 'text-gray-600 hover:text-toon-navy hover:bg-astound-mist/60'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="navHighlightAdmin"
                      className="absolute inset-0 bg-astound-grad rounded-2xl"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative">
                    <Icon3D name="shield" size={20} float />
                  </span>
                  <span className="relative">Admin</span>
                </>
              )}
            </NavLink>
          )}
        </div>

        {visibleGroups.map((group) => {
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
                    ? 'bg-astound-mist/70 shadow-sm'
                    : 'hover:bg-astound-mist/40'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-xl bg-gradient-to-br ${group.accent} flex items-center justify-center shadow-sm`}
                >
                  <Icon3D name={group.iconKey3d} size={16} float={isActiveGroup} />
                </span>
                <span className={`flex-1 text-left text-[11px] uppercase tracking-wider font-extrabold font-display ${isActiveGroup ? 'text-toon-navy' : 'text-gray-500 group-hover:text-toon-navy'}`}>
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
                    <div className="space-y-0.5 pl-3 mt-1 ml-3 border-l border-astound-violet/15">
                      {group.items.map((item) => (
                        <NavLink
                          key={item.path}
                          to={item.path}
                          className={({ isActive }) =>
                            `relative flex items-center gap-3 px-3 py-2 rounded-2xl text-sm font-semibold transition-all ${
                              isActive
                                ? 'text-white shadow-astound'
                                : 'text-gray-600 hover:text-toon-navy hover:bg-astound-mist/60'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              {isActive && (
                                <motion.span
                                  layoutId={`navHighlight-${group.id}`}
                                  className="absolute inset-0 bg-astound-grad rounded-2xl"
                                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                                />
                              )}
                              <span className="relative">
                                <Icon3D name={item.iconKey3d} size={20} />
                              </span>
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

      <div className="border-t border-astound-violet/10 pt-4 mt-4">
        <div className="flex items-center gap-2 px-2 mb-3">
          <div className="w-9 h-9 rounded-full bg-astound-grad text-white flex items-center justify-center font-bold text-sm shadow-astound">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-toon-navy truncate">{user?.display_name}</p>
            <p className="text-xs text-gray-400 truncate">{user?.username}</p>
          </div>
          {/* Admin-only notifications bell now lives in Layout's top-
              right corner so the affordance is consistent across pages
              and visible regardless of sidebar scroll position. */}
        </div>
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-toon-coral hover:bg-red-50 rounded-xl transition-all">
          <Icon3D name="bell" size={16} />
          <span>Logout</span>
        </button>
        <div className="mt-3 pt-3 border-t border-astound-violet/10 flex items-center justify-center gap-1.5 text-[10px] text-slate-400">
          <Icon3D name="sparkles" size={10} float />
          <span>by <span className="astound-text-grad font-bold">QDEC Team</span></span>
        </div>
      </div>
    </motion.aside>
  )
}
