import { useEffect, useMemo, useState } from 'react';
import {
  Truck,
  Plus,
  Search,
  Edit3,
  Trash2,
  Power,
  Home,
  Phone,
  Mail,
  MapPin,
  User as UserIcon,
  X,
  Save,
} from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import Field from '../../components/ui/Field';

/**
 * Settings → Equipment → Chassis Owners
 *
 * Manages the tenant-created directory of chassis provider profiles
 * (FlexiVan, TRAC, DCLI, carrier's own fleet, etc.). Each profile is
 * used as an option in the Chassis Owner dropdown on loads and in the
 * Umbrella editor's Chassis Owner scope filter.
 *
 * Simple list + modal-based create/edit flow. Soft delete sets
 * deleted_at + is_enabled=false so the owner vanishes from pickers
 * without breaking references to it on historical loads.
 */
function ChassisOwnersSettings() {
  const [loading, setLoading] = useState(true);
  const [owners, setOwners] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = create mode, obj = edit mode
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/chassis-owners');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load chassis owners');
      }
      const data = await res.json();
      setOwners(data.chassis_owners || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) => {
      const hay = `${o.name || ''} ${o.code || ''} ${o.contact_name || ''} ${o.city || ''} ${o.state || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [owners, search]);

  async function toggleEnabled(owner) {
    setBusyId(owner.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/chassis-owners/${owner.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !owner.is_enabled }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      const data = await res.json();
      setOwners((os) =>
        os.map((x) => (x.id === owner.id ? data.chassis_owner : x))
      );
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteOwner(owner) {
    if (!confirm(`Delete "${owner.name}"? This soft-deletes the profile — historical loads that reference it keep their data, but new loads won't see it in the picker.`)) {
      return;
    }
    setBusyId(owner.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/chassis-owners/${owner.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setOwners((os) => os.filter((x) => x.id !== owner.id));
      setActionSuccess(`Deleted "${owner.name}"`);
      setTimeout(() => setActionSuccess(null), 2000);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(owner) {
    setEditing(owner);
    setModalOpen(true);
  }

  async function handleModalSave(payload) {
    setActionError(null);
    try {
      const url = editing
        ? `/api/tenant/chassis-owners/${editing.id}`
        : '/api/tenant/chassis-owners';
      const method = editing ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Save failed');
      }
      const data = await res.json();
      const saved = data.chassis_owner;

      if (editing) {
        setOwners((os) => os.map((x) => (x.id === saved.id ? saved : x)));
        setActionSuccess(`Updated "${saved.name}"`);
      } else {
        setOwners((os) => [...os, saved]);
        setActionSuccess(`Created "${saved.name}"`);
      }
      setTimeout(() => setActionSuccess(null), 2000);
      setModalOpen(false);
      setEditing(null);
    } catch (e) {
      setActionError(e.message);
      throw e; // let the modal surface it too
    }
  }

  const enabledCount = owners.filter((o) => o.is_enabled).length;
  const ownFleetCount = owners.filter((o) => o.is_own_fleet).length;

  return (
    <>
      <div className="max-w-5xl">
        {/* Header */}
        <PageHeader
          variant="plain"
          title={<><Truck className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Chassis Owners</>}
          description="Directory of chassis provider profiles — pool operators (FlexiVan, TRAC, DCLI), leased fleets, and your own fleet. These profiles populate the Chassis Owner dropdown on loads and in the Umbrella editor."
          actions={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-1 inline -mt-0.5" />Add Chassis Owner</Button>}
          className="mb-[var(--space-section)]"
        />

        {error && <Alert type="error" message={error} className="mb-4" />}
        {actionError && <Alert type="error" message={actionError} className="mb-4" />}
        {actionSuccess && <Alert type="success" message={actionSuccess} className="mb-4" />}

        {/* Search + stats */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, code, contact, or city..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-body text-strong placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-4 text-helper text-muted">
            <span>
              <strong className="text-strong">{owners.length}</strong> total
            </span>
            <span>
              <strong className="text-strong">{enabledCount}</strong> enabled
            </span>
            <span>
              <strong className="text-strong">{ownFleetCount}</strong> own fleet
            </span>
          </div>
        </div>

        {/* List */}
        <SectionCard title="Chassis Owners" columns={0}>
          {loading ? (
            <div className="py-20 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
              <Truck className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
              <div className="text-body font-semibold text-strong">
                {search ? 'No chassis owners match your search' : 'No chassis owners yet'}
              </div>
              <div className="text-helper text-muted mt-1">
                {search
                  ? 'Try clearing the search'
                  : 'Create your first chassis owner profile to use them on loads and in umbrella scopes.'}
              </div>
            </div>
          ) : (
            <div className="space-y-[var(--space-inline)]">
              {filtered.map((owner) => (
                <ChassisOwnerRow
                  key={owner.id}
                  owner={owner}
                  busy={busyId === owner.id}
                  onEdit={() => openEdit(owner)}
                  onToggle={() => toggleEnabled(owner)}
                  onDelete={() => deleteOwner(owner)}
                />
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      {/* Create/Edit modal */}
      {modalOpen && (
        <ChassisOwnerModal
          initial={editing}
          onClose={() => {
            setModalOpen(false);
            setEditing(null);
          }}
          onSave={handleModalSave}
        />
      )}
    </>
  );
}

ChassisOwnersSettings.getLayout = (page) => (
  <SettingsLayout title="Chassis Owners">{page}</SettingsLayout>
);

export default ChassisOwnersSettings;

function ChassisOwnerRow({ owner, busy, onEdit, onToggle, onDelete }) {
  const address = [owner.city, owner.state].filter(Boolean).join(', ');
  return (
    <div
      className={`group rounded-xl border transition-colors ${
        owner.is_enabled
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              owner.is_own_fleet
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60'
                : 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
            }`}
          >
            {owner.is_own_fleet ? (
              <Home className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Truck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <button
              type="button"
              onClick={onEdit}
              className="text-body font-semibold text-strong hover:text-blue-700 dark:hover:text-blue-400 truncate"
            >
              {owner.name}
            </button>
            {owner.code && (
              <span className="text-[9px] uppercase tracking-wider font-mono font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                {owner.code}
              </span>
            )}
            {owner.is_own_fleet && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/60 px-1.5 py-0.5 rounded">
                Own Fleet
              </span>
            )}
            {!owner.is_enabled && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
                Disabled
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-helper text-muted flex-wrap">
            {owner.contact_name && (
              <span className="inline-flex items-center gap-1">
                <UserIcon className="w-3 h-3" />
                {owner.contact_name}
              </span>
            )}
            {owner.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {owner.phone}
              </span>
            )}
            {owner.email && (
              <span className="inline-flex items-center gap-1 truncate">
                <Mail className="w-3 h-3" />
                {owner.email}
              </span>
            )}
            {address && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {address}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:text-slate-500 dark:hover:text-blue-400 dark:hover:bg-blue-950/40 transition-colors"
            title="Edit"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
              owner.is_enabled
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={owner.is_enabled ? 'Disable' : 'Enable'}
          >
            <Power className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 dark:text-slate-500 dark:hover:text-rose-400 dark:hover:bg-rose-950/40 transition-colors disabled:opacity-50"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Create / Edit modal
// ──────────────────────────────────────────────────────────────
function ChassisOwnerModal({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: initial?.name || '',
    code: initial?.code || '',
    address_line1: initial?.address_line1 || '',
    address_line2: initial?.address_line2 || '',
    city: initial?.city || '',
    state: initial?.state || '',
    zip: initial?.zip || '',
    contact_name: initial?.contact_name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    is_own_fleet: initial?.is_own_fleet || false,
    is_enabled: initial?.is_enabled !== false,
    notes: initial?.notes || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Close on Escape + body scroll lock
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function handleChange(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();
    setSaving(true);
    setError(null);
    try {
      if (!form.name.trim()) {
        setError('Name is required');
        setSaving(false);
        return;
      }
      await onSave(form);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 dark:bg-black/75 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] rounded-2xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Truck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-semibold text-gray-900 dark:text-slate-100">
              {initial ? 'Edit Chassis Owner' : 'New Chassis Owner'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Directory profile for a chassis provider
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-5">
            {error && <Alert type="error" message={error} />}

            {/* Identity */}
            <div>
              <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">Identity</h3>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-[var(--space-field)]">
                <Input
                  label="Name *"
                  value={form.name}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="e.g. FlexiVan Pool, TRAC Intermodal, My Own Fleet"
                  required
                  autoComplete="off"
                />
                <Input
                  label="Code"
                  value={form.code}
                  onChange={(e) =>
                    handleChange('code', e.target.value.toUpperCase().slice(0, 8))
                  }
                  placeholder="e.g. FLXI"
                  autoComplete="off"
                  helpText="Optional short code"
                />
              </div>
            </div>

            {/* Contact */}
            <div>
              <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">Point of Contact</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-[var(--space-field)]">
                <Input
                  label="Contact Name"
                  value={form.contact_name}
                  onChange={(e) => handleChange('contact_name', e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="off"
                />
                <Input
                  label="Phone"
                  value={form.phone}
                  onChange={(e) => handleChange('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  autoComplete="off"
                />
              </div>
              <div className="mt-3">
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => handleChange('email', e.target.value)}
                  placeholder="ops@chassisowner.com"
                  autoComplete="off"
                />
              </div>
            </div>

            {/* Address */}
            <div>
              <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">Address</h3>
              <div className="space-y-[var(--space-field)]">
                <Input
                  label="Street"
                  value={form.address_line1}
                  onChange={(e) => handleChange('address_line1', e.target.value)}
                  placeholder="123 Main St"
                  autoComplete="off"
                />
                <Input
                  label="Unit / Suite"
                  value={form.address_line2}
                  onChange={(e) => handleChange('address_line2', e.target.value)}
                  placeholder="Suite 500 (optional)"
                  autoComplete="off"
                />
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_160px] gap-[var(--space-field)]">
                  <Input
                    label="City"
                    value={form.city}
                    onChange={(e) => handleChange('city', e.target.value)}
                    placeholder="Long Beach"
                    autoComplete="off"
                  />
                  <Input
                    label="State"
                    value={form.state}
                    onChange={(e) =>
                      handleChange('state', e.target.value.toUpperCase().slice(0, 2))
                    }
                    placeholder="CA"
                    maxLength={2}
                    autoComplete="off"
                  />
                  <Input
                    label="ZIP"
                    value={form.zip}
                    onChange={(e) => handleChange('zip', e.target.value)}
                    placeholder="90802"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>

            {/* Flags */}
            <div>
              <h3 className="text-field-label text-muted mb-[var(--space-field-label)]">Options</h3>
              <div className="space-y-2">
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.is_own_fleet}
                    onChange={(e) => handleChange('is_own_fleet', e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="text-body font-medium text-strong">
                      Own Fleet
                    </div>
                    <div className="text-helper text-muted">
                      This profile represents YOUR OWN chassis fleet (not a third-party pool). Shows a different icon in the list.
                    </div>
                  </div>
                </label>
                <label className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.is_enabled}
                    onChange={(e) => handleChange('is_enabled', e.target.checked)}
                    className="mt-0.5 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="text-body font-medium text-strong">
                      Enabled
                    </div>
                    <div className="text-helper text-muted">
                      Disabled owners are hidden from pickers but not deleted.
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Notes */}
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => handleChange('notes', e.target.value)}
                rows={2}
                placeholder="Internal notes (e.g. account number, special handling, etc.)"
                className="block w-full rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-body text-strong placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </Field>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 px-6 py-3 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 flex items-center justify-end gap-2">
            <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              <Save className="w-3.5 h-3.5 mr-1.5" />
              {initial ? 'Save Changes' : 'Create Chassis Owner'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
