import { useState } from 'react'
import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'
import SFOrgLogin from '../components/SFOrgLogin'

export default function Regression() {
  const [orgMetadata, setOrgMetadata] = useState('')

  const fields = [
    { key: 'changed_features', label: 'What changed in this release?', type: 'textarea', rows: 4, placeholder: 'Describe what was changed...' },
    { key: 'impacted_areas', label: 'What else might break?', type: 'textarea', rows: 3, placeholder: 'List impacted areas...' },
  ]

  return (
    <div>
      <PageHeader icon="🔄" title="Regression" subtitle="Change impact analysis" gradient="from-toon-navy to-blue-700" />
      <SFOrgLogin onMetadata={setOrgMetadata} />
      <AgentForm
        agentName="regression"
        sheetTitle="Regression"
        fields={fields}
        extraInput={orgMetadata ? { org_metadata: orgMetadata } : {}}
      />
    </div>
  )
}
