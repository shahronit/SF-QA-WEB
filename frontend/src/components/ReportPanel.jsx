import { useState } from 'react'
import { motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../api/client'
import toast from 'react-hot-toast'

export default function ReportPanel({ content, agentName, sheetTitle }) {
  const [tab, setTab] = useState('formatted')

  const download = async (format) => {
    try {
      const resp = await api.post(`/exports/${format}`, { content, agent_name: agentName }, { responseType: 'blob' })
      const ext = format === 'excel' ? 'xlsx' : format === 'markdown' ? 'md' : 'csv'
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `QA_${agentName}_${Date.now()}.${ext}`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Downloaded ${format} file!`)
    } catch {
      toast.error('Download failed')
    }
  }

  const copyText = () => {
    navigator.clipboard.writeText(content)
    toast.success('Copied to clipboard!')
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="toon-card mt-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="w-8 h-8 rounded-xl bg-toon-mint text-white flex items-center justify-center text-sm">✅</span>
        <h3 className="font-extrabold text-toon-navy text-lg">Your Report</h3>
      </div>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('formatted')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'formatted' ? 'bg-toon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          📖 Formatted
        </button>
        <button onClick={() => setTab('raw')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${tab === 'raw' ? 'bg-toon-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          📋 Raw Text
        </button>
      </div>

      <div className="bg-gray-50 rounded-2xl p-5 mb-4 overflow-auto" style={{ maxHeight: '70vh' }}>
        {tab === 'formatted' ? (
          <div className="markdown-body table-wrap">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap text-sm font-mono text-gray-700">{content}</pre>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => download('excel')} className="toon-btn toon-btn-mint text-sm py-2 px-4">📊 Excel</button>
        <button onClick={() => download('csv')} className="toon-btn toon-btn-blue text-sm py-2 px-4">📋 CSV</button>
        <button onClick={() => download('markdown')} className="toon-btn toon-btn-purple text-sm py-2 px-4">📝 Markdown</button>
        <button onClick={copyText} className="toon-btn bg-gray-400 hover:bg-gray-500 text-sm py-2 px-4">📄 Copy</button>
      </div>
    </motion.div>
  )
}
