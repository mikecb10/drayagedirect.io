import { Trash2 } from 'lucide-react';
import OrgPicker from '../../ui/OrgPicker';

/**
 * LocationConditionField — labeled "All Locations" toggle + chip list +
 * OrgPicker for adding more specific locations. Used on the driver
 * tariff detail page for pickup / delivery / return conditions.
 *
 * Pure presentational. Owns no state.
 *
 * Originally defined inside pages/settings/driver-tariffs/[id].js.
 * Extracted to its own file in Plan G3 with no behavior change.
 */
export default function LocationConditionField({ label, field, form, isAll, onSetAll, onAddLocation, onRemoveLocation, orgType }) {
  const conditions = form[field] || {};
  const locationIds = conditions.ids || [];
  const labels = conditions.labels || {};

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">{label}</label>
      <label className="flex items-center gap-2 cursor-pointer mb-2">
        <input type="checkbox" checked={isAll} onChange={onSetAll}
          className="rounded border-gray-300 dark:border-slate-600 text-blue-600 w-3.5 h-3.5" />
        <span className="text-xs text-gray-700 dark:text-slate-200">All Locations</span>
      </label>
      {!isAll && locationIds.length > 0 && (
        <div className="space-y-1 mb-2">
          {locationIds.map((lid) => (
            <div key={lid} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 rounded px-2 py-1">
              <span className="text-xs text-gray-700 dark:text-slate-200 truncate">{labels[lid] || lid.slice(0, 8)}</span>
              <button type="button" onClick={() => onRemoveLocation(lid)}
                className="text-gray-400 dark:text-slate-500 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      )}
      {!isAll && (
        <OrgPicker type={orgType} placeholder={`Add ${orgType}...`}
          onChange={(org) => { if (org) onAddLocation(org.id, org.name); }} />
      )}
    </div>
  );
}
