import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function CopadoScript() {
  return (
    <div>
      <PageHeader agentName="copado_script" />
      <AgentForm
        agentName="copado_script"
        sheetTitle="AutomationScripts"
        fields={[
          {
            key: 'test_cases',
            label: 'Test cases / scenarios to automate',
            type: 'textarea',
            rows: 6,
            placeholder: 'Paste test case steps, acceptance criteria, or describe the scenarios to automate…',
          },
          {
            key: 'framework',
            labelByMode: {
              salesforce: 'Automation framework',
              general: 'Automation framework',
            },
            type: 'select',
            required: true,
            optionsByMode: {
              salesforce: [
                { value: 'Copado Robotic Testing (Robot Framework + QWeb/QForce)', label: 'Copado Robotic Testing — Robot Framework + QWeb/QForce (recommended for Salesforce)' },
                { value: 'Robot Framework + SeleniumLibrary', label: 'Robot Framework + SeleniumLibrary' },
                { value: 'Playwright (TypeScript)', label: 'Playwright (TypeScript)' },
                { value: 'Cypress', label: 'Cypress' },
              ],
              general: [
                { value: 'Playwright (TypeScript)', label: 'Playwright (TypeScript) — recommended' },
                { value: 'Cypress', label: 'Cypress' },
                { value: 'Robot Framework + SeleniumLibrary', label: 'Robot Framework + SeleniumLibrary' },
                { value: 'Selenium (Python)', label: 'Selenium (Python) + pytest' },
                { value: 'Pytest + Requests (API)', label: 'Pytest + Requests — REST / API testing' },
              ],
            },
          },
          {
            key: 'salesforce_objects',
            labelByMode: {
              salesforce: 'Salesforce objects under test',
              general: 'Entities / pages under test',
            },
            hint: 'leave blank — AI infers from the test cases',
            type: 'text',
            placeholderByMode: {
              salesforce: 'Lead, Opportunity, Account, Case…',
              general: 'User, Cart, Checkout, Order…',
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
