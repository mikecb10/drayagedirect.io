import { CHARGE_NAMES } from '../../../lib/charge-profile-constants';
import TagInput from './TagInput';

/**
 * ChargeProfileHeader — Section 1 of the charge profile detail page.
 *
 * Renders the header card with name, charge name, description, tag input,
 * and auto-add radio.
 *
 * Pure presentational. Owns no state.
 *
 * Originally defined inline in pages/settings/charge-profiles/[id].js
 * (Section 1 block). Extracted to its own file in Plan G2 Task 3.1
 * with no behavior change.
 */
export default function ChargeProfileHeader({ form, update, availableTags }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
      {/* Row 1: Name | Charge Name | Description */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Charge Profile Name</label>
          <input type="text" value={form.name} onChange={(e) => update('name', e.target.value)}
            placeholder="My Base Price"
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Charge Name</label>
          <select value={form.charge_name} onChange={(e) => update('charge_name', e.target.value)}
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40">
            <option value="">Select...</option>
            {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Charge Description</label>
          <input type="text" value={form.description} onChange={(e) => update('description', e.target.value)}
            placeholder="Enter description"
            className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-950 text-gray-900 dark:text-slate-100 placeholder-gray-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40" />
        </div>
      </div>

      {/* Row 2: Tag | Auto Add */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <TagInput tags={form.tags} onChange={(tags) => update('tags', tags)} availableTags={availableTags} />
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Auto Add to Load</label>
          <div className="flex items-center gap-4 h-[36px]">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" checked={!form.auto_add} onChange={() => update('auto_add', false)} className="text-blue-600 w-4 h-4" />
              No
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" checked={form.auto_add} onChange={() => update('auto_add', true)} className="text-blue-600 w-4 h-4" />
              Yes
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
