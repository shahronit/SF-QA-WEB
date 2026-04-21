import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function CopadoScript() {
  return (
    <div>
      <PageHeader agentName="copado_script" />
      <AgentForm
        agentName="copado_script"
        sheetTitle="CopadoScripts"
        fields={[
          { key: 'test_cases', label: 'Test cases to automate', type: 'textarea', rows: 6, placeholder: 'Paste test case steps or describe the scenarios to automate...' },
          {
            key: 'salesforce_objects',
            labelByMode: {
              salesforce: 'Salesforce objects under test',
              general: 'Entities / pages under test',
            },
            hint: 'leave blank — AI infers from the test cases',
            type: 'text',
            placeholderByMode: {
              salesforce: 'Lead, Opportunity, Account, Case...',
              general: 'User, Cart, Checkout, Order...',
            },
            required: false,
            advanced: true,
          },
          {
            key: 'login_url',
            labelByMode: {
              salesforce: 'Salesforce login URL',
              general: 'Application login URL',
            },
            type: 'text',
            placeholderByMode: {
              salesforce: 'https://yourdomain.my.salesforce.com',
              general: 'https://app.example.com',
            },
            required: false,
            advanced: true,
          },
        ]}
      />
    </div>
  )
}
