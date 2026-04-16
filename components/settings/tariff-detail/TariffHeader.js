/**
 * TariffHeader — title bar + Basic/Advanced Route Matching tab toggle.
 *
 * Part of the Plan G1 decomposition of pages/settings/tariffs/[id].js.
 * Pure presentational; receives matchingMode + onMatchingModeChange.
 *
 * NOTE on Advanced Route Matching: the tab toggle persists state to
 * form.matching_mode (which is saved with the tariff), but the page
 * does NOT currently render a different content branch when
 * matching_mode === 'advanced_route'. Picking the Advanced tab is a
 * no-op visually beyond the toggle highlight. When the Advanced Route
 * render branch is built, it should live in its own sub-component
 * (e.g. <TariffAdvancedRoute />) and get conditionally rendered from
 * pages/settings/tariffs/[id].js, NOT here.
 */
export default function TariffHeader({ matchingMode, onMatchingModeChange }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h1 className="text-base font-semibold text-strong">Load Tariff</h1>
      <div className="flex items-center gap-2 text-helper text-muted">
        <button
          type="button"
          onClick={() => onMatchingModeChange('basic')}
          className={`px-3 py-1 rounded ${
            matchingMode === 'basic'
              ? 'bg-gray-200 dark:bg-slate-700 text-strong font-semibold'
              : 'hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          Basic
        </button>
        <button
          type="button"
          onClick={() => onMatchingModeChange('advanced_route')}
          className={`px-3 py-1 rounded ${
            matchingMode === 'advanced_route'
              ? 'bg-gray-200 dark:bg-slate-700 text-strong font-semibold'
              : 'hover:bg-gray-100 dark:hover:bg-slate-800'
          }`}
        >
          Advanced Route Matching
        </button>
      </div>
    </div>
  );
}
