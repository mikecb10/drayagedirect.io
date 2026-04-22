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
        <div className="h-full rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center">
          + Drop a move here
        </div>
      )}
    </div>
  );
}
