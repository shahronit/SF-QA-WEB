import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { useTestManagement } from '../context/TestManagementContext'
import { useJira } from '../context/JiraContext'
import { useSessionPrefs } from '../context/SessionPrefsContext'

const TARGETS = [
  { id: 'xray',         label: 'Xray',                icon: '🛰️', tag: 'Cloud' },
  { id: 'zephyr',       label: 'Zephyr Scale',        icon: '⚡', tag: 'Cloud' },
  { id: 'native_jira',  label: 'Native Jira Test',    icon: '🧷', tag: 'Issue type' },
]

function StatusPill({ ok }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {ok ? 'Connected' : 'Not connected'}
    </span>
  )
}

function ConnectXray({ onDone }) {
  const { connectXray, loading } = useTestManagement()
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')

  const submit = async () => {
    try {
      await connectXray({ client_id: clientId, client_secret: clientSecret })
      toast.success('Xray connected')
      onDone?.()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Xray connection failed')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Generate API keys at Xray Global Settings → API Keys. Both Client ID and Client Secret are required.
      </p>
      <input
        className="toon-input !py-2"
        placeholder="Xray Client ID"
        value={clientId}
        onChange={e => setClientId(e.target.value)}
      />
      <input
        className="toon-input !py-2"
        type="password"
        placeholder="Xray Client Secret"
        value={clientSecret}
        onChange={e => setClientSecret(e.target.value)}
      />
      <button
        onClick={submit}
        disabled={loading || !clientId || !clientSecret}
        className="toon-btn toon-btn-blue text-sm py-2 px-4 disabled:opacity-60"
      >
        {loading ? 'Connecting…' : 'Connect Xray'}
      </button>
    </div>
  )
}

function ConnectZephyr({ onDone }) {
  const { connectZephyr, loading } = useTestManagement()
  const { jiraUrl } = useJira()
  const [token, setToken] = useState('')
  const [url, setUrl] = useState(jiraUrl || '')

  useEffect(() => { if (jiraUrl) setUrl(jiraUrl) }, [jiraUrl])

  const submit = async () => {
    try {
      await connectZephyr({ api_token: token, jira_url: url })
      toast.success('Zephyr Scale connected')
      onDone?.()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Zephyr Scale connection failed')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        Generate an access token at Zephyr Scale → API Access Tokens. The Jira URL is optional and is only used to build a deep link to created test cases.
      </p>
      <input
        className="toon-input !py-2"
        type="password"
        placeholder="Zephyr Scale API token"
        value={token}
        onChange={e => setToken(e.target.value)}
      />
      <input
        className="toon-input !py-2"
        placeholder="Jira URL (optional, e.g. https://acme.atlassian.net)"
        value={url}
        onChange={e => setUrl(e.target.value)}
      />
      <button
        onClick={submit}
        disabled={loading || !token}
        className="toon-btn toon-btn-blue text-sm py-2 px-4 disabled:opacity-60"
      >
        {loading ? 'Connecting…' : 'Connect Zephyr Scale'}
      </button>
    </div>
  )
}

export default function TestManagementPush({ markdown, agentName, defaultStoryKey = '' }) {
  const { status, refreshStatus, parse, push, disconnect } = useTestManagement()
  const { projects, connected: jiraConnected, listIssues } = useJira()
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState('xray')
  const [parsing, setParsing] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [cases, setCases] = useState([])
  const [selected, setSelected] = useState({})
  const [titleEdits, setTitleEdits] = useState({})
  // Pinned project + parent story: read defaults from SessionPrefs and
  // write user changes back, so the same selections fan out to every
  // Jira-push surface and survive Reset / page navigation.
  const {
    jiraProjectKey: projectKey,
    setJiraProjectKey: setProjectKey,
    userStoryKey,
    setUserStoryKey,
  } = useSessionPrefs()
  const [stories, setStories] = useState([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const [results, setResults] = useState(null)
  // Tracks the keys we've handed to /test-case-editor windows so the
  // postMessage handler can correlate replies back to the right row and
  // ignore stale events fired after a window is closed and re-opened.
  //
  // pendingEdits is a plain Map<key, rowIdx> stored in a ref — it is
  // mutated directly (no React state) so the postMessage handler can
  // look up the row index synchronously, with zero risk of the async-
  // state-updater timing issue that plagued the previous editKeysRef
  // approach.  editKeys state is kept only for the UI (disabling the
  // Edit button while a window is open).
  const [editKeys, setEditKeys] = useState({})
  const pendingEdits = useRef(new Map()) // key -> rowIdx

  // Listen for save events from the pop-out editor. Same-origin only —
  // we ignore any cross-origin postMessage so a malicious site embedding
  // us can't inject crafted test cases. The editor cleans up its own
  // sessionStorage entry; we drop our pending-edit mapping here.
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return
      const data = event.data
      if (!data || data.type !== 'tc-edit-result' || !data.key || !data.testcase) return
      // Synchronous Map lookup — no React state / scheduler involved.
      if (!pendingEdits.current.has(data.key)) return
      const rowIdx = pendingEdits.current.get(data.key)
      pendingEdits.current.delete(data.key)
      // Apply the full edited test case (all fields) to cases state and
      // separately update the title-edits map so the inline title input
      // also reflects the change immediately.
      setCases((prev) => prev.map((tc, i) => (i === rowIdx ? { ...tc, ...data.testcase } : tc)))
      setTitleEdits((prev) => ({ ...prev, [rowIdx]: data.testcase.title || prev[rowIdx] }))
      setEditKeys((prev) => { const n = { ...prev }; delete n[rowIdx]; return n })
      toast.success('Test case updated')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, []) // no deps — pendingEdits is a stable ref, state setters are stable

  const openRowEditor = (idx) => {
    const tc = cases[idx]
    if (!tc) return
    // Inline title edits override the parsed title until the user pushes,
    // so reflect that in the popup so the user doesn't see a stale name.
    const payload = { ...tc, title: titleEdits[idx] ?? tc.title ?? '' }
    const key = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`
    try {
      sessionStorage.setItem(`tc-edit:${key}`, JSON.stringify(payload))
    } catch {
      toast.error('Could not stash test case for editor window')
      return
    }
    // Register in the Map BEFORE opening the window so the message
    // handler can always find the entry even if the child posts back
    // very quickly on a fast machine.
    pendingEdits.current.set(key, idx)
    setEditKeys((prev) => ({ ...prev, [idx]: key }))
    // Open the editor in a NEW BROWSER TAB rather than a popup window.
    // Browsers route window.open(url, target) to a tab when no `features`
    // string is passed; supplying width/height/etc. forces the legacy
    // popup window. We keep the per-key target name so re-clicking the
    // same row reuses (and refocuses) the existing tab instead of
    // spawning duplicates.
    const win = window.open(
      `/test-case-editor?key=${encodeURIComponent(key)}`,
      `tc-editor-${key}`,
    )
    if (!win) {
      toast.error('Browser blocked the new tab. Allow pop-ups for this site to edit test cases.')
      try { sessionStorage.removeItem(`tc-edit:${key}`) } catch { /* ignore */ }
      pendingEdits.current.delete(key)
      setEditKeys((prev) => { const n = { ...prev }; delete n[idx]; return n })
    } else {
      try { win.focus() } catch { /* ignore — cross-tab focus is best effort */ }
    }
  }

  const targetConnected = useMemo(() => {
    if (target === 'xray') return status.xray
    if (target === 'zephyr') return status.zephyr
    if (target === 'native_jira') return status.jira || jiraConnected
    return false
  }, [target, status, jiraConnected])

  const reset = () => {
    setCases([])
    setSelected({})
    setTitleEdits({})
    setResults(null)
    setStories([])
    // projectKey + userStoryKey are persistent pins (SessionPrefs).
    // Reset only wipes per-modal state — pins survive until the user
    // manually changes them in the dropdown / typeahead, or removes
    // them from the chip-row on the agent page.
  }

  // When the user picks a Jira project, fetch its Stories so the
  // user-story field can offer typeahead suggestions. We always request
  // via JiraContext so we use the active Jira session — this works for
  // all three targets as long as Jira is connected. If Jira is not
  // connected the field stays free-text.
  useEffect(() => {
    if (!open) return
    if (!projectKey || !jiraConnected) {
      setStories([])
      return
    }
    let cancelled = false
    setStoriesLoading(true)
    listIssues(projectKey, 'Story', 50)
      .then(list => { if (!cancelled) setStories(list || []) })
      .catch(() => { if (!cancelled) setStories([]) })
      .finally(() => { if (!cancelled) setStoriesLoading(false) })
    return () => { cancelled = true }
  }, [open, projectKey, jiraConnected, listIssues])

  const openModal = async () => {
    setOpen(true)
    setParsing(true)
    setResults(null)
    // Seed the user-story pin from the explicit prop when the session pref
    // is still empty (e.g. first open after a fresh page load). The prop is
    // jiraContextKey from AgentForm, which always reflects the most recently
    // imported/detected ticket.
    if (!userStoryKey && defaultStoryKey) {
      const seed = defaultStoryKey.trim()
      if (seed) {
        setUserStoryKey(seed)
        const projSeed = seed.split('-')[0] || ''
        if (projSeed && !projectKey) setProjectKey(projSeed)
      }
    }
    try {
      await refreshStatus()
      const data = await parse(markdown)
      const list = data.testcases || []
      setCases(list)
      const sel = {}
      const titles = {}
      list.forEach((tc, idx) => {
        sel[idx] = true
        titles[idx] = tc.title || tc.id || `Test case ${idx + 1}`
      })
      setSelected(sel)
      setTitleEdits(titles)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to parse test cases')
    } finally {
      setParsing(false)
    }
  }

  const closeModal = () => {
    setOpen(false)
    reset()
  }

  const toggleAll = () => {
    const allSelected = cases.every((_, idx) => selected[idx])
    const next = {}
    cases.forEach((_, idx) => { next[idx] = !allSelected })
    setSelected(next)
  }

  const selectedCount = cases.filter((_, idx) => selected[idx]).length

  const handlePush = async () => {
    if (!projectKey) {
      toast.error('Select a Jira project first')
      return
    }
    if (selectedCount === 0) {
      toast.error('Select at least one test case')
      return
    }
    const payload = cases
      .map((tc, idx) => ({ ...tc, title: titleEdits[idx] || tc.title, _idx: idx }))
      .filter(tc => selected[tc._idx])
      .map(({ _idx, ...rest }) => rest)

    setPushing(true)
    try {
      const data = await push({
        target,
        project_key: projectKey,
        testcases: payload,
        user_story_key: userStoryKey.trim() || null,
      })
      setResults(data)
      if (data.failed === 0) {
        toast.success(`Pushed ${data.succeeded} test cases`)
      } else if (data.succeeded === 0) {
        toast.error(`All ${data.failed} pushes failed`)
      } else {
        toast(`Pushed ${data.succeeded}/${data.total} test cases (${data.failed} failed)`)
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Push failed')
    } finally {
      setPushing(false)
    }
  }

  // Only render the trigger button for test-case-producing agents
  if (!['testcase', 'smoke', 'regression'].includes(agentName)) return null

  return (
    <>
      <button
        onClick={openModal}
        className="toon-btn bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm py-2 px-4 hover:opacity-90"
      >
        📤 Push to Test Management
      </button>

      {/* Portal the modal to <body> so it escapes any ancestor stacking
          context (e.g. framer-motion ToonCards in History.jsx whose
          `transform` traps `position: fixed` inside a local context). */}
      {createPortal(
        <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ zIndex: 9999 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeModal}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="bg-white rounded-toon-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div>
                  <h3 className="font-extrabold text-toon-navy text-lg">Push to Test Management</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Choose a destination, review the parsed test cases, and push the ones you want.
                  </p>
                </div>
                <button onClick={closeModal} className="text-gray-400 hover:text-toon-coral text-2xl leading-none">×</button>
              </div>

              <div className="flex gap-1 px-5 pt-4">
                {TARGETS.map(t => {
                  const active = target === t.id
                  const ok = (t.id === 'xray' && status.xray)
                    || (t.id === 'zephyr' && status.zephyr)
                    || (t.id === 'native_jira' && (status.jira || jiraConnected))
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTarget(t.id); setResults(null) }}
                      className={`relative flex-1 flex flex-col items-center gap-1 py-2 px-3 rounded-xl text-xs font-bold transition-colors ${
                        active ? 'bg-toon-blue/10 text-toon-blue' : 'text-gray-500 hover:text-toon-navy'
                      }`}
                    >
                      <span className="text-base">{t.icon}</span>
                      <span>{t.label}</span>
                      <StatusPill ok={ok} />
                    </button>
                  )
                })}
              </div>

              <div className="flex-1 overflow-auto p-5">
                {!targetConnected ? (
                  <div className="toon-card !p-4">
                    <div className="text-sm font-bold text-toon-navy mb-2">
                      Connect to {TARGETS.find(t => t.id === target)?.label}
                    </div>
                    {target === 'xray' && <ConnectXray onDone={refreshStatus} />}
                    {target === 'zephyr' && <ConnectZephyr onDone={refreshStatus} />}
                    {target === 'native_jira' && (
                      <p className="text-xs text-gray-500">
                        Native Jira reuses your existing Jira connection. Connect Jira from the Dashboard first.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-end -mb-1">
                      <button
                        onClick={() => disconnect(target === 'native_jira' ? null : target)}
                        disabled={target === 'native_jira'}
                        className="text-xs text-gray-400 hover:text-toon-coral underline disabled:opacity-40 disabled:no-underline"
                        title={target === 'native_jira' ? 'Disconnect Jira from the Dashboard' : 'Disconnect this target'}
                      >
                        Disconnect
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-3 items-start">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Jira project</label>
                        <select
                          className="toon-input !py-2"
                          value={projectKey}
                          onChange={e => setProjectKey(e.target.value)}
                        >
                          <option value="">— Select project —</option>
                          {/* Fallback option keeps the select visually correct
                              while the projects list is still loading */}
                          {projectKey && !(projects || []).find(p => p.key === projectKey) && (
                            <option value={projectKey}>{projectKey}</option>
                          )}
                          {(projects || []).map(p => (
                            <option key={p.key} value={p.key}>
                              {p.key} — {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">
                          Linked user story <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <input
                          list="tm-story-list"
                          className="toon-input !py-2"
                          value={userStoryKey}
                          onChange={e => setUserStoryKey(e.target.value)}
                          placeholder={
                            !jiraConnected
                              ? 'e.g. ABC-123 (Jira not connected — free text)'
                              : !projectKey
                                ? 'Select a project to load stories'
                                : storiesLoading
                                  ? 'Loading stories…'
                                  : 'Type or pick a story key (e.g. ABC-123)'
                          }
                          disabled={pushing}
                        />
                        <datalist id="tm-story-list">
                          {(stories || []).map(s => (
                            <option key={s.key} value={s.key}>{s.summary}</option>
                          ))}
                        </datalist>
                        <p className="text-[11px] text-gray-400 mt-1">
                          {target === 'native_jira' ? (
                            <>Created as a real Jira issue link of type <strong>Test</strong> (new Test <em>tests</em> {userStoryKey || '&lt;KEY&gt;'}). Falls back to <em>Relates</em> if the project lacks the Test link type.</>
                          ) : (
                            <>Appended to each pushed test case description as <code>Linked story: {userStoryKey || '<KEY>'}</code>.</>
                          )}
                        </p>
                      </div>
                    </div>

                    {parsing ? (
                      <div className="text-sm text-gray-500">Parsing test cases…</div>
                    ) : cases.length === 0 ? (
                      <div className="text-sm text-gray-500">
                        No test-case tables detected in the report. Make sure the agent emitted a Markdown table with a Title and either Steps or Expected column.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <button
                            onClick={toggleAll}
                            className="text-toon-blue font-bold hover:underline"
                          >
                            {cases.every((_, idx) => selected[idx]) ? 'Deselect all' : 'Select all'}
                          </button>
                          <span>{selectedCount} of {cases.length} selected</span>
                        </div>
                        <div className="border border-gray-200 rounded-2xl overflow-x-auto">
                          <table className="w-full min-w-[680px] text-sm">
                            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                              <tr>
                                <th className="p-2 w-10"></th>
                                <th className="p-2 text-left">Title</th>
                                <th className="p-2 text-left w-24">Priority</th>
                                <th className="p-2 text-left w-16">Steps</th>
                                <th className="p-2 text-left w-20">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cases.map((tc, idx) => (
                                <tr key={idx} className="border-t border-gray-100">
                                  <td className="p-2 text-center">
                                    <input
                                      type="checkbox"
                                      checked={!!selected[idx]}
                                      onChange={e => setSelected(prev => ({ ...prev, [idx]: e.target.checked }))}
                                    />
                                  </td>
                                  <td className="p-2">
                                    <input
                                      className="w-full bg-transparent border-b border-transparent hover:border-gray-200 focus:border-toon-blue outline-none py-1"
                                      value={titleEdits[idx] || ''}
                                      onChange={e => setTitleEdits(prev => ({ ...prev, [idx]: e.target.value }))}
                                    />
                                    {tc.id && (
                                      <div className="text-[10px] text-gray-400 mt-0.5">{tc.id}</div>
                                    )}
                                  </td>
                                  <td className="p-2 text-gray-500">{tc.priority || '—'}</td>
                                  <td className="p-2 text-gray-500">{tc.steps?.length || 0}</td>
                                  <td className="p-2">
                                    <button
                                      type="button"
                                      onClick={() => openRowEditor(idx)}
                                      className="text-[11px] font-bold text-toon-blue hover:underline disabled:text-gray-400 disabled:no-underline"
                                      disabled={!!editKeys[idx]}
                                      title={editKeys[idx] ? 'Editor window open — finish or close it first' : 'Open full editor in a new window'}
                                    >
                                      {editKeys[idx] ? '✎ open…' : '✎ Edit'}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {results && (
                          <div className="border border-gray-200 rounded-2xl p-3 bg-gray-50">
                            <div className="text-xs font-bold text-toon-navy mb-2">
                              Push results — {results.succeeded} succeeded, {results.failed} failed
                              {typeof results.links_succeeded === 'number' && (results.links_succeeded > 0 || results.links_failed > 0) && (
                                <span className="ml-2 text-gray-500 font-normal">
                                  · links: {results.links_succeeded} ok{results.links_failed > 0 ? `, ${results.links_failed} failed` : ''}
                                </span>
                              )}
                            </div>
                            <ul className="space-y-1 text-xs">
                              {results.results.map((r, i) => (
                                <li key={i} className="flex flex-wrap items-center gap-2">
                                  {r.error ? (
                                    <span className="text-toon-coral">✗ {r.title} — {r.error}</span>
                                  ) : (
                                    <>
                                      <span className="text-emerald-600">
                                        ✓ {r.title} —{' '}
                                        {r.url ? (
                                          <a href={r.url} target="_blank" rel="noreferrer" className="underline">
                                            {r.key}
                                          </a>
                                        ) : (
                                          r.key
                                        )}
                                      </span>
                                      {r.link_to && !r.link_error && (
                                        <span
                                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                            r.link_warning ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'
                                          }`}
                                          title={r.link_warning || `Link type: ${r.link_type}`}
                                        >
                                          🔗 {r.link_type || 'link'} → {r.link_to}
                                        </span>
                                      )}
                                      {r.link_error && (
                                        <span
                                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700"
                                          title={r.link_error}
                                        >
                                          ⚠ link failed → {r.link_to}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-100 bg-gray-50">
                <button onClick={closeModal} className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 text-sm py-2 px-4">
                  Close
                </button>
                <button
                  onClick={handlePush}
                  disabled={!targetConnected || pushing || selectedCount === 0 || !projectKey}
                  className="toon-btn toon-btn-blue text-sm py-2 px-4 disabled:opacity-60"
                >
                  {pushing ? 'Pushing…' : `Push ${selectedCount || ''} test ${selectedCount === 1 ? 'case' : 'cases'}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
