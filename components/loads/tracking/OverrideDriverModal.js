// components/loads/tracking/OverrideDriverModal.js
import { useState } from 'react';

export default function OverrideDriverModal({
  event,
  driverTimestamp,
  driverGpsDistanceM,
  fieldName,    // 'arrived_at' or 'departed_at'
  loadId,
  onClose,
  onSaved,
}) {
  const [override, setOverride] = useState(driverTimestamp);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const toStatus = fieldName === 'arrived_at' ? 'arrived' : 'departed';

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenant/loads/${loadId}/routing/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dispatcher_override_driver: true,
          to_status: toStatus,
          override_timestamp: override,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`);
        return;
      }
      onSaved?.(data);
      onClose?.();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 border border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Override Driver Timestamp</h2>
        <div className="mt-3 space-y-2 text-sm">
          <div className="text-gray-700 dark:text-gray-300">
            Event: <span className="font-medium">{toStatus} at {event.location_name || 'this location'}</span>
          </div>
          <div className="text-gray-600 dark:text-gray-400">
            Driver tapped: {driverTimestamp ? new Date(driverTimestamp).toLocaleString() : '—'}
            {driverGpsDistanceM != null && (
              <> (GPS within {(driverGpsDistanceM / 1609).toFixed(2)} mi)</>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <label className="block text-sm">
            Override to:
            <input
              type="datetime-local"
              value={override ? override.slice(0, 16) : ''}
              onChange={(e) => setOverride(e.target.value ? new Date(e.target.value).toISOString() : null)}
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </label>
          <label className="block text-sm">
            Reason (optional):
            <textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
              className="mt-1 w-full rounded border border-gray-300 dark:border-gray-600 px-2 py-1 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
            />
          </label>
        </div>
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
            {saving ? 'Saving\u2026' : 'Override and lock'}
          </button>
        </div>
      </div>
    </div>
  );
}
