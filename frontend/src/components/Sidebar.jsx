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
  { path: '/',                 label: 'Dashboard',         iconKey3d: 'home' },
  // QA Test Artifacts (slug `quick_pack` in admin access — the slug
  // stayed put when the page was renamed so existing user permissions
  // keep working). Lives at the top alongside the utility tiles so
  // users hit the headline action first. The render below filters this
  // entry out via userCanAccessPath when the admin has revoked access,
  // while Dashboard/Projects/History stay unconditionally visible.
  { path: '/qa-test-artifacts', label: 'QA Test Artifacts', iconKey3d: 'sparkles' },
  { path: '/projects',   label: 'Projects',     iconKey3d: 'folder' },
  { path: '/history',    label: 'History',      iconKey3d: 'history' },
  // "My Usage" is unconditional — every authenticated user can audit
  // their own token spend. The cross-user dashboard at /admin remains
  // gated by `is_admin`.
  { path: '/me/usage',   label: 'My Usage',     iconKey3d: 'history' },
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

  // Cursor CLI auth state — drives the "Sign in to Cursor" banner
  // that appears whenever the binary is reachable on this host but
  // the seat hasn't been authenticated yet. Initial value `null`
  // means "not probed yet" so we don't flash the banner on first
  // paint.
  const [cursorStatus, setCursorStatus] = useState(null)
  // Whether we're mid-spawn for the cursor-agent login subprocess
  // (covers the brief window before /cursor/login returns with a URL).
  const [cursorLoggingIn, setCursorLoggingIn] = useState(false)
  // Current OAuth URL returned by the backend. When set, the modal
  // is showing the "Sign in on cursor.com" view and the status poll
  // is running.
  const [cursorLoginUrl, setCursorLoginUrl] = useState(null)
  // 'idle' | 'in_progress' | 'success' | 'failed' | 'cancelled' | 'timeout'
  // Mirrors the backend's get_login_session() status so the modal
  // can show progress / errors.
  const [cursorLoginPhase, setCursorLoginPhase] = useState('idle')
  // Optional error tail surfaced from cursor-agent stderr when login
  // fails — shown verbatim in the modal so the user can see what
  // went wrong instead of a generic toast.
  const [cursorLoginError, setCursorLoginError] = useState(null)
  // Auth.json upload kept as an Advanced fallback for users who
  // can't (or don't want to) complete the browser OAuth.
  const [cursorUploading, setCursorUploading] = useState(false)
  const [cursorAdvancedOpen, setCursorAdvancedOpen] = useState(false)
  const cursorUploadInputRef = useRef(null)
  // Polling cleanup handle — set when a login session starts, cleared
  // when the modal closes or status reaches a terminal state.
  const cursorLoginPollRef = useRef(null)

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

  // Probe cursor-agent auth state whenever the Cursor provider is in
  // the catalog. Re-runs after a login spawn so the banner clears as
  // soon as the seat is authenticated.
  const hasCursorProvider = useMemo(
    () => providers.some(p => p.provider === 'cursor'),
    [providers],
  )

  const refreshCursorStatus = async () => {
    try {
      const { data } = await api.get('/llm/cursor/status')
      setCursorStatus(data)
      return data
    } catch {
      setCursorStatus({ available: false, logged_in: false, models: [] })
      return null
    }
  }

  useEffect(() => {
    if (!hasCursorProvider) {
      setCursorStatus(null)
      return
    }
    refreshCursorStatus()
  }, [hasCursorProvider])

  // Tear down the background polling loop. Safe to call multiple
  // times — the ref short-circuits when already cleared.
  const stopCursorLoginPolling = () => {
    if (cursorLoginPollRef.current) {
      clearInterval(cursorLoginPollRef.current)
      cursorLoginPollRef.current = null
    }
  }

  // Poll /cursor/login-status every 2.5s while the user is on the
  // cursor.com sign-in tab. Transitions the UI when the backend
  // reports success / failure / timeout / cancellation. Refreshes
  // the provider catalog on success so the engine dropdown can
  // immediately offer cursor models without a reload.
  const startCursorLoginPolling = () => {
    stopCursorLoginPolling()
    cursorLoginPollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/llm/cursor/login-status')
        if (!data || data.status === 'idle') return
        if (data.status === 'in_progress') {
          // Still waiting — keep the URL fresh in case the backend
          // dropped/replaced it (rare; defensive).
          if (data.login_url) setCursorLoginUrl(data.login_url)
          return
        }
        // Terminal states: stop polling regardless of outcome.
        stopCursorLoginPolling()
        setCursorLoginPhase(data.status)
        if (data.status === 'success') {
          toast.success('Cursor sign-in complete. You can close the sign-in tab.', { duration: 6000 })
          setCursorLoginUrl(null)
          setCursorLoginError(null)
          await refreshCursorStatus()
          api.get('/llm/providers').then(({ data: pd }) => {
            setProviders(pd.providers || [])
            if (pd.active) setActive(pd.active)
          }).catch(() => {})
        } else {
          setCursorLoginError(data.error_tail || data.message || null)
          toast.error(data.message || `Cursor sign-in ${data.status}.`, { duration: 8000 })
        }
      } catch {
        // Single 401/network blip shouldn't abort the poll — keep
        // trying. The poll itself stops when the user closes the
        // modal or after a terminal state above.
      }
    }, 2500)
  }

  // Primary "Re-Login" handler: ask the backend to spawn cursor-agent
  // login with NO_OPEN_BROWSER=1, get the cursor.com URL back, open
  // it in a new tab, and start polling for completion. Works the
  // same way locally and on Render — the user's own browser is what
  // completes the OAuth, not the server's.
  const handleCursorLogin = async () => {
    if (cursorLoggingIn) return
    setCursorLoggingIn(true)
    setCursorLoginPhase('starting')
    setCursorLoginError(null)
    try {
      const { data } = await api.post('/llm/cursor/login')
      if (data?.login_url) {
        setCursorLoginUrl(data.login_url)
        setCursorLoginPhase(data.status || 'in_progress')
        // Open in a new tab so the user keeps QA Studio in view
        // while signing in. noopener+noreferrer per the usual
        // window.open hygiene.
        const popup = window.open(data.login_url, '_blank', 'noopener,noreferrer')
        if (!popup) {
          // Popup blocker swallowed it — leave the URL visible in
          // the modal so the user can click it manually.
          toast(
            'Pop-up blocked — click the link in the panel to sign in to Cursor.',
            { duration: 7000, icon: '\u26A0\uFE0F' },
          )
        }
        startCursorLoginPolling()
      } else {
        setCursorLoginPhase('failed')
        setCursorLoginError(data?.message || 'No sign-in URL returned by the server.')
        toast.error(data?.message || 'Failed to start the Cursor sign-in flow.')
      }
    } catch (err) {
      setCursorLoginPhase('failed')
      const detail = err.response?.data?.detail || err.message || 'Failed to start the Cursor sign-in flow.'
      setCursorLoginError(detail)
      toast.error(detail)
    } finally {
      setCursorLoggingIn(false)
    }
  }

  // Cancel an in-flight login (closes the modal AND tells the
  // backend to terminate the cursor-agent subprocess so we don't
  // leak processes on the host).
  const handleCursorLoginCancel = async () => {
    stopCursorLoginPolling()
    setCursorLoginUrl(null)
    setCursorLoginPhase('idle')
    setCursorLoginError(null)
    try {
      await api.post('/llm/cursor/login-cancel')
    } catch {
      // The backend may have already cleaned up — non-fatal.
    }
  }

  const handleCursorLogout = async () => {
    stopCursorLoginPolling()
    setCursorLoginUrl(null)
    setCursorLoginPhase('idle')
    setCursorLoginError(null)
    try {
      await api.post('/llm/cursor/logout')
      toast.success('Signed out of your Cursor account.')
      await refreshCursorStatus()
    } catch (err) {
      toast.error(
        err.response?.data?.detail
          || 'Failed to sign out of Cursor.',
      )
    }
  }

  // Headless / Render path: user runs cursor-agent login on their own
  // laptop, then uploads auth.json (or a tarball of ~/.cursor/) here.
  // The hidden file input is triggered by the visible button below.
  const handleCursorUploadClick = () => {
    if (cursorUploading) return
    cursorUploadInputRef.current?.click()
  }

  const handleCursorUploadChange = async (event) => {
    const file = event.target.files?.[0]
    // Always clear the input value so picking the same file twice
    // still fires onChange — otherwise users would have to rename
    // the file to retry after a failure.
    if (event.target) event.target.value = ''
    if (!file) return
    setCursorUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      // Critical: do NOT set Content-Type here. Manually specifying
      // 'multipart/form-data' (without the boundary) was overriding
      // axios's auto-detection, which means the boundary string never
      // made it into the request and the server couldn't parse the
      // body. Letting axios see the FormData lets it set the full
      // 'multipart/form-data; boundary=...' header correctly.
      const { data } = await api.post('/llm/cursor/upload-credentials', form)
      if (data?.logged_in) {
        toast.success(
          `Credentials installed — you're signed in to Cursor (${data.model_count} models).`,
          { duration: 6000 },
        )
        // Refresh both the per-user status and the global provider
        // list so the dropdown can re-render with the right catalog.
        await refreshCursorStatus()
        api.get('/llm/providers').then(({ data: pd }) => {
          setProviders(pd.providers || [])
          if (pd.active) setActive(pd.active)
        }).catch(() => {})
      } else {
        toast(
          data?.message
            || 'Credentials installed but cursor-agent still reports "not authenticated".',
          { duration: 7000 },
        )
        await refreshCursorStatus()
      }
    } catch (err) {
      toast.error(
        err.response?.data?.detail
          || 'Failed to upload Cursor credentials.',
        { duration: 7000 },
      )
    } finally {
      setCursorUploading(false)
    }
  }

  const handleCursorRecheck = async () => {
    const next = await refreshCursorStatus()
    if (next?.logged_in) {
      toast.success(`You're signed in to Cursor — ${next.model_count} models available.`)
      api.get('/llm/providers').then(({ data }) => {
        setProviders(data.providers || [])
        if (data.active) setActive(data.active)
      }).catch(() => {})
    } else if (next?.available) {
      toast('Still not signed in. Finish the browser OAuth and try again.')
    }
  }

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

  // Tear down the login status poller on unmount — without this an
  // interval keeps firing /cursor/login-status after the sidebar
  // unmounts (e.g. after a logout-triggered redirect).
  useEffect(() => {
    return () => stopCursorLoginPolling()
  }, [])

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
                {/* Cursor CLI sign-in banner — every user authenticates
                    their OWN Cursor account. When the server can spawn
                    cursor-agent's browser login (developer workstation),
                    we offer the one-click "Log in" button. On headless
                    deployments (Render etc.) we only show the upload
                    path because the browser flow would fail silently.
                    Upload is always available as a fallback so users
                    can recover from corrupt local state. */}
                {hasCursorProvider && cursorStatus && cursorStatus.available && !cursorStatus.logged_in && (
                  <div className="mt-1 mx-1 rounded-xl border border-amber-300/60 bg-amber-50/80 p-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-amber-600 text-sm leading-none mt-0.5">⚠</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-extrabold text-amber-900 leading-tight">
                          Sign in to your Cursor account
                        </p>
                        <p className="text-[10px] text-amber-800/80 mt-0.5 leading-snug">
                          Each user needs their own Cursor sign-in
                          before this engine can run for them. Click
                          Re-Login to open the Cursor sign-in page in a
                          new tab.
                        </p>
                      </div>
                    </div>

                    {/* Active sign-in session: show the URL the
                        backend captured + a progress hint + a Cancel
                        button. The user only sees this between
                        clicking Re-Login and finishing OAuth on
                        cursor.com. */}
                    {cursorLoginUrl && cursorLoginPhase === 'in_progress' && (
                      <div className="rounded-lg border border-amber-300/70 bg-white/80 p-2 space-y-1.5">
                        <p className="text-[10px] font-bold text-amber-900 leading-snug">
                          Waiting for Cursor sign-in…
                        </p>
                        <a
                          href={cursorLoginUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-[10px] font-mono text-amber-800 break-all underline hover:text-amber-600"
                          title="Click to open the Cursor sign-in page in a new tab"
                        >
                          {cursorLoginUrl}
                        </a>
                        <p className="text-[9px] text-amber-700/80 leading-snug">
                          Complete the sign-in in your browser. This
                          panel updates automatically when it's done.
                        </p>
                        <div className="flex items-center gap-1.5 pt-0.5">
                          <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          <span className="text-[9px] font-bold uppercase tracking-wider text-amber-700">
                            Polling cursor.com…
                          </span>
                          <button
                            type="button"
                            onClick={handleCursorLoginCancel}
                            className="ml-auto text-[9px] font-bold uppercase tracking-wider text-amber-800/80 hover:text-amber-900 hover:underline"
                            title="Abort the in-flight cursor-agent login"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Terminal-failure feedback: surface the actual
                        cursor-agent error so the user knows why login
                        didn't take instead of just seeing a flashed
                        toast. */}
                    {cursorLoginError && cursorLoginPhase !== 'in_progress' && (
                      <div className="rounded-lg border border-red-300/70 bg-red-50/80 p-2">
                        <p className="text-[10px] font-bold text-red-900 leading-snug">
                          Sign-in didn't complete
                        </p>
                        <p className="text-[10px] font-mono text-red-800/90 break-all leading-snug mt-0.5">
                          {cursorLoginError}
                        </p>
                      </div>
                    )}

                    {/* Primary CTA row: Re-Login + Re-check. The
                        Re-Login button is hidden during an in-flight
                        session so the user can't accidentally double-
                        click and spawn a fresh OAuth URL. */}
                    {(!cursorLoginUrl || cursorLoginPhase !== 'in_progress') && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleCursorLogin}
                          disabled={cursorLoggingIn || !cursorStatus.can_browser_login}
                          className={`flex-1 text-[10px] font-bold uppercase tracking-wider rounded-lg px-2 py-1.5 transition-colors ${
                            (cursorLoggingIn || !cursorStatus.can_browser_login)
                              ? 'bg-amber-200 text-amber-700 cursor-wait'
                              : 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                          }`}
                          title={
                            cursorStatus.can_browser_login
                              ? 'Open the Cursor sign-in page in a new tab and re-authenticate.'
                              : 'cursor-agent binary missing on this host — use Advanced upload below.'
                          }
                        >
                          {cursorLoggingIn ? 'Starting…' : 'Re-Login'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCursorRecheck}
                          className="text-[10px] font-bold uppercase tracking-wider rounded-lg px-2 py-1.5 bg-white/70 hover:bg-white text-amber-900 border border-amber-300/60"
                          title="Re-probe Cursor sign-in state"
                        >
                          Re-check
                        </button>
                      </div>
                    )}

                    {/* Advanced fallback — keep the auth.json upload
                        flow as an escape hatch for users who can't
                        complete the browser OAuth (e.g. cursor.com
                        blocked on their network) or whose laptop
                        already has a working auth.json they'd rather
                        copy across. Hidden behind a disclosure so the
                        primary CTA stays clean. */}
                    <button
                      type="button"
                      onClick={() => setCursorAdvancedOpen(o => !o)}
                      className="w-full text-left text-[10px] font-bold uppercase tracking-wider text-amber-800/70 hover:text-amber-900 flex items-center gap-1"
                    >
                      <span>{cursorAdvancedOpen ? '▾' : '▸'}</span>
                      <span>Advanced — upload auth.json instead</span>
                    </button>
                    {cursorAdvancedOpen && (
                      <div className="space-y-1.5 pl-2 border-l border-amber-300/40">
                        <p className="text-[10px] text-amber-900/85 leading-snug">
                          If the browser sign-in can't reach cursor.com
                          from this server, upload the auth.json from a
                          local Cursor install. On Windows it's at
                          {' '}<code className="font-mono bg-white/70 px-1 rounded">%USERPROFILE%\.cursor\auth.json</code>,
                          on Mac/Linux at
                          {' '}<code className="font-mono bg-white/70 px-1 rounded">~/.cursor/auth.json</code>.
                        </p>
                        <button
                          type="button"
                          onClick={handleCursorUploadClick}
                          disabled={cursorUploading}
                          className={`w-full text-[10px] font-bold uppercase tracking-wider rounded-lg px-2 py-1.5 transition-colors ${
                            cursorUploading
                              ? 'bg-amber-200 text-amber-700 cursor-wait'
                              : 'bg-white text-amber-900 border border-amber-400/60 hover:bg-amber-100'
                          }`}
                        >
                          {cursorUploading ? 'Uploading…' : 'Upload auth.json'}
                        </button>
                        <input
                          ref={cursorUploadInputRef}
                          type="file"
                          accept=".json,.tgz,.tar.gz,.tar,.zip"
                          onChange={handleCursorUploadChange}
                          className="hidden"
                        />
                      </div>
                    )}
                  </div>
                )}
                {hasCursorProvider && cursorStatus && cursorStatus.logged_in && (
                  <div className="mt-1 mx-1 rounded-xl border border-emerald-300/50 bg-emerald-50/60 px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-600 text-[11px] leading-none">✓</span>
                      <span className="flex-1 text-[10px] font-bold text-emerald-900">
                        Cursor signed in · {cursorStatus.model_count} models
                      </span>
                      <button
                        type="button"
                        onClick={handleCursorLogout}
                        className="text-[9px] font-bold uppercase tracking-wider text-emerald-800/80 hover:text-emerald-900 hover:underline"
                        title="Clear your Cursor credentials on this server"
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                )}
                <div className="pt-1.5 mt-1 border-t border-astound-violet/10 px-2 text-[10px] text-gray-400">
                  Admins can pin a different model per agent in <span className="font-bold text-astound-violet">Admin → Models</span>.
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {/* Collapsed-state hint — surfaces the auth gap without
              requiring the user to open the dropdown first. Tapping it
              expands the picker where the actual Log-in button lives. */}
          {hasCursorProvider && cursorStatus && cursorStatus.available && !cursorStatus.logged_in && !enginePickerOpen && (
            <button
              type="button"
              onClick={() => setEnginePickerOpen(true)}
              className="mt-1.5 w-full flex items-center gap-1.5 px-2 py-1 rounded-xl bg-amber-50 border border-amber-300/60 hover:bg-amber-100/80 transition-colors"
              title="Sign in to your Cursor account"
            >
              <span className="text-amber-600 text-[10px] leading-none">⚠</span>
              <span className="text-[10px] font-bold text-amber-900 tracking-wide">
                Sign in to Cursor
              </span>
              <span className="ml-auto text-[9px] font-bold uppercase tracking-wider text-amber-700">
                Fix
              </span>
            </button>
          )}
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto min-h-0 pr-1">
        <div className="space-y-0.5">
          {utilityItems
            // Dashboard/Projects/History stay unconditionally visible;
            // only QA Test Artifacts is gated by the admin-managed
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
