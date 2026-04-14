import { useState } from 'react';
import DeductionTypesPanel from './settings/DeductionTypesPanel';
import DriverDeductionsPanel from './settings/DriverDeductionsPanel';
import SettlementPeriodsPanel from './settings/SettlementPeriodsPanel';
import DriverGroupsPanel from './settings/DriverGroupsPanel';

const SUB_TABS = [
  { id: 'deduction_types', label: 'Deduction Types' },
  { id: 'driver_deductions', label: 'Driver Deductions' },
  { id: 'settlement_periods', label: 'Settlement Periods' },
  { id: 'driver_groups', label: 'Driver Groups' },
];

export default function SettlementSettingsTab() {
  const [activeTab, setActiveTab] = useState('deduction_types');

  return (
    <div className="space-y-4">
      {/* Sub-tab pills */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 inline-flex">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'deduction_types' && <DeductionTypesPanel />}
      {activeTab === 'driver_deductions' && <DriverDeductionsPanel />}
      {activeTab === 'settlement_periods' && <SettlementPeriodsPanel />}
      {activeTab === 'driver_groups' && <DriverGroupsPanel />}
    </div>
  );
}
