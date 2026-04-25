import { useState, useEffect } from 'react';
import { Trash2, MapPin, Play, Lock, Link2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import OrgPicker from '../../ui/OrgPicker';
import StatusButton from './StatusButton';
import { EVENT_LABELS } from '../../../lib/routing-template-seed';
import DryRunList from './DryRunList';
import DryRunSlideOver from './DryRunSlideOver';
import OverrideDriverModal from '../tracking/OverrideDriverModal';

const DRY_RUN_ELIGIBLE_EVENTS = new Set(['pull', 'pickup', 'deliver', 'return', 'drop', 'hook']);

function DistanceDisplay({ event, legMetrics, onOverride, onResetToAuto }) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState('');

  // Source of truth for display:
  //   1. persisted event.estimated_miles if present
  //   2. live legMetrics.distance_miles (Google-computed) if present
  //   3. "—" otherwise
  const persisted = event?.estimated_miles;
  const live = legMetrics?.distance_miles;
  const isManual = event?.distance_is_manual === true;
  const displayMiles = persisted != null ? persisted : (live ?? null);
  const displayText = displayMiles != null ? `${Number(displayMiles).toFixed(1)} mi` : '—';

  if (isEditing) {
    return (
      <span className="flex items-center gap-1">
        <input
          type="number"
          step="0.1"
          min="0"
          className="w-16 px-1 py-0.5 text-[11px] border border-gray-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const n = parseFloat(draftValue);
              if (!Number.isNaN(n) && n >= 0) {
                onOverride(n);
                setIsEditing(false);
              }
            } else if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
        />
        <button
          type="button"
          className="text-[11px] text-gray-500 hover:text-gray-900"
          onClick={() => setIsEditing(false)}
        >cancel</button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className="font-semibold text-gray-900 dark:text-slate-100">{displayText}</span>
      {isManual && (
        <span className="text-[10px] text-amber-600 dark:text-amber-400">(manual)</span>
      )}
      <button
        type="button"
        className="text-[11px] text-gray-400 hover:text-gray-900 dark:hover:text-slate-100"
        title="Override distance"
        onClick={() => {
          setDraftValue(displayMiles != null ? String(displayMiles) : '');
          setIsEditing(true);
        }}
      >
        ✎
      </button>
      {isManual && (() => {
        const liveMiles = legMetrics?.distance_miles;
        const canReset = typeof liveMiles === 'number' && !Number.isNaN(liveMiles);
        if (canReset) {
          return (
            <button
              type="button"
              className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline"
              onClick={onResetToAuto}
            >
              reset
            </button>
          );
        }
        return (
          <span
            className="text-[10px] text-gray-400 dark:text-slate-500"
            title="Google Maps hasn't computed this leg yet. Wait a moment or clear the override to see the auto value."
          >
            reset (unavailable)
          </span>
        );
      })()}
    </span>
  );
}

function labelFor(eventType) {
  return EVENT_LABELS[eventType] || (eventType || '').replace(/^./, (c) => c.toUpperCase());
}

/**
 * HistoryBadges — shows a green "driver" badge when the most recent
 * history entry for a given event+field came from the driver app, or an
 * amber "override" badge when a dispatcher overrode a driver timestamp.
 *
 * Fetches /api/tenant/loads/[loadId]/tracking once on mount (per-row,
 * v1 acceptable per plan). Click on the driver badge opens the override
 * modal.
 */
