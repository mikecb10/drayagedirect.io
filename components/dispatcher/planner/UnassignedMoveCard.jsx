import { useDraggable } from '@dnd-kit/core';

export default function UnassignedMoveCard({ move }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `unassigned:${move.id}`,
    data: { type: 'unassigned-move', move },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={[
        'p-2 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-50',
      ].filter(Boolean).join(' ')}
    >
      <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
        {move.order?.order_number || move.id.slice(0, 8)}
      </div>
      <div className="text-[11px] text-gray-600 dark:text-gray-400">
        {[move.order?.container_number, move.order?.container_size, move.order?.container_type].filter(Boolean).join(' · ')}
      </div>
      {(move.events || [])[0]?.scheduled_at && (
        <div className="text-[10px] text-gray-500 dark:text-gray-500 mt-1">
          {move.events[0].location_name || 'No Location Provided'}
        </div>
      )}
    </div>
  );
}
