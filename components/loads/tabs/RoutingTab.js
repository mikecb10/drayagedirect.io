import { useEffect, useState, useCallback } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  rectIntersection,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Plus, StickyNote, Flag, RotateCcw } from 'lucide-react';
import Alert from '../../ui/Alert';
import Button from '../../ui/Button';
import EventPalette from '../routing/EventPalette';
import ContainerMoveCard from '../routing/ContainerMoveCard';
import RoutingTemplatePicker from '../routing/RoutingTemplatePicker';
import RouteMap from '../routing/RouteMap';
import RoutingOptions from '../routing/RoutingOptions';
import LoadStateBanner from '../routing/LoadStateBanner';
import RailCheckInSlip from '../routing/RailCheckInSlip';
import { getDistanceAndDuration } from '../../../utils/getDistanceMiles';
import { getValidNextEvents, canAddEvent, canAddMove, checkAutoRestructure } from '../../../lib/routing-rules';
import { useTenantTimeFormat, useTenantSettings } from '../../../hooks/useTenantSettings';
import { useTheme } from '../../../contexts/ThemeContext';

/**
 * RoutingTab (rewrite, Phase 6f)
 *
 * PortPro-style layout:
 *   - Header:  RoutingTemplatePicker + Add Bobtail + Add Note buttons
 *   - Left:    EventPalette + MapPlaceholder + RoutingOptions
 *   - Right:   ordered list of ContainerMoveCard components
 *   - Footer:  Complete Load button
 *
 * Data hierarchy mirrors the user's spec:
 *   Load -> Container Moves -> Events -> Legs (travel) -> Status timestamps
 */
