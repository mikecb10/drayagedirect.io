// components/loads/tracking/EventTimeline.js
import {
  fmtAbsoluteETA, fmtRelativeETA, fmtOnSiteDuration,
} from '../../../lib/dispatcher/tracking-display.js';

const ICONS = {
  pending: '⏳', arrived: '📍', departed: '✓', skipped: '⊝',
};

export default function EventTimeline({ move }) {
  const events = move.events || [];
  return (
    <ol className="space-y-2">
      {events.map((e, idx) => {
        const isCurrent = e.event_status === 'arrived';
        const isPending = e.event_status === 'pending';
        const tone =
          e.event_status === 'departed' ? 'text-gray-700 dark:text-gray-300' :
          isCurrent ? 'text-green-800 dark:text-green-200 font-semibold' :
          isPending ? 'text-blue-700 dark:text-blue-400' :
          'text-gray-500 dark:text-gray-500 line-through';
        return (
          <li key={e.id} className="text-sm">
            <div className={tone}>
              {ICONS[e.event_status] || '•'} {e.location_name || `Event ${idx + 1}`}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 ml-5">
              {e.scheduled_at && <>Apt {new Date(e.scheduled_at).toLocaleString()}</>}
              {e.arrived_at && <> · Arrived {new Date(e.arrived_at).toLocaleTimeString()}</>}
              {e.departed_at && <> · Departed {new Date(e.departed_at).toLocaleTimeString()}</>}
              {isCurrent && !e.departed_at && (
                <> · On-site {fmtOnSiteDuration(e.arrived_at)}</>
              )}
              {isPending && e.eta_arrival_at && (
                <> · ETA {fmtAbsoluteETA(e.eta_arrival_at)} ({fmtRelativeETA(e.eta_arrival_at)})</>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
