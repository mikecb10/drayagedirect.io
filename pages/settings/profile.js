import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, KeyRound } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import SettingsTabs from '../../components/settings/SettingsTabs';
import { PageHeader } from '../../components/ui/ModuleHeader';
import { SectionCard } from '../../components/ui/FormSection';
import FieldGroup from '../../components/ui/FieldGroup';
import Field from '../../components/ui/Field';
import DetailPane from '../../components/ui/DetailPane';
import DetailRow from '../../components/ui/DetailRow';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Alert from '../../components/ui/Alert';
import Badge from '../../components/ui/Badge';
import { useAuth } from '../../contexts/AuthContext';

function Profile() {
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
    <div className="max-w-2xl">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-helper text-muted hover:text-strong mb-[var(--space-field)]"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.75} />
          Back to Settings
        </Link>

        <PageHeader
          variant="plain"
          title="My Profile"
          description="Update your personal information."
          className="mb-[var(--space-section)]"
        />

        <SettingsTabs />

        {error && <Alert type="error" message={error} className="mb-[var(--space-field)]" />}
        {success && <Alert type="success" message={success} className="mb-[var(--space-field)]" />}

        {loading || !user ? (
          <div className="py-20 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-[var(--space-section)]">
            {/* Read-only identity block — exercises DetailPane + DetailRow. */}
            <SectionCard title="Identity" description="Managed by your administrator" columns={0}>
              <div className="flex items-center gap-[var(--space-field)] mb-[var(--space-field)] pb-[var(--space-field)] border-b border-gray-100 dark:border-slate-800">
                <div className="w-16 h-16 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl font-bold">
                  {(user.name || user.email)
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div>
                  <div className="text-body text-strong font-semibold">{user.name}</div>
                  <div className="text-helper text-muted">{user.email}</div>
                </div>
              </div>

              <DetailPane>
                <DetailRow label="Role" value={<Badge variant="blue">{user.role.replace('_', ' ')}</Badge>} />
                <DetailRow label="Email" value={user.email} copyable />
                <DetailRow label="Hire Date" value={user.hire_date || '—'} muted={!user.hire_date} />
              </DetailPane>
            </SectionCard>

            {/* Editable fields — exercises FieldGroup + Field. */}
            <SectionCard title="Personal Info" description="Editable by you" columns={0}>
              <FieldGroup columns={2}>
                <Field label="Full Name">
                  <Input
                    value={user.name || ''}
                    onChange={(e) => updateField('name', e.target.value)}
                  />
                </Field>
                <Field label="Phone">
                  <Input
                    value={user.phone || ''}
                    onChange={(e) => updateField('phone', e.target.value)}
                  />
                </Field>
              </FieldGroup>
            </SectionCard>

            {/* Security section — exercises SectionCard actions slot. */}
            <SectionCard
              title="Security"
              description="Manage your password and account security."
              columns={0}
              actions={
                <Link href="/change-password">
                  <Button variant="secondary" type="button">
                    <KeyRound className="w-4 h-4 mr-1.5 inline -mt-0.5" strokeWidth={2} />
                    Change Password
                  </Button>
                </Link>
              }
            >
              <p className="text-helper text-muted">
                Your password was last changed on file. Click the button above to update.
              </p>
            </SectionCard>

            <div className="flex justify-end gap-[var(--space-inline)]">
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
  );
}

Profile.getLayout = (page) => (
  <SettingsLayout title="My Profile">{page}</SettingsLayout>
);

export default Profile;
