import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getBucket } from '../lib/dispatcher/moveBuckets';

const initial = {
  date: null,
  drivers: [],
  movesByDriverId: {},
  unassignedBuckets: { atPort: [], deliveries: [], return: [], other: [] },
  isLoading: true,
  error: null,
};

function reducer(state, action) {
  switch (action.type) {
    case 'LOADING':
      return { ...state, isLoading: true, error: null };
    case 'HYDRATE':
      return { ...action.payload, isLoading: false, error: null };
    case 'ERROR':
      return { ...state, isLoading: false, error: action.error };
    case 'OPTIMISTIC_ASSIGN': {
      // Move `moveId` from wherever it lives (unassigned or another driver row)
      // to the target driver at the target index.
      const { move, driverId, index } = action;
      const next = cloneState(state);
      removeMoveEverywhere(next, move.id);
      const row = next.movesByDriverId[driverId] || (next.movesByDriverId[driverId] = []);
      const clone = { ...move, driver_id: driverId, status: move.status === 'unassigned' ? 'pending' : move.status };
      row.splice(Math.max(0, Math.min(index, row.length)), 0, clone);
      renumberSortOrder(row);
      return next;
    }
    case 'OPTIMISTIC_UNASSIGN': {
      const { move } = action;
      const next = cloneState(state);
      removeMoveEverywhere(next, move.id);
      // Re-bucket the now-unassigned move. Caller pre-computes the bucket
      // string (via getBucket) and passes it on the action.
      const b = action.bucket; // 'atPort' | 'deliveries' | 'return' | 'other'
      if (b) next.unassignedBuckets[b].push({ ...move, driver_id: null, status: 'unassigned' });
      return next;
    }
    case 'OPTIMISTIC_DISPATCH': {
      const { moveId } = action;
      const next = cloneState(state);
      for (const arr of Object.values(next.movesByDriverId)) {
        const i = arr.findIndex((m) => m.id === moveId);
        if (i >= 0) arr[i] = { ...arr[i], status: 'dispatched' };
      }
      return next;
    }
    case 'OPTIMISTIC_REORDER': {
      const { driverId, orderedMoveIds } = action;
      const next = cloneState(state);
      const row = next.movesByDriverId[driverId] || [];
      const byId = Object.fromEntries(row.map((m) => [m.id, m]));
      next.movesByDriverId[driverId] = orderedMoveIds.map((id) => byId[id]).filter(Boolean);
      renumberSortOrder(next.movesByDriverId[driverId]);
      return next;
    }
    case 'UPDATE_TRACKING': {
      const { moveId, tracking } = action.payload;
      // Try assigned buckets first
      const driverId = Object.keys(state.movesByDriverId).find((did) =>
        state.movesByDriverId[did].some((m) => m.id === moveId),
      );
      if (driverId) {
        return {
          ...state,
          movesByDriverId: {
            ...state.movesByDriverId,
            [driverId]: state.movesByDriverId[driverId].map((m) =>
              m.id === moveId ? { ...m, ...tracking } : m,
            ),
          },
        };
      }
      // Also check unassigned buckets
      const bucketKey = Object.keys(state.unassignedBuckets).find((k) =>
        state.unassignedBuckets[k].some((m) => m.id === moveId),
      );
      if (bucketKey) {
        return {
          ...state,
          unassignedBuckets: {
            ...state.unassignedBuckets,
            [bucketKey]: state.unassignedBuckets[bucketKey].map((m) =>
              m.id === moveId ? { ...m, ...tracking } : m,
            ),
          },
        };
      }
      return state;
    }
    case 'ROLLBACK':
      return action.snapshot;
    default:
      return state;
  }
}

function cloneState(s) {
  return {
    ...s,
    movesByDriverId: Object.fromEntries(
      Object.entries(s.movesByDriverId).map(([k, v]) => [k, v.slice()])
    ),
    unassignedBuckets: {
      atPort: s.unassignedBuckets.atPort.slice(),
      deliveries: s.unassignedBuckets.deliveries.slice(),
      return: s.unassignedBuckets.return.slice(),
      other: s.unassignedBuckets.other.slice(),
    },
  };
}

function removeMoveEverywhere(state, moveId) {
  for (const arr of Object.values(state.movesByDriverId)) {
    const i = arr.findIndex((m) => m.id === moveId);
    if (i >= 0) arr.splice(i, 1);
  }
  for (const key of Object.keys(state.unassignedBuckets)) {
    const arr = state.unassignedBuckets[key];
    const i = arr.findIndex((m) => m.id === moveId);
    if (i >= 0) arr.splice(i, 1);
  }
}

function renumberSortOrder(arr) {
  arr.forEach((m, i) => (m.sort_order = i));
}

// ── Tracking-only pre-filter ─────────────────────────────────────────────────
// Columns written exclusively by the GPS-ping path. A Realtime UPDATE that only
// touches these columns does NOT affect planner layout — dispatch a targeted
// UPDATE_TRACKING action instead of a full refetch.
const TRACKING_ONLY_KEYS = new Set([
  'tracking_status',
  'last_ping_at',
  'ping_count',
  'session_started_at',
  'session_ended_at',
  'eta_recompute_count',
]);

function isTrackingOnlyChange(oldRow, newRow) {
  if (!oldRow || !newRow) return false;
  for (const key of Object.keys(newRow)) {
    if (newRow[key] === oldRow[key]) continue;
    if (!TRACKING_ONLY_KEYS.has(key)) return false;
  }
  return true;
}

