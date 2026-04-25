import { useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import SettingsLayout from '../../components/settings/SettingsLayout';
import SettingsTabs from '../../components/settings/SettingsTabs';
import { PageHeader } from '../../components/ui/ModuleHeader';

export default function DriverSettingsPage() {
  return (
    <div className="space-y-[var(--space-section)]">
      <PageHeader
        variant="plain"
        title={<><Truck className="w-6 h-6 text-blue-600 inline -mt-0.5 mr-2" />Drivers</>}
        description="Tenant-wide driver settings."
        className="mb-[var(--space-section)]"
      />

      <SettingsTabs />

      <div className="mt-6">
        <MoveTrackingCard />
      </div>
    </div>
  );
}

function MoveTrackingCard() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/feature-flags/move-tracking');
      if (res.ok) {
        const data = await res.json();
        setEnabled(!!data.enabled);
      } else {
        setError(`HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggle() {
    const next = !enabled;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/tenant/feature-flags/move-tracking', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        setEnabled(next);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || data.error || `HTTP ${res.status}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-body font-semibold text-strong">Move Tracking</h3>
        <button
          onClick={toggle}
          disabled={loading || submitting}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
            enabled
              ? 'bg-blue-600 hover:bg-blue-700 text-white'
              : 'border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800'
          } disabled:opacity-50`}
        >
          {loading ? '…' : submitting ? 'Saving…' : enabled ? 'On' : 'Off'}
        </button>
      </div>
      <p className="mt-2 text-helper text-muted">
        Drivers can report arrivals and departures from their mobile app, and dispatchers see live
        ETAs + breadcrumb history. Once enabled, all drivers default to tracked. Disable individual
        drivers in their profile.
      </p>
      {error && <p className="mt-2 text-helper text-red-600 dark:text-red-400">Error: {error}</p>}
    </div>
  );
}

DriverSettingsPage.getLayout = (page) => (
  <SettingsLayout title="Drivers">{page}</SettingsLayout>
);
