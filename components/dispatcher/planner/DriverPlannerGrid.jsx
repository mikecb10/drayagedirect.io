import DriverRow from './DriverRow';

export default function DriverPlannerGrid({ drivers, movesByDriverId, onClickPreview, onDispatch, onUnassign }) {
  if (drivers.length === 0) {
    return <div className="p-8 text-center text-gray-500 dark:text-gray-400">No drivers match your filters.</div>;
  }
  return (
    <div className="overflow-auto">
      <div className="min-w-max">
        {drivers.map((d) => (
          <DriverRow
            key={d.id}
            driver={d}
            moves={movesByDriverId[d.id] || []}
            onClickPreview={onClickPreview}
            onDispatch={onDispatch}
            onUnassign={onUnassign}
          />
        ))}
      </div>
    </div>
  );
}
