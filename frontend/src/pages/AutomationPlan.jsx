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
          { key: 'tools', label: 'Automation tools', type: 'text', placeholder: 'Copado Robotic Testing, Provar, Selenium...', required: false },
          { key: 'team_skills', label: 'Team skills & experience', type: 'text', placeholder: 'e.g. 2 QA with Robot Framework, 1 SDET with Apex', required: false },
        ]}
      />
    </div>
  )
}
