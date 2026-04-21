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
          {
            key: 'scope',
            labelByMode: {
              salesforce: 'Test scope (objects in scope)',
              general: 'Test scope (modules / entities)',
            },
            type: 'textarea',
            rows: 5,
            placeholderByMode: {
              salesforce: 'Describe features, modules, and Salesforce objects in scope...',
              general: 'Describe features, modules, and entities in scope...',
            },
          },
          { key: 'test_strategy_summary', label: 'Test strategy summary or reference', hint: 'leave blank — AI drafts one from scope (and any linked output)', type: 'textarea', rows: 3, placeholder: 'Paste the test strategy summary or key points (or link from previous agent)...', required: false, advanced: true },
          {
            key: 'environments',
            label: 'Environments',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. Dev sandbox, Full sandbox, UAT, Production',
              general: 'e.g. Dev, Staging, UAT, Production',
            },
            required: false,
            advanced: true,
          },
        ]}
      />
    </div>
  )
}
