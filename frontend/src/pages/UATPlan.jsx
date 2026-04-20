import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function UATPlan() {
  return (
    <div>
      <PageHeader agentName="uat_plan" />
      <AgentForm
        agentName="uat_plan"
        sheetTitle="UATPlan"
        fields={[
          { key: 'business_scope', label: 'Business scope', type: 'textarea', rows: 5, placeholder: 'Describe the business processes / features the business will validate. e.g. Lead-to-Cash, Service Console agent flow, Partner self-service onboarding...' },
          { key: 'user_personas', label: 'User personas', type: 'text', placeholder: 'e.g. Sales Rep, Sales Manager, Service Agent, Partner Admin' },
          { key: 'acceptance_criteria', label: 'Acceptance criteria (optional)', type: 'textarea', rows: 4, placeholder: 'Paste known acceptance criteria from the user stories or business sign-off, one per line', required: false },
        ]}
      />
    </div>
  )
}
