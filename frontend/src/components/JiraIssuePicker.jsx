import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { useJira } from '../context/JiraContext'

const ISSUE_TYPES = ['', 'Epic', 'Story', 'Task', 'Bug', 'Sub-task']

/**
 * Reusable Jira issue browser. When the user picks an issue and clicks
 * "Import to form", the parent receives the full issue detail via onImport.
 *
 * onImport(issueDetail) — caller maps issue fields into agent inputs.
 */
export default function JiraIssuePicker({ onImport }) {
  const { connected, projects, listIssues, getIssue } = useJira()

  const [open, setOpen] = useState(false)
  const [projectKey, setProjectKey] = useState('')
  const [issueType, setIssueType] = useState('')
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    if (open && connected && projects.length && !projectKey) {
      setProjectKey(projects[0].key)
    }
  }, [open, connected, projects, projectKey])

  useEffect(() => {
    if (!open || !projectKey) return
    let cancelled = false
    setLoading(true)
    setIssues([])
    setSelected(null)
    setDetail(null)
    listIssues(projectKey, issueType, 50)
      .then(list => { if (!cancelled) setIssues(list) })
      .catch(err => {
        if (!cancelled) toast.error(err.response?.data?.detail || 'Failed to fetch issues')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, projectKey, issueType, listIssues])

  const handleSelect = async (issue) => {
    setSelected(issue)
    setDetail(null)
    setDetailLoading(true)
    try {
      const d = await getIssue(issue.key)
      setDetail(d)
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to load issue')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleImport = () => {
    if (!detail) return
    onImport?.(detail)
    toast.success(`Imported ${detail.key}`)
  }

  if (!connected) return null

  return (
    <div className="toon-card !p-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm shadow-toon">
          🎯
        </span>
        <div className="flex-1 flex items-center justify-between">
          <h3 className="text-sm font-bold text-toon-navy">
            Import from Jira
            <span className="font-normal text-gray-400 ml-2">(optional — auto-fills form from a Jira issue)</span>
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* Issue list */}
                <div className="border border-gray-200 rounded-xl bg-white max-h-72 overflow-auto">
                  {loading && (
                    <div className="p-4 text-center text-sm text-gray-400">Loading…</div>
                  )}
                  {!loading && issues.length === 0 && (
                    <div className="p-4 text-center text-sm text-gray-400">
                      {projectKey ? 'No issues found' : 'Pick a project to browse'}
                    </div>
                  )}
                  {!loading && issues.map(it => (
                    <button
                      key={it.key}
                      onClick={() => handleSelect(it)}
                      className={`w-full text-left px-3 py-2 border-b border-gray-100 last:border-0 hover:bg-blue-50 transition-colors ${
                        selected?.key === it.key ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-toon-blue">{it.key}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{it.issuetype}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{it.status}</span>
                      </div>
                      <div className="text-sm text-gray-800 truncate">{it.summary}</div>
                    </button>
                  ))}
                </div>

                {/* Detail panel */}
                <div className="border border-gray-200 rounded-xl bg-white max-h-72 overflow-auto p-3">
                  {!selected && (
                    <div className="text-sm text-gray-400 text-center py-8">Select an issue to view details</div>
                  )}
                  {selected && detailLoading && (
                    <div className="text-sm text-gray-400 text-center py-8">Loading…</div>
                  )}
                  {selected && detail && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <a href={detail.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-toon-blue hover:underline">
                          {detail.key} ↗
                        </a>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{detail.issuetype}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{detail.status}</span>
                      </div>
                      <h4 className="text-sm font-bold text-toon-navy">{detail.summary}</h4>
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap max-h-32 overflow-auto bg-gray-50 p-2 rounded">
                        {(detail.description || '').slice(0, 1000) || '(no description)'}
                      </pre>
                      <button
                        onClick={handleImport}
                        className="toon-btn toon-btn-blue text-xs w-full"
                      >
                        ⬇ Import to form
                      </button>
                    </div>
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
