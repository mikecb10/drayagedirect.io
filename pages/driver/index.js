import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { driverFetch, getToken, getDriverId } from '../../lib/driver-app/auth.js';

export default function DriverHome() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!getToken()) {
      router.push('/driver/login');
      return;
    }
    (async () => {
      try {
        const [meRes, movesRes] = await Promise.all([
          driverFetch('/api/driver/me'),
          driverFetch('/api/driver/moves/today'),
        ]);
        if (meRes.status === 401 || movesRes.status === 401) return;  // redirected by interceptor
        const me = await meRes.json();
        const moves = await movesRes.json();
        setData({ me, moves: moves.moves || [] });
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (loading) return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 text-gray-600 dark:text-gray-400">Loading…</div>;
  if (error) return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 text-red-600 dark:text-red-400">Error: {error}</div>;
  if (!data) return null;

  const { me, moves } = data;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Hi, {me.driver.name || 'Driver'}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">Today's moves</p>
        </div>
        <button
          onClick={() => router.push('/driver/settings')}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          Settings
        </button>
      </header>

      {!me.tracking.eligible && (
        <div className="bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-900 p-3 text-sm text-amber-800 dark:text-amber-200">
          {me.tracking.tenant_feature_enabled
            ? me.tracking.driver_toggle_enabled
              ? 'Location tracking requires your consent. Tap a move to review.'
              : 'Your dispatcher has disabled location tracking for your account.'
            : 'Your company has not enabled location tracking.'}
        </div>
      )}

      <main className="p-4 space-y-2">
        {moves.length === 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400 p-4 text-center">No moves assigned for today.</div>
        )}
        {moves.map((m) => (
          <button
            key={m.id}
            onClick={() => router.push(`/driver/move/${m.id}`)}
            className="block w-full text-left bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-600"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium text-gray-900 dark:text-gray-100">
                {m.order?.order_number || `Move ${m.id.slice(0, 8)}`}
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 capitalize">
                {m.tracking_status === 'idle' ? 'Not started' : m.tracking_status.replace('_', ' ')}
              </span>
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {[m.order?.container_number, m.order?.container_size].filter(Boolean).join(' · ') || '—'}
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              {(m.events || []).map((e) => e.location_name || '?').join(' → ')}
            </div>
          </button>
        ))}
      </main>
    </div>
  );
}
