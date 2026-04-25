import { useRouter } from 'next/router';
import { Search, Send } from 'lucide-react';

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function PlannerToolbar({
  date,
  driverSearch,
  onDriverSearchChange,
  includeInactive,
  onIncludeInactiveChange,
  pendingDispatchCount = 0,
  pendingDriverCount = 0,
  onBulkDispatch,
  bulkDispatching = false,
}) {
  const router = useRouter();

  function setDate(next) {
    const query = { ...router.query, tab: 'planner', date: next };
    router.replace({ pathname: '/dispatcher', query }, undefined, { shallow: true });
  }

  function handleBulkDispatchClick() {
    if (!onBulkDispatch || pendingDispatchCount === 0 || bulkDispatching) return;
    const moveLbl = pendingDispatchCount === 1 ? 'move' : 'moves';
    const driverLbl = pendingDriverCount === 1 ? 'driver' : 'drivers';
    const ok = window.confirm(
      `Dispatch ${pendingDispatchCount} ${moveLbl} to ${pendingDriverCount} ${driverLbl}?`
    );
    if (ok) onBulkDispatch();
  }

  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950">
      <label className="flex items-center gap-2">
        <span className="text-sm text-gray-600 dark:text-gray-400">Date</span>
        <input
          type="date"
          value={date || todayIso()}
          onChange={(e) => setDate(e.target.value)}
          className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <div className="relative flex-1 max-w-sm">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="Search drivers by name or truck #"
          value={driverSearch}
          onChange={(e) => onDriverSearchChange(e.target.value)}
          className="w-full pl-8 pr-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={(e) => onIncludeInactiveChange(e.target.checked)}
          className="rounded"
        />
        Include inactive drivers
      </label>

      <button
        type="button"
        onClick={handleBulkDispatchClick}
        disabled={pendingDispatchCount === 0 || bulkDispatching}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          pendingDispatchCount === 0 || bulkDispatching
            ? 'bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500 cursor-not-allowed'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'
        }`}
        title={
          pendingDispatchCount === 0
            ? 'No pending assigned moves to dispatch'
            : `Dispatch ${pendingDispatchCount} pending move${pendingDispatchCount === 1 ? '' : 's'} across ${pendingDriverCount} driver${pendingDriverCount === 1 ? '' : 's'}`
        }
      >
        <Send className="w-4 h-4" />
        {bulkDispatching ? 'Dispatching…' : `Dispatch All Pending (${pendingDispatchCount})`}
      </button>
    </div>
  );
}
