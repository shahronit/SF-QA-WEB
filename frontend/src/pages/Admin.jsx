import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { AGENT_META } from '../config/agentMeta'

// Stable, ordered list of (agent_slug, label) pairs so the admin always
// sees the same column order. Skips agents flagged deprecated in
// AGENT_META so the panel doesn't expose deleted agents to grant access
// to. Also exposed as a label-lookup helper for the prompt editor.
const ALL_AGENTS = Object.entries(AGENT_META)
  .filter(([, meta]) => !meta.deprecated)
  .map(([slug, meta]) => ({ slug, label: meta.label || slug }))

const AGENT_LABEL = Object.fromEntries(ALL_AGENTS.map(a => [a.slug, a.label]))

const QA_MODES = [
  { id: 'salesforce', label: 'Salesforce QA' },
  { id: 'general', label: 'General QA' },
]

const TABS = [
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'prompts', label: 'Default Prompts', icon: '📝' },
  { id: 'usage', label: 'Usage', icon: '🪙' },
]

export default function Admin() {
  const { user, refreshUser } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  // Honor ?tab=prompts|users on first paint so the bell deep-link
  // (which always sends ?user=<u>) lands on the Users tab even if
  // the admin was last reading the prompts tab.
  const initialTab = searchParams.get('tab') === 'prompts' ? 'prompts' : 'users'
  const [tab, setTab] = useState(initialTab)
  // Captured exactly once at mount — the actual ?user= param is
  // cleared from the URL by UsersTab after it consumes it so a
  // refresh doesn't re-open the slide-over.
  const initialUserParamRef = useRef(searchParams.get('user') || null)
  // If we have a deep-link, force the Users tab.
  useEffect(() => {
    if (initialUserParamRef.current) setTab('users')
  }, [])

  const consumeDeepLink = () => {
    initialUserParamRef.current = null
    if (searchParams.has('user') || searchParams.has('tab')) {
      const next = new URLSearchParams(searchParams)
      next.delete('user')
      next.delete('tab')
      setSearchParams(next, { replace: true })
    }
  }

  return (
    <div>
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xl shadow-toon-purple">
            🛡️
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-toon-navy">Admin Panel</h1>
            <p className="text-sm text-gray-500">
              Manage users, agent access, menu visibility, and default prompts.
            </p>
          </div>
        </div>
      </header>

      <div className="inline-flex bg-gray-100 rounded-2xl p-1 mb-6">
        {TABS.map(t => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
                active ? 'text-white' : 'text-gray-600 hover:text-toon-navy'
              }`}
            >
              {active && (
                <motion.span
                  layoutId="adminTabPill"
                  className="absolute inset-0 bg-toon-blue rounded-xl shadow-sm"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative inline-flex items-center gap-1.5">
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
              </span>
            </button>
          )
        })}
      </div>

      {tab === 'users' && (
        <UsersTab
          currentUser={user}
          onSelfChanged={refreshUser}
          autoOpenUsername={initialUserParamRef.current}
          onAutoOpenConsumed={consumeDeepLink}
        />
      )}
      {tab === 'prompts' && <DefaultPromptsTab />}
      {tab === 'usage' && <UsageTab />}
    </div>
  )
}

// ===========================================================================
// Users tab
// ===========================================================================

function UsersTab({ currentUser, onSelfChanged, autoOpenUsername, onAutoOpenConsumed }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  // Latch so the deep-link only opens the slide-over once even if the
  // user list reloads later (e.g. after saving). Without this the tab
  // would re-pop the same slide-over on every reload.
  const autoOpenedRef = useRef(false)

  const reload = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/users')
      setUsers(data?.users || [])
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  useEffect(() => {
    if (autoOpenedRef.current) return
    if (!autoOpenUsername || users.length === 0) return
    const target = users.find(
      u => u.username?.toLowerCase() === String(autoOpenUsername).toLowerCase(),
    )
    autoOpenedRef.current = true
    if (target) {
      setEditing(target)
    } else {
      toast.error(`User "${autoOpenUsername}" not found`)
    }
    onAutoOpenConsumed?.()
  }, [autoOpenUsername, users, onAutoOpenConsumed])

  return (
    <div className="toon-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-toon-navy">All Users</span>
          <span className="text-xs text-gray-500">
            {loading ? 'loading…' : `${users.length} total`}
          </span>
        </div>
        <button
          type="button"
          onClick={reload}
          className="text-xs text-toon-blue hover:underline font-semibold"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-[11px] font-bold uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-2 text-left">Username</th>
              <th className="px-4 py-2 text-left">Display name</th>
              <th className="px-4 py-2 text-center">Admin</th>
              <th className="px-4 py-2 text-center">Manual QA</th>
              <th className="px-4 py-2 text-center">Advanced QA</th>
              <th className="px-4 py-2 text-center">Agents</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const isSelf = u.username === currentUser?.username
              const accessLabel = u.agent_access == null
                ? 'All'
                : `${u.agent_access.length}/${ALL_AGENTS.length}`
              return (
                <tr key={u.username} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-toon-navy">
                    {u.username}
                    {isSelf && (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-toon-mint font-bold">
                        you
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-toon-navy">{u.display_name}</td>
                  <td className="px-4 py-2 text-center">
                    {u.is_admin ? (
                      <span className="inline-block px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold">
                        ADMIN
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {u.menu_visibility?.manual ? '✅' : '❌'}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {u.menu_visibility?.advanced ? '✅' : '❌'}
                  </td>
                  <td className="px-4 py-2 text-center text-xs text-gray-600">
                    {accessLabel}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(u)}
                      className="text-xs text-toon-blue hover:underline font-semibold"
                    >
                      Manage →
                    </button>
                  </td>
                </tr>
              )
            })}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400 text-sm">
                  No users registered yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {editing && (
          <UserSlideOver
            key={editing.username}
            user={editing}
            currentUser={currentUser}
            onClose={() => setEditing(null)}
            onSaved={async (updated) => {
              await reload()
              if (updated && currentUser?.username === updated.username) {
                onSelfChanged?.()
              }
              setEditing(updated)
            }}
            onDeleted={async () => {
              setEditing(null)
              await reload()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// Slide-over with two sub-tabs: Access (toggles + delete) and Prompts
// (per-user prompt overrides). Saves go through PATCH /admin/users/{u}.
function UserSlideOver({ user, currentUser, onClose, onSaved, onDeleted }) {
  const [tab, setTab] = useState('access')
  const [draft, setDraft] = useState({
    is_admin: !!user.is_admin,
    agent_access: user.agent_access == null ? null : [...user.agent_access],
    menu_visibility: { ...(user.menu_visibility || { manual: true, advanced: true }) },
    display_name: user.display_name || user.username,
  })
  const [saving, setSaving] = useState(false)

  const isSelf = currentUser?.username === user.username
  const allowAll = draft.agent_access == null

  const toggleAgent = (slug) => {
    setDraft(prev => {
      const cur = prev.agent_access == null ? ALL_AGENTS.map(a => a.slug) : [...prev.agent_access]
      const idx = cur.indexOf(slug)
      if (idx >= 0) cur.splice(idx, 1)
      else cur.push(slug)
      return { ...prev, agent_access: cur }
    })
  }

  const setAllAgents = (mode) => {
    setDraft(prev => ({
      ...prev,
      agent_access: mode === 'all' ? null : mode === 'none' ? [] : ALL_AGENTS.map(a => a.slug),
    }))
  }

  const save = async () => {
    setSaving(true)
    try {
      const body = {
        is_admin: draft.is_admin,
        agent_access: draft.agent_access,
        menu_visibility: draft.menu_visibility,
        display_name: draft.display_name,
      }
      const { data } = await api.patch(
        `/admin/users/${encodeURIComponent(user.username)}`, body,
      )
      toast.success('User updated')
      onSaved?.(data?.user || null)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (isSelf) {
      toast.error('You cannot delete your own account.')
      return
    }
    if (!window.confirm(`Delete user "${user.username}" permanently? This cannot be undone.`)) {
      return
    }
    try {
      await api.delete(`/admin/users/${encodeURIComponent(user.username)}`)
      toast.success(`Deleted ${user.username}`)
      onDeleted?.()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to delete user')
    }
  }

  // Render the editor through a portal mounted on <body> so it escapes
  // the route-transition `transform` ancestor. Without the portal,
  // CSS treats RouteTransition's `motion.div` (which animates `y:0`)
  // as the containing block for any descendant `position: fixed`,
  // which made the "full-screen" modal collapse to the size of the
  // page content area instead of the viewport.
  return createPortal(
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-astound-deep/70 backdrop-blur-md"
      />
      {/*
        Full-screen editor (was a 640px right-rail slide-over). Now covers
        the entire viewport on top of a darkened backdrop so admins can
        edit access + prompt overrides side-by-side without the form being
        cramped. Inner content is centred and width-capped at 5xl so it
        stays readable on wide monitors. Animation switched from
        slide-in-from-right to fade + subtle scale to suit the dialog
        framing.
      */}
      <motion.aside
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-[70] bg-white shadow-2xl flex flex-col"
        role="dialog"
        aria-modal="true"
      >
        <header className="px-6 lg:px-10 py-4 border-b border-gray-100 flex items-start gap-3 max-w-5xl w-full mx-auto">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-toon-blue to-toon-purple text-white flex items-center justify-center font-bold">
            {(user.display_name || user.username).slice(0, 2).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold text-toon-navy truncate">
              {user.display_name}
            </h2>
            <p className="text-xs text-gray-500 font-mono">{user.username}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-toon-coral text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="px-6 lg:px-10 pt-3 max-w-5xl w-full mx-auto">
          <div className="inline-flex bg-gray-100 rounded-xl p-1">
            {[
              { id: 'access', label: 'Access & Roles', icon: '🔐' },
              { id: 'prompts', label: 'Prompt Overrides', icon: '✨' },
              { id: 'models', label: 'Model Overrides', icon: '🧠' },
            ].map(t => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`relative px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    active ? 'text-white' : 'text-gray-600 hover:text-toon-navy'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`slideTab-${user.username}`}
                      className="absolute inset-0 bg-toon-blue rounded-lg"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1">
                    <span aria-hidden="true">{t.icon}</span>
                    {t.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 lg:px-10 py-4 space-y-5 max-w-5xl w-full mx-auto">
          {tab === 'access' && (
            <>
              <section>
                <label className="block text-xs font-bold text-toon-navy uppercase tracking-wider mb-1">
                  Display name
                </label>
                <input
                  className="toon-input"
                  value={draft.display_name}
                  onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-toon-navy uppercase tracking-wider">
                    Role
                  </label>
                  {isSelf && draft.is_admin && (
                    <span className="text-[10px] text-amber-600 font-semibold">
                      Demoting yourself logs you out of the admin panel.
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.is_admin}
                    onChange={(e) => setDraft({ ...draft, is_admin: e.target.checked })}
                  />
                  <div>
                    <div className="text-sm font-bold text-toon-navy">Administrator</div>
                    <div className="text-xs text-gray-500">
                      Sees the Admin panel and can change everyone's access and prompts.
                    </div>
                  </div>
                </label>
              </section>

              <section className="space-y-2">
                <label className="block text-xs font-bold text-toon-navy uppercase tracking-wider">
                  Sidebar groups
                </label>
                {[
                  { key: 'manual', label: 'Manual QA section' },
                  { key: 'advanced', label: 'Advanced QA Agents section' },
                ].map(grp => (
                  <label
                    key={grp.key}
                    className="flex items-center justify-between p-3 rounded-xl border border-gray-200 hover:bg-gray-50 cursor-pointer"
                  >
                    <span className="text-sm text-toon-navy">{grp.label}</span>
                    <input
                      type="checkbox"
                      checked={draft.menu_visibility[grp.key] !== false}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          menu_visibility: {
                            ...draft.menu_visibility,
                            [grp.key]: e.target.checked,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-toon-navy uppercase tracking-wider">
                    Agent access
                  </label>
                  <div className="text-xs flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAllAgents('all')}
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        allowAll ? 'bg-toon-blue text-white' : 'text-toon-blue hover:underline'
                      }`}
                    >
                      All (default)
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllAgents('select')}
                      className="px-2 py-0.5 rounded-md font-semibold text-toon-blue hover:underline"
                    >
                      Select…
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllAgents('none')}
                      className="px-2 py-0.5 rounded-md font-semibold text-toon-coral hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  When set to <em>All</em>, this user sees every agent. Switch to a
                  specific list to restrict them.
                </p>
                {!allowAll && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {ALL_AGENTS.map(a => {
                      const checked = draft.agent_access?.includes(a.slug)
                      return (
                        <label
                          key={a.slug}
                          className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer ${
                            checked
                              ? 'border-toon-blue/40 bg-toon-blue/5'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={!!checked}
                            onChange={() => toggleAgent(a.slug)}
                          />
                          <span className="flex-1">{a.label}</span>
                          <span className="text-[10px] text-gray-400 font-mono">{a.slug}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {tab === 'prompts' && (
            <UserPromptOverrides username={user.username} />
          )}

          {tab === 'models' && (
            <UserModelOverrides username={user.username} />
          )}
        </div>

        <footer className="border-t border-gray-100">
          <div className="px-6 lg:px-10 py-3 flex items-center gap-3 max-w-5xl w-full mx-auto">
            <button
              type="button"
              onClick={remove}
              disabled={isSelf}
              className={`text-xs font-bold ${
                isSelf
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-toon-coral hover:underline'
              }`}
            >
              Delete user
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="toon-btn toon-btn-blue px-4 text-sm"
            >
              {saving ? 'Saving…' : '💾 Save changes'}
            </button>
          </div>
        </footer>
      </motion.aside>
    </>,
    document.body,
  )
}

// ===========================================================================
// Per-user prompt overrides (drilldown inside the slide-over)
// ===========================================================================

function UserPromptOverrides({ username }) {
  const [overrides, setOverrides] = useState({})
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // { agent, qa_mode }

  const reload = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(
        `/admin/users/${encodeURIComponent(username)}/prompts`,
      )
      setOverrides(data?.prompt_overrides || {})
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load overrides')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [username])

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Per-user prompt overrides apply only to this user. Leaving an entry
        empty falls through to the global default (or the baked-in prompt).
      </p>
      <div className="space-y-2">
        {ALL_AGENTS.map(a => {
          const sf = overrides[a.slug]?.salesforce
          const gen = overrides[a.slug]?.general
          return (
            <div
              key={a.slug}
              className="rounded-xl border border-gray-200 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-toon-navy truncate">{a.label}</div>
                  <div className="text-[10px] text-gray-400 font-mono">{a.slug}</div>
                </div>
                <div className="flex items-center gap-2">
                  {QA_MODES.map(m => {
                    const has = m.id === 'salesforce' ? !!sf : !!gen
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setEditing({ agent: a.slug, qa_mode: m.id })}
                        className={`text-xs font-bold px-2.5 py-1 rounded-lg transition-colors ${
                          has
                            ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        title={m.label}
                      >
                        {has ? '✓' : '+'} {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {loading && (
        <div className="mt-3 text-xs text-gray-400">Loading overrides…</div>
      )}

      <AnimatePresence>
        {editing && (
          <PromptEditorModal
            title={`Per-user override · ${AGENT_LABEL[editing.agent]} (${editing.qa_mode})`}
            description={`This text overrides the system prompt for "${username}" only.`}
            loadEffective={async () => {
              // Show the user's override if present, otherwise fall back to
              // the currently-effective default (baked or global override).
              const cur = overrides[editing.agent]?.[editing.qa_mode] || ''
              if (cur) return cur
              try {
                const { data } = await api.get(`/agents/${editing.agent}/prompt`, {
                  params: { qa_mode: editing.qa_mode },
                })
                return data?.prompt || ''
              } catch {
                return ''
              }
            }}
            onSave={async (text) => {
              await api.put(
                `/admin/users/${encodeURIComponent(username)}/prompts/${editing.agent}`,
                { prompt: text },
                { params: { qa_mode: editing.qa_mode } },
              )
              await reload()
              setEditing(null)
              toast.success('Per-user override saved')
            }}
            onClear={async () => {
              await api.put(
                `/admin/users/${encodeURIComponent(username)}/prompts/${editing.agent}`,
                { prompt: '' },
                { params: { qa_mode: editing.qa_mode } },
              )
              await reload()
              setEditing(null)
              toast.success('Per-user override cleared')
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ===========================================================================
// Default prompts tab
// ===========================================================================

function DefaultPromptsTab() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // { agent, qa_mode, baked, override }

  const reload = async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/agents/defaults')
      setAgents(data?.agents || [])
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load default prompts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  // Stable order: follow AGENT_META insertion order, then any unknowns.
  const sorted = useMemo(() => {
    const order = ALL_AGENTS.map(a => a.slug)
    const ranked = [...agents].sort((a, b) => {
      const ai = order.indexOf(a.agent)
      const bi = order.indexOf(b.agent)
      if (ai === -1 && bi === -1) return a.agent.localeCompare(b.agent)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return ranked
  }, [agents])

  return (
    <div className="toon-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-toon-navy">Global Default Prompts</span>
          <span className="text-xs text-gray-500">
            {loading ? 'loading…' : `${sorted.length} agents`}
          </span>
        </div>
        <button
          type="button"
          onClick={reload}
          className="text-xs text-toon-blue hover:underline font-semibold"
        >
          ↻ Refresh
        </button>
      </div>

      <div className="divide-y divide-gray-100">
        {sorted.map(a => {
          const meta = AGENT_META[a.agent] || {}
          return (
            <div key={a.agent} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${meta.gradient || 'from-gray-300 to-gray-400'} flex items-center justify-center text-white text-sm shadow-toon`}>
                {meta.icon || '🧠'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-toon-navy">
                  {meta.label || a.agent}
                </div>
                <div className="text-[10px] text-gray-400 font-mono">{a.agent}</div>
              </div>
              <div className="flex items-center gap-2">
                {QA_MODES.map(m => {
                  const slot = a[m.id]
                  const overridden = !!slot?.override
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setEditing({
                          agent: a.agent,
                          qa_mode: m.id,
                          baked: slot?.baked || '',
                          override: slot?.override || '',
                        })
                      }
                      className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                        overridden
                          ? 'bg-violet-100 text-violet-700 hover:bg-violet-200'
                          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                      }`}
                    >
                      {overridden ? '✏️ ' : ''}{m.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
        {!loading && sorted.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-gray-400">
            No agents found — check that the backend is reachable.
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <PromptEditorModal
            title={`Default prompt · ${AGENT_LABEL[editing.agent] || editing.agent} (${editing.qa_mode})`}
            description="Edits here apply globally for every user that doesn't have a per-user override."
            loadEffective={async () => editing.override || editing.baked || ''}
            onSave={async (text) => {
              await api.put(
                `/admin/agents/${editing.agent}/prompt`,
                { prompt: text },
                { params: { qa_mode: editing.qa_mode } },
              )
              await reload()
              setEditing(null)
              toast.success('Default prompt saved')
            }}
            onClear={async () => {
              await api.put(
                `/admin/agents/${editing.agent}/prompt`,
                { prompt: '' },
                { params: { qa_mode: editing.qa_mode } },
              )
              await reload()
              setEditing(null)
              toast.success('Reset to baked-in default')
            }}
            onClose={() => setEditing(null)}
            // Show the baked default as a read-only reference so the
            // admin can tell "what's installed" vs "what I changed".
            bakedReference={editing.baked}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ===========================================================================
// Reusable modal for editing a single (agent, qa_mode) prompt
// ===========================================================================

function PromptEditorModal({
  title, description, loadEffective, onSave, onClear, onClose, bakedReference,
}) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.resolve(loadEffective())
      .then(t => { if (!cancelled) setText(t || '') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  // intentionally only run once per open — loadEffective is fresh each mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async () => {
    setSaving(true)
    try { await onSave?.(text) }
    finally { setSaving(false) }
  }

  const clear = async () => {
    if (!window.confirm('Reset this prompt to the underlying default?')) return
    setSaving(true)
    try { await onClear?.() }
    finally { setSaving(false) }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        className="fixed inset-0 z-[90] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-base font-extrabold text-toon-navy">{title}</h3>
            {description && (
              <p className="text-xs text-gray-500 mt-0.5">{description}</p>
            )}
          </header>
          <div className="flex-1 overflow-y-auto p-5 space-y-3">
            {loading ? (
              <div className="text-sm text-gray-400">Loading…</div>
            ) : (
              <textarea
                className="toon-input !py-2 font-mono text-xs leading-relaxed w-full"
                rows={18}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Empty = use the default below"
                spellCheck={false}
              />
            )}
            {bakedReference && (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-toon-blue hover:underline">
                  Show baked-in default (read-only)
                </summary>
                <pre className="mt-2 p-3 bg-gray-50 rounded-xl text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words border border-gray-200 max-h-72 overflow-auto">
                  {bakedReference}
                </pre>
              </details>
            )}
          </div>
          <footer className="px-5 py-3 border-t border-gray-100 flex items-center gap-3">
            <button
              type="button"
              onClick={clear}
              disabled={saving}
              className="text-xs text-toon-coral hover:underline font-semibold"
            >
              Reset to default
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onClose}
              className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving || loading}
              className="toon-btn toon-btn-blue px-4 text-sm"
            >
              {saving ? 'Saving…' : '💾 Save'}
            </button>
          </footer>
        </div>
      </motion.div>
    </>
  )
}

// ===========================================================================
// Per-user model overrides (drilldown inside the slide-over)
// ===========================================================================
//
// Lets the admin pin a specific (provider, model) for any agent on a
// per-user basis. The chosen pair beats the global Sidebar selection
// for that one user. Catalog is loaded from /api/llm/providers so the
// dropdown reflects exactly what's registered on the backend.

function UserModelOverrides({ username }) {
  const [overrides, setOverrides] = useState({})
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingAgent, setSavingAgent] = useState(null)

  const reload = async () => {
    setLoading(true)
    try {
      const [{ data: ovr }, { data: cat }] = await Promise.all([
        api.get(`/admin/users/${encodeURIComponent(username)}/models`),
        api.get('/llm/providers'),
      ])
      setOverrides(ovr?.model_overrides || {})
      setProviders(cat?.providers || [])
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load model overrides')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [username])

  // Convenience map: provider -> available model list. Used to build
  // the dependent model dropdown after a provider is picked.
  const modelsByProvider = useMemo(() => {
    const out = {}
    for (const p of providers) {
      out[p.provider] = (p.models && p.models.length ? p.models : [p.model]).filter(Boolean)
    }
    return out
  }, [providers])

  const updateOverride = async (slug, provider, model) => {
    setSavingAgent(slug)
    try {
      if (!provider || !model) {
        await api.delete(
          `/admin/users/${encodeURIComponent(username)}/models/${encodeURIComponent(slug)}`,
        )
        toast.success('Override cleared')
      } else {
        await api.put(
          `/admin/users/${encodeURIComponent(username)}/models/${encodeURIComponent(slug)}`,
          { provider, model },
        )
        toast.success(`Pinned ${provider} / ${model}`)
      }
      await reload()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to save override')
    } finally {
      setSavingAgent(null)
    }
  }

  const noProviders = providers.length === 0

  return (
    <div>
      <p className="text-xs text-gray-500 mb-3">
        Pin a specific provider and model for this user, per agent. The pin
        wins over the global Sidebar selection. Leave both dropdowns blank
        (or click <em>Clear</em>) to fall back to whichever engine the user
        picks in the Sidebar.
      </p>

      {noProviders && !loading && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 mb-3">
          No LLM providers are configured on this server. Set one or more
          API keys in <span className="font-mono">backend/.env</span> and
          restart to populate this catalog.
        </div>
      )}

      <div className="space-y-2">
        {ALL_AGENTS.map(a => {
          const current = overrides[a.slug] || null
          return (
            <ModelOverrideRow
              key={a.slug}
              agent={a}
              current={current}
              providers={providers}
              modelsByProvider={modelsByProvider}
              saving={savingAgent === a.slug}
              onChange={(prov, mdl) => updateOverride(a.slug, prov, mdl)}
              onClear={() => updateOverride(a.slug, '', '')}
            />
          )
        })}
      </div>
      {loading && (
        <div className="mt-3 text-xs text-gray-400">Loading overrides…</div>
      )}
    </div>
  )
}

function ModelOverrideRow({
  agent, current, providers, modelsByProvider, saving, onChange, onClear,
}) {
  // Local draft so the dependent model dropdown updates as soon as the
  // user picks a new provider — without committing to the backend
  // until they also pick a model. Clearing happens through the explicit
  // Clear button so an accidental select-then-defocus doesn't wipe the
  // saved pin.
  const [draftProvider, setDraftProvider] = useState(current?.provider || '')
  const [draftModel, setDraftModel] = useState(current?.model || '')

  // Re-sync the draft when the parent reload swaps in a new override
  // (e.g. after Save/Clear) so the row always reflects what's stored.
  useEffect(() => {
    setDraftProvider(current?.provider || '')
    setDraftModel(current?.model || '')
  }, [current?.provider, current?.model])

  const onProviderChange = (e) => {
    const next = e.target.value
    setDraftProvider(next)
    // Auto-pick the provider's first model so the user only has to
    // make one decision in the common case; they can still change it.
    const firstModel = (modelsByProvider[next] || [])[0] || ''
    setDraftModel(firstModel)
    if (next && firstModel) {
      onChange(next, firstModel)
    }
  }

  const onModelChange = (e) => {
    const next = e.target.value
    setDraftModel(next)
    if (draftProvider && next) {
      onChange(draftProvider, next)
    }
  }

  const overridden = !!current
  const availableModels = modelsByProvider[draftProvider] || []

  return (
    <div className={`rounded-xl border px-3 py-2 ${overridden ? 'border-violet-200 bg-violet-50/40' : 'border-gray-200'}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-toon-navy truncate flex items-center gap-2">
            {agent.label}
            {overridden && (
              <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded uppercase tracking-wider">
                pinned
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-400 font-mono">{agent.slug}</div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="toon-input !py-1 !px-2 text-xs min-w-[140px]"
            value={draftProvider}
            onChange={onProviderChange}
            disabled={saving || providers.length === 0}
          >
            <option value="">— Use global —</option>
            {providers.map(p => (
              <option key={p.provider} value={p.provider}>
                {p.label || p.provider}
              </option>
            ))}
          </select>
          <select
            className="toon-input !py-1 !px-2 text-xs min-w-[180px] font-mono"
            value={draftModel}
            onChange={onModelChange}
            disabled={saving || !draftProvider || availableModels.length === 0}
          >
            {availableModels.length === 0 && (
              <option value="">— pick provider first —</option>
            )}
            {availableModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={onClear}
            disabled={saving || !overridden}
            className={`text-[11px] font-bold px-2 py-1 rounded-lg transition-colors ${
              overridden
                ? 'text-toon-coral hover:bg-red-50'
                : 'text-gray-300 cursor-not-allowed'
            }`}
            title="Clear override"
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  )
}


// ===========================================================================
// Usage tab — admin-only token-spend dashboard across ALL users
// ===========================================================================

// Local token formatter — same rules as ReportPanel/History formatters.
// Kept inline because the Admin page is a single-file panel and we
// don't want to introduce a shared util module just for this.
function fmtTokens(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const v = Number(n)
  if (v < 1000) return String(v)
  if (v < 10000) return v.toLocaleString()
  return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

function fmtTs(ts) {
  if (!ts) return ''
  // Normalize "2026-05-04T12:34:56.789Z" to "2026-05-04 12:34:56" so
  // the table stays narrow without losing the second-precision that
  // matters when correlating two near-simultaneous runs.
  return String(ts).slice(0, 19).replace('T', ' ')
}

function UsageTab() {
  const [data, setData] = useState({
    records: [],
    summary: { totals: {}, per_user: [], per_agent: [], per_model: [] },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Server-side filters — sent as query params on every reload so the
  // backend never has to ship the full collection when the admin is
  // narrowing a question (which user is heaviest? which agent costs
  // the most?).
  const [filters, setFilters] = useState({
    limit: 500,
    agent: '',
    username: '',
    since: '',
  })

  const reload = async () => {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (filters.limit) params.limit = filters.limit
      if (filters.agent) params.agent = filters.agent
      if (filters.username.trim()) params.username = filters.username.trim()
      if (filters.since) params.since = new Date(filters.since).toISOString()
      const { data: payload } = await api.get('/admin/usage', { params })
      setData({
        records: payload?.records || [],
        summary: payload?.summary || { totals: {}, per_user: [], per_agent: [], per_model: [] },
      })
    } catch (err) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to load usage'
      setError(String(detail))
      toast.error(detail)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])  // initial load only; filter changes apply on Apply click

  const totals = data.summary.totals || {}

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon="🏃"
          label="Total runs"
          value={(totals.runs ?? 0).toLocaleString()}
          gradient="from-toon-blue to-cyan-400"
        />
        <SummaryCard
          icon="⬇️"
          label="Prompt tokens"
          value={fmtTokens(totals.prompt_tokens)}
          subtitle={(totals.prompt_tokens ?? 0).toLocaleString()}
          gradient="from-emerald-500 to-teal-400"
        />
        <SummaryCard
          icon="⬆️"
          label="Completion tokens"
          value={fmtTokens(totals.completion_tokens)}
          subtitle={(totals.completion_tokens ?? 0).toLocaleString()}
          gradient="from-amber-500 to-orange-400"
        />
        <SummaryCard
          icon="🪙"
          label="Total tokens"
          value={fmtTokens(totals.total_tokens)}
          subtitle={(totals.total_tokens ?? 0).toLocaleString()}
          gradient="from-violet-500 to-fuchsia-500"
        />
      </div>

      {/* Filters */}
      <div className="toon-card !py-3">
        <div className="flex items-end gap-3 flex-wrap">
          <FilterField label="Agent">
            <select
              className="toon-input !py-1.5 !px-2 text-sm"
              value={filters.agent}
              onChange={e => setFilters(f => ({ ...f, agent: e.target.value }))}
            >
              <option value="">All</option>
              {ALL_AGENTS.map(a => (
                <option key={a.slug} value={a.slug}>{a.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Username">
            <input
              type="text"
              className="toon-input !py-1.5 !px-2 text-sm"
              placeholder="exact match"
              value={filters.username}
              onChange={e => setFilters(f => ({ ...f, username: e.target.value }))}
            />
          </FilterField>
          <FilterField label="Since">
            <input
              type="date"
              className="toon-input !py-1.5 !px-2 text-sm"
              value={filters.since}
              onChange={e => setFilters(f => ({ ...f, since: e.target.value }))}
            />
          </FilterField>
          <FilterField label="Limit">
            <select
              className="toon-input !py-1.5 !px-2 text-sm"
              value={filters.limit}
              onChange={e => setFilters(f => ({ ...f, limit: Number(e.target.value) }))}
            >
              {[100, 250, 500, 1000, 2000].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </FilterField>
          <button
            type="button"
            onClick={reload}
            disabled={loading}
            className="toon-btn toon-btn-blue text-sm py-2 px-4"
          >
            {loading ? '…' : '↻ Apply'}
          </button>
          {(filters.agent || filters.username || filters.since) && (
            <button
              type="button"
              onClick={() => setFilters({ limit: 500, agent: '', username: '', since: '' })}
              className="text-xs font-semibold text-gray-500 hover:text-toon-coral"
            >
              Clear filters
            </button>
          )}
        </div>
        {error && (
          <div className="mt-2 text-xs text-toon-coral font-semibold">
            {error}
          </div>
        )}
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <RankingTable
          title="By user"
          rows={data.summary.per_user}
          nameKey="username"
          nameLabel="User"
          emptyHint="No attributed runs yet."
        />
        <RankingTable
          title="By agent"
          rows={data.summary.per_agent}
          nameKey="agent"
          nameLabel="Agent"
          renderName={(name) => AGENT_LABEL[name] || name}
          emptyHint="No agent runs in this window."
        />
      </div>

      {/* Per-model rollup */}
      <RankingTable
        title="By model"
        rows={data.summary.per_model}
        nameKey="model"
        nameLabel="Model"
        renderName={(_name, row) => (
          <span>
            <span className="text-gray-500">{row.provider || '—'}</span>
            <span className="opacity-40 mx-1">·</span>
            <span>{row.model || '—'}</span>
          </span>
        )}
        emptyHint="No model usage in this window."
      />

      {/* Recent runs */}
      <div className="toon-card !p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-toon-navy">Recent runs</span>
            <span className="text-xs text-gray-500">
              {loading ? 'loading…' : `${data.records.length} rows`}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 font-bold">When</th>
                <th className="text-left px-3 py-2 font-bold">User</th>
                <th className="text-left px-3 py-2 font-bold">Agent</th>
                <th className="text-left px-3 py-2 font-bold">Model</th>
                <th className="text-right px-3 py-2 font-bold">Prompt</th>
                <th className="text-right px-3 py-2 font-bold">Completion</th>
                <th className="text-right px-3 py-2 font-bold">Total</th>
                <th className="text-center px-3 py-2 font-bold">Flags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.records.map((r, i) => {
                const usage = r.usage || {}
                return (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 tabular-nums whitespace-nowrap">
                      {fmtTs(r.ts)}
                    </td>
                    <td className="px-3 py-2 font-semibold text-toon-navy">
                      {r.username || <span className="text-gray-400">(unknown)</span>}
                    </td>
                    <td className="px-3 py-2">
                      {AGENT_LABEL[r.agent] || r.agent}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      <span className="text-gray-400">{r.provider || '—'}</span>
                      <span className="opacity-40 mx-1">·</span>
                      <span>{r.model || '—'}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtTokens(usage.prompt_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtTokens(usage.completion_tokens)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-extrabold">
                      {fmtTokens(usage.total_tokens)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        {r.cache_hit && (
                          <span
                            title="Replayed from response cache"
                            className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 text-[10px] font-bold"
                          >
                            cached
                          </span>
                        )}
                        {r.repaired && (
                          <span
                            title="Auto-repair pass kicked in"
                            className="px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700 text-[10px] font-bold"
                          >
                            repaired
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && data.records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-gray-400">
                    No runs match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value, subtitle, gradient }) {
  return (
    <div className="toon-card !p-3">
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white text-base shadow-toon`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            {label}
          </div>
          <div className="text-xl font-extrabold text-toon-navy tabular-nums">
            {value}
          </div>
          {subtitle && (
            <div className="text-[10px] text-gray-400 tabular-nums">{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterField({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </span>
      {children}
    </label>
  )
}

function RankingTable({ title, rows, nameKey, nameLabel, renderName, emptyHint }) {
  const safeRows = Array.isArray(rows) ? rows : []
  return (
    <div className="toon-card !p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-bold text-toon-navy">{title}</span>
        <span className="text-xs text-gray-500">{safeRows.length} rows</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2 font-bold">{nameLabel}</th>
              <th className="text-right px-3 py-2 font-bold">Runs</th>
              <th className="text-right px-3 py-2 font-bold">Prompt</th>
              <th className="text-right px-3 py-2 font-bold">Completion</th>
              <th className="text-right px-3 py-2 font-bold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {safeRows.map((row, i) => {
              const name = row[nameKey]
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-semibold text-toon-navy">
                    {renderName ? renderName(name, row) : (name || '(unknown)')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(row.runs ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(row.prompt_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtTokens(row.completion_tokens)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-extrabold">
                    {fmtTokens(row.total_tokens)}
                  </td>
                </tr>
              )
            })}
            {safeRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-400">
                  {emptyHint || 'Nothing to show.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
