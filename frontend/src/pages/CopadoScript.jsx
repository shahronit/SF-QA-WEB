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
            advanced: false,
            optionsByMode: {
              salesforce: [
                { value: 'Copado Robotic Testing (Robot Framework + QWeb/QForce)', label: 'Copado Robotic Testing — Robot Framework + QWeb/QForce (recommended for Salesforce)' },
                { value: 'Provar', label: 'Provar — dedicated Salesforce test automation (point-and-click + Apex)' },
                { value: 'UTAM (Salesforce UI Test Automation Model)', label: 'UTAM — Salesforce\'s official page-object UI framework' },
                { value: 'Playwright (TypeScript)', label: 'Playwright (TypeScript) — cross-browser, works with Lightning Experience' },
                { value: 'Cypress', label: 'Cypress — component + E2E, good Lightning support' },
                { value: 'Robot Framework + SeleniumLibrary', label: 'Robot Framework + SeleniumLibrary — keyword-driven web automation' },
                { value: 'Selenium (Java) + TestNG', label: 'Selenium (Java) + TestNG — traditional enterprise Java stack' },
                { value: 'Jest + @salesforce/lwc-jest', label: 'Jest + lwc-jest — LWC unit tests (component-level, no browser)' },
              ],
              general: [
                { value: 'Playwright (TypeScript)', label: 'Playwright (TypeScript) — recommended for modern web E2E' },
                { value: 'Cypress', label: 'Cypress — E2E + component testing' },
                { value: 'WebdriverIO (JavaScript)', label: 'WebdriverIO — flexible, supports Selenium & DevTools protocols' },
                { value: 'TestCafe', label: 'TestCafe — zero-dependency E2E, no WebDriver required' },
                { value: 'Robot Framework + SeleniumLibrary', label: 'Robot Framework + SeleniumLibrary — keyword-driven web automation' },
                { value: 'Selenium (Python) + pytest', label: 'Selenium (Python) + pytest — classic Python web automation' },
                { value: 'Pytest + Requests (API)', label: 'Pytest + Requests — REST / API functional testing' },
                { value: 'Postman / Newman (API)', label: 'Postman / Newman — collection-based API testing + CI runner' },
                { value: 'k6 (Load / Performance)', label: 'k6 — JavaScript-based load & performance testing' },
                { value: 'Appium (Mobile)', label: 'Appium — iOS / Android mobile automation' },
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
