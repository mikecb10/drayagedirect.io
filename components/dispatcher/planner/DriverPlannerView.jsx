import { useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import useDriverPlanner from '../../../hooks/useDriverPlanner';
import { useOverlay } from '../../../contexts/OverlayContext';
import PlannerToolbar from './PlannerToolbar';
import DriverPlannerGrid from './DriverPlannerGrid';
import UnassignedRightRail from './UnassignedRightRail';
import MovePreviewPanel from './MovePreviewPanel';

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DriverPlannerView() {
  const router = useRouter();
  const date = router.query.date || todayIso();
  const { openOverlay } = useOverlay();

  const [driverSearch, setDriverSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [previewMove, setPreviewMove] = useState(null);
  // Local toast — mirrors the dispatcher page's bulkFlash pattern. Replaces
  // blocking browser alert() calls for mutation-failure / drag-blocked errors.
  const [toast, setToast] = useState(null); // { message, kind: 'error' | 'info' }

  function showToast(message, kind = 'error') {
    setToast({ message, kind });
    setTimeout(() => setToast((t) => (t?.message === message ? null : t)), 3500);
  }

  const { drivers, movesByDriverId, unassignedBuckets, isLoading, error, mutations, refetch } =
    useDriverPlanner({ date, driverSearch, includeInactive });

  // Fast driver lookup for the preview panel's Assignment row and anywhere
  // else we need to render a name from a driver_id on the move.
  const driversById = useMemo(
    () => Object.fromEntries((drivers || []).map((d) => [d.id, d])),
    [drivers]
  );

  // Open a load as a popup overlay (not a new browser tab) — keeps the user
  // in the planner context. Refetch on close so any edits made inside the
  // overlay (status, driver, dates) surface immediately.
  //
  // OverlayContext.closeOverlay clears the `tab` query param on close
  // (designed for the Load Board's ?tab=info|routing usage). On the planner,
  // `tab=planner` is the dispatcher-page-level tab selector, so we restore
  // it here after close — otherwise a page refresh would drop the user back
  // to the Load Board.
  function handleOpenLoad(orderId) {
    if (!orderId) return;
    openOverlay('load', {
      loadId: orderId,
      tab: 'info',
      onClose: () => {
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.set('tab', 'planner');
          window.history.replaceState({}, '', url.pathname + '?' + url.searchParams.toString());
        }
        refetch();
      },
    });
  }

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
      showToast("Can't move a job that's already in progress. Reverse status on the Load Detail page first.", 'info');
      return;
    }

    try {
      await mutations.assign({ move, driverId, index });
    } catch (e) {
      showToast(`Assign failed: ${e.message}`);
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
                onOpenLoad={handleOpenLoad}
                onDispatch={(m) => mutations.dispatch({ moveId: m.id }).catch((e) => showToast(`Dispatch failed: ${e.message}`))}
                onUnassign={(m) => mutations.unassign({ move: m, bucket: 'other' }).catch((e) => showToast(`Unassign failed: ${e.message}`))}
              />
            )}
          </div>

          <aside className="w-[360px] border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-950 overflow-hidden flex flex-col">
            <UnassignedRightRail buckets={unassignedBuckets} />
          </aside>
        </div>
      </div>
      <MovePreviewPanel
        move={previewMove}
        onClose={() => setPreviewMove(null)}
        onOpenLoad={handleOpenLoad}
        driversById={driversById}
      />

      {toast && (
        <div
          className={[
            'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-lg text-sm font-medium max-w-md',
            toast.kind === 'error'
              ? 'bg-red-600 text-white'
              : 'bg-slate-700 text-white',
          ].join(' ')}
          role="alert"
          onClick={() => setToast(null)}
        >
          {toast.message}
        </div>
      )}
    </DndContext>
  );
}
