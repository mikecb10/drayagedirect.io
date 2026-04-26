import { View, Text } from '@react-pdf/renderer';
import { typography, colors } from '../shared/typography';

function formatDateTime(input) {
  if (!input) return 'TBD';
  const d = new Date(input);
  if (isNaN(d.getTime())) return 'TBD';
  return d.toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatLocation(loc) {
  if (!loc) return '(TBD)';
  return [loc.name, loc.city, loc.state].filter(Boolean).join(', ');
}

export default function MoveBlock({ data, opts, isNextMoveOnly, totalMoves }) {
  if (!data || !data.moves || data.moves.length === 0) return null;
  const showDriver = opts?.show_driver !== false;

  return (
    <View style={{ marginBottom: 12 }}>
      {data.moves.map((move, idx) => {
        const driver = move.driver
          ? `${move.driver.first_name || ''} ${move.driver.last_name || ''}`.trim() || '(unassigned)'
          : '(unassigned)';
        const headerLabel = isNextMoveOnly
          ? `Next Move (Move ${move.move_index} of ${totalMoves || data.moves.length})`
          : `Move ${move.move_index} of ${totalMoves || data.moves.length}`;
        return (
          <View key={move.move_index ?? idx} style={{ marginBottom: 10 }}>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderBottom: `1pt solid ${colors.border || '#e5e7eb'}`,
                paddingBottom: 2,
                marginBottom: 4,
              }}
            >
              <Text style={[typography.label, { fontWeight: 'bold' }]}>{headerLabel}</Text>
              {showDriver ? (
                <Text style={typography.label}>Driver: {driver}</Text>
              ) : null}
            </View>
            {(move.events || []).map((ev, evIdx) => (
              <View
                key={ev.sequence ?? evIdx}
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}
              >
                <Text style={typography.value}>
                  {(evIdx + 1)}. {ev.event_type?.replace(/_/g, ' ') || '—'} @ {formatLocation(ev.location)}
                </Text>
                <Text style={[typography.value, typography.muted]}>
                  Sched: {formatDateTime(ev.scheduled_at)}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}
