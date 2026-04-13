import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function Requirements() {
  return (
    <div>
      <PageHeader icon="📝" title="Requirements" subtitle="User story analysis" gradient="from-blue-600 to-blue-500" />
      <AgentForm
        agentName="requirement"
        sheetTitle="Requirements"
        fields={[
          { key: 'user_story', label: 'User story or feature description', type: 'textarea', rows: 8, placeholder: 'As a… I want… So that…' },
        ]}
      />
    </div>
  )
}
