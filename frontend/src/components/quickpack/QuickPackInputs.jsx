import { useMemo } from 'react'

// Resolve mode-aware field props. Same rules as AgentForm.jsx
// `resolveField()` (lines 242-249) so users see identical labels,
// placeholders, and select options between the dedicated agent page
// and the per-tab Inputs panel inside Quick Pack.
function resolveField(field, qaMode) {
  return {
    ...field,
    label: field.labelByMode?.[qaMode] ?? field.label,
    placeholder: field.placeholderByMode?.[qaMode] ?? field.placeholder,
    options: field.optionsByMode?.[qaMode] ?? field.options,
  }
}

/**
 * Compact field renderer used by Quick Pack tabs.
 *
 * Renders the same `text` / `textarea` / `select` shapes that
 * AgentForm understands, with the same `labelByMode` /
 * `placeholderByMode` / `optionsByMode` mode-awareness — but WITHOUT
 * the surrounding orchestration shell (no QA-mode pills, no Jira
 * fetch UI, no project picker, no Generate button). Those live in
 * the Quick Pack header and are shared across every tab.
 *
 * Required fields show a coral asterisk and pulse when `shake` is
 * bumped — used by the parent to draw attention to skipped tabs
 * after the bulk Generate.
 *
 * Props:
 *   - fields:      array of field defs (from agentInputs.AGENT_FIELDS)
 *   - values:      { [key]: string } current draft for this tab
 *   - onChange:    (key, value) => void — bubbles edits upward
 *   - qaMode:      'salesforce' | 'general'  (drives byMode resolution)
 *   - missing:     string[] of required keys currently missing — those
 *                  fields get a coral border + a tiny "required" hint.
 *   - shake:       number (timestamp); when it changes the missing
 *                  fields shake briefly so the user sees them.
 *   - disabled:    boolean — disables every input (used while running).
 */
export default function QuickPackInputs({
  fields = [],
  values = {},
  onChange,
  qaMode = 'salesforce',
  missing = [],
  disabled = false,
  shake = 0,
}) {
  const resolvedFields = useMemo(
    () => fields
      .filter(f => !f.hideInMode || f.hideInMode !== qaMode)
      .map(f => resolveField(f, qaMode)),
    [fields, qaMode],
  )
  const missingSet = useMemo(() => new Set(missing), [missing])

  if (resolvedFields.length === 0) {
    return (
      <div className="text-xs text-gray-400 italic">
        This agent doesn&apos;t expose any inputs.
      </div>
    )
  }

  const handle = (key) => (e) => onChange?.(key, e.target.value)

  return (
    <div className="space-y-3">
      {resolvedFields.map(field => {
        const isRequired = field.required !== false && field.type !== 'select'
        const isMissing = missingSet.has(field.key)
        const ringClass = isMissing
          ? 'ring-2 ring-toon-coral/50 border-toon-coral/40'
          : ''
        const value = values[field.key] || ''
        return (
          <div
            key={field.key}
            className={isMissing && shake ? 'animate-pulse' : ''}
          >
            <label className="block text-xs font-bold text-toon-navy mb-1">
              {field.label}
              {isRequired && <span className="text-toon-coral ml-1">*</span>}
              {field.hint && (
                <span className="font-normal text-gray-400 ml-2 normal-case">
                  {field.hint}
                </span>
              )}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                className={`toon-textarea text-sm ${ringClass}`}
                rows={field.rows || 4}
                placeholder={field.placeholder || ''}
                value={value}
                onChange={handle(field.key)}
                disabled={disabled}
              />
            ) : field.type === 'select' ? (
              <select
                className={`toon-input text-sm ${ringClass}`}
                value={value || (typeof field.options?.[0] === 'string' ? field.options[0] : field.options?.[0]?.value) || ''}
                onChange={handle(field.key)}
                disabled={disabled}
              >
                {field.options?.map(o => {
                  const val = typeof o === 'string' ? o : o.value
                  const lbl = typeof o === 'string' ? o : o.label
                  return <option key={val} value={val}>{lbl}</option>
                })}
              </select>
            ) : (
              <input
                type={field.type || 'text'}
                className={`toon-input text-sm ${ringClass}`}
                placeholder={field.placeholder || ''}
                value={value}
                onChange={handle(field.key)}
                disabled={disabled}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
