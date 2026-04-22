import { X, ExternalLink } from 'lucide-react';

export default function MovePreviewPanel({ move, onClose }) {
  if (!move) return null;
  const order = move.order || {};
  const driverLine = move.driver_id ? `Assigned driver: ${move.driver_id.slice(0, 8)}…` : 'Unassigned';

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-white dark:bg-gray-900 shadow-2xl border-l border-gray-200 dark:border-gray-700 z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {order.order_number || move.id.slice(0, 8)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Move preview</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4 text-sm">
        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Container</h3>
          <div className="text-gray-900 dark:text-gray-100">
            {[order.container_number, order.container_size, order.container_type].filter(Boolean).join(' · ') || '—'}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Assignment</h3>
          <div className="text-gray-900 dark:text-gray-100">{driverLine}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Status: {move.status}</div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">Events</h3>
          {(move.events || []).length === 0 && (
            <div className="text-gray-500 dark:text-gray-400 text-xs italic">No events scheduled yet</div>
          )}
          <ul className="space-y-2">
            {(move.events || []).map((e) => (
              <li key={e.id} className="border-l-2 border-blue-200 dark:border-blue-900 pl-2">
                <div className="text-gray-900 dark:text-gray-100 capitalize">{e.event_type}</div>
                <div className="text-xs text-gray-600 dark:text-gray-400">{e.location_name || 'No Location Provided'}</div>
                {e.scheduled_at && (
                  <div className="text-xs text-gray-500 dark:text-gray-500">Appt: {new Date(e.scheduled_at).toLocaleString()}</div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {order.lfd && (
          <section>
            <h3 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-1">LFD</h3>
            <div className="text-gray-900 dark:text-gray-100">{order.lfd}</div>
          </section>
        )}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 p-3">
        <a
          href={`/loads/${order.id || move.order_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          Open Load <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
