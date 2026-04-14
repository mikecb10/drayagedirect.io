import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/admin/AdminLayout';
import Table from '../../../components/ui/Table';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Modal from '../../../components/ui/Modal';
import Alert from '../../../components/ui/Alert';

export default function TenantDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [tempPassword, setTempPassword] = useState('');
  const [tab, setTab] = useState('info');

  function fetchData() {
    if (!id) return;
    setLoading(true);
    fetch(`/api/admin/tenants/${id}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, [id]);

  if (loading || !data) {
    return (
      <AdminLayout title="Tenant Details">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      </AdminLayout>
    );
  }

  const { tenant, users, settings } = data;

  const tabs = [
    { key: 'info', label: 'Company Info' },
    { key: 'users', label: `Users (${users.length})` },
  ];

  const statusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'suspended', label: 'Suspended' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const userColumns = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role', render: (r) => <Badge variant={r.role === 'super_admin' ? 'blue' : 'gray'}>{r.role.replace('_', ' ')}</Badge> },
    { key: 'status', label: 'Status', render: (r) => <Badge variant={r.status === 'active' ? 'green' : 'red'}>{r.status}</Badge> },
    { key: 'last_login_at', label: 'Last Login', render: (r) => r.last_login_at ? new Date(r.last_login_at).toLocaleDateString() : 'Never' },
  ];

  async function updateTenant(updates) {
    const res = await fetch(`/api/admin/tenants/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (res.ok) fetchData();
  }

  return (
    <AdminLayout title={tenant.name}>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="secondary" onClick={() => router.push('/admin/tenants')}>
          Back
        </Button>
        <Badge variant={tenant.status === 'active' ? 'green' : tenant.status === 'suspended' ? 'yellow' : 'red'}>
          {tenant.status}
        </Badge>
        <Badge variant="blue">{tenant.subscription_tiers?.display_name}</Badge>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <div className="flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'info' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-2xl space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">Company Name</p>
              <p className="text-sm font-medium">{tenant.name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Slug</p>
              <p className="text-sm font-medium">{tenant.slug}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Contact Email</p>
              <p className="text-sm font-medium">{tenant.contact_email}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">MC Number</p>
              <p className="text-sm font-medium">{tenant.mc_number || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">DOT Number</p>
              <p className="text-sm font-medium">{tenant.dot_number || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">Created</p>
              <p className="text-sm font-medium">{new Date(tenant.created_at).toLocaleDateString()}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-gray-200 flex gap-3">
            <Select
              label="Status"
              name="status"
              value={tenant.status}
              onChange={(e) => updateTenant({ status: e.target.value })}
              options={statusOptions}
            />
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div>
          <div className="flex justify-end mb-4">
            <Button onClick={() => setShowCreateUser(true)}>Create User</Button>
          </div>
          <div className="bg-white rounded-xl border border-gray-200">
            <Table columns={userColumns} data={users} emptyMessage="No users yet." />
          </div>

          {tempPassword && (
            <Alert
              type="success"
              message={`User created! Temporary password: ${tempPassword} — share this securely, it won't be shown again.`}
              className="mt-4"
            />
          )}

          <CreateUserModal
            isOpen={showCreateUser}
            onClose={() => setShowCreateUser(false)}
            tenantId={id}
            onCreated={(pwd) => {
              setShowCreateUser(false);
              setTempPassword(pwd);
              fetchData();
            }}
          />
        </div>
      )}
    </AdminLayout>
  );
}

function CreateUserModal({ isOpen, onClose, tenantId, onCreated }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'super_admin' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated(data.tempPassword);
      setForm({ email: '', name: '', role: 'super_admin' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create User">
      <Alert type="error" message={error} className="mb-4" />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Full Name" name="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        <Input label="Email" type="email" name="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
        <Select
          label="Role"
          name="role"
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
          options={[
            { value: 'super_admin', label: 'Super Admin' },
            { value: 'admin', label: 'Admin' },
            { value: 'user', label: 'User' },
          ]}
        />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Create User</Button>
        </div>
      </form>
    </Modal>
  );
}
