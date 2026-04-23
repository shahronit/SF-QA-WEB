import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import MarkdownTableCell from '../components/markdown/MarkdownTableCell'
import MarkdownTableScroll from '../components/markdown/MarkdownTableScroll'
import toast from 'react-hot-toast'
import api from '../api/client'
import PageHeader from '../components/PageHeader'
import ReportPanel from '../components/ReportPanel'
import ProjectContextPicker from '../components/ProjectContextPicker'
import { useJira } from '../context/JiraContext'
import { useAgentResults } from '../context/AgentResultsContext'
import { STLC_PACK_AGENTS, getAgent } from '../config/agentMeta'
import { Stagger, StaggerItem } from '../components/motion/Stagger'
import GeneratingScene from '../components/motion/GeneratingScene'
import { extractJiraKey } from '../utils/jiraDetect'
import { useQaMode, QA_MODE_OPTIONS } from '../hooks/useQaMode'

const PHASE_LABELS = {
  requirement: { phase: 'Phase 1', short: 'Requirements Analysis' },
  test_plan: { phase: 'Phase 2', short: 'Test Plan Documentation' },
  testcase: { phase: 'Phase 3', short: 'Test Case Development' },
  exec_report: { phase: 'Phase 4', short: 'Test Execution Report' },
  closure_report: { phase: 'Phase 5', short: 'Test Closure Report' },
}

const STLC_MD_COMPONENTS = { td: MarkdownTableCell, table: MarkdownTableScroll }

const STATUSES = {
  idle: { dot: 'bg-gray-300', ring: 'ring-gray-200', text: 'Queued' },
  running: { dot: 'bg-toon-blue animate-pulse', ring: 'ring-toon-blue/40', text: 'Running…' },
  done: { dot: 'bg-toon-mint', ring: 'ring-toon-mint/40', text: 'Done' },
  error: { dot: 'bg-toon-coral', ring: 'ring-toon-coral/40', text: 'Error' },
}

function PhaseStep({ agent, index, total, status, content, expanded, onToggle }) {
  const meta = getAgent(agent)
  const phase = PHASE_LABELS[agent]
  const styles = STATUSES[status] || STATUSES.idle
  return (
    <motion.div
      layout
      className={`relative bg-white rounded-2xl border-2 ${status === 'done' ? 'border-toon-mint/40' : status === 'running' ? 'border-toon-blue/40' : 'border-gray-200'} p-4 shadow-toon transition-colors`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta?.gradient || 'from-gray-300 to-gray-400'} flex items-center justify-center text-white text-lg shadow-md`}>
          {meta?.icon || '✨'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold tracking-wider text-gray-400 uppercase">
              {phase?.phase || `Step ${index}`} • {index}/{total}
            </span>
            <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${styles.ring} bg-white`}>
              <span className={`w-1.5 h-1.5 rounded-full ${styles.dot}`} />
              {styles.text}
            </span>
          </div>
          <h3 className="font-extrabold text-toon-navy">{meta?.label || agent}</h3>
        </div>
        {content && (
          <button
            onClick={onToggle}
            className="text-xs font-bold text-toon-blue hover:underline"
          >
            {expanded ? 'Hide preview' : 'Show preview'}
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && content && (
          <motion.div
            key="preview"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mt-3 max-h-72 overflow-y-auto overflow-x-hidden bg-gray-50 rounded-xl p-3 border border-gray-200 markdown-body text-sm"
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={STLC_MD_COMPONENTS}>
              {content.length > 4000
                ? content.slice(0, 4000) + '\n\n_…(truncated, full report below)_'
                : content}
            </ReactMarkdown>
          </motion.div>
        )}
      </AnimatePresence>

      {/* connector line to the next step */}
      {index < total && (
        <div className="absolute left-9 -bottom-3 w-0.5 h-3 bg-gray-200" aria-hidden />
      )}
    </motion.div>
  )
}

function parseSseStream(text) {
  // Split a buffer into complete SSE frames; returns [events, leftover].
  // Normalise CRLF (sse_starlette emits \r\n) so we can split on '\n\n'.
  const norm = text.replace(/\r\n/g, '\n')
  const frames = []
  let cursor = 0
  while (true) {
    const sep = norm.indexOf('\n\n', cursor)
    if (sep === -1) break
    const raw = norm.slice(cursor, sep)
    cursor = sep + 2
    let event = 'message'
    const dataLines = []
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length) {
      try {
        frames.push({ event, data: JSON.parse(dataLines.join('\n')) })
      } catch {
        // ignore malformed frame
      }
    }
  }
  return [frames, norm.slice(cursor)]
}

