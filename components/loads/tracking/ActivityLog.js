// components/loads/tracking/ActivityLog.js
const SOURCE_CHIP = {
  driver_app: 'bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-300',
  dispatcher_ui: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300',
  system: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300',
  geofence: 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300',
};

function chipFor(actor_type, actor_context) {
  const source = actor_context?.source ?? actor_type;
  return SOURCE_CHIP[source] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';
}

export default function ActivityLog({ events_history, moves_history, events, moves }) {
  // Merge + sort
  const eventsById = Object.fromEntries((events || []).map((e) => [e.id, e]));
  const movesById = Object.fromEntries((moves || []).map((m) => [m.id, m]));
  const combined = [
    ...(events_history || []).map((h) => ({
      kind: 'event', at: h.transitioned_at, h,
      label: `${eventsById[h.event_id]?.location_name || 'Event'}: ${h.from_status || '∅'} → ${h.to_status}`,
    })),
    ...(moves_history || []).map((h) => ({
      kind: 'move', at: h.transitioned_at, h,
      label: `Move ${(movesById[h.move_id]?.id || '').slice(0, 8)}: ${h.from_status || '∅'} → ${h.to_status}`,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  if (combined.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No activity yet.</p>;
  }

  return (
    <ul className="space-y-1">
      {combined.map((entry, idx) => {
        const ts = new Date(entry.at).toLocaleString();
        return (
          <li key={`${entry.kind}-${entry.h.id}-${idx}`} className="text-sm flex items-baseline gap-2">
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase font-medium ${chipFor(entry.h.actor_type, entry.h.actor_context)}`}>
              {entry.h.actor_context?.source ?? entry.h.actor_type}
            </span>
            <span className="text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{ts}</span>
            <span className="text-gray-800 dark:text-gray-200">{entry.label}</span>
            {entry.h.note && <span className="text-gray-500 dark:text-gray-400 text-xs italic">— {entry.h.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}
