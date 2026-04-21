import { createContext, useContext, useState, useCallback } from 'react'

const AgentResultsContext = createContext(null)

const AGENT_LABELS = {
  requirement: 'Requirements Analysis',
  testcase: 'Test Cases',
  bug_report: 'Bug Report',
  smoke: 'Smoke Tests',
  regression: 'Regression Tests',
  estimation: 'Estimation',
  test_strategy: 'Test Strategy',
  test_plan: 'Test Plan',
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

  const saveResult = useCallback((agentName, content) => {
    setResults(prev => ({
      ...prev,
      [agentName]: {
        content,
        timestamp: Date.now(),
        label: AGENT_LABELS[agentName] || agentName,
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
