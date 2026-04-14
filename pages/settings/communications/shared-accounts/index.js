import { useEffect, useMemo, useState } from 'react';
import {
  Inbox,
  Plus,
  Search,
  Power,
  Trash2,
  Users as UsersIcon,
  Mail,
  Globe,
  Shield,
  AlertCircle,
  CheckCircle2,
  Send,
  Eye,
  Info,
} from 'lucide-react';
import SettingsLayout from '../../../../components/settings/SettingsLayout';
import Button from '../../../../components/ui/Button';
import Alert from '../../../../components/ui/Alert';
import Modal from '../../../../components/ui/Modal';

/**
 * Settings → Communications → Shared Accounts (list view)
 *
 * A "shared account" is an email_accounts row with scope='tenant' — a
 * company mailbox (shared Gmail, Outlook inbox, or SendGrid sender
 * identity) that any tenant user with a permission grant can send from.
 *
 * Phase 1 limitation: this page stores metadata only. The real OAuth
 * flow for connecting the mailbox lands in Milestone 4. For now a newly
 * created account shows an "Awaiting OAuth" badge and the picker in the
 * Configuration editor will only allow selecting it — actual dispatching
 * via that account is blocked at the send layer until tokens exist.
 *
 * Rows surface:
 *   - Provider icon (Gmail / Outlook / SendGrid)
 *   - Display name + email
 *   - Permission count ("3 users can send")
 *   - Awaiting OAuth / Connected / Inactive badges
 *   - Actions: Manage permissions, toggle active, delete
 */
