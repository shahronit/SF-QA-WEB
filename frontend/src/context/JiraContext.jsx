import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api/client'

const JiraContext = createContext(null)

export function JiraProvider({ children }) {
  const [connected, setConnected] = useState(false)
  const [jiraUrl, setJiraUrl] = useState('')
  const [email, setEmail] = useState('')
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/jira/status')
      setConnected(!!data.connected)
      setJiraUrl(data.jira_url || '')
      setEmail(data.email || '')
      setProjects(data.projects || [])
      return data
    } catch {
      setConnected(false)
      return { connected: false }
    }
  }, [])

  useEffect(() => {
    if (localStorage.getItem('token')) refreshStatus()
  }, [refreshStatus])

  const connect = useCallback(async ({ jira_url, email, api_token }) => {
    setLoading(true)
    try {
      const { data } = await api.post('/jira/connect', { jira_url, email, api_token })
      setConnected(true)
      setJiraUrl(jira_url.replace(/\/$/, ''))
      setEmail(email)
      setProjects(data.projects || [])
      return data
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setLoading(true)
    try {
      await api.post('/jira/disconnect')
      setConnected(false)
      setJiraUrl('')
      setEmail('')
      setProjects([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Accepts either the legacy positional form
  //   listIssues(projectKey, issueType, maxResults)
  // or an options object as the second argument:
  //   listIssues(projectKey, { issueType, maxResults, sprintId, activeSprintsOnly })
  const listIssues = useCallback(async (projectKey, issueTypeOrOpts = '', maxResults = 50) => {
    let issueType = ''
    let max = maxResults
    let sprintId = null
    let activeSprintsOnly = false
    if (issueTypeOrOpts && typeof issueTypeOrOpts === 'object') {
      issueType = issueTypeOrOpts.issueType || ''
      if (typeof issueTypeOrOpts.maxResults === 'number') max = issueTypeOrOpts.maxResults
      sprintId = issueTypeOrOpts.sprintId ?? null
      activeSprintsOnly = !!issueTypeOrOpts.activeSprintsOnly
    } else {
      issueType = issueTypeOrOpts || ''
    }
    const params = {
      project_key: projectKey,
      issue_type: issueType,
      max_results: max,
    }
    if (sprintId !== null && sprintId !== undefined && sprintId !== '') {
      params.sprint_id = sprintId
    } else if (activeSprintsOnly) {
      params.active_sprints_only = true
    }
    const { data } = await api.get('/jira/issues', { params })
    return data.issues || []
  }, [])

  const listSprints = useCallback(async (projectKey) => {
    if (!projectKey) return { board_id: null, board_name: null, sprints: [], reason: 'no_project' }
    try {
      const { data } = await api.get('/jira/sprints', {
        params: { project_key: projectKey },
      })
      return data || { sprints: [] }
    } catch {
      // Best-effort: agile API can be 403 for users without board access.
      // The picker treats this as "no sprints available" without raising.
      return { board_id: null, board_name: null, sprints: [], reason: 'fetch_error' }
    }
  }, [])

  const getIssue = useCallback(async (issueKey) => {
    const { data } = await api.get(`/jira/issue/${issueKey}`)
    return data
  }, [])

  // Rich detail fetch — pulls every category (core fields with fields=*all,
  // comments, changelog, worklogs, remote_links, watchers, votes,
  // transitions, attachments, linked_issues, subtasks, sprint, epic, plus
  // any custom fields the tenant defines like Acceptance Criteria) from
  // /jira/issue/{key}/full. Use this anywhere we need the full ticket
  // context — picker detail panel, single-import seed, multi-import scope,
  // on-blur auto-import.
  const getFullIssue = useCallback(async (issueKey) => {
    const { data } = await api.get(`/jira/issue/${issueKey}/full`)
    return data
  }, [])

  const resolveFromText = useCallback(async (text) => {
    if (!text || typeof text !== 'string') return { key: null }
    try {
      const { data } = await api.post('/jira/resolve', { text })
      return data || { key: null }
    } catch {
      return { key: null }
    }
  }, [])

  return (
    <JiraContext.Provider
      value={{
        connected,
        jiraUrl,
        email,
        projects,
        loading,
        connect,
        disconnect,
        refreshStatus,
        listIssues,
        listSprints,
        getIssue,
        getFullIssue,
        resolveFromText,
      }}
    >
      {children}
    </JiraContext.Provider>
  )
}

export function useJira() {
  const ctx = useContext(JiraContext)
  if (!ctx) throw new Error('useJira must be used within JiraProvider')
  return ctx
}
