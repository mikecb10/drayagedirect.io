import { useEffect, useState } from 'react';

/**
 * LiveIndicator — small pill showing the Supabase Realtime connection status.
 *
 * Uses a ref (not state) from useRealtimeLoads since subscribe status doesn't
 * trigger re-renders, so we poll it on an interval just for the UI.
 */
export default function LiveIndicator({ connectedRef }) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setConnected(!!connectedRef?.current);
    }, 500);
    return () => clearInterval(interval);
  }, [connectedRef]);

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full transition-colors ${
        connected
          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/60'
          : 'bg-gray-50 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border border-gray-200 dark:border-slate-700'
      }`}
      title={connected ? 'Live updates enabled' : 'Connecting...'}
    >
      <span className="relative flex w-2 h-2">
        {connected && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
        )}
        <span
          className={`relative inline-flex rounded-full h-2 w-2 ${
            connected ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-slate-500'
          }`}
        />
      </span>
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}
