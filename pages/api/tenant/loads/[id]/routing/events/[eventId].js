import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';
import { deriveOrderStatusFromEvents } from '../../../../../../../lib/dispatcher-states';
import { fireStatusChangeTriggers, fireRoutingEventTriggers } from '../../../../../../../lib/email-dispatch';

const EDITABLE = [
  'event_type',
  'move_id',
  'location_id',
  'location_name',
  'address',
  'city',
  'state',
  'zip',
  'scheduled_at',
  'started_at',
  'arrived_at',
  'departed_at',
  'notes',
  'sequence',
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id, eventId } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    // Fetch old values for audit + cascade logic
    const { data: oldEvent } = await svc
      .from('order_routing_events')
      .select('event_type, location_name, arrived_at, departed_at, move_id, sequence')
      .eq('id', eventId)
      .maybeSingle();

    const updates = {};
    for (const f of EDITABLE) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }

    // ================================================================
    // Completed load guard: when a load is marked as Completed, routing
    // timestamps are frozen. The dispatcher must click "Uncomplete" to
    // revert to pending_completion before editing routing data. This
    // prevents accidental changes to finalized loads.
    // ================================================================
    const { data: parentLoad } = await svc
      .from('orders')
      .select('status')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .maybeSingle();
    if (parentLoad?.status === 'completed') {
      return res.status(409).json({
        error:
          'This load is completed. Uncomplete it first to modify routing timestamps.',
      });
    }

    // ================================================================
    // Locked event guard: once an event has any timestamp recorded,
    // structural fields (event_type, move_id, sequence, location_id)
    // cannot be changed — only the timestamps themselves can be
    // modified (cleared to undo, or replaced with corrected values).
    //
    // This protects the audit trail: if a driver already arrived at
    // location X, we can't retroactively say the event was actually
    // at location Y. The user must clear the timestamp first, then
    // edit structurally, then re-timestamp.
    // ================================================================
    const wasTouched = !!(oldEvent?.arrived_at || oldEvent?.departed_at);
    if (wasTouched) {
      const structuralEdit =
        ('event_type' in updates && updates.event_type !== oldEvent.event_type) ||
        ('move_id' in updates && updates.move_id !== oldEvent.move_id) ||
        ('location_id' in updates && updates.location_id !== undefined);

      // Sequence changes during reorder are OK — they're not semantic
      // edits, they're just positioning. But the frontend should avoid
      // triggering them on locked events anyway.

      if (structuralEdit) {
        return res.status(409).json({
          error:
            'Cannot modify structural fields on a locked event. Clear the arrived/departed timestamps first to unlock it.',
        });
      }
    }

    if (updates.location_id) {
      const { data: loc } = await svc
        .from('customers')
        .select('name, address_line1, city, state, zip')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', updates.location_id)
        .maybeSingle();
      if (loc) {
        updates.location_name = loc.name;
        updates.address = loc.address_line1;
        updates.city = loc.city;
        updates.state = loc.state;
        updates.zip = loc.zip;
      }
    }

    // ================================================================
    // Drop event: arrived_at and departed_at are always paired.
    // A Drop is a point-in-time action (you don't dwell at a drop for
    // a measurable interval — the moment you drop, you leave). So
    // whenever arrived_at is set on a Drop, we also set departed_at to
    // the same timestamp. And whenever arrived_at is cleared, we clear
    // departed_at too. This keeps all downstream "all events departed"
    // logic (completion derivation, prevMoveCompleted gating, KPI
    // buckets) working correctly while letting the UI show only a
    // single "Arrived" button on Drop events.
    // ================================================================
    if (oldEvent?.event_type === 'drop') {
      if ('arrived_at' in updates && updates.departed_at === undefined) {
        updates.departed_at = updates.arrived_at;
      }
    }

    const { data, error } = await svc
      .from('order_routing_events')
      .update(updates)
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', eventId)
      .select(`*, location:customers(id, name, address_line1, city, state, zip)`)
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // ================================================================
    // Deliver ↔ Drop pair timestamp cascade
    // ================================================================
    //
    // When a Drop event immediately follows a Deliver event in the same
    // move, they represent one physical action split into two data
    // records (the load's delivery milestone + the container's drop
    // operation). Their arrived_at timestamps must stay in sync.
    //
    // Rules:
    //   A. Setting Deliver.arrived_at → set Drop.arrived_at (and
    //      Drop.departed_at, since drops auto-depart) to the same time.
    //   C. Setting Drop.arrived_at → set Deliver.arrived_at to the same
    //      time (but NOT Deliver.departed_at — the driver may still be
    //      physically at the customer with the container before leaving).
    //   D. Clearing Deliver.arrived_at → clear Drop.arrived_at AND
    //      Drop.departed_at (the drop can't exist without the delivery).
    //   D'. Clearing Drop.arrived_at → clear Drop.departed_at only (the
    //      deliver can still exist without the drop — it converts to a
    //      live unload in semantic terms).
    //   (No cascade on Deliver.departed_at — that's independent.)
    //
    // Only fires when the pair condition is met: Drop immediately
    // follows Deliver in the same move.
    // ================================================================
    if (updates.arrived_at !== undefined) {
      // We need all events in this move, sorted, to find the paired one
      const { data: moveEvents } = await svc
        .from('order_routing_events')
        .select('id, sequence, event_type, move_id, arrived_at, departed_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .eq('move_id', data.move_id)
        .order('sequence', { ascending: true });

      if (moveEvents && moveEvents.length > 0) {
        const idx = moveEvents.findIndex((e) => e.id === eventId);
        const cascadeTargets = [];

        if (data.event_type === 'deliver' && idx !== -1) {
          // Look for a Drop immediately after this Deliver
          const next = moveEvents[idx + 1];
          if (next && next.event_type === 'drop') {
            if (updates.arrived_at === null) {
              // Rule D: clearing Deliver.arrived → clear Drop fully
              cascadeTargets.push({
                id: next.id,
                patch: { arrived_at: null, departed_at: null },
              });
            } else {
              // Rule A: setting Deliver.arrived → set Drop fully
              cascadeTargets.push({
                id: next.id,
                patch: {
                  arrived_at: updates.arrived_at,
                  departed_at: updates.arrived_at,
                },
              });
            }
          }
        }

        if (data.event_type === 'drop' && idx !== -1) {
          // Look for a Deliver immediately before this Drop
          const prev = moveEvents[idx - 1];
          if (prev && prev.event_type === 'deliver') {
            if (updates.arrived_at === null) {
              // Rule D': clearing Drop.arrived → do NOT clear Deliver
              // (Deliver can still exist without Drop — it's just a live
              // unload now). But do clear Drop.departed_at, which the
              // earlier logic already handled via the auto-pair.
              // Nothing to cascade here.
            } else {
              // Rule C: setting Drop.arrived → set Deliver.arrived to
              // the same time ONLY if it's not already set. Don't
              // overwrite a Deliver.arrived that the user set earlier.
              if (!prev.arrived_at) {
                cascadeTargets.push({
                  id: prev.id,
                  patch: { arrived_at: updates.arrived_at },
                });
              }
            }
          }
        }

        // Apply the cascade patches (if any)
        for (const target of cascadeTargets) {
          await svc
            .from('order_routing_events')
            .update(target.patch)
            .eq('tenant_id', ctx.tenantId)
            .eq('order_id', id)
            .eq('id', target.id);
        }
      }
    }

    // ====== Drop ↔ Hook location bidirectional sync ======
    //
    // Physical invariant: if Move N ends with a Drop at location X and
    // Move N+1 begins with a Hook, they MUST be at the same location (you
    // can't hook a container at a different yard than where it was dropped
    // — it's the same physical container). So whenever a Drop OR a Hook
    // has its location changed, we sync the paired event to match.
    if (
      updates.location_id !== undefined &&
      (data.event_type === 'drop' || data.event_type === 'hook')
    ) {
      // Fetch all events for this load to find the paired event
      const { data: allEvents } = await svc
        .from('order_routing_events')
        .select('id, sequence, event_type, move_id, location_id')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .order('sequence', { ascending: true });

      if (allEvents && allEvents.length > 0) {
        const idx = allEvents.findIndex((e) => e.id === eventId);
        if (idx !== -1) {
          let pairedEvent = null;
          if (data.event_type === 'drop') {
            // Find the next hook event after this drop
            pairedEvent = allEvents
              .slice(idx + 1)
              .find((e) => e.event_type === 'hook');
          } else if (data.event_type === 'hook') {
            // Find the prior drop event before this hook
            pairedEvent = [...allEvents.slice(0, idx)]
              .reverse()
              .find((e) => e.event_type === 'drop');
          }

          if (pairedEvent && pairedEvent.location_id !== data.location_id) {
            const syncPatch = {
              location_id: data.location_id,
              location_name: data.location_name,
              address: data.address,
              city: data.city,
              state: data.state,
              zip: data.zip,
            };
            await svc
              .from('order_routing_events')
              .update(syncPatch)
              .eq('tenant_id', ctx.tenantId)
              .eq('order_id', id)
              .eq('id', pairedEvent.id);
          }
        }
      }
    }

    // ====== Reverse cascade: routing event location → order-level ======
    //
    // Mirror of the forward cascade in pages/api/tenant/loads/[id]/index.js.
    //
    // When a dispatcher edits a pull/deliver/return event's location from
    // the Routing tab, the matching order-level field (pickup_location_id,
    // delivery_location_id, return_location_id) AND the denorm snapshot
    // (origin_* / destination_*) must follow — otherwise the sidebar +
    // "Current State" banner stay pinned to the old location while the
    // routing tab shows the new one.
    //
    // Architectural invariant (per user, 2026-04-15): a load has exactly
    // ONE pull, ONE deliver, and ONE return event. Dual-transaction loads
    // (empty return + live pick on one trip) are two separate loads. So
    // we cascade from the FIRST event of its type only — any secondary
    // pull/deliver/return (e.g. a second pull for a misdelivered container)
    // is a routing-only concept and must not rewrite the order header.
    // ====================================================================
    const REVERSE_CASCADE_MAP = {
      pull: { orderField: 'pickup_location_id', denormPrefix: 'origin' },
      deliver: { orderField: 'delivery_location_id', denormPrefix: 'destination' },
      return: { orderField: 'return_location_id', denormPrefix: null }, // no order-level denorm for return
    };
    if (
      updates.location_id !== undefined &&
      REVERSE_CASCADE_MAP[data.event_type]
    ) {
      // Confirm this is the first (canonical) event of its type.
      const { data: firstOfType } = await svc
        .from('order_routing_events')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .eq('event_type', data.event_type)
        .order('sequence', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (firstOfType?.id === data.id) {
        const { orderField, denormPrefix } = REVERSE_CASCADE_MAP[data.event_type];

        // Fetch the current order value to skip a no-op write.
        const { data: currentOrder } = await svc
          .from('orders')
          .select(orderField)
          .eq('tenant_id', ctx.tenantId)
          .eq('id', id)
          .maybeSingle();

        if (currentOrder && currentOrder[orderField] !== data.location_id) {
          const orderPatch = { [orderField]: data.location_id };
          // Refresh order-level denorm for pickup + delivery (return has
          // none, so skip when denormPrefix is null).
          if (denormPrefix) {
            orderPatch[`${denormPrefix}_address`] = data.address || null;
            orderPatch[`${denormPrefix}_city`] = data.city || null;
            orderPatch[`${denormPrefix}_state`] = data.state || null;
            orderPatch[`${denormPrefix}_zip`] = data.zip || null;
          }

          const { error: reverseErr } = await svc
            .from('orders')
            .update(orderPatch)
            .eq('tenant_id', ctx.tenantId)
            .eq('id', id)
            .is('deleted_at', null);

          if (!reverseErr) {
            await logTenantAction(svc, {
              tenantId: ctx.tenantId,
              userId: ctx.userId,
              action: 'load.order_cascaded_from_routing',
              entityType: 'order',
              entityId: id,
              newValues: {
                event_type: data.event_type,
                event_id: data.id,
                order_field: orderField,
                from_location_id: currentOrder[orderField],
                to_location_id: data.location_id,
                to_location_name: data.location_name,
              },
              ipAddress: getClientIp(req),
            });
          } else {
            console.error('reverse cascade error:', reverseErr);
          }
        }
      }
    }

    // ====== Auto-derive orders.status from all events ======
    //
    // This replaces the old "only update on drop.departed_at" logic with a
    // recompute-from-scratch approach. Every event update triggers a fresh
    // derivation so the coarse status bucket (which drives the KPI cards on
    // the dispatcher board) stays in sync with reality.
    //
    // Fetch ALL events + current load status, run deriveOrderStatusFromEvents,
    // and write the result if it changed.
    const { data: currentLoad } = await svc
      .from('orders')
      .select('status')
      .eq('tenant_id', ctx.tenantId)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    const { data: allEventsForDerive } = await svc
      .from('order_routing_events')
      .select('sequence, event_type, arrived_at, departed_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .order('sequence', { ascending: true });

    if (currentLoad && allEventsForDerive) {
      const newStatus = deriveOrderStatusFromEvents(
        allEventsForDerive,
        currentLoad.status
      );
      if (newStatus && newStatus !== currentLoad.status) {
        await svc
          .from('orders')
          .update({ status: newStatus })
          .eq('tenant_id', ctx.tenantId)
          .eq('id', id)
          .is('deleted_at', null);

        // Fire status-change email triggers for this transition
        fireStatusChangeTriggers(svc, {
          tenantId: ctx.tenantId,
          loadId: id,
          oldStatus: currentLoad.status,
          newStatus,
          userId: ctx.userId,
        }).catch((e) => console.error('event status trigger error:', e));
      }
    }

    // Fire routing-event-level email triggers when a timestamp is set.
    // This maps event_type + timestamp → trigger event_name (e.g.
    // deliver + arrived_at → 'arrived_at_deliver_load',
    // pull + departed_at → 'departed_pick_container') and fires any
    // matching status-kind triggers. Both arrived and departed are
    // separate trigger points so dispatchers have full control over
    // exactly which moment fires each email.
    const eventType = data.event_type || oldEvent?.event_type;
    if (eventType) {
      if (updates.arrived_at !== undefined && updates.arrived_at !== null) {
        fireRoutingEventTriggers(svc, {
          tenantId: ctx.tenantId,
          loadId: id,
          eventType,
          timestampField: 'arrived_at',
          userId: ctx.userId,
        }).catch((e) => console.error('routing arrived trigger error:', e));
      }
      if (updates.departed_at !== undefined && updates.departed_at !== null) {
        fireRoutingEventTriggers(svc, {
          tenantId: ctx.tenantId,
          loadId: id,
          eventType,
          timestampField: 'departed_at',
          userId: ctx.userId,
        }).catch((e) => console.error('routing departed trigger error:', e));
      }
    }

    // Only log meaningful changes (skip sequence-only updates from reorder)
    const meaningful = updates.arrived_at !== undefined || updates.departed_at !== undefined
      || updates.location_id || updates.event_type || updates.move_id;
    if (meaningful) {
      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.routing_event_update',
        entityType: 'order',
        entityId: id,
        oldValues: oldEvent,
        newValues: {
          event_type: data.event_type,
          location_name: data.location_name,
          ...(updates.arrived_at !== undefined ? { arrived_at: updates.arrived_at } : {}),
          ...(updates.departed_at !== undefined ? { departed_at: updates.departed_at } : {}),
          ...(updates.move_id ? { move_id: updates.move_id } : {}),
        },
        ipAddress: getClientIp(req),
      });
    }

    return res.status(200).json({ event: data });
  }

  if (req.method === 'DELETE') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    // Fetch for audit + lock check before deleting
    const { data: oldEvent } = await svc
      .from('order_routing_events')
      .select('event_type, location_name, arrived_at, departed_at')
      .eq('id', eventId)
      .maybeSingle();

    // Locked event guard: can't delete an event that has recorded
    // timestamps — clear the timestamps first to unlock it.
    if (oldEvent?.arrived_at || oldEvent?.departed_at) {
      return res.status(409).json({
        error:
          'Cannot delete a locked event. Clear the arrived/departed timestamps first to unlock it.',
      });
    }

    // Dry-run pre-flight
    const mode = req.query.mode; // undefined | 'detach' | 'delete_all'

    const { data: runs } = await svc
      .from('dry_run_attempts')
      .select('id, ar_amount_cents, ap_amount_cents')
      .eq('tenant_id', ctx.tenantId)
      .eq('event_id', eventId)
      .is('deleted_at', null);

    const dryRuns = runs || [];

    if (dryRuns.length > 0) {
      const attemptIds = dryRuns.map((r) => r.id);

      // Invoiced / settled gate
      const [{ data: arLines }, { data: apLines }] = await Promise.all([
        svc
          .from('order_charge_set_line_items')
          .select('id, charge_set:order_charge_sets!charge_set_id(status)')
          .in('dry_run_attempt_id', attemptIds),
        svc
          .from('order_driver_pay_lines')
          .select('id')
          .in('dry_run_attempt_id', attemptIds),
      ]);

      const blockedStatuses = ['approved', 'billed', 'rebilling'];
      const hasInvoiced = (arLines || []).some(
        (l) => l.charge_set && blockedStatuses.includes(l.charge_set.status)
      );

      let hasSettled = false;
      if (!hasInvoiced && (apLines || []).length > 0) {
        const payLineIds = apLines.map((l) => l.id);
        const { data: settled } = await svc
          .from('driver_settlement_lines')
          .select('id')
          .in('driver_pay_line_id', payLineIds);
        hasSettled = (settled || []).length > 0;
      }

      if (hasInvoiced || hasSettled) {
        return res.status(409).json({
          error: `Leg has ${dryRuns.length} invoiced/settled dry run(s). Create a credit memo or pay adjustment first.`,
          blocked: true,
          dry_run_count: dryRuns.length,
        });
      }

      if (!mode) {
        return res.status(409).json({
          needs_confirmation: true,
          dry_runs: dryRuns,
        });
      }

      if (mode === 'detach') {
        const { error: detachErr } = await svc
          .from('dry_run_attempts')
          .update({ event_id: null, updated_at: new Date().toISOString() })
          .in('id', attemptIds);
        if (detachErr) return res.status(500).json({ error: detachErr.message });
      } else if (mode === 'delete_all') {
        const now = new Date().toISOString();
        // Hard-delete derived lines first (FK cascade only fires on DELETE of
        // parent; we're soft-deleting the parent, so we must explicitly delete
        // children to avoid orphaned rows).
        await svc.from('order_charge_set_line_items').delete().in('dry_run_attempt_id', attemptIds);
        await svc.from('order_driver_pay_lines').delete().in('dry_run_attempt_id', attemptIds);
        const { error: pErr } = await svc
          .from('dry_run_attempts')
          .update({ deleted_at: now })
          .in('id', attemptIds);
        if (pErr) return res.status(500).json({ error: pErr.message });
      } else {
        return res.status(400).json({ error: `unknown mode: ${mode}` });
      }
    }

    const { error } = await svc
      .from('order_routing_events')
      .delete()
      .eq('tenant_id', ctx.tenantId)
      .eq('order_id', id)
      .eq('id', eventId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.routing_event_delete',
      entityType: 'order',
      entityId: id,
      newValues: oldEvent || { event_id: eventId },
      ipAddress: getClientIp(req),
    });

    return res.status(204).end();
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
