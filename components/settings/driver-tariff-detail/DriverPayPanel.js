import { Plus, Trash2, DollarSign, Info } from 'lucide-react';
import Button from '../../ui/Button';
import { chargeNameLabel, unitLabel } from '../../../lib/charge-profile-constants';

/**
 * DriverPayPanel — right panel of the driver tariff detail page.
 *
 * Shows either:
 *   - an empty state with a "Add Driver Charge Profile" CTA, or
 *   - a flat list of linked driver charge profile cards (name,
 *     charge_name label, unit_of_measure badge, trash button).
 *
 * Unlike AR tariffs (which group charges by bill_to customer), driver
 * pay is flat: each linked profile produces a pay line on any
 * matching load. No bill-to grouping.
 *
 * Pure presentational. Owns no state.
 */
export default function DriverPayPanel({ linkedProfiles, onOpenPicker, onRemoveProfile }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="px-5 py-3 border-b border-gray-200 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-900/60 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200">
          Driver Pay
          <Info className="w-3.5 h-3.5 text-gray-400 dark:text-slate-500" />
        </div>
        <Button variant="secondary" onClick={onOpenPicker} className="!py-1 !px-3 !text-xs">
          <Plus className="w-3 h-3 mr-1 inline" /> Add Driver Charge Profile
        </Button>
      </div>

      <div className="p-5">
        {linkedProfiles.length === 0 ? (
          <div className="text-center py-16 text-gray-400 dark:text-slate-500">
            <DollarSign className="w-8 h-8 mx-auto mb-3 text-gray-300 dark:text-slate-600" />
            <p className="text-sm">No driver charge profiles linked yet.</p>
            <p className="text-xs mt-1">Each linked profile produces a pay line on any load that matches this tariff. Pay lines accumulate in the driver's settlement period.</p>
            <Button variant="secondary" onClick={onOpenPicker} className="mt-4 !text-xs">
              <Plus className="w-3 h-3 mr-1 inline" /> Add Driver Charge Profile
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {linkedProfiles.map((p, idx) => (
              <div key={idx} className="flex items-center justify-between bg-blue-50/50 dark:bg-blue-950/40 rounded-lg px-3 py-2 border border-blue-100 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5 text-blue-500" />
                  <span className="text-xs font-medium text-gray-900 dark:text-slate-100">{p.name}</span>
                  <span className="text-[10px] text-gray-400 dark:text-slate-500">{chargeNameLabel(p.charge_name)}</span>
                  {p.unit_of_measure && (
                    <span className="text-[9px] bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 px-1.5 py-0.5 rounded">{unitLabel(p.unit_of_measure)}</span>
                  )}
                </div>
                <button type="button" onClick={() => onRemoveProfile(idx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
