import { createContext, useContext, useState, useCallback } from 'react'

const AgentResultsContext = createContext(null)

export const AGENT_LABELS = {
  requirement: 'Requirements Analysis',
  testcase: 'Test Cases',
  bug_report: 'Bug Report',
  smoke: 'Smoke Test Plan - Checklist',
  regression: 'Regression Test Plan - Checklist',
  estimation: 'Estimation',
  test_strategy: 'Test Plan & Strategy',
  test_plan: 'Test Plan & Strategy',
  automation_plan: 'Automation Plan',
  copado_script: 'Automation Scripts',
  test_data: 'Test Data',
  rtm: 'Requirements Traceability Matrix',
  uat_plan: 'UAT Plan',
  exec_report: 'Test Execution Report',
  rca: 'Root Cause Analysis',
  closure_report: 'Test Closure Report',
}

export function AgentResultsProvider({ children }) {
  const [results, setResults] = useState({})

  // `meta` carries the per-run badges we surface in the UI without
  // polluting the chained-output content blob: provider/model the run
  // was routed to, the cached flag, and the canonical token-usage
  // envelope ({prompt_tokens, completion_tokens, total_tokens, source}).
  // Optional — older callers that omit it just keep the existing shape.
  const saveResult = useCallback((agentName, content, meta = null) => {
    setResults(prev => ({
      ...prev,
      [agentName]: {
        content,
        timestamp: Date.now(),
        label: AGENT_LABELS[agentName] || agentName,
        meta: meta || null,
      },
    }))
  }, [])

  const getAvailableResults = useCallback(
    (excludeAgent) =>
      Object.entries(results)
        .filter(([name]) => name !== excludeAgent)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.timestamp - a.timestamp),
    [results],
  )

  const clearResult = useCallback((agentName) => {
    setResults(prev => {
      const next = { ...prev }
      delete next[agentName]
      return next
    })
  }, [])

  return (
    <AgentResultsContext.Provider value={{ results, saveResult, getAvailableResults, clearResult }}>
      {children}
    </AgentResultsContext.Provider>
  )
}

export function useAgentResults() {
  const ctx = useContext(AgentResultsContext)
  if (!ctx) throw new Error('useAgentResults must be used within AgentResultsProvider')
  return ctx
}
