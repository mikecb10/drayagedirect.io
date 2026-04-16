import { Plus, Trash2, Edit2, Copy } from 'lucide-react';
import Button from '../../ui/Button';
import DatePicker from '../../ui/DatePicker';
import {
  CHARGE_NAMES,
  UNITS_OF_MEASURE,
  EFFECTIVE_DATE_OPTIONS,
  MOVE_CALC_FROM,
  MOVE_CALC_TO,
} from '../../../lib/charge-profile-constants';
import LaneRowsTable from './LaneRowsTable';
import StatusRowsTable from './StatusRowsTable';
import EventRowsTable from './EventRowsTable';
import MoveRowsTable from './MoveRowsTable';

/**
 * VersionManager — Section 2 of the charge profile editor (the blue version
 * box). Renders the version selector + add/duplicate/remove buttons + UoM/EFD/
 * version-dates grid + calc mode radios + (conditional) percentage-based-on
 * select + (conditional) by-move calc-from/to controls + Add Charge button.
 *
 * Dispatches to one of 4 row tables based on form.calculation_mode.
 *
 * Sub-component does NOT own state. All edits are forwarded to the parent
 * through the on*** props so the page shell remains the single source of truth
 * for `form` and `versions`.
 */
export default function VersionManager({
  versions,
  activeVersionIdx,
  activeVersion,
  mode,
  form,
  update,
  availableModes,
  isPercentage,
  onSelectVersion,
  onUpdateVersion,
  onAddVersion,
  onRemoveVersion,
  onDuplicateVersion,
  onUpdateRow,
  onAddRow,
  onRemoveRow,
  onAddMoveEvent,
  onRemoveMoveEvent,
  onUpdateMoveEvent,
  onUpdateAllRowsMoveField,
}) {
  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/40">
      {/* Version header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/40 rounded-t-xl">
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-gray-700 dark:text-slate-200">* Version</label>
          <select
            value={activeVersionIdx}
            onChange={(e) => onSelectVersion(parseInt(e.target.value))}
            className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-medium min-w-[140px]"
          >
            {versions.map((v, i) => (
              <option key={i} value={i}>{v.label || `Version ${i + 1}`}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => {
            const name = prompt('Version name:', activeVersion.label);
            if (name !== null) onUpdateVersion('label', name);
          }} className="text-gray-500 dark:text-slate-400 hover:text-blue-600 p-1.5 rounded hover:bg-white/80 dark:hover:bg-slate-800/80" title="Rename version">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={onDuplicateVersion} className="text-gray-500 dark:text-slate-400 hover:text-blue-600 p-1.5 rounded hover:bg-white/80 dark:hover:bg-slate-800/80" title="Duplicate version">
            <Copy className="w-3.5 h-3.5" />
          </button>
          {versions.length > 1 && (
            <button type="button" onClick={onRemoveVersion} className="text-gray-500 dark:text-slate-400 hover:text-red-500 p-1.5 rounded hover:bg-white/80 dark:hover:bg-slate-800/80" title="Delete version">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <Button variant="secondary" onClick={onAddVersion} className="!py-1 !px-3 !text-xs ml-2">
            <Plus className="w-3 h-3 mr-1 inline" /> New Version
          </Button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* UOM + Effective Date + Version dates (inside the version box, like PP) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Unit of Measure</label>
            <select value={form.unit_of_measure} onChange={(e) => update('unit_of_measure', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              {UNITS_OF_MEASURE.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">Effective Date Based On</label>
            <select value={form.effective_date_basis} onChange={(e) => update('effective_date_basis', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              {EFFECTIVE_DATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <DatePicker
            label="Effective From"
            value={activeVersion.effective_from || ''}
            onChange={(v) => onUpdateVersion('effective_from', v)}
          />
          <DatePicker
            label="Effective To"
            value={activeVersion.effective_to || ''}
            onChange={(v) => onUpdateVersion('effective_to', v)}
          />
        </div>

        {/* Percentage Based On — conditional */}
        {isPercentage && (
          <div className="max-w-xs">
            <label className="block text-xs font-medium text-gray-600 dark:text-slate-300 mb-1">* Percentage Based On</label>
            <select value={form.percentage_based_on} onChange={(e) => update('percentage_based_on', e.target.value)}
              className="block w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option value="">Select charge code...</option>
              {CHARGE_NAMES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        )}

        {/* Calculation mode label + radio buttons */}
        <div>
          <div className="text-xs font-semibold text-gray-700 dark:text-slate-200 mb-2">Add your charges</div>
          <div className="flex gap-4 mb-4">
            {availableModes.map((m) => (
              <label key={m.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" name="calc_mode" checked={mode === m.value}
                  onChange={() => update('calculation_mode', m.value)} className="text-blue-600 w-4 h-4" />
                {m.label}
              </label>
            ))}
          </div>
        </div>

        {/* By Move: Calc From / To timing (once per version) */}
        {mode === 'by_move' && activeVersion.rows.length > 0 && (
          <div className="grid grid-cols-2 gap-4 p-3 rounded-lg bg-white/70 dark:bg-slate-900/70 border border-blue-100 dark:border-blue-800">
            <div>
              <label className="block text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1">Calculate From</label>
              <select value={activeVersion.rows[0]?.move_calc_from || 'first_event_arrived'}
                onChange={(e) => onUpdateAllRowsMoveField('move_calc_from', e.target.value)}
                className="block w-full rounded-md border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-xs bg-white dark:bg-slate-900">
                {MOVE_CALC_FROM.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-blue-700 dark:text-blue-300 mb-1">Calculate To</label>
              <select value={activeVersion.rows[0]?.move_calc_to || 'last_event_arrived'}
                onChange={(e) => onUpdateAllRowsMoveField('move_calc_to', e.target.value)}
                className="block w-full rounded-md border border-blue-200 dark:border-blue-800 px-2 py-1.5 text-xs bg-white dark:bg-slate-900">
                {MOVE_CALC_TO.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Charges table — dispatch to mode-specific row table */}
        {mode === 'by_lane' && (
          <LaneRowsTable
            rows={activeVersion.rows}
            isPercentage={isPercentage}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
          />
        )}
        {mode === 'between_statuses' && (
          <StatusRowsTable
            rows={activeVersion.rows}
            isPercentage={isPercentage}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
          />
        )}
        {mode === 'by_event' && (
          <EventRowsTable
            rows={activeVersion.rows}
            isPercentage={isPercentage}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
          />
        )}
        {mode === 'by_move' && (
          <MoveRowsTable
            rows={activeVersion.rows}
            isPercentage={isPercentage}
            onUpdateRow={onUpdateRow}
            onRemoveRow={onRemoveRow}
            onAddMoveEvent={onAddMoveEvent}
            onRemoveMoveEvent={onRemoveMoveEvent}
            onUpdateMoveEvent={onUpdateMoveEvent}
          />
        )}

        {/* Action buttons below table — PP style */}
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onAddRow} className="!py-1.5 !px-3 !text-xs">
            <Plus className="w-3 h-3 mr-1 inline" /> Add Charge
          </Button>
        </div>
      </div>
    </div>
  );
}
