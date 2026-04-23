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
    {
      key: 'deployment_scope',
      labelByMode: {
        salesforce: 'What shipped this release? (objects, flows, profiles, components)',
        general: 'What shipped this release? (features, screens, APIs, components)',
      },
      hint:
        'AI generates production-ready smoke test cases from this scope — be specific. Every case will trace back here.',
      type: 'textarea',
      rows: 5,
      placeholderByMode: {
        salesforce:
          'e.g. New custom object Order__c, validation rule on Account.Industry, profile change for Sales Rep, LWC component on Opportunity record page…',
        general:
          'e.g. New /checkout page, updated cart API, role change for Standard User, password-reset flow…',
      },
    },
    {
      key: 'org_type',
      labelByMode: {
        salesforce: 'Where are you verifying?',
        general: 'Where are you verifying?',
      },
      type: 'select',
      optionsByMode: {
        salesforce: ['Full Sandbox', 'UAT', 'Staging', 'Production', 'Developer Sandbox'],
        general: ['Dev', 'Staging', 'UAT', 'Production'],
      },
      required: false,
      advanced: true,
    },
    {
      key: 'release_date',
      label: 'Release date',
      type: 'text',
      placeholder: 'YYYY-MM-DD',
      required: false,
      advanced: true,
    },
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
