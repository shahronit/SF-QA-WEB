import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function TestPlanDoc() {
  return (
    <div>
      <PageHeader agentName="test_plan" />
      <AgentForm
        agentName="test_plan"
        sheetTitle="TestPlan"
        fields={[
          { key: 'scope', label: 'Test scope', type: 'textarea', rows: 5, placeholder: 'Describe features, modules, and objects in scope for testing...' },
          { key: 'test_strategy_summary', label: 'Test strategy summary or reference', type: 'textarea', rows: 3, placeholder: 'Paste the test strategy summary or key points (or link from previous agent)...', required: false },
          { key: 'environments', label: 'Environments', type: 'text', placeholder: 'e.g. Dev sandbox, Full sandbox, UAT, Production', required: false },
        ]}
      />
    </div>
  )
}
