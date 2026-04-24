import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

// Match the SAME table-detection rule the backend uses (header row + a
// separator row of dashes/colons/pipes). Tables inside fenced code blocks
// are skipped so we don't accidentally offer to filter pseudo-tables in
// example snippets.
const FENCE_RE = /^\s*(```|~~~)/
const SEP_RE = /^[\s|:\-]+$/

function parseRow(raw) {
  // Mirror backend `_parse_row` so column counts and labels stay in sync
  // with what the server's filter step will see.
  const PIPE_ESC = '\u0000PIPE\u0000'
  const escaped = raw.replaceAll('\\|', PIPE_ESC)
  return escaped
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((c) => c.replace(PIPE_ESC, '|').trim())
}

function isSeparator(raw) {
  const stripped = raw.trim()
  if (!stripped || !stripped.includes('|')) return false
  const inner = stripped.replace(/^\|+/, '').replace(/\|+$/, '')
  return SEP_RE.test(inner)
}

function isPipeRow(raw) {
  return raw.includes('|')
}

/**
 * Walk markdown source looking for GFM pipe tables. Returns one entry per
 * detected table in source order so the index matches what the backend
 * filter (`exporter.filter_table_columns`) will use:
 *
 *   [{ index: 0, heading: 'Test Cases', headers: ['TC ID', 'Summary', …] }, …]
 *
 * Heading is the nearest preceding ATX heading (best-effort label so the
 * picker UI shows users which table they're trimming).
 */
export function detectMarkdownTables(content) {
  if (!content) return []
  const lines = content.split(/\r?\n/)
  const tables = []
  let inFence = false
  let heading = ''
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    if (FENCE_RE.test(raw)) {
      inFence = !inFence
      i += 1
      continue
    }
    if (inFence) { i += 1; continue }
    const headingMatch = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (headingMatch) {
      heading = headingMatch[2].trim() || heading
      i += 1
      continue
    }
    if (isPipeRow(raw) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const headers = parseRow(raw)
      tables.push({ index: tables.length, heading: heading || '(Untitled)', headers })
      // Skip past the rest of this table to avoid re-detecting data rows.
      i += 2
      while (i < lines.length && isPipeRow(lines[i]) && !isSeparator(lines[i])) i += 1
      continue
    }
    i += 1
  }
  return tables
}

/**
 * Modal that lets the user pick which columns of each detected GFM table
 * survive an export (Excel / CSV / Markdown / PDF). Defaults to "all
 * columns" so the no-op path matches today's behavior.
 *
 * Props:
 *   - open       : when true, the modal is rendered into <body> via portal.
 *   - tables     : output of `detectMarkdownTables` (array of {index, heading, headers}).
 *   - format     : e.g. 'excel' / 'csv' — used purely for the header label.
 *   - onConfirm  : (selected_columns_dict) => void — keys are stringified
 *                  table indices, values are the kept header labels in the
 *                  order the user sees them (which equals source order).
 *   - onCancel   : () => void — closes without exporting.
 */
export default function ExportColumnPicker({ open, tables, format, onConfirm, onCancel }) {
  // checked[tableIndex] is a Set of headers the user wants to keep.
  // Re-seed every time the modal opens so re-opening after a cancel
  // doesn't leak the previous picks (which would surprise users).
  const [checked, setChecked] = useState({})

  useEffect(() => {
    if (!open) return
    const init = {}
    for (const t of tables) init[t.index] = new Set(t.headers)
    setChecked(init)
  }, [open, tables])

  const totals = useMemo(() => {
    const total = tables.reduce((acc, t) => acc + t.headers.length, 0)
    const picked = tables.reduce((acc, t) => acc + (checked[t.index]?.size || 0), 0)
    return { total, picked }
  }, [tables, checked])

  if (!open) return null

  const toggle = (idx, header) => {
    setChecked((prev) => {
      const next = { ...prev }
      const set = new Set(next[idx] || [])
      if (set.has(header)) set.delete(header)
      else set.add(header)
      next[idx] = set
      return next
    })
  }

  const toggleAll = (idx, headers, on) => {
    setChecked((prev) => ({ ...prev, [idx]: new Set(on ? headers : []) }))
  }

  const confirm = () => {
    // Only emit a filter for tables where the user trimmed something —
    // tables left fully checked are "unfiltered" so the backend can pass
    // them through verbatim and we keep the request payload small.
    const out = {}
    for (const t of tables) {
      const set = checked[t.index] || new Set()
      if (set.size === t.headers.length) continue
      out[String(t.index)] = t.headers.filter((h) => set.has(h))
    }
    onConfirm(out)
  }

  const formatLabel = format ? format.toUpperCase() : 'EXPORT'

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold text-toon-navy">Choose columns to export</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {tables.length} table{tables.length === 1 ? '' : 's'} detected · {totals.picked}/{totals.total} columns selected · {formatLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {tables.map((t) => {
            const set = checked[t.index] || new Set()
            const allOn = set.size === t.headers.length
            const noneOn = set.size === 0
            return (
              <div key={t.index} className="border border-gray-200 rounded-xl">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between rounded-t-xl">
                  <div className="text-[12px] font-bold text-toon-navy truncate" title={t.heading}>
                    Table {t.index + 1} — {t.heading}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => toggleAll(t.index, t.headers, true)}
                      disabled={allOn}
                      className="text-[10px] uppercase tracking-wider font-bold text-toon-blue hover:underline disabled:text-gray-300 disabled:no-underline"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleAll(t.index, t.headers, false)}
                      disabled={noneOn}
                      className="text-[10px] uppercase tracking-wider font-bold text-toon-coral hover:underline disabled:text-gray-300 disabled:no-underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="px-3 py-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {t.headers.map((h) => (
                    <label key={h} className="flex items-start gap-2 text-[12px] text-gray-700 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input
                        type="checkbox"
                        checked={set.has(h)}
                        onChange={() => toggle(t.index, h)}
                        className="mt-0.5 accent-toon-blue"
                      />
                      <span className="truncate" title={h}>{h || '(empty header)'}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={totals.picked === 0}
            className="toon-btn toon-btn-blue text-sm py-2 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
