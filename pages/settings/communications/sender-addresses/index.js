import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Mail,
  Plus,
  Search,
  Edit3,
  Power,
  Trash2,
  Star,
  Globe,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Alert from '../../../../components/ui/Alert';
import Modal from '../../../../components/ui/Modal';

/**
 * Settings → Communications → Sender Addresses
 *
 * A sender address is a specific `local_part@domain` identity that
 * shows up as the From: field in outbound mail. Addresses live under
 * a verified `tenant_sender_domains` row — picking a domain here
 * requires that it exists first (link to /settings/communications/sender-domains).
 *
 * Each address has a friendly display name, an optional reply-to
 * override, an is_default flag (only one default per tenant via partial
 * unique index), and an active flag.
 */
export default function SenderAddressesList() {
  const [loading, setLoading] = useState(true);
  const [addresses, setAddresses] = useState([]);
  const [domains, setDomains] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [addressesRes, domainsRes] = await Promise.all([
        fetch('/api/tenant/emails/sender-addresses'),
        fetch('/api/tenant/emails/sender-domains'),
      ]);
      if (!addressesRes.ok) {
        const b = await addressesRes.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load sender addresses');
      }
      if (!domainsRes.ok) {
        const b = await domainsRes.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load sender domains');
      }
      const addrData = await addressesRes.json();
      const domData = await domainsRes.json();
      setAddresses(addrData.addresses || []);
      setDomains(domData.domains || []);
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
    if (!q) return addresses;
    return addresses.filter((a) =>
      `${a.full_address} ${a.display_name || ''} ${a.reply_to || ''}`
        .toLowerCase()
        .includes(q)
    );
  }, [addresses, search]);

  async function toggleActive(address) {
    setBusyId(address.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/sender-addresses/${address.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !address.is_active }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update');
      }
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAddress(address) {
    if (
      !confirm(
        `Delete "${address.full_address}"? Any configurations using this address as a sender will be unlinked. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(address.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/sender-addresses/${address.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setAddresses((as) => as.filter((a) => a.id !== address.id));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleCreated(newAddress) {
    setAddresses((as) => [newAddress, ...as]);
    setCreateOpen(false);
  }

  function handleUpdated(updatedAddress) {
    setAddresses((as) =>
      as.map((a) => (a.id === updatedAddress.id ? updatedAddress : a))
    );
    setEditingAddress(null);
  }

  const hasDomains = domains.length > 0;
  const hasVerifiedDomains = domains.some((d) => d.status === 'verified');

  return (
    <SettingsLayout title="Sender Addresses">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Sender Addresses
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Specific From: identities your configurations can send as — <strong>dispatch@</strong>, <strong>billing@</strong>, <strong>ops@</strong>, etc. Addresses live under a <Link href="/settings/communications/sender-domains" className="text-blue-600 dark:text-blue-400 hover:underline">verified sender domain</Link>. One address per tenant can be marked as the default.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!hasDomains}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={hasDomains ? 'Add new sender address' : 'Register a domain first'}
          >
            <Plus className="w-4 h-4" />
            Add Address
          </button>
        </div>

        {/* No-domain warning */}
        {!hasDomains && !loading && (
          <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              <strong>No sender domains registered.</strong> You need to register at least one domain before you can create addresses under it.{' '}
              <Link
                href="/settings/communications/sender-domains"
                className="underline font-semibold hover:text-amber-900 dark:hover:text-amber-100"
              >
                Go to Sender Domains →
              </Link>
            </div>
          </div>
        )}

        {hasDomains && !hasVerifiedDomains && !loading && (
          <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-3 flex items-start gap-2">
            <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              None of your sender domains are verified yet. You can still create addresses, but they won&apos;t be able to actually send mail until the parent domain is verified. For single-sender testing, mark the domain as Verified on the{' '}
              <Link
                href="/settings/communications/sender-domains"
                className="underline font-semibold hover:text-amber-900 dark:hover:text-amber-100"
              >
                Sender Domains page
              </Link>
              .
            </div>
          </div>
        )}

        {error && <Alert type="error" message={error} className="mb-4" />}
        {actionError && <Alert type="error" message={actionError} className="mb-4" />}

        {/* Search + stats */}
        <div className="mb-4 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search addresses..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
            <span>
              <strong className="text-gray-900 dark:text-slate-100">{addresses.length}</strong> total
            </span>
            <span>
              <strong className="text-gray-900 dark:text-slate-100">
                {addresses.filter((a) => a.is_active).length}
              </strong>{' '}
              active
            </span>
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/40 dark:bg-slate-900/40">
            <Mail className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {search ? 'No addresses match your search' : 'No sender addresses yet'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {search
                ? 'Try clearing the search.'
                : hasDomains
                ? 'Create your first From: identity.'
                : 'Register a sender domain first, then come back here.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((a) => (
              <AddressRow
                key={a.id}
                address={a}
                busy={busyId === a.id}
                onEdit={() => setEditingAddress(a)}
                onToggle={() => toggleActive(a)}
                onDelete={() => deleteAddress(a)}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <AddressModal
          mode="create"
          domains={domains}
          onClose={() => setCreateOpen(false)}
          onSaved={handleCreated}
        />
      )}

      {editingAddress && (
        <AddressModal
          mode="edit"
          address={editingAddress}
          domains={domains}
          onClose={() => setEditingAddress(null)}
          onSaved={handleUpdated}
        />
      )}
    </SettingsLayout>
  );
}

/* ─────────────────────── Address Row ─────────────────────── */

function AddressRow({ address, busy, onEdit, onToggle, onDelete }) {
  const domainVerified = address.domain_status === 'verified';
  return (
    <div
      className={`group rounded-xl border transition-colors ${
        address.is_active
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              address.is_default
                ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60'
                : 'bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60'
            }`}
          >
            {address.is_default ? (
              <Star className="w-4 h-4 text-amber-600 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />
            ) : (
              <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">
              {address.display_name}
            </span>
            {address.is_default && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded">
                Default
              </span>
            )}
            {!address.is_active && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                Inactive
              </span>
            )}
          </div>
          <div className="text-xs text-gray-600 dark:text-slate-300 font-mono mb-1 truncate">
            {address.full_address}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-slate-400 flex-wrap">
            <span className="inline-flex items-center gap-1">
              <Globe className="w-3 h-3" />
              {address.domain_name}
              {domainVerified ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400 ml-0.5" title="Domain verified" />
              ) : (
                <AlertCircle className="w-3 h-3 text-amber-600 dark:text-amber-400 ml-0.5" title={`Domain status: ${address.domain_status}`} />
              )}
            </span>
            {address.reply_to && (
              <span className="inline-flex items-center gap-1">
                Reply to: <span className="font-mono">{address.reply_to}</span>
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
              address.is_active
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={address.is_active ? 'Deactivate' : 'Activate'}
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

/* ─────────────────────── Create/Edit Modal ─────────────────────── */

function AddressModal({ mode, address, domains, onClose, onSaved }) {
  const [form, setForm] = useState(
    mode === 'edit'
      ? {
          domain_id: address.domain_id,
          local_part: address.local_part,
          display_name: address.display_name,
          reply_to: address.reply_to || '',
          is_active: address.is_active,
          is_default: address.is_default,
        }
      : {
          domain_id: domains[0]?.id || '',
          local_part: '',
          display_name: '',
          reply_to: '',
          is_active: true,
          is_default: false,
        }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const selectedDomain = useMemo(
    () => domains.find((d) => d.id === form.domain_id),
    [domains, form.domain_id]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (mode === 'create' && !form.domain_id) {
      setError('Domain is required');
      return;
    }
    const local = form.local_part.trim().toLowerCase();
    if (!local) {
      setError('Local part is required');
      return;
    }
    const displayName = form.display_name.trim();
    if (!displayName) {
      setError('Display name is required');
      return;
    }

    setSaving(true);
    try {
      const body = {
        local_part: local,
        display_name: displayName,
        reply_to: form.reply_to.trim() || null,
        is_active: form.is_active,
        is_default: form.is_default,
      };
      if (mode === 'create') body.domain_id = form.domain_id;

      const url =
        mode === 'edit'
          ? `/api/tenant/emails/sender-addresses/${address.id}`
          : '/api/tenant/emails/sender-addresses';
      const res = await fetch(url, {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(resBody.error || 'Failed to save');
      onSaved(resBody.address);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const title = mode === 'edit' ? 'Edit Sender Address' : 'Add Sender Address';

  return (
    <Modal isOpen={true} onClose={onClose} title={title} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Domain <span className="text-rose-500">*</span>
          </label>
          {mode === 'edit' ? (
            <div className="px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-sm text-gray-600 dark:text-slate-400 font-mono">
              {address.domain_name}
              <span className="ml-2 text-[10px] text-gray-400 dark:text-slate-500 uppercase tracking-wider">
                (immutable — delete + recreate to change)
              </span>
            </div>
          ) : (
            <select
              value={form.domain_id}
              onChange={(e) => setForm((f) => ({ ...f, domain_id: e.target.value }))}
              className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              {domains.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.domain} {d.status !== 'verified' ? `(${d.status})` : ''}
                </option>
              ))}
            </select>
          )}
          {selectedDomain && selectedDomain.status !== 'verified' && mode === 'create' && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              This domain is {selectedDomain.status}. Addresses created here won&apos;t be able to send until the domain is verified.
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Local Part <span className="text-rose-500">*</span>
          </label>
          <div className="flex items-center">
            <input
              type="text"
              value={form.local_part}
              onChange={(e) => setForm((f) => ({ ...f, local_part: e.target.value }))}
              placeholder="dispatch"
              disabled={mode === 'edit'}
              className="flex-1 px-3 py-2 rounded-l-lg border border-r-0 border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono disabled:bg-gray-50 disabled:dark:bg-slate-900 disabled:text-gray-500 disabled:dark:text-slate-400"
            />
            <span className="px-3 py-2 rounded-r-lg border border-l-0 border-gray-300 dark:border-slate-700 bg-gray-100 dark:bg-slate-800 text-sm text-gray-500 dark:text-slate-400 font-mono">
              @{selectedDomain?.domain || 'your-domain.com'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            The part before the @ sign. Must match SendGrid&apos;s verified single-sender email exactly, or be a local part on a domain-authenticated domain.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Display Name <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="DrayageDirect Dispatch"
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            The friendly name recipients see in the From: field.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Reply-To <span className="text-gray-400 dark:text-slate-500">(optional)</span>
          </label>
          <input
            type="email"
            value={form.reply_to}
            onChange={(e) => setForm((f) => ({ ...f, reply_to: e.target.value }))}
            placeholder="replies@your-domain.com"
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            Override where replies go. Leave blank to use the From address.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950"
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950"
            />
            Default sender address
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {mode === 'edit' ? 'Save Changes' : 'Add Address'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
