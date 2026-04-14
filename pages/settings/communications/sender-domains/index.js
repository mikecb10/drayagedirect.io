import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Globe,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Info,
  ChevronRight,
  ChevronDown,
  Mail,
  Copy,
  Shield,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Alert from '../../../../components/ui/Alert';
import Modal from '../../../../components/ui/Modal';

/**
 * Settings → Communications → Sender Domains
 *
 * A sender domain is the thing you verify once (via CNAME DNS records
 * for DKIM/SPF) before you can send from any address under it. Once a
 * domain is verified, users can create `tenant_sender_addresses` rows
 * on it (dispatch@, billing@, ops@) and pick those from the
 * Configuration editor's sender picker.
 *
 * Phase 1 (Milestone 4a-1) limitation: no real SendGrid domain-auth
 * API integration yet. Operators can manually mark a domain as
 * 'verified' via the Status dropdown for testing single-sender flows.
 * Real DNS record issuance + verification check arrives in 4a-4.
 */
export default function SenderDomainsList() {
  const [loading, setLoading] = useState(true);
  const [domains, setDomains] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/emails/sender-domains');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load sender domains');
      }
      const data = await res.json();
      setDomains(data.domains || []);
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
    if (!q) return domains;
    return domains.filter((d) =>
      `${d.domain} ${d.default_from_name || ''}`.toLowerCase().includes(q)
    );
  }, [domains, search]);

  async function setStatus(domain, newStatus) {
    setBusyId(domain.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/sender-domains/${domain.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to update status');
      }
      await load();
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteDomain(domain) {
    if (
      !confirm(
        `Delete "${domain.domain}"? Any sender addresses under this domain will also be removed, and configurations pointing at them will be unlinked. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(domain.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/sender-domains/${domain.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setDomains((ds) => ds.filter((d) => d.id !== domain.id));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleCreated(newDomain) {
    setDomains((ds) => [{ ...newDomain, address_count: 0 }, ...ds]);
    setCreateOpen(false);
  }

  return (
    <SettingsLayout title="Sender Domains">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Sender Domains
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Register domains your emails will send from. Each domain must be <strong>verified</strong> (via DNS CNAME records for DKIM/SPF) before its addresses can dispatch real mail. Once verified, create <Link href="/settings/communications/sender-addresses" className="text-blue-600 dark:text-blue-400 hover:underline">sender addresses</Link> (dispatch@, billing@, etc.) and wire them up to configurations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Domain
          </button>
        </div>

        {/* Phase 1 notice */}
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-3 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            <strong>Phase 1 limitation:</strong> real domain authentication via the SendGrid API (automatic DNS record issuance + verification check) lands in Milestone 4a-4. For now, you can manually register a domain and mark it verified using the Status dropdown — useful for single-sender verification testing where the &quot;domain&quot; is really just a placeholder for the verified single-sender email.
          </div>
        </div>

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
              placeholder="Search domains..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
            <span>
              <strong className="text-gray-900 dark:text-slate-100">{domains.length}</strong> total
            </span>
            <span>
              <strong className="text-gray-900 dark:text-slate-100">
                {domains.filter((d) => d.status === 'verified').length}
              </strong>{' '}
              verified
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
            <Globe className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {search ? 'No domains match your search' : 'No sender domains yet'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {search
                ? 'Try clearing the search.'
                : 'Add a domain to start sending mail via SendGrid.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((d) => (
              <DomainRow
                key={d.id}
                domain={d}
                busy={busyId === d.id}
                expanded={expandedId === d.id}
                onToggleExpand={() => setExpandedId(expandedId === d.id ? null : d.id)}
                onSetStatus={(status) => setStatus(d, status)}
                onDelete={() => deleteDomain(d)}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateDomainModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </SettingsLayout>
  );
}

/* ─────────────────────── Domain Row ─────────────────────── */

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    Icon: Clock,
    className:
      'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900/60',
  },
  verifying: {
    label: 'Verifying',
    Icon: Clock,
    className:
      'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-900/60',
  },
  verified: {
    label: 'Verified',
    Icon: CheckCircle2,
    className:
      'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-900/60',
  },
  failed: {
    label: 'Failed',
    Icon: XCircle,
    className:
      'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-900/60',
  },
  revoked: {
    label: 'Revoked',
    Icon: AlertCircle,
    className:
      'text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 border-gray-200 dark:border-slate-700',
  },
};

function DomainRow({ domain, busy, expanded, onToggleExpand, onSetStatus, onDelete }) {
  const cfg = STATUS_CONFIG[domain.status] || STATUS_CONFIG.pending;
  const { Icon } = cfg;
  const hasDnsRecords = Array.isArray(domain.dns_records) && domain.dns_records.length > 0;

  return (
    <div
      className={`rounded-xl border transition-colors ${
        domain.status === 'verified'
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 pt-0.5 text-gray-400 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-200"
          title="Expand details"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              domain.status === 'verified'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60'
                : 'bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700'
            }`}
          >
            <Globe
              className={`w-4 h-4 ${
                domain.status === 'verified'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-500 dark:text-slate-400'
              }`}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate font-mono">
              {domain.domain}
            </span>
            <span
              className={`text-[9px] uppercase tracking-wider font-semibold border px-1.5 py-0.5 rounded inline-flex items-center gap-1 ${cfg.className}`}
            >
              <Icon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
          </div>
          {domain.default_from_name && (
            <div className="text-xs text-gray-500 dark:text-slate-400 mb-1">
              Default From: <span className="font-medium">{domain.default_from_name}</span>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-slate-300 flex-wrap">
            <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
              <Mail className="w-3 h-3" />
              {domain.address_count || 0}{' '}
              {domain.address_count === 1 ? 'address' : 'addresses'}
            </span>
            {domain.last_verification_check_at && (
              <span className="text-[10px] text-gray-400 dark:text-slate-500">
                Last check: {new Date(domain.last_verification_check_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <select
            value={domain.status}
            onChange={(e) => onSetStatus(e.target.value)}
            disabled={busy}
            className="text-xs rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-gray-700 dark:text-slate-200 px-2 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
            title="Change verification status (Phase 1)"
          >
            <option value="pending">Pending</option>
            <option value="verifying">Verifying</option>
            <option value="verified">Verified</option>
            <option value="failed">Failed</option>
            <option value="revoked">Revoked</option>
          </select>
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

      {expanded && (
        <div className="border-t border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-900/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />
            <h4 className="text-xs font-semibold text-gray-700 dark:text-slate-200 uppercase tracking-wider">
              DNS Records
            </h4>
          </div>
          {!hasDnsRecords ? (
            <div className="text-xs text-gray-500 dark:text-slate-400 italic">
              No DNS records stored for this domain. In Phase 1 these are generated by SendGrid when you call the domain-auth API (Milestone 4a-4). For single-sender verification, DNS records are not needed — just flip the status to &quot;Verified&quot; directly.
            </div>
          ) : (
            <div className="space-y-2">
              {domain.dns_records.map((r, i) => (
                <DnsRecordRow key={i} record={r} />
              ))}
            </div>
          )}
          {domain.last_verification_error && (
            <div className="mt-3 text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg p-2">
              <strong>Last error:</strong> {domain.last_verification_error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DnsRecordRow({ record }) {
  const [copied, setCopied] = useState(null);
  function copyField(field, value) {
    navigator.clipboard?.writeText(value || '');
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  }
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2.5 text-xs">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 px-1.5 py-0.5 rounded">
          {record.type || 'CNAME'}
        </span>
        {record.verified ? (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-0.5">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Verified
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 inline-flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            Pending
          </span>
        )}
      </div>
      <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-center text-gray-600 dark:text-slate-300">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">
          Host
        </span>
        <code className="font-mono text-gray-900 dark:text-slate-100 truncate">
          {record.host || '—'}
        </code>
        <button
          type="button"
          onClick={() => copyField('host', record.host)}
          className="text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          title="Copy host"
        >
          <Copy className="w-3 h-3" />
          {copied === 'host' && <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓</span>}
        </button>
      </div>
      <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-center text-gray-600 dark:text-slate-300 mt-1">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 dark:text-slate-500">
          Points to
        </span>
        <code className="font-mono text-gray-900 dark:text-slate-100 truncate">
          {record.points_to || '—'}
        </code>
        <button
          type="button"
          onClick={() => copyField('points_to', record.points_to)}
          className="text-gray-400 dark:text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
          title="Copy value"
        >
          <Copy className="w-3 h-3" />
          {copied === 'points_to' && <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓</span>}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────── Create Modal ─────────────────────── */

function CreateDomainModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    domain: '',
    default_from_name: '',
    status: 'pending',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const domain = form.domain.trim().toLowerCase();
    if (!domain) {
      setError('Domain is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/tenant/emails/sender-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain,
          default_from_name: form.default_from_name.trim() || null,
          status: form.status,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to create domain');
      onCreated(body.domain);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Add Sender Domain" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Domain <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={form.domain}
            onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
            placeholder="drayagedirect.io"
            autoFocus
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            The email domain you&apos;ll send mail from. Don&apos;t include a protocol or @ sign.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Default &quot;From&quot; name
          </label>
          <input
            type="text"
            value={form.default_from_name}
            onChange={(e) => setForm((f) => ({ ...f, default_from_name: e.target.value }))}
            placeholder="DrayageDirect Dispatch"
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            Fallback display name if an address on this domain doesn&apos;t override it. Optional.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Initial Status
          </label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          >
            <option value="pending">Pending — not yet verified</option>
            <option value="verified">Verified — for single-sender testing</option>
          </select>
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            For single-sender verification flows in Phase 1, pick <strong>Verified</strong>. For real domain authentication (4a-4), leave as <strong>Pending</strong>.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Add Domain
          </Button>
        </div>
      </form>
    </Modal>
  );
}
