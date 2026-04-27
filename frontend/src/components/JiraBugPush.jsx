import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useJira } from '../context/JiraContext'
import { useSessionPrefs } from '../context/SessionPrefsContext'

// Common Jira issue link types — these are the names every Jira Cloud
// tenant ships with by default. Custom link types still work because
// the backend just forwards the chosen string to /rest/api/3/issueLink.
const LINK_TYPES = [
  { value: 'Relates',     label: 'Relates to' },
  { value: 'Blocks',      label: 'Blocks' },
  { value: 'Duplicate',   label: 'Duplicates' },
  { value: 'Cloners',     label: 'Cloned by' },
]

/** Best-effort summary derivation — first '# heading' or first 80 chars. */
function deriveSummary(markdown) {
  if (!markdown) return ''
  const lines = markdown.split(/\r?\n/)
  for (const ln of lines) {
    const m = ln.match(/^#\s+(.+)$/)
    if (m) return m[1].trim().slice(0, 200)
  }
  const firstLine = lines.find(ln => ln.trim()) || ''
  return firstLine.trim().slice(0, 80)
}

export default function JiraBugPush({ markdown, agentName, defaultIssueKey = '' }) {
  const { connected: jiraConnected, projects, listIssues } = useJira()
  const {
    jiraProjectKey: pinnedProjectKey,
    setJiraProjectKey,
    userStoryKey: pinnedStoryKey,
    setUserStoryKey,
  } = useSessionPrefs()
  const [open, setOpen] = useState(false)
  // Pinned: use the global Jira project pin so opening this dialog
  // defaults to whatever project the user picked anywhere else.
  const projectKey = pinnedProjectKey
  const setProjectKey = setJiraProjectKey
  const [linkedKey, setLinkedKey] = useState('')
  const [linkType, setLinkType] = useState('Relates')
  const [issues, setIssues] = useState([])
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [summary, setSummary] = useState('')
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState(null)

  const derivedSummary = useMemo(() => deriveSummary(markdown), [markdown])

  // Load all open issues (any type) for the chosen project so the user
  // can pick a ticket to link the bug to. Free-typing any key is allowed.
  useEffect(() => {
    if (!open) return
    if (!projectKey || !jiraConnected) {
      setIssues([])
      return
    }
    let cancelled = false
    setIssuesLoading(true)
    listIssues(projectKey, '', 50)
      .then(list => { if (!cancelled) setIssues(list || []) })
      .catch(() => { if (!cancelled) setIssues([]) })
      .finally(() => { if (!cancelled) setIssuesLoading(false) })
    return () => { cancelled = true }
  }, [open, projectKey, jiraConnected, listIssues])

  // Only render the trigger for the bug-report agent
  if (agentName !== 'bug_report') return null

  const reset = () => {
    // projectKey is a persistent pin (SessionPrefs) — leave it alone.
    setLinkedKey('')
    setLinkType('Relates')
    setIssues([])
    setSummary('')
    setResult(null)
  }

  const openModal = () => {
    if (!jiraConnected) {
      toast.error('Connect to Jira from the Dashboard first.')
      return
    }
    if (!markdown || !markdown.trim()) {
      toast.error('No report content to push yet.')
      return
    }
    setSummary(derivedSummary)
    // Seed order: pinned session-pref > explicit defaultIssueKey from parent
    // (jiraContextKey from AgentForm). Always refresh on open so switching
    // tickets between runs is reflected immediately.
    const storyFallback = (pinnedStoryKey || defaultIssueKey || '').trim()
    setLinkedKey(storyFallback)
    // Also seed project from story key prefix when session pref is empty
    if (!projectKey && storyFallback) {
      const projSeed = storyFallback.split('-')[0] || ''
      if (projSeed) setProjectKey(projSeed)
    }
    setResult(null)
    setOpen(true)
  }

  const closeModal = () => {
    setOpen(false)
    reset()
  }

  const handleCreate = async () => {
    if (!projectKey) {
      toast.error('Select a Jira project first.')
      return
    }
    if (!summary.trim()) {
      toast.error('Bug summary is required.')
      return
    }
    setPushing(true)
    try {
      const body = {
        project_key: projectKey,
        summary: summary.trim(),
        description: markdown,
      }
      const linked = linkedKey.trim()
      if (linked) {
        body.linked_issue_key = linked
        body.link_type = linkType
      }
      const { data } = await api.post('/jira/create-bug', body)
      setResult(data)
      if (data.link_error) {
        toast(`Bug ${data.key} created — but link to ${linked} failed.`)
      } else if (data.linked_issue_key) {
        toast.success(`Bug ${data.key} created and linked to ${data.linked_issue_key}.`)
      } else {
        toast.success(`Bug ${data.key} created in Jira.`)
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to create Jira bug.')
    } finally {
      setPushing(false)
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="toon-btn bg-gradient-to-r from-toon-coral to-red-500 text-white text-sm py-2 px-4 hover:opacity-90"
      >
        🐞 Create in Jira
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={closeModal}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="bg-white rounded-toon-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div>
                  <h3 className="font-extrabold text-toon-navy text-lg">Create Bug in Jira</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    File the AI-drafted defect and (optionally) link it to an existing ticket.
                  </p>
                </div>
                <button onClick={closeModal} className="text-gray-400 hover:text-toon-coral text-2xl leading-none">×</button>
              </div>

              <div className="flex-1 overflow-auto p-5 space-y-4">
                {!result ? (
                  <>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Jira project</label>
                        <select
                          className="toon-input !py-2"
                          value={projectKey}
                          onChange={e => setProjectKey(e.target.value)}
                        >
                          <option value="">— Select project —</option>
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
                          Linked Jira ticket <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <input
                          list="jira-bug-link-list"
                          className="toon-input !py-2"
                          value={linkedKey}
                          onChange={e => {
                            const v = e.target.value
                            setLinkedKey(v)
                            // Mirror to global user-story pin if it parses as
                            // a Jira key — keeps Jira-push surfaces in sync.
                            if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(v.trim())) {
                              setUserStoryKey(v.trim())
                            }
                          }}
                          placeholder={
                            !projectKey
                              ? 'Select a project to load tickets'
                              : issuesLoading
                                ? 'Loading tickets…'
                                : 'Type or pick an issue key'
                          }
                          disabled={pushing}
                        />
                        <datalist id="jira-bug-link-list">
                          {(issues || []).map(it => (
                            <option key={it.key} value={it.key}>{it.summary}</option>
                          ))}
                        </datalist>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Link type</label>
                        <select
                          className="toon-input !py-2"
                          value={linkType}
                          onChange={e => setLinkType(e.target.value)}
                          disabled={!linkedKey.trim()}
                        >
                          {LINK_TYPES.map(lt => (
                            <option key={lt.value} value={lt.value}>{lt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Summary</label>
                        <input
                          className="toon-input !py-2"
                          value={summary}
                          onChange={e => setSummary(e.target.value)}
                          placeholder="One-line bug summary"
                          disabled={pushing}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-bold text-toon-navy">Description preview</label>
                        <span className="text-[11px] text-gray-400">Sent as the Jira issue description</span>
                      </div>
                      <div className="border border-gray-200 rounded-2xl bg-gray-50 p-3 max-h-56 overflow-auto">
                        <pre className="whitespace-pre-wrap text-xs text-gray-700 font-mono">{markdown}</pre>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-3">
                    <div className="toon-card !p-4 border border-emerald-200 bg-emerald-50/40">
                      <div className="text-sm font-bold text-toon-navy">
                        Created{' '}
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-toon-blue underline"
                        >
                          {result.key}
                        </a>
                      </div>
                      {result.linked_issue_key && !result.link_error && (
                        <div className="text-xs text-gray-600 mt-1">
                          Linked to <span className="font-bold">{result.linked_issue_key}</span> via{' '}
                          <span className="font-bold">{result.link_type}</span>.
                        </div>
                      )}
                      {result.link_error && (
                        <div className="text-xs text-toon-coral mt-1">
                          Bug created but linking to {result.linked_issue_key} failed: {result.link_error}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-100 bg-gray-50">
                {!result ? (
                  <>
                    <button
                      onClick={closeModal}
                      className="toon-btn bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm py-2 px-4"
                      disabled={pushing}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={pushing || !projectKey || !summary.trim()}
                      className="toon-btn toon-btn-coral text-sm py-2 px-4 disabled:opacity-50"
                    >
                      {pushing ? 'Creating…' : 'Create bug'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={closeModal}
                    className="toon-btn toon-btn-blue text-sm py-2 px-4"
                  >
                    Done
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
