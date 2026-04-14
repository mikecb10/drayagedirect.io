import { useState } from 'react';
import { useRouter } from 'next/router';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import SubTabs from '../../components/ui/SubTabs';
import EquipmentListView from '../../components/equipment/EquipmentListView';
import { PERMISSIONS } from '../../lib/permissions';

const TABS = [
  { id: 'trucks', label: 'Truck Profiles' },
  { id: 'chassis', label: 'Chassis Profiles' },
  { id: 'trailers', label: 'Trailer Profiles' },
];

export default function EquipmentIndex() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('trucks');

  return (
    <TenantLayout
      title="Equipment"
      requiredPermission={[PERMISSIONS.DISPATCHING, PERMISSIONS.ALL]}
    >
      <div className="space-y-4">
        <ModuleHeader
          title="Equipment"
          description="Manage your fleet's trucks, chassis, and trailers with compliance tracking."
        />

        <SubTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

        {activeTab === 'trucks' && <EquipmentListView type="trucks" />}
        {activeTab === 'chassis' && <EquipmentListView type="chassis" />}
        {activeTab === 'trailers' && <EquipmentListView type="trailers" />}
      </div>
    </TenantLayout>
  );
}
