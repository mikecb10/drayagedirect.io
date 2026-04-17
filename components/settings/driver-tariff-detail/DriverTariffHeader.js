/**
 * DriverTariffHeader — title bar + Basic/Advanced Route Matching tab
 * toggle for the driver tariff detail page (AP side).
 *
 * AP analog of components/settings/tariff-detail/TariffHeader.js
 * (AR side). Pure presentational; receives matchingMode +
 * onMatchingModeChange.
 *
 * NOTE on Advanced Route Matching: the tab toggle persists state to
 * form.matching_mode (which is saved with the tariff), but the page
 * does NOT currently render a different content branch when
 * matching_mode === 'advanced_route'. Picking the Advanced tab is a
 * no-op visually beyond the toggle highlight. When the Advanced Route
 * render branch is built (as a feature, not a refactor — spawned as a
 * separate product task during the G3 brainstorming session), it
 * should live in its own sub-component and get conditionally rendered
 * from pages/settings/driver-tariffs/[id].js, NOT here.
 */
export default function DriverTariffHeader({ matchingMode, onMatchingModeChange }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 className="text-base font-semibold text-gray-900 dark:text-slate-100">Driver Tariff</h1>
      <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-slate-500">
        <button onClick={() => onMatchingModeChange('basic')}
          className={`px-3 py-1 rounded ${matchingMode === 'basic' ? 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
          Basic
        </button>
        <button onClick={() => onMatchingModeChange('advanced_route')}
          className={`px-3 py-1 rounded ${matchingMode === 'advanced_route' ? 'bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-200 font-semibold' : 'hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
          Advanced Route Matching
        </button>
      </div>
    </div>
  );
}
