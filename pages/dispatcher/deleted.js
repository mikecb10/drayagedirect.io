import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Trash2, RotateCcw, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import TenantLayout from '../../components/tenant/TenantLayout';
import Button from '../../components/ui/Button';
import Alert from '../../components/ui/Alert';
import { PERMISSIONS } from '../../lib/permissions';

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return d; }
}

export default function DeletedLoadsPage() {
  const router = useRouter();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [restoring, setRestoring] = useState(null);

  async function fetchDeleted() {
    setLoading(true);
    try {
      const res = await fetch('/api/tenant/loads/deleted');
      if (!res.ok) throw new Error('Failed to load deleted loads');
      const data = await res.json();
      setLoads(data.loads || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchDeleted(); }, []);

  async function handleRestore(loadId) {
    setRestoring(loadId);
    try {
      const res = await fetch('/api/tenant/loads/deleted', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ load_id: loadId }),
      });
      if (!res.ok) throw new Error('Failed to restore');
      await fetchDeleted();
    } catch (e) {
      setError(e.message);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <TenantLayout title="Deleted Loads" requiredPermission={[PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL]}>
      <div className="max-w-5xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/dispatcher"
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Dispatcher
            </Link>
            <h1 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-gray-400" />
              Deleted Loads
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Loads that were deleted can be restored here. Restoring a load sets its status back to Pending.
            </p>
          </div>
        </div>

        {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

        <div className="rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5">Load #</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Container #</th>
                <th className="text-left px-4 py-2.5">Pickup</th>
                <th className="text-left px-4 py-2.5">Delivery</th>
                <th className="text-left px-4 py-2.5">Deleted At</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    Loading...
                  </td>
                </tr>
              ) : loads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    No deleted loads — your trash is empty!
                  </td>
                </tr>
              ) : (
                loads.map((load) => (
                  <tr key={load.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs font-semibold text-gray-900">
                      {load.order_number}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-semibold uppercase text-gray-500">
                        {load.load_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700">
                      {load.customer?.name || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">
                      {load.container_number || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {load.pickup_org?.name || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">
                      {load.delivery_org?.name || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">
                      {formatDate(load.deleted_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Button
                        variant="secondary"
                        onClick={() => handleRestore(load.id)}
                        loading={restoring === load.id}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1 inline" />
                        Restore
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </TenantLayout>
  );
}
