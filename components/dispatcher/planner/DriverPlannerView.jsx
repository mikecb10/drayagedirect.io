import { useState } from 'react';
import { useRouter } from 'next/router';
import useDriverPlanner from '../../../hooks/useDriverPlanner';
import PlannerToolbar from './PlannerToolbar';
import DriverPlannerGrid from './DriverPlannerGrid';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DriverPlannerView() {
  const router = useRouter();
  const date = router.query.date || todayIso();

  const [driverSearch, setDriverSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [previewMove, setPreviewMove] = useState(null);

  const { drivers, movesByDriverId, unassignedBuckets, isLoading, error, mutations, refetch } =
    useDriverPlanner({ date, driverSearch, includeInactive });

  return (
    <div className="flex flex-col h-full">
      <PlannerToolbar
        date={date}
        driverSearch={driverSearch}
        onDriverSearchChange={setDriverSearch}
        includeInactive={includeInactive}
        onIncludeInactiveChange={setIncludeInactive}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-4 bg-white dark:bg-gray-900">
          {isLoading && <div className="text-gray-500 dark:text-gray-400">Loading…</div>}
          {error && (
            <div className="text-red-600 dark:text-red-400">
              Error loading planner: {String(error.message || error)}
            </div>
          )}
          {!isLoading && !error && (
            <DriverPlannerGrid
              drivers={drivers}
              movesByDriverId={movesByDriverId}
              onClickPreview={(m) => setPreviewMove(m)}
              onDispatch={(m) => mutations.dispatch({ moveId: m.id }).catch((e) => alert(`Dispatch failed: ${e.message}`))}
              onUnassign={(m) => mutations.unassign({ move: m, bucket: 'other' }).catch((e) => alert(`Unassign failed: ${e.message}`))}
            />
          )}
        </div>

        <aside className="w-[360px] border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 overflow-auto">
          {/* Right-rail added in Task 16 */}
          <div className="p-4 text-sm text-gray-500 dark:text-gray-400">Unassigned pool — coming in Task 16.</div>
        </aside>
      </div>
    </div>
  );
}
