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
          {
            key: 'business_scope',
            label: 'Business scope',
            type: 'textarea',
            rows: 5,
            placeholderByMode: {
              salesforce: 'Describe the business processes / features the business will validate. e.g. Lead-to-Cash, Service Console agent flow, Partner self-service onboarding...',
              general: 'Describe the business processes / features the business will validate. e.g. Order-to-Cash flow, customer support workflow, partner self-service onboarding...',
            },
          },
          {
            key: 'user_personas',
            label: 'User personas',
            hint: 'leave blank — AI derives 2-4 personas from the scope',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. Sales Rep, Sales Manager, Service Agent, Partner Admin',
              general: 'e.g. End User, Customer Support Agent, Partner Admin',
            },
            required: false,
            advanced: true,
          },
          { key: 'acceptance_criteria', label: 'Acceptance criteria', type: 'textarea', rows: 4, placeholder: 'Paste known acceptance criteria from the user stories or business sign-off, one per line', required: false, advanced: true },
        ]}
      />
    </div>
  )
}
