import { useState } from 'react';
import DriverChargeProfilesPanel from './pay-rates/DriverChargeProfilesPanel';
import DriverTariffsPanel from './pay-rates/DriverTariffsPanel';

const SUB_TABS = [
  { id: 'tariffs', label: 'Driver Tariffs' },
  { id: 'charge_profiles', label: 'Driver Charge Profiles' },
];

export default function DriverPayRatesTab() {
  const [activeTab, setActiveTab] = useState('tariffs');

  return (
    <div className="space-y-4">
      {/* Sub-tab pills */}
      <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 inline-flex">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'tariffs' && <DriverTariffsPanel />}
      {activeTab === 'charge_profiles' && <DriverChargeProfilesPanel />}
    </div>
  );
}
