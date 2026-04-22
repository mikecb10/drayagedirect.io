import DriverMetaCard from './DriverMetaCard';

const MIN_SLOTS = 8;

export default function DriverRow({ driver, moves }) {
  const slotCount = Math.max(MIN_SLOTS, moves.length + 1); // +1 blank drop target past the last populated move

  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700">
      <div className="sticky left-0 z-10 bg-white dark:bg-gray-900">
        <DriverMetaCard driver={driver} />
      </div>
      <div className="flex">
        {Array.from({ length: slotCount }).map((_, i) => {
          const move = moves[i];
          return (
            <div
              key={i}
              className="w-[260px] min-h-[140px] p-2 border-r border-gray-100 dark:border-gray-800"
            >
              {move ? (
                <div className="text-xs text-gray-600 dark:text-gray-400 p-2 rounded bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  {move.order?.order_number || move.id.slice(0, 8)}
                </div>
              ) : (
                <div className="h-full rounded border border-dashed border-gray-300 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500 flex items-center justify-center">
                  —
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
