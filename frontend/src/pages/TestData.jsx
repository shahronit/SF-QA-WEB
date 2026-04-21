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
          {
            key: 'objects',
            labelByMode: {
              salesforce: 'Salesforce objects',
              general: 'Entities / tables to seed',
            },
            type: 'text',
            placeholderByMode: {
              salesforce: 'e.g. Account, Contact, Opportunity, Custom_Object__c',
              general: 'e.g. users, orders, products, order_items',
            },
          },
          { key: 'record_count', label: 'Records per object', hint: 'leave blank — defaults to 10', type: 'text', placeholder: 'e.g. 10 (default)', required: false, advanced: true },
          {
            key: 'format',
            label: 'Output format',
            type: 'select',
            optionsByMode: {
              salesforce: ['CSV', 'SOQL_INSERT', 'JSON', 'APEX_TESTDATA'],
              general: ['CSV', 'SQL_INSERT', 'JSON'],
            },
            required: false,
            advanced: true,
          },
          { key: 'field_constraints', label: 'Field constraints', type: 'textarea', rows: 3, placeholder: 'e.g. Industry=Banking, AnnualRevenue>1000000, Stage in (Prospecting, Qualification)', required: false, advanced: true },
        ]}
      />
    </div>
  )
}
