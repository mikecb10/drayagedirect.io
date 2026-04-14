import { useEffect, useState, useCallback } from 'react';
import AdminLayout from '../../../components/admin/AdminLayout';
import Table from '../../../components/ui/Table';
import Badge from '../../../components/ui/Badge';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Modal from '../../../components/ui/Modal';
import Alert from '../../../components/ui/Alert';
import Link from 'next/link';

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [tiers, setTiers] = useState([]);

  const fetchTenants = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    fetch(`/api/admin/tenants?${params}`)
      .then((r) => r.json())
      .then((d) => setTenants(d.data || []))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  useEffect(() => {
    fetch('/api/admin/tenants?limit=1')
      .then(() => {
        // Fetch tiers for the create form
        fetch('/api/admin/features?_tiers=1')
          .catch(() => {});
      });
  }, []);

  const statusBadge = (status) => {
    const map = { active: 'green', suspended: 'yellow', cancelled: 'red' };
    return <Badge variant={map[status] || 'gray'}>{status}</Badge>;
  };

  const columns = [
    { key: 'name', label: 'Company Name', render: (r) => (
      <Link href={`/admin/tenants/${r.id}`} className="text-blue-600 hover:text-blue-700 font-medium">
        {r.name}
      </Link>
    )},
    { key: 'slug', label: 'Slug' },
    { key: 'status', label: 'Status', render: (r) => statusBadge(r.status) },
    { key: 'tier', label: 'Tier', render: (r) => (
      <Badge variant="blue">{r.subscription_tiers?.display_name || 'N/A'}</Badge>
    )},
    { key: 'contact_email', label: 'Contact' },
    { key: 'created_at', label: 'Created', render: (r) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <AdminLayout title="Tenants">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex-1 max-w-sm">
          <input
            type="text"
            placeholder="Search tenants..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <Button onClick={() => setShowCreate(true)}>Create Tenant</Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <Table columns={columns} data={tenants} loading={loading} emptyMessage="No tenants found." />
      </div>

      <CreateTenantModal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); fetchTenants(); }}
      />
    </AdminLayout>
  );
}

function CreateTenantModal({ isOpen, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', slug: '', contact_email: '', subscription_tier_id: '', mc_number: '', dot_number: '' });
  const [tiers, setTiers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && tiers.length === 0) {
      // Fetch subscription tiers
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      fetch(`${supabaseUrl}/rest/v1/subscription_tiers?select=id,name,display_name&is_active=eq.true`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      })
        .then((r) => r.json())
        .then((d) => setTiers(d || []))
        .catch(() => {});
    }
  }, [isOpen]);

  const updateForm = (field, value) => {
    setForm((f) => ({ ...f, [field]: value }));
    if (field === 'name' && !form.slug) {
      setForm((f) => ({ ...f, [field]: value, slug: value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }));
    }
  };

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Tenant">
      <Alert type="error" message={error} className="mb-4" />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input label="Company Name" name="name" value={form.name} onChange={(e) => updateForm('name', e.target.value)} required />
        <Input label="Slug" name="slug" value={form.slug} onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))} placeholder="company-name" required />
        <Input label="Contact Email" type="email" name="contact_email" value={form.contact_email} onChange={(e) => updateForm('contact_email', e.target.value)} required />
        <Select
          label="Subscription Tier"
          name="subscription_tier_id"
          value={form.subscription_tier_id}
          onChange={(e) => updateForm('subscription_tier_id', e.target.value)}
          options={tiers.map((t) => ({ value: t.id, label: t.display_name }))}
          required
        />
        <Input label="MC Number" name="mc_number" value={form.mc_number} onChange={(e) => updateForm('mc_number', e.target.value)} />
        <Input label="DOT Number" name="dot_number" value={form.dot_number} onChange={(e) => updateForm('dot_number', e.target.value)} />
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>Create Tenant</Button>
        </div>
      </form>
    </Modal>
  );
}
