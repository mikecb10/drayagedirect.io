/**
 * RoutingOptions — Options + Views checkboxes shown under the event palette,
 * matching the PortPro screenshot. Local state for now; wiring into the load
 * data model comes later.
 */
export default function RoutingOptions({
  options,
  onOptionsChange,
  viewFilter,
  onViewChange,
  skipConfirmations,
  onSkipConfirmationsChange,
}) {
  function toggle(key) {
    onOptionsChange({ ...options, [key]: !options[key] });
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">
          Options
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={!!options.add_pre_pull_charge}
            onChange={() => toggle('add_pre_pull_charge')}
            className="w-3.5 h-3.5 rounded text-blue-600 border-gray-300 dark:border-slate-600"
          />
          Add Pre Pull Charge
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={!!options.driver_select_container}
            onChange={() => toggle('driver_select_container')}
            className="w-3.5 h-3.5 rounded text-blue-600 border-gray-300 dark:border-slate-600"
          />
          Driver Select Container
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={!!skipConfirmations}
            onChange={() => onSkipConfirmationsChange?.(!skipConfirmations)}
            className="w-3.5 h-3.5 rounded text-blue-600 border-gray-300 dark:border-slate-600"
          />
          Skip routing confirmations
        </label>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-slate-400 mb-2">
          Views
        </div>
        {[
          { key: 'all', label: 'All Moves' },
          { key: 'container', label: 'Container Moves' },
          { key: 'support', label: 'Support Moves' },
        ].map((v) => (
          <label
            key={v.key}
            className="flex items-center gap-2 text-xs text-gray-700 dark:text-slate-200 cursor-pointer"
          >
            <input
              type="radio"
              name="routing-view-filter"
              checked={viewFilter === v.key}
              onChange={() => onViewChange(v.key)}
              className="w-3.5 h-3.5 text-blue-600 border-gray-300 dark:border-slate-600"
            />
            {v.label}
          </label>
        ))}
      </div>
    </div>
  );
}
