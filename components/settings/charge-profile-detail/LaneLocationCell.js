import OrgPicker from '../../ui/OrgPicker';
import { LOCATION_TYPES } from '../../../lib/charge-profile-row-shapes';

/**
 * LaneLocationCell — origin-or-destination cell editor used inside lane-mode
 * charge profile rows. Lets the user pick between an Organization, a
 * City/State string, or a Zip code, and shows the appropriate input.
 *
 * Originally defined inside pages/settings/charge-profiles/[id].js.
 * Extracted to its own file in Plan G2 with no behavior change.
 */
export default function LaneLocationCell({ typeValue, orgId, orgLabel, textValue, onTypeChange, onOrgChange, onTextChange, orgType, placeholder }) {
  return (
    <div className="space-y-1.5">
      <select value={typeValue} onChange={(e) => onTypeChange(e.target.value)}
        className="block w-full rounded border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 px-2 py-1 text-[10px] text-gray-500 dark:text-slate-400 font-medium">
        {LOCATION_TYPES.map((lt) => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
      </select>
      {typeValue === 'org' && (
        <OrgPicker value={orgId} valueLabel={orgLabel} onChange={onOrgChange}
          type={orgType} placeholder={`${placeholder}...`} />
      )}
      {typeValue === 'city_state' && (
        <input type="text" value={textValue || ''} onChange={(e) => onTextChange(e.target.value)}
          placeholder="e.g. Chicago, IL"
          className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
      )}
      {typeValue === 'zip' && (
        <input type="text" value={textValue || ''} onChange={(e) => onTextChange(e.target.value)}
          placeholder="e.g. 60601"
          className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
      )}
    </div>
  );
}
