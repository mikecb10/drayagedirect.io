import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';

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
      // Re-bucket the now-unassigned move (use the client-side util). Caller
      // supplies the fresh orderFlags via action.orderFlags.
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

export default function useDriverPlanner({ date, driverSearch = '', branchId = null, includeInactive = false }) {
  const { supabase, tenantId } = useAuth();
  const [state, dispatch] = useReducer(reducer, initial);
  const lastSnapshotRef = useRef(null);

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

  useEffect(() => {
    fetchPlanner();
  }, [fetchPlanner]);

  // Mutation helpers — each is optimistic, rolls back on failure.
  const mutations = {
    async assign({ move, driverId, index, truckId = null, chassisId = null }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_ASSIGN', move, driverId, index });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/assign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId: move.id, driverId, truckId, chassisId, date, positionIndex: index }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
    async unassign({ move, bucket }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_UNASSIGN', move, bucket });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/unassign', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId: move.id }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
    async dispatch({ moveId }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_DISPATCH', moveId });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/dispatch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moveId }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
    async reorder({ driverId, orderedMoveIds }) {
      lastSnapshotRef.current = state;
      dispatch({ type: 'OPTIMISTIC_REORDER', driverId, orderedMoveIds });
      try {
        const r = await fetch('/api/tenant/dispatcher/planner/reorder', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driverId, date, orderedMoveIds }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      } catch (e) {
        dispatch({ type: 'ROLLBACK', snapshot: lastSnapshotRef.current });
        throw e;
      }
    },
  };

  return { ...state, mutations, refetch: fetchPlanner };
}
