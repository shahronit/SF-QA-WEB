import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../api/client'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import ToonCard from '../components/ToonCard'

const AGENT_LABELS = {
  requirement: '📝 Requirements',
  testcase: '🧪 Test Cases',
  bug_report: '🐛 Bug Reports',
  smoke: '💨 Smoke Tests',
  regression: '🔄 Regression',
  estimation: '📊 Estimation',
}

export default function History() {
  const [records, setRecords] = useState([])
  const [agentFilter, setAgentFilter] = useState('')
  const [expanded, setExpanded] = useState(null)

  const load = async () => {
    try {
      const { data } = await api.get('/history/', { params: { agent: agentFilter } })
      setRecords(data.records || [])
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [agentFilter])

  const clearAll = async () => {
    await api.delete('/history/')
    toast.success('History cleared')
    setRecords([])
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-toon-navy">{label}</span>
                  {rec.project && <span className="toon-badge bg-toon-blue/10 text-toon-blue text-xs">📂 {rec.project}</span>}
                </div>
                <span className="text-xs text-gray-400">{ts}</span>
              </div>
              {isOpen && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="mt-4">
                  <div className="bg-gray-50 rounded-2xl p-4 max-h-96 overflow-auto">
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{rec.output || rec.output_preview || 'No output'}</ReactMarkdown>
                    </div>
                  </div>
                </motion.div>
              )}
            </ToonCard>
          )
        })}
        {records.length === 0 && <p className="text-center text-gray-400 py-8">No history yet. Run an agent to see results here.</p>}
      </div>
    </div>
  )
}
