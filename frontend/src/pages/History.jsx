import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MarkdownTableCell from '../components/markdown/MarkdownTableCell'
import MarkdownTableScroll from '../components/markdown/MarkdownTableScroll'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import { useJira } from '../context/JiraContext'
import { AGENT_LABELS } from '../context/AgentResultsContext'
import { AGENT_META } from '../config/agentMeta'
import PageHeader from '../components/PageHeader'
import ToonCard from '../components/ToonCard'
import TestManagementPush from '../components/TestManagementPush'
import JiraCommentPush from '../components/JiraCommentPush'
import ExportColumnPicker, { detectMarkdownTables } from '../components/ExportColumnPicker'

// Slugs whose Markdown output the user can push directly into a test-
// management tool (Xray etc.). Everything else just gets the standard
// download buttons. Kept in sync with TestManagementPush's supported
// adapter list.
const PUSH_AGENTS = new Set(['testcase', 'smoke', 'regression'])
// Agents that produce free-form analysis the user often wants posted
// back as a Jira comment on the originating ticket.
const JIRA_COMMENT_AGENTS = new Set(['requirement', 'exec_report', 'closure_report'])

const HISTORY_MD_COMPONENTS = { td: MarkdownTableCell, table: MarkdownTableScroll }

// Sentinel key for the synthetic section that collects runs without a
// project stamp. Using a Symbol-shaped string keeps the key impossible
// to collide with a real Firestore project slug while still being
// JSON-friendly for ``useState``.
const NO_PROJECT_KEY = '__no_project__'
const NO_PROJECT_LABEL = '(No project)'

// Inline token formatter — same rules as ReportPanel.formatTokenCount
// but kept local because History is the other consumer and we don't
// want to wire a shared util module just for two helper fns.
function fmtTokens(n) {
  if (n == null || Number.isNaN(n)) return '—'
  const v = Number(n)
  if (v < 1000) return String(v)
  if (v < 10000) return v.toLocaleString()
  return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`
}

// Resolve an agent slug to its human label. We prefer AGENT_META (the
// richer catalog) over the legacy AGENT_LABELS shim, but fall back
// through both so any agent recently added to one map keeps rendering.
function agentLabel(slug) {
  return AGENT_META[slug]?.label || AGENT_LABELS[slug] || slug || '(unknown)'
}

function agentIcon(slug) {
  return AGENT_META[slug]?.icon || '🤖'
}

/**
 * Compact horizontal usage badge for a History row.
 *
 * Shape (admin):     [ provider · model ]  [ 🪙 1.2k · 891 · 2.1k ]  [ 🛠 Repaired ]
 * Shape (non-admin): [ 🛠 Repaired ]
 *
 * Cost-side metadata (resolved model + token counts) is admin-only —
 * the Repaired chip is visible to everyone because it explains a
 * visible behaviour change for that run. Returns ``null`` when there's
 * nothing left to show after gating.
 */
function HistoryUsageBadges({ rec, isAdmin }) {
  const provider = rec.provider || ''
  const model = rec.model || ''
  const usage = rec.usage || null
  const showCostSide = isAdmin && (!!provider || !!model || !!usage)
  const showRepaired = !!rec.repaired
  if (!showCostSide && !showRepaired) return null

  const source = usage?.source || (rec.cache_hit ? 'cached' : 'live')
  const palette = source === 'cached'
    ? 'bg-sky-50 border-sky-200 text-sky-700'
    : source === 'estimated'
      ? 'bg-amber-50 border-amber-200 text-amber-700'
      : 'bg-emerald-50 border-emerald-200 text-emerald-700'

  return (
    <span className="inline-flex items-center gap-1.5">
      {showCostSide && (provider || model) && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 text-[10px] font-bold"
          title={`Routed to ${provider}${model ? ` · ${model}` : ''}`}
        >
          <span aria-hidden="true">🤖</span>
          <span className="opacity-70">{provider}</span>
          {model && <><span className="opacity-40">·</span><span>{model}</span></>}
        </span>
      )}
      {showCostSide && usage && (
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${palette} text-[10px] font-bold tabular-nums`}
          title={`Prompt ${fmtTokens(usage.prompt_tokens)} · Completion ${fmtTokens(usage.completion_tokens)} · Total ${fmtTokens(usage.total_tokens)} (${source})`}
        >
          <span aria-hidden="true">🪙</span>
          {fmtTokens(usage.prompt_tokens)}
          <span className="opacity-40">·</span>
          {fmtTokens(usage.completion_tokens)}
          <span className="opacity-40">·</span>
          <span className="font-extrabold">{fmtTokens(usage.total_tokens)}</span>
        </span>
      )}
      {showRepaired && (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 text-[10px] font-bold uppercase tracking-wider"
          title="The orchestrator's auto-repair pass kicked in for this run — the first attempt didn't match the required structure, so a second LLM call ran with a strict format clamp."
        >
          <span aria-hidden="true">🛠️</span>
          Repaired
        </span>
      )}
    </span>
  )
}

