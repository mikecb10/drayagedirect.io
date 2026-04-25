// lib/driver-app/ping-scheduler.js
/**
 * Orchestrator: subscribes to geolocation watcher, decides live vs buffer,
 * stops on completed.
 */

import { startWatcher } from './geolocation-watcher.js';
import { enqueue, flushToServer } from './offline-queue.js';
import { driverFetch } from './auth.js';

export function startScheduler({ moveId, getMoveStatus, onSendError }) {
  let online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  function setOnline(v) {
    online = v;
    if (v) flushToServer({ driverFetch }).catch(() => {});
  }

  function handleOnline() { setOnline(true); }
  function handleOffline() { setOnline(false); }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  const watcher = startWatcher({
    onPing: async (ping) => {
      const status = getMoveStatus?.();
      if (status === 'completed' || status === 'idle') return;  // shouldn't happen but defensive
      if (online) {
        try {
          const res = await driverFetch(`/api/driver/moves/${moveId}/ping`, {
            method: 'POST',
            body: JSON.stringify({ gpsPing: ping }),
          });
          if (!res.ok) {
            await enqueue({ type: 'ping', payload: { moveId, gpsPing: ping } });
            onSendError?.(res.status);
          }
        } catch (err) {
          await enqueue({ type: 'ping', payload: { moveId, gpsPing: ping } });
          onSendError?.(err);
        }
      } else {
        await enqueue({ type: 'ping', payload: { moveId, gpsPing: ping } });
      }
    },
    onError: (err) => onSendError?.(err),
    getOnSite: () => getMoveStatus?.() === 'on_site',
  });

  return {
    stop() {
      watcher.stop();
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
    },
  };
}
