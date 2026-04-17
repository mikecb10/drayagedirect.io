import { useEffect, useState } from 'react';

const STALE_AFTER_MS = 60_000;    // > 60s since last fetch → Stale
const OFFLINE_AFTER_MS = 5 * 60_000; // > 5min since last fetch → Offline

/**
 * LiveIndicator — pill showing data-freshness + Realtime connection state.
 *
 * Three states:
 *  🟢 Live       — Realtime connected AND last fetch < 60s ago
 *  🟡 Stale      — Realtime disconnected OR last fetch > 60s ago
 *  ⚪ Offline    — last fetch > 5min ago (or never)
 *
 * Props:
 *   connectedRef   — ref<boolean> from useRealtimeLoads (subscription status)
 *   lastFetchedAt  — number | null — ms timestamp of last successful HTTP fetch
 */
export default function LiveIndicator({ connectedRef, lastFetchedAt = null }) {
  const [tick, setTick] = useState(0);

  // Tick every 30s for relative-time label updates and to re-poll connectedRef
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Also poll every 500ms for realtime connection flips — connectedRef doesn't trigger re-render
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(interval);
  }, []);

  const connected = !!connectedRef?.current;
  const ageMs = lastFetchedAt ? Date.now() - lastFetchedAt : Infinity;

  let state; // 'live' | 'stale' | 'offline'
  if (connected && ageMs < STALE_AFTER_MS) {
    state = 'live';
  } else if (ageMs < OFFLINE_AFTER_MS) {
    state = 'stale';
  } else {
    state = 'offline';
  }

  const label = state === 'live'
    ? 'Live'
    : state === 'stale'
    ? `Stale · ${formatAge(ageMs)}`
    : `Offline${Number.isFinite(ageMs) ? ` · ${formatAge(ageMs)}` : ''}`;

  const tooltip = state === 'live'
    ? 'Real-time updates enabled. Last refresh: just now.'
    : state === 'stale'
    ? `Not receiving live updates. Last refresh: ${formatAge(ageMs)} ago. Data may be out of date.`
    : `No connection to live data.${Number.isFinite(ageMs) ? ` Showing cached snapshot from ${formatAge(ageMs)} ago.` : ''}`;

  const palette = {
    live: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/60',
    stale: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60',
    offline: 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700',
  }[state];

  const dotColor = {
    live: 'bg-emerald-500',
    stale: 'bg-amber-500',
    offline: 'bg-gray-400 dark:bg-slate-500',
  }[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${palette}`}
      title={tooltip}
    >
      <span className="relative flex w-2 h-2">
        {state === 'live' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`} />
      </span>
      {label}
    </span>
  );
}

function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}
