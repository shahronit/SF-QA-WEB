import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function TestStrategy() {
  return (
    <div>
      <PageHeader agentName="test_strategy" />
      <AgentForm
        agentName="test_strategy"
        sheetTitle="TestStrategy"
        fields={[
          { key: 'project_description', label: 'Project description', type: 'textarea', rows: 5, placeholder: 'Describe the project, features, and modules to be tested...' },
          { key: 'objectives', label: 'Test objectives', hint: 'leave blank — AI derives 3-5 objectives from the description', type: 'textarea', rows: 3, placeholder: 'What are the goals of testing? e.g. Validate end-to-end flows, ensure data integrity...', required: false, advanced: true },
          {
            key: 'constraints',
            label: 'Constraints & timelines',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. 3-week timeline, 2 QA resources, sandbox-only',
              general: 'e.g. 3-week timeline, 2 QA resources, staging-only',
            },
            required: false,
            advanced: true,
          },
        ]}
      />
    </div>
  )
}
