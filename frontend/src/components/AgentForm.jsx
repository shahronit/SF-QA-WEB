import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MarkdownTableCell from './markdown/MarkdownTableCell'
import MarkdownTableScroll from './markdown/MarkdownTableScroll'
import api from '../api/client'
import ReportPanel from './ReportPanel'
import { useAgentResults, AGENT_LABELS } from '../context/AgentResultsContext'
import { useJira } from '../context/JiraContext'
import CustomPromptEditor from './CustomPromptEditor'
import ProjectContextPicker from './ProjectContextPicker'
import Confetti from './motion/Confetti'
import GeneratingScene from './motion/GeneratingScene'
import MagneticButton from './motion/MagneticButton'
import { extractJiraKey, splitJiraTokens, classifyJiraToken } from '../utils/jiraDetect'
import { seedTextFromBatch, summarizeBatchError } from '../utils/jiraSeed'
import BatchPreview from './jira/BatchPreview'
import { useQaMode, QA_MODE_OPTIONS } from '../hooks/useQaMode'
import { useSessionPrefs } from '../context/SessionPrefsContext'
import { getAgentActionLabel, resolvePrimaryField } from '../config/agentMeta'

const LINK_PREVIEW_MD_COMPONENTS = { td: MarkdownTableCell, table: MarkdownTableScroll }

// Format a Jira issue payload as plain text for an LLM seed.
//
// Accepts EITHER:
//   - the legacy "lite" shape from GET /jira/issue/{key} (flat fields like
//     `key`, `summary`, `description`, `status`, `priority`, `subtasks`), OR
//   - the rich shape from GET /jira/issue/{key}/full (a structured envelope
//     with `core`, `comments`, `linked_issues`, `attachments`, `sprint`,
//     `epic`, `subtasks`, `worklogs`, `remote_links`, `participants`,
//     `gdrive_files`, etc.).
//
// We auto-detect the rich shape via `issue.core` / `issue.fetch_metadata` and
// fall back to the lite renderer for back-compat with any legacy caller.
function jiraIssueToText(issue) {
  if (!issue) return ''
  const isRich = !!(issue.core || issue.fetch_metadata)
  if (!isRich) return jiraIssueLiteToText(issue)

  const c = issue.core || {}
  const lines = []
  lines.push(`Jira ${c.issuetype || 'Issue'} ${c.key || ''}: ${c.summary || ''}`.trim())

  // ---- Status / classification block ---------------------------------------
  const statusBits = []
  if (c.status) statusBits.push(`Status: ${c.status}${c.status_category ? ` (${c.status_category})` : ''}`)
  if (c.resolution) statusBits.push(`Resolution: ${c.resolution}`)
  if (c.priority) statusBits.push(`Priority: ${c.priority}`)
  if (statusBits.length) lines.push(statusBits.join(' | '))

  // ---- People --------------------------------------------------------------
  const assigneeName = personName(c.assignee)
  const reporterName = personName(c.reporter)
  const creatorName = personName(c.creator)
  const people = []
  if (assigneeName) people.push(`Assignee: ${assigneeName}`)
  if (reporterName) people.push(`Reporter: ${reporterName}`)
  if (creatorName && creatorName !== reporterName) people.push(`Creator: ${creatorName}`)
  if (people.length) lines.push(people.join(' | '))

  // ---- Project / classification --------------------------------------------
  const projectLabel = c.project?.key
    ? `${c.project.key}${c.project.name ? ` — ${c.project.name}` : ''}`
    : (typeof c.project === 'string' ? c.project : '')
  if (projectLabel) lines.push(`Project: ${projectLabel}`)
  if (c.parent?.key) lines.push(`Parent: ${c.parent.key}${c.parent.summary ? ` — ${c.parent.summary}` : ''}`)

  // ---- Sprint / epic / story points ---------------------------------------
  if (issue.sprint?.name) {
    const sp = issue.sprint
    lines.push(`Sprint: ${sp.name}${sp.state ? ` [${sp.state}]` : ''}`)
  }
  if (issue.epic?.key) {
    lines.push(`Epic: ${issue.epic.key}${issue.epic.summary ? ` — ${issue.epic.summary}` : ''}`)
  }
  if (c.story_points != null) lines.push(`Story Points: ${c.story_points}`)

  // ---- Dates ---------------------------------------------------------------
  const dates = []
  if (c.created) dates.push(`Created: ${c.created}`)
  if (c.updated) dates.push(`Updated: ${c.updated}`)
  if (c.due_date) dates.push(`Due: ${c.due_date}`)
  if (c.resolution_date) dates.push(`Resolved: ${c.resolution_date}`)
  if (dates.length) lines.push(dates.join(' | '))

  // ---- Versions / components / labels --------------------------------------
  if (c.fix_versions?.length) lines.push(`Fix Versions: ${c.fix_versions.join(', ')}`)
  if (c.affects_versions?.length) lines.push(`Affects Versions: ${c.affects_versions.join(', ')}`)
  if (c.components?.length) lines.push(`Components: ${c.components.join(', ')}`)
  if (c.labels?.length) lines.push(`Labels: ${c.labels.join(', ')}`)
  if (c.environment) lines.push(`Environment: ${c.environment}`)

  // ---- Description ---------------------------------------------------------
  lines.push('', 'Description:', (c.description || '(no description)').trim())

  // ---- Sub-tasks -----------------------------------------------------------
  if (issue.subtasks?.length) {
    lines.push('', 'Sub-tasks:')
    for (const s of issue.subtasks) {
      const bits = [s.key, s.status ? `[${s.status}]` : '', s.summary].filter(Boolean)
      lines.push(`- ${bits.join(' ')}`)
    }
  }

  // ---- Linked issues -------------------------------------------------------
  if (issue.linked_issues?.length) {
    lines.push('', 'Linked issues:')
    for (const l of issue.linked_issues) {
      const rel = l.label || l.type || 'related to'
      const tgt = l.key || ''
      lines.push(`- ${rel}: ${tgt}${l.summary ? ` — ${l.summary}` : ''}`)
    }
  }

  // ---- Attachments ---------------------------------------------------------
  if (issue.attachments?.length) {
    lines.push('', `Attachments (${issue.attachments.length}):`)
    for (const a of issue.attachments) {
      const sizeKb = a.size ? ` (${Math.round(a.size / 1024)} KB)` : ''
      lines.push(`- ${a.filename || a.name || 'file'}${sizeKb}${a.url ? ` — ${a.url}` : ''}`)
    }
  }

  // ---- Recent comments (cap at 5 most recent) ------------------------------
  if (issue.comments?.length) {
    const recent = issue.comments.slice(-5)
    lines.push('', `Comments (showing ${recent.length} of ${issue.comments.length}):`)
    for (const cm of recent) {
      const who = personName(cm.author) || 'unknown'
      const when = cm.created || ''
      lines.push(`- ${who}${when ? ` @ ${when}` : ''}:`)
      const body = (cm.body || '').trim()
      if (body) lines.push(body.length > 600 ? `  ${body.slice(0, 600)}…` : `  ${body}`)
    }
  }

  // ---- Custom fields (e.g. Acceptance Criteria, custom Story Points) ------
  if (c.custom_fields && typeof c.custom_fields === 'object') {
    const entries = Object.entries(c.custom_fields)
      .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0))
    if (entries.length) {
      lines.push('', 'Custom fields:')
      for (const [label, val] of entries) {
        lines.push(`- ${label}: ${formatCustomFieldValue(val)}`)
      }
    }
  }

  // ---- Source --------------------------------------------------------------
  const url = c.url || issue.url
  if (url) lines.push('', `Source: ${url}`)
  return lines.filter(l => l !== undefined && l !== null).join('\n')
}

