import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import PageHeader from '../components/PageHeader'
import ReportPanel from '../components/ReportPanel'
import ProjectContextPicker from '../components/ProjectContextPicker'
import GeneratingScene from '../components/motion/GeneratingScene'
import JiraTicketCard from '../components/JiraTicketCard'
import QuickPackInputs from '../components/quickpack/QuickPackInputs'
import { useAuth } from '../context/AuthContext'
import { useAgentResults } from '../context/AgentResultsContext'
import { useSessionPrefs } from '../context/SessionPrefsContext'
import { useJira } from '../context/JiraContext'
import { useQaMode, QA_MODE_OPTIONS } from '../hooks/useQaMode'
import { useAgentStream } from '../hooks/useAgentStream'
import {
  AGENT_META,
  getAgent,
  getRunnableAgentsForUser,
  userCanAccessPath,
} from '../config/agentMeta'
import {
  AGENT_FIELDS,
  getAgentFields,
  getMissingRequiredKeys,
  isReadyToRun,
} from '../config/agentInputs'
import { extractJiraKey } from '../utils/jiraDetect'

// Status vocabulary used by the tab strip dots and per-tab banner.
// Mirrors the language on the STLC pack page so users see consistent
// states across the two multi-agent surfaces. `needs_input` is unique
// to Quick Pack: it means the bulk Generate skipped this tab because
// at least one required field was empty.
const STATUS_STYLES = {
  idle:        { dot: 'bg-gray-300',                     text: 'Idle' },
  needs_input: { dot: 'bg-amber-400',                    text: 'Needs input' },
  loading:     { dot: 'bg-toon-blue animate-pulse',      text: 'Streaming' },
  done:        { dot: 'bg-toon-mint',                    text: 'Done' },
  error:       { dot: 'bg-toon-coral',                   text: 'Error' },
}

// Lite-mode renderer of an issue payload into seed text. Mirrors the
// minimal subset of `jiraIssueToText` used by AgentForm so users get
// recognisable Context after a Jira fetch without us reaching into
// AgentForm's private function. Handles both the rich `/full` shape
// and the lite `/issue/{key}` shape.
function jiraPayloadToText(issue) {
  if (!issue) return ''
  const isRich = !!(issue.core || issue.fetch_metadata)
  const c = isRich ? (issue.core || {}) : issue
  const lines = []
  const head = `Jira ${c.issuetype || 'Issue'} ${c.key || ''}: ${c.summary || ''}`.trim()
  if (head) lines.push(head)
  const status = []
  if (c.status) status.push(`Status: ${c.status}`)
  if (c.priority) status.push(`Priority: ${c.priority}`)
  if (status.length) lines.push(status.join(' | '))
  if (c.components?.length) lines.push(`Components: ${c.components.join(', ')}`)
  if (c.labels?.length) lines.push(`Labels: ${c.labels.join(', ')}`)
  if (c.environment) lines.push(`Environment: ${c.environment}`)
  lines.push('', 'Description:', (c.description || '(no description)').trim())
  if (isRich && Array.isArray(issue.subtasks) && issue.subtasks.length) {
    lines.push('', 'Sub-tasks:')
    for (const s of issue.subtasks) {
      const bits = [s.key, s.status ? `[${s.status}]` : '', s.summary].filter(Boolean)
      lines.push(`- ${bits.join(' ')}`)
    }
  }
  return lines.join('\n')
}

// Resolve the primary input field key for a given agent. AGENT_META
// stores the key as either a string or an array of fallbacks (e.g.
// bug_report = ['bug_description', 'bug_title']); we always pick the
// first entry — Quick Pack treats the shared Context as a free-text
// blob, so the wider Description is the right slot when both exist.
function pickPrimaryFieldKey(slug) {
  const meta = AGENT_META[slug]
  if (!meta) return null
  const declared = meta.primaryFieldKey
  if (Array.isArray(declared)) return declared[0] || null
  if (typeof declared === 'string') return declared
  return null
}

/**
 * One Quick Pack tab — owns its own SSE stream and its own draft
 * input values so the user can edit just this agent's fields and
 * (re)run it independently. Reports lifecycle changes back to the
 * parent so the tab strip dot stays in sync, and persists completed
 * runs into AgentResultsContext exactly like AgentForm does.
 */
