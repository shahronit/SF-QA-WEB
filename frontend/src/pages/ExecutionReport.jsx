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
          { key: 'cycle_name', label: 'Cycle name', type: 'text', placeholder: 'e.g. Sprint 24 Regression, Release 2026.04 Smoke' },
          { key: 'executed', label: 'Test cases executed', type: 'text', placeholder: 'e.g. 124' },
          { key: 'passed', label: 'Passed', type: 'text', placeholder: 'e.g. 108' },
          { key: 'failed', label: 'Failed', type: 'text', placeholder: 'e.g. 12' },
          { key: 'blocked', label: 'Blocked', type: 'text', placeholder: 'e.g. 4' },
          { key: 'defects_summary', label: 'Defects summary (optional)', type: 'textarea', rows: 4, placeholder: 'Paste defect IDs / titles / severity / status, one per line', required: false },
          { key: 'coverage_notes', label: 'Coverage notes (optional)', type: 'textarea', rows: 3, placeholder: 'e.g. Account, Contact, Lead modules complete. Opportunity flow deferred to next cycle.', required: false },
        ]}
      />
    </div>
  )
}
