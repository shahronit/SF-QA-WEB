import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useJira } from '../context/JiraContext'
import { useSessionPrefs } from '../context/SessionPrefsContext'
import { parseDefectReport, buildJiraDescription } from '../utils/parseDefectReport'
import { DescriptionBody } from './DefectReportCard'

// Common Jira issue link types — these are the names every Jira Cloud
// tenant ships with by default. Custom link types still work because
// the backend just forwards the chosen string to /rest/api/3/issueLink.
const LINK_TYPES = [
  { value: 'Relates',     label: 'Relates to' },
  { value: 'Blocks',      label: 'Blocks' },
  { value: 'Duplicate',   label: 'Duplicates' },
  { value: 'Cloners',     label: 'Cloned by' },
]

const PRIORITY_OPTIONS = ['Highest', 'High', 'Medium', 'Low', 'Lowest']
const SEVERITY_OPTIONS = ['Critical', 'Major', 'Minor', 'Trivial']

/**
 * Lightweight chip-input: comma or Enter to commit; backspace on an empty
 * input removes the last chip. Used for components, labels, and affects
 * versions so the user can quickly tweak the list parsed from the agent.
 */
function ChipInput({ value = [], onChange, placeholder, disabled }) {
  const [draft, setDraft] = useState('')
  const commit = (raw) => {
    const cleaned = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean)
    if (cleaned.length === 0) return
    const next = Array.from(new Set([...(value || []), ...cleaned]))
    onChange(next)
    setDraft('')
  }
  const remove = (idx) => {
    const next = value.filter((_, i) => i !== idx)
    onChange(next)
  }
  return (
    <div className="toon-input !py-1.5 flex flex-wrap items-center gap-1.5 min-h-[2.25rem]">
      {(value || []).map((v, i) => (
        <span
          key={`${v}-${i}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-toon-blue/10 border border-toon-blue/20 text-[11px] font-semibold text-toon-blue"
        >
          {v}
          <button
            type="button"
            disabled={disabled}
            onClick={() => remove(i)}
            className="text-toon-blue/60 hover:text-toon-coral leading-none disabled:opacity-40"
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="flex-1 min-w-[8rem] outline-none bg-transparent text-sm py-1"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit(draft)
          } else if (e.key === 'Backspace' && !draft && (value || []).length > 0) {
            e.preventDefault()
            remove(value.length - 1)
          }
        }}
        onBlur={() => { if (draft.trim()) commit(draft) }}
        placeholder={value && value.length ? '' : (placeholder || '')}
        disabled={disabled}
      />
    </div>
  )
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
  const projectKey = pinnedProjectKey
  const setProjectKey = setJiraProjectKey
  const [linkedKey, setLinkedKey] = useState('')
  const [linkType, setLinkType] = useState('Relates')
  const [issues, setIssues] = useState([])
  const [issuesLoading, setIssuesLoading] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [result, setResult] = useState(null)

  // Form state — initialised from parseDefectReport when the modal opens
  // so the user gets a one-click push when the agent's output is already
  // clean, but they can edit any field before sending.
  const [summary, setSummary] = useState('')
  const [priority, setPriority] = useState('')
  const [severity, setSeverity] = useState('')
  const [components, setComponents] = useState([])
  const [labels, setLabels] = useState([])
  const [environment, setEnvironment] = useState('')
  const [affectsVersions, setAffectsVersions] = useState([])
  const [description, setDescription] = useState('')

  const parsed = useMemo(() => parseDefectReport(markdown || ''), [markdown])

  // Re-parse the editable Description textarea on every keystroke so the
  // live preview panel mirrors exactly what Jira will receive. The
  // parser only cares about the bold sub-headers (`**Steps to
  // reproduce:**`, `**Actual results:**`, `**Expected results:**`,
  // `**Additional information:**`), so a plain description body — even
  // one the user heavily edited — produces the right structured shape.
  // The non-description fields (title, metadata table) are absent from
  // this textarea on purpose, so the parsed envelope's `title` /
  // `metadata` are empty strings; only `description` is consumed below.
  const previewDescription = useMemo(
    () => parseDefectReport(description || '').description,
    [description],
  )

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

  if (agentName !== 'bug_report') return null

  const reset = () => {
    setLinkedKey('')
    setLinkType('Relates')
    setIssues([])
    setSummary('')
    setPriority('')
    setSeverity('')
    setComponents([])
    setLabels([])
    setEnvironment('')
    setAffectsVersions([])
    setDescription('')
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
    // Seed the form from the parsed defect; fall back to stripping a
    // leading "# " from the markdown if the title slot is somehow empty.
    setSummary(parsed.title || '')
    setPriority(parsed.priority || '')
    setSeverity(parsed.severity || '')
    setComponents(parsed.components || [])
    setLabels(parsed.labels || [])
    setEnvironment(parsed.environment || '')
    setAffectsVersions(parsed.affectsVersions || [])
    // Description sent to Jira = clean Pentair-only block (Steps /
    // Expected / Actual / Additional). We deliberately drop the
    // metadata table and the paste-ready fenced section because their
    // content has been lifted into structured Jira fields above and
    // would be duplicated otherwise. Users can still edit freely.
    setDescription(buildJiraDescription(parsed) || markdown)

    const storyFallback = (parsed.linkedStory || pinnedStoryKey || defaultIssueKey || '').trim()
    setLinkedKey(storyFallback)
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
        description: description.trim() || markdown,
      }
      const linked = linkedKey.trim()
      if (linked) {
        body.linked_issue_key = linked
        body.link_type = linkType
      }
      if (priority) body.priority = priority
      if (severity) body.severity = severity
      if (components.length) body.components = components
      if (labels.length) body.labels = labels
      if (environment.trim()) body.environment = environment.trim()
      if (affectsVersions.length) body.affects_versions = affectsVersions

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
              className="bg-white rounded-toon-lg shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-100">
                <div>
                  <h3 className="font-extrabold text-toon-navy text-lg">Create Bug in Jira</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Review the AI-drafted defect, tweak any field, and push to Jira as a structured bug.
                  </p>
                </div>
                <button onClick={closeModal} className="text-gray-400 hover:text-toon-coral text-2xl leading-none">×</button>
              </div>

              <div className="flex-1 overflow-auto p-5 space-y-4">
                {!result ? (
                  <>
                    {/* Project + Linked story */}
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Jira project</label>
                        <select
                          className="toon-input !py-2"
                          value={projectKey}
                          onChange={e => setProjectKey(e.target.value)}
                          disabled={pushing}
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

                    {/* Link type + Summary */}
                    <div className="grid sm:grid-cols-[1fr_2fr] gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Link type</label>
                        <select
                          className="toon-input !py-2"
                          value={linkType}
                          onChange={e => setLinkType(e.target.value)}
                          disabled={!linkedKey.trim() || pushing}
                        >
                          {LINK_TYPES.map(lt => (
                            <option key={lt.value} value={lt.value}>{lt.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">
                          Summary <span className="text-toon-coral">*</span>
                        </label>
                        <input
                          className="toon-input !py-2"
                          value={summary}
                          onChange={e => setSummary(e.target.value)}
                          placeholder="One-line bug summary (becomes the Jira title)"
                          disabled={pushing}
                        />
                      </div>
                    </div>

                    {/* Priority + Severity */}
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Priority</label>
                        <select
                          className="toon-input !py-2"
                          value={priority}
                          onChange={e => setPriority(e.target.value)}
                          disabled={pushing}
                        >
                          <option value="">— Not set —</option>
                          {PRIORITY_OPTIONS.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">
                          Severity <span className="font-normal text-gray-400">(custom field)</span>
                        </label>
                        <select
                          className="toon-input !py-2"
                          value={severity}
                          onChange={e => setSeverity(e.target.value)}
                          disabled={pushing}
                        >
                          <option value="">— Not set —</option>
                          {SEVERITY_OPTIONS.map(s => (
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Components + Labels */}
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Components</label>
                        <ChipInput
                          value={components}
                          onChange={setComponents}
                          placeholder="Press Enter to add — must match a project component name"
                          disabled={pushing}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Labels</label>
                        <ChipInput
                          value={labels}
                          onChange={setLabels}
                          placeholder="Press Enter to add (spaces become underscores)"
                          disabled={pushing}
                        />
                      </div>
                    </div>

                    {/* Environment + AffectsVersions */}
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Environment</label>
                        <input
                          className="toon-input !py-2"
                          value={environment}
                          onChange={e => setEnvironment(e.target.value)}
                          placeholder="Production / Staging / UAT / …"
                          disabled={pushing}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-toon-navy mb-1">Affects version(s)</label>
                        <ChipInput
                          value={affectsVersions}
                          onChange={setAffectsVersions}
                          placeholder="Press Enter to add — must match a project version name"
                          disabled={pushing}
                        />
                      </div>
                    </div>

                    {/* Description (editable on the left, live Jira-style
                        preview on the right). The preview re-parses the
                        textarea on every keystroke and renders through
                        the same DescriptionBody used by the Defect Card,
                        so the user sees exactly what Jira will display
                        before they push the bug. */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-bold text-toon-navy">
                          Description <span className="font-normal text-gray-400">(Steps / Expected / Actual)</span>
                        </label>
                        <span className="text-[11px] text-gray-400">
                          Sent as the Jira issue description. Metadata above is sent as real Jira fields, not duplicated here.
                        </span>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                          <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">
                            Edit
                          </div>
                          <textarea
                            className="toon-input !py-2 font-mono text-xs leading-relaxed w-full"
                            rows={14}
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            disabled={pushing}
                          />
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wider font-bold text-gray-400 mb-1">
                            Jira preview
                          </div>
                          <div className="rounded-2xl border border-gray-200 bg-white p-3 min-h-[14rem] max-h-[26rem] overflow-auto">
                            {previewDescription &&
                              (previewDescription.steps?.length > 0
                                || previewDescription.actual
                                || previewDescription.expected
                                || previewDescription.additional) ? (
                              <DescriptionBody description={previewDescription} />
                            ) : (
                              <div className="text-xs text-gray-400 italic">
                                Type into the Description editor — the preview will mirror how Jira renders Steps / Actual / Expected / Additional.
                              </div>
                            )}
                          </div>
                        </div>
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
