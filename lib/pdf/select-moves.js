/**
 * Pick which moves render in a Delivery Order based on the variant.
 *
 * - delivery_order_full: all moves, sorted by move_index ascending
 * - delivery_order_next_move: the lowest-move_index move whose status
 *   is not 'completed' or 'cancelled'. Returns null if no eligible
 *   move exists (e.g., all moves are completed).
 *
 * Move statuses (per migration 090): unassigned | pending |
 * dispatched | in_progress | completed | cancelled.
 */
export function selectMoves(moves, variant) {
  const sorted = [...(moves || [])].sort(
    (a, b) => (a.move_index ?? 0) - (b.move_index ?? 0)
  );
  if (variant === 'delivery_order_full') return sorted;
  if (variant === 'delivery_order_next_move') {
    const next = sorted.find(
      (m) => m.status !== 'completed' && m.status !== 'cancelled'
    );
    return next ? [next] : null;
  }
  // Unknown variant — defensive default
  return sorted;
}