export default function SharedAccountsList() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);

  // Permissions modal
  const [permissionsAccount, setPermissionsAccount] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/emails/shared-accounts');
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to load shared accounts');
      }
      const data = await res.json();
      setAccounts(data.shared_accounts || []);
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
    if (!q) return accounts;
    return accounts.filter((a) => {
      const hay = `${a.display_name || ''} ${a.email_address || ''} ${a.provider || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [accounts, search]);

  async function toggleActive(account) {
    setBusyId(account.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/shared-accounts/${account.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !account.is_active }),
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

  async function deleteAccount(account) {
    if (
      !confirm(
        `Delete "${account.display_name || account.email_address}"? Any configurations pointing at this mailbox will be unlinked. This cannot be undone.`
      )
    ) {
      return;
    }
    setBusyId(account.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/tenant/emails/shared-accounts/${account.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Failed to delete');
      }
      setAccounts((as) => as.filter((a) => a.id !== account.id));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function handleCreated(newAccount) {
    setAccounts((as) => [newAccount, ...as]);
    setCreateOpen(false);
  }

  function handlePermissionsSaved(account, newCount) {
    setAccounts((as) =>
      as.map((a) =>
        a.id === account.id ? { ...a, permission_count: newCount } : a
      )
    );
    setPermissionsAccount(null);
  }

  return (
    <SettingsLayout title="Shared Accounts">
      <div className="max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-center">
            <Inbox className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Shared Accounts
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Company mailboxes (shared Gmail, Outlook, or SendGrid senders) that any tenant user can send from if granted access. Configurations point at a shared account to define the sender identity for umbrellas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Shared Account
          </button>
        </div>

        {/* Phase 1 OAuth notice */}
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 p-3 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
            <strong>Phase 1 limitation:</strong> mailbox connection stores metadata only. The real Gmail/Outlook OAuth flow ships in Milestone 4 — accounts added here will show an <em>Awaiting OAuth</em> badge until they can authorize. You can still build configurations and permissions against them now so everything is wired up when tokens land.
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
              placeholder="Search by name, email, or provider..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
            <span>
              <strong className="text-gray-900 dark:text-slate-100">{accounts.length}</strong> total
            </span>
            <span>
              <strong className="text-gray-900 dark:text-slate-100">
                {accounts.filter((a) => a.is_active).length}
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
            <Inbox className="w-10 h-10 mx-auto text-gray-400 dark:text-slate-600 mb-3" />
            <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              {search ? 'No shared accounts match your search' : 'No shared accounts yet'}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
              {search
                ? 'Try clearing the search.'
                : 'Add a shared mailbox that team members can send from.'}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((a) => (
              <SharedAccountRow
                key={a.id}
                account={a}
                busy={busyId === a.id}
                onManagePermissions={() => setPermissionsAccount(a)}
                onToggle={() => toggleActive(a)}
                onDelete={() => deleteAccount(a)}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateSharedAccountModal
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {permissionsAccount && (
        <PermissionsModal
          account={permissionsAccount}
          onClose={() => setPermissionsAccount(null)}
          onSaved={(count) => handlePermissionsSaved(permissionsAccount, count)}
        />
      )}
    </SettingsLayout>
  );
}

/* ─────────────────────── Account row ─────────────────────── */

function SharedAccountRow({ account, busy, onManagePermissions, onToggle, onDelete }) {
  const ProviderIcon = providerIconFor(account.provider);
  const providerLabel = providerLabelFor(account.provider);
  const isConnected = hasTokens(account);

  return (
    <div
      className={`group rounded-xl border transition-colors ${
        account.is_active
          ? 'border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-blue-300 dark:hover:border-blue-800'
          : 'border-gray-200 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-900/40 opacity-80'
      }`}
    >
      <div className="flex items-start gap-4 p-4">
        <div className="shrink-0 pt-0.5">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              isConnected
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60'
                : 'bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700'
            }`}
          >
            <ProviderIcon
              className={`w-4 h-4 ${
                isConnected
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-500 dark:text-slate-400'
              }`}
            />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100 truncate">
              {account.display_name || account.email_address}
            </span>
            {isConnected ? (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/60 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <CheckCircle2 className="w-2.5 h-2.5" />
                Connected
              </span>
            ) : (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-900/60 px-1.5 py-0.5 rounded inline-flex items-center gap-1">
                <AlertCircle className="w-2.5 h-2.5" />
                Awaiting OAuth
              </span>
            )}
            {!account.is_active && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-1.5 py-0.5 rounded">
                Inactive
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 dark:text-slate-400 mb-1 line-clamp-1">
            {account.email_address}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-slate-300 flex-wrap">
            <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
              <ProviderIcon className="w-3 h-3" />
              {providerLabel}
            </span>
            <span className="inline-flex items-center gap-1 text-gray-500 dark:text-slate-400">
              <UsersIcon className="w-3 h-3" />
              {account.permission_count || 0}{' '}
              {account.permission_count === 1 ? 'user granted' : 'users granted'}
            </span>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <button
            type="button"
            onClick={onManagePermissions}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-950/60 border border-blue-200 dark:border-blue-900/60 transition-colors inline-flex items-center gap-1"
            title="Manage user permissions"
          >
            <Shield className="w-3.5 h-3.5" />
            Permissions
          </button>
          <button
            type="button"
            onClick={onToggle}
            disabled={busy}
            className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${
              account.is_active
                ? 'text-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-slate-800'
            }`}
            title={account.is_active ? 'Deactivate' : 'Activate'}
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

/* ─────────────────────── Create modal ─────────────────────── */

function CreateSharedAccountModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    email_address: '',
    display_name: '',
    provider: 'gmail',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const email = form.email_address.trim();
    if (!email) {
      setError('Email address is required');
      return;
    }
    if (!email.includes('@')) {
      setError('Enter a valid email address');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/tenant/emails/shared-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email_address: email,
          display_name: form.display_name.trim() || null,
          provider: form.provider,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Failed to create shared account');
      }
      onCreated({ ...body.shared_account, permission_count: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Add Shared Account" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert type="error" message={error} />}

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Email Address <span className="text-rose-500">*</span>
          </label>
          <input
            type="email"
            value={form.email_address}
            onChange={(e) => setForm((f) => ({ ...f, email_address: e.target.value }))}
            placeholder="dispatch@yourcarrier.com"
            autoFocus
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            The mailbox address users will send from.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Display Name
          </label>
          <input
            type="text"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
            placeholder="Dispatch Team"
            className="block w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-[11px] text-gray-500 dark:text-slate-400">
            Friendly label shown in the configuration picker. Defaults to the email if left blank.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1.5">
            Provider <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'gmail', label: 'Gmail', Icon: Mail },
              { value: 'outlook', label: 'Outlook', Icon: Mail },
              { value: 'sendgrid', label: 'SendGrid', Icon: Globe },
            ].map(({ value, label, Icon }) => {
              const active = form.provider === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, provider: value }))}
                  className={`flex flex-col items-center gap-1 p-3 rounded-lg border-2 transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-500'
                      : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-950 hover:border-gray-300 dark:hover:border-slate-600'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 ${
                      active
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-gray-500 dark:text-slate-400'
                    }`}
                  />
                  <span
                    className={`text-xs font-medium ${
                      active
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-gray-700 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-3 flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed">
            Phase 1 creates the mailbox record only. You&apos;ll need to complete the Gmail/Outlook OAuth flow (shipping in Milestone 4) before the account can actually send mail. Permissions and configuration wiring can be set up right now.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Add Account
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ─────────────────────── Permissions modal ─────────────────────── */

function PermissionsModal({ account, onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  // Map of user_id -> { can_send, can_view_inbox }
  const [grants, setGrants] = useState({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [usersRes, permsRes] = await Promise.all([
          fetch('/api/tenant/users'),
          fetch(`/api/tenant/emails/shared-accounts/${account.id}/permissions`),
        ]);
        if (!usersRes.ok) {
          const b = await usersRes.json().catch(() => ({}));
          throw new Error(b.error || 'Failed to load users');
        }
        if (!permsRes.ok) {
          const b = await permsRes.json().catch(() => ({}));
          throw new Error(b.error || 'Failed to load permissions');
        }
        const usersBody = await usersRes.json();
        const permsBody = await permsRes.json();
        if (cancelled) return;

        const activeUsers = (usersBody.users || []).filter(
          (u) => u.status !== 'inactive' && u.status !== 'deleted'
        );
        setUsers(activeUsers);

        const map = {};
        for (const g of permsBody.permissions || []) {
          map[g.user_id] = {
            can_send: g.can_send !== false,
            can_view_inbox: g.can_view_inbox !== false,
          };
        }
        setGrants(map);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [account.id]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const hay = `${u.name || ''} ${u.first_name || ''} ${u.last_name || ''} ${u.email || ''} ${u.role || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, search]);

  function hasGrant(userId) {
    return !!grants[userId];
  }

  function toggleGrant(userId) {
    setGrants((g) => {
      const next = { ...g };
      if (next[userId]) {
        delete next[userId];
      } else {
        next[userId] = { can_send: true, can_view_inbox: true };
      }
      return next;
    });
  }

  function setPermFlag(userId, flag, value) {
    setGrants((g) => {
      const existing = g[userId] || { can_send: true, can_view_inbox: true };
      return {
        ...g,
        [userId]: { ...existing, [flag]: value },
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const grantList = Object.entries(grants).map(([user_id, flags]) => ({
        user_id,
        can_send: flags.can_send !== false,
        can_view_inbox: flags.can_view_inbox !== false,
      }));
      const res = await fetch(
        `/api/tenant/emails/shared-accounts/${account.id}/permissions`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grants: grantList }),
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || 'Failed to save permissions');
      }
      onSaved(grantList.length);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const grantCount = Object.keys(grants).length;

  return (
    <Modal isOpen={true} onClose={onClose} title={`Permissions — ${account.display_name || account.email_address}`} size="lg">
      <div className="space-y-4">
        <div className="text-xs text-gray-500 dark:text-slate-400">
          Check a user to grant them access to this shared mailbox. By default, granted users can both send and view the inbox — use the column checkboxes to fine-tune.
        </div>

        {error && <Alert type="error" message={error} />}

        {/* Search + stats */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="block w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="text-xs text-gray-500 dark:text-slate-400">
            <strong className="text-gray-900 dark:text-slate-100">{grantCount}</strong> of{' '}
            {users.length} granted
          </div>
        </div>

        {/* User list */}
        {loading ? (
          <div className="py-12 text-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-400 rounded-lg border border-dashed border-gray-300 dark:border-slate-700">
            {search ? 'No users match your search' : 'No users in this tenant yet'}
          </div>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-gray-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-900/60 sticky top-0 z-10">
                <tr className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400">
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-center px-2 py-2 w-20">
                    <span className="inline-flex items-center gap-1">
                      <Send className="w-3 h-3" />
                      Send
                    </span>
                  </th>
                  <th className="text-center px-2 py-2 w-20">
                    <span className="inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      View
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {filteredUsers.map((u) => {
                  const granted = hasGrant(u.id);
                  const g = grants[u.id] || { can_send: true, can_view_inbox: true };
                  const displayName =
                    u.name ||
                    `${u.first_name || ''} ${u.last_name || ''}`.trim() ||
                    u.email;
                  return (
                    <tr
                      key={u.id}
                      className={`transition-colors ${
                        granted
                          ? 'bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                          : 'bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <td className="px-3 py-2">
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={granted}
                            onChange={() => toggleGrant(u.id)}
                            className="mt-0.5 w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                              {displayName}
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-slate-400 truncate">
                              {u.email}
                              {u.role && (
                                <span className="ml-2 text-gray-400 dark:text-slate-500">
                                  · {u.role}
                                </span>
                              )}
                            </div>
                          </div>
                        </label>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={granted && g.can_send !== false}
                          disabled={!granted}
                          onChange={(e) => setPermFlag(u.id, 'can_send', e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950 disabled:opacity-30"
                          title="Can send as this mailbox"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={granted && g.can_view_inbox !== false}
                          disabled={!granted}
                          onChange={(e) =>
                            setPermFlag(u.id, 'can_view_inbox', e.target.checked)
                          }
                          className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-white dark:bg-slate-950 disabled:opacity-30"
                          title="Can view this mailbox's inbox"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-200 dark:border-slate-800">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={loading}>
            Save Permissions
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ─────────────────────── helpers ─────────────────────── */

function providerIconFor(provider) {
  if (provider === 'sendgrid') return Globe;
  if (provider === 'outlook') return Mail;
  return Mail; // gmail default
}

function providerLabelFor(provider) {
  if (provider === 'gmail') return 'Gmail';
  if (provider === 'outlook') return 'Outlook';
  if (provider === 'sendgrid') return 'SendGrid';
  return provider || 'Unknown';
}

function hasTokens(account) {
  // Phase 1 heuristic: if we haven't stored a token_expires_at, the mailbox
  // hasn't been OAuth'd yet. The encrypted token columns are stripped from
  // the API response so we can't check those directly.
  return !!account.token_expires_at;
}
