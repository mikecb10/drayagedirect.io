import { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff, RefreshCw } from 'lucide-react';
import useResilienceHealth from './useResilienceHealth';

/**
 * ResilienceBanner — app-wide thin banner at top of viewport.
 *
 * Three states:
 *  - hidden (status 'ok')
 *  - 🟠 degraded — server reachable, Supabase unreachable
 *  - 🔴 disconnected — client can't reach server
 *
 * role="status" + aria-live="polite" so screen readers announce changes.
 * z-index below modals so it never obscures a dialog.
 */
export default function ResilienceBanner() {
  const { status, lastOkAt, retryNow } = useResilienceHealth();
  const [showRestored, setShowRestored] = useState(false);
  const [prevStatus, setPrevStatus] = useState('ok');

  useEffect(() => {
    if (prevStatus !== 'ok' && status === 'ok') {
      setShowRestored(true);
      const t = setTimeout(() => setShowRestored(false), 5000);
      return () => clearTimeout(t);
    }
    setPrevStatus(status);
  }, [status, prevStatus]);

  if (status === 'ok' && !showRestored) return null;

  if (showRestored) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-40 w-full bg-emerald-500 text-white text-xs font-medium flex items-center justify-center gap-2 py-1.5"
      >
        <span>✅ Service restored</span>
      </div>
    );
  }

  if (status === 'degraded') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="sticky top-0 z-40 w-full bg-amber-500 dark:bg-amber-600 text-white text-xs font-medium flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-1.5 px-3"
      >
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          Service degraded — data may be stale. Updates may fail until we recover.
        </span>
        {lastOkAt && (
          <span className="opacity-80">Last healthy: {formatRelative(lastOkAt)}</span>
        )}
        <a
          href="/api/health"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
        >
          Learn more ↗
        </a>
      </div>
    );
  }

  // status === 'disconnected'
  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-40 w-full bg-red-600 text-white text-xs font-medium flex flex-wrap items-center justify-center gap-x-4 gap-y-1 py-1.5 px-3"
    >
      <span className="flex items-center gap-1.5">
        <WifiOff className="w-3.5 h-3.5" />
        Can't reach server — check your internet connection.
      </span>
      <button
        type="button"
        onClick={retryNow}
        className="inline-flex items-center gap-1 underline hover:opacity-80"
      >
        <RefreshCw className="w-3 h-3" /> Retry now
      </button>
    </div>
  );
}

function formatRelative(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
