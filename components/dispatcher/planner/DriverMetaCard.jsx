export default function DriverMetaCard({ driver }) {
  const { derived, eld } = driver;

  const Row = ({ label, value }) => (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-gray-900 dark:text-gray-100">{value ?? '—'}</span>
    </div>
  );

  return (
    <div className="w-[220px] p-3 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold dark:bg-blue-900 dark:text-blue-200">
          {driver.short_code || '—'}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate text-gray-900 dark:text-gray-100">
            {driver.truck_number ? `${driver.truck_number} — ${driver.name}` : driver.name}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{driver.status}</div>
        </div>
      </div>

      <div className="mb-3 space-y-0.5">
        <Row label="ETA" value={derived.eta} />
        <Row label="Truck #" value={derived.truck_number} />
        <Row label="Chassis #" value={derived.chassis_number} />
        <Row label="Size" value={derived.container_size} />
      </div>

      <div className="pt-2 border-t border-gray-200 dark:border-gray-700 space-y-0.5">
        <Row label="Cycle" value={eld?.cycle_remaining_s ? fmtHrs(eld.cycle_remaining_s) : null} />
        <Row label="Drive" value={eld?.drive_remaining_s ? fmtHrs(eld.drive_remaining_s) : null} />
        <Row label="Shift" value={eld?.shift_remaining_s ? fmtHrs(eld.shift_remaining_s) : null} />
        <Row label="Break" value={eld?.break_in_s ? fmtHrs(eld.break_in_s) : null} />
      </div>
    </div>
  );
}

function fmtHrs(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
