import MoveCell from './MoveCell';

export default function MoveSlot({ move, onClickPreview, onDispatch, onUnassign }) {
  if (move) {
    return (
      <div className="w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800">
        <MoveCell move={move} onClickPreview={onClickPreview} onDispatch={onDispatch} onUnassign={onUnassign} />
      </div>
    );
  }

  return (
    <div className="w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800">
      <div className="h-full rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center">
        + Drop a move here
      </div>
    </div>
  );
}
