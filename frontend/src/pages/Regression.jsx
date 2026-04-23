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
    {
      key: 'changed_features',
      labelByMode: {
        salesforce: 'What changed in this release? (objects, flows, validations, profiles)',
        general: 'What changed in this release? (features, APIs, business rules, roles)',
      },
      hint:
        'AI generates regression test cases tied 1:1 to what changed. Be specific so the suite stays focused.',
      type: 'textarea',
      rows: 4,
      placeholderByMode: {
        salesforce:
          'e.g. Updated Opportunity_Stage validation rule, refactored Account merge flow, new Apex trigger on Case…',
        general:
          'e.g. Updated checkout total calculation, refactored notification webhook, new role permission for Read-Only…',
      },
    },
    {
      key: 'impacted_areas',
      labelByMode: {
        salesforce:
          'Which other Salesforce areas might break? (related objects, flows, integrations)',
        general:
          'Which other product areas might break? (related entities, jobs, integrations)',
      },
      hint: 'leave blank — AI infers impact from what changed',
      type: 'textarea',
      rows: 3,
      placeholderByMode: {
        salesforce:
          'e.g. Account roll-up summary, Order trigger, integration to ERP, Sales Rep profile…',
        general:
          'e.g. Cart total calculation, fulfilment job, ERP webhook, Standard User permission…',
      },
      required: false,
      advanced: true,
    },
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
