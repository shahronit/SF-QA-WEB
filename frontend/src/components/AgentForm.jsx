import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/client'
import ReportPanel from './ReportPanel'
import { useAgentResults } from '../context/AgentResultsContext'
import { useJira } from '../context/JiraContext'
import JiraIssuePicker from './JiraIssuePicker'
import { Stagger, StaggerItem } from './motion/Stagger'
import Confetti from './motion/Confetti'
import { extractJiraKey } from '../utils/jiraDetect'

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

export default function AgentForm({ agentName, fields, sheetTitle, extraInput = {} }) {
  const [values, setValues] = useState({})
  const [result, setResult] = useState('')
  const [resultStamp, setResultStamp] = useState(0)
  const [loading, setLoading] = useState(false)
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState('')
  const [linkedAgent, setLinkedAgent] = useState('')
  const [showLinkedPreview, setShowLinkedPreview] = useState(false)
  const [shakeKeys, setShakeKeys] = useState({})
  const [confettiTrigger, setConfettiTrigger] = useState(0)

  const { saveResult, getAvailableResults } = useAgentResults()
  const availableResults = getAvailableResults(agentName)
  const { connected: jiraConnected, resolveFromText } = useJira()

  // Per-field set of Jira keys we have already auto-imported, so on-blur
  // doesn't re-fetch the same ticket every time the user clicks elsewhere.
  const importedKeysRef = useRef({})
  const [autoFetchedNotice, setAutoFetchedNotice] = useState({})

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

  const selectedLinked = availableResults.find(r => r.name === linkedAgent)

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
    try {
      const mergedInput = { ...values, ...extraInput }
      if (selectedLinked) {
        mergedInput.linked_output = selectedLinked.content
      }
      const resp = await api.post(`/agents/${agentName}/run`, {
        user_input: mergedInput,
        project_slug: selectedProject || null,
      })
      const output = resp.data.result || ''
      setResult(output)
      setResultStamp(Date.now())
      if (output && !output.startsWith('**Error')) {
        saveResult(agentName, output)
        setConfettiTrigger(t => t + 1)
      }
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
      const textareaFields = visibleFields.filter(f => f.type === 'textarea')
      const textFields = visibleFields.filter(f => f.type !== 'textarea' && f.type !== 'select')
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
  }, [visibleFields])

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

      {/* Jira issue picker (only when connected) */}
      {jiraConnected && <JiraIssuePicker onImport={handleJiraImport} />}

      {/* Linked output selector */}
      {availableResults.length > 0 && (
        <div className="toon-card !p-4">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white text-sm shadow-toon">
              🔗
            </span>
            <div className="flex-1">
              <label className="block text-sm font-bold text-toon-navy mb-1.5">
                Link Previous Agent Output
                <span className="font-normal text-gray-400 ml-2">(optional — chain results from another agent)</span>
              </label>
              <select
                className="toon-input !py-2"
                value={linkedAgent}
                onChange={e => { setLinkedAgent(e.target.value); setShowLinkedPreview(false) }}
              >
                <option value="">— No linked output —</option>
                {availableResults.map(r => (
                  <option key={r.name} value={r.name}>
                    {r.label} ({timeAgo(r.timestamp)})
                  </option>
                ))}
              </select>
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
                    <pre className="mt-2 p-3 bg-gray-50 rounded-xl text-xs text-gray-600 max-h-40 overflow-auto whitespace-pre-wrap border border-gray-200">
                      {selectedLinked.content.slice(0, 2000)}
                      {selectedLinked.content.length > 2000 && '\n\n... (truncated)'}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* Form fields */}
      <Stagger className="space-y-4" delayChildren={0.1} staggerChildren={0.05}>
        {visibleFields.map((field) => {
          const isRequired = field.required !== false && field.type !== 'select'
          const shakeStamp = shakeKeys[field.key]
          return (
            <StaggerItem key={field.key}>
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
                    value={values[field.key] || field.options?.[0] || ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                  >
                    {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
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
            </StaggerItem>
          )
        })}
      </Stagger>

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

      <Confetti trigger={confettiTrigger} />

      <AnimatePresence mode="wait">
        {result && (
          <motion.div
            key={resultStamp || 'result'}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <ReportPanel content={result} agentName={agentName} sheetTitle={sheetTitle} stamp={resultStamp} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
