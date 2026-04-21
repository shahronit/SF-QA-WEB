import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function RCA() {
  return (
    <div>
      <PageHeader agentName="rca" />
      <AgentForm
        agentName="rca"
        sheetTitle="RCA"
        fields={[
          { key: 'symptoms', label: 'Symptoms / observations', type: 'textarea', rows: 5, placeholder: 'Describe what users see, error messages, frequency, screenshots, business impact...' },
          {
            key: 'defect_summary',
            label: 'Defect summary',
            hint: 'leave blank — AI derives a one-liner from the symptoms',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. Opportunity stage does not auto-update after deal closure',
              general: 'e.g. Order status does not auto-update after checkout',
            },
            required: false,
            advanced: true,
          },
          {
            key: 'environment',
            label: 'Environment',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. Production, Sandbox UAT-2, Release 2026.04',
              general: 'e.g. Production, Staging-2, Release 2026.04',
            },
            required: false,
            advanced: true,
          },
          { key: 'recent_changes', label: 'Recent changes', type: 'textarea', rows: 4, placeholder: 'List recent deployments, config changes, data loads in the last 7 days', required: false, advanced: true },
        ]}
      />
    </div>
  )
}
