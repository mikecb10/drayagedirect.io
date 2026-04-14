import { useState } from 'react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import SubTabs from '../../components/ui/SubTabs';
import { PERMISSIONS } from '../../lib/permissions';

import BillingPipelineTab from '../../components/ar/BillingPipelineTab';
import InvoicesTab from '../../components/ar/InvoicesTab';
import ApplyPaymentsTab from '../../components/ar/ApplyPaymentsTab';
import PaymentsTab from '../../components/ar/PaymentsTab';
import CreditMemosTab from '../../components/ar/CreditMemosTab';
import AgingTab from '../../components/ar/AgingTab';

const AR_TABS = [
  { id: 'billing', label: 'Billing' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'apply_payments', label: 'Apply Payments & Credits' },
  { id: 'payments', label: 'Payments' },
  { id: 'credit_memos', label: 'Credit Memos' },
  { id: 'aging', label: 'Aging' },
];

export default function AccountsReceivable() {
  const [activeTab, setActiveTab] = useState('billing');

  return (
    <TenantLayout title="Accounts Receivable" requiredPermission={[PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]}>
      <div className="space-y-5">
        <ModuleHeader
          title="Accounts Receivable"
          description="Manage billing, invoices, payments, credits, and aging reports."
        />

        <SubTabs tabs={AR_TABS} active={activeTab} onChange={setActiveTab} />

        {activeTab === 'billing' && <BillingPipelineTab />}
        {activeTab === 'invoices' && <InvoicesTab />}
        {activeTab === 'apply_payments' && <ApplyPaymentsTab />}
        {activeTab === 'payments' && <PaymentsTab />}
        {activeTab === 'credit_memos' && <CreditMemosTab />}
        {activeTab === 'aging' && <AgingTab />}
      </div>
    </TenantLayout>
  );
}
