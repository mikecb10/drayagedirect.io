import { useDroppable } from '@dnd-kit/core';
import MoveCell from './MoveCell';

export default function MoveSlot({ driverId, index, move, onClickPreview, onOpenLoad, onDispatch, onUnassign }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${driverId}:${index}`,
    data: { type: 'slot', driverId, index },
  });

  return (
    <div
      ref={setNodeRef}
      className={[
        'w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800',
        isOver && 'bg-blue-50 dark:bg-blue-950',
      ].filter(Boolean).join(' ')}
    >
      {move ? (
        <MoveCell move={move} onClickPreview={onClickPreview} onOpenLoad={onOpenLoad} onDispatch={onDispatch} onUnassign={onUnassign} />
      ) : (
        // Soft at rest (just a "+"), full "Drop a move here" on hover. Keeps
        // the grid from feeling busy across 8+ slots × N drivers.
        <div className="group h-full rounded border border-dashed border-gray-200 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-600 flex items-center justify-center transition-colors hover:border-gray-300 dark:hover:border-gray-700 hover:text-gray-600 dark:hover:text-gray-400">
          <span className="group-hover:hidden">+</span>
          <span className="hidden group-hover:inline">+ Drop a move here</span>
        </div>
      )}
    </div>
  );
}
