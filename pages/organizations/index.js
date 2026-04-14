import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Plus, Download, MapPin } from 'lucide-react';
import TenantLayout from '../../components/tenant/TenantLayout';
import ModuleHeader from '../../components/ui/ModuleHeader';
import SubTabs from '../../components/ui/SubTabs';
import StatsCards from '../../components/ui/StatsCards';
import FilterBar from '../../components/ui/FilterBar';
import DataTable from '../../components/ui/DataTable';
import Button from '../../components/ui/Button';
import Badge from '../../components/ui/Badge';
import Alert from '../../components/ui/Alert';
import OrganizationModal from '../../components/organizations/OrganizationModal';
import { PERMISSIONS } from '../../lib/permissions';

export default function OrganizationsIndex() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState([]);
  const [stats, setStats] = useState({ customer: 0, terminal: 0, warehouse: 0, yard: 0, final_destination: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState(null);
  const [activeTab, setActiveTab] = useState('organizations');
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set('type', typeFilter);
      if (search) params.set('search', search);
      const res = await fetch(`/api/tenant/organizations?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load organizations');
      }
      const data = await res.json();
      setOrganizations(data.organizations || []);
      setStats(data.stats || { customer: 0, terminal: 0, warehouse: 0, yard: 0, final_destination: 0, total: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [typeFilter, search]);

  // Open modal automatically if ?new=1
  useEffect(() => {
    if (router.query.new === '1') {
      setModalOpen(true);
    }
  }, [router.query.new]);

  function handleSuccess(org) {
    setModalOpen(false);
    if (router.query.new) {
      router.replace('/organizations', undefined, { shallow: true });
    }
    load();
    // Navigate to detail page so user can start adding contacts/groups
    if (org?.id) router.push(`/organizations/${org.id}`);
  }

  const columns = [
    {
      key: 'name',
      label: 'Profile Name',
      sortable: true,
      render: (row) => (
        <div>
          <div className="font-medium text-gray-900 dark:text-slate-100">{row.name}</div>
          <div className="flex gap-1 mt-0.5">
            {(row.customer_types || []).map((t) => (
              <span
                key={t}
                className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  t === 'customer' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' :
                  t === 'terminal' ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' :
                  t === 'warehouse' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' :
                  t === 'yard' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300' :
                  t === 'final_destination' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300' :
                  'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {t === 'final_destination' ? 'Final Dest' : t}
              </span>
            ))}
          </div>
        </div>
      ),
    },
    { key: 'main_phone', label: 'Main Phone', render: (r) => r.main_phone || r.phone || '—' },
    { key: 'main_contact_name', label: 'Main Contact' },
    { key: 'address_line1', label: 'Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'Zip' },
    {
      key: 'geofence',
      label: 'Geofence',
      render: (r) => (
        r.geofence_type ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
            <MapPin className="w-3 h-3" />
            {r.geofence_type === 'circle' ? 'Circle' : 'Polygon'}
          </span>
        ) : (
          <span className="text-[10px] text-gray-400 dark:text-slate-500">Not Set</span>
        )
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <Badge variant={r.status === 'active' ? 'green' : 'gray'}>{r.status}</Badge>
      ),
    },
  ];

  return (
    <TenantLayout
      title="Organizations"
      requiredPermission={[PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL]}
    >
      <div className="space-y-4">
        <ModuleHeader
          title="Organizations"
          description="Customers, terminals, warehouses, and yards — all your business partners in one place."
          actions={
            <>
              <Button variant="secondary">
                <Download className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Export CSV
              </Button>
              <Button onClick={() => setModalOpen(true)}>
                <Plus className="w-4 h-4 mr-1 inline -mt-0.5" strokeWidth={2.5} />
                Add New Organization
              </Button>
            </>
          }
        />

        <SubTabs
          tabs={[
            { id: 'organizations', label: 'Organizations', count: stats.total },
            { id: 'people', label: 'People' },
            { id: 'tariffs', label: 'Tariffs' },
          ]}
          active={activeTab}
          onChange={(id) => {
            if (id === 'tariffs') {
              router.push('/settings/tariffs');
              return;
            }
            if (id === 'people') {
              router.push('/coming-soon?feature=People (all contacts)');
              return;
            }
            setActiveTab(id);
          }}
        />

        <StatsCards
          cards={[
            { key: 'customer', label: 'Customers', count: stats.customer, color: 'blue' },
            { key: 'terminal', label: 'Terminals', count: stats.terminal, color: 'green' },
            { key: 'warehouse', label: 'Warehouses', count: stats.warehouse, color: 'amber' },
            { key: 'yard', label: 'Yards', count: stats.yard, color: 'purple' },
            { key: 'final_destination', label: 'Final Destinations', count: stats.final_destination, color: 'orange' },
          ]}
          activeKey={typeFilter}
          onSelect={setTypeFilter}
        />

        <FilterBar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search organizations..."
        />

        {error && <Alert type="error" message={error} />}

        <DataTable
          columns={columns}
          data={organizations}
          loading={loading}
          emptyMessage="No organizations yet. Click 'Add New Organization' to get started."
          onRowClick={(row) => router.push(`/organizations/${row.id}`)}
        />
      </div>

      <OrganizationModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          if (router.query.new) {
            router.replace('/organizations', undefined, { shallow: true });
          }
        }}
        onSuccess={handleSuccess}
      />
    </TenantLayout>
  );
}
