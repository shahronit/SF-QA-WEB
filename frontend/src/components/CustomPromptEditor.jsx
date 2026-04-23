import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/client'
import { useQaMode } from '../hooks/useQaMode'

const MAX_LEN = 32_000

// Mode-scoped storage keys so the user's Salesforce-mode override does not leak
// into General-mode runs (and vice-versa). Each (agent, mode) pair keeps its
// own draft and toggle state.
const promptKey = (agentName, qaMode) =>
  `qa-studio:custom-prompt:${agentName}:${qaMode}`
const toggleKey = (agentName, qaMode) =>
  `qa-studio:custom-prompt-on:${agentName}:${qaMode}`

/**
 * Per-agent, per-mode system prompt customizer. Lazy-fetches the default
 * prompt for the active QA mode, lets the user peek at it (collapsible,
 * read-only), and — when the toggle is ON — exposes an editable textarea
 * whose contents persist to localStorage so they survive reloads, tab
 * closes, and days of use on the same device. The default prompt on
 * disk is never modified.
 *
 * Calls `onChange(promptOrNull)` whenever the effective override
 * changes — debounced 300 ms while typing, immediate on toggle/reset/
 * mode switch.
 */
export default function CustomPromptEditor({ agentName, onChange }) {
  const [qaMode] = useQaMode()
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [enabled, setEnabled] = useState(false)
  const [draft, setDraft] = useState('')
  const debounceRef = useRef(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Lazy fetch the baked-in prompt once per (agent, mode). We don't cache
  // it longer because the agent's default text could change with a deploy
  // and we want the read-only "View default" view to reflect that. Re-runs
  // when the user flips the QA mode so the editor seed updates immediately.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .get(`/agents/${agentName}/prompt`, { params: { qa_mode: qaMode } })
      .then((res) => {
        if (cancelled) return
        const p = res.data?.prompt || ''
        setDefaultPrompt(p)
        const storedToggle =
          localStorage.getItem(toggleKey(agentName, qaMode)) === '1'
        const storedDraft = localStorage.getItem(promptKey(agentName, qaMode))
        setEnabled(storedToggle)
        setDraft(storedDraft != null ? storedDraft : p)
        if (storedToggle && storedDraft != null && storedDraft.trim()) {
          onChangeRef.current?.(storedDraft)
        } else {
          onChangeRef.current?.(null)
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e?.response?.data?.detail || e.message || 'Failed to load default prompt')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => {
      cancelled = true
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [agentName, qaMode])

  const fireOverride = (value) => {
    onChangeRef.current?.(value && value.trim() ? value : null)
  }

  const handleToggle = (next) => {
    setEnabled(next)
    if (next) {
      localStorage.setItem(toggleKey(agentName, qaMode), '1')
      // If the user previously cleared the draft, fall back to the default
      // so the textarea is never empty when they enable customization.
      const effective = draft && draft.trim() ? draft : defaultPrompt
      if (effective !== draft) setDraft(effective)
      fireOverride(effective)
    } else {
      localStorage.setItem(toggleKey(agentName, qaMode), '0')
      fireOverride(null)
    }
  }

  const handleDraftChange = (e) => {
    const value = e.target.value
    if (value.length > MAX_LEN) return
    setDraft(value)
    localStorage.setItem(promptKey(agentName, qaMode), value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (enabled) fireOverride(value)
    }, 300)
  }

  const handleReset = () => {
    setDraft(defaultPrompt)
    localStorage.removeItem(promptKey(agentName, qaMode))
    if (enabled) fireOverride(defaultPrompt)
  }

  const modeLabel = qaMode === 'general' ? 'General QA' : 'Salesforce QA'

  return (
    <div className="toon-card !p-4">
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-400 to-purple-500 flex items-center justify-center text-white text-sm shadow-toon">
          ✨
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div>
              <label className="block text-sm font-bold text-toon-navy">
                Customize System Prompt
                <span className="font-normal text-gray-400 ml-2">
                  (optional — overrides the default prompt for this session, on this device)
                </span>
              </label>
              <p className="text-xs text-gray-500 mt-0.5">
                Saved per QA mode in your browser. Active mode:{' '}
                <span className="font-semibold text-toon-navy">{modeLabel}</span>.
                The default prompt on the server is never changed.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <span className={`text-xs font-bold ${enabled ? 'text-toon-mint' : 'text-gray-400'}`}>
                {enabled ? 'ON' : 'OFF'}
              </span>
              <span className="relative inline-block w-11 h-6">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={enabled}
                  disabled={loading || !!error}
                  onChange={(e) => handleToggle(e.target.checked)}
                />
                <span className="absolute inset-0 rounded-full bg-gray-300 peer-checked:bg-toon-mint transition-colors" />
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
          </div>

          {error && (
            <div className="mt-2 text-xs text-toon-coral font-semibold">
              Couldn't load default prompt: {error}
            </div>
          )}

          {!enabled && !error && (
            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs font-semibold text-toon-blue hover:underline list-none flex items-center gap-1">
                <span className="transition-transform group-open:rotate-90">▶</span>
                View default {modeLabel} prompt (read-only)
              </summary>
              <pre className="mt-2 p-3 bg-gray-50 rounded-xl text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words border border-gray-200 max-h-72 overflow-auto">
                {loading ? 'Loading…' : defaultPrompt}
              </pre>
            </details>
          )}

          <AnimatePresence initial={false}>
            {enabled && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3">
                  <textarea
                    className="toon-input !py-2 font-mono text-xs leading-relaxed"
                    rows={10}
                    value={draft}
                    onChange={handleDraftChange}
                    placeholder={`Edit the ${modeLabel} system prompt that will be used for this agent…`}
                    spellCheck={false}
                  />
                  <div className="mt-1.5 flex items-center justify-between text-xs">
                    <button
                      type="button"
                      onClick={handleReset}
                      className="text-toon-blue hover:underline font-semibold"
                    >
                      Reset to default
                    </button>
                    <span className={draft.length > MAX_LEN * 0.9 ? 'text-toon-coral font-bold' : 'text-gray-400'}>
                      {draft.length.toLocaleString()} / {MAX_LEN.toLocaleString()}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
