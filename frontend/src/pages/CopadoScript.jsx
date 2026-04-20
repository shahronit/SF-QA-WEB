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
          { key: 'salesforce_objects', label: 'Salesforce objects', type: 'text', placeholder: 'Lead, Opportunity, Account, Case...' },
          { key: 'login_url', label: 'Salesforce login URL', type: 'text', placeholder: 'https://yourdomain.my.salesforce.com', required: false },
        ]}
      />
    </div>
  )
}
