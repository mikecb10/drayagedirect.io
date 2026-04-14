import { useState } from 'react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import SubTabs from '../../components/ui/SubTabs';
import { PERMISSIONS } from '../../lib/permissions';

import DriverPayTab from '../../components/ap/DriverPayTab';
import DriverSettlementsTab from '../../components/ap/DriverSettlementsTab';
import DeductionsTab from '../../components/ap/DeductionsTab';
import SettlementSettingsTab from '../../components/ap/SettlementSettingsTab';

const AP_TABS = [
  { id: 'driver_pay', label: 'Driver Pay' },
  { id: 'settlements', label: 'Driver Settlements' },
  { id: 'deductions', label: 'Deductions' },
  { id: 'settings', label: 'Settlement Settings' },
];

export default function AccountsPayable() {
  const [activeTab, setActiveTab] = useState('driver_pay');

  return (
    <TenantLayout title="Accounts Payable" requiredPermission={[PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL]}>
      <div className="space-y-5">
        <ModuleHeader
          title="Accounts Payable"
          description="Manage driver pay, settlements, deductions, and payout periods."
        />

        <SubTabs tabs={AP_TABS} active={activeTab} onChange={setActiveTab} />

        {activeTab === 'driver_pay' && <DriverPayTab />}
        {activeTab === 'settlements' && <DriverSettlementsTab />}
        {activeTab === 'deductions' && <DeductionsTab />}
        {activeTab === 'settings' && <SettlementSettingsTab />}
      </div>
    </TenantLayout>
  );
}
