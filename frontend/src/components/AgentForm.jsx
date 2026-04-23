import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import toast from 'react-hot-toast'
import api from '../api/client'
import ReportPanel from './ReportPanel'
import { useAgentResults, AGENT_LABELS } from '../context/AgentResultsContext'
import { useJira } from '../context/JiraContext'
import JiraIssuePicker from './JiraIssuePicker'
import CustomPromptEditor from './CustomPromptEditor'
import { Stagger, StaggerItem } from './motion/Stagger'
import Confetti from './motion/Confetti'
import GeneratingScene from './motion/GeneratingScene'
import { extractJiraKey } from '../utils/jiraDetect'
import { useQaMode, QA_MODE_OPTIONS } from '../hooks/useQaMode'

function jiraIssueToText(issue) {
  if (!issue) return ''
  const lines = [
    `Jira ${issue.issuetype || 'Issue'} ${issue.key}: ${issue.summary || ''}`,
    issue.status ? `Status: ${issue.status}` : '',
    issue.priority ? `Priority: ${issue.priority}` : '',
    issue.assignee ? `Assignee: ${issue.assignee}` : '',
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
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState('')
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
  const [qaMode, setQaMode] = useQaMode()

  const { saveResult, getAvailableResults } = useAgentResults()
  const availableResults = getAvailableResults(agentName)
  const { connected: jiraConnected, resolveFromText, getIssue: jiraGetIssue, listIssues: jiraListIssues } = useJira()

  // Multi-select + sprint-scope CTAs are only meaningful on the
  // Test Plan & Strategy agent — every other agent stays single-select.
  const allowMultiPick = agentName === 'test_plan'

  // Per-field set of Jira keys we have already auto-imported, so on-blur
  // doesn't re-fetch the same ticket every time the user clicks elsewhere.
  const importedKeysRef = useRef({})
  const [autoFetchedNotice, setAutoFetchedNotice] = useState({})

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
  useEffect(() => {
    if (agentName === 'requirement') return
    if (availableResults.length > 0) return
    let cancelled = false
    api.get('/history/', { params: { limit: 10 } })
      .then(({ data }) => {
        if (cancelled) return
        const records = (data?.records || []).slice(0, 10)
        const mapped = records
          .filter(rec => rec.agent && rec.agent !== agentName)
          .map((rec, idx) => ({
            name: `history:${idx}`,
            label: AGENT_LABELS[rec.agent] || rec.agent,
            content: rec.output || rec.output_preview || '',
            timestamp: rec.ts ? Date.parse(rec.ts) || Date.now() : Date.now(),
            source: 'history',
          }))
          .filter(r => r.content)
        setHistoricalRuns(mapped)
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

  // Selects are auto-treated as advanced unless a page explicitly opts out.
  const isAdvancedField = (f) =>
    f.advanced === true || (f.type === 'select' && f.advanced !== false)

  const primaryFields = resolvedFields.filter(f => !isAdvancedField(f))
  const advancedFields = resolvedFields.filter(isAdvancedField)
  const requiredFields = primaryFields.filter(f => f.required !== false && f.type !== 'select')

  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try { return localStorage.getItem(ADV_KEY(agentName)) === '1' } catch { return false }
  })
  useEffect(() => {
    try { localStorage.setItem(ADV_KEY(agentName), advancedOpen ? '1' : '0') } catch { /* ignore */ }
  }, [advancedOpen, agentName])

  const allRequiredFilled = requiredFields.every(f => values[f.key]?.trim?.())
  const canGenerate = allRequiredFilled && !loading

  const selectedLinked =
    availableResults.find(r => r.name === linkedAgent) ||
    historicalRuns.find(r => r.name === linkedAgent)

  const handleRun = async () => {
    if (loading) return
    if (!allRequiredFilled) {
      const missing = {}
      requiredFields.forEach(f => {
        if (!values[f.key]?.trim?.()) missing[f.key] = Date.now()
      })
      setShakeKeys(missing)
      return
    }
    setLoading(true)
    setResult('')
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
        saveResult(agentName, accumulated)
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
    setSelectedProject('')
    setLinkedAgent('')
    setShowLinkedPreview(false)
    setShakeKeys({})
  }, [])

  const handleTextareaBlur = useCallback(async (fieldKey, currentValue) => {
    if (!jiraConnected || !currentValue) return
    const key = extractJiraKey(currentValue)
    if (!key) return
    const seen = importedKeysRef.current[fieldKey] || new Set()
    if (seen.has(key)) return
    try {
      const resp = await resolveFromText(currentValue)
      if (!resp?.issue || !resp.key) return
      const text = jiraIssueToText(resp.issue)
      seen.add(resp.key)
      importedKeysRef.current = { ...importedKeysRef.current, [fieldKey]: seen }
      setValues(prev => {
        const existing = prev[fieldKey]?.trim?.() || ''
        const marker = `--- Imported from Jira ${resp.key} ---`
        if (existing.includes(marker)) return prev
        const next = existing ? `${existing}\n\n${marker}\n${text}` : `${marker}\n${text}`
        return { ...prev, [fieldKey]: next }
      })
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
  }, [jiraConnected, resolveFromText])

  const handleJiraImport = useCallback((issue) => {
    if (!issue) return
    const text = jiraIssueToText(issue)
    setValues(prev => {
      const next = { ...prev }
      const textareaFields = resolvedFields.filter(f => f.type === 'textarea')
      const textFields = resolvedFields.filter(f => f.type !== 'textarea' && f.type !== 'select')
      const titleField = textFields.find(f =>
        /title|summary|name/i.test(f.key)
      )
      if (titleField && !next[titleField.key]?.trim?.()) {
        next[titleField.key] = `${issue.key}: ${issue.summary || ''}`.trim()
      }
      const primaryArea =
        textareaFields.find(f => /requirement|story|description|scope|test_cases|test_cases_or_scope/i.test(f.key)) ||
        textareaFields[0]
      if (primaryArea) {
        const existing = next[primaryArea.key]?.trim?.() || ''
        next[primaryArea.key] = existing ? `${existing}\n\n${text}` : text
      }
      const ctxArea = textareaFields.find(f => /additional_context|context/i.test(f.key))
      if (ctxArea && primaryArea && ctxArea.key !== primaryArea.key) {
        const ex = next[ctxArea.key]?.trim?.() || ''
        const note = `Imported from Jira ${issue.key} (${issue.url || ''})`
        next[ctxArea.key] = ex ? `${ex}\n${note}` : note
      }
      return next
    })
  }, [resolvedFields])

  // Fetch full detail for a list of issues with bounded concurrency, then
  // format the consolidated scope block. Used by both `handleJiraImportMany`
  // (user checked rows) and `handleSprintScope` (Use entire sprint CTA).
  const fetchAndFormatScope = useCallback(async (issueKeys, headerLine) => {
    const concurrency = 5
    const results = new Array(issueKeys.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < issueKeys.length) {
        const i = cursor++
        try {
          results[i] = await jiraGetIssue(issueKeys[i])
        } catch {
          results[i] = null
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, issueKeys.length) }, worker))
    const ok = results.filter(Boolean)
    const lines = []
    if (headerLine) lines.push(headerLine, '')
    lines.push(`Tickets in scope (${ok.length}):`, '')
    for (const issue of ok) {
      lines.push(`### ${issue.key} — ${issue.summary || '(no summary)'}`)
      const meta = []
      if (issue.status) meta.push(`Status: ${issue.status}`)
      if (issue.issuetype) meta.push(`Type: ${issue.issuetype}`)
      if (issue.priority) meta.push(`Priority: ${issue.priority}`)
      if (meta.length) lines.push(meta.join(' | '))
      const desc = (issue.description || '').trim()
      if (desc) {
        lines.push('Description:')
        lines.push(desc.length > 800 ? `${desc.slice(0, 800)}…` : desc)
      } else {
        lines.push('Description: (none)')
      }
      lines.push('')
    }
    return { block: lines.join('\n').trimEnd(), count: ok.length }
  }, [jiraGetIssue])

  // Write a consolidated scope block into the primary textarea
  // (replacing whatever was there — multi-import is a "set scope" gesture,
  // not an append, otherwise the form fills with stacked sprint dumps).
  const writeScopeBlock = useCallback((block) => {
    const textareaFields = resolvedFields.filter(f => f.type === 'textarea')
    const primaryArea =
      textareaFields.find(f => /requirement|story|description|scope|test_cases|test_cases_or_scope/i.test(f.key)) ||
      textareaFields[0]
    if (!primaryArea) return
    setValues(prev => ({ ...prev, [primaryArea.key]: block }))
  }, [resolvedFields])

  const handleJiraImportMany = useCallback(async (issuesList) => {
    if (!issuesList?.length) return
    const t = toast.loading(`Importing ${issuesList.length} ticket${issuesList.length === 1 ? '' : 's'}…`)
    try {
      const { block, count } = await fetchAndFormatScope(
        issuesList.map(it => it.key),
        null,
      )
      writeScopeBlock(block)
      toast.success(`Loaded ${count} ticket${count === 1 ? '' : 's'} into scope`, { id: t })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to import tickets', { id: t })
    }
  }, [fetchAndFormatScope, writeScopeBlock])

  const handleSprintScope = useCallback(async ({ projectKey, sprintId, sprintName }) => {
    if (!projectKey || !sprintId) return
    const t = toast.loading(`Fetching sprint "${sprintName}"…`)
    try {
      const list = await jiraListIssues(projectKey, {
        sprintId,
        maxResults: 200,
      })
      if (!list.length) {
        toast.error(`Sprint "${sprintName}" has no tickets`, { id: t })
        return
      }
      const header = `Sprint scope: ${sprintName} (project ${projectKey}) — ${list.length} ticket${list.length === 1 ? '' : 's'}`
      const { block, count } = await fetchAndFormatScope(
        list.map(it => it.key),
        header,
      )
      writeScopeBlock(block)
      toast.success(`Loaded ${count} ticket${count === 1 ? '' : 's'} from "${sprintName}" — click Generate`, { id: t })
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to load sprint', { id: t })
    }
  }, [jiraListIssues, fetchAndFormatScope, writeScopeBlock])

  const activeProject = projects.find(p => p.slug === selectedProject)

  return (
    <div className="space-y-6">
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
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-toon-blue flex items-center justify-center text-white text-sm shadow-toon">
              📂
            </span>
            <div className="flex-1">
              <label className="block text-sm font-bold text-toon-navy mb-1.5">
                Project Context
                <span className="font-normal text-gray-400 ml-2">(optional — RAG over project docs)</span>
              </label>
              <select
                className="toon-input !py-2"
                value={selectedProject}
                onChange={e => setSelectedProject(e.target.value)}
              >
                <option value="">— No project (global knowledge only) —</option>
                {projects.map(p => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}{p.docs ? ` (${p.docs} docs)` : ''}
                  </option>
                ))}
              </select>
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
                      <div className="mt-2 p-3 bg-gray-50 rounded-xl text-xs max-h-60 overflow-auto border border-gray-200 markdown-body table-wrap">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
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

      {/* Jira issue picker (only when connected). The Test Plan & Strategy
          agent gets multi-select + 'Use entire sprint as scope'; every
          other agent stays single-select. */}
      {jiraConnected && (
        <JiraIssuePicker
          onImport={handleJiraImport}
          multiSelect={allowMultiPick}
          onImportMany={allowMultiPick ? handleJiraImportMany : undefined}
          onUseSprintScope={allowMultiPick ? handleSprintScope : undefined}
        />
      )}

      {/* Test Case Development users can override the system prompt for
          their session. Persisted to localStorage; the default prompt on
          disk is never modified. Other agents stay untouched. */}
      {agentName === 'testcase' && (
        <CustomPromptEditor
          agentName={agentName}
          onChange={setSystemPromptOverride}
        />
      )}

      {/* Primary form fields (required-by-default) */}
      <Stagger className="space-y-4" delayChildren={0.1} staggerChildren={0.05}>
        {primaryFields.map((field) => (
          <StaggerItem key={field.key}>
            {renderFieldBody(field, {
              shakeStamp: shakeKeys[field.key],
              values,
              handleChange,
              handleTextareaBlur,
              autoFetchedNotice,
            })}
          </StaggerItem>
        ))}
      </Stagger>

      {/* Advanced (optional) fields — collapsed by default, persists per-agent */}
      {advancedFields.length > 0 && (
        <details
          className="toon-card !p-0 overflow-hidden"
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
        >
          <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors list-none">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-300 to-gray-400 flex items-center justify-center text-white text-sm shadow-toon">
              ⚙️
            </span>
            <div className="flex-1">
              <div className="text-sm font-bold text-toon-navy">Advanced (optional)</div>
              <div className="text-xs text-gray-500">
                Fine-tune {advancedFields.length} {advancedFields.length === 1 ? 'field' : 'fields'} — leave blank to let AI infer.
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
              <div key={field.key}>
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
        <motion.button
          whileTap={!loading ? { scale: 0.96 } : {}}
          whileHover={!loading ? { scale: 1.01 } : {}}
          onClick={handleRun}
          disabled={loading}
          className={`toon-btn toon-btn-blue flex-1 text-lg transition-all ${
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
          ) : '✨ Generate'}
        </motion.button>

        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={handleReset}
          type="button"
          className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 px-6 text-lg"
        >
          🔄 Reset
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
        />
      )}

      {/* Confetti is a fixed-position overlay — kept outside the
          space-y stack so it never contributes a phantom margin
          between the action buttons and the Report panel. */}
      <Confetti trigger={confettiTrigger} />
    </div>
  )
}