/**
 * "Originating Jira ticket" chip rendered on every History row that
 * has a resolved key. Clicking it opens the ticket in a new tab via
 * the connected Jira tenant's ``/browse/<KEY>`` URL; falls back to a
 * static (non-clickable) badge when Jira isn't connected yet so the
 * key + summary are still visible.
 *
 * ``onClick`` is intentionally stopped so clicking the chip never
 * collapses/expands the parent row.
 */
function JiraTicketChip({ jiraKey, jiraSummary, jiraUrl, large = false }) {
  if (!jiraKey) return null
  const fullLabel = jiraSummary ? `${jiraKey} — ${jiraSummary}` : jiraKey
  const href = jiraUrl ? `${jiraUrl.replace(/\/+$/, '')}/browse/${jiraKey}` : null
  // ``large`` is used when the chip is promoted to the row's primary
  // title -- it gets a slightly bigger badge and a generous summary
  // truncation so the user can read the user-story title at a glance.
  const sizing = large
    ? 'px-2.5 py-1 text-sm'
    : 'px-2 py-0.5 text-xs'
  const summaryMax = large ? 'max-w-[48ch]' : 'max-w-[32ch]'
  const body = (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 font-bold max-w-full ${sizing}`}>
      <span aria-hidden="true">🎫</span>
      <span className="font-mono">{jiraKey}</span>
      {jiraSummary && (
        <>
          <span className="opacity-40">—</span>
          <span className={`font-normal opacity-80 truncate ${summaryMax}`}>{jiraSummary}</span>
        </>
      )}
    </span>
  )
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={fullLabel}
        className="hover:opacity-90 max-w-full"
      >
        {body}
      </a>
    )
  }
  return <span title={fullLabel} className="max-w-full">{body}</span>
}

// Build a fall-back row title when the run has no Jira ticket attached.
// The user picked "output preview" as the source of truth -- we take
// the first non-empty line of the agent's reply, strip any leading
// Markdown decoration (#, *, -, >), and truncate to ~80 chars so the
// row label stays single-line even on narrow screens.
function previewTitle(rec) {
  const raw = (rec.output_preview || rec.output || '').trim()
  if (!raw) return '(no preview)'
  const firstLine = (raw.split(/\r?\n+/).find((l) => l.trim()) || raw)
    .replace(/^[#>\-*\s]+/, '')
    .trim()
  if (!firstLine) return '(no preview)'
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
}

export default function History() {
  const [records, setRecords] = useState([])
  // Free-form text filter applied across the Jira key, summary,
  // output preview, agent slug, and project. Empty = "show everything".
  const [searchQuery, setSearchQuery] = useState('')
  // Per-section collapse state. Initialised lazily once we know which
  // project bucket is the most-recent (so the freshest section opens
  // by default and the rest stay collapsed).
  //
  // Shape: ``null`` before first init, then ``{ [projectKey]: bool }``.
  const [openSections, setOpenSections] = useState(null)
  // Per-section agent filter. Each value is a ``Set`` of agent slugs
  // that are currently SELECTED; empty / absent means "show all
  // agents in this section" (the "All" chip).
  //
  // Shape: ``{ [projectKey]: Set<agentSlug> }``.
  const [sectionAgentFilters, setSectionAgentFilters] = useState({})
  // Currently-expanded result row. Keyed by ``${sectionKey}::${ts}::${idx}``
  // so the same record can't double-open if it would happen to surface
  // twice (it won't — keys are unique within the dataset — but a
  // section-scoped key keeps state contained even as filters shift).
  const [expandedRowKey, setExpandedRowKey] = useState(null)
  const { user } = useAuth()
  const { jiraUrl } = useJira()
  const isAdmin = !!user?.is_admin

  // Fetch records WITHOUT a server-side agent filter — the per-section
  // agent chips do the filtering client-side now (so a single round-
  // trip serves every project section). Backend still caps to 200 rows
  // which is plenty for the history surface.
  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/history/')
      setRecords(data.records || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onRunComplete = () => load()
    const onFocus = () => load()
    window.addEventListener('qa:agent-run-complete', onRunComplete)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('qa:agent-run-complete', onRunComplete)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const clearAll = async () => {
    if (!window.confirm('Clear ALL run history? This cannot be undone.')) return
    await api.delete('/history/')
    toast.success('History cleared')
    setRecords([])
  }

  // Cross-record column-picker state. We stash the in-flight format +
  // markdown + agent so the picker is shared across all expanded rows
  // (you can only have one open at a time anyway).
  const [picker, setPicker] = useState(null)  // { format, content, agentName, tables }

  // Mirror ReportPanel.download(): hit POST /api/exports/{format} with the
  // raw markdown and stream the resulting blob into a hidden <a> click.
  const performDownloadExport = async (format, content, agentName, selectedColumns) => {
    if (!content) {
      toast.error('No output to export')
      return
    }
    const tid = toast.loading(`Generating ${format.toUpperCase()}…`)
    try {
      const payload = { content, agent_name: agentName }
      if (selectedColumns && Object.keys(selectedColumns).length > 0) {
        payload.selected_columns = selectedColumns
      }
      const resp = await api.post(
        `/exports/${format}`,
        payload,
        { responseType: 'blob' },
      )
      const ext = format === 'excel' ? 'xlsx'
        : format === 'markdown' ? 'md'
        : format === 'pdf' ? 'pdf'
        : 'csv'
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `QA_${agentName || 'agent'}_${Date.now()}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${format.toUpperCase()}!`, { id: tid })
    } catch (err) {
      // responseType:'blob' means the error body is a Blob; parse it to
      // recover the backend's `detail` string instead of showing a
      // generic "export failed" toast.
      let message = `${format.toUpperCase()} export failed`
      try {
        const blob = err?.response?.data
        if (blob && typeof blob.text === 'function') {
          const text = await blob.text()
          try {
            const parsed = JSON.parse(text)
            if (parsed?.detail) message = parsed.detail
          } catch {
            if (text) message = text.slice(0, 240)
          }
        } else if (err?.message) {
          message = err.message
        }
      } catch {
        /* fall through to default message */
      }
      toast.error(message, { id: tid })
    }
  }

  const downloadExport = (format, content, agentName) => {
    if (!content) {
      toast.error('No output to export')
      return
    }
    const tables = detectMarkdownTables(content)
    if (tables.length === 0) {
      // No tables in the run — preserve the original instant-download UX.
      return performDownloadExport(format, content, agentName, null)
    }
    setPicker({ format, content, agentName, tables })
  }

  // Stash the record payload in sessionStorage and open a standalone viewer
  // in a new tab. We avoid `noopener` so sessionStorage transfers reliably
  // across browsers — the new tab is read-only and same-origin, so there's
  // no security gain from isolating its window.opener here.
  const openInNewWindow = (rec) => {
    const md = rec.output || rec.output_preview || ''
    if (!md) {
      toast.error('No output to display')
      return
    }
    const key = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `r${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payload = {
      markdown: md,
      agentName: rec.agent || '',
      project: rec.project || '',
      ts: rec.ts || '',
    }
    try {
      sessionStorage.setItem(`qaResult:${key}`, JSON.stringify(payload))
    } catch {
      toast.error('Could not stash result for new window')
      return
    }
    window.open(`/result/view?key=${encodeURIComponent(key)}`, '_blank')
  }

  // -- Section bucketing ----------------------------------------------------
  // Group records by project, then sort sections by most-recent
  // activity DESC so the freshest project floats to the top. Records
  // without a project drop into a synthetic "(No project)" bucket so
  // they're still discoverable.
  const sections = useMemo(() => {
    const byProject = new Map()
    for (const rec of records) {
      const projectSlug = (rec.project || '').trim()
      const key = projectSlug || NO_PROJECT_KEY
      const arr = byProject.get(key) || []
      arr.push(rec)
      byProject.set(key, arr)
    }
    const list = Array.from(byProject.entries()).map(([key, rows]) => {
      const latestTs = rows.reduce(
        (acc, r) => (r.ts && r.ts > acc ? r.ts : acc),
        '',
      )
      return {
        key,
        label: key === NO_PROJECT_KEY ? NO_PROJECT_LABEL : key,
        rows,
        latestTs,
      }
    })
    list.sort((a, b) => {
      if (a.latestTs === b.latestTs) return a.label.localeCompare(b.label)
      return a.latestTs < b.latestTs ? 1 : -1
    })
    return list
  }, [records])

  // First-paint section state: open the most-recent project, leave
  // the rest collapsed. Re-runs when ``records`` produces the first
  // non-empty section list; subsequent updates leave the user's
  // collapse choices alone so toggles don't snap shut on auto-refresh.
  useEffect(() => {
    if (openSections === null && sections.length > 0) {
      setOpenSections({ [sections[0].key]: true })
    }
  }, [openSections, sections])

  const isSectionOpen = (key) => {
    if (openSections === null) return false
    return !!openSections[key]
  }

  const toggleSection = (key) => {
    setOpenSections((prev) => {
      const base = prev || {}
      return { ...base, [key]: !base[key] }
    })
  }

  // -- Per-section agent filter --------------------------------------------
  const toggleAgentInSection = (sectionKey, agentSlug) => {
    setSectionAgentFilters((prev) => {
      const current = new Set(prev[sectionKey] || [])
      if (current.has(agentSlug)) current.delete(agentSlug)
      else current.add(agentSlug)
      const next = { ...prev }
      if (current.size === 0) {
        delete next[sectionKey]
      } else {
        next[sectionKey] = current
      }
      return next
    })
  }

  const clearAgentsInSection = (sectionKey) => {
    setSectionAgentFilters((prev) => {
      if (!prev[sectionKey]) return prev
      const next = { ...prev }
      delete next[sectionKey]
      return next
    })
  }

  // -- Global text search ---------------------------------------------------
  const matchesQuery = useCallback((rec) => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return true
    const haystack = [
      rec.jira_key || '',
      rec.jira_summary || '',
      rec.output_preview || '',
      rec.agent || '',
      agentLabel(rec.agent),
      rec.project || '',
    ].join(' \n ').toLowerCase()
    return haystack.includes(q)
  }, [searchQuery])

  // -- Row renderer ---------------------------------------------------------
  // Row title rules (task 1):
  //   1. Has Jira key + summary -> render the (clickable) Jira chip as
  //      the primary title.
  //   2. Has Jira key only -> render the chip with just the key.
  //   3. No Jira context -> show the first line of ``output_preview``
  //      truncated to ~80 chars (the "user story title" fallback).
  // The agent icon + label is demoted to a small violet badge that
  // sits next to the title so the per-section "Filter by agent" chips
  // still feel coherent with the row content.
  const renderRow = (rec, rowKey) => {
    const label = agentLabel(rec.agent)
    const icon = agentIcon(rec.agent)
    const ts = rec.ts?.slice(0, 19).replace('T', ' ') || ''
    const isOpen = expandedRowKey === rowKey
    const titleNode = rec.jira_key
      ? (
        <JiraTicketChip
          jiraKey={rec.jira_key}
          jiraSummary={rec.jira_summary}
          jiraUrl={jiraUrl}
          large
        />
      )
      : (
        <span
          className="font-bold text-toon-navy truncate max-w-[52ch]"
          title={previewTitle(rec)}
        >
          {previewTitle(rec)}
        </span>
      )
    return (
      <div
        key={rowKey}
        onClick={() => setExpandedRowKey(isOpen ? null : rowKey)}
        className="rounded-2xl border border-violet-100 bg-white/80 hover:border-astound-violet/40 hover:shadow-sm transition-all cursor-pointer p-3"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {titleNode}
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 border border-violet-100 text-violet-700 text-[11px] font-semibold whitespace-nowrap"
              title={`Agent: ${label}`}
            >
              <span aria-hidden="true">{icon}</span>
              <span>{label}</span>
            </span>
            <HistoryUsageBadges rec={rec} isAdmin={isAdmin} />
          </div>
          <span className="text-xs text-gray-400 whitespace-nowrap">{ts}</span>
        </div>
        {isOpen && (() => {
          const md = rec.output || rec.output_preview || ''
          const hasOutput = !!md
          return (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mt-4">
              {hasOutput && (
                <div className="flex flex-wrap justify-end gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => downloadExport('excel', md, rec.agent)}
                    className="toon-btn toon-btn-mint text-sm py-2 px-4"
                  >
                    📊 Excel
                  </button>
                  <button
                    onClick={() => downloadExport('csv', md, rec.agent)}
                    className="toon-btn toon-btn-blue text-sm py-2 px-4"
                  >
                    📋 CSV
                  </button>
                  <button
                    onClick={() => downloadExport('pdf', md, rec.agent)}
                    className="toon-btn toon-btn-coral text-sm py-2 px-4"
                  >
                    📄 PDF
                  </button>
                  <button
                    onClick={() => downloadExport('markdown', md, rec.agent)}
                    className="toon-btn toon-btn-purple text-sm py-2 px-4"
                  >
                    📝 Markdown
                  </button>
                  <button
                    onClick={() => openInNewWindow(rec)}
                    className="toon-btn bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-sm py-2 px-4 hover:opacity-90"
                  >
                    🪟 Open in new window
                  </button>
                  {PUSH_AGENTS.has(rec.agent) && (
                    <TestManagementPush markdown={md} agentName={rec.agent} />
                  )}
                  {JIRA_COMMENT_AGENTS.has(rec.agent) && (
                    <JiraCommentPush
                      markdown={md}
                      agentName={rec.agent}
                      defaultIssueKey={rec.jira_key || ''}
                    />
                  )}
                </div>
              )}
              <div className="bg-gray-50 rounded-2xl p-4 max-h-96 overflow-y-auto overflow-x-clip">
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={HISTORY_MD_COMPONENTS}>{md || 'No output'}</ReactMarkdown>
                </div>
              </div>
            </motion.div>
          )
        })()}
      </div>
    )
  }

  // Total runs across all rendered sections AFTER the global text
  // filter is applied — feeds the header's counter so the user can
  // see how aggressively the search is narrowing the dataset.
  const filteredCount = useMemo(() => {
    if (!searchQuery.trim()) return records.length
    return records.filter(matchesQuery).length
  }, [records, searchQuery, matchesQuery])

  return (
    <div>
      <PageHeader
        icon="📜"
        title="History"
        subtitle="Browse past agent runs, grouped by project and filterable per agent"
        gradient="from-violet-500 to-purple-400"
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative w-full sm:w-80">
          <input
            type="search"
            placeholder="Search Jira key, summary, agent, preview…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="toon-input w-full pl-9"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">🔍</span>
        </div>
        <button onClick={clearAll} className="toon-btn toon-btn-coral text-sm py-2 px-4">🗑️ Clear All</button>
        <span className="text-sm text-gray-500 ml-auto">
          {searchQuery.trim() ? `${filteredCount} of ${records.length}` : `${records.length}`} run{records.length === 1 ? '' : 's'}
          {sections.length > 0 && (
            <span className="opacity-70"> · {sections.length} project{sections.length === 1 ? '' : 's'}</span>
          )}
        </span>
      </div>

      <div className="space-y-4">
        {sections.map((section) => {
          const activeAgentFilter = sectionAgentFilters[section.key]
          const hasAgentFilter = !!(activeAgentFilter && activeAgentFilter.size > 0)
          const visibleRows = section.rows.filter((rec) => {
            if (hasAgentFilter && !activeAgentFilter.has(rec.agent)) return false
            return matchesQuery(rec)
          })
          // Hide whole sections that don't have any matching rows
          // during a search — keeps the page from looking like a
          // graveyard of empty buckets when the user types a query.
          if (searchQuery.trim() && visibleRows.length === 0) return null
          const sectionOpen = isSectionOpen(section.key)
          // Distinct agents in this section, sorted by label for a
          // stable chip order regardless of run sequence.
          const agentsInSection = Array.from(
            new Set(section.rows.map((r) => r.agent || '(unknown)')),
          )
          agentsInSection.sort((a, b) => agentLabel(a).localeCompare(agentLabel(b)))

          return (
            <ToonCard key={section.key} delay={0} className="!p-0 overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-astound-mist/40 transition-colors text-left"
                aria-expanded={sectionOpen}
              >
                <span
                  className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center text-lg shadow-sm flex-shrink-0"
                  aria-hidden="true"
                >
                  📂
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-extrabold text-toon-navy text-base truncate">
                    {section.label}
                  </div>
                  <div className="text-xs text-gray-500">
                    {section.rows.length} run{section.rows.length === 1 ? '' : 's'}
                    {agentsInSection.length > 0 && (
                      <> · {agentsInSection.length} agent{agentsInSection.length === 1 ? '' : 's'}</>
                    )}
                    {hasAgentFilter && (
                      <span className="ml-1 text-astound-violet font-bold">
                        · filter active ({visibleRows.length} shown)
                      </span>
                    )}
                  </div>
                </div>
                <motion.span
                  animate={{ rotate: sectionOpen ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-gray-400 flex-shrink-0"
                  aria-hidden="true"
                >
                  ▶
                </motion.span>
              </button>

              <AnimatePresence initial={false}>
                {sectionOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="overflow-hidden border-t border-violet-100"
                  >
                    {agentsInSection.length > 1 && (
                      <div
                        className="flex flex-wrap items-center gap-1.5 px-5 py-3 border-b border-violet-100/60 bg-violet-50/30"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500 mr-1">
                          Filter by agent
                        </span>
                        <button
                          type="button"
                          onClick={() => clearAgentsInSection(section.key)}
                          className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                            !hasAgentFilter
                              ? 'bg-astound-violet text-white border-astound-violet'
                              : 'bg-white text-gray-600 border-gray-300 hover:border-astound-violet hover:text-astound-violet'
                          }`}
                          title="Clear this section's agent filter"
                        >
                          All ({section.rows.length})
                        </button>
                        {agentsInSection.map((slug) => {
                          const selected = !!activeAgentFilter?.has(slug)
                          const count = section.rows.filter(
                            (r) => (r.agent || '(unknown)') === slug,
                          ).length
                          return (
                            <button
                              key={slug}
                              type="button"
                              onClick={() => toggleAgentInSection(section.key, slug)}
                              className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors inline-flex items-center gap-1 ${
                                selected
                                  ? 'bg-astound-violet text-white border-astound-violet'
                                  : 'bg-white text-toon-navy border-gray-300 hover:border-astound-violet hover:text-astound-violet'
                              }`}
                              title={`Show only ${agentLabel(slug)} runs in this section`}
                            >
                              <span aria-hidden="true">{agentIcon(slug)}</span>
                              <span>{agentLabel(slug)}</span>
                              <span className="opacity-60 tabular-nums">({count})</span>
                            </button>
                          )
                        })}
                      </div>
                    )}

                    <div className="px-5 py-3 space-y-2">
                      {visibleRows.length === 0 ? (
                        <p className="text-center text-sm text-gray-400 py-4">
                          {hasAgentFilter
                            ? 'No runs match the active filter in this project.'
                            : 'No runs to show.'}
                        </p>
                      ) : (
                        visibleRows.map((rec, i) => {
                          const rowKey = `${section.key}::${rec.ts || ''}::${i}`
                          return renderRow(rec, rowKey)
                        })
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </ToonCard>
          )
        })}

        {records.length === 0 && (
          <p className="text-center text-gray-400 py-8">
            No history yet. Run an agent to see results here.
          </p>
        )}
        {records.length > 0 && searchQuery.trim() && filteredCount === 0 && (
          <p className="text-center text-gray-400 py-8">
            No runs match "{searchQuery.trim()}". Try a different Jira key,
            agent name, or clear the search to see everything.
          </p>
        )}
      </div>

      <ExportColumnPicker
        open={!!picker}
        tables={picker?.tables || []}
        format={picker?.format}
        onCancel={() => setPicker(null)}
        onConfirm={(selected) => {
          const p = picker
          setPicker(null)
          if (p) performDownloadExport(p.format, p.content, p.agentName, selected)
        }}
      />
    </div>
  )
}
