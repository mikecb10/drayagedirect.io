import { Map as MapIcon } from 'lucide-react';

/**
 * MapPlaceholder — gray box stub for the bottom-left route map.
 *
 * Isolated so a follow-up phase can swap this for a real Google Maps embed
 * without touching RoutingTab.
 */
export default function MapPlaceholder() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-900 dark:to-slate-800 p-6 flex flex-col items-center justify-center text-center min-h-[180px]">
      <MapIcon className="w-8 h-8 text-gray-300 dark:text-slate-600 mb-2" />
      <div className="text-xs font-semibold text-gray-500 dark:text-slate-400">Route Map</div>
      <div className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">Coming soon</div>
    </div>
  );
}
