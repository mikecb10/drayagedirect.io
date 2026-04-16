import { Trash2 } from 'lucide-react';
import CentsInput from '../../ui/CentsInput';
import LaneLocationCell from './LaneLocationCell';

/**
 * LaneRowsTable — "By Lane" mode rows for the charge profile editor.
 *
 * Renders its own full <table> (colgroup + thead + tbody including the empty-
 * state row). The four common pricing columns (Minimum Amount, Free Units,
 * Amount, delete) are duplicated across all four mode-specific row tables —
 * intentional, keeps each table self-contained and readable end-to-end.
 */
export default function LaneRowsTable({ rows, isPercentage, onUpdateRow, onRemoveRow }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <table className="w-full text-sm" style={{ tableLayout: 'auto' }}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '32px' }} />
        </colgroup>
        <thead>
          <tr className="bg-gray-50 dark:bg-slate-900 text-[10px] font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
            <th className="text-left px-3 py-2 font-semibold">Origin</th>
            <th className="text-left px-3 py-2 font-semibold">Destination</th>
            <th className="text-left px-3 py-2 font-semibold">Minimum Amount</th>
            <th className="text-left px-3 py-2 font-semibold">Free Units</th>
            <th className="text-left px-3 py-2 font-semibold">Amount</th>
            <th className="px-1 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400 dark:text-slate-500">No charges added yet</td></tr>
          ) : rows.map((row, rIdx) => (
            <tr key={rIdx} className="border-t border-gray-100 dark:border-slate-800 align-top">
              <td className="px-2 py-2">
                <LaneLocationCell
                  typeValue={row.origin_type || 'org'}
                  orgId={row.origin_id}
                  orgLabel={row.origin_label}
                  textValue={row.origin_value}
                  onTypeChange={(t) => onUpdateRow(rIdx, 'origin_type', t)}
                  onOrgChange={(org) => { onUpdateRow(rIdx, 'origin_id', org?.id || null); onUpdateRow(rIdx, 'origin_label', org?.name || ''); }}
                  onTextChange={(v) => onUpdateRow(rIdx, 'origin_value', v)}
                  orgType="terminal"
                  placeholder="Origin"
                />
              </td>
              <td className="px-2 py-2">
                <LaneLocationCell
                  typeValue={row.dest_type || 'org'}
                  orgId={row.dest_id}
                  orgLabel={row.dest_label}
                  textValue={row.dest_value}
                  onTypeChange={(t) => onUpdateRow(rIdx, 'dest_type', t)}
                  onOrgChange={(org) => { onUpdateRow(rIdx, 'dest_id', org?.id || null); onUpdateRow(rIdx, 'dest_label', org?.name || ''); }}
                  onTextChange={(v) => onUpdateRow(rIdx, 'dest_value', v)}
                  orgType="warehouse"
                  placeholder="Destination"
                />
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
