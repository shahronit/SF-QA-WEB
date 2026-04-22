import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function TestPlanDoc() {
  return (
    <div>
      <PageHeader agentName="test_plan" />
      <AgentForm
        agentName="test_plan"
        sheetTitle="TestPlanAndStrategy"
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
          {
            key: 'objectives',
            label: 'Test objectives',
            hint: 'leave blank — AI derives 3-5 SMART objectives from scope',
            type: 'textarea',
            rows: 3,
            placeholder: 'What are the goals of testing? e.g. Validate end-to-end flows, ensure data integrity...',
            required: false,
            advanced: true,
          },
          {
            key: 'constraints',
            label: 'Constraints & timelines',
            hint: 'feeds the Test Strategy schedule and risk sections',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. 3-week timeline, 2 QA resources, sandbox-only',
              general: 'e.g. 3-week timeline, 2 QA resources, staging-only',
            },
            required: false,
            advanced: true,
          },
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
          {
            key: 'test_strategy_summary',
            label: 'Existing strategy summary (legacy)',
            hint: 'leave blank — AI drafts a strategy summary from scope and linked output',
            type: 'textarea',
            rows: 3,
            placeholder: 'Paste an existing strategy summary if you have one...',
            required: false,
            advanced: true,
          },
        ]}
      />
    </div>
  )
}
