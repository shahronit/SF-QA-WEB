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
          { key: 'defect_summary', label: 'Defect summary', type: 'text', placeholder: 'e.g. Opportunity stage does not auto-update after deal closure' },
          { key: 'symptoms', label: 'Symptoms / observations', type: 'textarea', rows: 5, placeholder: 'Describe what users see, error messages, frequency, screenshots, business impact...' },
          { key: 'environment', label: 'Environment (optional)', type: 'text', placeholder: 'e.g. Production, Sandbox UAT-2, Release 2026.04', required: false },
          { key: 'recent_changes', label: 'Recent changes (optional)', type: 'textarea', rows: 4, placeholder: 'List recent deployments, config changes, data loads in the last 7 days', required: false },
        ]}
      />
    </div>
  )
}
