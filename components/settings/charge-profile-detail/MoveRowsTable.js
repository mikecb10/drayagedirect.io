import { Plus, Trash2 } from 'lucide-react';
import CentsInput from '../../ui/CentsInput';
import OrgPicker from '../../ui/OrgPicker';
import { EVENT_TYPES, EVENT_TIME_OPTIONS } from '../../../lib/charge-profile-constants';

/**
 * MoveRowsTable — "By Move" mode rows for the charge profile editor.
 *
 * Renders its own full <table> (colgroup + thead + tbody including the empty-
 * state row). The four common pricing columns (Minimum Amount, Free Units,
 * Amount, delete) are duplicated across all four mode-specific row tables —
 * intentional, keeps each table self-contained and readable end-to-end.
 *
 * Most complex of the four — has a nested move-event sub-list with its own
 * add/remove/update event handlers.
 */
export default function MoveRowsTable({
  rows,
  isPercentage,
  onUpdateRow,
  onRemoveRow,
  onAddMoveEvent,
  onRemoveMoveEvent,
  onUpdateMoveEvent,
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
        <colgroup>
          <col style={{ width: '44%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '32px' }} />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-900 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
            <th className="text-left px-3 py-2 font-semibold">Events & Locations</th>
            <th className="text-left px-3 py-2 font-semibold">Minimum Amount</th>
            <th className="text-left px-3 py-2 font-semibold">Free Units</th>
            <th className="text-left px-3 py-2 font-semibold">Amount</th>
            <th className="px-1 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500">No charges added yet</td></tr>
          ) : rows.map((row, rIdx) => (
            <tr key={rIdx} className="border-t border-gray-100 dark:border-slate-800 align-top">
              <td className="px-2 py-2">
                <div className="space-y-2">
                  {(row.move_events || []).map((me, eIdx) => (
                    <div key={eIdx} className="flex items-center gap-2">
                      <select value={me.event || ''} onChange={(e) => onUpdateMoveEvent(rIdx, eIdx, 'event', e.target.value)}
                        className="rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs shrink-0 w-[155px]">
                        <option value="">Select event...</option>
                        {EVENT_TYPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      <select value={me.event_time || 'arrived'} onChange={(e) => onUpdateMoveEvent(rIdx, eIdx, 'event_time', e.target.value)}
                        className="rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs shrink-0 w-[100px]">
                        {EVENT_TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <div className="min-w-[100px] flex-1">
                        <OrgPicker value={me.location_id} valueLabel={me.location_label}
                          onChange={(org) => { onUpdateMoveEvent(rIdx, eIdx, 'location_id', org?.id || null); onUpdateMoveEvent(rIdx, eIdx, 'location_label', org?.name || ''); }}
                          placeholder="Location..." />
                      </div>
                      {(row.move_events || []).length > 1 && (
                        <button type="button" onClick={() => onRemoveMoveEvent(rIdx, eIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500 shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => onAddMoveEvent(rIdx)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium flex items-center gap-0.5">
                    <Plus className="w-3 h-3" /> Add Event
                  </button>
                </div>
              </td>
              <td className="px-2 py-2">
                <CentsInput value={row.minimum_amount_cents} onChange={(cents) => onUpdateRow(rIdx, 'minimum_amount_cents', cents)} />
              </td>
              <td className="px-2 py-2">
                <input type="number" step="0.01" value={row.free_units || ''}
                  onChange={(e) => onUpdateRow(rIdx, 'free_units', e.target.value)}
                  placeholder="0"
                  className="block w-full rounded border border-gray-300 dark:border-slate-600 px-2 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
              </td>
              <td className="px-2 py-2">
                <CentsInput value={row.amount_cents} isPercent={isPercentage}
                  onChange={(cents) => onUpdateRow(rIdx, 'amount_cents', cents)} />
              </td>
              <td className="px-1 py-2">
                {rows.length > 1 && (
                  <button type="button" onClick={() => onRemoveRow(rIdx)} className="text-gray-400 dark:text-slate-500 hover:text-red-500 mt-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