function QuickPackTab({
  slug,
  visible,
  values,
  qaMode,
  projectSlug,
  jiraContextKey,
  onState,
  onValuesChange,
  triggerRun,           // bumped when the parent wants this tab to start
  shake,                // bumped when bulk Generate skipped this tab
  isAdminBulkSkipped,   // true when the latest bulk Generate skipped this tab
}) {
  const meta = getAgent(slug)
  const { saveResult } = useAgentResults()
  const stream = useAgentStream({ agentName: slug, projectSlug })
  const lastSavedRef = useRef('')
  const lastReportedStatusRef = useRef('idle')
  const lastTriggerRef = useRef(0)

  const fields = useMemo(() => getAgentFields(slug), [slug])
  const missing = useMemo(
    () => getMissingRequiredKeys(slug, values),
    [slug, values],
  )
  const ready = missing.length === 0

  // Derived status: stream status wins, but if the stream is idle and
  // the bulk Generate skipped us we surface 'needs_input' instead.
  const derivedStatus = stream.status === 'idle' && isAdminBulkSkipped && !ready
    ? 'needs_input'
    : stream.status

  // Bubble derived status changes up to the parent so the tab strip
  // and counter chips stay in sync.
  useEffect(() => {
    if (lastReportedStatusRef.current === derivedStatus) return
    lastReportedStatusRef.current = derivedStatus
    onState?.(slug, derivedStatus)
  }, [slug, derivedStatus, onState])

  // Run when the parent bumps `triggerRun`. Validates required fields
  // first so even a single-tab run honours the same contract as the
  // bulk Generate.
  useEffect(() => {
    if (!triggerRun || triggerRun === lastTriggerRef.current) return
    lastTriggerRef.current = triggerRun
    if (!ready) return
    const userInput = { ...values, qa_mode: qaMode }
    stream.start({ user_input: userInput, project_slug: projectSlug })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerRun])

  // Persist completed runs into the cross-page results store so they
  // appear in History and can be linked-as-previous-output on per-
  // agent pages. Guard with a ref so React StrictMode's double-effect
  // doesn't save the same run twice.
  useEffect(() => {
    if (stream.status !== 'done') return
    if (!stream.content || stream.content.startsWith('**Error')) return
    const key = `${slug}::${stream.content.length}::${stream.runMeta?.usage?.total_tokens || ''}`
    if (lastSavedRef.current === key) return
    lastSavedRef.current = key
    saveResult(slug, stream.content, stream.runMeta)
    try {
      window.dispatchEvent(new CustomEvent('qa:agent-run-complete', {
        detail: { agent: slug, length: stream.content.length },
      }))
    } catch { /* ignore */ }
  }, [stream.status, stream.content, stream.runMeta, slug, saveResult])

  const handlePerTabRun = () => {
    if (stream.status === 'loading') return
    if (!ready) {
      toast.error(`Missing required fields: ${missing.join(', ')}`)
      return
    }
    const userInput = { ...values, qa_mode: qaMode }
    stream.reset()
    stream.start({ user_input: userInput, project_slug: projectSlug })
  }

  const isRegenerate = stream.status === 'done' || stream.status === 'error'
  const buttonLabel = stream.status === 'loading'
    ? '⏳ Streaming…'
    : isRegenerate
      ? '🔁 Regenerate'
      : '🚀 Generate this agent'
  const buttonDisabled = stream.status === 'loading' || !ready

  // CSS-hide instead of unmount — keeps in-flight streams alive while
  // the user clicks across tabs to peek at others.
  return (
    <div className={visible ? 'block' : 'hidden'}>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left column: per-tab Inputs panel */}
        <div className="xl:col-span-1 toon-card !p-4 self-start">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-sm shadow-toon">
              {meta?.icon || '✨'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-extrabold text-toon-navy truncate">
                {meta?.label || slug}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">
                Inputs
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500">
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLES[derivedStatus]?.dot || 'bg-gray-300'}`} />
              {STATUS_STYLES[derivedStatus]?.text || 'Idle'}
            </span>
          </div>

          {derivedStatus === 'needs_input' && missing.length > 0 && (
            <div className="mb-3 rounded-xl bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800">
              <span className="font-bold">Skipped by bulk Generate.</span>{' '}
              Fill the highlighted fields below, then click Generate this agent.
            </div>
          )}

          <QuickPackInputs
            fields={fields}
            values={values}
            onChange={(k, v) => onValuesChange(k, v)}
            qaMode={qaMode}
            missing={missing}
            shake={shake}
            disabled={stream.status === 'loading'}
          />

          <div className="mt-4 flex flex-wrap gap-2">
            <motion.button
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={handlePerTabRun}
              disabled={buttonDisabled}
              className={`px-3 py-2 rounded-xl font-extrabold text-white text-sm transition-all shadow-toon ${
                buttonDisabled
                  ? 'bg-gray-300 cursor-not-allowed'
                  : isRegenerate
                    ? 'bg-toon-blue hover:shadow-lg cursor-pointer'
                    : 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:shadow-lg cursor-pointer'
              }`}
            >
              {buttonLabel}
            </motion.button>
            {missing.length > 0 && (
              <span className="text-[11px] text-amber-700 self-center">
                Missing: <span className="font-mono font-bold">{missing.join(', ')}</span>
              </span>
            )}
          </div>
        </div>

        {/* Right column: report area */}
        <div className="xl:col-span-2">
          {!stream.content && stream.status === 'idle' ? (
            <div className="toon-card text-center py-12 text-gray-500">
              <div className="text-3xl mb-2">{meta?.icon || '✨'}</div>
              <div className="font-bold text-toon-navy mb-1">{meta?.label || slug}</div>
              <div className="text-sm">
                Fill the inputs on the left and click <span className="font-bold text-toon-blue">Generate</span>,
                or use the bulk <span className="font-bold text-violet-600">Generate</span> button up top.
              </div>
            </div>
          ) : !stream.content && stream.status === 'loading' ? (
            <div className="toon-card">
              <GeneratingScene size="md" caption={`Running ${meta?.label || slug}…`} />
            </div>
          ) : (
            <ReportPanel
              content={stream.content}
              agentName={slug}
              sheetTitle={meta?.label || slug}
              stamp={`quickpack-${slug}-${stream.status}`}
              loading={stream.status === 'loading'}
              jiraContextKey={jiraContextKey}
              runMeta={stream.runMeta}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function QuickPack() {
  const { user } = useAuth()
  const { qaProjectSlug, setQaProjectSlug, userStoryKey, setUserStoryKey, setJiraProjectKey } = useSessionPrefs()
  const { connected: jiraConnected, getFullIssue, resolveFromText } = useJira()
  const [qaMode, setQaMode] = useQaMode()
  const [projects, setProjects] = useState([])
  const [context, setContext] = useState('')
  const [jiraInput, setJiraInput] = useState('')
  const [jiraFetching, setJiraFetching] = useState(false)
  const [importedIssue, setImportedIssue] = useState(null)
  const [perAgentValues, setPerAgentValues] = useState({})
  const [statuses, setStatuses] = useState({})
  const [activeSlug, setActiveSlug] = useState(null)

  // Per-tab `triggerRun` counters. Bumping a tab's counter wakes its
  // child component up and starts a fresh stream. The bulk Generate
  // bumps every ready tab in one go; the per-tab Generate button
  // calls handlePerTabRun directly inside the tab and doesn't go
  // through this map.
  const [triggerMap, setTriggerMap] = useState({})

  // Bumping `shakeStamp` makes every skipped tab's missing-fields
  // pulse so the user notices what's blocking the bulk run.
  const [shakeStamp, setShakeStamp] = useState(0)

  // Remember which tabs the LATEST bulk Generate skipped so the
  // status stays 'needs_input' (instead of 'idle') until the user
  // either fills the inputs and runs, or clicks Reset.
  const [bulkSkipped, setBulkSkipped] = useState(new Set())

  const accessibleAgents = useMemo(() => getRunnableAgentsForUser(user), [user])

  // Initialise the active tab to the first accessible agent and keep
  // it valid when the allow-list changes (e.g. admin grants access
  // mid-session).
  useEffect(() => {
    if (!activeSlug && accessibleAgents.length > 0) {
      setActiveSlug(accessibleAgents[0])
    }
    if (activeSlug && !accessibleAgents.includes(activeSlug)) {
      setActiveSlug(accessibleAgents[0] || null)
    }
  }, [accessibleAgents, activeSlug])

  // Auto-pin the user-story key when the user types a recognizable
  // Jira key/URL into the seed input. Mirrors the StlcPack page so
  // Jira pushes from per-tab ReportPanels default to this story.
  const detectedKey = useMemo(() => extractJiraKey(jiraInput), [jiraInput])
  useEffect(() => {
    if (!detectedKey) return
    setUserStoryKey(detectedKey)
    const projKey = detectedKey.split('-')[0] || ''
    if (projKey) setJiraProjectKey(projKey)
  }, [detectedKey, setUserStoryKey, setJiraProjectKey])

  const fetchProjects = useCallback(() => {
    api.get('/projects/')
      .then(({ data }) => setProjects(data.projects || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchProjects()
    const onProjectsUpdated = () => fetchProjects()
    window.addEventListener('qa:projects-updated', onProjectsUpdated)
    return () => window.removeEventListener('qa:projects-updated', onProjectsUpdated)
  }, [fetchProjects])

  // Whenever the shared Context changes, gently auto-prefill every
  // tab's primary field IF that field is currently empty. We never
  // overwrite manual edits — once a user types into a tab's input,
  // it's theirs.
  useEffect(() => {
    if (!context) return
    setPerAgentValues(prev => {
      const next = { ...prev }
      for (const slug of accessibleAgents) {
        const primaryKey = pickPrimaryFieldKey(slug)
        if (!primaryKey) continue
        const tab = next[slug] || {}
        if (!tab[primaryKey] || tab[primaryKey].trim() === '') {
          next[slug] = { ...tab, [primaryKey]: context }
        }
      }
      return next
    })
  }, [context, accessibleAgents])

  const handleValuesChange = useCallback((slug, key, value) => {
    setPerAgentValues(prev => ({
      ...prev,
      [slug]: { ...(prev[slug] || {}), [key]: value },
    }))
    // The user editing a tab clears its bulk-skipped flag so the dot
    // returns to 'idle' (or 'done'/'error' from the stream) instead
    // of staying stuck on 'needs_input'.
    setBulkSkipped(prev => {
      if (!prev.has(slug)) return prev
      const next = new Set(prev)
      next.delete(slug)
      return next
    })
  }, [])

  const handleStateChange = useCallback((slug, status) => {
    setStatuses(prev => (prev[slug] === status ? prev : { ...prev, [slug]: status }))
  }, [])

  const readyCount = useMemo(
    () => accessibleAgents.filter(s => isReadyToRun(s, perAgentValues[s])).length,
    [accessibleAgents, perAgentValues],
  )
  const needsInputCount = accessibleAgents.length - readyCount
  const runningCount = useMemo(
    () => Object.values(statuses).filter(s => s === 'loading').length,
    [statuses],
  )
  const doneCount = useMemo(
    () => Object.values(statuses).filter(s => s === 'done').length,
    [statuses],
  )
  const errorCount = useMemo(
    () => Object.values(statuses).filter(s => s === 'error').length,
    [statuses],
  )
  const isRunning = runningCount > 0

  const handleBulkGenerate = () => {
    if (isRunning) return
    if (accessibleAgents.length === 0) return
    const skip = new Set()
    const trigger = { ...triggerMap }
    let firedCount = 0
    for (const slug of accessibleAgents) {
      if (isReadyToRun(slug, perAgentValues[slug])) {
        trigger[slug] = (trigger[slug] || 0) + 1
        firedCount += 1
      } else {
        skip.add(slug)
      }
    }
    setBulkSkipped(skip)
    setTriggerMap(trigger)
    setShakeStamp(Date.now())
    if (firedCount === 0) {
      toast.error('No agents are ready — fill the required inputs on each tab first.')
    } else {
      toast.success(`Generating ${firedCount} of ${accessibleAgents.length} agents in parallel…`)
    }
  }

  const handleReset = () => {
    if (isRunning) return
    setPerAgentValues({})
    setStatuses({})
    setBulkSkipped(new Set())
    setTriggerMap({})
    setImportedIssue(null)
    setJiraInput('')
    setContext('')
  }

  const handleJiraFetch = async () => {
    const text = jiraInput.trim()
    if (!text || jiraFetching || !jiraConnected) return
    setJiraFetching(true)
    try {
      const resp = await resolveFromText(text)
      const key = resp?.key
      let payload = null
      if (key) {
        try { payload = await getFullIssue(key) } catch { payload = resp?.issue || null }
      } else {
        payload = resp?.issue || null
      }
      if (!payload) {
        toast.error('Could not find that Jira ticket.')
        return
      }
      setImportedIssue(payload)
      const core = payload?.core || payload || {}
      const summary = (core.summary || '').trim()
      const issueEnv = (core.environment || '').trim()
      const seedText = jiraPayloadToText(payload)
      // Seed the shared Context: replace whatever was there so the
      // user clearly sees the fetched story in front of them. The
      // context-watching effect then auto-fills every empty primary
      // field across the tabs. Preserves manual edits made AFTER the
      // fetch (only blank primary fields get filled).
      setContext(seedText)
      // bug_report is special-cased: defects are best filed as a
      // one-line title (`KEY: summary`) rather than the full Jira
      // body, so the user can hit Generate immediately and let the
      // agent infer Steps / Expected / Actual. The generic context
      // effect won't overwrite this because it only fills the
      // primary field when blank.
      if (accessibleAgents.includes('bug_report')) {
        setPerAgentValues(prev => {
          const next = { ...prev }
          const tab = { ...(next['bug_report'] || {}) }
          if (!tab.bug_description || !tab.bug_description.trim()) {
            tab.bug_description = key
              ? `${key}: ${summary}`.trim().replace(/:\s*$/, '')
              : summary
          }
          if (!tab.environment && issueEnv) {
            const envField = AGENT_FIELDS.bug_report.find(f => f.key === 'environment')
            const opts = envField?.optionsByMode?.[qaMode] || envField?.options || []
            const needle = issueEnv.toLowerCase()
            const hit = opts.find(o => {
              const label = typeof o === 'string' ? o : o.value
              return needle.includes(String(label).toLowerCase())
            })
            if (hit) tab.environment = typeof hit === 'string' ? hit : hit.value
          }
          next['bug_report'] = tab
          return next
        })
      }
      toast.success(key ? `Imported Jira ${key}${summary ? ` — ${summary}` : ''}` : 'Imported Jira ticket')
    } catch (err) {
      toast.error(err?.message || 'Failed to fetch Jira ticket')
    } finally {
      setJiraFetching(false)
    }
  }

  if (!user) return null

  const canAccessQuickPack = userCanAccessPath(user, '/quick-pack')
  if (!canAccessQuickPack) {
    return (
      <div>
        <PageHeader
          title="QA Workbench"
          subtitle="Run every agent you have access to from one prompt"
          icon="🚀"
          gradient="from-violet-500 to-fuchsia-500"
        />
        <div className="toon-card text-center py-16">
          <div className="text-5xl mb-3">🔒</div>
          <h3 className="text-xl font-extrabold text-toon-navy mb-2">QA Workbench is disabled for your account</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Ask an administrator to enable
            <span className="font-bold text-astound-violet"> QA Workbench</span>
            {' '}in your user access settings.
          </p>
        </div>
      </div>
    )
  }

  if (accessibleAgents.length === 0) {
    return (
      <div>
        <PageHeader
          title="QA Workbench"
          subtitle="Run every agent you have access to from one prompt"
          icon="🚀"
          gradient="from-violet-500 to-fuchsia-500"
        />
        <div className="toon-card text-center py-16">
          <div className="text-5xl mb-3">🛂</div>
          <h3 className="text-xl font-extrabold text-toon-navy mb-2">No agents available</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Your account doesn&apos;t have access to any agents yet.
            Ask an administrator to grant access from the
            <span className="font-bold text-astound-violet"> Admin → Access</span> panel.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="QA Workbench"
        subtitle="One Context, every agent you can access — fired in parallel"
        icon="🚀"
        gradient="from-violet-500 to-fuchsia-500"
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="toon-card mb-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-lg shadow-md">
            ⚡
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-extrabold text-toon-navy">Run every agent you have access to</h2>
            <p className="text-sm text-gray-500">
              Paste a Jira key or describe your scope below. Every accessible
              agent gets its own tab with editable inputs and a per-tab
              Regenerate. Bulk Generate runs all agents whose required
              fields are filled — the rest stay tagged
              <span className="font-bold text-amber-700"> Needs input</span>.
            </p>
          </div>
          <span className="text-[11px] font-bold text-astound-violet bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full whitespace-nowrap">
            {accessibleAgents.length} agent{accessibleAgents.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* QA mode pills */}
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-gray-50 rounded-2xl p-3 border border-gray-200">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-toon-purple to-violet-500 flex items-center justify-center text-white text-sm shadow-toon">
              🎚️
            </span>
            <div>
              <div className="text-sm font-bold text-toon-navy">QA Mode</div>
              <div className="text-xs text-gray-500">
                {qaMode === 'salesforce'
                  ? 'Every agent uses Salesforce conventions.'
                  : 'Every agent runs in product-agnostic mode.'}
              </div>
            </div>
          </div>
          <div className="sm:ml-auto inline-flex bg-white rounded-2xl p-1 border border-gray-200 self-start sm:self-center">
            {QA_MODE_OPTIONS.map(opt => {
              const active = qaMode === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setQaMode(opt.id)}
                  disabled={isRunning}
                  aria-pressed={active}
                  className={`relative px-4 py-1.5 rounded-xl text-sm font-bold transition-colors ${
                    active ? 'text-white' : 'text-gray-600 hover:text-toon-navy'
                  } ${isRunning ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {active && (
                    <motion.span
                      layoutId="quick-pack-qa-mode"
                      className="absolute inset-0 bg-toon-blue rounded-xl shadow-sm"
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className="relative flex items-center gap-1.5">
                    <span aria-hidden="true">{opt.icon}</span>
                    {opt.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm font-bold text-toon-navy mb-1.5 block">
              Project (for RAG context) <span className="text-gray-400 font-normal">— optional</span>
            </label>
            <ProjectContextPicker
              projects={projects}
              value={qaProjectSlug}
              onChange={setQaProjectSlug}
              onProjectsChanged={fetchProjects}
              variant="compact"
              disabled={isRunning}
            />
          </div>
          <div>
            <label className="text-sm font-bold text-toon-navy mb-1.5 block">
              Jira ticket
              <span className="font-normal text-gray-400 ml-2">
                {jiraConnected
                  ? '(paste a key or URL — we auto-fetch the full details)'
                  : '(Jira not connected — fill the Context box below directly)'}
              </span>
            </label>
            <div className="flex gap-2">
              <input
                className="toon-input flex-1"
                placeholder={jiraConnected ? 'ABC-123 or https://acme.atlassian.net/browse/ABC-123' : 'Connect Jira from the Hub to enable auto-fetch'}
                value={jiraInput}
                onChange={(e) => setJiraInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleJiraFetch()
                  }
                }}
                disabled={!jiraConnected || jiraFetching || isRunning}
              />
              <button
                type="button"
                onClick={handleJiraFetch}
                disabled={!jiraConnected || jiraFetching || !jiraInput.trim() || isRunning}
                className="toon-btn toon-btn-blue text-sm px-4 py-2 whitespace-nowrap"
              >
                {jiraFetching ? '…' : 'Fetch'}
              </button>
            </div>
            {detectedKey && (
              <div className="mt-1.5 text-xs font-bold text-violet-600">
                Detected: {detectedKey}
              </div>
            )}
          </div>
        </div>

        {/* Imported Jira preview */}
        <AnimatePresence>
          {importedIssue && (
            <motion.div
              key="imported-jira"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden mb-4"
            >
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <JiraTicketCard
                  detail={importedIssue}
                  compact
                  defaultExpanded={false}
                  onRemove={() => setImportedIssue(null)}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mb-4">
          <label className="text-sm font-bold text-toon-navy mb-1.5 block">
            Context <span className="text-gray-400 font-normal">— seeds every tab&apos;s primary field if blank</span>
          </label>
          <textarea
            className="toon-textarea"
            rows={5}
            placeholder="Paste a user story, feature description, deployment scope, or any context. Each tab also has its own per-agent inputs you can edit below."
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={isRunning}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.97 }}
            whileHover={!isRunning && readyCount > 0 ? { y: -2 } : {}}
            onClick={handleBulkGenerate}
            disabled={isRunning || readyCount === 0}
            className={`px-5 py-2.5 rounded-2xl font-extrabold text-white transition-all shadow-toon ${
              !isRunning && readyCount > 0
                ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:shadow-lg cursor-pointer'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
            title={readyCount === 0 ? 'Fill required inputs on at least one tab' : ''}
          >
            {isRunning
              ? `⏳ Streaming ${runningCount}/${accessibleAgents.length}…`
              : `🚀 Generate ready agents (${readyCount}/${accessibleAgents.length})`}
          </motion.button>
          <button
            type="button"
            onClick={handleReset}
            disabled={isRunning}
            className="px-4 py-2 rounded-2xl font-bold border-2 border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Reset all
          </button>
          <div className="text-xs font-bold text-gray-600 flex items-center gap-3 ml-auto">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-toon-mint" />
              {readyCount} ready
            </span>
            {needsInputCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {needsInputCount} need input
              </span>
            )}
            {runningCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-toon-blue">
                <span className="w-1.5 h-1.5 rounded-full bg-toon-blue animate-pulse" />
                {runningCount} streaming
              </span>
            )}
            {doneCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700">
                <span className="w-1.5 h-1.5 rounded-full bg-toon-mint" />
                {doneCount} done
              </span>
            )}
            {errorCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-toon-coral">
                <span className="w-1.5 h-1.5 rounded-full bg-toon-coral" />
                {errorCount} error
              </span>
            )}
          </div>
        </div>
      </motion.div>

      {/* Tab strip */}
      <div className="mb-4 flex flex-wrap gap-2 sticky top-0 z-10 bg-astound-cream/80 backdrop-blur-sm py-2 -mx-2 px-2 rounded-2xl">
        {accessibleAgents.map(slug => {
          const meta = getAgent(slug)
          const status = statuses[slug] || (bulkSkipped.has(slug) ? 'needs_input' : 'idle')
          const styles = STATUS_STYLES[status] || STATUS_STYLES.idle
          const isActive = slug === activeSlug
          const ready = isReadyToRun(slug, perAgentValues[slug])
          return (
            <button
              key={slug}
              type="button"
              onClick={() => setActiveSlug(slug)}
              className={`group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                isActive
                  ? 'bg-astound-grad text-white border-transparent shadow-astound'
                  : 'bg-white text-toon-navy border-gray-200 hover:border-astound-violet/40'
              }`}
              title={!ready ? 'Required inputs missing — open this tab to fill them.' : undefined}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
              <span aria-hidden="true">{meta?.icon || '✨'}</span>
              <span>{meta?.label || slug}</span>
              {!ready && (
                <span className={`ml-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/20' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  needs input
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* All tabs are mounted simultaneously so in-flight streams stay
          alive while the user switches between them. Inactive tabs are
          CSS-hidden — no unmount, no abort. */}
      <div>
        {accessibleAgents.map(slug => (
          <QuickPackTab
            key={slug}
            slug={slug}
            visible={slug === activeSlug}
            values={perAgentValues[slug] || {}}
            qaMode={qaMode}
            projectSlug={qaProjectSlug || null}
            jiraContextKey={userStoryKey || ''}
            onState={handleStateChange}
            onValuesChange={(k, v) => handleValuesChange(slug, k, v)}
            triggerRun={triggerMap[slug] || 0}
            shake={shakeStamp}
            isAdminBulkSkipped={bulkSkipped.has(slug)}
          />
        ))}
      </div>
    </div>
  )
}
