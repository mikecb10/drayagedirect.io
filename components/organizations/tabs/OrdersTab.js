import { useEffect, useState } from 'react';
import DataTable from '../../ui/DataTable';
import Alert from '../../ui/Alert';
import LoadStatusBadge from '../../ui/LoadStatusBadge';
import { useOverlay } from '../../../contexts/OverlayContext';

function formatDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

export default function OrdersTab({ organization }) {
  const { openOverlay } = useOverlay();
  const [loads, setLoads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!organization?.id) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tenant/loads?customer_id=${organization.id}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Failed to load orders');
        }
        const data = await res.json();
        if (!cancelled) setLoads(data.loads || []);
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
  }, [organization?.id]);

  const columns = [
    {
      key: 'order_number',
      label: 'Load #',
      render: (r) => (
        <span className="font-mono text-xs font-medium text-blue-600">{r.order_number}</span>
      ),
    },
    {
      key: 'pickup',
      label: 'Pickup',
      render: (r) =>
        r.pickup_org ? (
          <div>
            <div className="text-sm">{r.pickup_org.name}</div>
            <div className="text-xs text-gray-500">
              {[r.pickup_org.city, r.pickup_org.state].filter(Boolean).join(', ')}
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    {
      key: 'delivery',
      label: 'Delivery',
      render: (r) =>
        r.delivery_org ? (
          <div>
            <div className="text-sm">{r.delivery_org.name}</div>
            <div className="text-xs text-gray-500">
              {[r.delivery_org.city, r.delivery_org.state].filter(Boolean).join(', ')}
            </div>
          </div>
        ) : (
          '—'
        ),
    },
    { key: 'container_number', label: 'Container #', render: (r) => r.container_number || '—' },
    { key: 'status', label: 'Status', render: (r) => <LoadStatusBadge status={r.status} /> },
    { key: 'pickup_date', label: 'Pickup', render: (r) => formatDate(r.pickup_date) },
    { key: 'delivery_date', label: 'Delivery', render: (r) => formatDate(r.delivery_date) },
  ];

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} />}
      <DataTable
        columns={columns}
        data={loads}
        loading={loading}
        emptyMessage={`No loads yet for ${organization?.name || 'this organization'}.`}
        onRowClick={(row) => openOverlay('load', { loadId: row.id, tab: 'info' })}
      />
    </div>
  );
}
