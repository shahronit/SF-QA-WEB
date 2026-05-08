import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// Persistent "pinned context" the user has selected once and expects to
// stay selected across pages, agent runs, and browser reloads — until
// they explicitly remove a pin or click Clear-all.
//
// Slots:
//   - qaProjectSlug: RAG / QA Studio project slug (project picker on every agent page)
//   - jiraProjectKey: Jira project key (e.g. "ABC") for Jira-push surfaces
//   - sprintId / sprintName: Sprint filter from the Jira issue picker
//   - userStoryKey: Imported Jira ticket key that test cases / comments
//                   default to as their parent
//   - quickPackTargets: Array of agent slugs the user wants the next
//                       QuickPack import / bulk Generate to apply to.
//                       ``null`` means "default to every accessible
//                       agent" (first run / never explicitly chosen).
//   - stlcPackTargets:  Same idea, but for the five STLC phases.
//                       ``null`` ⇒ run all five.
//
// All four are written by the components that own each selection and
// read by every place that needs a default. Reset buttons no longer
// clear these — only individual pin removals or `clearAll()` do.

// Bumped to v2 when the targets keys were added so a stale localStorage
// entry doesn't accidentally produce a "no agents selected" UI on first
// load after the upgrade.
const STORAGE_KEY = 'qa:sessionPrefs:v2'
const DEFAULT_STATE = {
  qaProjectSlug: '',
  jiraProjectKey: '',
  sprintId: '',
  sprintName: '',
  userStoryKey: '',
  // Both default to ``null`` — components interpret that as
  // "select all currently accessible agents". Storing an explicit
  // empty array would mean "user picked NO agents" which is a
  // different, valid state.
  quickPackTargets: null,
  stlcPackTargets: null,
}

function readInitialState() {
  if (typeof window === 'undefined' || !window.localStorage) return { ...DEFAULT_STATE }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_STATE }
    return { ...DEFAULT_STATE, ...parsed }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

const SessionPrefsContext = createContext(null)

export function SessionPrefsProvider({ children }) {
  const [state, setState] = useState(readInitialState)

  // Mirror to localStorage on every change so a tab reload picks up the
  // same pinned context. We write the whole snapshot — keeps the JSON
  // simple and small.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.localStorage) return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch { /* quota exceeded / private mode — ignore */ }
  }, [state])

  // Cross-tab sync: another tab may pin a different project / story.
  // Reflect that here so the user sees consistent pins everywhere.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      try {
        const next = JSON.parse(e.newValue)
        if (next && typeof next === 'object') {
          setState((prev) => ({ ...prev, ...next }))
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setQaProjectSlug = useCallback((slug) => {
    setState((prev) => ({ ...prev, qaProjectSlug: slug || '' }))
  }, [])

  const setJiraProjectKey = useCallback((key) => {
    setState((prev) => ({ ...prev, jiraProjectKey: (key || '').toUpperCase() }))
  }, [])

  const setSprint = useCallback((id, name) => {
    setState((prev) => ({
      ...prev,
      sprintId: id == null ? '' : String(id),
      sprintName: name || '',
    }))
  }, [])

  const setUserStoryKey = useCallback((key) => {
    setState((prev) => ({ ...prev, userStoryKey: (key || '').toUpperCase() }))
  }, [])

  // Persist the "Apply Jira & Generate to" / "Run these phases"
  // selection as an array of slugs (or ``null`` to fall back to the
  // page's default-everything behaviour). We accept ``Set`` instances
  // for ergonomics — the page state is a Set; the storage layer
  // serialises whatever comes in into a plain array of strings.
  const setQuickPackTargets = useCallback((targets) => {
    setState((prev) => ({
      ...prev,
      quickPackTargets:
        targets === null || targets === undefined
          ? null
          : [...targets].map(String),
    }))
  }, [])
  const setStlcPackTargets = useCallback((targets) => {
    setState((prev) => ({
      ...prev,
      stlcPackTargets:
        targets === null || targets === undefined
          ? null
          : [...targets].map(String),
    }))
  }, [])

  const clearPin = useCallback((slot) => {
    setState((prev) => {
      const next = { ...prev }
      if (slot === 'qaProjectSlug') next.qaProjectSlug = ''
      else if (slot === 'jiraProjectKey') next.jiraProjectKey = ''
      else if (slot === 'sprint') { next.sprintId = ''; next.sprintName = '' }
      else if (slot === 'userStoryKey') next.userStoryKey = ''
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setState({ ...DEFAULT_STATE })
  }, [])

  const value = useMemo(() => ({
    ...state,
    setQaProjectSlug,
    setJiraProjectKey,
    setSprint,
    setUserStoryKey,
    setQuickPackTargets,
    setStlcPackTargets,
    clearPin,
    clearAll,
  }), [
    state,
    setQaProjectSlug,
    setJiraProjectKey,
    setSprint,
    setUserStoryKey,
    setQuickPackTargets,
    setStlcPackTargets,
    clearPin,
    clearAll,
  ])

  return (
    <SessionPrefsContext.Provider value={value}>{children}</SessionPrefsContext.Provider>
  )
}

export function useSessionPrefs() {
  const ctx = useContext(SessionPrefsContext)
  if (!ctx) throw new Error('useSessionPrefs must be used within SessionPrefsProvider')
  return ctx
}