// Pull a human name out of either the rich {display_name,...} person
// object returned by /full or the plain string returned by the legacy
// /issue endpoint.
function personName(p) {
  if (!p) return ''
  if (typeof p === 'string') return p
  if (typeof p === 'object') return p.display_name || p.displayName || p.name || ''
  return ''
}

// Render a custom-field value (which may be a primitive, string, list of
// option objects, single option, or already-flattened ADF text) compactly.
function formatCustomFieldValue(v) {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v)
  }
  if (Array.isArray(v)) {
    return v.map(formatCustomFieldValue).filter(Boolean).join(', ')
  }
  if (typeof v === 'object') {
    if (v.value) return String(v.value)
    if (v.name) return String(v.name)
    if (v.displayName) return String(v.displayName)
    if (v.key) return String(v.key)
    try { return JSON.stringify(v) } catch { return '[object]' }
  }
  return String(v)
}

// Legacy "lite" shape — single-issue payload from GET /jira/issue/{key}.
function jiraIssueLiteToText(issue) {
  if (!issue) return ''
  const lines = [
    `Jira ${issue.issuetype || 'Issue'} ${issue.key}: ${issue.summary || ''}`,
    issue.status ? `Status: ${issue.status}` : '',
    issue.priority ? `Priority: ${issue.priority}` : '',
    issue.assignee ? `Assignee: ${issue.assignee}` : '',
    issue.reporter ? `Reporter: ${issue.reporter}` : '',
    issue.labels?.length ? `Labels: ${issue.labels.join(', ')}` : '',
    issue.components?.length ? `Components: ${issue.components.join(', ')}` : '',
    '',
    'Description:',
    issue.description || '(no description)',
  ]
  if (issue.subtasks?.length) {
    lines.push('', 'Sub-tasks:')
    for (const s of issue.subtasks) {
      lines.push(`- ${s.key} [${s.status}] ${s.summary}`)
    }
  }
  if (issue.url) lines.push('', `Source: ${issue.url}`)
  return lines.filter(Boolean).join('\n')
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  return `${Math.floor(diff / 3600)} hr ago`
}

// Resolve mode-aware field properties. A field can declare `labelByMode`,
// `placeholderByMode`, `optionsByMode` (each a {salesforce, general} dict);
// the resolver falls back to the plain `label` / `placeholder` / `options`
// when no mode-specific override is provided.
function resolveField(field, qaMode) {
  return {
    ...field,
    label: field.labelByMode?.[qaMode] ?? field.label,
    placeholder: field.placeholderByMode?.[qaMode] ?? field.placeholder,
    options: field.optionsByMode?.[qaMode] ?? field.options,
  }
}

const ADV_KEY = (agent) => `qa-studio:adv:${agent}`

