import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function Estimation() {
  return (
    <div>
      <PageHeader icon="📊" title="Estimation" subtitle="Effort hours with buffer" gradient="from-toon-purple to-violet-400" />
      <AgentForm
        agentName="estimation"
        sheetTitle="Estimation"
        fields={[
          { key: 'test_cases', label: 'Paste test cases or describe scope', type: 'textarea', rows: 6, placeholder: 'Paste test cases here...' },
          { key: 'team_size', label: 'QA headcount', type: 'text', placeholder: '2', required: false },
          { key: 'sprint_capacity_hrs', label: 'Hours per person per sprint', type: 'text', placeholder: '40', required: false },
        ]}
      />
    </div>
  )
}
