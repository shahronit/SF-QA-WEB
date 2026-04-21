import { useState, useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'
import SFOrgLogin from '../components/SFOrgLogin'
import { useQaMode } from '../hooks/useQaMode'

export default function SmokeTests() {
  const [orgMetadata, setOrgMetadata] = useState('')
  const [qaMode] = useQaMode()

  // Drop any previously imported Salesforce org metadata when the user
  // switches to General QA mode so it can't leak into a non-Salesforce run.
  useEffect(() => {
    if (qaMode !== 'salesforce' && orgMetadata) setOrgMetadata('')
  }, [qaMode, orgMetadata])

  const fields = [
    { key: 'deployment_scope', label: 'What shipped? (components, stories, tickets)', type: 'textarea', rows: 5, placeholder: 'Describe the deployment scope...' },
    {
      key: 'org_type',
      label: 'Where are you verifying?',
      type: 'select',
      optionsByMode: {
        salesforce: ['Full Sandbox', 'UAT', 'Staging', 'Production', 'Developer Sandbox'],
        general: ['Dev', 'Staging', 'UAT', 'Production'],
      },
      required: false,
      advanced: true,
    },
    { key: 'release_date', label: 'Release date', type: 'text', placeholder: 'YYYY-MM-DD', required: false, advanced: true },
  ]

  return (
    <div>
      <PageHeader agentName="smoke" />
      {qaMode === 'salesforce' && <SFOrgLogin onMetadata={setOrgMetadata} />}
      <AgentForm
        agentName="smoke"
        sheetTitle="Smoke"
        fields={fields}
        extraInput={orgMetadata && qaMode === 'salesforce' ? { org_metadata: orgMetadata } : {}}
      />
    </div>
  )
}
