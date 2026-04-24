import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import api from '../api/client'
import {
  putMany as docStorePutMany,
  listFiles as docStoreList,
  deleteFile as docStoreDelete,
  projectScope,
} from '../utils/docStore'

// Match Projects.jsx — accept anything; the ingestor falls back to
// plain-text loading for unknown extensions so nothing is rejected at
// upload time.
const ACCEPT = '*/*'

function formatBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function normalizeDocs(raw) {
  if (!Array.isArray(raw)) return []
  return raw
    .map((d) => {
      if (typeof d === 'string') return { name: d, size: null, uploadedBy: '', uploadedAt: '', localOnly: false }
      if (d && typeof d === 'object') {
        const name = d.name || d.filename || ''
        if (!name) return null
        return {
          name,
          size: typeof d.size === 'number' ? d.size : null,
          uploadedBy: d.uploaded_by || d.uploadedBy || '',
          uploadedAt: d.uploaded_at || d.uploadedAt || '',
          localOnly: false,
        }
      }
      return null
    })
    .filter(Boolean)
}

// Union backend docs with the browser's IndexedDB sidecar, tagging
// browser-only entries so the UI can badge them. Backend entries win on
// metadata (size / uploadedAt) when both stores know about a file.
async function mergeWithLocal(slug, backendDocs) {
  const merged = normalizeDocs(backendDocs)
  if (!slug) return merged
  let local = []
  try {
    local = await docStoreList(projectScope(slug))
  } catch { return merged }
  const known = new Set(merged.map((d) => d.name))
  for (const l of local) {
    if (known.has(l.name)) continue
    merged.push({
      name: l.name,
      size: typeof l.size === 'number' ? l.size : null,
      uploadedBy: l.uploadedBy || '',
      uploadedAt: l.uploadedAt || l.addedAt || '',
      localOnly: true,
    })
  }
  return merged
}

