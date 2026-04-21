import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function BugReports() {
  const [mode, setMode] = useState('title')

  const titleFields = [
    { key: 'bug_title', label: 'Bug title', type: 'text', placeholder: 'e.g. Account merge loses custom field data' },
  ]

  const fullFields = [
    { key: 'bug_description', label: 'What went wrong?', type: 'textarea', rows: 4 },
    { key: 'steps', label: 'Steps to reproduce', hint: 'leave blank — AI drafts placeholder steps', type: 'textarea', rows: 4, required: false, advanced: true },
    { key: 'expected', label: 'Expected result', hint: 'leave blank — AI infers from description', type: 'textarea', rows: 2, required: false, advanced: true },
    { key: 'actual', label: 'Actual result', hint: 'leave blank — AI infers from description', type: 'textarea', rows: 2, required: false, advanced: true },
    {
      key: 'environment',
      label: 'Environment',
      type: 'select',
      optionsByMode: {
        salesforce: ['Full Sandbox', 'Partial Sandbox', 'Developer Sandbox', 'UAT', 'Production'],
        general: ['Dev', 'Staging', 'UAT', 'Production'],
      },
      required: false,
      advanced: true,
    },
  ]

  return (
    <div>
      <PageHeader agentName="bug_report" />
      <div className="flex gap-2 mb-6">
        {['title', 'full'].map(m => (
          <button key={m} onClick={() => setMode(m)} className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${mode === m ? 'bg-toon-coral text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {m === 'title' ? '🏷️ Title Only' : '📋 Full Form'}
          </button>
        ))}
      </div>
      <AgentForm agentName="bug_report" sheetTitle="BugReport" fields={mode === 'title' ? titleFields : fullFields} />
    </div>
  )
}
