import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MarkdownTableCell from '../components/markdown/MarkdownTableCell'
import MarkdownTableScroll from '../components/markdown/MarkdownTableScroll'
import api from '../api/client'
import toast from 'react-hot-toast'
import { useAuth } from '../context/AuthContext'
import PageHeader from '../components/PageHeader'
import ToonCard from '../components/ToonCard'
import TestManagementPush from '../components/TestManagementPush'
import JiraCommentPush from '../components/JiraCommentPush'
import ExportColumnPicker, { detectMarkdownTables } from '../components/ExportColumnPicker'

const PUSH_AGENTS = new Set(['testcase', 'smoke', 'regression'])
const JIRA_COMMENT_AGENTS = new Set(['requirement', 'exec_report', 'closure_report'])

const HISTORY_MD_COMPONENTS = { td: MarkdownTableCell, table: MarkdownTableScroll }

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

const AGENT_LABELS = {
  requirement: '📝 Requirements',
  testcase: '🧪 Test Cases',
  bug_report: '🐛 Bug Reports',
  smoke: '💨 Smoke Test Plan - Checklist',
  regression: '🔄 Regression Test Plan - Checklist',
  exec_report: '📈 Test Execution Report',
  closure_report: '🏁 Test Closure Report',
  estimation: '📊 Estimation',
}

export default function History() {
  const [records, setRecords] = useState([])
  const [agentFilter, setAgentFilter] = useState('')
  const [expanded, setExpanded] = useState(null)
  const { user } = useAuth()
  const isAdmin = !!user?.is_admin

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/history/', { params: { agent: agentFilter } })
      setRecords(data.records || [])
    } catch { /* ignore */ }
  }, [agentFilter])

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

  return (
    <div>
      <PageHeader icon="📜" title="History" subtitle="Browse past agent runs" gradient="from-violet-500 to-purple-400" />

      <div className="flex items-center gap-3 mb-6">
        <select className="toon-input w-auto" value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="">All agents</option>
          {Object.keys(AGENT_LABELS).map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <button onClick={clearAll} className="toon-btn toon-btn-coral text-sm py-2 px-4">🗑️ Clear All</button>
        <span className="text-sm text-gray-500 ml-auto">{records.length} runs</span>
      </div>

      <div className="space-y-3">
        {records.map((rec, i) => {
          const label = AGENT_LABELS[rec.agent] || rec.agent
          const ts = rec.ts?.slice(0, 19).replace('T', ' ') || ''
          const isOpen = expanded === i

          return (
            <ToonCard key={i} delay={0} className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : i)}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-bold text-toon-navy">{label}</span>
                  {rec.project && <span className="toon-badge bg-toon-blue/10 text-toon-blue text-xs">📂 {rec.project}</span>}
                  <HistoryUsageBadges rec={rec} isAdmin={isAdmin} />
                </div>
                <span className="text-xs text-gray-400">{ts}</span>
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
                          <JiraCommentPush markdown={md} agentName={rec.agent} defaultIssueKey="" />
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
            </ToonCard>
          )
        })}
        {records.length === 0 && <p className="text-center text-gray-400 py-8">No history yet. Run an agent to see results here.</p>}
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
