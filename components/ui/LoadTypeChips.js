/**
 * LoadTypeChips — multi-select chip group for load type values.
 *
 * Pure presentational. No internal state. Caller passes the options array
 * (e.g. [{value:'IMPORT', label:'Import'}, ...]) and the current selected
 * values; we render one chip per option and emit the next array on toggle.
 *
 *   <LoadTypeChips
 *     value={form.load_types}                 // string[]
 *     onChange={(next) => update('load_types', next)}
 *     options={LOAD_TYPES}                     // [{value, label}]
 *   />
 *
 * Originally inlined in pages/settings/tariffs/[id].js. Promoted to
 * components/ui/ in Plan G1 because the AP driver-tariffs page (Plan G3)
 * will need the same selector.
 */
export default function LoadTypeChips({ value = [], onChange, options = [] }) {
  function toggle(optValue) {
    const next = value.includes(optValue)
      ? value.filter((v) => v !== optValue)
      : [...value, optValue];
    onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const selected = value.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              selected
                ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:border-gray-400 dark:hover:border-slate-500'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