function fmtUploaded(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ProjectContextPicker({
  projects,
  value,
  onChange,
  onProjectsChanged,
  variant = 'full',
  disabled = false,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [docState, setDocState] = useState({ loading: false, error: '', docs: [], indexed: false })
  const [indexStatus, setIndexStatus] = useState('idle')
  const [coords, setCoords] = useState(null)
  const fileInputRef = useRef(null)
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)
  const popoverRef = useRef(null)

  const selected = useMemo(
    () => (Array.isArray(projects) ? projects.find((p) => p.slug === value) : null) || null,
    [projects, value],
  )

  // Close on outside click. The popover is portalled to <body>, so it's not a
  // DOM descendant of wrapperRef anymore — exempt it explicitly via popoverRef.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      const inWrapper = wrapperRef.current && wrapperRef.current.contains(e.target)
      const inPopover = popoverRef.current && popoverRef.current.contains(e.target)
      if (!inWrapper && !inPopover) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Anchor the portalled popover to the input via fixed coords, recomputing on
  // resize / scroll so it stays glued while the page moves. This sidesteps the
  // stacking-context trap created by `.toon-card { transform: ... }` on hover.
  useLayoutEffect(() => {
    if (!open || !inputRef.current) return
    const update = () => {
      if (!inputRef.current) return
      const r = inputRef.current.getBoundingClientRect()
      setCoords({ top: r.bottom + 4, left: r.left, width: r.width })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const safeProjects = Array.isArray(projects) ? projects : []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return safeProjects
    return safeProjects.filter((p) => {
      const name = (p.name || '').toLowerCase()
      const slug = (p.slug || '').toLowerCase()
      const desc = (p.description || '').toLowerCase()
      return name.includes(q) || slug.includes(q) || desc.includes(q)
    })
  }, [safeProjects, query])

  const fetchDocs = useCallback(async (slug) => {
    if (!slug) {
      setDocState({ loading: false, error: '', docs: [], indexed: false })
      return
    }
    setDocState((prev) => ({ ...prev, loading: true, error: '' }))
    try {
      const { data } = await api.get(`/projects/${slug}`)
      const docs = await mergeWithLocal(slug, data?.documents)
      setDocState({
        loading: false,
        error: '',
        docs,
        indexed: !!data?.indexed,
      })
    } catch (err) {
      // Even when the backend lookup fails we still surface whatever the
      // browser sidecar has cached so the user never feels their docs
      // disappeared.
      const docs = await mergeWithLocal(slug, [])
      setDocState({
        loading: false,
        error: docs.length ? '' : (err?.response?.data?.detail || 'Failed to load documents'),
        docs,
        indexed: false,
      })
    }
  }, [])

  // Auto-fetch documents whenever a project is selected (or the slug changes).
  // Previously this was gated behind a "show docs" toggle which left users
  // unable to see attached files unless they discovered the chevron.
  useEffect(() => {
    if (!value) {
      setDocState({ loading: false, error: '', docs: [], indexed: false })
      return
    }
    fetchDocs(value)
  }, [value, fetchDocs])

  // Reset transient UI when the slug changes from the outside.
  useEffect(() => {
    setIndexStatus('idle')
  }, [value])

  const triggerReindex = useCallback(async (slug) => {
    if (!slug) return
    setIndexStatus('indexing')
    try {
      const { data } = await api.post(`/projects/${slug}/build-index`)
      setIndexStatus('done')
      const chunks = typeof data?.chunks === 'number' ? data.chunks : null
      toast.success(chunks != null ? `Indexed ${chunks} chunks` : 'Project re-indexed')
      window.dispatchEvent(new CustomEvent('qa:projects-updated'))
      onProjectsChanged?.()
    } catch (err) {
      setIndexStatus('error')
      toast.error(err?.response?.data?.detail || 'Re-indexing failed')
    }
  }, [onProjectsChanged])

  const handlePickProject = (slug) => {
    onChange?.(slug)
    setOpen(false)
    setHighlight(0)
    setQuery('')
  }

  const handleClear = (e) => {
    e?.stopPropagation?.()
    handlePickProject('')
    inputRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(filtered.length, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // index 0 = "no project" sentinel row
      if (highlight === 0) {
        handlePickProject('')
      } else {
        const target = filtered[highlight - 1]
        if (target) handlePickProject(target.slug)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleUploadClick = () => {
    if (!value || disabled) return
    fileInputRef.current?.click()
  }

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !value) return
    // Mirror to browser sidecar first so the file persists in IndexedDB
    // even if the network upload fails. The user only loses it when
    // they click the explicit × button.
    try {
      await docStorePutMany(projectScope(value), files, {
        uploadedAt: new Date().toISOString(),
      })
    } catch { /* IndexedDB unavailable */ }

    const formData = new FormData()
    files.forEach((f) => formData.append('files', f))
    const tid = toast.loading(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`)
    try {
      await api.post(`/projects/${value}/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? 's' : ''}`, { id: tid })
      await fetchDocs(value)
      triggerReindex(value)
    } catch (err) {
      toast.error(
        `${err?.response?.data?.detail || 'Server upload failed'} — kept on this device`,
        { id: tid },
      )
      await fetchDocs(value)
    }
  }

  const handleDelete = async (filename) => {
    if (!value) return
    if (!window.confirm(`Remove "${filename}" from this project?`)) return
    const tid = toast.loading(`Removing ${filename}…`)
    let backendOk = true
    try {
      await api.delete(`/projects/${value}/documents/${encodeURIComponent(filename)}`)
    } catch (err) {
      backendOk = false
      const status = err?.response?.status
      if (status && status !== 404) {
        toast.error(err?.response?.data?.detail || 'Server delete failed', { id: tid })
      }
    }
    try { await docStoreDelete(projectScope(value), filename) } catch { /* ignore */ }
    if (backendOk) toast.success(`Removed ${filename}`, { id: tid })
    else toast.success(`Removed ${filename} from this device`, { id: tid })
    await fetchDocs(value)
    if (backendOk) triggerReindex(value)
  }

  const docCount = docState.docs.length
  const compact = variant === 'compact'

  // Keep the highlight in range whenever the visible list shrinks/grows.
  useEffect(() => {
    if (!open) return
    if (filtered.length === 0) setHighlight(0)
    else if (highlight > filtered.length) setHighlight(filtered.length)
  }, [filtered.length, open, highlight])

  // The selected project's pretty label – falls back to the slug while the
  // projects list is still loading so users always see their selection.
  const selectedLabel = selected?.name || (value ? value : '')

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          className={`toon-input ${compact ? '' : '!py-2'} pr-16`}
          value={query}
          placeholder={
            value
              ? `Selected: ${selectedLabel} — type to change`
              : 'Search projects… (or leave blank for global knowledge only)'
          }
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlight(0)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          autoComplete="off"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {value && !disabled && (
            <button
              type="button"
              onClick={handleClear}
              title="Clear selection"
              className="text-gray-400 hover:text-toon-coral text-base leading-none px-1"
              aria-label="Clear project"
            >
              ×
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={disabled}
            title="Toggle project list"
            aria-label="Toggle project list"
            className="text-gray-400 hover:text-toon-blue text-xs px-1"
          >
            ▾
          </button>
        </div>

        {createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={popoverRef}
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.12 }}
                style={{
                  position: 'fixed',
                  top: coords.top,
                  left: coords.left,
                  width: coords.width,
                  zIndex: 9999,
                }}
                className="bg-white border border-gray-200 rounded-2xl shadow-xl max-h-80 overflow-auto"
              >
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-100 bg-gray-50/60 flex items-center justify-between">
                  <span>{safeProjects.length} project{safeProjects.length === 1 ? '' : 's'} available</span>
                  {query && (
                    <span className="text-gray-500 normal-case tracking-normal">
                      {filtered.length} match{filtered.length === 1 ? '' : 'es'}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handlePickProject('')}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 ${
                    highlight === 0 ? 'bg-toon-blue/10 text-toon-blue' : 'text-gray-500 hover:bg-gray-50'
                  }`}
                  onMouseEnter={() => setHighlight(0)}
                >
                  <span className="font-bold">— No project</span>{' '}
                  <span className="text-xs text-gray-400">(global knowledge only)</span>
                </button>
                {safeProjects.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-400">
                    No projects yet. Create one from the Projects page.
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-gray-400">
                    No projects match “{query}”.
                  </div>
                ) : (
                  filtered.map((p, idx) => {
                    const active = highlight === idx + 1
                    const isSelected = p.slug === value
                    return (
                      <button
                        key={p.slug}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handlePickProject(p.slug)}
                        onMouseEnter={() => setHighlight(idx + 1)}
                        className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-b-0 ${
                          active ? 'bg-toon-blue/10 text-toon-blue' : 'text-toon-navy hover:bg-gray-50'
                        } ${isSelected ? 'font-bold' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {isSelected && <span className="mr-1">✓</span>}
                            {p.name}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">
                            {p.slug}
                          </span>
                        </div>
                        {p.description && (
                          <div className="text-[11px] text-gray-400 truncate">{p.description}</div>
                        )}
                      </button>
                    )
                  })
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
      </div>

      {/* Selected project chip + always-visible documents panel.
          The previous version hid documents behind a collapsed toggle which
          made users believe their uploaded files were missing. */}
      {value && (
        <div className="mt-2 border border-gray-200 rounded-2xl bg-gray-50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-toon-blue/10 text-toon-blue">
                Project
              </span>
              <span className="text-sm font-bold text-toon-navy truncate">
                {selectedLabel}
              </span>
              <span className="text-[11px] text-gray-400">
                ({docCount} doc{docCount === 1 ? '' : 's'})
              </span>
              {indexStatus === 'indexing' && (
                <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  Re-indexing…
                </span>
              )}
              {indexStatus === 'done' && (
                <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  Index up to date
                </span>
              )}
              {indexStatus === 'error' && (
                <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                  Index failed
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fetchDocs(value)}
                disabled={disabled || docState.loading}
                className="text-[11px] text-gray-500 hover:text-toon-blue disabled:opacity-40"
                title="Refresh document list"
              >
                ↻ Refresh
              </button>
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={disabled}
                className="toon-btn toon-btn-mint text-xs py-1.5 px-3 disabled:opacity-50"
              >
                + Add documents
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={handleFiles}
              />
            </div>
          </div>

          <div className="text-[11px] text-gray-500">
            Files added here are auto re-indexed so RAG reflects them on the next agent run.
          </div>

          {docState.loading ? (
            <div className="text-xs text-gray-400 py-2">Loading documents…</div>
          ) : docState.error ? (
            <div className="text-xs text-toon-coral py-2">{docState.error}</div>
          ) : docState.docs.length === 0 ? (
            <div className="text-xs text-gray-400 py-2">
              No documents yet — click <span className="font-bold">+ Add documents</span> to ground this project's RAG.
            </div>
          ) : (
            <ul className="max-h-48 overflow-auto divide-y divide-gray-200 bg-white rounded-xl border border-gray-200">
              {docState.docs.map((d) => {
                const meta = []
                if (d.size != null) meta.push(formatBytes(d.size))
                if (d.uploadedBy) meta.push(`by ${d.uploadedBy}`)
                const when = fmtUploaded(d.uploadedAt)
                if (when) meta.push(when)
                return (
                  <li
                    key={d.name}
                    className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span aria-hidden="true">📄</span>
                      <div className="min-w-0">
                        <div className="truncate text-toon-navy flex items-center gap-1.5" title={d.name}>
                          <span className="truncate">{d.name}</span>
                          {d.localOnly && (
                            <span
                              className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 flex-shrink-0"
                              title="Stored only in this browser. Will not be removed unless you click ×."
                            >
                              💾 device
                            </span>
                          )}
                        </div>
                        {meta.length > 0 && (
                          <div className="text-[10px] text-gray-400 truncate">
                            {meta.join(' • ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(d.name)}
                      disabled={disabled}
                      title="Remove from project"
                      aria-label={`Remove ${d.name}`}
                      className="text-gray-400 hover:text-toon-coral text-base leading-none px-1.5 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
