import { useEffect, useState } from 'react';
import { Ship, Plus, Search, Edit2, Trash2, X } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import SettingsTabs from '../../components/settings/SettingsTabs';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import FormSection, { SectionCard } from '../../components/ui/FormSection';
import { PageHeader } from '../../components/ui/ModuleHeader';
import Alert from '../../components/ui/Alert';


const EMPTY_OWNER = {
  name: '',
  label: '',
  scac_code: '',
  contact_name: '',
  phone: '',
  email: '',
  address_line1: '',
  city: '',
  state: '',
  zip: '',
  website: '',
  notes: '',
};

function ContainerOwnersSettings() {
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_OWNER);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await fetch(`/api/tenant/container-owners?${params}`);
      if (!res.ok) throw new Error('Failed to load container owners');
      const data = await res.json();
      setOwners(data.container_owners || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_OWNER);
    setModalOpen(true);
  }

  function openEdit(owner) {
    if (owner.is_system) {
      setError('System container owners cannot be edited. You can disable them or clone them.');
      return;
    }
    setEditing(owner);
    setForm({
      name: owner.name || '',
      label: owner.label || '',
      scac_code: owner.scac_code || '',
      contact_name: owner.contact_name || '',
      phone: owner.phone || '',
      email: owner.email || '',
      address_line1: owner.address_line1 || '',
      city: owner.city || '',
      state: owner.state || '',
      zip: owner.zip || '',
      website: owner.website || '',
      notes: owner.notes || '',
    });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form };
      const url = editing
        ? `/api/tenant/container-owners/${editing.id}`
        : '/api/tenant/container-owners';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save');
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(owner) {
    if (owner.is_system) {
      setError('System container owners cannot be deleted.');
      return;
    }
    if (!confirm(`Delete ${owner.name}?`)) return;
    try {
      const res = await fetch(`/api/tenant/container-owners/${owner.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete');
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggle(owner) {
    const next = !(owner.effective_enabled ?? owner.is_enabled);
    setOwners((list) =>
      list.map((o) => (o.id === owner.id ? { ...o, effective_enabled: next } : o))
    );
    try {
      const res = await fetch(`/api/tenant/container-owners/${owner.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to toggle');
      }
    } catch (e) {
      setError(e.message);
      await load();
    }
  }

  const systemCount = owners.filter((o) => o.is_system).length;
  const tenantCount = owners.filter((o) => !o.is_system).length;

  return (
    <>
      <div className="max-w-6xl space-y-4">
        <PageHeader
          variant="plain"
          title={<><Ship className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Container Owners</>}
          description={`Steamship lines and container owners. DrayageDirect seeds ${systemCount} common SSLs — add your own for regional carriers or bonded partners.`}
          actions={<Button onClick={openNew}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add Container Owner</Button>}
          className="mb-[var(--space-section)]"
        />

        <SettingsTabs />

        {error && <Alert type="error" message={error} />}

        {/* Search */}
        <SectionCard title="Search" columns={0}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or SCAC..."
              className="w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong pl-9 pr-3 py-2 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </SectionCard>

        {/* Stats */}
        <div className="flex gap-3">
          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex-1">
            <div className="text-field-label text-muted">System</div>
            <div className="text-xl font-bold text-strong">{systemCount}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex-1">
            <div className="text-field-label text-muted">Your Custom</div>
            <div className="text-xl font-bold text-strong">{tenantCount}</div>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex-1">
            <div className="text-field-label text-muted">Total</div>
            <div className="text-xl font-bold text-strong">{owners.length}</div>
          </div>
        </div>

        {/* Table */}
        <SectionCard title="Container Owners" columns={0}>
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="bg-gray-50 dark:bg-slate-800/50 text-field-label text-muted">
                <tr>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Label</th>
                  <th className="text-left px-4 py-2">SCAC</th>
                  <th className="text-left px-4 py-2">Contact</th>
                  <th className="text-left px-4 py-2">Location</th>
                  <th className="text-left px-4 py-2">Source</th>
                  <th className="text-center px-4 py-2 w-20">Enabled</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-helper text-muted">
                      Loading...
                    </td>
                  </tr>
                ) : owners.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-helper text-muted">
                      No container owners match "{search}"
                    </td>
                  </tr>
                ) : (
                  owners.map((o) => {
                    const isEnabled = o.effective_enabled ?? o.is_enabled;
                    return (
                      <tr
                        key={o.id}
                        className={`hover:bg-gray-50 dark:hover:bg-slate-800/60 ${isEnabled ? '' : 'opacity-50'}`}
                      >
                        <td className="px-4 py-2 font-medium text-strong">{o.name}</td>
                        <td className="px-4 py-2 text-helper text-muted">{o.label || '—'}</td>
                        <td className="px-4 py-2">
                          {o.scac_code ? (
                            <span className="text-[10px] uppercase tracking-wide font-mono font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              {o.scac_code}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-helper text-muted">
                          {o.contact_name || '—'}
                          {o.phone && <div className="text-muted">{o.phone}</div>}
                        </td>
                        <td className="px-4 py-2 text-helper text-muted">
                          {[o.city, o.state].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-2">
                          {o.is_system ? (
                            <span className="text-[10px] uppercase tracking-wide text-muted">
                              system
                            </span>
                          ) : (
                            <span className="text-[10px] uppercase tracking-wide font-semibold text-blue-700">
                              custom
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleToggle(o)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                              isEnabled ? 'bg-blue-600' : 'bg-gray-300 dark:bg-slate-700'
                            }`}
                            title={
                              isEnabled
                                ? 'Hide from load dropdowns'
                                : 'Show in load dropdowns'
                            }
                          >
                            <span
                              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                isEnabled ? 'translate-x-5' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {!o.is_system && (
                            <div className="flex items-center gap-1 justify-end">
                              <button
                                onClick={() => openEdit(o)}
                                className="text-muted hover:text-blue-600"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDelete(o)}
                                className="text-muted hover:text-red-500"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add Container Owner'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-5">
          <FormSection title="Identity">
            <Input
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Maersk Line"
            />
            <Input
              label="Label (short display)"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value.toUpperCase() })}
              placeholder="MAERSK"
            />
            <Input
              label="SCAC Code"
              value={form.scac_code}
              onChange={(e) => setForm({ ...form, scac_code: e.target.value.toUpperCase() })}
              placeholder="MAEU"
              helpText="2-4 letter Standard Carrier Alpha Code"
            />
            <Input
              label="Website"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
              placeholder="https://..."
            />
          </FormSection>

          <FormSection title="Contact">
            <Input
              label="Contact Name"
              value={form.contact_name}
              onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            />
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
          </FormSection>

          <FormSection title="Address">
            <Input
              label="Street Address"
              value={form.address_line1}
              onChange={(e) => setForm({ ...form, address_line1: e.target.value })}
              className="sm:col-span-2"
            />
            <Input
              label="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              label="State"
              value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}
            />
            <Input
              label="Zip"
              value={form.zip}
              onChange={(e) => setForm({ ...form, zip: e.target.value })}
            />
          </FormSection>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
            <Button variant="secondary" type="button" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Save Changes' : 'Add Container Owner'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

ContainerOwnersSettings.getLayout = (page) => (
  <SettingsLayout title="Container Owners">{page}</SettingsLayout>
);

export default ContainerOwnersSettings;
