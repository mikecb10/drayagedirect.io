import { Check, X } from 'lucide-react';

const STATUS_BG = {
  unassigned: 'bg-gray-100 dark:bg-gray-800',
  pending: 'bg-blue-50 dark:bg-blue-950',
  dispatched: 'bg-indigo-50 dark:bg-indigo-950',
  in_progress: 'bg-amber-50 dark:bg-amber-950',
  completed: 'bg-green-50 dark:bg-green-950',
  cancelled: 'bg-gray-100 dark:bg-gray-800 line-through',
};

const EVENT_LABEL = {
  pickup: 'Pick Up Container',
  deliver: 'Deliver Container',
  return: 'Return Container',
};

const EVENT_COLOR = {
  pickup: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  deliver: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  return: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
};

function fmtApt(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:${mi}`;
  } catch {
    return null;
  }
}

export default function MoveCell({ move, onClickPreview, onDispatch, onUnassign }) {
  const order = move.order || {};
  const bg = STATUS_BG[move.status] || STATUS_BG.pending;

  return (
    <div
      className={`flex flex-col h-full rounded border border-gray-200 dark:border-gray-700 ${bg} cursor-pointer hover:shadow-sm`}
      onClick={onClickPreview}
      data-move-id={move.id}
    >
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <a
          href={`/loads/${order.id || move.order_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          {order.order_number || move.id.slice(0, 8)}
        </a>
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
            title={move.status === 'dispatched' ? 'Re-send to driver mobile app' : 'Dispatch to driver mobile app'}
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
            title="Unassign driver"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="px-2 py-1 text-[11px] text-gray-600 dark:text-gray-400">
        {[order.container_number, order.container_size, order.container_type].filter(Boolean).join(' · ') || '—'}
      </div>

      {move.assigned_at && (
        <div className="px-2 pb-1 text-[10px] text-gray-500 dark:text-gray-500">
          Assigned: {fmtApt(move.assigned_at)}
        </div>
      )}

      <div className="flex-1 px-2 pb-2 space-y-1">
        {(move.events || []).map((e) => (
          <div key={e.id} className="text-[11px]">
            <span className={`inline-block px-1.5 py-0.5 rounded ${EVENT_COLOR[e.event_type] || 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}>
              {EVENT_LABEL[e.event_type] || e.event_type}
            </span>
            <div className="text-gray-700 dark:text-gray-300">{e.location_name || 'No Location Provided'}</div>
            {e.scheduled_at && (
              <div className="text-gray-500 dark:text-gray-500">Apt: {fmtApt(e.scheduled_at)}</div>
            )}
          </div>
        ))}
        {(!move.events || move.events.length === 0) && (
          <div className="text-[11px] text-gray-400 dark:text-gray-500 italic">No events scheduled yet</div>
        )}
      </div>

      {order.lfd && (
        <div className="px-2 py-1 text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 border-t border-amber-200 dark:border-amber-900">
          LFD: {order.lfd}
        </div>
      )}
    </div>
  );
}
