import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function ClosureReport() {
  return (
    <div>
      <PageHeader agentName="closure_report" />
      <AgentForm
        agentName="closure_report"
        sheetTitle="ClosureReport"
        fields={[
          { key: 'project_name', label: 'Project / release name', type: 'text', placeholder: 'e.g. Release 2026.04 — Service Cloud Console Revamp' },
          { key: 'cycle_summary', label: 'Cycle summary', type: 'textarea', rows: 5, placeholder: 'Describe what was tested, scope, dates, environments, team...' },
          { key: 'metrics', label: 'Metrics', type: 'textarea', rows: 5, placeholder: 'Planned vs executed counts, pass rate, automation %, defect counts, effort, schedule...' },
          { key: 'open_defects', label: 'Open defects at closure', type: 'textarea', rows: 4, placeholder: 'List open defects with ID, title, severity, status, workaround', required: false },
          { key: 'lessons_learned', label: 'Lessons learned (optional)', type: 'textarea', rows: 4, placeholder: 'What went well, what did not, ideas for next cycle', required: false },
        ]}
      />
    </div>
  )
}
