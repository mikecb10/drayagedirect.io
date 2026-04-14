import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const SELF_EDIT_WINDOW_MS = 2500;

/**
 * useRealtimeLoads — Subscribes to Supabase Realtime for the orders table
 * so the dispatcher board sees live updates from other users in the tenant.
 *
 * RLS on orders ensures each tenant only receives their own events.
 *
 * ## Self-edit dedup
 * When the current user edits a load, they've already applied an optimistic
 * update locally. We don't want a realtime echo to also fire and overwrite
 * their in-flight edit. Call `markSelfEdit(loadId)` right before any save;
 * realtime events for that load within SELF_EDIT_WINDOW_MS (2.5s) are ignored.
 *
 * @param {object} opts
 * @param {boolean} opts.enabled — toggle the subscription
 * @param {function} opts.onInsert — called with new row when a load is inserted
 * @param {function} opts.onUpdate — called with (newRow, oldRow) on updates
 * @param {function} opts.onDelete — called with old row id when a load is deleted
 * @returns {{ markSelfEdit: (loadId: string) => void, connected: React.MutableRefObject<boolean> }}
 */
export default function useRealtimeLoads({ enabled = true, onInsert, onUpdate, onDelete } = {}) {
  const { supabase, tenantId } = useAuth();

  // Keep callbacks fresh without re-subscribing on every render
  const onInsertRef = useRef(onInsert);
  const onUpdateRef = useRef(onUpdate);
  const onDeleteRef = useRef(onDelete);
  useEffect(() => { onInsertRef.current = onInsert; }, [onInsert]);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);
  useEffect(() => { onDeleteRef.current = onDelete; }, [onDelete]);

  // Track IDs of loads we just edited ourselves so we can ignore the echo
  const selfEditsRef = useRef(new Map()); // loadId -> timestamp
  const connectedRef = useRef(false);

  const markSelfEdit = useCallback((loadId) => {
    if (!loadId) return;
    selfEditsRef.current.set(loadId, Date.now());
  }, []);

  function isRecentSelfEdit(loadId) {
    const ts = selfEditsRef.current.get(loadId);
    if (!ts) return false;
    if (Date.now() - ts > SELF_EDIT_WINDOW_MS) {
      selfEditsRef.current.delete(loadId);
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (!enabled || !supabase || !tenantId) {
      console.log('[Realtime] not enabling — enabled:', enabled, 'supabase:', !!supabase, 'tenantId:', tenantId);
      return;
    }

    console.log('[Realtime] subscribing for tenant:', tenantId);

    const channel = supabase
      .channel(`orders-tenant-${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          console.log('[Realtime] INSERT received:', payload);
          const row = payload.new;
          if (!row || row.deleted_at) return;
          if (isRecentSelfEdit(row.id)) {
            console.log('[Realtime] skipping self-edit INSERT', row.id);
            return;
          }
          onInsertRef.current?.(row);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          console.log('[Realtime] UPDATE received:', payload);
          const row = payload.new;
          const old = payload.old;
          if (!row) return;

          // Soft-delete — treat as removal
          if (row.deleted_at && !old?.deleted_at) {
            if (isRecentSelfEdit(row.id)) return;
            onDeleteRef.current?.(row.id);
            return;
          }

          // Ignore our own edits — we already optimistically updated them
          if (isRecentSelfEdit(row.id)) {
            console.log('[Realtime] skipping self-edit UPDATE', row.id);
            return;
          }

          onUpdateRef.current?.(row, old);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'orders',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          console.log('[Realtime] DELETE received:', payload);
          const oldRow = payload.old;
          if (!oldRow?.id) return;
          if (isRecentSelfEdit(oldRow.id)) return;
          onDeleteRef.current?.(oldRow.id);
        }
      )
      .subscribe((status, err) => {
        console.log('[Realtime] subscription status:', status, err || '');
        connectedRef.current = status === 'SUBSCRIBED';
      });

    return () => {
      console.log('[Realtime] unsubscribing');
      connectedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [enabled, supabase, tenantId]);

  return { markSelfEdit, connectedRef };
}