export default function useDriverPlanner({ date, driverSearch = '', branchId = null, includeInactive = false }) {
  const { supabase, tenantId } = useAuth();
  const [state, dispatch] = useReducer(reducer, initial);

  const fetchPlanner = useCallback(async () => {
    if (!date) return;
    dispatch({ type: 'LOADING' });
    const qs = new URLSearchParams({ date });
    if (driverSearch) qs.set('driver_search', driverSearch);
    if (branchId) qs.set('branch_id', branchId);
    if (includeInactive) qs.set('include_inactive', '1');
    try {
      const r = await fetch(`/api/tenant/dispatcher/planner?${qs.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      dispatch({ type: 'HYDRATE', payload });
    } catch (e) {
      dispatch({ type: 'ERROR', error: e });
    }
  }, [date, driverSearch, branchId, includeInactive]);

  const refetchTimerRef = useRef(null);
  const scheduleRefetch = useCallback(() => {
    if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
    refetchTimerRef.current = setTimeout(() => {
      fetchPlanner();
    }, 300);
  }, [fetchPlanner]);

  useEffect(() => {
    fetchPlanner();
  }, [fetchPlanner]);

  // ── Realtime subscription ────────────────────────────────────────────
  useEffect(() => {
    if (!supabase || !tenantId || !date) return;

    const channel = supabase
      .channel(`dispatcher_planner:${tenantId}:${date}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_container_moves', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          // v1 strategy: refetch on any planner-relevant move change rather
          // than reconcile deltas client-side. The pre-filter below avoids
          // burning a refetch on moves that can't affect THIS date's view
          // — an assigned move on another date, or an unassigned move that
          // just got assigned to a driver on another date.
          const nw = payload.new || {};
          const old = payload.old || {};
          const relevantDate = (m) => m.scheduled_date === date || m.driver_id == null;
          if (!relevantDate(nw) && !relevantDate(old)) return;

          // Tracking-only UPDATE: merge columns directly without a full refetch.
          // This keeps GPS-ping updates (60 s cadence) from hammering the API.
          if (payload.eventType === 'UPDATE' && isTrackingOnlyChange(payload.old, payload.new)) {
            const tracking = {};
            for (const k of TRACKING_ONLY_KEYS) {
              if (k in payload.new) tracking[k] = payload.new[k];
            }
            dispatch({ type: 'UPDATE_TRACKING', payload: { moveId: payload.new.id, tracking } });
            return;
          }

          scheduleRefetch();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_routing_events', filter: `tenant_id=eq.${tenantId}` },
        () => scheduleRefetch()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          // Only refetch if last_free_day changed — the LFD badge in
          // MoveCell / MovePreviewPanel reads this field. Bucket
          // classification itself is event-driven and doesn't depend on
          // order-level flags anymore.
          const old = payload.old || {};
          const nw = payload.new || {};
          if (old.last_free_day !== nw.last_free_day) {
            scheduleRefetch();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, tenantId, date, scheduleRefetch]);

  // ── Periodic refetch (60s) while the page is visible ────────────────
  useEffect(() => {
    if (!date) return;
    let intervalId = null;

    function start() {
      if (intervalId != null) return;
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') fetchPlanner();
      }, 60_000);
    }
    function stop() {
      if (intervalId != null) clearInterval(intervalId);
      intervalId = null;
    }

    function onVis() {
      if (document.visibilityState === 'visible') {
        // Refetch immediately + ensure the timer runs
        fetchPlanner();
        start();
      } else {
        stop();
      }
    }

    start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [date, fetchPlanner]);

  // Mutation helpers — each is optimistic, rolls back on failure.
  //
  // Concurrency note: each mutation captures `snapshot` as a per-invocation
  // local const (not a shared ref). This keeps concurrent mutations from
  // clobbering each other's rollback targets. On failure we ALSO refetch so
  // that any Realtime-driven state change that landed between the optimistic
  // update and the failure isn't reverted by the rollback snapshot.
  const mutations = {
    async assign({ move, driverId, index, truckId = null, chassisId = null }) {
      const snapshot = state;
      dispatch({ type: 'OPTIMISTIC_ASSIGN', move, driverId, index });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/assign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId: move.id, driverId, truckId, chassisId, date, positionIndex: index }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot });
        fetchPlanner();
        throw e;
      }
    },
    async unassign({ move }) {
      const snapshot = state;
      // Compute the correct right-rail bucket for the now-unassigned move
      // so it lands in the right place optimistically — refetch confirms.
      const bucket = getBucket({ ...move, driver_id: null }) || 'other';
      dispatch({ type: 'OPTIMISTIC_UNASSIGN', move, bucket });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/unassign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId: move.id }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot });
        fetchPlanner();
        throw e;
      }
    },
    async dispatch({ moveId }) {
      const snapshot = state;
      dispatch({ type: 'OPTIMISTIC_DISPATCH', moveId });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot });
        fetchPlanner();
        throw e;
      }
    },
    // Not currently wired to any UI — DnD drops fire `assign` for every
    // slot target (including same-driver-same-date), and `assign.js`
    // handles in-row resequencing correctly. Kept as a clean API surface
    // for future bulk-reorder / keyboard-reorder flows.
    async reorder({ driverId, orderedMoveIds }) {
      const snapshot = state;
      dispatch({ type: 'OPTIMISTIC_REORDER', driverId, orderedMoveIds });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/reorder', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, date, orderedMoveIds }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot });
        fetchPlanner();
        throw e;
      }
    },
  };

  return { ...state, mutations, refetch: fetchPlanner };
}
