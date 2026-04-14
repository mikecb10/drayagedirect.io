import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import Badge from '../../components/ui/Badge';
import Table from '../../components/ui/Table';

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/dashboard/stats')
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = stats
    ? [
        { label: 'Total Tenants', value: stats.totalTenants, color: 'text-gray-900' },
        { label: 'Active', value: stats.activeTenants, color: 'text-green-600' },
        { label: 'Suspended', value: stats.suspendedTenants, color: 'text-yellow-600' },
        { label: 'Locked Accounts', value: stats.lockedAccounts, color: 'text-red-600' },
      ]
    : [];

  const auditColumns = [
    { key: 'created_at', label: 'Time', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'admin_name', label: 'Admin' },
    { key: 'action', label: 'Action', render: (r) => (
      <Badge variant="blue">{r.action.replace(/_/g, ' ')}</Badge>
    )},
  ];

  return (
    <AdminLayout title="Dashboard">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-24 mb-2" />
                <div className="h-8 bg-gray-200 rounded w-16" />
              </div>
            ))
          : statCards.map((card) => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-200 p-6">
                <p className="text-sm text-gray-500">{card.label}</p>
                <p className={`text-3xl font-bold mt-1 ${card.color}`}>{card.value}</p>
              </div>
            ))}
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">Recent Activity</h2>
        </div>
        <Table
          columns={auditColumns}
          data={stats?.recentActivity || []}
          loading={loading}
          emptyMessage="No recent activity"
        />
      </div>
    </AdminLayout>
  );
}
