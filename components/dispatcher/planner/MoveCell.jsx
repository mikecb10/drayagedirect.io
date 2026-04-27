import { useEffect, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Check, X } from 'lucide-react';
import {
  fmtRelativeETA, fmtAbsoluteETA, fmtOnSiteDuration,
  freshnessColor, freshnessColorClass,
} from '../../../lib/dispatcher/tracking-display.js';
import MoveCardCompact from './MoveCardCompact';
import { fmtApt } from '../../../lib/dispatcher/date-fmt';

const STATUS_BG = {
  unassigned: 'bg-gray-100 dark:bg-gray-800',
  pending: 'bg-blue-50 dark:bg-blue-950',
  dispatched: 'bg-indigo-50 dark:bg-indigo-950',
  in_progress: 'bg-amber-50 dark:bg-amber-950',
  completed: 'bg-green-50 dark:bg-green-950',
  cancelled: 'bg-gray-100 dark:bg-gray-800 line-through',
};

function TrackingLine({ move, events }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (move.tracking_status !== 'on_site') return;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [move.tracking_status]);

  const nextPending = events.find((e) => e.event_status === 'pending');
  const arrived = events.find((e) => e.event_status === 'arrived');
  const dot = freshnessColorClass(freshnessColor(move.last_ping_at));

  if (move.tracking_status === 'in_transit') {
    if (!nextPending) return null;
    return (
      <div className="px-2 pb-1 text-[10px] flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} title={`Last ping ${move.last_ping_at || 'unknown'}`} />
        <span className="text-blue-700 dark:text-blue-400">▶</span>
        <span className="text-gray-700 dark:text-gray-300">
          ETA {fmtAbsoluteETA(nextPending.eta_arrival_at)} · {fmtRelativeETA(nextPending.eta_arrival_at)}
        </span>
      </div>
    );
  }
  if (move.tracking_status === 'on_site') {
    if (!arrived) return null;
    return (
      <div className="px-2 pb-1 text-[10px] flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span>📍</span>
        <span className="text-green-700 dark:text-green-400">On-site {fmtOnSiteDuration(arrived.arrived_at)}</span>
      </div>
    );
  }
  if (move.tracking_status === 'paused') {
    const pausedFor = move.last_ping_at
      ? Math.round((Date.now() - new Date(move.last_ping_at).getTime()) / 60000)
      : null;
    return (
      <div className="px-2 pb-1 text-[10px] flex items-center gap-1 text-amber-700 dark:text-amber-400">
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        <span>⏸ Paused {pausedFor != null ? `${pausedFor}m` : ''}</span>
      </div>
    );
  }
  return null;
}

/**
 * Assigned move cell on the planner grid. Renders:
 *   - header row: load # link + Dispatch (✓) + Unassign (✗) action buttons
 *   - body: <MoveCardCompact /> (color stripe + load # + move type + appt + LFD)
 *   - assigned-at line + TrackingLine (when active)
 *
 * Click anywhere on the body opens MovePreviewPanel via onClickPreview.
 * Click on header buttons (dispatch/unassign/load-link) stops propagation.
 *
 * Props:
 *   move           (required)
 *   onClickPreview (cb) — invoked with `move` when cell body is clicked
 *   onOpenLoad     (cb) — invoked with order.id when load # link is clicked
 *   onDispatch     (cb) — invoked with `move` when Dispatch button is clicked
 *   onUnassign     (cb) — invoked with `move` when Unassign button is clicked
 */
export default function MoveCell({ move, onClickPreview, onOpenLoad, onDispatch, onUnassign }) {
  const draggable = useDraggable({
    id: `assigned:${move.id}`,
    data: { type: 'assigned-move', move },
    disabled: ['in_progress', 'completed', 'cancelled'].includes(move.status),
  });

  const order = move.order || {};
  const bg = STATUS_BG[move.status] || STATUS_BG.pending;

  return (
    <div
      ref={draggable.setNodeRef}
      {...draggable.attributes}
      {...draggable.listeners}
      className={[
        'flex flex-col h-full rounded border border-gray-200 dark:border-gray-700',
        bg,
        'cursor-grab active:cursor-grabbing hover:shadow-sm',
        draggable.isDragging && 'opacity-50',
      ].filter(Boolean).join(' ')}
      onClick={() => onClickPreview?.(move)}
      data-move-id={move.id}
    >
      {/* Header: load # link + dispatch/unassign buttons */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenLoad?.(order.id || move.order_id);
          }}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400 bg-transparent p-0 border-0 cursor-pointer"
        >
          {order.order_number || move.id.slice(0, 8)}
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDispatch?.(move); }}
            disabled={!['pending', 'dispatched'].includes(move.status)}
            className={[
              'w-5 h-5 rounded flex items-center justify-center',
              move.status === 'dispatched'
                ? 'bg-green-600 text-white'
                : 'border border-green-600 text-green-600 hover:bg-green-50 dark:border-green-500 dark:text-green-400 dark:hover:bg-green-950',
              !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
            ].filter(Boolean).join(' ')}
            title={
              ['in_progress', 'completed'].includes(move.status)
                ? "Can't dispatch — move is already in progress."
                : move.status === 'cancelled'
                ? 'Cancelled moves cannot be dispatched.'
                : move.status === 'unassigned'
                ? 'Assign a driver before dispatching.'
                : move.status === 'dispatched'
                ? 'Re-send to driver mobile app'
                : 'Dispatch to driver mobile app'
            }
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUnassign?.(move); }}
            disabled={!['pending', 'dispatched'].includes(move.status)}
            className={[
              'w-5 h-5 rounded flex items-center justify-center border border-red-600 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950',
              !['pending', 'dispatched'].includes(move.status) && 'opacity-40 cursor-not-allowed',
            ].filter(Boolean).join(' ')}
            title={
              ['in_progress', 'completed'].includes(move.status)
                ? "Can't unassign — move is already in progress. Reverse status on the Load Detail page first."
                : move.status === 'cancelled'
                ? 'Cancelled moves cannot be unassigned.'
                : 'Unassign driver'
            }
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body: shared compact card */}
      <div className="p-1">
        <MoveCardCompact move={move} />
      </div>

      {/* Assigned-at line + TrackingLine (preserved) */}
      {move.assigned_at && (
        <div className="px-2 pb-1 text-[10px] text-gray-500 dark:text-gray-500">
          Assigned: {fmtApt(move.assigned_at)}
        </div>
      )}

      {move.tracking_status && move.tracking_status !== 'idle' && move.tracking_status !== 'completed' && (
        <TrackingLine move={move} events={move.events || []} />
      )}
    </div>
  );
}
