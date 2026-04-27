import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MarkdownTableCell from './markdown/MarkdownTableCell'
import MarkdownTableScroll from './markdown/MarkdownTableScroll'
import api from '../api/client'
import toast from 'react-hot-toast'
import { getAgent } from '../config/agentMeta'
import Sparkline from './motion/Sparkline'
import TestManagementPush from './TestManagementPush'
import JiraCommentPush from './JiraCommentPush'
import JiraBugPush from './JiraBugPush'
import ExportColumnPicker, { detectMarkdownTables } from './ExportColumnPicker'
import ExecutionBars from './insights/ExecutionBars'
import CoverageDonut from './insights/CoverageDonut'
import TechniqueCompare from './insights/TechniqueCompare'
import ClosureKpiGrid from './insights/ClosureKpiGrid'
import DataPreview from './insights/DataPreview'
import {
  parseExecutionMetrics,
  parseCoverage,
  parseTechniques,
  parseClosureKpi,
  parseDataPreview,
  buildSparklineFromText,
} from './insights/parsers'

const MD_COMPONENTS = { td: MarkdownTableCell, table: MarkdownTableScroll }

function useInsightAvailable(agentName, content) {
  return useMemo(() => {
    const meta = getAgent(agentName)
    const visual = meta?.visual || 'sparkline'
    if (!content) return { available: false, visual }
    switch (visual) {
      case 'execution_bars':
        return { available: !!parseExecutionMetrics(content), visual }
      case 'coverage_donut':
        return { available: !!parseCoverage(content), visual }
      case 'technique_compare':
        return { available: !!parseTechniques(content), visual }
      case 'closure_kpi':
        return { available: !!parseClosureKpi(content), visual }
      case 'data_preview':
        return { available: !!parseDataPreview(content), visual }
      case 'sparkline':
      default:
        return { available: content.length > 200, visual: 'sparkline' }
    }
  }, [agentName, content])
}