export default function StlcPack() {
  const { connected: jiraConnected } = useJira()
  const { saveResult } = useAgentResults()
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState('')
  const [jiraInput, setJiraInput] = useState('')
  const [userStory, setUserStory] = useState('')
  const [running, setRunning] = useState(false)
  const [statuses, setStatuses] = useState(() => Object.fromEntries(STLC_PACK_AGENTS.map(a => [a, 'idle'])))
  const [outputs, setOutputs] = useState({})
  const [expanded, setExpanded] = useState({})
  const [combined, setCombined] = useState('')
  const [packId, setPackId] = useState('')
  const [qaMode, setQaMode] = useQaMode()
  const abortRef = useRef(null)

  const fetchProjects = useCallback(() => {
    api.get('/projects/').then(({ data }) => setProjects(data.projects || [])).catch(() => {})
  }, [])

  useEffect(() => {
    fetchProjects()
    const onProjectsUpdated = () => fetchProjects()
    const onFocus = () => fetchProjects()
    window.addEventListener('qa:projects-updated', onProjectsUpdated)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('qa:projects-updated', onProjectsUpdated)
      window.removeEventListener('focus', onFocus)
    }
  }, [fetchProjects])

  const detectedKey = useMemo(() => extractJiraKey(jiraInput), [jiraInput])
  const canRun = !running && (jiraInput.trim().length > 0 || userStory.trim().length > 0)

  const reset = () => {
    if (running) return
    setStatuses(Object.fromEntries(STLC_PACK_AGENTS.map(a => [a, 'idle'])))
    setOutputs({})
    setExpanded({})
    setCombined('')
    setPackId('')
    setJiraInput('')
    setUserStory('')
    setSelectedProject('')
  }

  const handleRun = async () => {
    if (!canRun) return
    setRunning(true)
    setStatuses(Object.fromEntries(STLC_PACK_AGENTS.map(a => [a, 'idle'])))
    setOutputs({})
    setCombined('')
    setPackId('')
    const controller = new AbortController()
    abortRef.current = controller
    const accumulator = {}

    try {
      const token = localStorage.getItem('token') || ''
      const resp = await fetch('/api/stlc/run', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({
          user_story: userStory || null,
          jira_key_or_url: jiraInput || null,
          project_slug: selectedProject || null,
          qa_mode: qaMode,
        }),
      })
      if (!resp.ok || !resp.body) {
        const detail = await resp.text().catch(() => '')
        throw new Error(detail || `HTTP ${resp.status}`)
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const [frames, leftover] = parseSseStream(buffer)
        buffer = leftover
        for (const frame of frames) {
          if (frame.event === 'pack_start') {
            setPackId(frame.data.pack_id)
          } else if (frame.event === 'agent_start') {
            setStatuses(prev => ({ ...prev, [frame.data.agent]: 'running' }))
            setExpanded(prev => ({ ...prev, [frame.data.agent]: true }))
            accumulator[frame.data.agent] = ''
          } else if (frame.event === 'token') {
            accumulator[frame.data.agent] = (accumulator[frame.data.agent] || '') + (frame.data.text || '')
            setOutputs({ ...accumulator })
          } else if (frame.event === 'agent_done') {
            accumulator[frame.data.agent] = frame.data.content || accumulator[frame.data.agent] || ''
            setOutputs({ ...accumulator })
            setStatuses(prev => ({ ...prev, [frame.data.agent]: 'done' }))
            if (accumulator[frame.data.agent]) {
              saveResult(frame.data.agent, accumulator[frame.data.agent])
            }
          } else if (frame.event === 'agent_error') {
            setStatuses(prev => ({ ...prev, [frame.data.agent]: 'error' }))
          } else if (frame.event === 'pack_done') {
            setCombined(frame.data.combined_markdown || '')
            toast.success('STLC pack generated!')
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast.error(err.message || 'STLC pack failed')
      }
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  return (
    <div>
      <PageHeader agentName="stlc_pack" />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="toon-card mb-6"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-lg shadow-md">
            🚀
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-extrabold text-toon-navy">Run the full STLC pack</h2>
            <p className="text-sm text-gray-500">
              One click runs Requirements → Plan → Cases → Execution → Closure with chained context.
            </p>
          </div>
          {jiraConnected ? (
            <span className="text-[11px] font-bold text-toon-mint bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              Jira connected
            </span>
          ) : (
            <span className="text-[11px] font-bold text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">
              Jira disconnected — paste user story instead
            </span>
          )}
        </div>

        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 bg-gray-50 rounded-2xl p-3 border border-gray-200">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-toon-purple to-violet-500 flex items-center justify-center text-white text-sm shadow-toon">
              🎚️
            </span>
            <div>
              <div className="text-sm font-bold text-toon-navy">QA Mode</div>
              <div className="text-xs text-gray-500">
                {qaMode === 'salesforce'
                  ? 'All five phases will use Salesforce conventions.'
                  : 'All five phases will be product-agnostic (no Salesforce terms).'}
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
                  disabled={running}
                  aria-pressed={active}
                  className={`relative px-4 py-1.5 rounded-xl text-sm font-bold transition-colors ${
                    active ? 'text-white' : 'text-gray-600 hover:text-toon-navy'
                  } ${running ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {active && (
                    <motion.span
                      layoutId="stlc-pack-qa-mode"
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-bold text-toon-navy mb-1.5 block">
              Project (for RAG context)
            </label>
            <ProjectContextPicker
              projects={projects}
              value={selectedProject}
              onChange={setSelectedProject}
              onProjectsChanged={fetchProjects}
              variant="compact"
              disabled={running}
            />
          </div>
          <div>
            <label className="text-sm font-bold text-toon-navy mb-1.5 block">
              Jira key or URL <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              className="toon-input"
              placeholder="ABC-123 or https://acme.atlassian.net/browse/ABC-123"
              value={jiraInput}
              onChange={(e) => setJiraInput(e.target.value)}
              disabled={running}
            />
            {detectedKey && (
              <div className="mt-1.5 text-xs font-bold text-violet-600">
                Detected: {detectedKey}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm font-bold text-toon-navy mb-1.5 block">
            User story / additional context <span className="text-gray-400 font-normal">(optional if Jira key supplied)</span>
          </label>
          <textarea
            className="toon-textarea"
            rows={5}
            placeholder="As a… I want… So that… (or paste extra requirements that should drive the pack)"
            value={userStory}
            onChange={(e) => setUserStory(e.target.value)}
            disabled={running}
          />
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          <motion.button
            whileTap={{ scale: 0.97 }}
            whileHover={canRun ? { y: -2 } : {}}
            onClick={handleRun}
            disabled={!canRun}
            className={`px-5 py-2.5 rounded-2xl font-extrabold text-white transition-all shadow-toon ${
              canRun
                ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:shadow-lg cursor-pointer'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {running ? '⏳ Running…' : '🚀 Generate STLC pack'}
          </motion.button>
          <button
            onClick={reset}
            disabled={running}
            className="px-5 py-2.5 rounded-2xl font-bold border-2 border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </motion.div>

      {/* "Boy on a laptop" 3D-styled waiting scene — shown for the
          whole STLC pack run. Big version appears as soon as the user
          clicks Generate and stays until the first phase produces
          output; after that it shrinks to a compact "still working"
          banner so the per-phase progress remains the focus. */}
      <AnimatePresence mode="wait">
        {running && Object.keys(outputs).length === 0 && (
          <div key="stlc-hero-scene" className="mb-6">
            <GeneratingScene size="lg" caption="Running your STLC pack…" />
          </div>
        )}
      </AnimatePresence>

      {running && Object.keys(outputs).length > 0 && (
        <div className="mb-4">
          <GeneratingScene
            size="sm"
            caption="Still running…"
            subCaption="The next phase will start as soon as the current one finishes."
          />
        </div>
      )}

      <Stagger className="space-y-4 mb-6" staggerChildren={0.05}>
        {STLC_PACK_AGENTS.map((agent, i) => (
          <StaggerItem key={agent}>
            <PhaseStep
              agent={agent}
              index={i + 1}
              total={STLC_PACK_AGENTS.length}
              status={statuses[agent]}
              content={outputs[agent]}
              expanded={!!expanded[agent]}
              onToggle={() => setExpanded(prev => ({ ...prev, [agent]: !prev[agent] }))}
            />
          </StaggerItem>
        ))}
      </Stagger>

      {combined && (
        <ReportPanel
          content={combined}
          agentName="stlc_pack"
          sheetTitle={`STLC Pack ${packId ? packId.slice(0, 8) : ''}`}
          stamp={packId || 'pack'}
        />
      )}
    </div>
  )
}