export default function RoutingTab({ load, onLoadRefresh }) {
  const [moves, setMoves] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [templateId, setTemplateId] = useState(load?.routing_template_id || null);
  const [options, setOptions] = useState({});
  const [viewFilter, setViewFilter] = useState('all');
  // Whether the load has at least one BOL document attached. Drives the
  // Rail/Port Check-In Slip's "Awaiting BOL upload" state. Refetched
  // alongside the routing data + after slip verification toggles.
  const [hasBolDocument, setHasBolDocument] = useState(false);
  const [skipConfirmations, setSkipConfirmations] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('dd.skip_routing_confirms') === 'true';
    }
    return false;
  });

  function handleSkipConfirmationsChange(val) {
    setSkipConfirmations(val);
    localStorage.setItem('dd.skip_routing_confirms', String(val));
    // Also persist to API
    fetch('/api/tenant/dispatcher-preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skip_routing_confirmations: val }),
    }).catch(() => {});
  }

  // Helper: confirm only if not skipping
  function routingConfirm(message) {
    if (skipConfirmations) return true;
    return confirm(message);
  }
  const [legMetrics, setLegMetrics] = useState({});
  const use24h = useTenantTimeFormat();

  // Tenant-level color overrides + dark mode for the state banner
  const tenantSettings = useTenantSettings();
  const tenantColors = {
    state_colors: tenantSettings?.state_colors || {},
    load_type_colors: tenantSettings?.load_type_colors || {},
  };
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Custom collision detection: for palette drags, prioritize insertion zones.
  // For sortable reorders, use closestCenter.
  function customCollision(args) {
    const isPaletteDrag = args.active?.data?.current?.type === 'palette';
    if (isPaletteDrag) {
      const within = pointerWithin(args);
      // Prefer insertion zones over move-level droppables
      const insertHit = within.find(
        (w) => w.data?.droppableContainer?.data?.current?.type === 'insertion'
      );
      if (insertHit) return [insertHit];
      // Fall back to move-level droppable
      const moveHit = within.find(
        (w) => w.data?.droppableContainer?.data?.current?.type === 'move'
      );
      if (moveHit) return [moveHit];
      return rectIntersection(args);
    }
    return closestCenter(args);
  }

  const fetchRouting = useCallback(async () => {
    if (!load?.id) return;
    setLoading(true);
    setError(null);
    try {
      // Parallel fetch: routing events + documents (for BOL presence on
      // the Rail/Port Check-In Slip card). Documents are only needed for
      // Outbound/Export loads but we fetch unconditionally to keep the
      // code simple — the response is small and the user is already
      // looking at the load anyway.
      const [routingRes, docsRes] = await Promise.all([
        fetch(`/api/tenant/loads/${load.id}/routing`),
        fetch(`/api/tenant/loads/${load.id}/documents`).catch(() => null),
      ]);
      if (!routingRes.ok) throw new Error('Failed to load routing');
      const routingData = await routingRes.json();
      setMoves(routingData.moves || []);
      setEvents(routingData.events || []);

      if (docsRes && docsRes.ok) {
        const docsData = await docsRes.json();
        const docs = docsData.documents || [];
        // Schema uses document_type + file_name (not doc_type/filename)
        const bolFound = docs.some(
          (d) =>
            d.document_type === 'bol' ||
            (d.file_name || '').toLowerCase().includes('bol')
        );
        setHasBolDocument(bolFound);
      }

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [load?.id]);

  useEffect(() => {
    fetchRouting();
    // Time format now comes from useTenantTimeFormat() above (shared cached hook).
  }, [fetchRouting]);

  // ===== Compute per-leg metrics when events change =============
  useEffect(() => {
    if (events.length < 2) return;

    const sorted = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    let cancelled = false;

    async function computeMetrics() {
      const metrics = {};
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        const fromAddr = buildEventAddress(prev);
        const toAddr = buildEventAddress(curr);
        if (fromAddr && toAddr) {
          try {
            const result = await getDistanceAndDuration(fromAddr, toAddr);
            if (!cancelled) {
              metrics[curr.id] = result;
            }
          } catch {
            // Skip failed legs
          }
        }
      }
      if (!cancelled) setLegMetrics(metrics);
    }

    computeMetrics();
    return () => { cancelled = true; };
  }, [events.map((e) => `${e.id}-${e.location_name}-${e.sequence}`).join(',')]);

  // ===== Template + seeding =====================================
  //
  // Template selection behavior:
  //   - If the load has no moves yet: seed the fresh template (first-time).
  //   - If the load already has moves: call reseed_from_template which
  //     atomically wipes the existing moves + events and seeds from the
  //     new template. This is a no-confirm operation because the template
  //     picker is only clickable when load.dispatched_at is null, which
  //     means no real progress can exist to destroy.
  //   - The backend enforces the same dispatch-check as a safety belt.

  async function handleTemplateSelect(id, name) {
    setTemplateId(id);
    if (!id) return;

    try {
      if (moves.length === 0) {
        // First-time seed path: update load ref, then seed fresh
        await fetch(`/api/tenant/loads/${load.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ routing_template_id: id, routing_template_name: name }),
        });
        const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'seed_from_template' }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to seed events');
        }
      } else {
        // Reseed path: atomically replace the existing moves/events
        const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'reseed_from_template',
            template_id: id,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to replace routing template');
        }
      }

      await fetchRouting();
    } catch (e) {
      setError(e.message);
    }
  }

  // ===== Global status cascade (across all moves) =================

  function handleGlobalStatusCascade(eventId, field, value) {
    // Build a flat ordered list of ALL events across ALL moves
    const sortedMoves = [...moves].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const allEventsOrdered = [];
    for (const m of sortedMoves) {
      const moveEvts = events
        .filter((e) => e.move_id === m.id)
        .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
      allEventsOrdered.push(...moveEvts);
    }

    const evIdx = allEventsOrdered.findIndex((e) => e.id === eventId);
    if (evIdx === -1) return;

    const now = new Date().toISOString();

    if (value) {
      // SETTING a status → fill all prior statuses across all moves
      // Also auto-start Move 1 if not started
      const firstMove = sortedMoves[0];
      if (firstMove && !firstMove.started_at) {
        handleMovePatch(firstMove.id, { started_at: now, status: 'in_progress' });
      }

      const updates = [];
      for (let i = 0; i <= evIdx; i++) {
        const ev = allEventsOrdered[i];
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
      for (const u of updates) handleEventUpdate(u.id, u.patch);
    } else {
      // CLEARING a status → clear this and all subsequent across all moves
      const updates = [];
      for (let i = evIdx; i < allEventsOrdered.length; i++) {
        const ev = allEventsOrdered[i];
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
      for (const u of updates) handleEventUpdate(u.id, u.patch);

      // If clearing the first event's arrived, also clear Start Move
      if (evIdx === 0 && field === 'arrived_at') {
        const firstMove = sortedMoves[0];
        if (firstMove) {
          handleMovePatch(firstMove.id, { started_at: null, status: 'pending' });
        }
      }
    }
  }

  // ===== Event mutations =========================================

  async function handleEventUpdate(eventId, patch) {
    // Optimistic update — no flicker
    setEvents((evs) => evs.map((e) => (e.id === eventId ? { ...e, ...patch } : e)));
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing/events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update event');
      // ================================================================
      // Reconcile with the server response.
      //
      // The endpoint selects `*, location:customers(id, name, address_line1,
      // city, state, zip)` so `data.event.location` is the FRESH customer
      // join for the new location_id. The optimistic patch above only
      // touches the denorm fields (location_name, etc.) — the nested
      // `location` object keeps pointing at the OLD customer until we
      // reconcile. `EventRow` reads `event.location?.name` first (before
      // the denorm), so without this reconciliation the routing row shows
      // the stale pre-update location name while the LoadStateBanner
      // (which reads `event.location_name`) shows the new one.
      //
      // Symptom: "banner says KCS WYLIE, routing says BNSF HASLET"
      // (ORD-M000010 bug caught 2026-04-15).
      // ================================================================
      const body = await res.json().catch(() => null);
      if (body?.event) {
        setEvents((evs) => evs.map((e) => (e.id === eventId ? { ...e, ...body.event } : e)));
      }
      // Notify the parent so the LoadSidebar reflects server-side side
      // effects. Editing a routing event's location_id triggers the
      // reverse cascade in pages/api/tenant/loads/[id]/routing/events/
      // [eventId].js — it writes the new pickup/delivery/return
      // location_id + denorm fields back onto the orders row. Without
      // this refresh the sidebar reads a stale `load.pickup_org` and
      // shows e.g. BNSF HASLET while this tab correctly shows KCS
      // WYLIE (ORD-M000010 sidebar-drift bug caught 2026-04-15).
      //
      // Timestamp-only edits are a no-op for the sidebar but the
      // refresh is silent (`silent: true` inside the parent) so the
      // extra fetch is cheap and keeps load-level state consistent.
      if (typeof onLoadRefresh === 'function') {
        onLoadRefresh();
      }
    } catch (e) {
      setError(e.message);
      // Error — revert by refetching
      await fetchRouting();
    }
  }

  async function handleEventDelete(eventId) {
    const eventToDelete = events.find((e) => e.id === eventId);
    if (!eventToDelete) return;

    const isDrop = eventToDelete.event_type === 'drop';
    const moveId = eventToDelete.move_id;

    // Find this move's index and the next move (ensure sorted by sequence)
    const sortedMoves = [...moves].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    const moveIdx = sortedMoves.findIndex((m) => m.id === moveId);
    const nextMove = moveIdx >= 0 && moveIdx < sortedMoves.length - 1 ? sortedMoves[moveIdx + 1] : null;
    const nextMoveEvents = nextMove
      ? events.filter((e) => e.move_id === nextMove.id).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
      : [];
    const nextMoveStartsWithHook = nextMoveEvents.length > 0 && nextMoveEvents[0].event_type === 'hook';

    // If deleting a Drop and the next move starts with a Hook → auto-merge
    if (isDrop && nextMove && nextMoveStartsWithHook) {
      const mergeEvents = nextMoveEvents.slice(1); // everything after the Hook
      const mergeNames = mergeEvents.map((e) => e.event_type).join(' → ');

      if (routingConfirm(
        `Removing this Drop will merge Move ${moveIdx + 2} back into Move ${moveIdx + 1}.\n\n` +
        `The Hook will be removed and the remaining events (${mergeNames}) will rejoin this move.\n\n` +
        `Continue?`
      )) {
        try {
          // 1. Delete the Drop event
          await fetch(`/api/tenant/loads/${load.id}/routing/events/${eventId}`, { method: 'DELETE' });

          // 2. Delete the Hook from the next move
          await fetch(`/api/tenant/loads/${load.id}/routing/events/${nextMoveEvents[0].id}`, { method: 'DELETE' });

          // 3. Move remaining events from next move back to this move
          const maxSeq = events.reduce((m, e) => Math.max(m, e.sequence ?? 0), -1);
          for (let i = 0; i < mergeEvents.length; i++) {
            await fetch(`/api/tenant/loads/${load.id}/routing/events/${mergeEvents[i].id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ move_id: moveId, sequence: maxSeq + 10 + i }),
            });
          }

          // 4. Delete the now-empty next move
          await fetch(`/api/tenant/loads/${load.id}/routing/moves/${nextMove.id}`, { method: 'DELETE' });

          await fetchRouting();
          return;
        } catch (e) {
          setError(e.message);
          await fetchRouting();
          return;
        }
      } else {
        return; // user cancelled
      }
    }

    // Normal delete (non-Drop or no merge needed)
    if (!routingConfirm('Delete this event?')) return;
    try {
      await fetch(`/api/tenant/loads/${load.id}/routing/events/${eventId}`, { method: 'DELETE' });
      await fetchRouting();
    } catch (e) {
      setError(e.message);
    }
  }

  // Figure out the right "source location" for a newly inserted Drop based
  // on what event it's being dropped after. The rule:
  //
  //   • After a Deliver → inherit Deliver's location (same physical spot,
  //     the driver is at the customer with the container).
  //   • After a Pull → no location (yard role — dispatcher picks later).
  //   • After anything else → inherit the preceding event's location if
  //     any, otherwise leave blank.
  //
  // Returns a { location_id, location_name, address, city, state, zip }
  // object suitable for spreading into a create_event payload.
  function inheritLocationForInsertedDrop(moveEventsBefore) {
    if (!moveEventsBefore || moveEventsBefore.length === 0) return {};
    const prev = moveEventsBefore[moveEventsBefore.length - 1];
    if (!prev) return {};
    // After a Pull, the Drop goes to a yard — dispatcher picks the yard
    // manually. Leave location blank.
    if (prev.event_type === 'pull') return {};
    // After a Deliver (or anything else with a location), inherit.
    return {
      location_id: prev.location_id || null,
      location_name: prev.location_name || null,
      address: prev.address || null,
      city: prev.city || null,
      state: prev.state || null,
      zip: prev.zip || null,
    };
  }

  async function handleInsertEventInMove(moveId, eventType, insertIndex) {
    const moveEvents = events
      .filter((e) => e.move_id === moveId)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    // Check if inserting a Drop triggers auto-restructure
    const restructure = checkAutoRestructure(eventType, moveEvents, insertIndex);

    // Validation check
    if (restructure.invalid) {
      setError(restructure.reason);
      return;
    }

    const maxSeq = events.reduce((m, e) => Math.max(m, e.sequence ?? 0), -1);

    // Inherit location for the new Drop from the event immediately before
    // the insertion point (Deliver → same location, Pull → yard, etc).
    const dropLocation = inheritLocationForInsertedDrop(moveEvents.slice(0, insertIndex));

    try {
      if (restructure.shouldSplit && restructure.eventsToMove?.length > 0) {
        const eventsAfter = restructure.eventsToMove;

        // Order of operations matters! We need to:
        // 1. Create the new move first
        // 2. Move the split events to the new move
        // 3. Create the Hook in the new move (at the same location as the Drop)
        // 4. Add the Drop to the current move (with inherited location)
        // This prevents sequence conflicts.

        // 1. Create a new move
        const maxMoveSeq = moves.reduce((m, mv) => Math.max(m, mv.sequence ?? 0), -1);
        const newMoveRes = await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'create_move', sequence: maxMoveSeq + 1 }),
        });
        if (!newMoveRes.ok) throw new Error('Failed to create new move');
        const { move: newMove } = await newMoveRes.json();

        // 2. Move the split events to the new move (these are the events AFTER the drop point)
        for (let i = 0; i < eventsAfter.length; i++) {
          const r = await fetch(`/api/tenant/loads/${load.id}/routing/events/${eventsAfter[i].id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ move_id: newMove.id, sequence: maxSeq + 100 + i }),
          });
          if (!r.ok) throw new Error('Failed to move event');
        }

        // 3. Create Hook as first event of new move — inherits the same
        //    location as the Drop so the paired events stay colocated.
        //    The Drop↔Hook sync in the backend will keep them in sync if
        //    either one is later changed.
        await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_event',
            sequence: maxSeq + 99,
            move_id: newMove.id,
            event_type: 'hook',
            ...dropLocation,
          }),
        });

        // 4. Add the Drop event to the CURRENT move (after existing events)
        await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_event',
            sequence: maxSeq + 1,
            move_id: moveId,
            event_type: 'drop',
            ...dropLocation,
          }),
        });

        await fetchRouting();
      } else {
        // Simple insert — just add the event at this position.
        // If it's a drop, still inherit location from preceding event.
        const locationPayload = eventType === 'drop' ? dropLocation : {};
        await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_event',
            sequence: maxSeq + 1,
            move_id: moveId,
            event_type: eventType,
            ...locationPayload,
          }),
        });
        await fetchRouting();
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAppendEventToMove(moveId, eventType) {
    const moveEvents = events
      .filter((e) => e.move_id === moveId)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

    // Check if this Drop event should trigger an auto-restructure
    const insertIndex = moveEvents.length; // appending at end
    const restructure = checkAutoRestructure(eventType, moveEvents, insertIndex);

    const maxSeq = events.reduce((m, e) => Math.max(m, e.sequence ?? 0), -1);

    // Inherit location for appended Drop from the last existing event
    // in the move (typically a Deliver).
    const dropLocation = inheritLocationForInsertedDrop(moveEvents);

    try {
      if (restructure.shouldSplit) {
        // 1. Add the Drop event to the current move (with inherited location)
        await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_event',
            sequence: maxSeq + 1,
            move_id: moveId,
            event_type: 'drop',
            ...dropLocation,
          }),
        });

        // 2. Create a new move
        const maxMoveSeq = moves.reduce((m, mv) => Math.max(m, mv.sequence ?? 0), -1);
        const newMoveRes = await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_move',
            sequence: maxMoveSeq + 1,
          }),
        });
        if (!newMoveRes.ok) throw new Error('Failed to create new move');
        const { move: newMove } = await newMoveRes.json();

        // 3. Add a Hook Container as the first event of the new move
        //    (at the same location as the Drop).
        await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_event',
            sequence: maxSeq + 2,
            move_id: newMove.id,
            event_type: 'hook',
            ...dropLocation,
          }),
        });

        // 4. Move the split events to the new move
        for (let i = 0; i < restructure.eventsToMove.length; i++) {
          const ev = restructure.eventsToMove[i];
          await fetch(`/api/tenant/loads/${load.id}/routing/events/${ev.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              move_id: newMove.id,
              sequence: maxSeq + 3 + i,
            }),
          });
        }

        await fetchRouting();
      } else {
        // Simple append — no restructure needed.
        // Still inherit location for drops.
        const locationPayload = eventType === 'drop' ? dropLocation : {};
        const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_event',
            sequence: maxSeq + 1,
            move_id: moveId,
            event_type: eventType,
            ...locationPayload,
          }),
        });
        if (!res.ok) throw new Error('Failed to add event');
        await fetchRouting();
      }
    } catch (e) {
      setError(e.message);
    }
  }

  // ===== Move mutations ==========================================

  async function handleMovePatch(moveId, patch) {
    // Optimistic update — no flicker
    setMoves((ms) => ms.map((m) => (m.id === moveId ? { ...m, ...patch } : m)));
    try {
      const res = await fetch(
        `/api/tenant/loads/${load.id}/routing/moves/${moveId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        }
      );
      if (!res.ok) throw new Error('Failed to update move');
      // Success — optimistic state is correct
    } catch (e) {
      setError(e.message);
      await fetchRouting(); // revert on error
    }
  }

  async function handleMoveDelete(moveId) {
    if (!routingConfirm('Delete this Container Move and all its events?')) return;
    try {
      const res = await fetch(
        `/api/tenant/loads/${load.id}/routing/moves/${moveId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to delete move');
      await fetchRouting();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleMoveAction(action, moveId) {
    // Optimistic update for move status
    const now = new Date().toISOString();
    if (action === 'start_move') {
      setMoves((prev) => prev.map((m) => m.id === moveId ? { ...m, started_at: now, status: 'in_progress' } : m));
    } else if (action === 'complete_move') {
      setMoves((prev) => prev.map((m) => m.id === moveId ? { ...m, completed_at: now, status: 'completed' } : m));
    }
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, move_id: moveId }),
      });
      if (!res.ok) throw new Error(`Failed to ${action}`);
      // Success — optimistic state is correct
    } catch (e) {
      setError(e.message);
      await fetchRouting(); // revert on error
    }
  }

  // ===== Load-level dispatch actions (mirror dispatcher board) ====
  //
  // The routing tab's Move 1 driver picker shows green ✓ + red ✗
  // buttons that mirror the dispatcher board's behavior. They write to
  // orders.dispatched_at + orders.driver_id directly. After either
  // action we call onLoadRefresh() so the parent re-fetches the load
  // and our local `load` prop updates — which in turn flips the
  // template picker visibility (hidden when dispatched_at is set).

  async function handleDispatchLoad() {
    const now = new Date().toISOString();
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dispatched_at: now, status: 'dispatched' }),
      });
      if (!res.ok) throw new Error('Failed to dispatch driver');
      // Trigger parent refetch so the routing tab's load prop updates
      // and the template picker hides immediately.
      onLoadRefresh?.();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemoveLoadDriver() {
    // Defensive: refuse to remove if any routing event has a timestamp
    const anyTouched = events.some((e) => e.arrived_at || e.departed_at);
    if (anyTouched) {
      setError(
        'Cannot remove driver — this load already has progress recorded. Clear the routing event timestamps first.'
      );
      return;
    }
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driver_id: null,
          dispatched_at: null,
          status: 'available',
        }),
      });
      if (!res.ok) throw new Error('Failed to remove driver');
      // Also clear the driver from Move 1 (since the API mirrors load
      // driver_id from move 0 driver_id, but we want the move record
      // to also reflect the cleared state immediately).
      const firstMove = moves[0];
      if (firstMove?.driver_id) {
        await fetch(`/api/tenant/loads/${load.id}/routing/moves/${firstMove.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ driver_id: null }),
        });
      }
      // Trigger parent refetch + local routing refetch so both load
      // and moves arrays update and the template picker reappears.
      await fetchRouting();
      onLoadRefresh?.();
    } catch (e) {
      setError(e.message);
    }
  }

  const [completedAt, setCompletedAt] = useState(load.actual_delivery_at || null);
  const isLoadCompleted = load.status === 'completed' || !!completedAt;
  const isPendingCompletion = load.status === 'pending_completion';

  // Check if all events in all moves have departed (return is done)
  const allEventsDeparted = events.length > 0 && events.every((e) => !!e.departed_at);

  async function handleCompleteLoad() {
    if (!routingConfirm('Mark this load as completed?')) return;
    const now = new Date().toISOString();
    setCompletedAt(now);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete_load' }),
      });
      if (!res.ok) throw new Error('Failed to complete load');
      // Refresh the parent load to update status badge
      onLoadRefresh?.();
    } catch (e) {
      setError(e.message);
      setCompletedAt(null);
      await fetchRouting();
    }
  }

  async function handleUncompleteLoad() {
    if (!routingConfirm('Reopen this load? It will go back to in-transit status.')) return;
    setCompletedAt(null);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uncomplete_load' }),
      });
      if (!res.ok) throw new Error('Failed to uncomplete load');
      await fetchRouting();
      // Refresh the parent load to update status badge
      onLoadRefresh?.();
    } catch (e) {
      setError(e.message);
      await fetchRouting();
    }
  }

  async function handleAddMove() {
    const maxSeq = moves.reduce((m, mv) => Math.max(m, mv.sequence ?? 0), -1);
    try {
      const res = await fetch(`/api/tenant/loads/${load.id}/routing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_move',
          sequence: maxSeq + 1,
        }),
      });
      if (!res.ok) throw new Error('Failed to add move');
      await fetchRouting();
    } catch (e) {
      setError(e.message);
    }
  }

  // ===== Drag handling ===========================================

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over) return;

    // Palette → Insertion drop zone: insert event at specific position
    if (active.data?.current?.type === 'palette' && over.data?.current?.type === 'insertion') {
      const { moveId, insertIndex } = over.data.current;
      const eventType = active.data.current.eventType;
      handleInsertEventInMove(moveId, eventType, insertIndex);
      return;
    }

    // Palette → Move card fallback (dropped on the card but not on a specific zone)
    if (active.data?.current?.type === 'palette' && over.data?.current?.type === 'move') {
      const moveId = over.data.current.moveId;
      const eventType = active.data.current.eventType;
      const moveEvents = events.filter((e) => e.move_id === moveId);
      handleInsertEventInMove(moveId, eventType, moveEvents.length);
      return;
    }

    // Event reorder inside a move
    if (active.id !== over.id) {
      const fromIdx = events.findIndex((e) => e.id === active.id);
      const toIdx = events.findIndex((e) => e.id === over.id);
      if (fromIdx === -1 || toIdx === -1) return;
      const next = arrayMove(events, fromIdx, toIdx);
      setEvents(next);
      // Persist new sequence for affected events
      next.forEach((ev, i) => {
        if (ev.sequence !== i) {
          fetch(`/api/tenant/loads/${load.id}/routing/events/${ev.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sequence: i }),
          }).catch(() => {});
        }
      });
    }
  }

  // ===== Group events by move ====================================

  const eventsByMove = moves.reduce((acc, m) => {
    acc[m.id] = events
      .filter((e) => e.move_id === m.id)
      .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    return acc;
  }, {});

  const unassignedEvents = events.filter((e) => !e.move_id);

  // Compute valid next events based on ALL events across all moves
  const allSorted = [...events].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const validNextEvents = getValidNextEvents(allSorted);
  const addMoveStatus = canAddMove(allSorted);

  // Template picker visibility gate: hidden once the driver has been
  // dispatched (green ✓ pressed). The picker reappears if the driver
  // is removed from the load (red X pressed), since that clears
  // load.dispatched_at. This makes it impossible to accidentally wipe
  // the routing of a load that has a driver actively working on it.
  const isDispatched = !!load?.dispatched_at;

  // ===== Render ==================================================

  return (
    <div className="space-y-4">
      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        {isDispatched ? (
          <div className="text-xs text-gray-500 dark:text-slate-400 italic">
            Routing template locked — driver dispatched. Remove the driver from the load to change templates.
          </div>
        ) : (
          <RoutingTemplatePicker value={templateId} onSelect={handleTemplateSelect} />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => {}}>
            <Plus className="w-4 h-4 inline -mt-0.5 mr-1" />
            Add Bobtail
          </Button>
          <Button variant="secondary" onClick={() => {}}>
            <StickyNote className="w-4 h-4 inline -mt-0.5 mr-1" />
            Add Note
          </Button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={customCollision} onDragEnd={handleDragEnd}>
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* Left column */}
          <div className="space-y-3">
            <EventPalette />
            <RouteMap events={events} />
            <RoutingOptions
              options={options}
              onOptionsChange={setOptions}
              viewFilter={viewFilter}
              onViewChange={setViewFilter}
              skipConfirmations={skipConfirmations}
              onSkipConfirmationsChange={handleSkipConfirmationsChange}
            />
          </div>

          {/* Right column — Container Moves */}
          <div className="space-y-4">
            {/* Current State banner — derived from all events, cannot drift */}
            {!loading && moves.length > 0 && (
              <LoadStateBanner
                load={load}
                events={events}
                moves={moves}
                tenantColors={tenantColors}
                isDark={isDark}
              />
            )}

            {loading ? (
              <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-16 text-center text-sm text-gray-400 dark:text-slate-500">
                Loading routing…
              </div>
            ) : moves.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-900 py-16 text-center">
                <div className="text-sm font-semibold text-gray-500 dark:text-slate-400">
                  No Container Moves yet
                </div>
                <div className="text-xs text-gray-400 dark:text-slate-500 mt-1">
                  Pick a routing template above, or click "Add Move" to start from scratch.
                </div>
                <div className="mt-4">
                  <Button variant="secondary" onClick={handleAddMove}>
                    <Plus className="w-4 h-4 inline -mt-0.5 mr-1" />
                    Add Move
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {moves.map((m, idx) => {
                  // Move 1: gated by its own started_at (Start Move button).
                  // Move 2+: gated by the previous move having at least one
                  // event with departed_at (i.e. the previous move has made
                  // real progress). This is derived from events rather than
                  // the old move.status field, so phantom-completed moves
                  // can never accidentally gate a downstream move.
                  const prevMove = idx > 0 ? moves[idx - 1] : null;
                  const prevMoveEvents = prevMove ? (eventsByMove[prevMove.id] || []) : [];
                  const prevMoveCompleted = prevMove
                    ? prevMoveEvents.length > 0 &&
                      prevMoveEvents.every((e) => !!e.departed_at)
                    : true;

                  return (
                    <ContainerMoveCard
                      key={m.id}
                      move={m}
                      events={eventsByMove[m.id] || []}
                      index={idx}
                      isFirstMove={idx === 0}
                      previousMoveCompleted={prevMoveCompleted}
                      onMovePatch={handleMovePatch}
                      onMoveDelete={handleMoveDelete}
                      onMoveStart={(mid) => handleMoveAction('start_move', mid)}
                      onMoveComplete={(mid) => handleMoveAction('complete_move', mid)}
                      onEventUpdate={handleEventUpdate}
                      onEventDelete={handleEventDelete}
                      legMetrics={legMetrics}
                      use24h={use24h}
                      onGlobalStatusCascade={handleGlobalStatusCascade}
                      load={load}
                      onDispatchLoad={idx === 0 ? handleDispatchLoad : null}
                      onRemoveLoadDriver={idx === 0 ? handleRemoveLoadDriver : null}
                    />
                  );
                })}

                {unassignedEvents.length > 0 && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/40 p-3">
                    <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-300 mb-2">
                      Unassigned Events ({unassignedEvents.length})
                    </div>
                    <div className="text-xs text-amber-700 dark:text-amber-300">
                      These events aren't linked to any Container Move. Assign them or delete.
                    </div>
                  </div>
                )}

                {/* Rail/Port Check-In Slip — Outbound + Export only.
                    Sits at the bottom of the routing scroll area so the
                    dispatcher's natural top-to-bottom review ends with
                    verifying the slip against the uploaded BOL before
                    clearing the driver to head to the rail/port. */}
                {['outbound', 'export'].includes(load?.load_type) && (
                  <RailCheckInSlip
                    load={load}
                    hasBolDocument={hasBolDocument}
                    onVerifyChange={async () => {
                      // Refetch routing (which also refetches the docs +
                      // updates hasBolDocument) AND refresh the parent
                      // load so the verification fields propagate.
                      await fetchRouting();
                      onLoadRefresh?.();
                    }}
                  />
                )}

                {/* Footer actions */}
                <div className="flex items-center justify-between pt-2">
                  <Button variant="secondary" onClick={handleAddMove}>
                    <Plus className="w-4 h-4 inline -mt-0.5 mr-1" />
                    Add Move
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        // Refresh BOTH the routing-specific data (moves +
                        // events + BOL doc presence) AND the parent load
                        // (slip fields, status, dispatch state, etc.) so
                        // edits made in other tabs become visible here.
                        await fetchRouting();
                        onLoadRefresh?.();
                      }}
                    >
                      <RotateCcw className="w-4 h-4 inline -mt-0.5 mr-1" />
                      Refresh
                    </Button>
                    {isLoadCompleted ? (
                      <button
                        type="button"
                        onClick={handleUncompleteLoad}
                        className="group inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all bg-emerald-500 text-white hover:bg-red-500 shadow-sm"
                      >
                        <Flag className="w-4 h-4 inline -mt-0.5" />
                        <span className="group-hover:hidden">
                          Completed {completedAt && (
                            <span className="text-xs font-normal ml-1 text-white/80">
                              {new Date(completedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                            </span>
                          )}
                        </span>
                        <span className="hidden group-hover:inline">Uncomplete</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={allEventsDeparted ? handleCompleteLoad : undefined}
                        disabled={!allEventsDeparted}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all shadow-sm ${
                          allEventsDeparted
                            ? 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
                            : 'bg-gray-200 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-not-allowed'
                        }`}
                        title={!allEventsDeparted ? 'All routing events must be completed (departed) before the load can be marked complete' : 'Mark load as completed'}
                      >
                        <Flag className="w-4 h-4 inline -mt-0.5" />
                        Complete Load
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

// Build a geocodable address string from an event's location fields
function buildEventAddress(event) {
  const parts = [
    event.address || event.location?.address_line1,
    event.city || event.location?.city,
    event.state || event.location?.state,
    event.zip || event.location?.zip,
  ].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : null;
}
