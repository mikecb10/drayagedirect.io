import { useEffect, useState, useCallback } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

export default function LockoutsPage() {
  const [lockouts, setLockouts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLockouts = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/lockouts')
      .then((r) => r.json())
      .then((d) => setLockouts(d.data || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchLockouts(); }, [fetchLockouts]);

  async function handleUnlock(id) {
    await fetch(`/api/admin/lockouts/${id}/unlock`, { method: 'POST' });
    fetchLockouts();
  }

  const columns = [
    { key: 'email', label: 'Email' },
    { key: 'user_type', label: 'Type', render: (r) => (
      <Badge variant={r.user_type === 'dd_employee' ? 'blue' : 'gray'}>
        {r.user_type === 'dd_employee' ? 'DD Employee' : 'Tenant User'}
      </Badge>
    )},
    { key: 'tenant_name', label: 'Tenant' },
    { key: 'failed_attempts', label: 'Attempts' },
    { key: 'locked_at', label: 'Locked At', render: (r) => new Date(r.locked_at).toLocaleString() },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <Button variant="secondary" onClick={() => handleUnlock(r.id)}>
          Unlock
        </Button>
      ),
    },
  ];

  return (
    <AdminLayout title="Account Lockouts">
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-gray-500">
          Accounts locked after 5 failed login attempts.
        </p>
        <Button variant="secondary" onClick={fetchLockouts}>
          Refresh
        </Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200">
        <Table columns={columns} data={lockouts} loading={loading} emptyMessage="No locked accounts." />
      </div>
    </AdminLayout>
  );
}
