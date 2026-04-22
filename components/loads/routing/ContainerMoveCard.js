import { Play, CheckCircle2, Trash2, Plus, Check, X } from 'lucide-react';
import { useDroppable, useDndMonitor } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useState } from 'react';
import DriverPicker from '../../ui/DriverPicker';
import Button from '../../ui/Button';
import EventRow from './EventRow';

/**
 * InsertionDropZone — a thin drop target that appears BETWEEN events
 * when the user is dragging from the palette. Shows as a blue dashed
 * line that expands when hovered.
 */
function InsertionDropZone({ moveId, insertIndex, isDraggingFromPalette, draggingLabel }) {
  const droppableId = `insert-${moveId}-${insertIndex}`;
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: 'insertion', moveId, insertIndex },
  });

  if (!isDraggingFromPalette) return null;

  return (
    <div
      ref={setNodeRef}
      className={`transition-all rounded-lg border-2 border-dashed text-center text-xs ${
        isOver
          ? 'border-blue-400 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 py-3'
          : 'border-blue-200 dark:border-blue-800 bg-blue-50/20 dark:bg-blue-950/40 text-blue-400 dark:text-blue-500 py-1.5 hover:py-3 hover:border-blue-300 dark:hover:border-blue-700'
      }`}
    >
      {isOver ? (
        <>
          <Plus className="w-4 h-4 mx-auto mb-0.5" />
          Drop &ldquo;{draggingLabel}&rdquo; here
        </>
      ) : (
        <div className="h-0.5" />
      )}
    </div>
  );
}

/**
 * ContainerMoveCard — single Container Move with its nested events.
 *
 * When dragging from the palette, insertion drop zones appear BETWEEN
 * every event pair (and at the top + bottom) so the user can insert
 * an event at any position in the sequence.
 */
