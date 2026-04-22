import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api/client'

const TestManagementContext = createContext(null)

export function TestManagementProvider({ children }) {
  const [status, setStatus] = useState({ jira: false, xray: false, zephyr: false })
  const [loading, setLoading] = useState(false)

  const refreshStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/test-management/status')
      setStatus({
        jira: !!data.jira,
        xray: !!data.xray,
        zephyr: !!data.zephyr,
      })
      return data
    } catch {
      setStatus({ jira: false, xray: false, zephyr: false })
      return { jira: false, xray: false, zephyr: false }
    }
  }, [])

  useEffect(() => {
    if (localStorage.getItem('token')) refreshStatus()
  }, [refreshStatus])

  const connectXray = useCallback(async ({ client_id, client_secret }) => {
    setLoading(true)
    try {
      const { data } = await api.post('/test-management/connect/xray', {
        client_id,
        client_secret,
      })
      await refreshStatus()
      return data
    } finally {
      setLoading(false)
    }
  }, [refreshStatus])

  const connectZephyr = useCallback(async ({ api_token, jira_url }) => {
    setLoading(true)
    try {
      const { data } = await api.post('/test-management/connect/zephyr', {
        api_token,
        jira_url,
      })
      await refreshStatus()
      return data
    } finally {
      setLoading(false)
    }
  }, [refreshStatus])

  const disconnect = useCallback(async (target) => {
    if (target !== 'xray' && target !== 'zephyr') return
    setLoading(true)
    try {
      await api.post(`/test-management/disconnect/${target}`)
      await refreshStatus()
    } finally {
      setLoading(false)
    }
  }, [refreshStatus])

  const parse = useCallback(async (markdown) => {
    const { data } = await api.post('/test-management/parse', { markdown })
    return data
  }, [])

  const push = useCallback(async ({ target, project_key, testcases, issuetype, user_story_key }) => {
    const body = { target, project_key, testcases }
    if (issuetype) body.issuetype = issuetype
    if (user_story_key) body.user_story_key = user_story_key
    const { data } = await api.post('/test-management/push', body)
    return data
  }, [])

  return (
    <TestManagementContext.Provider
      value={{
        status,
        loading,
        refreshStatus,
        connectXray,
        connectZephyr,
        disconnect,
        parse,
        push,
      }}
    >
      {children}
    </TestManagementContext.Provider>
  )
}

export function useTestManagement() {
  const ctx = useContext(TestManagementContext)
  if (!ctx) throw new Error('useTestManagement must be used within TestManagementProvider')
  return ctx
}
