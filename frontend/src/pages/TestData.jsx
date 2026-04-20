import PageHeader from '../components/PageHeader'
import AgentForm from '../components/AgentForm'

export default function TestData() {
  return (
    <div>
      <PageHeader agentName="test_data" />
      <AgentForm
        agentName="test_data"
        sheetTitle="TestData"
        fields={[
          { key: 'objects', label: 'Salesforce objects', type: 'text', placeholder: 'e.g. Account, Contact, Opportunity, Custom_Object__c' },
          { key: 'record_count', label: 'Records per object', type: 'text', placeholder: 'e.g. 10 (default)', required: false },
          { key: 'format', label: 'Output format', type: 'select', options: ['CSV', 'SOQL_INSERT', 'JSON', 'APEX_TESTDATA'] },
          { key: 'field_constraints', label: 'Field constraints (optional)', type: 'textarea', rows: 3, placeholder: 'e.g. Industry=Banking, AnnualRevenue>1000000, Stage in (Prospecting, Qualification)', required: false },
        ]}
      />
    </div>
  )
}
