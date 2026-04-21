import { useState, useEffect } from 'react'
import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'
import SFOrgLogin from '../components/SFOrgLogin'
import { useQaMode } from '../hooks/useQaMode'

export default function Regression() {
  const [orgMetadata, setOrgMetadata] = useState('')
  const [qaMode] = useQaMode()

  // Drop any previously imported Salesforce org metadata when the user
  // switches to General QA mode so it can't leak into a non-Salesforce run.
  useEffect(() => {
    if (qaMode !== 'salesforce' && orgMetadata) setOrgMetadata('')
  }, [qaMode, orgMetadata])

  const fields = [
    { key: 'changed_features', label: 'What changed in this release?', type: 'textarea', rows: 4, placeholder: 'Describe what was changed...' },
    { key: 'impacted_areas', label: 'What else might break?', hint: 'leave blank — AI infers impact from what changed', type: 'textarea', rows: 3, placeholder: 'List impacted areas...', required: false, advanced: true },
  ]

  return (
    <div>
      <PageHeader agentName="regression" />
      {qaMode === 'salesforce' && <SFOrgLogin onMetadata={setOrgMetadata} />}
      <AgentForm
        agentName="regression"
        sheetTitle="Regression"
        fields={fields}
        extraInput={orgMetadata && qaMode === 'salesforce' ? { org_metadata: orgMetadata } : {}}
      />
    </div>
  )
}
