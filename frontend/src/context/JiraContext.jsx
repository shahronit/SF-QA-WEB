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

  const listIssues = useCallback(async (projectKey, issueType = '', maxResults = 50) => {
    const { data } = await api.get('/jira/issues', {
      params: { project_key: projectKey, issue_type: issueType, max_results: maxResults },
    })
    return data.issues || []
  }, [])

  const getIssue = useCallback(async (issueKey) => {
    const { data } = await api.get(`/jira/issue/${issueKey}`)
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
        getIssue,
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
