import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function AutomationPlan() {
  return (
    <div>
      <PageHeader agentName="automation_plan" />
      <AgentForm
        agentName="automation_plan"
        sheetTitle="AutomationPlan"
        fields={[
          { key: 'test_cases_or_scope', label: 'Test cases or automation scope', type: 'textarea', rows: 5, placeholder: 'Paste test cases to automate or describe the automation scope...' },
          {
            key: 'tools',
            label: 'Automation tools',
            hint: 'leave blank — AI picks a sensible default for this mode',
            type: 'text',
            placeholderByMode: {
              salesforce: 'Copado Robotic Testing, Provar, Selenium...',
              general: 'Playwright, Cypress, Robot+Selenium, Postman...',
            },
            required: false,
            advanced: true,
          },
          {
            key: 'team_skills',
            label: 'Team skills & experience',
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. 2 QA with Robot Framework, 1 SDET with Apex',
              general: 'e.g. 2 QA with Playwright, 1 SDET with Python + REST',
            },
            required: false,
            advanced: true,
          },
        ]}
      />
    </div>
  )
}
