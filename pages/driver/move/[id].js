import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { driverFetch, getToken } from '../../../lib/driver-app/auth.js';
import { startScheduler } from '../../../lib/driver-app/ping-scheduler.js';
import { recordAction, getRemainingMs, fmtRemaining } from '../../../lib/driver-app/undo-timer.js';
import { isConsentValid } from '../../../lib/driver-consent/version.js';
import ConsentScreen from '../_components/ConsentScreen.js';

function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('geolocation unavailable'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );
  });
}

function pingFromPosition(p) {
  return {
    latitude: p.coords.latitude,
    longitude: p.coords.longitude,
    accuracy_meters: p.coords.accuracy ?? null,
    speed_mph: p.coords.speed != null ? (p.coords.speed * 3600) / 1609.344 : null,
    heading: p.coords.heading ?? null,
    battery_pct: null,
    recorded_at: new Date(p.timestamp).toISOString(),
  };
}

export default function DriverMoveDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [me, setMe] = useState(null);
  const [move, setMove] = useState(null);
  const [error, setError] = useState(null);
  const [showConsent, setShowConsent] = useState(false);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [undoMs, setUndoMs] = useState(getRemainingMs());
  const schedulerRef = useRef(null);

  // Load /me + /move
  async function reload() {
    const [meRes, mvRes] = await Promise.all([
      driverFetch('/api/driver/me'),
      driverFetch(`/api/driver/moves/${id}`),
    ]);
    if (mvRes.status === 404) { setError('Move not found'); return; }
    if (mvRes.status === 403) { setError('You are not assigned to this move.'); return; }
    const meJson = await meRes.json();
    const mvJson = await mvRes.json();
    setMe(meJson);
    setMove(mvJson.move);
    if (!isConsentValid(meJson.driver) && meJson.tracking.tenant_feature_enabled && meJson.tracking.driver_toggle_enabled) {
      setShowConsent(true);
    }
  }

  useEffect(() => {
    if (!getToken()) { router.push('/driver/login'); return; }
    if (!id) return;
    reload();
  }, [id, router]);

  // Manage scheduler lifecycle based on tracking_status
  useEffect(() => {
    if (!move) return;
    const status = move.tracking_status;
    const shouldRun = status === 'in_transit' || status === 'on_site' || status === 'paused';
    if (shouldRun && !schedulerRef.current) {
      schedulerRef.current = startScheduler({
        moveId: id,
        getMoveStatus: () => move?.tracking_status,
        onSendError: (e) => console.warn('ping send error:', e),
      });
    }
    if (!shouldRun && schedulerRef.current) {
      schedulerRef.current.stop();
      schedulerRef.current = null;
    }
    return () => {
      if (schedulerRef.current) {
        schedulerRef.current.stop();
        schedulerRef.current = null;
      }
    };
  }, [id, move?.tracking_status]);

  // Undo countdown ticker
  useEffect(() => {
    const t = setInterval(() => setUndoMs(getRemainingMs()), 1000);
    return () => clearInterval(t);
  }, []);

  // wakeLock — best-effort
  useEffect(() => {
    let lock = null;
    (async () => {
      try { lock = await navigator.wakeLock?.request('screen'); } catch {}
    })();
    return () => { try { lock?.release?.(); } catch {} };
  }, []);

  if (error) return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 text-red-600 dark:text-red-400">{error}</div>;
  if (!move || !me) return <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 text-gray-600 dark:text-gray-400">Loading…</div>;

  const events = move.events || [];
  const nextPending = events.find((e) => e.event_status === 'pending');
  const currentArrived = events.find((e) => e.event_status === 'arrived');

  async function fireAction(actionType, extra = {}) {
    if (actionInFlight) return;
    setActionInFlight(true);
    try {
      const pos = await getCurrentPositionAsync();
      const gpsPing = pingFromPosition(pos);
      const url = `/api/driver/moves/${id}/${actionType}`;
      const body = { gpsPing, ...extra };
      const res = await driverFetch(url, { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.error === 'gps_drift_warning') {
        const ok = window.confirm(
          `You appear to be ${(data.gps_distance_m / 1609).toFixed(1)} mi from this location. Confirm anyway?`,
        );
        if (ok) {
          await fireAction(actionType, { ...extra, override_distance_warning: true });
        }
        return;
      }
      if (!res.ok) {
        alert(`Action failed: ${data.error || res.status}`);
        return;
      }
      recordAction();
      setUndoMs(getRemainingMs());
      await reload();
    } catch (err) {
      alert(`Could not get GPS: ${err.message}`);
    } finally {
      setActionInFlight(false);
    }
  }

  async function fireUndo() {
    if (actionInFlight) return;
    setActionInFlight(true);
    try {
      const res = await driverFetch(`/api/driver/moves/${id}/undo`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Undo failed: ${data.error || res.status}`);
        return;
      }
      sessionStorage.removeItem('dd_driver_last_action_at');
      setUndoMs(0);
      await reload();
    } finally {
      setActionInFlight(false);
    }
  }

  function PrimaryButton() {
    if (move.tracking_status === 'idle') {
      return (
        <button
          onClick={() => fireAction('start')}
          disabled={actionInFlight}
          className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-700 text-white text-lg font-semibold disabled:opacity-50"
        >
          Start move
        </button>
      );
    }
    if (move.tracking_status === 'in_transit' && nextPending) {
      return (
        <button
          onClick={() => fireAction('arrive', { targetEventId: nextPending.id })}
          disabled={actionInFlight}
          className="w-full py-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-lg font-semibold disabled:opacity-50"
        >
          I'm here at {nextPending.location_name || 'destination'}
        </button>
      );
    }
    if (move.tracking_status === 'on_site' && currentArrived) {
      return (
        <button
          onClick={() => fireAction('depart', { targetEventId: currentArrived.id })}
          disabled={actionInFlight}
          className="w-full py-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-lg font-semibold disabled:opacity-50"
        >
          Leaving {currentArrived.location_name || 'location'}
        </button>
      );
    }
    if (move.tracking_status === 'paused') {
      return (
        <button
          disabled
          className="w-full py-4 rounded-lg bg-gray-300 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-lg font-semibold"
        >
          Resume tracking (auto on next ping)
        </button>
      );
    }
    if (move.tracking_status === 'completed') {
      return (
        <div className="text-center text-gray-700 dark:text-gray-300 py-4">
          ✓ Move complete — well done.
        </div>
      );
    }
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 pb-32">
      {showConsent && <ConsentScreen onAccept={() => { setShowConsent(false); reload(); }} onDecline={() => router.push('/driver')} />}

      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
        <button onClick={() => router.push('/driver')} className="text-sm text-blue-600 dark:text-blue-400">← Back</button>
        <h1 className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {move.order?.order_number || `Move ${move.id.slice(0, 8)}`}
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {[move.order?.container_number, move.order?.container_size].filter(Boolean).join(' · ') || '—'}
        </p>
      </header>

      <ol className="p-4 space-y-3">
        {events.map((e, idx) => {
          const status = e.event_status;
          const tone =
            status === 'departed' ? 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-900' :
            status === 'arrived' ? 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-900' :
            status === 'skipped' ? 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-60' :
            'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700';
          return (
            <li key={e.id} className={`rounded-lg border p-3 ${tone}`}>
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{idx + 1}. {e.event_type}</div>
              <div className="text-xs text-gray-700 dark:text-gray-300">{e.location_name || 'No location'}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                {e.scheduled_at && <>Apt {new Date(e.scheduled_at).toLocaleString()}</>}
                {e.arrived_at && <> · Arrived {new Date(e.arrived_at).toLocaleTimeString()}</>}
                {e.departed_at && <> · Departed {new Date(e.departed_at).toLocaleTimeString()}</>}
                {!e.arrived_at && !e.departed_at && e.eta_arrival_at && (
                  <> · ETA {new Date(e.eta_arrival_at).toLocaleTimeString()}</>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 p-4 space-y-2">
        <PrimaryButton />
        {undoMs > 0 && (
          <button
            onClick={fireUndo}
            disabled={actionInFlight}
            className="w-full text-sm text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50"
          >
            Undo last action ({fmtRemaining(undoMs)} remaining)
          </button>
        )}
      </div>
    </div>
  );
}
