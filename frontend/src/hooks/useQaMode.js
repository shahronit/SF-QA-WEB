import { useEffect, useState, useCallback } from 'react'

export const QA_MODE_STORAGE_KEY = 'qa-studio:qa_mode'
export const QA_MODE_EVENT = 'qa:qa-mode-changed'
export const QA_MODE_OPTIONS = [
  { id: 'salesforce', label: 'Salesforce QA', icon: '\u2601\uFE0F' },
  { id: 'general', label: 'General QA', icon: '\uD83E\uDDEA' },
]

export function readQaMode() {
  try {
    const v = localStorage.getItem(QA_MODE_STORAGE_KEY)
    return v === 'general' ? 'general' : 'salesforce'
  } catch {
    return 'salesforce'
  }
}

// Reactive hook: returns [qaMode, setQaMode]. Setter persists to localStorage
// and broadcasts a custom event so other components in the same tab update
// immediately (the native `storage` event only fires across tabs).
export function useQaMode() {
  const [qaMode, setQaModeState] = useState(() => readQaMode())

  useEffect(() => {
    const onCustom = (e) => {
      const next = e?.detail?.mode === 'general' ? 'general' : 'salesforce'
      setQaModeState(prev => (prev === next ? prev : next))
    }
    const onStorage = (e) => {
      if (e.key === QA_MODE_STORAGE_KEY) setQaModeState(readQaMode())
    }
    window.addEventListener(QA_MODE_EVENT, onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(QA_MODE_EVENT, onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setQaMode = useCallback((next) => {
    const normalised = next === 'general' ? 'general' : 'salesforce'
    setQaModeState(normalised)
    try { localStorage.setItem(QA_MODE_STORAGE_KEY, normalised) } catch { /* ignore */ }
    try {
      window.dispatchEvent(new CustomEvent(QA_MODE_EVENT, { detail: { mode: normalised } }))
    } catch { /* ignore */ }
  }, [])

  return [qaMode, setQaMode]
}