function HistoryBadges({ eventId, loadId, fieldName, currentValue }) {
  const [latestRow, setLatestRow] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!currentValue) { setLatestRow(null); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/tenant/loads/${loadId}/tracking`);
      if (!res.ok || cancelled) return;
      const data = await res.json();
      const targetStatus = fieldName === 'arrived_at' ? 'arrived' : 'departed';
      const eventHistory = (data.events_history || [])
        .filter((h) => h.event_id === eventId && h.to_status === targetStatus)
        .sort((a, b) => new Date(b.transitioned_at) - new Date(a.transitioned_at));
      if (!cancelled) setLatestRow(eventHistory[0] ?? null);
    })();
    return () => { cancelled = true; };
  }, [eventId, loadId, fieldName, currentValue]);

  if (!latestRow) return null;
  const ctx = latestRow.actor_context || {};
  const wasDriver = ctx.source === 'driver_app';
  const wasOverride = ctx.overrode_driver === true;

  return (
    <>
      {wasDriver && (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="ml-1 inline-flex items-center text-[10px] px-1 py-0.5 rounded bg-green-100 dark:bg-green-950 text-green-800 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-900"
          title={`Driver tapped at ${new Date(latestRow.transitioned_at).toLocaleString()}${
            ctx.gps_distance_at_arrival_m != null
              ? ` (GPS within ${(ctx.gps_distance_at_arrival_m / 1609).toFixed(2)} mi)`
              : ''
          }. Click to override.`}
        >
          📱 driver
        </button>
      )}
      {wasOverride && (
        <span
          className="ml-1 inline-flex items-center text-[10px] px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300"
          title={`Override${ctx.original_driver_timestamp ? ` (driver had: ${new Date(ctx.original_driver_timestamp).toLocaleString()})` : ''}${ctx.reason ? `\nReason: ${ctx.reason}` : ''}`}
        >
          🔄 override
        </span>
      )}
      {showModal && (
        <OverrideDriverModal
          event={{ id: eventId, location_name: latestRow.event?.location_name }}
          driverTimestamp={latestRow.transitioned_at}
          driverGpsDistanceM={ctx.gps_distance_at_arrival_m}
          fieldName={fieldName}
          loadId={loadId}
          onClose={() => setShowModal(false)}
          onSaved={() => window.location.reload()}
        />
      )}
    </>
  );
}

/**
 * EventRow — a single event inside a Container Move.
 *
 * PP-style vertical layout:
 *   - Event label + location on top
 *   - Start Move row (first event only, before move is started)
 *   - Arrival row
 *   - Departure row
 *   - Metrics footer (Duration, Distance, Driver Pay)
 */
function formatStartTime(isoString, use24h) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (use24h) return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

export default function EventRow({
  event, index, onUpdate, onDelete, legMetrics, onStatusChange,
  use24h = false, moveStarted = true, isFirstEvent = false, onMoveStart, moveStartedAt, onStartMoveChange,
  // NEW props for the deliver+drop pair + locking UI
  isPairedDrop = false,      // this drop immediately follows a deliver in the same move
  isPairedDeliver = false,   // this deliver is immediately followed by a drop in the same move
  loadCompleted = false,     // when true, all timestamps are frozen (load is completed)
  // NEW for dry-run feature
  orderId,
  drivers = [],
  dryRuns = [],
  onDryRunsChange,   // parent RoutingTab's refetch — call after save/edit so
                     // allDryRuns stays in sync with the DB and can't overwrite
                     // localDryRuns with stale data on a subsequent re-render
  defaultDriverId,   // move's currently-assigned driver, used as the create-mode
                     // default in the slide-over
  onEventPatch,      // (eventId, patch) => Promise — used by DistanceDisplay for
                     // manual-override and reset-to-auto saves
}) {
  const [editingLocation, setEditingLocation] = useState(false);
  const [dryRunSlideOpen, setDryRunSlideOpen] = useState(false);
  const [editingRun, setEditingRun] = useState(null);
  // Local mirror of dryRuns for instant optimistic updates; parent refetch
  // via onDryRunsChange keeps allDryRuns authoritative.
  const [localDryRuns, setLocalDryRuns] = useState(dryRuns);
  // Keyed on a content signature so the effect only fires when something
  // actually changed — not on every parent render (where dryRuns is a new
  // array reference from .filter()).
  const dryRunsSig = dryRuns.map((r) => `${r.id}:${r.ar_amount_cents}:${r.ap_amount_cents}:${r.miles || 0}`).join('|');
  useEffect(() => { setLocalDryRuns(dryRuns); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dryRunsSig]);

  const isDryRunEligible = DRY_RUN_ELIGIBLE_EVENTS.has(event.event_type);

  // Event is "locked" (structurally immutable) once ANY timestamp has been
  // recorded. The user can still clear timestamps to undo (which unlocks),
  // but they can't drag, delete, change the location, or change the event
  // type on a locked event. The backend enforces this too (see events/
  // [eventId].js PUT and DELETE guards).
  const isLocked = !!(event.arrived_at || event.departed_at);

  // Drop events only expose ONE timestamp in the UI — "Arrived" (meaning
  // the container was dropped). The backend auto-sets departed_at to the
  // same value as arrived_at so all downstream logic still works.
  // Additionally, when a Drop follows a Deliver in the same move, it's
  // paired: clicking Arrived on the Deliver cascades the timestamp to
  // this Drop, and vice versa.
  const isDropEvent = event.event_type === 'drop';

  // Dwell time
  let dwellMinutes = 0;
  let dwellText = '—';
  if (event.arrived_at && event.departed_at) {
    const arrivedMs = new Date(event.arrived_at).getTime();
    const departedMs = new Date(event.departed_at).getTime();
    dwellMinutes = Math.round((departedMs - arrivedMs) / 60000);
    if (dwellMinutes < 0) dwellMinutes = 0;
    if (dwellMinutes < 60) dwellText = `${dwellMinutes}m`;
    else { const h = Math.floor(dwellMinutes / 60); const m = dwellMinutes % 60; dwellText = m > 0 ? `${h}h ${m}m` : `${h}h`; }
  } else if (event.arrived_at && !event.departed_at) {
    const arrivedMs = new Date(event.arrived_at).getTime();
    dwellMinutes = Math.round((Date.now() - arrivedMs) / 60000);
    if (dwellMinutes < 60) dwellText = `${dwellMinutes}m ⏱`;
    else { const h = Math.floor(dwellMinutes / 60); const m = dwellMinutes % 60; dwellText = m > 0 ? `${h}h ${m}m ⏱` : `${h}h ⏱`; }
  }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: event.id,
    disabled: isLocked, // locked events cannot be reordered
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  function handleArrived(v) {
    if (onStatusChange) onStatusChange(event.id, 'arrived_at', v);
    else onUpdate(event.id, { arrived_at: v });
  }
  function handleDeparted(v) {
    if (onStatusChange) onStatusChange(event.id, 'departed_at', v);
    else onUpdate(event.id, { departed_at: v });
  }

  async function handleLocationChange(org) {
    setEditingLocation(false);
    if (!org) return;
    onUpdate(event.id, { location_id: org.id, location_name: org.name });
  }

  const locationLabel = event.location?.name || event.location_name || 'Click to set location';
  const locationSub = [event.city || event.location?.city, event.state || event.location?.state].filter(Boolean).join(', ');

  // Paired event hint — shown next to the event label when this event is
  // part of a deliver+drop pair. The icon + tooltip make the linkage
  // visible to dispatchers so they understand why the timestamps sync.
  const pairHint = isPairedDrop
    ? 'Paired with the Deliver event — their arrival timestamps are synced.'
    : isPairedDeliver
      ? 'Paired with the Drop event — their arrival timestamps are synced.'
      : null;

  return (
    <div ref={setNodeRef} style={style} className={`group rounded-lg border transition-colors ${
      isLocked
        ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-950/20'
        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600'
    }`}>
      {/* Header: # + Event Label + Location + Delete */}
      <div className="flex items-start border-b border-gray-100 dark:border-slate-800">
        {/* Drag handle (disabled when locked) */}
        <div
          {...(isLocked ? {} : attributes)}
          {...(isLocked ? {} : listeners)}
          className={`flex items-center justify-center px-2 py-3 border-r border-gray-100 dark:border-slate-800 self-stretch ${
            isLocked
              ? 'cursor-not-allowed text-emerald-400 dark:text-emerald-500'
              : 'cursor-grab active:cursor-grabbing text-gray-300 dark:text-slate-600 hover:text-gray-500 dark:hover:text-slate-400'
          }`}
          title={isLocked ? 'Locked — clear timestamps to unlock' : undefined}
        >
          {isLocked ? (
            <Lock className="w-3 h-3" />
          ) : (
            <span className="text-[10px] font-semibold">#{index + 1}</span>
          )}
        </div>

        {/* Event label + location */}
        <div className="flex-1 min-w-0 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">{labelFor(event.event_type)}</span>
            {pairHint && (
              <span
                className="inline-flex items-center text-blue-500 dark:text-blue-400"
                title={pairHint}
              >
                <Link2 className="w-3 h-3" />
              </span>
            )}
          </div>
          {editingLocation && !isLocked ? (
            <div className="mt-1">
              <OrgPicker value={event.location_id || null} valueLabel={event.location_name || ''} onChange={handleLocationChange} />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => !isLocked && setEditingLocation(true)}
              disabled={isLocked}
              className={`mt-0.5 flex items-center gap-1 text-xs ${
                isLocked
                  ? 'text-gray-600 dark:text-slate-400 cursor-not-allowed'
                  : 'text-gray-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400'
              }`}
              title={isLocked ? 'Location locked — clear timestamps to change' : undefined}
            >
              <MapPin className="w-3 h-3 text-gray-400 dark:text-slate-500" />
              <span className="truncate">
                {locationLabel}
                {locationSub && <span className="text-gray-400 dark:text-slate-500"> · {locationSub}</span>}
              </span>
            </button>
          )}
        </div>

        {/* Delete (hidden when locked) */}
        {!isLocked && (
          <button type="button" onClick={() => onDelete(event.id)}
            className="flex items-center justify-center px-2 py-3 text-gray-300 dark:text-slate-600 hover:text-red-500 border-l border-gray-100 dark:border-slate-800 self-stretch">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status rows: Start Move / Arrival / Departure — stacked vertically */}
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0">
          {/* Start Move row — only on first event of first move */}
          {isFirstEvent && (
            <div className="flex items-center px-4 py-2 border-b border-gray-50 dark:border-slate-800 gap-3">
              <span className="text-xs font-medium text-gray-500 dark:text-slate-400 w-20 shrink-0">Start</span>
              <StatusButton
                label="Start Move"
                value={moveStartedAt}
                onChange={onStartMoveChange}
                use24h={use24h}
                disabled={loadCompleted}
              />
            </div>
          )}

          {/* Arrival row */}
          {/* Drop events use a single "Dropped" button since the drop is
              an instantaneous action — the container is parked AND the
              driver leaves in the same moment. Non-drop events keep the
              classic Arrived/Departed split. */}
          <div className="flex items-center px-4 py-2 gap-3" style={{ borderBottom: isDropEvent ? 'none' : undefined }}>
            <span className="text-xs font-medium text-gray-500 dark:text-slate-400 w-20 shrink-0">
              {isDropEvent ? 'Dropped' : 'Arrival'}
            </span>
            <div className="flex items-center flex-wrap gap-1">
              <StatusButton
                label={isDropEvent ? 'Dropped' : 'Arrived'}
                value={event.arrived_at}
                onChange={handleArrived}
                use24h={use24h}
                disabled={loadCompleted || !moveStarted}
              />
              {orderId && (
                <HistoryBadges
                  eventId={event.id}
                  loadId={orderId}
                  fieldName="arrived_at"
                  currentValue={event.arrived_at}
                />
              )}
            </div>
          </div>

          {/* Departure row — hidden for Drop events (auto-set to match arrival) */}
          {!isDropEvent && (
            <>
              <div className="border-t border-gray-50 dark:border-slate-800" />
              <div className="flex items-center px-4 py-2 gap-3">
                <span className="text-xs font-medium text-gray-500 dark:text-slate-400 w-20 shrink-0">Departure</span>
                <div className="flex items-center flex-wrap gap-1">
                  <StatusButton label="Departed" value={event.departed_at} onChange={handleDeparted} use24h={use24h} disabled={loadCompleted || !moveStarted} />
                  {orderId && (
                    <HistoryBadges
                      eventId={event.id}
                      loadId={orderId}
                      fieldName="departed_at"
                      currentValue={event.departed_at}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Metrics panel — right side */}
        <div className="hidden lg:flex flex-col justify-center gap-0.5 border-l border-gray-100 dark:border-slate-800 px-3 text-[11px] text-gray-500 dark:text-slate-400 min-w-[130px]">
          <div className="flex justify-between">
            <span>Driver Pay</span>
            <span className="font-semibold text-gray-900 dark:text-slate-100">$0.00</span>
          </div>
          <div className="flex justify-between">
            <span>Dwell</span>
            <span className={`font-semibold ${dwellMinutes > 120 ? 'text-red-600 dark:text-red-400' : dwellMinutes > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-slate-100'}`}>
              {dwellText}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Travel</span>
            <span className="font-semibold text-gray-900 dark:text-slate-100">{legMetrics?.duration_text || '—'}</span>
          </div>
          <div className="flex justify-between items-center gap-2">
            <span>Distance</span>
            <DistanceDisplay
              event={event}
              legMetrics={legMetrics}
              onOverride={async (manualMiles) => {
                await onEventPatch?.(event.id, {
                  estimated_miles: manualMiles,
                  distance_is_manual: true,
                });
              }}
              onResetToAuto={async () => {
                const autoMiles = legMetrics?.distance_miles;
                if (typeof autoMiles !== 'number' || Number.isNaN(autoMiles)) return;
                await onEventPatch?.(event.id, {
                  estimated_miles: autoMiles,
                  distance_is_manual: false,
                });
              }}
            />
          </div>
        </div>
      </div>

      {isDryRunEligible && (
        <DryRunList
          runs={localDryRuns}
          onAdd={() => { setEditingRun(null); setDryRunSlideOpen(true); }}
          onEdit={(r) => { setEditingRun(r); setDryRunSlideOpen(true); }}
        />
      )}

      {isDryRunEligible && dryRunSlideOpen && (
        <DryRunSlideOver
          open={dryRunSlideOpen}
          onClose={() => setDryRunSlideOpen(false)}
          onSaved={async () => {
            try {
              const res = await fetch(`/api/tenant/loads/${orderId}/dry-runs?event_id=${event.id}`);
              const data = await res.json();
              setLocalDryRuns(data.dry_runs || []);
            } catch {}
            // Also tell the parent to refresh allDryRuns so its data stays
            // authoritative and subsequent re-renders don't clobber local
            // state with stale parent props.
            onDryRunsChange?.();
          }}
          orderId={orderId}
          event={{
            id: event.id,
            event_type: event.event_type,
            location_label: event.location_name || '',
            distance_miles: legMetrics?.distance_miles ?? null,
          }}
          drivers={drivers}
          existing={editingRun}
          defaultDriverId={defaultDriverId}
        />
      )}
    </div>
  );
}
