import { useState } from 'react';
import { useRouter } from 'next/router';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import useDriverPlanner from '../../../hooks/useDriverPlanner';
import PlannerToolbar from './PlannerToolbar';
import DriverPlannerGrid from './DriverPlannerGrid';
import UnassignedMoveCard from './UnassignedMoveCard';

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  async function handleDragEnd(ev) {
    const { active, over } = ev;
    if (!over) return;
    if (over.data?.current?.type !== 'slot') return;
    const { driverId, index } = over.data.current;

    const sourceType = active.data?.current?.type;
    if (sourceType !== 'unassigned-move' && sourceType !== 'assigned-move') return;
    const move = active.data.current.move;

    // Guard: in_progress/completed/cancelled cannot be moved — useDraggable
    // already disables these for assigned-moves, but belt-and-suspenders:
    if (['in_progress', 'completed', 'cancelled'].includes(move.status)) {
      alert("Can't move a job that's already in progress. Reverse status on the Load Detail page first.");
      return;
    }

    try {
      await mutations.assign({ move, driverId, index });
    } catch (e) {
      alert(`Assign failed: ${e.message}`);
    }
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
            <div className="p-2 text-xs text-gray-500 dark:text-gray-400">
              Unassigned (interim flat list — replaced by buckets in Task 16)
            </div>
            <div className="p-2 space-y-2">
              {[...unassignedBuckets.atPort, ...unassignedBuckets.deliveries, ...unassignedBuckets.return, ...unassignedBuckets.other].map((m) => (
                <UnassignedMoveCard key={m.id} move={m} />
              ))}
            </div>
          </aside>
        </div>
      </div>
    </DndContext>
  );
}
