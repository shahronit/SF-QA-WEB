import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function RTM() {
  return (
    <div>
      <PageHeader agentName="rtm" />
      <AgentForm
        agentName="rtm"
        sheetTitle="RTM"
        fields={[
          { key: 'requirements', label: 'Requirements / user stories', type: 'textarea', rows: 6, placeholder: 'Paste requirements here. e.g.\nREQ_001: User can log in with email and password\nREQ_002: System sends welcome email on registration' },
          { key: 'test_cases', label: 'Test cases', hint: 'leave blank — AI derives coverage from requirements + linked output', type: 'textarea', rows: 6, placeholder: 'Paste test cases here. e.g.\nTC_001: Verify successful login with valid credentials -> REQ_001\nTC_002: Verify invalid password shows error -> REQ_001', required: false, advanced: true },
          { key: 'defects', label: 'Defects', type: 'textarea', rows: 4, placeholder: 'Paste defect list. e.g.\nDEF_001: Login fails on Safari (TC_001, REQ_001)', required: false, advanced: true },
        ]}
      />
    </div>
  )
}
