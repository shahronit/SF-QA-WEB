import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'
import SFOrgLogin from '../components/SFOrgLogin'

export default function SmokeTests() {
  const [orgMetadata, setOrgMetadata] = useState('')

  const fields = [
    { key: 'deployment_scope', label: 'What shipped? (components, stories, tickets)', type: 'textarea', rows: 5, placeholder: 'Describe the deployment scope...' },
    { key: 'org_type', label: 'Where are you verifying?', type: 'select', options: ['Full Sandbox', 'UAT', 'Staging', 'Production', 'Developer Sandbox'] },
    { key: 'release_date', label: 'Release date', type: 'text', placeholder: 'YYYY-MM-DD', required: false },
  ]

  if (orgMetadata) {
    fields.push({
      key: 'org_metadata',
      type: 'hidden',
      defaultValue: orgMetadata,
    })
  }

  return (
    <div>
      <PageHeader agentName="smoke" />
      <SFOrgLogin onMetadata={setOrgMetadata} />
      <AgentForm
        agentName="smoke"
        sheetTitle="Smoke"
        fields={fields}
        extraInput={orgMetadata ? { org_metadata: orgMetadata } : {}}
      />
    </div>
  )
}
