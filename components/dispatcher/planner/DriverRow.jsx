import DriverMetaCard from './DriverMetaCard';
import MoveSlot from './MoveSlot';

const MIN_SLOTS = 8;

export default function DriverRow({ driver, moves, onClickPreview, onDispatch, onUnassign }) {
  const slotCount = Math.max(MIN_SLOTS, moves.length + 1);

  return (
    <div className="flex border-b border-gray-200 dark:border-gray-700">
      <div className="sticky left-0 z-10 bg-white dark:bg-gray-900">
        <DriverMetaCard driver={driver} />
      </div>
      <div className="flex">
        {Array.from({ length: slotCount }).map((_, i) => (
          <MoveSlot
            key={i}
            driverId={driver.id}
            index={i}
            move={moves[i]}
            onClickPreview={onClickPreview}
            onDispatch={onDispatch}
            onUnassign={onUnassign}
          />
        ))}
      </div>
    </div>
  );
}
