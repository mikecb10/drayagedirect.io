import { memo } from 'react';
import { getLoadTypeColor } from '../../../lib/dispatcher/load-type-colors';
import { lfdPillClass, fmtLfdShort } from '../../../lib/dispatcher/lfd-urgency';
import { fmtAptShort } from '../../../lib/dispatcher/date-fmt';

/**
 * Compact card view used by both the right-rail unassigned panel and the
 * assigned grid cells. Renders:
 *   - left-edge color stripe (load_type)
 *   - load number (order_number)
 *   - move type pill (truncated, hover-tooltip for full text)
 *   - first event appt time + LFD urgency pill
 *
 * Pure presentational — no internal state, no callbacks. Memoized because
 * the planner re-renders heavily during DnD.
 *
 * Props:
 *   move          (required) — move object from /api/tenant/dispatcher/planner
 *   tenantColors  (optional) — { load_type_colors?: {} } to override stripe map
 */
function MoveCardCompact({ move, tenantColors = null }) {
  const order = move?.order || {};
  const stripeColor = getLoadTypeColor(order.load_type, tenantColors);
  const apt = fmtAptShort(move?.events?.[0]?.scheduled_at);
  const lfdShort = fmtLfdShort(order.last_free_day);
  const lfdClass = lfdPillClass(order.last_free_day);

  return (
    <div
      className="relative bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded overflow-hidden"
      style={{ borderLeft: `4px solid ${stripeColor}` }}
    >
      {/* Load # row */}
      <div className="px-2 pt-2 pb-1">
        <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
          {order.order_number || move?.id?.slice(0, 8) || '—'}
        </div>
      </div>

      {/* Move-type pill row */}
      {move?.move_type && (
        <div className="px-2 pb-1">
          <span
            title={move.move_type}
            className="inline-block max-w-full truncate px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
          >
            {move.move_type}
          </span>
        </div>
      )}

      {/* Time + LFD row */}
      {(apt || lfdShort) && (
        <div className="px-2 pb-2 flex items-center gap-2 flex-wrap">
          {apt && (
            <span className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
              📅 {apt}
            </span>
          )}
          {lfdShort && lfdClass && (
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${lfdClass}`}>
              LFD {lfdShort}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(MoveCardCompact);
