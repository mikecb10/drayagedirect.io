import { useDraggable } from '@dnd-kit/core';
import MoveCardExpanded from './MoveCardExpanded';

/**
 * Right-rail unassigned move card. DnD-draggable wrapper around
 * MoveCardExpanded (which renders compact + click-to-expand).
 *
 * The bucket prop is unused now — bucket info is conveyed by the
 * right-rail tab UI in UnassignedRightRail. Kept in the prop signature
 * for backwards compat with the parent until UnassignedRightRail is
 * cleaned up; can be dropped in a follow-up.
 *
 * Props:
 *   move    (required) — move object from /api/tenant/dispatcher/planner
 *   bucket  (legacy)   — ignored (was used for the removed BUCKET_ACCENT)
 */
export default function UnassignedMoveCard({ move /* , bucket */ }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unassigned:${move.id}`,
    data: { type: 'unassigned-move', move },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
    >
      <MoveCardExpanded move={move} />
    </div>
  );
}
