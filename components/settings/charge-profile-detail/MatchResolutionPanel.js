import { MATCH_RESOLUTION_OPTIONS } from '../../../lib/charge-profile-constants';

/**
 * MatchResolutionPanel — Section 4 of the charge profile detail page.
 *
 * Two parts:
 *   1. Disabled "Link to existing charge profile" placeholder ("Linking
 *      coming soon"). Not wired to anything yet — left as-is per Plan G2
 *      out-of-scope rule.
 *   2. Match resolution: a 4-button selector for what happens when
 *      multiple charge sets match a load.
 *
 * Pure presentational. Owns no state.
 */
export default function MatchResolutionPanel({ value, onChange }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-5">
      <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">Link to existing charge profile</div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center shrink-0">1</span>
        <span className="text-sm text-gray-500 dark:text-slate-400 shrink-0">Select Charge Profile</span>
        <select disabled className="rounded-lg border border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 px-3 py-1.5 text-sm opacity-50 cursor-not-allowed">
          <option>Select Value</option>
        </select>
        <span className="text-[11px] text-gray-400 dark:text-slate-500 italic ml-auto shrink-0">Linking coming soon</span>
      </div>

      <div className="border-t border-gray-200 dark:border-slate-700 pt-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center">2</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">When multiple conditions match, then:</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {MATCH_RESOLUTION_OPTIONS.map((opt) => (
            <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
              className={`rounded-xl border p-3 text-left transition-all ${
                value === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-2 ring-blue-200 dark:ring-blue-800'
                  : 'border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600'
              }`}>
              <div className="text-sm font-semibold text-gray-900 dark:text-slate-100">{opt.label}</div>
              <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5">{opt.description}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
