import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import api from '../api/client'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import ToonCard from '../components/ToonCard'
import { useAuth } from '../context/AuthContext'

const ACCEPT = '.pdf,.docx,.doc,.csv,.txt,.xlsx,.json,.md'

export default function Projects() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [openShare, setOpenShare] = useState({})
  const [shareTarget, setShareTarget] = useState({})
  // Per-project re-index state: 'idle' | 'indexing' | 'done' | 'error'.
  const [indexStatus, setIndexStatus] = useState({})

  // Load the visible projects and hydrate each with its document list +
  // indexed flag in parallel so every card can render its docs immediately.
  const load = async () => {
    try {
      const { data } = await api.get('/projects/')
      const list = data.projects || []
      const detailed = await Promise.all(
        list.map(async (p) => {
          try {
            const { data: detail } = await api.get(`/projects/${p.slug}`)
            return {
              ...p,
              documents: Array.isArray(detail.documents) ? detail.documents : [],
              indexed: !!detail.indexed,
            }
          } catch {
            return { ...p, documents: [], indexed: false }
          }
        }),
      )
      setProjects(detailed)
      window.dispatchEvent(new CustomEvent('qa:projects-updated'))
    } catch { /* ignore */ }
  }

  const loadUsers = async () => {
    try {
      const { data } = await api.get('/auth/users')
      setAllUsers(data.users || [])
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); loadUsers() }, [])

  const create = async () => {
    if (!newName.trim()) return
    try {
      await api.post('/projects/', { name: newName, description: newDesc })
      setNewName(''); setNewDesc('')
      toast.success('Project created!')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  const triggerReindex = async (slug) => {
    setIndexStatus((prev) => ({ ...prev, [slug]: 'indexing' }))
    try {
      const { data } = await api.post(`/projects/${slug}/build-index`)
      setIndexStatus((prev) => ({ ...prev, [slug]: 'done' }))
      const chunks = typeof data?.chunks === 'number' ? data.chunks : null
      toast.success(chunks != null ? `Indexed ${chunks} chunks` : 'Project re-indexed')
    } catch (err) {
      setIndexStatus((prev) => ({ ...prev, [slug]: 'error' }))
      toast.error(err?.response?.data?.detail || 'Re-indexing failed')
    }
  }

  const uploadFiles = (slug) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ACCEPT
    input.onchange = async () => {
      const files = Array.from(input.files || [])
      if (!files.length) return
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))
      const tid = toast.loading(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`)
      try {
        await api.post(`/projects/${slug}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        toast.success(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`, { id: tid })
        await load()
        // Auto re-index so RAG reflects the new docs without a manual click.
        triggerReindex(slug)
      } catch (err) {
        toast.error(err?.response?.data?.detail || 'Upload failed', { id: tid })
      }
    }
    input.click()
  }

  const removeDocument = async (slug, filename) => {
    if (!window.confirm(`Remove "${filename}" from this project?`)) return
    const tid = toast.loading(`Removing ${filename}…`)
    try {
      await api.delete(`/projects/${slug}/documents/${encodeURIComponent(filename)}`)
      toast.success(`Removed ${filename}`, { id: tid })
      await load()
      triggerReindex(slug)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Delete failed', { id: tid })
    }
  }

  const buildIndex = (slug) => triggerReindex(slug)

  const deleteProject = async (slug) => {
    if (!confirm('Delete this project?')) return
    try {
      await api.delete(`/projects/${slug}`)
      toast.success('Project deleted')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  const share = async (slug) => {
    const target = (shareTarget[slug] || '').trim().toLowerCase()
    if (!target) {
      toast.error('Pick a user to share with')
      return
    }
    try {
      await api.post(`/projects/${slug}/share`, { target_username: target })
      toast.success(`Shared with ${target}`)
      setShareTarget(prev => ({ ...prev, [slug]: '' }))
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to share')
    }
  }

  const unshare = async (slug, target) => {
    try {
      await api.post(`/projects/${slug}/unshare`, { target_username: target })
      toast.success(`Removed ${target}`)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to unshare')
    }
  }

  const isOwner = (p) => !p.owner || p.owner === user?.username

  return (
    <div>
      <PageHeader icon="📂" title="Projects" subtitle="Manage documents, scope & sharing" gradient="from-toon-blue to-sky-500" />

      <ToonCard className="mb-6">
        <h3 className="font-bold text-toon-navy mb-3">Create New Project</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold text-toon-navy mb-1.5">
              Project name <span className="text-toon-coral">*</span>
            </label>
            <input className="toon-input" placeholder="Project name" value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-bold text-toon-navy mb-1.5">Description</label>
            <textarea className="toon-textarea" rows={2} placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <motion.button
              whileTap={newName.trim() ? { scale: 0.95 } : {}}
              onClick={create}
              disabled={!newName.trim()}
              className={`toon-btn toon-btn-blue flex-1 transition-all ${!newName.trim() ? 'opacity-40 cursor-not-allowed' : ''}`}
            >
              Create Project
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.95 }}
              onClick={() => { setNewName(''); setNewDesc('') }}
              type="button"
              className="toon-btn bg-gray-100 text-gray-600 hover:bg-gray-200 px-4"
            >
              🔄 Reset
            </motion.button>
          </div>
        </div>
      </ToonCard>

      <div className="space-y-4">
        {projects.map((p, i) => {
          const owner = isOwner(p)
          const shared = p.shared_with || []
          const candidates = allUsers.filter(u =>
            u !== p.owner && u !== user?.username && !shared.includes(u)
          )
          const docs = Array.isArray(p.documents) ? p.documents : []
          const status = indexStatus[p.slug] || 'idle'
          return (
            <ToonCard key={p.slug} delay={i * 0.05}>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-bold text-toon-navy text-lg">{p.name}</h3>
                  {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
                  {shared.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      <span className="text-xs text-gray-400 mr-1">Shared with:</span>
                      {shared.map(u => (
                        <span key={u} className="text-xs px-2 py-0.5 bg-purple-50 text-purple-700 rounded-lg font-semibold">
                          {u}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="toon-badge bg-toon-blue/10 text-toon-blue">
                    {owner ? 'Owner' : `by ${p.owner || '—'}`}
                  </span>
                  {shared.length > 0 && (
                    <span className="text-[10px] text-gray-400">{shared.length} shared</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {owner && (
                  <button
                    onClick={() => setOpenShare(prev => ({ ...prev, [p.slug]: !prev[p.slug] }))}
                    className="toon-btn bg-purple-500 text-white hover:bg-purple-600 text-sm py-2 px-4"
                  >
                    🤝 Share
                  </button>
                )}
                {owner && (
                  <button onClick={() => deleteProject(p.slug)} className="toon-btn toon-btn-coral text-sm py-2 px-4">🗑️ Delete</button>
                )}
              </div>

              {/* Documents panel — visible inline so users can see and curate
                  attached files for this project without leaving the page. */}
              <div className="mt-4 border-t border-gray-100 pt-3">
                <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                  <h4 className="text-sm font-bold text-toon-navy flex items-center gap-2">
                    <span>📁 Documents</span>
                    <span className="text-gray-400 font-normal">({docs.length})</span>
                    {status === 'indexing' && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                        Re-indexing…
                      </span>
                    )}
                    {status === 'done' && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                        Index up to date
                      </span>
                    )}
                    {status === 'error' && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                        Index failed
                      </span>
                    )}
                    {status === 'idle' && p.indexed && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        Indexed
                      </span>
                    )}
                    {status === 'idle' && !p.indexed && docs.length > 0 && (
                      <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        Not indexed
                      </span>
                    )}
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => uploadFiles(p.slug)}
                      className="toon-btn toon-btn-mint text-xs py-1.5 px-3"
                    >
                      + Add documents
                    </button>
                    <button
                      onClick={() => buildIndex(p.slug)}
                      disabled={status === 'indexing'}
                      className="toon-btn bg-gray-100 text-gray-700 hover:bg-gray-200 text-xs py-1.5 px-3 disabled:opacity-50"
                    >
                      🔨 Re-index
                    </button>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500 mb-2">
                  Files added here are auto re-indexed so RAG reflects them on the next agent run.
                </div>

                {docs.length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">
                    No documents yet — click <span className="font-bold">+ Add documents</span> to ground this project's RAG.
                  </p>
                ) : (
                  <ul className="max-h-56 overflow-auto divide-y divide-gray-200 bg-white rounded-xl border border-gray-200">
                    {docs.map((name) => (
                      <li
                        key={name}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span aria-hidden="true">📄</span>
                          <span className="truncate text-toon-navy" title={name}>
                            {name}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDocument(p.slug, name)}
                          title="Remove from project"
                          aria-label={`Remove ${name}`}
                          className="text-gray-400 hover:text-toon-coral text-base leading-none px-1.5"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <AnimatePresence>
                {owner && openShare[p.slug] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 p-4 bg-purple-50 rounded-2xl space-y-3">
                      <h4 className="text-sm font-bold text-purple-900">Manage Access</h4>

                      <div className="flex gap-2">
                        <select
                          className="toon-input !py-2 flex-1 text-sm"
                          value={shareTarget[p.slug] || ''}
                          onChange={e => setShareTarget(prev => ({ ...prev, [p.slug]: e.target.value }))}
                        >
                          <option value="">— Select a user —</option>
                          {candidates.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => share(p.slug)}
                          disabled={!shareTarget[p.slug]}
                          className={`toon-btn toon-btn-blue text-sm px-4 ${
                            !shareTarget[p.slug] ? 'opacity-40 cursor-not-allowed' : ''
                          }`}
                        >
                          ➕ Add
                        </button>
                      </div>

                      {shared.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-purple-700">Currently shared with:</p>
                          {shared.map(u => (
                            <div key={u} className="flex items-center justify-between bg-white px-3 py-1.5 rounded-xl">
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-toon-purple text-white text-[10px] font-bold flex items-center justify-center">
                                  {u[0]?.toUpperCase() || '?'}
                                </span>
                                <span className="text-sm text-gray-700">{u}</span>
                              </div>
                              <button
                                onClick={() => unshare(p.slug, u)}
                                className="text-xs text-toon-coral hover:underline font-semibold"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-purple-700/70">Not shared with anyone yet.</p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </ToonCard>
          )
        })}
        {projects.length === 0 && <p className="text-center text-gray-400 py-8">No projects yet. Create one above!</p>}
      </div>
    </div>
  )
}
