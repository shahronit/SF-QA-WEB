import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Reusable Server-Sent Events consumer for the per-agent streaming
 * endpoint at ``POST /api/agents/{agentName}/stream``.
 *
 * Behaviour mirrors the inline parser in ``AgentForm.jsx`` exactly, so
 * pages that use this hook get identical token / usage / error / done
 * semantics — including auth header, CRLF normalisation, blank-line
 * frame splitting, and runMeta capture from the ``usage`` event.
 *
 * Crucially, this hook owns its own ``AbortController`` so callers can
 * spin up many concurrent streams (the Quick Pack page does one per
 * accessible agent) and tear them all down cleanly when the user
 * navigates away or starts a fresh run.
 *
 * Returned shape:
 *   {
 *     status,    // 'idle' | 'loading' | 'done' | 'error'
 *     content,   // accumulated streamed markdown
 *     runMeta,   // { provider, model, cached, repaired, usage } | null
 *     error,     // human-readable error message string | null
 *     start,     // (input) => Promise<{ content, runMeta, errored }>
 *     abort,     // () => void  (no-op when nothing is in-flight)
 *     reset,     // () => void  (clears content + status back to idle)
 *   }
 */
export function useAgentStream({ agentName, projectSlug = null } = {}) {
  const [status, setStatus] = useState('idle')
  const [content, setContent] = useState('')
  const [runMeta, setRunMeta] = useState(null)
  const [error, setError] = useState(null)

  const abortRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) {
        try { abortRef.current.abort() } catch { /* ignore */ }
        abortRef.current = null
      }
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setContent('')
    setRunMeta(null)
    setError(null)
  }, [])

  const abort = useCallback(() => {
    if (abortRef.current) {
      try { abortRef.current.abort() } catch { /* ignore */ }
      abortRef.current = null
    }
  }, [])

  const start = useCallback(async (input) => {
    if (!agentName) {
      throw new Error('useAgentStream: agentName is required')
    }
    if (abortRef.current) {
      try { abortRef.current.abort() } catch { /* ignore */ }
    }
    const controller = new AbortController()
    abortRef.current = controller

    setStatus('loading')
    setContent('')
    setRunMeta(null)
    setError(null)

    let accumulated = ''
    let errored = false
    let latestMeta = null
    const userInput = (input && input.user_input) || {}
    const systemPromptOverride = input?.system_prompt_override || null
    const projectFromInput = input && Object.prototype.hasOwnProperty.call(input, 'project_slug')
      ? input.project_slug
      : projectSlug

    try {
      const token = (() => {
        try { return localStorage.getItem('token') } catch { return null }
      })()
      const resp = await fetch(`/api/agents/${agentName}/stream`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          user_input: userInput,
          project_slug: projectFromInput || null,
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
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
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
            if (mountedRef.current) setContent(accumulated)
          } else if (event === 'usage') {
            const nextMeta = {
              provider: payload.provider || null,
              model: payload.model || null,
              cached: !!payload.cached,
              repaired: !!payload.repaired,
              usage: payload.usage || null,
            }
            latestMeta = nextMeta
            if (mountedRef.current) setRunMeta(nextMeta)
          } else if (event === 'error') {
            errored = true
            const msg = payload.error || 'Unknown error'
            accumulated = accumulated
              ? `${accumulated}\n\n**Error:** ${msg}`
              : `**Error:** ${msg}`
            if (mountedRef.current) {
              setContent(accumulated)
              setError(msg)
            }
          } else if (event === 'done') {
            // Loop will end naturally once the reader finishes.
          }
        }
      }
    } catch (err) {
      // Aborts are a normal teardown signal (route change / fresh run);
      // don't surface them as user-facing errors.
      if (err?.name === 'AbortError') {
        if (mountedRef.current) setStatus('idle')
        if (abortRef.current === controller) abortRef.current = null
        return { content: accumulated, runMeta: latestMeta, errored: false, aborted: true }
      }
      errored = true
      const msg = err?.message || String(err)
      accumulated = accumulated
        ? `${accumulated}\n\n**Error:** ${msg}`
        : `**Error:** ${msg}`
      if (mountedRef.current) {
        setContent(accumulated)
        setError(msg)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }

    if (mountedRef.current) {
      setStatus(errored || accumulated.startsWith('**Error') ? 'error' : 'done')
    }
    return { content: accumulated, runMeta: latestMeta, errored }
  }, [agentName, projectSlug])

  return { status, content, runMeta, error, start, abort, reset }
}

export default useAgentStream
