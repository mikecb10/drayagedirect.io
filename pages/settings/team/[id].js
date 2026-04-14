import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { ArrowLeft, KeyRound, Trash2, Copy, CheckCheck } from 'lucide-react';
import SettingsLayout from '../../../components/settings/SettingsLayout';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import Select from '../../../components/ui/Select';
import Alert from '../../../components/ui/Alert';
import Badge from '../../../components/ui/Badge';
import Modal from '../../../components/ui/Modal';
import { PERMISSIONS, PERMISSION_META } from '../../../lib/permissions';
import { useAuth } from '../../../contexts/AuthContext';

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Disabled' },
];

const PERMISSION_OPTIONS = [
  'order_entry',
  'dispatching',
  'accounts_payable',
  'accounts_receivable',
  'reporting',
  'settings',
  'all',
];

export default function UserDetail() {
  const router = useRouter();
  const { id } = router.query;
  const { profile: currentUser } = useAuth();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [newTempPassword, setNewTempPassword] = useState(null);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isSelf = currentUser?.id === id;

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/users/${id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load user');
      }
      const data = await res.json();
      setUser(data.user);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  function updateField(field, value) {
    setUser((u) => ({ ...u, [field]: value }));
  }

  function togglePermission(perm) {
    setUser((u) => {
      const has = u.permissions.includes(perm);
      if (perm === 'all') {
        return { ...u, permissions: has ? [] : ['all'] };
      }
      return {
        ...u,
        permissions: has
          ? u.permissions.filter((p) => p !== perm)
          : [...u.permissions.filter((p) => p !== 'all'), perm],
      };
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Save profile fields
      const profileRes = await fetch(`/api/tenant/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          phone: user.phone,
          age: user.age,
          hire_date: user.hire_date,
          role: user.role,
          status: user.status,
        }),
      });
      if (!profileRes.ok) {
        const body = await profileRes.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update profile');
      }

      // Save permissions
      const permRes = await fetch(`/api/tenant/users/${id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: user.permissions }),
      });
      if (!permRes.ok) {
        const body = await permRes.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to update permissions');
      }

      setSuccess('Changes saved successfully.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword() {
    setError(null);
    try {
      const res = await fetch(`/api/tenant/users/${id}/reset-password`, {
        method: 'POST',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to reset password');
      }
      const data = await res.json();
      setNewTempPassword(data.tempPassword);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete() {
    try {
      const res = await fetch(`/api/tenant/users/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to delete user');
      }
      router.push('/settings/team');
    } catch (e) {
      setError(e.message);
      setConfirmDelete(false);
    }
  }

  function handleCopy(text) {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <SettingsLayout title="User Details">
      <div className="max-w-4xl">
        <Link
          href="/settings/team"
          className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 mb-4"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Back to Team
        </Link>

        {loading ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : !user ? (
          <Alert type="error" message={error || 'User not found'} />
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">{user.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-gray-500 dark:text-slate-400">{user.email}</span>
                  <Badge variant={user.status === 'active' ? 'green' : 'red'}>
                    {user.status}
                  </Badge>
                  {isSelf && <Badge variant="blue">You</Badge>}
                </div>
              </div>
              <Button variant="secondary" onClick={handleResetPassword}>
                <KeyRound className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                Reset Password
              </Button>
            </div>

            {error && <Alert type="error" message={error} className="mb-4" />}
            {success && <Alert type="success" message={success} className="mb-4" />}

            <div className="space-y-6">
              {/* Profile */}
              <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-4">Profile</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Input
                    label="Full Name"
                    value={user.name || ''}
                    onChange={(e) => updateField('name', e.target.value)}
                  />
                  <Input label="Email" value={user.email} disabled />
                  <Input
                    label="Phone"
                    value={user.phone || ''}
                    onChange={(e) => updateField('phone', e.target.value)}
                  />
                  <Input
                    label="Age"
                    type="number"
                    value={user.age ?? ''}
                    onChange={(e) => updateField('age', e.target.value ? Number(e.target.value) : null)}
                  />
                  <Input
                    label="Hire Date"
                    type="date"
                    value={user.hire_date || ''}
                    onChange={(e) => updateField('hire_date', e.target.value || null)}
                  />
                </div>
              </section>

              {/* Role & status */}
              <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-4">
                  Role & Status
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label="Role"
                    value={user.role}
                    onChange={(e) => updateField('role', e.target.value)}
                    options={ROLE_OPTIONS}
                  />
                  <Select
                    label="Status"
                    value={user.status}
                    onChange={(e) => updateField('status', e.target.value)}
                    options={STATUS_OPTIONS}
                  />
                </div>
                {isSelf && (
                  <p className="text-xs text-amber-600 mt-3">
                    ⚠ You can't disable your own account or demote yourself from super admin.
                  </p>
                )}
              </section>

              {/* Permissions */}
              <section className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-1">Permissions</h2>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">
                  Super Admins bypass all permission checks. For regular users, toggle the
                  specific areas they should access.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PERMISSION_OPTIONS.map((p) => (
                    <label
                      key={p}
                      className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/60 border border-transparent hover:border-gray-200 dark:hover:border-slate-700"
                    >
                      <input
                        type="checkbox"
                        checked={user.permissions.includes(p)}
                        onChange={() => togglePermission(p)}
                        className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-slate-700"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-900 dark:text-slate-100">
                          {PERMISSION_META[p].label}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-400">
                          {PERMISSION_META[p].description}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </section>

              {/* Danger zone */}
              {!isSelf && (
                <section className="bg-white border border-red-200 rounded-xl p-6 shadow-sm">
                  <h2 className="text-base font-semibold text-red-900 mb-1">
                    Danger Zone
                  </h2>
                  <p className="text-xs text-red-600 mb-4">
                    Removing a user soft-deletes their account. They will no longer be
                    able to log in.
                  </p>
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                    <Trash2 className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                    Remove User
                  </Button>
                </section>
              )}

              {/* Save bar */}
              <div className="flex justify-end gap-3 sticky bottom-4">
                <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl p-3 shadow-lg flex gap-3">
                  <Button variant="secondary" onClick={() => load()}>
                    Reset
                  </Button>
                  <Button onClick={handleSave} loading={saving}>
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Reset password reveal */}
      <Modal
        isOpen={!!newTempPassword}
        onClose={() => setNewTempPassword(null)}
        title="New Temporary Password"
      >
        <div className="space-y-4">
          <Alert
            type="success"
            message="Password has been reset. The user will be prompted to change it at next login."
          />
          <div>
            <p className="text-sm text-gray-600 dark:text-slate-300 mb-2">
              Share this temporary password with <strong>{user?.email}</strong>:
            </p>
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-800 rounded-lg p-3">
              <code className="flex-1 text-sm font-mono text-gray-900 dark:text-slate-100">
                {newTempPassword}
              </code>
              <button
                onClick={() => handleCopy(newTempPassword)}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
              >
                {copied ? (
                  <>
                    <CheckCheck className="w-4 h-4" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" /> Copy
                  </>
                )}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setNewTempPassword(null)}>Done</Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Remove User?"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            Are you sure you want to remove <strong>{user?.name}</strong> from your team?
            They will be immediately signed out and will not be able to log back in.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete}>
              Remove User
            </Button>
          </div>
        </div>
      </Modal>
    </SettingsLayout>
  );
}
