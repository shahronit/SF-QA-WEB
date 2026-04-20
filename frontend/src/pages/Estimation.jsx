import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function Estimation() {
  return (
    <div>
      <PageHeader agentName="estimation" />
      <AgentForm
        agentName="estimation"
        sheetTitle="Estimation"
        fields={[
          { key: 'test_cases', label: 'Test cases or scope description', type: 'textarea', rows: 6, placeholder: 'Paste test cases, user stories, or describe the testing scope here...' },
          { key: 'team_size', label: 'QA team size (headcount)', type: 'text', placeholder: '2', required: false },
          { key: 'sprint_capacity_hrs', label: 'Hours per person per sprint', type: 'text', placeholder: '40', required: false },
          { key: 'development_effort_hrs', label: 'Total development effort (hours) — for Ratio-Based estimation', type: 'text', placeholder: 'e.g. 500', required: false },
          { key: 'num_requirements', label: 'Number of requirements / use cases — for FPA & UCP estimation', type: 'text', placeholder: 'e.g. 12', required: false },
        ]}
      />
    </div>
  )
}
