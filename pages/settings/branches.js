import { useEffect, useState } from 'react';
import {
  GitBranch,
  Plus,
  Search,
  Pencil,
  Trash2,
  MapPin,
  Users as UsersIcon,
  Building2,
  Truck,
  ClipboardList,
  UserPlus,
  X,
} from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import SettingsTabs from '../../components/settings/SettingsTabs';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import { useAuth } from '../../contexts/AuthContext';
import { hasGranularPermission } from '../../lib/rbac';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

const EMPTY_FORM = {
  name: '',
  code: '',
  market: '',
  address_line1: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  email: '',
  manager_user_id: '',
  status: 'active',
};

function BranchesSettings() {
  const { profile, permissions } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin';
  const canAssign = isSuperAdmin || hasGranularPermission({ role: profile?.role, permissions, granular_permissions: profile?.granular_permissions }, 'branches.assign');

  const [branches, setBranches] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, inactive: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Assignment panel
  const [assignBranch, setAssignBranch] = useState(null);
  const [assignTab, setAssignTab] = useState('users');
  const [allUsers, setAllUsers] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [branchUserIds, setBranchUserIds] = useState([]);
  const [branchCustomerIds, setBranchCustomerIds] = useState([]);
  const [assignSaving, setAssignSaving] = useState(false);

  // User picker for manager dropdown
  const [users, setUsers] = useState([]);

  async function loadBranches() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/tenant/branches?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load branches');
      const data = await res.json();
      setBranches(data.branches || []);
      setStats(data.stats || { total: 0, active: 0, inactive: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const res = await fetch('/api/tenant/users?status=active');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    loadBranches();
    loadUsers();
  }, [search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setActionError(null);
    setModalOpen(true);
  }

  function openEdit(branch) {
    setEditing(branch);
    setForm({
      name: branch.name || '',
      code: branch.code || '',
      market: branch.market || '',
      address_line1: branch.address_line1 || '',
      city: branch.city || '',
      state: branch.state || '',
      zip: branch.zip || '',
      phone: branch.phone || '',
      email: branch.email || '',
      manager_user_id: branch.manager_user_id || '',
      status: branch.status || 'active',
    });
    setActionError(null);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setActionError('Branch name is required');
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const url = editing
        ? `/api/tenant/branches/${editing.id}`
        : '/api/tenant/branches';
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save');
      }
      setModalOpen(false);
      loadBranches();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(branch) {
    if (!confirm(`Delete branch "${branch.name}"? This will unassign all users, customers, loads, and drivers from this branch.`)) return;
    try {
      const res = await fetch(`/api/tenant/branches/${branch.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete');
      }
      loadBranches();
    } catch (e) {
      setError(e.message);
    }
  }

  // ── Assignment panel ──
  async function openAssignments(branch) {
    setAssignBranch(branch);
    setAssignTab('users');
    setAssignSaving(false);

    // Fetch current branch assignments + all available entities
    const [usersRes, customersRes, branchUsersRes, branchCustomersRes] = await Promise.all([
      fetch('/api/tenant/users?status=active'),
      fetch('/api/tenant/organizations?type=customer'),
      fetch(`/api/tenant/branches/${branch.id}/users`),
      fetch(`/api/tenant/branches/${branch.id}/customers`),
    ]);

    if (usersRes.ok) {
      const d = await usersRes.json();
      setAllUsers(d.users || []);
    }
    if (customersRes.ok) {
      const d = await customersRes.json();
      setAllCustomers(d.organizations || []);
    }
    if (branchUsersRes.ok) {
      const d = await branchUsersRes.json();
      setBranchUserIds((d.users || []).map((u) => u.id));
    }
    if (branchCustomersRes.ok) {
      const d = await branchCustomersRes.json();
      setBranchCustomerIds((d.customers || []).map((c) => c.id));
    }
  }

  function toggleUser(userId) {
    setBranchUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  function toggleCustomer(customerId) {
    setBranchCustomerIds((prev) =>
      prev.includes(customerId) ? prev.filter((id) => id !== customerId) : [...prev, customerId]
    );
  }

  async function saveAssignments() {
    if (!assignBranch) return;
    setAssignSaving(true);
    try {
      const endpoint = assignTab === 'users' ? 'users' : 'customers';
      const ids = assignTab === 'users' ? branchUserIds : branchCustomerIds;
      const body = assignTab === 'users' ? { user_ids: ids } : { customer_ids: ids };

      const res = await fetch(`/api/tenant/branches/${assignBranch.id}/${endpoint}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to save');
      }
      loadBranches();
    } catch (e) {
      setError(e.message);
    } finally {
      setAssignSaving(false);
    }
  }

  const managerOptions = [
    { value: '', label: '— No Manager —' },
    ...users.map((u) => ({ value: u.id, label: u.name || u.email })),
  ];

  return (
    <>
      <div className="space-y-[var(--space-section)]">
        {/* Header */}
        <PageHeader
          variant="plain"
          title={<><GitBranch className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Branches</>}
          description="Regional offices and operational divisions. Assign users, customers, and loads to branches for scoped visibility."
          actions={isSuperAdmin ? (
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4 mr-1 inline -mt-0.5" strokeWidth={2.5} />
              Add Branch
            </Button>
          ) : null}
          className="mb-[var(--space-section)]"
        />

        <SettingsTabs />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-[var(--space-inline)]">
          {[
            { label: 'Total', value: stats.total, color: 'blue' },
            { label: 'Active', value: stats.active, color: 'emerald' },
            { label: 'Inactive', value: stats.inactive, color: 'gray' },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-[var(--space-section-pad)]"
            >
              <div className="text-field-label text-muted">{s.label}</div>
              <div className={`text-2xl font-bold mt-1 text-${s.color}-600 dark:text-${s.color}-400`}>
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Search branches..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-body text-strong placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        {/* Branch list */}
        <SectionCard title="Branches" columns={0}>
          {loading ? (
            <div className="py-10 text-center text-body text-muted">
              Loading...
            </div>
          ) : branches.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40 p-10 text-center">
              <GitBranch className="w-10 h-10 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <div className="text-body font-semibold text-strong">No branches yet</div>
              <div className="text-helper text-muted mt-1">
                Create branches to organize your operations by region.
              </div>
            </div>
          ) : (
            <div className="space-y-[var(--space-inline)]">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 hover:border-gray-300 dark:hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-body font-semibold text-strong">
                          {branch.name}
                        </h3>
                        {branch.code && (
                          <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                            {branch.code}
                          </span>
                        )}
                        <Badge variant={branch.status === 'active' ? 'green' : 'gray'}>
                          {branch.status}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-helper text-muted">
                        {branch.market && <span>{branch.market}</span>}
                        {branch.city && branch.state && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {branch.city}, {branch.state}
                          </span>
                        )}
                        {branch.manager && (
                          <span className="inline-flex items-center gap-1">
                            Manager: {branch.manager.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Stats chips */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex items-center gap-1 text-helper text-muted bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-lg" title="Assigned users">
                        <UsersIcon className="w-3 h-3" />
                        {branch.user_count || 0}
                      </div>
                      <div className="flex items-center gap-1 text-helper text-muted bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded-lg" title="Assigned customers">
                        <Building2 className="w-3 h-3" />
                        {branch.customer_count || 0}
                      </div>

                      {canAssign && (
                        <button
                          onClick={() => openAssignments(branch)}
                          className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40"
                          title="Manage assignments"
                        >
                          <UserPlus className="w-4 h-4" />
                        </button>
                      )}
                      {isSuperAdmin && (
                        <>
                          <button
                            onClick={() => openEdit(branch)}
                            className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40"
                            title="Edit branch"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(branch)}
                            className="p-1.5 text-gray-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/40"
                            title="Delete branch"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ── Create / Edit Modal ── */}
      {modalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setModalOpen(false)}
          title={editing ? 'Edit Branch' : 'Create Branch'}
          size="lg"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {actionError && <Alert type="error" message={actionError} />}

            {/* General */}
            <div className="text-field-label text-muted">
              General
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Branch Name *"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder='e.g. "Houston"'
                required
              />
              <Input
                label="Code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder='e.g. "HOU"'
              />
              <Input
                label="Market / Region"
                value={form.market}
                onChange={(e) => setForm({ ...form, market: e.target.value })}
                placeholder='e.g. "Gulf Coast"'
              />
            </div>

            {/* Location */}
            <div className="text-field-label text-muted pt-2">
              Location
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2">
                <Input
                  label="Address"
                  value={form.address_line1}
                  onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
                />
              </div>
              <Input
                label="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="State"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  placeholder="TX"
                />
                <Input
                  label="Zip"
                  value={form.zip}
                  onChange={(e) => setForm({ ...form, zip: e.target.value })}
                />
              </div>
            </div>

            {/* Contact + Management */}
            <div className="text-field-label text-muted pt-2">
              Contact & Management
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label="Phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <Select
                label="Manager"
                value={form.manager_user_id}
                onChange={(e) => setForm({ ...form, manager_user_id: e.target.value })}
                options={managerOptions}
              />
            </div>

            <Select
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              options={STATUS_OPTIONS}
            />

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                {editing ? 'Save Changes' : 'Create Branch'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── Assignment Modal ── */}
      {assignBranch && (
        <Modal
          isOpen={true}
          onClose={() => setAssignBranch(null)}
          title={`Assign to ${assignBranch.name}`}
          size="lg"
        >
          <div className="space-y-4">
            {/* Tabs */}
            <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1">
              {[
                { id: 'users', label: 'Users', icon: UsersIcon },
                { id: 'customers', label: 'Customers', icon: Building2 },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setAssignTab(tab.id)}
                  className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-md py-2 text-helper font-semibold transition-colors ${
                    assignTab === tab.id
                      ? 'bg-white dark:bg-slate-900 text-strong shadow-sm'
                      : 'text-muted hover:text-gray-700 dark:hover:text-slate-200'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Checkbox list */}
            <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800">
              {assignTab === 'users' &&
                allUsers.map((user) => {
                  const checked = branchUserIds.includes(user.id);
                  return (
                    <label
                      key={user.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleUser(user.id)}
                        className="rounded text-blue-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-body font-medium text-strong truncate">
                          {user.name || user.email}
                        </div>
                        <div className="text-helper text-muted">
                          {user.role} · {user.email}
                        </div>
                      </div>
                    </label>
                  );
                })}
              {assignTab === 'customers' &&
                allCustomers.map((cust) => (
                  <label
                    key={cust.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={branchCustomerIds.includes(cust.id)}
                      onChange={() => toggleCustomer(cust.id)}
                      className="rounded text-blue-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium text-strong truncate">
                        {cust.name}
                      </div>
                      <div className="text-helper text-muted">
                        {(cust.customer_types || []).join(', ')}
                        {cust.city && cust.state ? ` · ${cust.city}, ${cust.state}` : ''}
                      </div>
                    </div>
                  </label>
                ))}
            </div>

            <div className="text-helper text-muted">
              {assignTab === 'users'
                ? `${branchUserIds.length} user${branchUserIds.length !== 1 ? 's' : ''} selected`
                : `${branchCustomerIds.length} customer${branchCustomerIds.length !== 1 ? 's' : ''} selected`}
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-200 dark:border-slate-800">
              <Button variant="secondary" onClick={() => setAssignBranch(null)}>
                Cancel
              </Button>
              <Button onClick={saveAssignments} loading={assignSaving}>
                Save Assignments
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

BranchesSettings.getLayout = (page) => (
  <SettingsLayout title="Branches" settingsKey="branches">{page}</SettingsLayout>
);

export default BranchesSettings;
