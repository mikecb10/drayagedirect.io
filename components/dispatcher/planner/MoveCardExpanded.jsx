import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp } from 'lucide-react';
import MoveCardCompact from './MoveCardCompact';
import { EVENT_DOT_COLOR } from '../../../lib/dispatcher/event-colors';

function fmtAptShort(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

/**
 * Right-rail card. Wraps MoveCardCompact with an inline chevron expand
 * revealing Route / Container / Customer ref / Actions sections.
 *
 * Click anywhere on the card body OR on the chevron to toggle expand.
 * Click on the "Open full load" link or "Assign to driver" button stops
 * propagation so the expand state doesn't toggle.
 *
 * Props:
 *   move          (required) — move object
 *   tenantColors  (optional) — for stripe color override
 *   onAssign      (optional) — () => void; called when Assign is clicked.
 *                              When unset, the Assign button isn't rendered
 *                              (right-rail uses DnD assignment, not button).
 */
export default function MoveCardExpanded({ move, tenantColors = null, onAssign = null }) {
  const [expanded, setExpanded] = useState(false);
  const order = move?.order || {};
  const events = move?.events || [];

  return (
    <div>
      {/* Compact view (always visible) */}
      <div
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="cursor-pointer"
      >
        <MoveCardCompact move={move} tenantColors={tenantColors} />
      </div>

      {/* Chevron toggle */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="w-full flex items-center justify-center py-1 text-[10px] text-gray-500 dark:text-slate-500 hover:text-gray-700 dark:hover:text-slate-300 bg-gray-50 dark:bg-slate-800/40 border-x border-b border-gray-200 dark:border-slate-700 rounded-b"
      >
        {expanded ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
        {expanded ? 'less' : 'more'}
      </button>

      {/* Expanded sections */}
      {expanded && (
        <div className="border-x border-b border-gray-200 dark:border-slate-700 rounded-b -mt-1 bg-gray-50/60 dark:bg-slate-900/60">

          {/* Route */}
          {events.length > 0 && (
            <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1.5">Route</div>
              <ol className="space-y-1.5">
                {events.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className={`text-[10px] mt-0.5 ${EVENT_DOT_COLOR[e.event_type] || 'text-gray-400'}`}>●</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">
                        {e.event_type || 'event'}
                      </div>
                      <div className="text-[11px] font-medium text-gray-900 dark:text-slate-100 truncate" title={e.location_name}>
                        {e.location_name || 'No Location Provided'}
                      </div>
                      <div className="text-[10px] text-gray-500 dark:text-slate-400">
                        {[e.city, e.state].filter(Boolean).join(', ')}
                        {e.scheduled_at && ` · ${fmtAptShort(e.scheduled_at)}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Container */}
          {(order.container_number || order.container_size) && (
            <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-1.5">Container</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] uppercase text-gray-400 dark:text-slate-500">Number</div>
                  <div className="text-[11px] font-mono text-gray-900 dark:text-slate-100">
                    {order.container_number || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] uppercase text-gray-400 dark:text-slate-500">Size · Type</div>
                  <div className="text-[11px] font-mono text-gray-900 dark:text-slate-100">
                    {[order.container_size, order.container_type].filter(Boolean).join(' ') || '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Customer ref */}
          {order.customer_reference && (
            <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700">
              <div className="text-[9px] uppercase tracking-wide text-gray-500 dark:text-slate-500 mb-0.5">Customer ref</div>
              <div className="text-[11px] font-mono text-gray-900 dark:text-slate-100 truncate" title={order.customer_reference}>
                {order.customer_reference}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="px-2 py-2 border-t border-gray-200 dark:border-slate-700 flex gap-1">
            {onAssign && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAssign(); }}
                className="flex-1 px-2 py-1 rounded text-[11px] font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                Assign to driver
              </button>
            )}
            {order.id && (
              <Link
                href={`/loads/${order.id}`}
                onClick={(e) => e.stopPropagation()}
                className={`${onAssign ? 'flex-1' : 'w-full'} px-2 py-1 rounded text-[11px] font-medium text-center border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800`}
              >
                Open full load
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
