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

import ArFiltersBar from '../../components/ar/ArFiltersBar';
import FilterSidebar from '../../components/ar/FilterSidebar';
import { useArUserPreferences } from '../../components/ar/useArUserPreferences';

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

  // Global AR filter state — applies across all sub-tabs that consume it.
  // Phase A: Billing + Invoices consume. Other sub-tabs ignore for now;
  // Phase B wires them up when their endpoints learn array filters.
  const [filters, setFilters]                     = useState({});
  const [activeTabId, setActiveTabId]             = useState(null);
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false);
  const { customTabs, saveCustomTab, deleteCustomTab } = useArUserPreferences();

  return (
    <TenantLayout title="Accounts Receivable" requiredPermission={[PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL]}>
      <div className="space-y-5">
        <ModuleHeader
          title="Accounts Receivable"
          description="Manage billing, invoices, payments, credits, and aging reports."
        />

        <SubTabs tabs={AR_TABS} active={activeTab} onChange={setActiveTab} />

        <ArFiltersBar
          customTabs={customTabs}
          activeTabId={activeTabId}
          currentFilters={filters}
          onSelectTab={(id) => {
            setActiveTabId(id);
            if (id == null) {
              setFilters({});
            } else {
              const tab = customTabs.find((t) => t.id === id);
              if (tab) setFilters(tab.filters || {});
            }
          }}
          onSaveTab={(tab) => saveCustomTab(tab)}
          onDeleteTab={(id) => {
            if (activeTabId === id) { setActiveTabId(null); setFilters({}); }
            deleteCustomTab(id);
          }}
          onOpenFilters={() => setFilterSidebarOpen(true)}
        />

        {activeTab === 'billing'        && <BillingPipelineTab filters={filters} />}
        {activeTab === 'invoices'       && <InvoicesTab filters={filters} />}
        {activeTab === 'apply_payments' && <ApplyPaymentsTab />}
        {activeTab === 'payments'       && <PaymentsTab filters={filters} />}
        {activeTab === 'credit_memos'   && <CreditMemosTab filters={filters} />}
        {activeTab === 'aging'          && <AgingTab filters={filters} />}

        <FilterSidebar
          isOpen={filterSidebarOpen}
          onClose={() => setFilterSidebarOpen(false)}
          filters={filters}
          section={activeTab}
          onApply={(next) => {
            setFilters(next);
            setActiveTabId(null);
          }}
        />
      </div>
    </TenantLayout>
  );
}
