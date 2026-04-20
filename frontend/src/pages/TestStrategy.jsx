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
          { key: 'objectives', label: 'Test objectives', type: 'textarea', rows: 3, placeholder: 'What are the goals of testing? e.g. Validate end-to-end flows, ensure data integrity...' },
          { key: 'constraints', label: 'Constraints & timelines', type: 'text', placeholder: 'e.g. 3-week timeline, 2 QA resources, sandbox-only', required: false },
        ]}
      />
    </div>
  )
}