function Typewriter({ text, enabled = true, max = 600, duration = 600 }) {
  const reduce = useReducedMotion()
  const [shown, setShown] = useState(reduce || !enabled ? text : '')
  const rafRef = useRef(null)

  useEffect(() => {
    if (reduce || !enabled || !text) {
      setShown(text)
      return
    }
    const startAt = performance.now()
    const cap = Math.min(max, text.length)
    const restAt = cap < text.length ? cap : text.length
    const tick = (now) => {
      const t = Math.min(1, (now - startAt) / duration)
      const i = Math.floor(t * restAt)
      setShown(text.slice(0, i))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setShown(text)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [text, enabled, max, duration, reduce])

  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={MD_COMPONENTS}>{shown || text}</ReactMarkdown>
}

export default function ReportPanel({
  content,
  agentName,
  sheetTitle,
  stamp,
  loading = false,
  jiraContextKey = '',
}) {
  const [tab, setTab] = useState('formatted')
  const meta = getAgent(agentName)
  const { available: insightsAvailable, visual } = useInsightAvailable(agentName, content)
  const sparklineValues = useMemo(() => buildSparklineFromText(content), [content])

  useEffect(() => {
    if (tab === 'insights' && !insightsAvailable) setTab('formatted')
  }, [insightsAvailable, tab])

  // Pending export = the format the user clicked while the column picker
  // is open. We detect tables once per click rather than memoizing on
  // `content` so streaming reports don't constantly re-open the modal.
  const [pickerFormat, setPickerFormat] = useState(null)
  const [pickerTables, setPickerTables] = useState([])

  const performDownload = async (format, selectedColumns) => {
    try {
      const payload = { content, agent_name: agentName }
      if (selectedColumns && Object.keys(selectedColumns).length > 0) {
        payload.selected_columns = selectedColumns
      }
      const resp = await api.post(`/exports/${format}`, payload, { responseType: 'blob' })
      const ext = format === 'excel' ? 'xlsx'
        : format === 'markdown' ? 'md'
        : format === 'pdf' ? 'pdf'
        : 'csv'
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `QA_${agentName}_${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${format} file!`)
    } catch (err) {
      // The request used responseType:'blob', so error bodies arrive as a
      // Blob instead of parsed JSON. Read it back to surface the real
      // server-side reason ("Excel export failed: Invalid character …")
      // instead of an opaque "Download failed" toast.
      let message = `Download failed (${format})`
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
        /* ignore decode failures — fall back to default message */
      }
      toast.error(message)
    }
  }

  const download = (format) => {
    const tables = detectMarkdownTables(content)
    if (tables.length === 0) {
      // No tables — keep the original one-click behavior intact so prose
      // exports (e.g. test plans, summaries) don't suddenly grow a modal.
      return performDownload(format, null)
    }
    setPickerTables(tables)
    setPickerFormat(format)
  }

  const copyText = () => {
    navigator.clipboard.writeText(content)
    toast.success('Copied to clipboard!')
  }

  const tabs = [
    { id: 'formatted', label: '📖 Formatted' },
    ...(insightsAvailable ? [{ id: 'insights', label: '✨ Insights' }] : []),
    { id: 'raw', label: '📋 Raw Text' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="toon-card"
    >
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <motion.span
            className="w-8 h-8 rounded-xl bg-toon-mint text-white flex items-center justify-center text-sm shadow-toon-mint"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          >
            ✅
          </motion.span>
          <h3 className="font-extrabold text-toon-navy text-lg">Your Report</h3>
          {meta && (
            <span className="hidden sm:inline-block ml-2 text-[10px] uppercase tracking-wider font-bold text-gray-400">
              {meta.label}
            </span>
          )}
        </div>
        {sparklineValues.length > 0 && (
          <div className="hidden sm:block opacity-80">
            <Sparkline values={sparklineValues} width={140} height={36} color="#3b82f6" fill="rgba(59,130,246,0.15)" />
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-4 relative bg-gray-100 rounded-2xl p-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex-1 sm:flex-none px-4 py-2 rounded-xl text-sm font-bold transition-colors ${
              tab === t.id ? 'text-white' : 'text-gray-600 hover:text-toon-navy'
            }`}
          >
            {tab === t.id && (
              <motion.span
                layoutId="reportTab"
                className="absolute inset-0 bg-toon-blue rounded-xl shadow-sm"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="bg-gray-50 rounded-2xl p-5 mb-4 overflow-y-auto overflow-x-clip" style={{ maxHeight: '70vh' }}>
        {/* While streaming we render plain (no AnimatePresence / no
            Typewriter) so each new token only appends — there is no
            unmount, no re-typing animation, and therefore no flicker.
            Once the stream finishes, we keep the same plain renderer
            for the formatted view to avoid a final remount-blink; the
            user just sees the content settle. Tab switches still
            animate via the outer state change. */}
        {loading ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={MD_COMPONENTS}>{content}</ReactMarkdown>
            <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500">
              <span className="inline-flex items-center gap-1">
                {[0, 1, 2].map(i => (
                  <motion.span
                    key={i}
                    className="inline-block w-1.5 h-1.5 rounded-full bg-toon-blue"
                    animate={{ y: [0, -4, 0], opacity: [0.6, 1, 0.6] }}
                    transition={{ duration: 0.7, repeat: Infinity, delay: i * 0.12, ease: 'easeInOut' }}
                  />
                ))}
              </span>
              <span>Streaming…</span>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {tab === 'formatted' && (
              <motion.div
                key="formatted"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="markdown-body"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={MD_COMPONENTS}>{content}</ReactMarkdown>
              </motion.div>
            )}
            {tab === 'insights' && insightsAvailable && (
              <motion.div
                key="insights"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {visual === 'execution_bars' && <ExecutionBars content={content} />}
                {visual === 'coverage_donut' && <CoverageDonut content={content} />}
                {visual === 'technique_compare' && <TechniqueCompare content={content} />}
                {visual === 'closure_kpi' && <ClosureKpiGrid content={content} />}
                {visual === 'data_preview' && <DataPreview content={content} />}
                {visual === 'sparkline' && (
                  <div className="flex flex-col items-center gap-3 py-6">
                    <div className="text-xs uppercase tracking-wider font-bold text-gray-500">Content density</div>
                    <Sparkline values={sparklineValues} width={420} height={120} />
                  </div>
                )}
              </motion.div>
            )}
            {tab === 'raw' && (
              <motion.pre
                key="raw"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="whitespace-pre-wrap text-sm font-mono text-gray-700"
              >
                {content}
              </motion.pre>
            )}
          </AnimatePresence>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => download('excel')} className="toon-btn toon-btn-mint text-sm py-2 px-4">📊 Excel</button>
        <button onClick={() => download('csv')} className="toon-btn toon-btn-blue text-sm py-2 px-4">📋 CSV</button>
        <button onClick={() => download('pdf')} className="toon-btn toon-btn-coral text-sm py-2 px-4">📄 PDF</button>
        <button onClick={() => download('markdown')} className="toon-btn toon-btn-purple text-sm py-2 px-4">📝 Markdown</button>
        <button onClick={copyText} className="toon-btn bg-gray-400 hover:bg-gray-500 text-sm py-2 px-4">📑 Copy</button>
        <TestManagementPush markdown={content} agentName={agentName} defaultStoryKey={jiraContextKey} />
        <JiraCommentPush markdown={content} agentName={agentName} defaultIssueKey={jiraContextKey} />
        <JiraBugPush markdown={content} agentName={agentName} defaultIssueKey={jiraContextKey} />
      </div>
      <ExportColumnPicker
        open={!!pickerFormat}
        tables={pickerTables}
        format={pickerFormat}
        onCancel={() => setPickerFormat(null)}
        onConfirm={(selected) => {
          const fmt = pickerFormat
          setPickerFormat(null)
          if (fmt) performDownload(fmt, selected)
        }}
      />
    </motion.div>
  )
}
