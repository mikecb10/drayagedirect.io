import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Users as UsersIcon,
  UsersRound,
  ClipboardList,
  Receipt,
  DollarSign,
  Activity,
  MapPin,
  FolderOpen,
  StickyNote,
  History,
} from 'lucide-react';
import TenantLayout from '../../components/tenant/TenantLayout';
import DetailTabs from '../../components/ui/DetailTabs';
import Badge from '../../components/ui/Badge';
import Alert from '../../components/ui/Alert';
import OrganizationModal from '../../components/organizations/OrganizationModal';
import GenerateStatementModal from '../../components/organizations/GenerateStatementModal';
import OverviewTab from '../../components/organizations/tabs/OverviewTab';
import PeopleTab from '../../components/organizations/tabs/PeopleTab';
import GroupsTab from '../../components/organizations/tabs/GroupsTab';
import EmptyTab from '../../components/organizations/tabs/EmptyTab';
import OrdersTab from '../../components/organizations/tabs/OrdersTab';
import ActivityTab from '../../components/organizations/tabs/ActivityTab';
import GeofenceTab from '../../components/organizations/tabs/GeofenceTab';
import { PERMISSIONS } from '../../lib/permissions';

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'geofence', label: 'Geofence', icon: MapPin },
  { id: 'people', label: 'People', icon: UsersIcon },
  { id: 'groups', label: 'Groups', icon: UsersRound },
  { id: 'documents', label: 'Documents', icon: FolderOpen },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'invoices', label: 'Invoices', icon: Receipt, badge: 'Soon' },
  { id: 'rates', label: 'Rates', icon: DollarSign, badge: 'Soon' },
  { id: 'activity', label: 'Activity', icon: History },
];

export default function OrganizationDetail() {
  const router = useRouter();
  const { id } = router.query;

  const [organization, setOrganization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/organizations/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load organization');
      }
      const data = await res.json();
      setOrganization(data.organization);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  if (loading) {
    return (
      <TenantLayout>
        <div className="py-20 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
        </div>
      </TenantLayout>
    );
  }

  if (error || !organization) {
    return (
      <TenantLayout>
        <Alert type="error" message={error || 'Organization not found'} />
      </TenantLayout>
    );
  }

  return (
    <TenantLayout
      title={organization.name}
      requiredPermission={[PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL]}
    >
      <div className="space-y-4">
        <Link
          href="/organizations"
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Back to Organizations
        </Link>

        {/* Header with name + type badges */}
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 truncate">
                {organization.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {(organization.customer_types || []).map((t) => (
                  <Badge key={t} variant="blue">
                    {t}
                  </Badge>
                ))}
                <Badge variant={organization.status === 'active' ? 'green' : 'gray'}>
                  {organization.status}
                </Badge>
                {organization.account_hold && <Badge variant="red">Account Hold</Badge>}
                {organization.portal_enabled && <Badge variant="blue">Portal Enabled</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm text-gray-500 dark:text-slate-400">
                {organization.city && organization.state && (
                  <span>
                    📍 {organization.city}, {organization.state}
                  </span>
                )}
                {organization.main_phone && <span>📞 {organization.main_phone}</span>}
                {organization.billing_email && (
                  <span>✉ {organization.billing_email}</span>
                )}
                {organization.mc_number && <span>MC# {organization.mc_number}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button
                onClick={() => setStatementOpen(true)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg whitespace-nowrap"
              >
                <FileText className="w-4 h-4" strokeWidth={1.75} />
                Generate Statement
              </button>
            </div>
          </div>
        </div>

        <DetailTabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

        <div>
          {activeTab === 'overview' && (
            <OverviewTab organization={organization} onEdit={() => setEditOpen(true)} />
          )}
          {activeTab === 'geofence' && <GeofenceTab organization={organization} />}
          {activeTab === 'people' && <PeopleTab organization={organization} />}
          {activeTab === 'groups' && <GroupsTab organization={organization} />}
          {activeTab === 'orders' && <OrdersTab organization={organization} />}
          {activeTab === 'invoices' && (
            <EmptyTab
              title="Invoices"
              phase="Phase 6"
              description="Billing history, open A/R, and payment records for this organization."
            />
          )}
          {activeTab === 'rates' && (
            <EmptyTab
              title="Rate Profiles"
              phase="Phase 6"
              description="Customer-specific rate contracts and tariffs will be managed here."
            />
          )}
          {activeTab === 'documents' && (
            <EmptyTab title="Documents" phase="Coming" description="Upload and manage documents for this organization — contracts, rate confirmations, insurance certificates." />
          )}
          {activeTab === 'notes' && (
            <EmptyTab title="Notes" phase="Coming" description="Internal notes and communication history for this organization." />
          )}
          {activeTab === 'activity' && <ActivityTab organization={organization} />}
        </div>
      </div>

      <OrganizationModal
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        onSuccess={() => {
          setEditOpen(false);
          load();
        }}
        editing={organization}
      />

      <GenerateStatementModal
        isOpen={statementOpen}
        onClose={() => setStatementOpen(false)}
        customerId={organization?.id}
        customerName={organization?.name || ''}
      />
    </TenantLayout>
  );
}
