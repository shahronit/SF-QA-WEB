import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import api from '../api/client'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import ToonCard from '../components/ToonCard'

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const load = async () => {
    try {
      const { data } = await api.get('/projects/')
      setProjects(data.projects || [])
    } catch { /* ignore */ }
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!newName.trim()) return
    try {
      await api.post('/projects/', { name: newName, description: newDesc })
      setNewName(''); setNewDesc('')
      toast.success('Project created!')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  const uploadFiles = async (slug) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.pdf,.docx,.doc,.csv,.txt,.xlsx,.json,.md'
    input.onchange = async () => {
      const formData = new FormData()
      Array.from(input.files).forEach(f => formData.append('files', f))
      try {
        await api.post(`/projects/${slug}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })
        toast.success('Files uploaded!')
        load()
      } catch { toast.error('Upload failed') }
    }
    input.click()
  }

  const buildIndex = async (slug) => {
    try {
      const { data } = await api.post(`/projects/${slug}/build-index`)
      toast.success(`Indexed ${data.chunks} chunks`)
      load()
    } catch { toast.error('Indexing failed') }
  }

  const deleteProject = async (slug) => {
    if (!confirm('Delete this project?')) return
    try {
      await api.delete(`/projects/${slug}`)
      toast.success('Project deleted')
      load()
    } catch (err) { toast.error(err.response?.data?.detail || 'Failed') }
  }

  return (
    <div>
      <PageHeader icon="📂" title="Projects" subtitle="Manage documents & scope" gradient="from-toon-blue to-sky-500" />

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
        {projects.map((p, i) => (
          <ToonCard key={p.slug} delay={i * 0.05}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-toon-navy text-lg">{p.name}</h3>
                {p.description && <p className="text-sm text-gray-500">{p.description}</p>}
              </div>
              <span className="toon-badge bg-toon-blue/10 text-toon-blue">{p.owner || 'No owner'}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => uploadFiles(p.slug)} className="toon-btn toon-btn-mint text-sm py-2 px-4">📎 Upload Docs</button>
              <button onClick={() => buildIndex(p.slug)} className="toon-btn toon-btn-blue text-sm py-2 px-4">🔨 Build Index</button>
              <button onClick={() => deleteProject(p.slug)} className="toon-btn toon-btn-coral text-sm py-2 px-4">🗑️ Delete</button>
            </div>
          </ToonCard>
        ))}
        {projects.length === 0 && <p className="text-center text-gray-400 py-8">No projects yet. Create one above!</p>}
      </div>
    </div>
  )
}
