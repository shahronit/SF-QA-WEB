import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

const STORAGE_PREFIX = 'tc-edit:'

// Normalize the labels payload into a plain string array. The agents emit
// labels as either a comma-separated string ("regression, smoke") or an
// array; we render as a single comma-separated text input for ergonomics
// and split back to an array on save.
function labelsToString(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.filter(Boolean).join(', ')
  return String(value)
}

function stringToLabels(text) {
  if (!text) return []
  return text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Standalone pop-out editor for a single parsed test case.
 *
 * The opener (`TestManagementPush`) writes the test-case payload into
 * sessionStorage under `tc-edit:<key>`, opens this page with `?key=<key>`,
 * and listens for a `postMessage({type: 'tc-edit-result', key, testcase})`
 * back. We never re-fetch from the server — the entire round-trip is
 * client-side so we don't have to add a dedicated edit endpoint.
 *
 * Same-origin only. The opener verifies `event.origin === location.origin`
 * before merging, and we mirror that on the way out via `targetOrigin =
 * location.origin`. If `window.opener` is gone (user closed the parent
 * tab) we surface a hard error rather than silently dropping edits.
 */
export default function TestCaseEditor() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const key = params.get('key') || ''
  const storageKey = `${STORAGE_PREFIX}${key}`

  const [testcase, setTestcase] = useState(null)
  const [error, setError] = useState('')
  const [labelsText, setLabelsText] = useState('')

  useEffect(() => {
    if (!key) {
      setError('Missing editor key')
      return
    }
    let raw
    try {
      raw = sessionStorage.getItem(storageKey)
    } catch {
      setError('sessionStorage unavailable in this context')
      return
    }
    if (!raw) {
      setError('No test case payload found for this key. Re-open the editor from the parent window.')
      return
    }
    try {
      const parsed = JSON.parse(raw)
      // Force every editable field to a defined value so React inputs
      // never become uncontrolled mid-edit (which silently breaks
      // value updates).
      setTestcase({
        id: parsed.id || '',
        title: parsed.title || '',
        description: parsed.description || '',
        preconditions: parsed.preconditions || '',
        steps: Array.isArray(parsed.steps)
          ? parsed.steps.map((s) => (typeof s === 'string' ? s : (s?.action || ''))).filter((s) => s !== undefined)
          : [],
        expected: parsed.expected || '',
        priority: parsed.priority || '',
        type: parsed.type || '',
        severity: parsed.severity || '',
        labels: Array.isArray(parsed.labels) ? parsed.labels : (parsed.labels ? [parsed.labels] : []),
        // Keep any extra fields untouched so we round-trip them on save.
        _extras: Object.fromEntries(
          Object.entries(parsed).filter(([k]) => ![
            'id', 'title', 'description', 'preconditions', 'steps', 'expected',
            'priority', 'type', 'severity', 'labels',
          ].includes(k)),
        ),
      })
      setLabelsText(labelsToString(parsed.labels))
    } catch {
      setError('Stored payload is not valid JSON.')
    }
  }, [key, storageKey])

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full">
          <h1 className="text-lg font-extrabold text-toon-coral mb-2">Cannot open editor</h1>
          <p className="text-sm text-gray-600">{error}</p>
          <button
            onClick={() => window.close()}
            className="toon-btn bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm py-2 px-4 mt-4"
          >
            Close window
          </button>
        </div>
      </div>
    )
  }

  if (!testcase) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-toon-blue font-bold">Loading…</div>
      </div>
    )
  }

  const updateField = (field, value) => setTestcase((prev) => ({ ...prev, [field]: value }))

  const updateStep = (idx, value) => setTestcase((prev) => {
    const next = [...prev.steps]
    next[idx] = value
    return { ...prev, steps: next }
  })

  const moveStep = (idx, dir) => setTestcase((prev) => {
    const next = [...prev.steps]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return prev
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    return { ...prev, steps: next }
  })

  const removeStep = (idx) => setTestcase((prev) => ({
    ...prev,
    steps: prev.steps.filter((_, i) => i !== idx),
  }))

  const addStep = () => setTestcase((prev) => ({
    ...prev,
    steps: [...prev.steps, ''],
  }))

  const onSave = () => {
    const payload = {
      ...testcase._extras,
      id: testcase.id.trim(),
      title: testcase.title.trim(),
      description: testcase.description,
      preconditions: testcase.preconditions,
      // Drop empty steps so the downstream Jira renderer doesn't emit
      // bare numbers like "1." with no body.
      steps: testcase.steps.map((s) => s.trim()).filter(Boolean),
      expected: testcase.expected,
      priority: testcase.priority.trim(),
      type: testcase.type.trim(),
      severity: testcase.severity.trim(),
      labels: stringToLabels(labelsText),
    }
    if (!payload.title) {
      toast.error('Title is required')
      return
    }
    if (!window.opener || window.opener.closed) {
      toast.error('Parent window is gone — cannot deliver edits.')
      return
    }
    try {
      window.opener.postMessage(
        { type: 'tc-edit-result', key, testcase: payload },
        window.location.origin,
      )
    } catch {
      toast.error('Failed to send edits to parent window')
      return
    }
    try { sessionStorage.removeItem(storageKey) } catch { /* ignore */ }
    window.close()
  }

  const onCancel = () => {
    try { sessionStorage.removeItem(storageKey) } catch { /* ignore */ }
    window.close()
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl">
        <div className="px-6 py-4 border-b border-gray-100">
          <h1 className="text-lg font-extrabold text-toon-navy">Edit test case</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Changes are sent back to the parent window when you click Save. Closing this tab discards them.
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="ID" hint="Optional. Will be regenerated by Jira/TM if blank.">
              <input className="toon-input !py-2" value={testcase.id} onChange={(e) => updateField('id', e.target.value)} />
            </Field>
            <Field label="Priority">
              <input className="toon-input !py-2" value={testcase.priority} onChange={(e) => updateField('priority', e.target.value)} placeholder="High / Medium / Low" />
            </Field>
            <Field label="Severity">
              <input className="toon-input !py-2" value={testcase.severity} onChange={(e) => updateField('severity', e.target.value)} placeholder="S1 / S2 / S3" />
            </Field>
          </div>

          <Field label="Title" required>
            <input className="toon-input !py-2" value={testcase.title} onChange={(e) => updateField('title', e.target.value)} />
          </Field>

          <Field label="Description">
            <textarea
              className="toon-input !py-2 min-h-[80px]"
              value={testcase.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Optional summary or context for this test case"
            />
          </Field>

          <Field label="Preconditions">
            <textarea
              className="toon-input !py-2 min-h-[80px]"
              value={testcase.preconditions}
              onChange={(e) => updateField('preconditions', e.target.value)}
            />
          </Field>

          <Field label="Steps" hint="Use the arrows to reorder. Empty steps are dropped on save.">
            <div className="space-y-2">
              {testcase.steps.map((step, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <span className="mt-2 text-xs font-bold text-gray-400 w-6 text-right">{idx + 1}.</span>
                  <textarea
                    className="toon-input !py-2 flex-1 min-h-[44px]"
                    value={step}
                    onChange={(e) => updateStep(idx, e.target.value)}
                  />
                  <div className="flex flex-col gap-1">
                    <button type="button" onClick={() => moveStep(idx, -1)} disabled={idx === 0} className="text-xs text-gray-500 hover:text-toon-blue disabled:opacity-30" aria-label="Move step up">▲</button>
                    <button type="button" onClick={() => moveStep(idx, 1)} disabled={idx === testcase.steps.length - 1} className="text-xs text-gray-500 hover:text-toon-blue disabled:opacity-30" aria-label="Move step down">▼</button>
                    <button type="button" onClick={() => removeStep(idx)} className="text-xs text-toon-coral hover:opacity-80" aria-label="Remove step">✕</button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addStep} className="text-xs font-bold text-toon-blue hover:underline">
                + Add step
              </button>
            </div>
          </Field>

          <Field label="Expected result">
            <textarea
              className="toon-input !py-2 min-h-[80px]"
              value={testcase.expected}
              onChange={(e) => updateField('expected', e.target.value)}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Type">
              <input className="toon-input !py-2" value={testcase.type} onChange={(e) => updateField('type', e.target.value)} placeholder="Functional / Negative / UI…" />
            </Field>
            <Field label="Labels" hint="Comma-separated. e.g. regression, smoke, sprint-22">
              <input className="toon-input !py-2" value={labelsText} onChange={(e) => setLabelsText(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="toon-btn bg-gray-200 text-gray-700 hover:bg-gray-300 text-sm py-2 px-4">
            Cancel
          </button>
          <button type="button" onClick={onSave} className="toon-btn toon-btn-blue text-sm py-2 px-4">
            Save & close
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, required, children }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-toon-navy mb-1 block">
        {label}{required && <span className="text-toon-coral ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11px] text-gray-400 mt-1 block">{hint}</span>}
    </label>
  )
}
