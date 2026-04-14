import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';

export default function FeatureFlagsPage() {
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [changed, setChanged] = useState({});

  // Load tenants on mount
  useEffect(() => {
    fetch('/api/admin/features')
      .then((r) => r.json())
      .then((d) => setTenants(d.tenants || []));
  }, []);

  // Load flags when tenant changes
  useEffect(() => {
    if (!selectedTenant) { setFlags([]); setUsers([]); return; }
    setLoading(true);
    setSelectedUser('');
    setChanged({});
    const params = new URLSearchParams({ tenant_id: selectedTenant });
    fetch(`/api/admin/features?${params}`)
      .then((r) => r.json())
      .then((d) => { setFlags(d.flags || []); setUsers(d.users || []); })
      .finally(() => setLoading(false));
  }, [selectedTenant]);

  // Reload when user changes
  useEffect(() => {
    if (!selectedTenant) return;
    setLoading(true);
    setChanged({});
    const params = new URLSearchParams({ tenant_id: selectedTenant });
    if (selectedUser) params.set('user_id', selectedUser);
    fetch(`/api/admin/features?${params}`)
      .then((r) => r.json())
      .then((d) => setFlags(d.flags || []))
      .finally(() => setLoading(false));
  }, [selectedUser]);

  function toggleFlag(flagId) {
    setFlags((prev) =>
      prev.map((f) => (f.id === flagId ? { ...f, enabled: !f.enabled } : f))
    );
    setChanged((prev) => ({ ...prev, [flagId]: true }));
  }

  async function saveChanges() {
    setSaving(true);
    setMessage('');
    const changedFlags = flags
      .filter((f) => changed[f.id])
      .map((f) => ({ feature_flag_id: f.id, enabled: f.enabled }));

    try {
      const res = await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: selectedTenant,
          user_id: selectedUser || null,
          flags: changedFlags,
        }),
      });
      if (res.ok) {
        setMessage('Feature flags saved successfully.');
        setChanged({});
      }
    } catch (err) {
      setMessage('Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  const sourceBadge = (source) => {
    const map = { tier: 'green', override: 'blue', disabled: 'gray', disabled_override: 'red' };
    const labels = { tier: 'Tier', override: 'Override', disabled: 'Off', disabled_override: 'Disabled' };
    return <Badge variant={map[source]}>{labels[source]}</Badge>;
  };

  return (
    <AdminLayout title="Feature Flags">
      <div className="max-w-3xl space-y-6">
        {/* Tenant selector */}
        <Select
          label="Trucking Company"
          name="tenant"
          value={selectedTenant}
          onChange={(e) => setSelectedTenant(e.target.value)}
          options={tenants.map((t) => ({ value: t.id, label: t.name }))}
          placeholder="Select a trucking company..."
        />

        {/* User selector */}
        {selectedTenant && (
          <Select
            label="Apply to"
            name="user"
            value={selectedUser}
            onChange={(e) => setSelectedUser(e.target.value)}
            options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
            placeholder="ALL USERS"
          />
        )}

        {/* Flags list */}
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : flags.length > 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
            {flags.map((flag) => (
              <div key={flag.id} className="flex items-center justify-between px-6 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900">{flag.name.replace(/_/g, ' ')}</p>
                    {sourceBadge(flag.source)}
                    {changed[flag.id] && <Badge variant="yellow">unsaved</Badge>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{flag.description}</p>
                  {flag.tier_required && (
                    <p className="text-xs text-gray-400 mt-0.5">Requires: {flag.tier_required} tier</p>
                  )}
                </div>
                <button
                  onClick={() => toggleFlag(flag.id)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    flag.enabled ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                      flag.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        ) : selectedTenant ? (
          <p className="text-sm text-gray-500">No feature flags found.</p>
        ) : null}

        {/* Save button */}
        {Object.keys(changed).length > 0 && (
          <div className="flex items-center gap-4">
            <Button onClick={saveChanges} loading={saving}>
              Save Changes ({Object.keys(changed).length})
            </Button>
            {message && <Alert type="success" message={message} />}
          </div>
        )}
        {message && Object.keys(changed).length === 0 && (
          <Alert type="success" message={message} />
        )}
      </div>
    </AdminLayout>
  );
}