export default function ContainerMoveCard({
  move,
  events,
  index,
  isFirstMove = false,
  previousMoveCompleted = true,
  onMovePatch,
  onMoveDelete,
  onMoveStart,
  onMoveComplete,
  onEventUpdate,
  onEventDelete,
  legMetrics = {},
  use24h = false,
  onGlobalStatusCascade,
  // NEW: Dispatch + remove driver buttons (Move 1 only). When the user
  // clicks the green ✓, the load is marked dispatched (`orders.dispatched_at`
  // gets a timestamp). When they click the red ✗, the driver is removed
  // and dispatched_at is cleared. Both actions trigger a parent refetch
  // so the routing tab's load.dispatched_at flag flips immediately and
  // the template picker visibility responds.
  load = null,
  onDispatchLoad = null,   // () => Promise — sets orders.dispatched_at = now
  onRemoveLoadDriver = null, // () => Promise — clears orders.driver_id + dispatched_at
  // NEW for dry-run feature
  orderId,
  drivers = [],
  allDryRuns = [],
  onDryRunsChange,
  onEventPatch,      // (eventId, patch) => Promise — forwarded to EventRow for
                     // DistanceDisplay manual-override and reset-to-auto
}) {
  // Also register the whole card as a droppable fallback
  const { setNodeRef: setCardRef, isOver: isCardOver } = useDroppable({
    id: `move-${move.id}`,
    data: { type: 'move', moveId: move.id },
  });

  // Track if a palette drag is in progress globally
  const [isDraggingFromPalette, setIsDraggingFromPalette] = useState(false);
  const [draggingLabel, setDraggingLabel] = useState('');
  useDndMonitor({
    onDragStart(event) {
      if (event.active?.data?.current?.type === 'palette') {
        setIsDraggingFromPalette(true);
        setDraggingLabel(event.active.data.current.label || 'Event');
      }
    },
    onDragEnd() {
      setIsDraggingFromPalette(false);
      setDraggingLabel('');
    },
    onDragCancel() {
      setIsDraggingFromPalette(false);
      setDraggingLabel('');
    },
  });

  // Move progress is derived entirely from the events — no stored
  // move.status field drives the UI anymore. This eliminates the phantom
  // completed bug (where empty moves could get stuck showing COMPLETED)
  // and keeps the routing tab in sync with reality.
  //
  //   hasRealProgress — any event has a real arrived_at or departed_at
  //                     timestamp, OR the move itself has a started_at
  //   isFullyCompleted — every event has a departed_at (the driver
  //                      finished every leg of this move)
  //   isInProgress    — has progress but isn't fully done
  //
  // The old "Completed" status pill in the header has been removed
  // entirely — the derived Load State banner at the top of the routing
  // tab now shows the load's current state. Per-move status pills were
  // redundant with the events below them anyway.
  const hasRealProgress =
    !!move.started_at ||
    events.some((e) => e.arrived_at || e.departed_at);

  const isFullyCompleted =
    events.length > 0 && events.every((e) => !!e.departed_at);
  const isInProgress = hasRealProgress && !isFullyCompleted;

  // Kept as an alias for the Complete button visibility check below
  // (the button is shown only while the move is in progress).
  const isCompleted = isFullyCompleted;

  // A move is "locked" when work has begun — the driver cannot be cleared
  // until the user explicitly rewinds progress (clears Start Move or the
  // first event's Arrived timestamp). They CAN still swap to a different
  // driver via the picker; locking only prevents clearing to null.
  const isDriverLocked = hasRealProgress;

  function handleStatusCascade(eventId, field, value) {
    const evIdx = events.findIndex((e) => e.id === eventId);
    if (evIdx === -1) return;

    const now = new Date().toISOString();

    if (value) {
      // SETTING a status → fill all prior statuses
      const updates = [];
      for (let i = 0; i <= evIdx; i++) {
        const ev = events[i];
        if (i < evIdx) {
          if (!ev.arrived_at) updates.push({ id: ev.id, patch: { arrived_at: now } });
          if (!ev.departed_at) updates.push({ id: ev.id, patch: { departed_at: now } });
        } else {
          if (field === 'departed_at') {
            if (!ev.arrived_at) updates.push({ id: ev.id, patch: { arrived_at: now } });
            updates.push({ id: ev.id, patch: { departed_at: now } });
          } else {
            updates.push({ id: ev.id, patch: { arrived_at: now } });
          }
        }
      }
      for (const u of updates) onEventUpdate(u.id, u.patch);
    } else {
      // CLEARING a status → clear this and all subsequent statuses
      const updates = [];
      for (let i = evIdx; i < events.length; i++) {
        const ev = events[i];
        if (i === evIdx) {
          if (field === 'arrived_at') {
            updates.push({ id: ev.id, patch: { arrived_at: null, departed_at: null } });
          } else {
            updates.push({ id: ev.id, patch: { departed_at: null } });
          }
        } else {
          if (ev.arrived_at || ev.departed_at) {
            updates.push({ id: ev.id, patch: { arrived_at: null, departed_at: null } });
          }
        }
      }
      for (const u of updates) onEventUpdate(u.id, u.patch);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {/* Header — intentionally no status pill. The derived Load State
          banner at the top of the routing tab is the single source of
          truth for "where is this load right now". Per-move progress is
          visually obvious from the events below (colored Start / Arrived
          / Departed pills on each event row). */}
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-md bg-blue-100 dark:bg-blue-950/40 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
            Container Move {index + 1}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-48">
            <DriverPicker
              value={move.driver_id}
              locked={isDriverLocked}
              lockTooltip="Driver is locked — clear Start Move or the first event's Arrived timestamp to remove them."
              onChange={(v) => {
                // If the move is locked and caller tried to clear the driver,
                // reject the change. DriverPicker hides its clear X when
                // locked, so this is just a safety belt for any other path.
                if (isDriverLocked && !v) return;
                onMovePatch(move.id, { driver_id: v || null });
              }}
            />
          </div>

          {/* Dispatch + remove driver buttons — only on Move 1, only when
              a driver is assigned. The green ✓ dispatches the load
              (mirrors the dispatcher board's green button). The red ✗
              removes the driver and clears dispatched_at (mirrors the
              dispatcher board's red button). After either action, the
              routing tab refetches via onLoadRefresh so the template
              picker visibility updates immediately. */}
          {isFirstMove && move.driver_id && load && (
            <>
              {!load.dispatched_at && onDispatchLoad && (
                <button
                  type="button"
                  onClick={onDispatchLoad}
                  className="w-7 h-7 rounded bg-green-500 hover:bg-green-600 text-white flex items-center justify-center font-bold transition-colors"
                  title="Dispatch driver to this load"
                >
                  <Check className="w-4 h-4" strokeWidth={3} />
                </button>
              )}
              {!hasRealProgress && onRemoveLoadDriver && (
                <button
                  type="button"
                  onClick={onRemoveLoadDriver}
                  className="w-7 h-7 rounded bg-red-500 hover:bg-red-600 text-white flex items-center justify-center font-bold transition-colors"
                  title="Remove driver from load"
                >
                  <X className="w-4 h-4" strokeWidth={3} />
                </button>
              )}
            </>
          )}

          {isInProgress && !isCompleted && (
            <Button variant="secondary" onClick={() => onMoveComplete(move.id)}>
              <CheckCircle2 className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
              Complete
            </Button>
          )}
          {/* Delete move is hidden when any event in the move has a
              recorded timestamp — deleting a move cascade-deletes its
              events, which would destroy the audit trail. The user must
              clear all timestamps first to unlock the move. */}
          {!hasRealProgress && (
            <button
              type="button"
              onClick={() => onMoveDelete(move.id)}
              className="p-1.5 rounded text-gray-300 dark:text-slate-600 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
              title="Delete move"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Events with insertion drop zones */}
      <div
        ref={setCardRef}
        className={`p-3 transition-colors ${isCardOver ? 'bg-blue-50/30 dark:bg-blue-950/40' : 'bg-white dark:bg-slate-900'}`}
      >
        {events.length === 0 ? (
          <InsertionDropZone
            moveId={move.id}
            insertIndex={0}
            isDraggingFromPalette={isDraggingFromPalette || true}
            draggingLabel={draggingLabel || 'event'}
          />
        ) : (
          (() => {
            // Compute the "last touched" event index in this move. Events
            // at or before this index are locked (the driver has already
            // worked them), so we hide insertion drop zones at positions
            // ≤ lastTouchedIdx. Insertion is allowed at positions > that.
            let lastTouchedIdx = -1;
            for (let j = events.length - 1; j >= 0; j--) {
              if (events[j].arrived_at || events[j].departed_at) {
                lastTouchedIdx = j;
                break;
              }
            }
            return (
          <div className="space-y-1">
            {/* Drop zone before first event — only if no events touched yet */}
            {lastTouchedIdx === -1 && (
              <InsertionDropZone
                moveId={move.id}
                insertIndex={0}
                isDraggingFromPalette={isDraggingFromPalette}
                draggingLabel={draggingLabel}
              />
            )}

            <SortableContext
              items={events.map((e) => e.id)}
              strategy={verticalListSortingStrategy}
            >
              {events.map((ev, i) => {
                // Detect deliver+drop pair within the same move. The
                // pair rule: a Drop immediately following a Deliver in
                // the same move represents one physical action, and
                // the backend cascade keeps their arrived_at timestamps
                // in sync. We pass these flags to EventRow so it can
                // show a paperclip icon and the paired tooltip.
                const prev = i > 0 ? events[i - 1] : null;
                const next = i < events.length - 1 ? events[i + 1] : null;
                const isPairedDrop =
                  ev.event_type === 'drop' && prev?.event_type === 'deliver';
                const isPairedDeliver =
                  ev.event_type === 'deliver' && next?.event_type === 'drop';
                return (
                <div key={ev.id}>
                  <EventRow
                    event={ev}
                    index={i}
                    onUpdate={onEventUpdate}
                    onDelete={onEventDelete}
                    legMetrics={legMetrics[ev.id]}
                    onStatusChange={onGlobalStatusCascade || handleStatusCascade}
                    use24h={use24h}
                    moveStarted={true}
                    isFirstEvent={i === 0 && isFirstMove}
                    isPairedDrop={isPairedDrop}
                    isPairedDeliver={isPairedDeliver}
                    loadCompleted={load?.status === 'completed'}
                    onMoveStart={() => isInProgress ? onMovePatch(move.id, { started_at: null, status: 'pending' }) : onMoveStart(move.id)}
                    moveStartedAt={move.started_at}
                    onStartMoveChange={(v) => {
                      if (v) {
                        // Setting — could be now() or edited time
                        onMovePatch(move.id, { started_at: v, status: 'in_progress' });
                      } else {
                        // Clearing Start Move — trigger cascade clear from the very first event
                        // This is handled by the global cascade in RoutingTab
                        onMovePatch(move.id, { started_at: null, status: 'pending' });
                        // Clear ALL events across ALL moves
                        if (onGlobalStatusCascade) {
                          // Find first event and clear its arrived_at to trigger full cascade clear
                          const firstEvent = events[0];
                          if (firstEvent && firstEvent.arrived_at) {
                            onGlobalStatusCascade(firstEvent.id, 'arrived_at', null);
                          }
                        } else {
                          // Fallback: clear just this move's events
                          for (const evt of events) {
                            if (evt.arrived_at || evt.departed_at) {
                              onEventUpdate(evt.id, { arrived_at: null, departed_at: null });
                            }
                          }
                        }
                      }
                    }}
                    orderId={orderId}
                    drivers={drivers}
                    dryRuns={allDryRuns.filter((r) => r.event_id === ev.id)}
                    onDryRunsChange={onDryRunsChange}
                    defaultDriverId={move.driver_id || null}
                    onEventPatch={onEventPatch}
                  />
                  {/* Drop zone after each event — only shown if the
                      insertion position is > lastTouchedIdx (can't
                      insert between or before locked events). */}
                  {i >= lastTouchedIdx && (
                    <InsertionDropZone
                      moveId={move.id}
                      insertIndex={i + 1}
                      isDraggingFromPalette={isDraggingFromPalette}
                      draggingLabel={draggingLabel}
                    />
                  )}
                </div>
                );
              })}
            </SortableContext>
          </div>
            );
          })()
        )}
      </div>

      {/* Move-level totals */}
      {events.length > 0 && (() => {
        let totalMiles = 0;
        let totalMinutes = 0;
        for (const ev of events) {
          const m = legMetrics[ev.id];
          if (m) {
            totalMiles += m.distance_miles || 0;
            totalMinutes += m.duration_minutes || 0;
          }
        }
        if (totalMiles === 0 && totalMinutes === 0) return null;
        const durText = totalMinutes < 60
          ? `${totalMinutes}m`
          : totalMinutes % 60 === 0
            ? `${Math.floor(totalMinutes / 60)}h`
            : `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
        return (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900 flex items-center justify-end gap-4 text-[11px] text-gray-500 dark:text-slate-400">
            <span>{totalMiles.toFixed(1)} mi</span>
            <span>·</span>
            <span>{durText}</span>
            <span>·</span>
            <span className="font-semibold text-gray-700 dark:text-slate-200">$0.00</span>
          </div>
        );
      })()}
    </div>
  );
}
