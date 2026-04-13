import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function TestCases() {
  return (
    <div>
      <PageHeader icon="🧪" title="Test Cases" subtitle="Generate coverage tables" gradient="from-toon-mint to-emerald-400" />
      <AgentForm
        agentName="testcase"
        sheetTitle="TestCases"
        fields={[
          { key: 'requirements', label: 'Requirements or acceptance criteria', type: 'textarea', rows: 6, placeholder: 'Enter your acceptance criteria...' },
          { key: 'objects', label: 'Primary Salesforce objects', type: 'text', placeholder: 'Lead, Opportunity, Case…' },
          { key: 'additional_context', label: 'Extra context', type: 'textarea', rows: 3, placeholder: 'Any additional context...', required: false },
        ]}
      />
    </div>
  )
}
