import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { driverFetch, clearSession, getToken } from '../../lib/driver-app/auth.js';

export default function DriverSettings() {
  const router = useRouter();
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!getToken()) { router.push('/driver/login'); return; }
    (async () => {
      const res = await driverFetch('/api/driver/me');
      if (res.ok) setMe(await res.json());
    })();
  }, [router]);

  async function revokeConsent() {
    if (!confirm('Revoke location tracking? Your dispatcher will need manual updates from you.')) return;
    const res = await driverFetch('/api/driver/me/revoke-consent', { method: 'POST' });
    if (res.ok) {
      const refreshed = await driverFetch('/api/driver/me');
      setMe(await refreshed.json());
    }
  }

  function logout() {
    clearSession();
    router.push('/driver/login');
  }

  if (!me) return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 text-gray-600 dark:text-gray-400">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">
        <button onClick={() => router.push('/driver')} className="text-sm text-blue-600 dark:text-blue-400">← Back</button>
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
        <span />
      </header>

      <main className="p-4 space-y-3">
        <section className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Account</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">{me.driver.name} · @{me.driver.username}</p>
          <button onClick={() => router.push('/driver/change-password')} className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline">
            Change password
          </button>
        </section>

        <section className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Location tracking</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {me.consent.valid ? 'Enabled — your location is shared while you work moves.' : 'Not active.'}
          </p>
          {me.consent.valid && (
            <button onClick={revokeConsent} className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline">
              Revoke tracking consent
            </button>
          )}
        </section>

        <button onClick={logout} className="w-full bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 text-red-600 dark:text-red-400">
          Sign out
        </button>
      </main>
    </div>
  );
}
