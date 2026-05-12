import { useCallback, useEffect, useState } from 'react'
import api from '../api/client'

const EMPTY = {
  window: '30d',
  since: null,
  scope: 'user',
  username: '',
  totals: {
    runs: 0,
    jira_bugs: 0,
    jira_comments: 0,
    projects_active: 0,
    activity_events: 0,
  },
  per_agent: [],
  // One entry per agent slug the caller has touched in this window —
  // shape `{agent, runs, latest_ts, spark, structured}`. The Hub's
  // "Agent insights" grid reads this directly. Always an array so
  // consumers don't have to branch on undefined before the first
  // fetch resolves.
  per_agent_insights: [],
  daily: [],
  recent: [],
}

/**
 * Fetch the per-user Dashboard payload (`GET /api/me/dashboard`) and
 * keep it in component state. Re-fetches whenever *window* changes so
 * the parent component can drive the 7d/30d/90d/All picker without
 * having to plumb a setter into every child widget.
 *
 * Returns ``{data, loading, error, reload}``:
 *   - `data` always conforms to the response shape, even before the
 *     first fetch resolves, so widgets can render zero-state without
 *     branching on undefined.
 *   - `reload()` is exposed so a "Refresh" button or a successful
 *     in-app push (Create Bug → expect the chart to bump) can pull
 *     fresh numbers without remounting.
 */
export function useDashboardData(windowKey = '30d') {
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchOnce = useCallback(async (signal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/me/dashboard', {
        params: { window: windowKey },
        signal,
      })
      setData({ ...EMPTY, ...(res.data || {}) })
    } catch (err) {
      if (err?.name === 'CanceledError' || err?.code === 'ERR_CANCELED') return
      setError(err?.response?.data?.detail || err?.message || 'Failed to load dashboard')
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [windowKey])

  useEffect(() => {
    const controller = new AbortController()
    fetchOnce(controller.signal)
    return () => controller.abort()
  }, [fetchOnce])

  const reload = useCallback(() => fetchOnce(), [fetchOnce])

  return { data, loading, error, reload }
}
