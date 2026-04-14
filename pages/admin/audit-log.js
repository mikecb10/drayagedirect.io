import { useEffect, useState } from 'react';
import AdminLayout from '../../components/admin/AdminLayout';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';

export default function AuditLogPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/admin/audit-log?page=${page}&limit=25`)
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.data || []);
        setTotalPages(d.totalPages || 1);
      })
      .finally(() => setLoading(false));
  }, [page]);

  const columns = [
    {
      key: 'created_at',
      label: 'Time',
      render: (r) => (
        <span className="text-xs text-gray-500">
          {new Date(r.created_at).toLocaleString()}
        </span>
      ),
    },
    { key: 'admin_name', label: 'Admin' },
    {
      key: 'action',
      label: 'Action',
      render: (r) => <Badge variant="blue">{r.action.replace(/_/g, ' ')}</Badge>,
    },
    { key: 'tenant_name', label: 'Tenant' },
    {
      key: 'details',
      label: 'Details',
      render: (r) =>
        r.details ? (
          <span className="text-xs text-gray-500 font-mono">
            {JSON.stringify(r.details).substring(0, 80)}
            {JSON.stringify(r.details).length > 80 ? '...' : ''}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <AdminLayout title="Audit Log">
      <div className="bg-white rounded-xl border border-gray-200">
        <Table columns={columns} data={entries} loading={loading} emptyMessage="No audit entries yet." />
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50 hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </AdminLayout>
  );
}
