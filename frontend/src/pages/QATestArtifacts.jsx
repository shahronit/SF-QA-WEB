import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import PageHeader from '../components/PageHeader'
import ReportPanel from '../components/ReportPanel'
import ProjectContextPicker from '../components/ProjectContextPicker'
import GeneratingScene from '../components/motion/GeneratingScene'
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
  getAgentActionLabel,
  getRunnableAgentsForUser,
  pickAutoRunnableAgents,
  selectedFirstStlcOrder,
  userCanAccessPath,
} from '../config/agentMeta'
import {
  AGENT_FIELDS,
  getAgentFields,
  getMissingRequiredKeys,
  isReadyToRun,
} from '../config/agentInputs'
import { splitJiraTokens, classifyJiraToken } from '../utils/jiraDetect'
import { seedTextFromBatch, summarizeBatchError } from '../utils/jiraSeed'
import BatchPreview from '../components/jira/BatchPreview'

// Status vocabulary used by the tab strip dots and per-tab banner.
// Mirrors the language on the STLC pack page so users see consistent
// states across the two multi-agent surfaces.
//   - `needs_input` is unique to Quick Pack: bulk Generate skipped the
//     tab because at least one required field was empty.
//   - `excluded` means the user explicitly unchecked the agent in the
//     "Apply Jira to" picker — that agent will be entirely skipped on
//     the next bulk Generate (no Needs input tag, no fire).
const STATUS_STYLES = {
  idle:        { dot: 'bg-gray-300',                     text: 'Idle' },
  needs_input: { dot: 'bg-amber-400',                    text: 'Needs input' },
  excluded:    { dot: 'bg-gray-400',                     text: 'Excluded' },
  loading:     { dot: 'bg-toon-blue animate-pulse',      text: 'Streaming' },
  done:        { dot: 'bg-toon-mint',                    text: 'Done' },
  error:       { dot: 'bg-toon-coral',                   text: 'Error' },
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
  // Agent-specific action label (e.g. "Generate Test Cases") falls back
  // to the generic "Generate" verb when a slug is missing from
  // AGENT_META. The Regenerate / Streaming states stay generic — they
  // describe the lifecycle, not the artifact.
  const actionLabel = getAgentActionLabel(slug)
  const buttonLabel = stream.status === 'loading'
    ? '⏳ Streaming…'
    : isRegenerate
      ? '🔁 Regenerate'
      : `🚀 ${actionLabel}`
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
              Fill the highlighted fields below, then click {actionLabel}.
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

export default function QATestArtifacts() {
  const { user } = useAuth()
  const {
    qaProjectSlug,
    setQaProjectSlug,
    userStoryKey,
    setUserStoryKey,
    setJiraProjectKey,
    quickPackTargets,
    setQuickPackTargets,
  } = useSessionPrefs()
  const { connected: jiraConnected, importBatch } = useJira()
  const [qaMode, setQaMode] = useQaMode()
  const [projects, setProjects] = useState([])
  const [context, setContext] = useState('')
  const [jiraInput, setJiraInput] = useState('')
  const [jiraFetching, setJiraFetching] = useState(false)
  // Array of resolved batch items: { token, kind, key?, primary?, children?, error? }.
  // Replaces the previous single-ticket model so the user can paste a
  // comma-separated list of issue keys, epic keys, and project keys at once.
  const [importedIssues, setImportedIssues] = useState([])
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

  // (orderedTabs memo is declared lower — JS hoisting of `let`/`const`
  // refs in JSX works fine because the effect below runs after
  // mount.) Initialise the active tab to the first accessible agent
  // and keep it valid when the allow-list changes (e.g. admin grants
  // access mid-session). The first-tab pick is intentionally based on
  // `accessibleAgents` (declaration order) here so the initial mount
  // is deterministic before the user has touched `quickPackTargets`
  // — the targeted-first reorder kicks in via a second effect once
  // selection state exists.
  useEffect(() => {
    if (!activeSlug && accessibleAgents.length > 0) {
      setActiveSlug(accessibleAgents[0])
    }
    if (activeSlug && !accessibleAgents.includes(activeSlug)) {
      setActiveSlug(accessibleAgents[0] || null)
    }
  }, [accessibleAgents, activeSlug])

  // Subset of `accessibleAgents` the user wants the next Jira import
  // and the next bulk Generate to apply to. Persists across reload via
  // SessionPrefsContext.quickPackTargets — ``null`` in storage means
  // "first-run / never picked", and we then default to the auto-runnable
  // subset (i.e. accessible agents minus the ones that need post-cycle
  // manual input — Defect Reports, Test Execution Report, Root Cause
  // Analysis, Test Closure Report). Seeding those from a Jira story
  // would produce fictional output, so they're left unchecked until the
  // user explicitly opts them in via the tab pill or the "All" toggle.
  // Unselecting an agent here:
  //   1. Skips it during the shared-Context auto-fill effect.
  //   2. Excludes it from `handleBulkGenerate` (no fire, no Needs input
  //      tag — the tab gets a neutral 'excluded' dot in the strip).
  // The choice survives `Reset all` so the user doesn't have to re-pick
  // their target set every run; clearing the import doesn't mean
  // forgetting which agents they care about.
  const defaultTargets = useMemo(
    () => pickAutoRunnableAgents(accessibleAgents),
    [accessibleAgents],
  )
  const selectedAgents = useMemo(() => {
    if (quickPackTargets === null || quickPackTargets === undefined) {
      return new Set(defaultTargets)
    }
    // Filter against the current allow-list — admin grants/revokes mid-
    // session shouldn't leave stale slugs in the active set.
    return new Set(quickPackTargets.filter(s => accessibleAgents.includes(s)))
  }, [quickPackTargets, accessibleAgents, defaultTargets])

  const toggleSelectedAgent = useCallback((slug) => {
    const current = quickPackTargets === null || quickPackTargets === undefined
      ? new Set(defaultTargets)
      : new Set(quickPackTargets.filter(s => accessibleAgents.includes(s)))
    if (current.has(slug)) current.delete(slug)
    else current.add(slug)
    setQuickPackTargets(current)
  }, [quickPackTargets, accessibleAgents, defaultTargets, setQuickPackTargets])

  // Tab-strip order: selected agents first (in STLC order P1 -> P5),
  // then the rest (also STLC-ordered). Memoised so toggling a target
  // reshuffles the strip in one render without re-running anything
  // expensive — the resolver inside QuickPackTab only re-runs when
  // its own `slug` changes, which doesn't happen here.
  const orderedTabs = useMemo(
    () => selectedFirstStlcOrder(accessibleAgents, selectedAgents),
    [accessibleAgents, selectedAgents],
  )

  // Single-selection auto-activate: when the user narrows their
  // "Apply Jira & Generate to" pick down to exactly one agent, jump
  // the tab strip to that agent so they don't have to also click the
  // tab. >=2 selected -> keep the current active tab if it's still
  // valid, else fall back to the first ordered tab. =0 selected ->
  // leave the active tab alone (nothing to promote).
  useEffect(() => {
    if (selectedAgents.size === 1) {
      const only = [...selectedAgents][0]
      if (only && only !== activeSlug && accessibleAgents.includes(only)) {
        setActiveSlug(only)
      }
      return
    }
    if (selectedAgents.size > 1 && activeSlug && !accessibleAgents.includes(activeSlug)) {
      setActiveSlug(orderedTabs[0] || null)
    }
  }, [selectedAgents, orderedTabs, activeSlug, accessibleAgents])
  const setAllAgentsSelected = useCallback((all) => {
    setQuickPackTargets(all ? accessibleAgents : [])
  }, [accessibleAgents, setQuickPackTargets])
  const allSelected = selectedAgents.size === accessibleAgents.length && accessibleAgents.length > 0
  const noneSelected = selectedAgents.size === 0

  // Classify every comma-separated token in the input so we can both
  // pin the first detected story key (mirrors the StlcPack page so
  // per-tab Jira pushes default to it) and render a "Detected:" chip
  // summarising what the user typed.
  const classifiedTokens = useMemo(
    () => splitJiraTokens(jiraInput).map(classifyJiraToken),
    [jiraInput],
  )
  const detectedKey = useMemo(() => {
    const firstIssue = classifiedTokens.find(t => t.kind === 'issue')
    return firstIssue ? firstIssue.value : null
  }, [classifiedTokens])
  const tokenSummary = useMemo(() => {
    const counts = { issue: 0, project: 0, unknown: 0 }
    for (const t of classifiedTokens) counts[t.kind] = (counts[t.kind] || 0) + 1
    const parts = []
    if (counts.issue) parts.push(`${counts.issue} issue${counts.issue === 1 ? '' : 's'}`)
    if (counts.project) parts.push(`${counts.project} project key${counts.project === 1 ? '' : 's'}`)
    if (counts.unknown) parts.push(`${counts.unknown} unrecognised`)
    return {
      total: classifiedTokens.length,
      label: parts.join(', ') || '—',
    }
  }, [classifiedTokens])
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
  // SELECTED tab's primary field IF that field is currently empty. We
  // never overwrite manual edits — once a user types into a tab's
  // input, it's theirs. Unselected agents stay blank: the user
  // explicitly opted them out of the import.
  useEffect(() => {
    if (!context) return
    setPerAgentValues(prev => {
      const next = { ...prev }
      for (const slug of accessibleAgents) {
        if (!selectedAgents.has(slug)) continue
        const primaryKey = pickPrimaryFieldKey(slug)
        if (!primaryKey) continue
        const tab = next[slug] || {}
        if (!tab[primaryKey] || tab[primaryKey].trim() === '') {
          next[slug] = { ...tab, [primaryKey]: context }
        }
      }
      return next
    })
  }, [context, accessibleAgents, selectedAgents])

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

  // Counters only consider SELECTED agents — the "Ready" / "Needs
  // input" pills under the Generate button reflect what will actually
  // run, not the full allow-list. Excluded agents are tallied
  // separately so the user has a quick visual on how many they've
  // opted out of.
  const targetedAgents = useMemo(
    () => accessibleAgents.filter(s => selectedAgents.has(s)),
    [accessibleAgents, selectedAgents],
  )
  const readyCount = useMemo(
    () => targetedAgents.filter(s => isReadyToRun(s, perAgentValues[s])).length,
    [targetedAgents, perAgentValues],
  )
  const needsInputCount = targetedAgents.length - readyCount
  const excludedCount = accessibleAgents.length - targetedAgents.length
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
    if (targetedAgents.length === 0) {
      toast.error('No agents selected — pick at least one in the "Apply to" row above.')
      return
    }
    const skip = new Set()
    const trigger = { ...triggerMap }
    let firedCount = 0
    // Iterate ONLY the selected agents; unchecked agents are excluded
    // entirely (they stay 'excluded' in the tab strip and never fire).
    for (const slug of targetedAgents) {
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
      toast.error('No selected agents are ready — fill the required inputs on each tab first.')
    } else {
      const excluded = accessibleAgents.length - targetedAgents.length
      const tail = excluded > 0 ? ` (${excluded} excluded)` : ''
      toast.success(`Generating ${firedCount} of ${targetedAgents.length} selected agents in parallel…${tail}`)
    }
  }

  const handleReset = () => {
    if (isRunning) return
    setPerAgentValues({})
    setStatuses({})
    setBulkSkipped(new Set())
    setTriggerMap({})
    setImportedIssues([])
    setJiraInput('')
    setContext('')
  }

  // Seed the bug_report tab from a single primary Jira payload. Same
  // behaviour as before: title-style one-liner for `bug_description`,
  // best-effort environment match against the agent's select options.
  // Pulled into a helper so the multi-import handler can call it on
  // just the FIRST primary issue without duplicating the body.
  const seedBugReportTab = useCallback((payload, key) => {
    if (!accessibleAgents.includes('bug_report')) return
    if (!selectedAgents.has('bug_report')) return
    const core = payload?.core || payload || {}
    const summary = (core.summary || '').trim()
    const issueEnv = (core.environment || '').trim()
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
  }, [accessibleAgents, selectedAgents, qaMode])

  const handleJiraFetch = async () => {
    if (jiraFetching || !jiraConnected) return
    const tokens = splitJiraTokens(jiraInput)
    if (tokens.length === 0) return
    setJiraFetching(true)
    try {
      const { items = [] } = await importBatch(tokens)
      // Keep entries that produced something usable: a primary payload
      // (issue/epic) or at least one child row (project/epic). Errors
      // and "unknown" tokens are surfaced via toast counters but not
      // rendered as cards.
      const ok = items.filter(i => !i.error && (i.primary || (i.children && i.children.length)))
      const failed = items.length - ok.length
      if (!ok.length) {
        // Surface the actual reason from the backend instead of a generic
        // "no matching tickets" line. Most failures here are 404 ("Issue
        // does not exist"), 403 (permission), or a key that classified as
        // "unknown" — the user can only act on the right one if we tell
        // them which it was.
        const { reason, tokenLabel } = summarizeBatchError(items, tokens)
        toast.error(`Could not fetch ${tokenLabel}: ${reason}`, { duration: 6000 })
        return
      }
      setImportedIssues(ok)
      // Replace the shared Context with the merged seed text so the
      // user clearly sees what was imported and the per-tab primary
      // fields auto-fill via the existing context effect (only blank
      // primary fields get filled — manual edits are preserved).
      setContext(seedTextFromBatch(ok))
      // bug_report stays a single-defect tab on QA Test Artifacts: seed it
      // from the FIRST primary issue we received, ignoring children
      // and additional tickets.
      const firstIssue = ok.find(i => i.primary)
      if (firstIssue) seedBugReportTab(firstIssue.primary, firstIssue.key)
      const headlineKey = firstIssue?.key
      const summary = (firstIssue?.primary?.core?.summary || '').trim()
      const detail = ok.length === 1 && headlineKey
        ? `Imported Jira ${headlineKey}${summary ? ` — ${summary}` : ''}`
        : `Imported ${ok.length} Jira items${failed ? ` (${failed} skipped)` : ''}`
      if (failed > 0) {
        // Mention the first failing key so the user knows which token in
        // their list didn't make it (e.g. a typo or a deleted ticket).
        const firstFailing = items.find(i => i.error)
        const skippedNote = firstFailing
          ? ` Skipped ${firstFailing.key || firstFailing.token}: ${firstFailing.error}`
          : ''
        toast(detail + skippedNote, { icon: '⚠️', duration: 6000 })
      } else {
        toast.success(detail)
      }
    } catch (err) {
      toast.error(err?.response?.data?.detail || err?.message || 'Failed to fetch Jira tickets')
    } finally {
      setJiraFetching(false)
    }
  }

  if (!user) return null

  // The admin-side access slug is still ``quick_pack`` so existing
  // user permissions keep working after the page was renamed from
  // "QA Workbench" / ``/quick-pack`` to "QA Test Artifacts" /
  // ``/qa-test-artifacts``. Don't migrate the slug — only the display
  // label and the URL changed.
  const canAccessQuickPack = userCanAccessPath(user, '/qa-test-artifacts')
  if (!canAccessQuickPack) {
    return (
      <div>
        <PageHeader
          title="QA Test Artifacts"
          subtitle="Run every agent you have access to from one prompt"
          icon="🚀"
          gradient="from-violet-500 to-fuchsia-500"
        />
        <div className="toon-card text-center py-16">
          <div className="text-5xl mb-3">🔒</div>
          <h3 className="text-xl font-extrabold text-toon-navy mb-2">QA Test Artifacts is disabled for your account</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Ask an administrator to enable
            <span className="font-bold text-astound-violet"> QA Test Artifacts</span>
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
          title="QA Test Artifacts"
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
        title="QA Test Artifacts"
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
              Regenerate. Pick which agents the next import and bulk run
              target in <span className="font-bold text-violet-700">Apply Jira &amp; Generate to</span> below;
              unchecked agents are tagged <span className="font-bold text-gray-500">Excluded</span> and
              won&apos;t fire on Generate.
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

        {/* Apply-to picker — pick which agents the next Jira import and
            the next bulk Generate target. Defaults to all accessible.
            Unchecked agents are excluded from auto-fill and bulk run. */}
        <div className="mb-4 bg-gray-50 rounded-2xl p-3 border border-gray-200">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="text-sm font-bold text-toon-navy">Apply Jira & Generate to</div>
              <div className="text-xs text-gray-500">
                {selectedAgents.size === 0
                  ? 'No agents selected — Generate is disabled.'
                  : `${selectedAgents.size}/${accessibleAgents.length} agent${accessibleAgents.length === 1 ? '' : 's'} will receive the next import and run.`}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setAllAgentsSelected(true)}
                disabled={isRunning || allSelected}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  allSelected
                    ? 'border-violet-200 text-violet-300 bg-white cursor-default'
                    : 'border-violet-200 text-violet-700 bg-white hover:bg-violet-50'
                } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setAllAgentsSelected(false)}
                disabled={isRunning || noneSelected}
                className={`px-2.5 py-1 rounded-lg border transition-colors ${
                  noneSelected
                    ? 'border-gray-200 text-gray-300 bg-white cursor-default'
                    : 'border-gray-200 text-gray-600 bg-white hover:bg-gray-100'
                } ${isRunning ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                None
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {accessibleAgents.map(slug => {
              const meta = getAgent(slug)
              const checked = selectedAgents.has(slug)
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggleSelectedAgent(slug)}
                  disabled={isRunning}
                  aria-pressed={checked}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs font-bold transition-all ${
                    checked
                      ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white border-transparent shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-violet-300'
                  } ${isRunning ? 'opacity-60 cursor-not-allowed' : ''}`}
                  title={checked ? 'Click to exclude this agent' : 'Click to include this agent'}
                >
                  <span aria-hidden="true">{meta?.icon || '✨'}</span>
                  <span>{meta?.label || slug}</span>
                  {!checked && (
                    <span className="text-[9px] uppercase tracking-wider text-gray-400">off</span>
                  )}
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
              Jira tickets
              <span className="font-normal text-gray-400 ml-2">
                {jiraConnected
                  ? '(paste keys, URLs, epics, or project keys — separate with commas)'
                  : '(Jira not connected — fill the Context box below directly)'}
              </span>
            </label>
            <div className="flex gap-2">
              <input
                className="toon-input flex-1"
                placeholder={jiraConnected ? 'ABC-123, DEF-456, or ABC for a whole project (comma-separated)' : 'Connect Jira from the Hub to enable auto-fetch'}
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
                {jiraFetching ? '…' : tokenSummary.total > 1 ? `Fetch ${tokenSummary.total}` : 'Fetch'}
              </button>
            </div>
            {tokenSummary.total > 0 && (
              <div className="mt-1.5 text-xs font-bold text-violet-600">
                Detected: {tokenSummary.label}
              </div>
            )}
          </div>
        </div>

        {/* Imported Jira preview — one card per resolved batch item */}
        <BatchPreview
          items={importedIssues}
          onRemoveIndex={(idx) =>
            setImportedIssues(prev => prev.filter((_, i) => i !== idx))
          }
          className="mb-4"
        />

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
            title={
              targetedAgents.length === 0
                ? 'Pick at least one agent in the "Apply Jira & Generate to" row above'
                : readyCount === 0
                  ? 'Fill required inputs on at least one selected tab'
                  : ''
            }
          >
            {isRunning
              ? `⏳ Streaming ${runningCount}/${targetedAgents.length}…`
              : `🚀 Generate ready agents (${readyCount}/${targetedAgents.length})`}
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
            {excludedCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                {excludedCount} excluded
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

      {/* Tab strip — selected tabs (from "Apply Jira & Generate to")
          float to the front in STLC order, then the rest in STLC
          order. The visual "selected" indicator (a violet dot before
          the icon) makes the queue-for-bulk-Generate set scannable at
          a glance, even when the user has reordered or narrowed their
          selection mid-session. */}
      <div className="mb-4 flex flex-wrap gap-2 sticky top-0 z-10 bg-astound-cream/80 backdrop-blur-sm py-2 -mx-2 px-2 rounded-2xl">
        {orderedTabs.map(slug => {
          const meta = getAgent(slug)
          const isExcluded = !selectedAgents.has(slug)
          // Excluded > skipped > stream-status > idle. The 'excluded'
          // state takes priority over the streaming dot too because the
          // user opted this tab out — its previous run state isn't
          // relevant to the next bulk Generate.
          const status = isExcluded
            ? 'excluded'
            : statuses[slug] || (bulkSkipped.has(slug) ? 'needs_input' : 'idle')
          const styles = STATUS_STYLES[status] || STATUS_STYLES.idle
          const isActive = slug === activeSlug
          const ready = isReadyToRun(slug, perAgentValues[slug])
          const isSelected = !isExcluded
          return (
            <button
              key={slug}
              type="button"
              onClick={() => setActiveSlug(slug)}
              className={`group relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                isActive
                  ? 'bg-astound-grad text-white border-transparent shadow-astound'
                  : isExcluded
                    ? 'bg-white text-gray-400 border-gray-200 hover:border-astound-violet/40'
                    : 'bg-white text-toon-navy border-violet-200 hover:border-astound-violet/40 shadow-sm'
              }`}
              title={
                isExcluded
                  ? 'Excluded from the next bulk Generate — toggle it back on in the "Apply Jira & Generate to" row above.'
                  : !ready
                    ? 'Required inputs missing — open this tab to fill them.'
                    : 'Queued for the next bulk Generate.'
              }
            >
              <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
              {/* Selected indicator: tiny filled fuchsia dot that
                  appears only on inactive selected tabs. Active tabs
                  already have the gradient bg, and excluded tabs get
                  the existing greyed-out treatment, so the dot is
                  reserved for the "in the queue but not currently
                  visible" case. */}
              {isSelected && !isActive && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-fuchsia-500"
                  aria-hidden="true"
                  title="Selected for bulk Generate"
                />
              )}
              <span aria-hidden="true">{meta?.icon || '✨'}</span>
              <span>{meta?.label || slug}</span>
              {isExcluded ? (
                <span className={`ml-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/20' : 'bg-gray-100 text-gray-500 border border-gray-200'
                }`}>
                  excluded
                </span>
              ) : !ready ? (
                <span className={`ml-1 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                  isActive ? 'bg-white/20' : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}>
                  needs input
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* All tabs are mounted simultaneously so in-flight streams stay
          alive while the user switches between them. Inactive tabs are
          CSS-hidden — no unmount, no abort. */}
      <div>
        {orderedTabs.map(slug => (
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
