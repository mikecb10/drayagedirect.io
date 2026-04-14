import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';

export default function Profile() {
  const { profile } = useAuth();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  async function load() {
    if (!profile?.id) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/users/${profile.id}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load profile');
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
  }, [profile?.id]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/tenant/users/${profile.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          phone: user.phone,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save profile');
      }
      setSuccess('Profile updated successfully.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function updateField(field, value) {
    setUser((u) => ({ ...u, [field]: value }));
  }

  return (
    <SettingsLayout title="My Profile">
      <div className="max-w-2xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Back to Settings
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">My Profile</h1>
          <p className="text-sm text-gray-500 mt-1">
            Update your personal information.
          </p>
        </div>

        {error && <Alert type="error" message={error} className="mb-4" />}
        {success && <Alert type="success" message={success} className="mb-4" />}

        {loading || !user ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
                <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-bold">
                  {(user.name || user.email)
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div>
                  <div className="text-lg font-semibold text-gray-900">{user.name}</div>
                  <div className="text-sm text-gray-500">{user.email}</div>
                  <div className="mt-1">
                    <Badge variant="blue">{user.role.replace('_', ' ')}</Badge>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Full Name"
                  value={user.name || ''}
                  onChange={(e) => updateField('name', e.target.value)}
                />
                <Input label="Email" value={user.email} disabled helpText="Email can only be changed by an administrator." />
                <Input
                  label="Phone"
                  value={user.phone || ''}
                  onChange={(e) => updateField('phone', e.target.value)}
                />
                <Input
                  label="Hire Date"
                  type="date"
                  value={user.hire_date || ''}
                  disabled
                />
              </div>
            </section>

            <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Security</h2>
              <p className="text-xs text-gray-500 mb-4">
                Manage your password and account security.
              </p>
              <Link href="/change-password">
                <Button variant="secondary" type="button">
                  <KeyRound className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                  Change Password
                </Button>
              </Link>
            </section>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" type="button" onClick={load}>
                Reset
              </Button>
              <Button type="submit" loading={saving}>
                Save Changes
              </Button>
            </div>
          </form>
        )}
      </div>
    </SettingsLayout>
  );
}
