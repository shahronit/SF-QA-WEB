import { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { useJira } from '../context/JiraContext'
import JiraTicketCard from './JiraTicketCard'

const ISSUE_TYPES = ['', 'Epic', 'Story', 'Task', 'Bug', 'Sub-task']

// A Jira issue key is PROJECT-NUMBER (e.g. TNS-133, ABC_QA-9). The regex
// is intentionally loose so it works regardless of project key length.
const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/i

// Right-hand preview panel — renders the shared `JiraTicketCard` with an
// extra "Import to form" CTA. Keeps the picker preview and the post-import
// confirmation card pixel-identical because they share the same component.
function IssueDetail({ detail, onImport }) {
  return (
    <div className="space-y-3">
      <JiraTicketCard detail={detail} />
      <button
        type="button"
        onClick={onImport}
        className="toon-btn toon-btn-blue text-xs w-full"
      >
        ⬇ Import to form
      </button>
    </div>
  )
}

/**
 * Reusable Jira issue browser.
 *
 * Single-select mode (default): user picks one issue and clicks "Import to
 * form"; the parent receives the full issue detail via `onImport(issueDetail)`.
 *
 * Multi-select mode (`multiSelect=true`, used by the Test Plan & Strategy
 * agent): each row gets a checkbox plus a master "Select all" checkbox in
 * the list header. The right-hand panel becomes a "Selected (N)" tray with
 * an `Import N tickets to form` action that calls `onImportMany(issues[])`.
 * When a sprint is also selected and nothing is checked, a secondary
 * `Use entire sprint as scope` CTA invokes `onUseSprintScope({...})`.
 */
export default function JiraIssuePicker({
  onImport,
  multiSelect = false,
  onImportMany,
  onUseSprintScope,
}) {
  const { connected, projects, listIssues, listSprints, getIssue, getFullIssue } = useJira()

  const [open, setOpen] = useState(false)
  const [projectKey, setProjectKey] = useState('')
  const [issueType, setIssueType] = useState('')
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  // Free-text search box (filters the local list + auto-fetches when
  // the input parses as a complete Jira key).
  const [query, setQuery] = useState('')
  const [keyLookupLoading, setKeyLookupLoading] = useState(false)
  // Tracks the last key we auto-fetched so a single key paste only
  // triggers one network call even as React re-runs the debounce effect.
  const lastFetchedKeyRef = useRef('')

  // Sprint filter state — populated from /jira/sprints whenever the
  // selected project changes. `noSprintBoard` is set when the project
  // has no scrum board (so the dropdown collapses with a hint instead
  // of showing an empty disabled select).
  const [sprintId, setSprintId] = useState('')
  const [sprints, setSprints] = useState([])
  const [sprintsLoading, setSprintsLoading] = useState(false)
  const [boardName, setBoardName] = useState('')
  const [noSprintBoard, setNoSprintBoard] = useState(false)
  const [activeSprintsOnly, setActiveSprintsOnly] = useState(false)

  // Multi-select state — only meaningful when `multiSelect` is true.
  const [selectedKeys, setSelectedKeys] = useState(() => new Set())
  const [importingMany, setImportingMany] = useState(false)

  useEffect(() => {
    if (open && connected && projects.length && !projectKey) {
      setProjectKey(projects[0].key)
    }
  }, [open, connected, projects, projectKey])

  // Reload the sprint list whenever the project changes. Failures
  // (no scrum board, 403, etc.) collapse the dropdown gracefully.
  useEffect(() => {
    if (!open || !projectKey) {
      setSprints([])
      setBoardName('')
      setNoSprintBoard(false)
      setSprintId('')
      return
    }
    let cancelled = false
    setSprintsLoading(true)
    setSprintId('')
    listSprints(projectKey)
      .then(data => {
        if (cancelled) return
        const list = data?.sprints || []
        setSprints(list)
        setBoardName(data?.board_name || '')
        setNoSprintBoard(list.length === 0)
      })
      .catch(() => {
        if (!cancelled) {
          setSprints([])
          setBoardName('')
          setNoSprintBoard(true)
        }
      })
      .finally(() => { if (!cancelled) setSprintsLoading(false) })
    return () => { cancelled = true }
  }, [open, projectKey, listSprints])

  // Reload the issues list whenever any of the filter inputs change.
  useEffect(() => {
    if (!open || !projectKey) return
    let cancelled = false
    setLoading(true)
    setIssues([])
    setSelected(null)
    setDetail(null)
    setSelectedKeys(new Set())
    listIssues(projectKey, {
      issueType,
      maxResults: 50,
      sprintId: sprintId ? Number(sprintId) : null,
      activeSprintsOnly: !sprintId && activeSprintsOnly,
    })
      .then(list => { if (!cancelled) setIssues(list) })
      .catch(err => {
        if (!cancelled) toast.error(err.response?.data?.detail || 'Failed to fetch issues')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, projectKey, issueType, sprintId, activeSprintsOnly, listIssues])

  // The two sprint filters are mutually exclusive — picking a specific
  // sprint clears the "active only" toggle, and toggling "active only"
  // clears any chosen sprint. This keeps the JQL composition simple
  // (sprint = id OR sprint in openSprints(), never both).
  const handleSprintChange = (val) => {
    setSprintId(val)
    if (val) setActiveSprintsOnly(false)
  }
  const handleActiveOnlyToggle = (checked) => {
    setActiveSprintsOnly(checked)
    if (checked) setSprintId('')
  }

  // Lazy-fetch the rich /full payload (comments, sub-tasks, links,
  // attachments, sprint, epic, custom fields, etc.) for the right-hand
  // detail panel. Falls back to the lite GET /issue/{key} on failure so
  // a 403 on a single sub-resource (e.g. agile API for non-board users)
  // doesn't leave the panel empty.
  const handleSelect = async (issue) => {
    setSelected(issue)
    setDetail(null)
    setDetailLoading(true)
    try {
      const d = await getFullIssue(issue.key)
      setDetail(d)
    } catch {
      try {
        const lite = await getIssue(issue.key)
        setDetail(lite)
      } catch (err) {
        toast.error(err.response?.data?.detail || 'Failed to load issue')
      }
    } finally {
      setDetailLoading(false)
    }
  }

  // Issues filtered by the search box. Matches against KEY and SUMMARY,
  // case-insensitively. When the query parses as a Jira key we also let
  // the auto-fetch effect (below) pull the exact issue from the API
  // even if it's not in the current 50-row listing.
  const trimmedQuery = query.trim()
  const filteredIssues = useMemo(() => {
    if (!trimmedQuery) return issues
    const q = trimmedQuery.toLowerCase()
    return issues.filter(it =>
      it.key.toLowerCase().includes(q) ||
      (it.summary || '').toLowerCase().includes(q)
    )
  }, [issues, trimmedQuery])

  const looksLikeKey = JIRA_KEY_RE.test(trimmedQuery)

  // Auto-fetch when the user types/pastes a complete Jira key. Debounced
  // 400ms so each keystroke doesn't hammer the API.
  useEffect(() => {
    if (!open) return
    if (!looksLikeKey) return
    const key = trimmedQuery.toUpperCase()
    if (lastFetchedKeyRef.current === key) return
    if (selected?.key === key) return  // already showing it
    const handle = setTimeout(async () => {
      lastFetchedKeyRef.current = key
      setKeyLookupLoading(true)
      try {
        const d = await getFullIssue(key)
        const c = d.core || d
        setSelected({
          key: c.key,
          summary: c.summary,
          status: c.status,
          issuetype: c.issuetype,
          priority: c.priority,
        })
        setDetail(d)
      } catch (err) {
        toast.error(err.response?.data?.detail || `Issue ${key} not found`)
      } finally {
        setKeyLookupLoading(false)
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [open, looksLikeKey, trimmedQuery, getFullIssue, selected?.key])

  // Reset the "already-fetched" guard when the user clears or changes
  // the input so re-typing the same key still triggers a fresh fetch.
  useEffect(() => {
    if (!looksLikeKey) lastFetchedKeyRef.current = ''
  }, [looksLikeKey, trimmedQuery])

  const handleImport = () => {
    if (!detail) return
    onImport?.(detail)
    toast.success(`Imported ${detail.key}`)
  }

  // ---- Multi-select helpers ------------------------------------------

  const toggleSelectKey = (key) => {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const allFilteredSelected =
    filteredIssues.length > 0 &&
    filteredIssues.every(it => selectedKeys.has(it.key))

  const toggleSelectAll = () => {
    setSelectedKeys(prev => {
      if (allFilteredSelected) {
        const next = new Set(prev)
        filteredIssues.forEach(it => next.delete(it.key))
        return next
      }
      const next = new Set(prev)
      filteredIssues.forEach(it => next.add(it.key))
      return next
    })
  }

  const handleImportMany = async () => {
    if (selectedKeys.size === 0) return
    const picked = issues.filter(it => selectedKeys.has(it.key))
    setImportingMany(true)
    try {
      await onImportMany?.(picked)
      toast.success(`Imported ${picked.length} ticket${picked.length === 1 ? '' : 's'}`)
    } finally {
      setImportingMany(false)
    }
  }

  const handleUseSprintScope = async () => {
    if (!sprintId || !onUseSprintScope) return
    const sprint = sprints.find(s => String(s.id) === String(sprintId))
    setImportingMany(true)
    try {
      await onUseSprintScope({
        projectKey,
        sprintId: Number(sprintId),
        sprintName: sprint?.name || `Sprint ${sprintId}`,
      })
    } finally {
      setImportingMany(false)
    }
  }

  if (!connected) return null

  const showSprintScopeCta =
    multiSelect &&
    !!onUseSprintScope &&
    !!sprintId &&
    selectedKeys.size === 0 &&
    issues.length > 0

  return (
    <div className="toon-card !p-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm shadow-toon">
          🎯
        </span>
        <div className="flex-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-toon-navy">
            Import from Jira
            <span className="font-normal text-gray-400 ml-2">
              {multiSelect
                ? '(optional — combines with Project Context above; pick one or many tickets, or use a whole sprint as scope)'
                : '(optional — combines with Project Context above; auto-fills form from a Jira issue)'}
            </span>
          </h3>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-xs text-toon-blue hover:underline font-semibold"
          >
            {open ? 'Hide picker' : 'Browse issues'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 ml-12 space-y-3">
              <div className="flex gap-2">
                <select
                  className="toon-input !py-2 flex-1"
                  value={projectKey}
                  onChange={e => setProjectKey(e.target.value)}
                >
                  <option value="">— Select project —</option>
                  {projects.map(p => (
                    <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
                  ))}
                </select>
                <select
                  className="toon-input !py-2"
                  value={issueType}
                  onChange={e => setIssueType(e.target.value)}
                >
                  {ISSUE_TYPES.map(t => (
                    <option key={t} value={t}>{t || 'All types'}</option>
                  ))}
                </select>
              </div>

              {/* Sprint filter row — only meaningful once a project is picked. */}
              {projectKey && (
                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                  <div className="flex-1">
                    <select
                      className="toon-input !py-2 w-full"
                      value={sprintId}
                      onChange={e => handleSprintChange(e.target.value)}
                      disabled={sprintsLoading || noSprintBoard || sprints.length === 0}
                    >
                      <option value="">
                        {sprintsLoading
                          ? 'Loading sprints…'
                          : noSprintBoard
                            ? 'No scrum board for this project'
                            : sprints.length === 0
                              ? 'No active/future sprints'
                              : '— All sprints —'}
                      </option>
                      {sprints.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}{s.state ? ` (${s.state})` : ''}
                        </option>
                      ))}
                    </select>
                    {boardName && sprints.length > 0 && (
                      <div className="text-[10px] text-gray-400 mt-1">
                        Board: {boardName}
                      </div>
                    )}
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-toon-navy whitespace-nowrap">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={activeSprintsOnly}
                      onChange={e => handleActiveOnlyToggle(e.target.checked)}
                      disabled={!!sprintId}
                    />
                    Active sprints only
                  </label>
                </div>
              )}

              <div className="relative">
                <input
                  type="search"
                  className="toon-input !py-2 pr-10"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => {
                    // Pressing Enter on a complete key forces an immediate
                    // lookup (skips the 400ms debounce).
                    if (e.key === 'Enter' && looksLikeKey) {
                      e.preventDefault()
                      lastFetchedKeyRef.current = ''  // force re-fetch
                    }
                  }}
                  placeholder="Search by title or paste a Jira key (e.g. TNS-133)"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                  {keyLookupLoading
                    ? 'Looking up…'
                    : looksLikeKey
                      ? '↵ Auto-fetch'
                      : trimmedQuery
                        ? `${filteredIssues.length} match${filteredIssues.length === 1 ? '' : 'es'}`
                        : '🔍'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Issue list */}
                <div className="border border-gray-200 rounded-xl bg-white max-h-72 overflow-auto">
                  {multiSelect && filteredIssues.length > 0 && (
                    <label className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm flex items-center gap-2 px-3 py-2 border-b border-gray-200 text-xs font-bold text-toon-navy cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={allFilteredSelected}
                        onChange={toggleSelectAll}
                      />
                      {allFilteredSelected ? 'Deselect all' : 'Select all'}
                      <span className="ml-auto font-normal text-gray-400">
                        {selectedKeys.size} of {issues.length} selected
                      </span>
                    </label>
                  )}
                  {loading && (
                    <div className="p-4 text-center text-sm text-gray-400">Loading…</div>
                  )}
                  {!loading && issues.length === 0 && (
                    <div className="p-4 text-center text-sm text-gray-400">
                      {projectKey ? 'No issues found' : 'Pick a project to browse'}
                    </div>
                  )}
                  {!loading && issues.length > 0 && filteredIssues.length === 0 && (
                    <div className="p-4 text-center text-sm text-gray-400">
                      No matches in this list
                      {looksLikeKey && (
                        <div className="text-[11px] text-gray-400 mt-1">
                          Press Enter to fetch <span className="font-bold text-toon-blue">{trimmedQuery.toUpperCase()}</span> directly.
                        </div>
                      )}
                    </div>
                  )}
                  {!loading && filteredIssues.map(it => {
                    const isChecked = selectedKeys.has(it.key)
                    const isHighlighted = multiSelect ? isChecked : selected?.key === it.key
                    return (
                      <button
                        key={it.key}
                        onClick={() => multiSelect ? toggleSelectKey(it.key) : handleSelect(it)}
                        className={`w-full text-left px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-blue-50 transition-colors ${
                          isHighlighted ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {multiSelect && (
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={isChecked}
                              onChange={() => toggleSelectKey(it.key)}
                              onClick={e => e.stopPropagation()}
                            />
                          )}
                          <span className="text-xs font-bold text-toon-blue">{it.key}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{it.issuetype}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{it.status}</span>
                        </div>
                        <div className="text-sm text-gray-800 truncate">{it.summary}</div>
                      </button>
                    )
                  })}
                </div>

                {/* Right-hand panel: detail (single-select) or selection tray (multi-select) */}
                <div className="border border-gray-200 rounded-xl bg-white max-h-72 overflow-auto p-3">
                  {multiSelect ? (
                    <div className="space-y-2">
                      {selectedKeys.size > 0 ? (
                        <>
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-bold text-toon-navy">
                              Selected ({selectedKeys.size})
                            </div>
                            <button
                              onClick={() => setSelectedKeys(new Set())}
                              className="text-[11px] text-toon-coral hover:underline font-semibold"
                            >
                              Clear all
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {issues
                              .filter(it => selectedKeys.has(it.key))
                              .map(it => (
                                <span
                                  key={it.key}
                                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-toon-blue font-bold"
                                >
                                  {it.key}
                                  <button
                                    onClick={() => toggleSelectKey(it.key)}
                                    className="hover:text-toon-coral"
                                    aria-label={`Remove ${it.key}`}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                          </div>
                          <button
                            onClick={handleImportMany}
                            disabled={importingMany}
                            className="toon-btn toon-btn-blue text-xs w-full"
                          >
                            {importingMany
                              ? 'Importing…'
                              : `⬇ Import ${selectedKeys.size} ticket${selectedKeys.size === 1 ? '' : 's'} to form`}
                          </button>
                        </>
                      ) : showSprintScopeCta ? (
                        <div className="space-y-2 text-center py-6">
                          <div className="text-xs text-gray-500">
                            No tickets checked. Use the entire sprint as the test plan scope?
                          </div>
                          <button
                            onClick={handleUseSprintScope}
                            disabled={importingMany}
                            className="toon-btn toon-btn-blue text-xs w-full"
                          >
                            {importingMany
                              ? 'Loading sprint…'
                              : `🎯 Use entire sprint as scope (${issues.length} ticket${issues.length === 1 ? '' : 's'})`}
                          </button>
                          <div className="text-[10px] text-gray-400">
                            Or check tickets above to scope the plan to a subset.
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-gray-400 text-center py-8">
                          {sprintId
                            ? 'Check tickets above to import them'
                            : 'Check tickets above, or pick a sprint to scope the whole sprint'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {!selected && (
                        <div className="text-sm text-gray-400 text-center py-8">Select an issue to view details</div>
                      )}
                      {selected && detailLoading && (
                        <div className="text-sm text-gray-400 text-center py-8">Loading details…</div>
                      )}
                      {selected && detail && (
                        <IssueDetail detail={detail} onImport={handleImport} />
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
