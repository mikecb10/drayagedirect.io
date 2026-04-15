import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Plus, Download, AlertTriangle } from 'lucide-react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import SubTabs from '../../components/ui/SubTabs';
import StatsCards from '../../components/ui/StatsCards';
import FilterBar from '../../components/ui/FilterBar';
import DataTable from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Alert from '../../components/ui/Alert';
import DriverModal from '../../components/drivers/DriverModal';
import DriverPayRatesTab from '../../components/drivers/DriverPayRatesTab';
import { PERMISSIONS } from '../../lib/permissions';

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function isExpiringSoon(date) {
  if (!date) return false;
  const d = new Date(date);
  const now = new Date();
  const days = (d - now) / (1000 * 60 * 60 * 24);
  return days < 30 && days > 0;
}

function isExpired(date) {
  if (!date) return false;
  return new Date(date) < new Date();
}

function ExpirationCell({ date }) {
  if (!date) return <span className="text-gray-400">—</span>;
  const expired = isExpired(date);
  const soon = isExpiringSoon(date);
  return (
    <span
      className={`inline-flex items-center gap-1 ${
        expired ? 'text-red-600 font-medium' : soon ? 'text-amber-600' : 'text-gray-700'
      }`}
    >
      {(expired || soon) && <AlertTriangle className="w-3 h-3" />}
      {formatDate(date)}
    </span>
  );
}

export default function DriversIndex() {
  const router = useRouter();
  const [drivers, setDrivers] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0, on_leave: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [activeTab, setActiveTab] = useState('profiles');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const res = await fetch(`/api/tenant/drivers?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load drivers');
      }
      const data = await res.json();
      setDrivers(data.drivers || []);
      setStats(data.stats || { total: 0, active: 0, inactive: 0, on_leave: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [statusFilter, search]);

  useEffect(() => {
    if (router.query.new === '1') {
      setEditing(null);
      setModalOpen(true);
    }
  }, [router.query.new]);

  // Deep-link support: ?tab=pay_rates activates the Pay Rates sub-tab.
  // Used by the Driver Pay tab's "open source charge profile" click — it
  // opens /drivers?tab=pay_rates&subtab=charge_profiles&profile_id=... in
  // a new tab, and the Pay Rates panel handles the rest.
  useEffect(() => {
    if (router.query.tab === 'pay_rates' || router.query.tab === 'profiles') {
      setActiveTab(router.query.tab);
    }
  }, [router.query.tab]);

  const columns = [
    {
      key: 'name',
      label: 'Driver',
      sortable: true,
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900 dark:text-slate-100">
            {row.first_name && row.last_name
              ? `${row.first_name} ${row.last_name}`
              : row.name}
          </div>
          {row.username && (
            <div className="text-xs text-gray-500 dark:text-slate-400">@{row.username}</div>
          )}
        </div>
      ),
    },
    { key: 'phone', label: 'Phone' },
    { key: 'truck_number', label: 'Truck #' },
    {
      key: 'license_expiry',
      label: 'DL Exp',
      render: (row) => <ExpirationCell date={row.license_expiry} />,
    },
    {
      key: 'medical_exp',
      label: 'Medical Exp',
      render: (row) => <ExpirationCell date={row.medical_exp} />,
    },
    {
      key: 'twic_exp',
      label: 'TWIC Exp',
      render: (row) => <ExpirationCell date={row.twic_exp} />,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Badge
          variant={
            row.status === 'active'
              ? 'green'
              : row.status === 'on_leave'
              ? 'yellow'
              : 'gray'
          }
        >
          {row.status?.replace('_', ' ')}
        </Badge>
      ),
    },
  ];

  return (
    <TenantLayout
      title="Drivers"
      requiredPermission={[PERMISSIONS.DISPATCHING, PERMISSIONS.ALL]}
    >
      <div className="space-y-4">
        <ModuleHeader
          title="Drivers"
          description="Your fleet roster — profiles, compliance dates, and preferences."
          actions={
            <>
              <Button variant="secondary">
                <Download className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Export CSV
              </Button>
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-1 inline -mt-0.5" strokeWidth={2.5} />
                Add New Driver
              </Button>
            </>
          }
        />

        <SubTabs
          tabs={[
            { id: 'profiles', label: 'Driver Profiles', count: stats.total },
            { id: 'truck_assignments', label: 'Truck Assignments' },
            { id: 'fleet_owners', label: 'Fleet Owners' },
            { id: 'pay_rates', label: 'Driver Pay Rates' },
            { id: 'settlement_settings', label: 'Settlement Settings' },
          ]}
          active={activeTab}
          onChange={(id) => {
            if (id === 'profiles' || id === 'pay_rates') {
              setActiveTab(id);
              return;
            }
            const labelMap = {
              truck_assignments: 'Truck Assignments',
              fleet_owners: 'Fleet Owners',
              settlement_settings: 'Settlement Settings',
            };
            router.push(`/coming-soon?feature=${labelMap[id]}`);
          }}
        />

        {activeTab === 'profiles' && (
          <>
            <StatsCards
              cards={[
                { key: 'active', label: 'Active', count: stats.active, color: 'green' },
                { key: 'on_leave', label: 'On Leave', count: stats.on_leave, color: 'amber' },
                { key: 'inactive', label: 'Inactive', count: stats.inactive, color: 'slate' },
                { key: 'total', label: 'Total', count: stats.total, color: 'blue' },
              ]}
              activeKey={statusFilter}
              onSelect={(k) => setStatusFilter(k === 'total' ? null : k)}
            />

            <FilterBar
              search={search}
              onSearchChange={setSearch}
              placeholder="Search drivers by name, email, username..."
            />

            {error && <Alert type="error" message={error} />}

            <DataTable
              columns={columns}
              data={drivers}
              loading={loading}
              emptyMessage="No drivers yet. Click 'Add New Driver' to add your first driver."
              onRowClick={(row) => {
                setEditing(row);
                setModalOpen(true);
              }}
            />
          </>
        )}

        {activeTab === 'pay_rates' && <DriverPayRatesTab />}
      </div>

      <DriverModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          if (router.query.new) {
            router.replace('/drivers', undefined, { shallow: true });
          }
        }}
        onSuccess={() => {
          setModalOpen(false);
          if (router.query.new) {
            router.replace('/drivers', undefined, { shallow: true });
          }
          load();
        }}
        editing={editing}
      />
    </TenantLayout>
  );
}
