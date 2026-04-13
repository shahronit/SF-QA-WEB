import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import api from '../api/client'
import ReportPanel from './ReportPanel'

export default function AgentForm({ agentName, fields, sheetTitle, extraInput = {} }) {
  const [values, setValues] = useState({})
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState('')

  useEffect(() => {
    api.get('/projects/').then(({ data }) => {
      setProjects(data.projects || [])
    }).catch(() => {})
  }, [])

  const handleChange = (key, val) => setValues(prev => ({ ...prev, [key]: val }))

  const visibleFields = fields.filter(f => f.type !== 'hidden')
  const requiredFields = fields.filter(f => f.required !== false && f.type !== 'hidden' && f.type !== 'select')

  const allRequiredFilled = requiredFields.every(f => values[f.key]?.trim?.())
  const canGenerate = allRequiredFilled && !loading

  const handleRun = async () => {
    if (!canGenerate) return
    setLoading(true)
    setResult('')
    try {
      const mergedInput = { ...values, ...extraInput }
      const resp = await api.post(`/agents/${agentName}/run`, {
        user_input: mergedInput,
        project_slug: selectedProject || null,
      })
      setResult(resp.data.result || '')
    } catch (err) {
      setResult(`**Error:** ${err.response?.data?.detail || err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = useCallback(() => {
    setValues({})
    setResult('')
    setSelectedProject('')
  }, [])

  const activeProject = projects.find(p => p.slug === selectedProject)

  return (
    <div className="space-y-6">
      {/* Project selector */}
      <div className="toon-card !p-4">
        <div className="flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-toon-blue flex items-center justify-center text-white text-sm shadow-toon">
            📂
          </span>
          <div className="flex-1">
            <label className="block text-sm font-bold text-toon-navy mb-1.5">
              Project Context
              <span className="font-normal text-gray-400 ml-2">(optional — scopes RAG to project docs)</span>
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

      {/* Form fields */}
      <div className="space-y-4">
        {visibleFields.map((field) => {
          const isRequired = field.required !== false && field.type !== 'select'
          return (
            <div key={field.key}>
              <label className="block text-sm font-bold text-toon-navy mb-1.5">
                {field.label}
                {isRequired && <span className="text-toon-coral ml-1">*</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  className="toon-textarea"
                  rows={field.rows || 4}
                  placeholder={field.placeholder || ''}
                  value={values[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                />
              ) : field.type === 'select' ? (
                <select
                  className="toon-input"
                  value={values[field.key] || field.options?.[0] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                >
                  {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input
                  type={field.type || 'text'}
                  className="toon-input"
                  placeholder={field.placeholder || ''}
                  value={values[field.key] || ''}
                  onChange={(e) => handleChange(field.key, e.target.value)}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <motion.button
          whileTap={canGenerate ? { scale: 0.95 } : {}}
          onClick={handleRun}
          disabled={!canGenerate}
          className={`toon-btn toon-btn-blue flex-1 text-lg transition-all ${
            !canGenerate ? 'opacity-40 cursor-not-allowed' : ''
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-bounce">✨</span> Generating...
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

      {result && (
        <ReportPanel content={result} agentName={agentName} sheetTitle={sheetTitle} />
      )}
    </div>
  )
}
