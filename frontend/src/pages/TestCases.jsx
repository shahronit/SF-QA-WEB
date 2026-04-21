import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function TestCases() {
  return (
    <div>
      <PageHeader agentName="testcase" />
      <AgentForm
        agentName="testcase"
        sheetTitle="TestCases"
        fields={[
          { key: 'requirements', label: 'Requirements or acceptance criteria', type: 'textarea', rows: 6, placeholder: 'Enter your acceptance criteria...' },
          {
            key: 'objects',
            labelByMode: {
              salesforce: 'Primary Salesforce objects',
              general: 'Primary entities / pages under test',
            },
            hint: 'leave blank — AI infers from the requirements',
            type: 'text',
            placeholderByMode: {
              salesforce: 'Lead, Opportunity, Case…',
              general: 'User, Order, Product, Cart…',
            },
            required: false,
            advanced: true,
          },
          { key: 'additional_context', label: 'Extra context', type: 'textarea', rows: 3, placeholder: 'Any additional context...', required: false, advanced: true },
        ]}
      />
    </div>
  )
}
