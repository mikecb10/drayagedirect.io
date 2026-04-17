import { useEffect, useRef, useState, useCallback } from 'react';

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_COUNT = 2; // require N consecutive same-state responses before flipping

/**
 * Polls /api/health every POLL_INTERVAL_MS. Pauses when tab hidden.
 * Debounces state transitions (requires 2 consecutive same-state responses).
 *
 * @returns {{
 *   status: 'ok' | 'degraded' | 'disconnected',
 *   lastOkAt: string | null,
 *   retryNow: () => void,
 * }}
 */
export default function useResilienceHealth() {
  const [status, setStatus] = useState('ok');
  const [lastOkAt, setLastOkAt] = useState(null);
  const pendingStatusRef = useRef({ value: 'ok', count: 0 });
  const intervalRef = useRef(null);
  const abortRef = useRef(null);

  const poll = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    let next;
    try {
      const res = await fetch('/api/health', { signal: ac.signal, cache: 'no-store' });
      if (!res.ok) {
        next = 'degraded';
        try {
          const body = await res.json();
          if (body?.supabase_last_ok_at) setLastOkAt(body.supabase_last_ok_at);
        } catch { /* ignore */ }
      } else {
        next = 'ok';
        try {
          const body = await res.json();
          if (body?.supabase_last_ok_at) setLastOkAt(body.supabase_last_ok_at);
        } catch { /* ignore */ }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      next = 'disconnected';
    }

    // Debounce: require DEBOUNCE_COUNT consecutive same-state responses
    if (pendingStatusRef.current.value === next) {
      pendingStatusRef.current.count += 1;
    } else {
      pendingStatusRef.current = { value: next, count: 1 };
    }

    if (pendingStatusRef.current.count >= DEBOUNCE_COUNT) {
      setStatus(next);
    } else if (next === 'ok') {
      // Clearing back to OK is less risky — don't debounce the recovery
      setStatus('ok');
    }
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const start = () => {
      poll(); // immediate
      intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    };
    const stop = () => {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      abortRef.current?.abort();
    };

    if (!document.hidden) start();

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  return { status, lastOkAt, retryNow: poll };
}
