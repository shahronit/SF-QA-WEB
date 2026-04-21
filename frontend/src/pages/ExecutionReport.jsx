import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function ExecutionReport() {
  return (
    <div>
      <PageHeader agentName="exec_report" />
      <AgentForm
        agentName="exec_report"
        sheetTitle="ExecutionReport"
        fields={[
          { key: 'executed', label: 'Test cases executed', type: 'text', placeholder: 'e.g. 124' },
          { key: 'passed', label: 'Passed', type: 'text', placeholder: 'e.g. 108' },
          { key: 'failed', label: 'Failed', type: 'text', placeholder: 'e.g. 12' },
          { key: 'cycle_name', label: 'Cycle name', hint: 'leave blank — AI auto-names with today\'s date', type: 'text', placeholder: 'e.g. Sprint 24 Regression, Release 2026.04 Smoke', required: false, advanced: true },
          { key: 'blocked', label: 'Blocked', hint: 'leave blank — defaults to 0', type: 'text', placeholder: 'e.g. 4', required: false, advanced: true },
          { key: 'defects_summary', label: 'Defects summary', type: 'textarea', rows: 4, placeholder: 'Paste defect IDs / titles / severity / status, one per line', required: false, advanced: true },
          {
            key: 'coverage_notes',
            label: 'Coverage notes',
            type: 'textarea',
            rows: 3,
            placeholderByMode: {
              salesforce: 'e.g. Account, Contact, Lead modules complete. Opportunity flow deferred to next cycle.',
              general: 'e.g. User, Order, Product modules complete. Checkout flow deferred to next cycle.',
            },
            required: false,
            advanced: true,
          },
        ]}
      />
    </div>
  )
}