// Render a single field cell. Lives at module scope so the JSX is reused
// verbatim by both the primary section and the Advanced (optional) section.
function renderFieldBody(field, ctx) {
  const { shakeStamp, values, handleChange, handleTextareaBlur, autoFetchedNotice } = ctx
  const isRequired = field.required !== false && field.type !== 'select'
  return (
    <motion.div
      key={shakeStamp || 'idle'}
      animate={shakeStamp ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.45 }}
    >
      <label className="block text-sm font-bold text-toon-navy mb-1.5">
        {field.label}
        {isRequired && (
          <motion.span
            className="text-toon-coral ml-1"
            animate={shakeStamp ? { scale: [1, 1.4, 1] } : { scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            *
          </motion.span>
        )}
        {field.hint && (
          <span className="font-normal text-gray-400 ml-2">{field.hint}</span>
        )}
      </label>
      {field.type === 'textarea' ? (
        <>
          <textarea
            className={`toon-textarea ${shakeStamp ? 'ring-2 ring-toon-coral/40' : ''}`}
            rows={field.rows || 4}
            placeholder={field.placeholder || ''}
            value={values[field.key] || ''}
            onChange={(e) => handleChange(field.key, e.target.value)}
            onBlur={(e) => handleTextareaBlur(field.key, e.target.value)}
          />
          <AnimatePresence>
            {autoFetchedNotice[field.key] && (
              <motion.div
                key={autoFetchedNotice[field.key].stamp}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-bold text-toon-mint bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full"
              >
                <span>✨</span>
                Auto-imported Jira {autoFetchedNotice[field.key].key}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      ) : field.type === 'select' ? (
        <select
          className="toon-input"
          value={values[field.key] || (typeof field.options?.[0] === 'string' ? field.options[0] : field.options?.[0]?.value) || ''}
          onChange={(e) => handleChange(field.key, e.target.value)}
        >
          {field.options?.map(o => {
            const val = typeof o === 'string' ? o : o.value
            const lbl = typeof o === 'string' ? o : o.label
            return <option key={val} value={val}>{lbl}</option>
          })}
        </select>
      ) : (
        <input
          type={field.type || 'text'}
          className={`toon-input ${shakeStamp ? 'ring-2 ring-toon-coral/40' : ''}`}
          placeholder={field.placeholder || ''}
          value={values[field.key] || ''}
          onChange={(e) => handleChange(field.key, e.target.value)}
        />
      )}
    </motion.div>
  )
}

export default function AgentForm({ agentName, fields, sheetTitle, extraInput = {} }) {
  const [values, setValues] = useState({})
  const [result, setResult] = useState('')
  const [resultStamp, setResultStamp] = useState(0)
  const [loading, setLoading] = useState(false)
  // Per-run metadata surfaced in ReportPanel: which provider+model the
  // backend resolved for this call, whether the response came from the
  // cache, and the canonical token-usage envelope. Reset on every new
  // generation so the previous run's chip doesn't briefly reappear
  // while the next run is still streaming its first token.
  const [runMeta, setRunMeta] = useState(null)
  // Mirror runMeta into a ref so the streaming `finally` block can hand
  // the latest provider/model/usage payload to saveResult(). The plain
  // `runMeta` closure is captured when handleRunRun starts (where it's
  // null after the reset on line ~553), which previously caused
  // AgentResultsContext to be fed `meta: null` and made the token chip
  // disappear on every navigation away and back.
  const runMetaRef = useRef(null)
  useEffect(() => { runMetaRef.current = runMeta }, [runMeta])
  const [projects, setProjects] = useState([])
  // Pinned context — RAG project, Jira project, sprint, user-story key.
  // Lives in SessionPrefsContext so selections persist across pages,
  // reset clicks, and reloads ("until the user manually removes it").
  const {
    qaProjectSlug,
    setQaProjectSlug,
    jiraProjectKey: pinnedJiraProjectKey,
    setJiraProjectKey: setPinnedJiraProjectKey,
    sprintId: pinnedSprintId,
    sprintName: pinnedSprintName,
    userStoryKey: pinnedUserStoryKey,
    setUserStoryKey: setPinnedUserStoryKey,
    clearPin,
  } = useSessionPrefs()
  const selectedProject = qaProjectSlug
  const setSelectedProject = setQaProjectSlug
  const [linkedAgent, setLinkedAgent] = useState('')
  const [showLinkedPreview, setShowLinkedPreview] = useState(false)
  // Per-session, per-device override for the system prompt. Only the Test
  // Case Development agent currently surfaces a UI to set this; the
  // override is stored in localStorage by CustomPromptEditor and shipped
  // on every request while the toggle is ON.
  const [systemPromptOverride, setSystemPromptOverride] = useState(null)
  // Past-session results pulled from /history when no in-session results exist.
  // Each entry mirrors the in-session shape ({name, label, content, timestamp}).
  const [historicalRuns, setHistoricalRuns] = useState([])
  const [shakeKeys, setShakeKeys] = useState({})
  const [confettiTrigger, setConfettiTrigger] = useState(0)
  // jiraContextKey is the parent user story used by Jira-push surfaces
  // (test management, comment push, bug push). It's the same value as
  // the persistent userStoryKey pin so picking a story on one page
  // auto-fills it on every other Jira surface.
  const jiraContextKey = pinnedUserStoryKey
  const setJiraContextKey = setPinnedUserStoryKey
  // Resolved /api/jira/import-batch entries from the most recent fetch. Each
  // entry has shape `{ token, kind, key?, primary?, children?, error? }` —
  // identical to QuickPack's flow so the same `<BatchPreview />` component
  // renders cards here. Single-token paste produces a one-element array;
  // multi-token paste shows one card per resolved item.
  const [importedIssues, setImportedIssues] = useState([])
  const [qaMode, setQaMode] = useQaMode()

  const { saveResult, getAvailableResults } = useAgentResults()
  const availableResults = getAvailableResults(agentName)
  const {
    connected: jiraConnected,
    resolveFromText,
    getFullIssue: jiraGetFullIssue,
    importBatch: jiraImportBatch,
  } = useJira()

  // Multi-select + sprint-scope CTAs are enabled on the artifact-generation
  // agents that benefit from multi-ticket scope. Single-select agents
  // (Bug Reports, RCA, Exec Report, Closure Report, Copado Script) are
  // conceptually about a single ticket so they stay focused on one.
  // Per-field set of Jira keys we have already auto-imported, so on-blur
  // doesn't re-fetch the same ticket every time the user clicks elsewhere.
  const importedKeysRef = useRef({})
  const [autoFetchedNotice, setAutoFetchedNotice] = useState({})

  // Inline "Jira tickets" input that lives in the primary card. Accepts
  // comma- or newline-separated tokens (issue keys, browse URLs, epic
  // keys, project keys) — same syntax QuickPack uses — so the user can
  // import several tickets into the agent's Context in one round-trip.
  // Empty unless the user is actively typing — we deliberately do NOT
  // mirror imported keys here so the input doesn't become a stale parrot
  // of the chip / cards already shown above.
  const [jiraInput, setJiraInput] = useState('')
  const [jiraFetching, setJiraFetching] = useState(false)
  const [jiraQuickStatus, setJiraQuickStatus] = useState({ kind: 'idle', message: '' })

  // Live classification of the comma-separated input — drives the
  // "Detected: N issues, M projects" chip below the row and the
  // "Fetch N" button label that mirrors QuickPack.
  const classifiedTokens = useMemo(
    () => splitJiraTokens(jiraInput).map(classifyJiraToken),
    [jiraInput],
  )
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

  // Refs for the Advanced disclosure body so we can scroll to + focus
  // the first missing required field when the user clicks Generate
  // with the disclosure collapsed.
  const advancedDetailsRef = useRef(null)
  const fieldRefs = useRef({})

  const fetchProjects = useCallback(() => {
    api.get('/projects/').then(({ data }) => {
      setProjects(data.projects || [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetchProjects()
    const onFocus = () => fetchProjects()
    const onProjectsUpdated = () => fetchProjects()
    window.addEventListener('focus', onFocus)
    window.addEventListener('qa:projects-updated', onProjectsUpdated)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('qa:projects-updated', onProjectsUpdated)
    }
  }, [fetchProjects])

  // Fall back to /history when no in-session results exist so the Link
  // Previous Agent Output dropdown still has something to chain. We
  // skip the requirements agent entirely (the card is hidden there).
  //
  // We pull a generous window (most recent 100 runs) and filter on the
  // client because the previous fixed limit of 10 silently broke the
  // dropdown whenever a user's last 10 runs happened to all be of the
  // current agent (very common on the Test Cases page where the same
  // user iterates many times). After filtering out the current agent
  // we de-duplicate by agent — keeping only the newest run of each
  // distinct agent — so the dropdown stays short and meaningful.
  useEffect(() => {
    if (agentName === 'requirement') return
    if (availableResults.length > 0) return
    let cancelled = false
    api.get('/history/', { params: { limit: 100 } })
      .then(({ data }) => {
        if (cancelled) return
        const records = data?.records || []
        const seen = new Set()
        const mapped = []
        records.forEach((rec, idx) => {
          if (!rec || !rec.agent || rec.agent === agentName) return
          if (seen.has(rec.agent)) return
          const content = rec.output || rec.output_preview || ''
          if (!content) return
          seen.add(rec.agent)
          mapped.push({
            name: `history:${idx}`,
            label: AGENT_LABELS[rec.agent] || rec.agent,
            content,
            timestamp: rec.ts ? Date.parse(rec.ts) || Date.now() : Date.now(),
            source: 'history',
          })
        })
        // Cap the dropdown so it stays readable even if a user has
        // touched every agent we know about.
        setHistoricalRuns(mapped.slice(0, 15))
      })
      .catch(() => { if (!cancelled) setHistoricalRuns([]) })
    return () => { cancelled = true }
  }, [agentName, availableResults.length])

  const handleChange = (key, val) => setValues(prev => ({ ...prev, [key]: val }))

  // Resolve per-mode field properties and drop fields that are mode-gated out.
  const resolvedFields = fields
    .filter(f => f.type !== 'hidden')
    .filter(f => f.hideInMode !== qaMode)
    .map(f => resolveField(f, qaMode))

  // The unified UI elevates ONE field per agent as the primary "Context"
  // input (resolved via agentMeta.primaryFieldKey, falling back to the
  // legacy heuristic). Every other declared field — required or not —
  // moves into the Advanced details disclosure below. This is what
  // makes every agent share the same "Jira + freetext" surface.
  const primaryField = resolvePrimaryField(agentName, resolvedFields)
  const advancedFields = resolvedFields.filter(f => !primaryField || f.key !== primaryField.key)

  // Required fields can now live in either place. We track them
  // separately so the "N required" badge on the Advanced disclosure
  // and the "missing required" UX know exactly what's still empty.
  const isRequiredField = (f) => f.required !== false && f.type !== 'select'
  const requiredAdvancedFields = advancedFields.filter(isRequiredField)
  const primaryIsRequired = primaryField ? isRequiredField(primaryField) : false

  const missingPrimary = !!(primaryField && primaryIsRequired && !values[primaryField.key]?.trim?.())
  const missingAdvanced = requiredAdvancedFields.filter(f => !values[f.key]?.trim?.())
  const allRequiredFilled = !missingPrimary && missingAdvanced.length === 0

  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try { return localStorage.getItem(ADV_KEY(agentName)) === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(ADV_KEY(agentName), advancedOpen ? '1' : '0') } catch { /* ignore */ }
  }, [advancedOpen, agentName])

  const canGenerate = allRequiredFilled && !loading

  const selectedLinked =
    availableResults.find(r => r.name === linkedAgent) ||
    historicalRuns.find(r => r.name === linkedAgent)

  const handleRun = async (options = {}) => {
    // ``forceFresh`` is plumbed through from the "Regenerate (skip cache)"
    // affordance below the ReportPanel. When true the backend skips the
    // cache LOOKUP but still writes the freshly-generated output, so the
    // next normal run for everyone serves the refreshed bytes. The
    // option is opt-in so the default Generate path keeps benefiting
    // from cache replay (the headline determinism guarantee).
    const forceFresh = !!options.forceFresh
    if (loading) return
    if (!allRequiredFilled) {
      const missing = {}
      if (missingPrimary && primaryField) missing[primaryField.key] = Date.now()
      missingAdvanced.forEach(f => { missing[f.key] = Date.now() })
      setShakeKeys(missing)
      // If any of the missing required fields lives in the Advanced
      // disclosure, open it, scroll it into view, and focus the first
      // missing input so the user immediately sees what's blocking
      // Generate. Without this the badge alone is easy to miss.
      if (missingAdvanced.length > 0) {
        setAdvancedOpen(true)
        const target = missingAdvanced[0]
        setTimeout(() => {
          const node = fieldRefs.current[target.key]
          if (node && typeof node.scrollIntoView === 'function') {
            node.scrollIntoView({ behavior: 'smooth', block: 'center' })
            const focusable = node.querySelector('textarea, input, select')
            if (focusable) {
              try { focusable.focus({ preventScroll: true }) } catch { focusable.focus() }
            }
          }
        }, 80)
      }
      return
    }
    setLoading(true)
    setResult('')
    setRunMeta(null)
    runMetaRef.current = null
    setResultStamp(Date.now())

    const mergedInput = { ...values, ...extraInput }
    if (selectedLinked) mergedInput.linked_output = selectedLinked.content

    let accumulated = ''
    let errored = false

    try {
      const token = localStorage.getItem('token')
      const resp = await fetch(`/api/agents/${agentName}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_input: { ...mergedInput, qa_mode: qaMode },
          project_slug: selectedProject || null,
          ...(systemPromptOverride ? { system_prompt_override: systemPromptOverride } : {}),
          ...(forceFresh ? { force_fresh: true } : {}),
        }),
      })
      if (!resp.ok) {
        const detail = await resp.text().catch(() => '')
        throw new Error(`${resp.status} ${resp.statusText}${detail ? ` — ${detail}` : ''}`)
      }
      if (!resp.body) throw new Error('No response body for stream')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        // Normalise CRLF so we can split on '\n\n' regardless of server line-ending style.
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        // SSE frames are separated by a blank line. Parse complete frames.
        let idx
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          let event = 'message'
          const dataLines = []
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
          }
          if (!dataLines.length) continue
          let payload = null
          try { payload = JSON.parse(dataLines.join('\n')) } catch { payload = null }
          if (!payload) continue
          if (event === 'token' && typeof payload.text === 'string') {
            accumulated += payload.text
            setResult(accumulated)
          } else if (event === 'usage') {
            // Backend emits this once per stream after all tokens have
            // been sent. Captures provider/model/cached/repaired + the
            // token envelope. We update local state so ReportPanel
            // renders the chips immediately, AND remember it for
            // AgentResultsContext so other pages can show the same
            // badges (history, hub, etc.). Mirror into the ref in the
            // same tick so the `finally` block sees the latest value
            // (state updates are async; the ref is sync).
            const nextMeta = {
              provider: payload.provider || null,
              model: payload.model || null,
              cached: !!payload.cached,
              repaired: !!payload.repaired,
              usage: payload.usage || null,
            }
            setRunMeta(nextMeta)
            runMetaRef.current = nextMeta
          } else if (event === 'error') {
            errored = true
            const msg = payload.error || 'Unknown error'
            accumulated += `\n\n**Error:** ${msg}`
            setResult(accumulated)
          } else if (event === 'done') {
            // loop will end when reader completes
          }
        }
      }
    } catch (err) {
      errored = true
      accumulated = accumulated
        ? `${accumulated}\n\n**Error:** ${err.message}`
        : `**Error:** ${err.message}`
      setResult(accumulated)
    } finally {
      setLoading(false)
      // Note: do NOT bump resultStamp here. Keeping the key stable across
      // streaming -> done prevents Framer Motion from unmounting and
      // re-mounting the ReportPanel when the run completes (the visible
      // "blink"). The stamp set at run start is enough for the entrance.
      if (accumulated && !errored && !accumulated.startsWith('**Error')) {
        // Pass the latest run meta into the cross-page results store
        // so chained agents downstream (and the History card) can
        // surface the same provider/model/usage badges they see here.
        // Read from the ref (not the closure-captured `runMeta`)
        // because state updates inside the SSE loop never propagate
        // into this `finally` block's scope.
        saveResult(agentName, accumulated, runMetaRef.current)
        setConfettiTrigger(t => t + 1)
      }
      // Notify History + any other listeners to refresh without manual reload.
      window.dispatchEvent(new CustomEvent('qa:agent-run-complete', {
        detail: { agent: agentName, ok: !errored, chars: accumulated.length },
      }))
    }
  }

  const handleReset = useCallback(() => {
    setValues({})
    setResult('')
    setRunMeta(null)
    runMetaRef.current = null
    setLinkedAgent('')
    setShowLinkedPreview(false)
    setShakeKeys({})
    setImportedIssues([])
    setJiraInput('')
    setJiraFetching(false)
    setJiraQuickStatus({ kind: 'idle', message: '' })
    // Clear the user-story pin so the next agent run starts fresh.
    // RAG project, Jira project, and sprint are kept pinned — they
    // survive Reset and are only removed via the chip-row ×.
    clearPin('userStoryKey')
  }, [clearPin])

  const handleTextareaBlur = useCallback(async (fieldKey, currentValue) => {
    if (!jiraConnected || !currentValue) return
    const key = extractJiraKey(currentValue)
    if (!key) return
    const seen = importedKeysRef.current[fieldKey] || new Set()
    if (seen.has(key)) return
    try {
      // Resolve the textual reference to a real issue key first (catches
      // both raw keys and full Jira URLs), then upgrade to the rich /full
      // payload so the auto-imported seed includes comments, sub-tasks,
      // links, attachments, sprint/epic, and any custom fields.
      const resp = await resolveFromText(currentValue)
      if (!resp?.key) return
      let payload = null
      try {
        payload = await jiraGetFullIssue(resp.key)
      } catch {
        payload = resp.issue || null  // graceful degradation to lite shape
      }
      if (!payload) return
      const text = jiraIssueToText(payload)
      seen.add(resp.key)
      importedKeysRef.current = { ...importedKeysRef.current, [fieldKey]: seen }
      setValues(prev => {
        const existing = prev[fieldKey]?.trim?.() || ''
        const marker = `--- Imported from Jira ${resp.key} ---`
        if (existing.includes(marker)) return prev
        const next = existing ? `${existing}\n\n${marker}\n${text}` : `${marker}\n${text}`
        return { ...prev, [fieldKey]: next }
      })
      setJiraContextKey(resp.key)
      const projKey = resp.key.split('-')[0] || ''
      if (projKey) setPinnedJiraProjectKey(projKey)
      setAutoFetchedNotice(prev => ({ ...prev, [fieldKey]: { key: resp.key, stamp: Date.now() } }))
      setTimeout(() => {
        setAutoFetchedNotice(prev => {
          const cur = prev[fieldKey]
          if (cur && cur.key === resp.key) {
            const next = { ...prev }
            delete next[fieldKey]
            return next
          }
          return prev
        })
      }, 3500)
    } catch {
      // best-effort — ignore network failures
    }
  }, [jiraConnected, resolveFromText, jiraGetFullIssue])

  // Compose the per-agent post-processor that the multi-token fetch shares
  // with any caller that needs to seed the form from a single resolved
  // /full payload. Walks `resolvedFields`, fills the title-style field if
  // empty (e.g. bug_report.bug_title), appends seed text into the primary
  // textarea (replaces today's `handleJiraImport` body), and appends a
  // one-line note per imported key into any additional_context field.
  //
  // Marker pattern matches today's on-blur auto-import so a key that's
  // already been imported via blur won't be duplicated by an explicit
  // Fetch round-trip.
  const writeBatchIntoForm = useCallback((items, seedText) => {
    if (!items?.length || !seedText) return
    const firstPrimary = items.find(i => i.primary)?.primary
    const firstCore = firstPrimary?.core || firstPrimary || {}
    const firstKey = firstCore.key || items.find(i => i.key)?.key || ''
    const firstSummary = firstCore.summary || ''

    setValues(prev => {
      const next = { ...prev }
      const textareaFields = resolvedFields.filter(f => f.type === 'textarea')
      const textFields = resolvedFields.filter(f => f.type !== 'textarea' && f.type !== 'select')

      // Title-style field (bug_report.bug_title etc.) — only set when blank.
      const titleField = textFields.find(f => /title|summary|name/i.test(f.key))
      if (titleField && !next[titleField.key]?.trim?.() && firstSummary) {
        next[titleField.key] = `${firstKey ? firstKey + ': ' : ''}${firstSummary}`.trim()
      }

      // Primary textarea — prefer the agent-declared primary, fall back to
      // the legacy heuristic and the first textarea, mirroring resolvePrimaryField.
      const primaryArea =
        primaryField && primaryField.type === 'textarea'
          ? primaryField
          : textareaFields.find(f =>
              /requirement|story|description|scope|test_cases|test_cases_or_scope/i.test(f.key),
            ) || textareaFields[0]
      if (primaryArea) {
        const existing = next[primaryArea.key]?.trim?.() || ''
        const marker = items.length === 1 && firstKey
          ? `--- Imported from Jira ${firstKey} ---`
          : `--- Imported from Jira (${items.length} item${items.length === 1 ? '' : 's'}) ---`
        if (!existing.includes(marker)) {
          const block = `${marker}\n${seedText}`
          next[primaryArea.key] = existing ? `${existing}\n\n${block}` : block
        }
      }

      // Additional context field (one note line per imported key).
      const ctxArea = textareaFields.find(f => /additional_context|context/i.test(f.key))
      if (ctxArea && primaryArea && ctxArea.key !== primaryArea.key) {
        const ex = next[ctxArea.key]?.trim?.() || ''
        const noteLines = items.map(i => {
          const k = i.primary?.core?.key || i.key || i.token
          const u = i.primary?.core?.url || i.primary?.url || ''
          return `Imported from Jira ${k}${u ? ` (${u})` : ''}`
        })
        const note = noteLines.join('\n')
        if (!ex.endsWith(note)) {
          next[ctxArea.key] = ex ? `${ex}\n${note}` : note
        }
      }
      return next
    })

    // Pin the first imported key as the user-story / project so every
    // downstream Jira-push surface inherits the same parent ticket.
    if (firstKey) {
      setJiraContextKey(firstKey)
      const projKey = firstKey.split('-')[0] || ''
      if (projKey) setPinnedJiraProjectKey(projKey)
    }
  }, [resolvedFields, primaryField, setJiraContextKey, setPinnedJiraProjectKey])

  // Multi-token Jira fetch — same pipeline QuickPack uses. Accepts comma-
  // / newline-separated issue keys, browse URLs, epic keys, and project
  // keys; routes them through /api/jira/import-batch in one round-trip;
  // surfaces per-token errors when nothing came back; appends consolidated
  // seed text into the agent's primary textarea via writeBatchIntoForm.
  const handleJiraFetch = useCallback(async () => {
    if (jiraFetching) return
    if (!jiraConnected) {
      setJiraQuickStatus({
        kind: 'error',
        message: 'Jira is not connected — paste the details into the Context box below instead.',
      })
      return
    }
    const tokens = splitJiraTokens(jiraInput)
    if (tokens.length === 0) return
    setJiraFetching(true)
    setJiraQuickStatus({
      kind: 'loading',
      message: tokens.length > 1
        ? `Fetching ${tokens.length} Jira items…`
        : 'Fetching Jira ticket…',
    })
    try {
      const { items = [] } = await jiraImportBatch(tokens)
      const ok = items.filter(i => !i.error && (i.primary || (i.children && i.children.length)))
      if (!ok.length) {
        const { reason, tokenLabel } = summarizeBatchError(items, tokens)
        setJiraQuickStatus({
          kind: 'error',
          message: `Could not fetch ${tokenLabel}: ${reason}`,
        })
        return
      }
      setImportedIssues(ok)
      writeBatchIntoForm(ok, seedTextFromBatch(ok))
      setJiraInput('')
      const failed = items.length - ok.length
      const headline = ok.length === 1
        ? `Imported ${ok[0].primary?.core?.key || ok[0].key || ok[0].token}`
        : `Imported ${ok.length} Jira items`
      setJiraQuickStatus({
        kind: failed > 0 ? 'warn' : 'success',
        message: failed > 0 ? `${headline} (${failed} skipped)` : headline,
      })
      setTimeout(() => {
        setJiraQuickStatus(prev =>
          prev.kind === 'success' || prev.kind === 'warn'
            ? { kind: 'idle', message: '' }
            : prev,
        )
      }, 3500)
    } catch (err) {
      setJiraQuickStatus({
        kind: 'error',
        message: err?.response?.data?.detail || err?.message || 'Failed to fetch Jira tickets.',
      })
    } finally {
      setJiraFetching(false)
    }
  }, [jiraInput, jiraFetching, jiraConnected, jiraImportBatch, writeBatchIntoForm])

  const activeProject = projects.find(p => p.slug === selectedProject)

  // ---- Pinned-context chip row -------------------------------------------
  // Shows the four cross-page pins (RAG project, Jira project, sprint,
  // user story) the user has selected. The × on each chip is the only
  // path that removes that single pin — Reset never touches them. This
  // is what makes "selections persist until manually removed" tangible
  // for the user (otherwise pins are invisible state).
  const pinnedChips = []
  if (selectedProject) {
    pinnedChips.push({
      id: 'qaProjectSlug',
      icon: '📂',
      label: activeProject?.name || selectedProject,
      title: 'RAG project',
      onRemove: () => clearPin('qaProjectSlug'),
    })
  }
  if (pinnedJiraProjectKey) {
    pinnedChips.push({
      id: 'jiraProjectKey',
      icon: '🎯',
      label: pinnedJiraProjectKey,
      title: 'Jira project',
      onRemove: () => clearPin('jiraProjectKey'),
    })
  }
  if (pinnedSprintId) {
    pinnedChips.push({
      id: 'sprint',
      icon: '🏁',
      label: pinnedSprintName || `Sprint ${pinnedSprintId}`,
      title: 'Sprint',
      onRemove: () => clearPin('sprint'),
    })
  }
  if (jiraContextKey) {
    pinnedChips.push({
      id: 'userStoryKey',
      icon: '📌',
      label: jiraContextKey,
      title: 'User story',
      onRemove: () => clearPin('userStoryKey'),
    })
  }

  return (
    <div className="space-y-6">
      {pinnedChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-2xl bg-violet-50 border border-violet-100">
          <span className="text-[11px] font-bold uppercase tracking-wider text-violet-600">
            Pinned context
          </span>
          {pinnedChips.map(chip => (
            <span
              key={chip.id}
              title={chip.title}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-violet-200 text-xs font-bold text-toon-navy shadow-sm"
            >
              <span aria-hidden="true">{chip.icon}</span>
              <span className="max-w-[180px] truncate">{chip.label}</span>
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`Remove pin: ${chip.title}`}
                className="ml-0.5 text-gray-400 hover:text-toon-coral text-sm leading-none"
              >
                ×
              </button>
            </span>
          ))}
          <span className="ml-auto text-[10px] text-violet-500 font-semibold">
            Survives Reset — remove individually
          </span>
        </div>
      )}

      {/* QA Mode toggle */}
      <div className="toon-card !p-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-toon-purple to-violet-500 flex items-center justify-center text-white text-sm shadow-toon">
              🎚️
            </span>
            <div>
              <div className="text-sm font-bold text-toon-navy">QA Mode</div>
              <div className="text-xs text-gray-500">
                {qaMode === 'salesforce'
                  ? 'Outputs use Salesforce conventions (Apex, SOQL, profiles, governor limits, …).'
                  : 'Outputs are product-agnostic (entities, roles, REST/GraphQL, no Salesforce terms).'}
              </div>
            </div>
          </div>
          <div className="sm:ml-auto inline-flex bg-gray-100 rounded-2xl p-1 self-start sm:self-center">
            {QA_MODE_OPTIONS.map(opt => {
              const active = qaMode === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setQaMode(opt.id)}
                  aria-pressed={active}
                  className={`relative px-4 py-1.5 rounded-xl text-sm font-bold transition-colors ${
                    active ? 'text-white' : 'text-gray-600 hover:text-toon-navy'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId={`qa-mode-${agentName}`}
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
      </div>

      {/* Project Context (RAG) + Link Previous Agent Output sit side by
          side so users see at a glance that they can combine RAG project
          docs, a linked prior agent output, and Jira import below. The
          Requirements agent has no upstream to chain from, so its
          Project Context card spans the full width instead. */}
      <div className={agentName === 'requirement' ? '' : 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch'}>
        {/* Project selector */}
        <div className="toon-card !p-4 h-full">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-toon-blue flex items-center justify-center text-white text-sm shadow-toon flex-shrink-0">
              📂
            </span>
            <div className="flex-1 min-w-0">
              <label className="block text-sm font-bold text-toon-navy mb-1.5">
                Project Context
                <span className="font-normal text-gray-400 ml-2">(optional — RAG over project docs)</span>
              </label>
              <ProjectContextPicker
                projects={projects}
                value={selectedProject}
                onChange={setSelectedProject}
                onProjectsChanged={fetchProjects}
                variant="full"
                disabled={loading}
              />
            </div>
          </div>
          {activeProject && (
            <div className="mt-2 ml-12 flex items-center gap-2 text-xs text-toon-mint font-bold">
              <span>✅</span>
              Using project: {activeProject.name}
              {activeProject.description && (
                <span className="text-gray-400 font-normal">— {activeProject.description}</span>
              )}
            </div>
          )}
        </div>

        {/* Linked output selector — always rendered so users discover the
            chaining feature even before any prior runs exist. Hidden on
            the Requirements agent (it has no upstream agent to chain from). */}
        {agentName !== 'requirement' && (
          <div className="toon-card !p-4 h-full">
            <div className="flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm shadow-toon">
                🔗
              </span>
              <div className="flex-1">
                <label className="block text-sm font-bold text-toon-navy mb-1.5">
                  Link Previous Agent Output
                  <span className="font-normal text-gray-400 ml-2">(optional — chain prior agent results)</span>
                </label>
                <select
                  className="toon-input !py-2"
                  value={linkedAgent}
                  onChange={e => { setLinkedAgent(e.target.value); setShowLinkedPreview(false) }}
                  disabled={availableResults.length === 0 && historicalRuns.length === 0}
                >
                  {availableResults.length === 0 && historicalRuns.length === 0 ? (
                    <option value="">— No previous agent runs available —</option>
                  ) : (
                    <>
                      <option value="">— No linked output —</option>
                      {availableResults.length > 0 && (
                        <optgroup label="This session">
                          {availableResults.map(r => (
                            <option key={r.name} value={r.name}>
                              {r.label} ({timeAgo(r.timestamp)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {historicalRuns.length > 0 && (
                        <optgroup label="From past sessions">
                          {historicalRuns.map(r => (
                            <option key={r.name} value={r.name}>
                              {r.label} ({timeAgo(r.timestamp)})
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  )}
                </select>
                {availableResults.length === 0 && historicalRuns.length === 0 && (
                  <p className="text-xs text-gray-500 mt-1.5">
                    No prior runs available — generate one to chain its output here.
                  </p>
                )}
              </div>
            </div>

            {selectedLinked && (
              <div className="mt-3 ml-12">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-toon-mint font-bold flex items-center gap-1">
                    <span>✅</span> Linked: {selectedLinked.label}
                  </span>
                  <button
                    onClick={() => setShowLinkedPreview(p => !p)}
                    className="text-xs text-toon-blue hover:underline font-semibold"
                  >
                    {showLinkedPreview ? 'Hide preview' : 'Show preview'}
                  </button>
                  <button
                    onClick={() => { setLinkedAgent(''); setShowLinkedPreview(false) }}
                    className="text-xs text-toon-coral hover:underline font-semibold"
                  >
                    Clear
                  </button>
                </div>
                <AnimatePresence>
                  {showLinkedPreview && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 p-3 bg-gray-50 rounded-xl text-xs max-h-60 overflow-y-auto overflow-x-clip border border-gray-200 markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={LINK_PREVIEW_MD_COMPONENTS}>
                          {selectedLinked.content.length > 2000
                            ? `${selectedLinked.content.slice(0, 2000)}\n\n_… (truncated)_`
                            : selectedLinked.content}
                        </ReactMarkdown>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Jira issue picker removed by request — every agent now uses the
          unified multi-token "Jira tickets" quick-fetch input rendered
          inside the primary card below. */}

      {/* Test Case Development users can override the system prompt for
          their session. Persisted to localStorage; the default prompt on
          disk is never modified. Other agents stay untouched. */}
      {agentName === 'testcase' && (
        <CustomPromptEditor
          agentName={agentName}
          onChange={setSystemPromptOverride}
        />
      )}

      {/* ---- Unified PRIMARY card ----------------------------------------
           This is the redesigned "Jira tickets + one Context box" surface
           shared by every agent. It contains:
             1. A multi-token "Jira tickets" input (Enter or button to
                fetch). Mirrors QuickPack's syntax — comma-separated
                issue keys, browse URLs, epic keys, or project keys. The
                "Detected: ..." chip below the row classifies what the
                user typed in real time.
             2. The imported batch preview (`<BatchPreview />`) — one
                card per resolved item — so the user keeps the rich
                confirmation right next to the Context box.
             3. The single primary `Context` textarea bound to the field
                resolved by `resolvePrimaryField()` — required-by-default
                for most agents, prominently rendered.
           Every other declared field — required or optional — moves into
           the Advanced details disclosure below the Generate button.
      ----------------------------------------------------------------- */}
      <div className="toon-card !p-4 space-y-4">
        {/* Jira multi-token fetch row */}
        <div>
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-sm shadow-toon flex-shrink-0">
              🎯
            </span>
            <div className="flex-1 min-w-0">
              <label className="block text-sm font-bold text-toon-navy mb-1.5">
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
                  onChange={(e) => {
                    setJiraInput(e.target.value)
                    if (jiraQuickStatus.kind !== 'idle' && jiraQuickStatus.kind !== 'loading') {
                      setJiraQuickStatus({ kind: 'idle', message: '' })
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleJiraFetch()
                    }
                  }}
                  disabled={!jiraConnected || jiraFetching}
                />
                <button
                  type="button"
                  onClick={handleJiraFetch}
                  disabled={!jiraConnected || !jiraInput.trim() || jiraFetching}
                  className={`toon-btn toon-btn-blue px-4 text-sm whitespace-nowrap ${
                    !jiraConnected || !jiraInput.trim() ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {jiraFetching
                    ? '⏳ Fetching…'
                    : tokenSummary.total > 1
                      ? `🔍 Fetch ${tokenSummary.total}`
                      : '🔍 Fetch'}
                </button>
              </div>
              {tokenSummary.total > 0 && (
                <div className="mt-1.5 text-xs font-bold text-violet-600">
                  Detected: {tokenSummary.label}
                </div>
              )}
              {jiraQuickStatus.kind !== 'idle' && (
                <div
                  className={`mt-1.5 text-xs font-bold ${
                    jiraQuickStatus.kind === 'error'
                      ? 'text-toon-coral'
                      : jiraQuickStatus.kind === 'success'
                      ? 'text-toon-mint'
                      : jiraQuickStatus.kind === 'warn'
                      ? 'text-amber-600'
                      : 'text-gray-500'
                  }`}
                >
                  {jiraQuickStatus.message}
                </div>
              )}
            </div>
          </div>

          {/* Imported ticket cards — one per resolved batch item. The
              user can remove individual entries (slices the array) or
              "Clear all" via the BatchPreview header. Removing a card
              does NOT touch textarea contents — same behaviour the
              picker had before. */}
          {importedIssues.length > 0 && (
            <div className="mt-3 ml-12">
              <BatchPreview
                items={importedIssues}
                onRemoveIndex={(idx) =>
                  setImportedIssues(prev => prev.filter((_, i) => i !== idx))
                }
                onClearAll={() => setImportedIssues([])}
              />
            </div>
          )}
        </div>

        {/* Single primary Context textarea — bound to the agent's
            primaryFieldKey. If we couldn't resolve a primary field for
            the agent (no fields at all, e.g. a brand-new agent skeleton)
            we fall back to a generic context textarea bound to a virtual
            `__context__` key so the form still renders. */}
        {primaryField ? (
          <div ref={(el) => { fieldRefs.current[primaryField.key] = el }}>
            {renderFieldBody(
              {
                ...primaryField,
                // The label is intentionally rewritten to the friendly
                // unified name; the placeholder retains the page-level
                // hint so each agent's textarea still feels purpose-fit.
                label: 'Context for the agent',
                hint: jiraConnected
                  ? 'auto-filled from the Jira ticket above — edit freely or paste your own details'
                  : 'paste the user story / scope / details the agent needs',
                rows: Math.max(primaryField.rows || 6, 6),
              },
              {
                shakeStamp: shakeKeys[primaryField.key],
                values,
                handleChange,
                handleTextareaBlur,
                autoFetchedNotice,
              },
            )}
          </div>
        ) : (
          <div className="text-xs text-gray-500">
            This agent has no primary input declared. Open Advanced details below to fill the form.
          </div>
        )}
      </div>

      {/* ---- Advanced details disclosure --------------------------------
           Holds every non-primary declared field (required AND optional)
           plus any extraInput hint. A "N required" badge on the header
           tells the user when something inside still needs filling — the
           Generate button also auto-opens this section and scrolls to
           the first missing required field if they try to submit early.
      ----------------------------------------------------------------- */}
      {advancedFields.length > 0 && (
        <details
          ref={advancedDetailsRef}
          className="toon-card !p-0 overflow-hidden"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors list-none">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-white text-sm shadow-toon">
              ⚙️
            </span>
            <div className="flex-1">
              <div className="text-sm font-bold text-toon-navy flex items-center gap-2 flex-wrap">
                Advanced details
                {missingAdvanced.length > 0 ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-50 text-toon-coral border border-rose-200">
                    {missingAdvanced.length} required
                  </span>
                ) : requiredAdvancedFields.length > 0 ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-toon-mint border border-emerald-200">
                    Required filled
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-gray-500">
                {advancedFields.length} {advancedFields.length === 1 ? 'field' : 'fields'} — leave blank to let AI infer where possible.
              </div>
            </div>
            <motion.span
              className="text-toon-blue text-lg"
              animate={{ rotate: advancedOpen ? 90 : 0 }}
              transition={{ duration: 0.2 }}
              aria-hidden="true"
            >
              ▸
            </motion.span>
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-4 border-t border-gray-100">
            {advancedFields.map((field) => (
              <div
                key={field.key}
                ref={(el) => { fieldRefs.current[field.key] = el }}
              >
                {renderFieldBody(field, {
                  shakeStamp: shakeKeys[field.key],
                  values,
                  handleChange,
                  handleTextareaBlur,
                  autoFetchedNotice,
                })}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <MagneticButton className="flex-1">
          <motion.button
            whileTap={!loading ? { scale: 0.96 } : {}}
            whileHover={!loading ? { scale: 1.01 } : {}}
            onClick={() => handleRun()}
            disabled={loading}
            className={`astound-btn-grad w-full text-lg ${
              loading ? 'opacity-80 cursor-wait' : ''
            } ${!allRequiredFilled && !loading ? 'opacity-70' : ''}`}
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <span>Generating</span>
                <span className="inline-flex items-center gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.span
                      key={i}
                      className="inline-block w-1.5 h-1.5 rounded-full bg-white"
                      animate={{ y: [0, -4, 0], opacity: [0.6, 1, 0.6] }}
                      transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
                    />
                  ))}
                </span>
              </span>
            ) : getAgentActionLabel(agentName)}
          </motion.button>
        </MagneticButton>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleReset}
          type="button"
          className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 px-6 text-lg"
        >
          Reset
        </motion.button>
      </div>

      {/* "Boy on a laptop" waiting scene — only rendered while we are
          still waiting for the first token. As soon as content starts
          streaming, ReportPanel takes over and shows its own inline
          "Streaming…" indicator, so we don't need a second scene. */}
      <AnimatePresence mode="wait">
        {loading && !result && (
          <GeneratingScene key="hero-scene" size="lg" />
        )}
      </AnimatePresence>

      {/* No keyed AnimatePresence wrapper here: ReportPanel has its own
          entrance animation. A keyed wrapper would re-mount the panel
          on every state transition and cause a visible flicker while
          tokens stream in. */}
      {result && (
        <ReportPanel
          content={result}
          agentName={agentName}
          sheetTitle={sheetTitle}
          stamp={resultStamp}
          loading={loading}
          jiraContextKey={jiraContextKey}
          runMeta={runMeta}
        />
      )}

      {/* "Regenerate (skip cache)" — only surfaced when the user is
          actually looking at a cache hit. This is the escape hatch for
          the rare case where the cached output is stale (e.g. an
          admin-pinned model produced an oddity, or the provider rolled
          a silent upgrade and the user wants to re-baseline). The
          backend skips the cache READ but still WRITES the new output,
          so a single user's force-fresh refreshes the entry for
          everyone — preventing two simultaneous regenerate clicks both
          paying LLM cost for the same input. */}
      {result && runMeta?.cached && !loading && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => handleRun({ forceFresh: true })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 hover:bg-sky-100 hover:border-sky-300 transition-colors"
            title="Re-run this exact input against the live LLM, ignoring the cached response. Updates the cached entry for everyone."
          >
            <span aria-hidden="true">↻</span>
            <span>Regenerate (skip cache)</span>
          </button>
        </div>
      )}

      {/* Confetti is a fixed-position overlay — kept outside the
          space-y stack so it never contributes a phantom margin
          between the action buttons and the Report panel. */}
      <Confetti trigger={confettiTrigger} />
    </div>
  )
}
