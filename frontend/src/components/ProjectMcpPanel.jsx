import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'

/**
 * Project-scoped MCP (Model Context Protocol) server panel.
 *
 * Lets the user list / add / toggle / delete the SSE-only MCP servers
 * the orchestrator will consult when running an agent in this project's
 * mode. The "Test" button hits the backend probe endpoint which lists
 * resources without subscribing to events, so it's cheap to call
 * repeatedly while iterating on a server URL.
 *
 * The whole panel collapses by default — most projects don't have any
 * MCP servers and the existing Projects page is already busy.
 */
export default function ProjectMcpPanel({ slug }) {
  const [open, setOpen] = useState(false)
  const [servers, setServers] = useState([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  // Headers are stored as raw JSON text so the user can type
  // whatever they want; we only validate JSON-shape on submit.
  const [form, setForm] = useState({ name: '', url: '', headers: '' })
  const [testResult, setTestResult] = useState({}) // { [serverId]: {ok, ...} }
  const [busyServer, setBusyServer] = useState({}) // { [serverId]: action }

  const refresh = async () => {
    setLoading(true)
    try {
      const { data } = await api.get(`/projects/${slug}/mcp/servers`)
      setServers(Array.isArray(data?.servers) ? data.servers : [])
    } catch (err) {
      // 404 here just means the project doesn't exist or we're not
      // authorized — surface a quiet error instead of a toast spam.
      const code = err?.response?.status
      if (code !== 404 && code !== 403) {
        toast.error(err?.response?.data?.detail || 'Failed to load MCP servers')
      }
      setServers([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && slug) refresh()
    // We deliberately depend on `open` so the first paint is cheap;
    // closing then re-opening fetches fresh state in case another tab
    // changed servers in the meantime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug])

  const submitAdd = async () => {
    const url = form.url.trim()
    if (!url) {
      toast.error('SSE URL is required')
      return
    }
    let headers = {}
    if (form.headers.trim()) {
      try {
        const parsed = JSON.parse(form.headers)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('Headers must be a JSON object')
        }
        headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [String(k), String(v)]))
      } catch (err) {
        toast.error(err.message || 'Headers must be valid JSON ({"Authorization": "Bearer ..."})')
        return
      }
    }
    setAdding(true)
    try {
      await api.post(`/projects/${slug}/mcp/servers`, {
        name: form.name.trim() || url,
        url,
        headers,
        enabled: true,
      })
      toast.success('MCP server added')
      setForm({ name: '', url: '', headers: '' })
      refresh()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to add MCP server')
    } finally {
      setAdding(false)
    }
  }

  const toggleEnabled = async (server) => {
    setBusyServer((p) => ({ ...p, [server.id]: 'toggle' }))
    try {
      await api.patch(`/projects/${slug}/mcp/servers/${server.id}`, {
        enabled: !server.enabled,
      })
      refresh()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Toggle failed')
    } finally {
      setBusyServer((p) => { const n = { ...p }; delete n[server.id]; return n })
    }
  }

  const deleteServer = async (server) => {
    if (!window.confirm(`Remove MCP server "${server.name || server.url}"?`)) return
    setBusyServer((p) => ({ ...p, [server.id]: 'delete' }))
    try {
      await api.delete(`/projects/${slug}/mcp/servers/${server.id}`)
      toast.success('MCP server removed')
      setTestResult((p) => { const n = { ...p }; delete n[server.id]; return n })
      refresh()
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Delete failed')
    } finally {
      setBusyServer((p) => { const n = { ...p }; delete n[server.id]; return n })
    }
  }

  const testServer = async (server) => {
    setBusyServer((p) => ({ ...p, [server.id]: 'test' }))
    setTestResult((p) => { const n = { ...p }; delete n[server.id]; return n })
    try {
      const { data } = await api.post(`/projects/${slug}/mcp/servers/${server.id}/test`)
      setTestResult((p) => ({ ...p, [server.id]: data }))
      if (data?.ok) toast.success(`Connected — ${data.resource_count ?? 0} resources`)
      else toast.error(data?.error || 'Connection failed')
    } catch (err) {
      const detail = err?.response?.data?.detail || err.message
      setTestResult((p) => ({ ...p, [server.id]: { ok: false, error: detail } }))
      toast.error(detail || 'Connection failed')
    } finally {
      setBusyServer((p) => { const n = { ...p }; delete n[server.id]; return n })
    }
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-bold text-toon-navy hover:text-toon-blue"
      >
        <span aria-hidden="true">🔌</span>
        <span>MCP context sources</span>
        <span className="text-gray-400 font-normal text-xs">
          ({servers.length} configured)
        </span>
        <span className={`text-xs text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-gray-500">
                MCP (Model Context Protocol) servers feed extra resources — wikis, code repos, internal knowledge bases — into RAG when you run an agent in this project. Only SSE URLs are supported. Failures from MCP servers are tolerated: a slow server won't block agent runs.
              </p>

              {loading ? (
                <div className="text-xs text-gray-400">Loading…</div>
              ) : servers.length === 0 ? (
                <div className="text-xs text-gray-400 italic">No MCP servers configured yet.</div>
              ) : (
                <ul className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
                  {servers.map((s) => {
                    const result = testResult[s.id]
                    const busy = busyServer[s.id]
                    return (
                      <li key={s.id} className="px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-2 h-2 rounded-full ${s.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                            <div className="min-w-0">
                              <div className="font-bold text-toon-navy truncate" title={s.name}>{s.name}</div>
                              <div className="text-[10px] text-gray-400 truncate" title={s.url}>{s.url}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => testServer(s)}
                              disabled={busy === 'test'}
                              className="text-[10px] uppercase tracking-wider font-bold text-toon-blue hover:underline disabled:text-gray-400"
                            >
                              {busy === 'test' ? 'testing…' : 'Test'}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleEnabled(s)}
                              disabled={busy === 'toggle'}
                              className="text-[10px] uppercase tracking-wider font-bold text-gray-500 hover:underline disabled:text-gray-400"
                            >
                              {s.enabled ? 'disable' : 'enable'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteServer(s)}
                              disabled={busy === 'delete'}
                              className="text-[10px] uppercase tracking-wider font-bold text-toon-coral hover:underline disabled:text-gray-400"
                            >
                              remove
                            </button>
                          </div>
                        </div>
                        {result && (
                          <div className="mt-1.5">
                            {result.ok ? (
                              <div className="flex flex-wrap gap-1 items-center">
                                <span className="text-[10px] text-emerald-700 font-semibold">
                                  ✓ {result.resource_count ?? 0} resource{result.resource_count === 1 ? '' : 's'}
                                </span>
                                {(result.sample || []).map((uri) => (
                                  <span key={uri} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 truncate max-w-[200px]" title={uri}>
                                    {uri}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="text-[10px] text-toon-coral break-all">✗ {result.error || 'Connection failed'}</div>
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-toon-navy">Add MCP server</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  <input
                    className="toon-input !py-2 text-xs"
                    placeholder="Display name (optional)"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  />
                  <input
                    className="toon-input !py-2 text-xs"
                    placeholder="SSE URL — e.g. https://mcp.example.com/sse"
                    value={form.url}
                    onChange={(e) => setForm((p) => ({ ...p, url: e.target.value }))}
                  />
                </div>
                <textarea
                  className="toon-input !py-2 text-xs font-mono min-h-[60px]"
                  placeholder='Headers JSON (optional) — e.g. {"Authorization": "Bearer ..."}'
                  value={form.headers}
                  onChange={(e) => setForm((p) => ({ ...p, headers: e.target.value }))}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={submitAdd}
                    disabled={adding || !form.url.trim()}
                    className="toon-btn toon-btn-blue text-xs py-1.5 px-3 disabled:opacity-50"
                  >
                    {adding ? 'Adding…' : '+ Add server'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
