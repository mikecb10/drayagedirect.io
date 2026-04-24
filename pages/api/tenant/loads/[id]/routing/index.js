import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { buildRoutingEventsForTemplate } from '../../../../../../lib/routing-template-seed';
import { deriveOrderStatusFromEvents } from '../../../../../../lib/dispatcher-states';
import { fireOrderStatusChangeTriggers } from '../../../../../../lib/email-dispatch';
import {
  transitionMoveStatus,
  revertCascadedEventsForMove,
} from '../../../../../../lib/routing/moves/transition.js';

async function snapshotLocation(svc, tenantId, locationId) {
  if (!locationId) return {};
  const { data } = await svc
    .from('customers')
    .select('name, address_line1, city, state, zip')
    .eq('tenant_id', tenantId)
    .eq('id', locationId)
    .maybeSingle();
  return data || {};
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    // Fetch moves and events in parallel
    const [movesRes, eventsRes] = await Promise.all([
      svc
        .from('order_container_moves')
        .select(`*, driver:drivers(id, name)`)
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .order('sequence', { ascending: true }),
      svc
        .from('order_routing_events')
        .select(`*, location:customers(id, name, address_line1, city, state, zip)`)
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .order('sequence', { ascending: true }),
    ]);

    if (movesRes.error) return res.status(500).json({ error: movesRes.error.message });
    if (eventsRes.error) return res.status(500).json({ error: eventsRes.error.message });

    // ===== Read-repair: auto-heal stuck orders.status values =====
    //
    // Legacy loads may have incorrect orders.status from before the
    // auto-derive logic was added (e.g. stuck in 'in_transit' when a
    // drop event already has departed_at, which should be 'dropped').
    //
    // On every routing fetch we recompute the canonical status and
    // write it back if it differs. This is a read-repair: transparent
    // to the frontend, fires at most once per stuck load, and keeps
    // the KPI buckets accurate without requiring a bulk migration.
    try {
      const { data: currentLoad } = await svc
        .from('orders')
        .select('status')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();

      if (currentLoad) {
        const newStatus = deriveOrderStatusFromEvents(
          eventsRes.data || [],
          currentLoad.status
        );
        if (newStatus && newStatus !== currentLoad.status) {
          await svc
            .from('orders')
            .update({ status: newStatus })
            .eq('tenant_id', ctx.tenantId)
            .eq('id', id)
            .is('deleted_at', null);

          // Fire status-change email triggers for the transition
          fireOrderStatusChangeTriggers(svc, {
            tenantId: ctx.tenantId,
            loadId: id,
            oldStatus: currentLoad.status,
            newStatus,
            userId: ctx.userId,
          }).catch((e) => console.error('routing status trigger error:', e));
        }
      }
    } catch {
      // Read-repair is best-effort; never fail the main fetch because of it
    }

    return res.status(200).json({
      moves: movesRes.data || [],
      events: eventsRes.data || [],
    });
  }

  if (req.method === 'POST') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { action, ...body } = req.body || {};

    // Create a new move
    if (action === 'create_move') {
      const { data, error } = await svc
        .from('order_container_moves')
        .insert({
          tenant_id: ctx.tenantId,
          order_id: id,
          sequence: body.sequence ?? 0,
          move_type: body.move_type || null,
          driver_id: body.driver_id || null,
          status: 'pending',
        })
        .select()
        .single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ move: data });
    }

    // Create a new event
    if (action === 'create_event') {
      const { data, error } = await svc
        .from('order_routing_events')
        .insert({
          tenant_id: ctx.tenantId,
          order_id: id,
          move_id: body.move_id || null,
          sequence: body.sequence ?? 0,
          event_type: body.event_type,
          location_id: body.location_id || null,
          location_name: body.location_name || null,
          address: body.address || null,
          city: body.city || null,
          state: body.state || null,
          zip: body.zip || null,
          scheduled_at: body.scheduled_at || null,
          notes: body.notes || null,
          estimated_miles: body.estimated_miles ?? null,
          distance_is_manual: body.distance_is_manual === true,
        })
        .select(`*, location:customers(id, name, address_line1, city, state, zip)`)
        .single();
      if (error) return res.status(500).json({ error: error.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.routing_event_create',
        entityType: 'order',
        entityId: id,
        newValues: { event_type: body.event_type },
        ipAddress: getClientIp(req),
      });

      return res.status(201).json({ event: data });
    }

    // Seed events from the load's routing template. Looks up the template
    // (by id OR name fallback), resolves locations from the load, builds the
    // event plan via lib/routing-template-seed.js, and bulk-inserts the rows.
    if (action === 'seed_from_template') {
      // Fetch the load to get template id/name + location ids.
      // Uses `live_orders` view which auto-excludes soft-deleted rows.
      const { data: load, error: loadErr } = await svc
        .from('live_orders')
        .select('id, tenant_id, routing_template_id, routing_template_name, pickup_location_id, delivery_location_id, return_location_id')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .maybeSingle();
      if (loadErr || !load) {
        return res.status(404).json({ error: 'Load not found' });
      }

      // Resolve template: prefer id, fall back to name (handles cases where
      // the template ref was lost but the name is still on the load).
      let template = null;
      if (load.routing_template_id) {
        const { data } = await svc
          .from('routing_templates')
          .select('id, name, event_sequence')
          .eq('id', load.routing_template_id)
          .maybeSingle();
        template = data;
      }
      if (!template && load.routing_template_name) {
        const { data } = await svc
          .from('routing_templates')
          .select('id, name, event_sequence')
          .eq('name', load.routing_template_name)
          .eq('is_system', true)
          .maybeSingle();
        template = data;
      }
      if (!template) {
        return res.status(400).json({ error: 'No routing template linked to this load' });
      }

      const [pickupSnap, deliverySnap, returnSnap] = await Promise.all([
        snapshotLocation(svc, ctx.tenantId, load.pickup_location_id),
        snapshotLocation(svc, ctx.tenantId, load.delivery_location_id),
        snapshotLocation(svc, ctx.tenantId, load.return_location_id),
      ]);

      // Figure out the starting move + event sequence so we append cleanly
      const [{ data: existingMoves }, { data: existingEvents }] = await Promise.all([
        svc
          .from('order_container_moves')
          .select('sequence')
          .eq('tenant_id', ctx.tenantId)
          .eq('order_id', id)
          .order('sequence', { ascending: false })
          .limit(1),
        svc
          .from('order_routing_events')
          .select('sequence')
          .eq('tenant_id', ctx.tenantId)
          .eq('order_id', id)
          .order('sequence', { ascending: false })
          .limit(1),
      ]);
      const startMoveSeq = existingMoves?.length ? (existingMoves[0].sequence ?? 0) + 1 : 0;
      const startEventSeq = existingEvents?.length ? (existingEvents[0].sequence ?? 0) + 1 : 0;

      const { moves, events } = buildRoutingEventsForTemplate({
        template,
        load,
        locations: { pickup: pickupSnap, delivery: deliverySnap, return: returnSnap },
      });

      if (events.length === 0) {
        return res.status(400).json({ error: 'Template has no events to seed' });
      }

      // Insert moves first so we can resolve move_id by move_index
      let insertedMoves = [];
      if (moves.length > 0) {
        const { data: mRows, error: mErr } = await svc
          .from('order_container_moves')
          .insert(
            moves.map((m, i) => ({
              tenant_id: ctx.tenantId,
              order_id: id,
              sequence: startMoveSeq + i,
              move_type: m.move_type,
              status: m.status || 'pending',
            }))
          )
          .select('id, sequence');
        if (mErr) return res.status(500).json({ error: mErr.message });
        insertedMoves = mRows || [];
      }

      // Map move_index (local 0-based) -> move_id, accounting for startMoveSeq
      const moveIdByIndex = {};
      insertedMoves.forEach((m, i) => {
        moveIdByIndex[i] = m.id;
      });

      const eventRows = events.map((ev, i) => {
        const { move_index, ...rest } = ev;
        return {
          ...rest,
          sequence: startEventSeq + i,
          move_id: moveIdByIndex[move_index] || null,
          estimated_miles: null,
          distance_is_manual: false,
        };
      });

      const { error: insertErr } = await svc.from('order_routing_events').insert(eventRows);
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.routing_seed_from_template',
        entityType: 'order',
        entityId: id,
        newValues: { template: template.name, moves: insertedMoves.length, events: eventRows.length },
        ipAddress: getClientIp(req),
      });

      return res
        .status(201)
        .json({ moves: insertedMoves.length, events: eventRows.length, template: template.name });
    }

    // ================================================================
    // Reseed: atomically replace the load's routing with a fresh seed
    // from a new template. Used when a dispatcher switches templates
    // on a load that has no driver dispatched yet.
    //
    // Contract:
    //   1. Wipe all existing moves + events for this load
    //   2. Update the load's routing_template_id / routing_template_name
    //      to the new template
    //   3. Seed fresh events from the new template using the same
    //      logic as seed_from_template
    //
    // Safety: the frontend only exposes the template picker when
    // load.dispatched_at IS NULL, so in practice this action can never
    // destroy in-progress work. We ALSO enforce it server-side here
    // as a defensive belt-and-suspenders check.
    // ================================================================
    if (action === 'reseed_from_template') {
      if (!body.template_id) {
        return res.status(400).json({ error: 'template_id required' });
      }

      // Fetch the load + check dispatch state
      const { data: load, error: loadErr } = await svc
        .from('live_orders')
        .select(
          'id, tenant_id, dispatched_at, routing_template_id, routing_template_name, ' +
          'pickup_location_id, delivery_location_id, return_location_id'
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .maybeSingle();
      if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

      if (load.dispatched_at) {
        return res.status(409).json({
          error:
            'Cannot change routing template — this load is already dispatched. ' +
            'Remove the driver first to unlock the template picker.',
        });
      }

      // Resolve the new template
      const { data: template, error: tplErr } = await svc
        .from('routing_templates')
        .select('id, name, event_sequence')
        .eq('id', body.template_id)
        .maybeSingle();
      if (tplErr || !template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      // Defensive: if the load has any routing events with recorded
      // timestamps, refuse. This should be unreachable because the
      // dispatch check above catches the normal path, but some test
      // scenario could set timestamps without setting dispatched_at.
      const { data: touchedEvents } = await svc
        .from('order_routing_events')
        .select('id, arrived_at, departed_at')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id);
      const anyTouched = (touchedEvents || []).some(
        (e) => e.arrived_at || e.departed_at
      );
      if (anyTouched) {
        return res.status(409).json({
          error:
            'Cannot change routing template — this load has events with recorded ' +
            'timestamps. Clear progress first.',
        });
      }

      // Snapshot locations from the load for the seed
      const [pickupSnap, deliverySnap, returnSnap] = await Promise.all([
        snapshotLocation(svc, ctx.tenantId, load.pickup_location_id),
        snapshotLocation(svc, ctx.tenantId, load.delivery_location_id),
        snapshotLocation(svc, ctx.tenantId, load.return_location_id),
      ]);

      // Build the seed payload BEFORE we wipe, so we can fail cleanly
      // if the template is invalid and leave the existing data alone.
      const { moves, events } = buildRoutingEventsForTemplate({
        template,
        load,
        locations: { pickup: pickupSnap, delivery: deliverySnap, return: returnSnap },
      });

      if (events.length === 0) {
        return res.status(400).json({ error: 'Template has no events to seed' });
      }

      // Wipe existing moves (events cascade-delete via FK)
      const { error: delMovesErr } = await svc
        .from('order_container_moves')
        .delete()
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id);
      if (delMovesErr) return res.status(500).json({ error: delMovesErr.message });

      // Belt-and-suspenders: also wipe any orphaned events (in case the
      // FK cascade didn't catch any move-less rows)
      await svc
        .from('order_routing_events')
        .delete()
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id);

      // Insert new moves
      let insertedMoves = [];
      if (moves.length > 0) {
        const { data: mRows, error: mErr } = await svc
          .from('order_container_moves')
          .insert(
            moves.map((m, i) => ({
              tenant_id: ctx.tenantId,
              order_id: id,
              sequence: i,
              move_type: m.move_type,
              status: m.status || 'pending',
            }))
          )
          .select('id, sequence');
        if (mErr) return res.status(500).json({ error: mErr.message });
        insertedMoves = mRows || [];
      }

      const moveIdByIndex = {};
      insertedMoves.forEach((m, i) => {
        moveIdByIndex[i] = m.id;
      });

      // Insert new events
      const eventRows = events.map((ev, i) => {
        const { move_index, ...rest } = ev;
        return {
          ...rest,
          sequence: i,
          move_id: moveIdByIndex[move_index] || null,
          estimated_miles: null,
          distance_is_manual: false,
        };
      });
      const { error: evErr } = await svc
        .from('order_routing_events')
        .insert(eventRows);
      if (evErr) return res.status(500).json({ error: evErr.message });

      // Update the load's template reference
      await svc
        .from('orders')
        .update({
          routing_template_id: template.id,
          routing_template_name: template.name,
        })
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null);

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.routing_reseed_from_template',
        entityType: 'order',
        entityId: id,
        newValues: {
          template: template.name,
          moves: insertedMoves.length,
          events: eventRows.length,
        },
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({
        moves: insertedMoves.length,
        events: eventRows.length,
        template: template.name,
      });
    }

    // ================================================================
    // Verify Rail/Port Check-In Slip
    // ================================================================
    //
    // Marks the load as "Cleared for Rail Check-In" (or "Port Check-In"
    // for Export loads). The dispatcher clicks this AFTER the driver has
    // uploaded the BOL document and the dispatcher has compared each of
    // the 6 slip fields to the actual BOL.
    //
    // Validation gates (any failure → 409):
    //   - Load type must be 'outbound' or 'export'
    //   - All 6 slip fields must be populated:
    //       container_number, seal_number, piece_count,
    //       weight_lbs, customer_reference, final_delivery_location_id
    //   - At least one BOL document must be attached to the load
    //   - The slip must not already be verified (use unverify first)
    //
    // On success, sets rail_slip_verified_at = now() and
    // rail_slip_verified_by = ctx.userId. Logs an audit entry so the
    // timeline records who cleared the slip and when.
    // ================================================================
    if (action === 'verify_rail_slip') {
      const { data: load, error: loadErr } = await svc
        .from('orders')
        .select(
          'id, load_type, container_number, seal_number, piece_count, ' +
          'weight_lbs, customer_reference, final_delivery_location_id, ' +
          'rail_slip_verified_at'
        )
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

      // Gate 1: load type
      if (!['outbound', 'export'].includes(load.load_type)) {
        return res.status(409).json({
          error:
            'Rail/Port Check-In Slip is only available for Outbound and Export loads.',
        });
      }

      // Gate 2: all 6 fields populated
      const missing = [];
      if (!load.container_number) missing.push('Container #');
      if (!load.seal_number) missing.push('Seal #');
      if (load.piece_count == null) missing.push('Piece Count');
      if (load.weight_lbs == null) missing.push('Weight');
      if (!load.customer_reference) missing.push('Reference #');
      if (!load.final_delivery_location_id) missing.push('Final Delivery Location');
      if (missing.length > 0) {
        return res.status(409).json({
          error: `Cannot verify slip — missing required fields: ${missing.join(', ')}.`,
          missing_fields: missing,
        });
      }

      // Gate 3: at least one BOL document attached.
      // We check the order_documents table for any document tagged as
      // document_type='bol' OR with 'bol' in the file_name. The
      // dispatcher workflow uploads the actual paper BOL the driver
      // scanned in. (Schema: order_documents.document_type + file_name.)
      const { data: bolDocs } = await svc
        .from('order_documents')
        .select('id, document_type, file_name')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id);
      const hasBol = (bolDocs || []).some(
        (d) =>
          d.document_type === 'bol' ||
          (d.file_name || '').toLowerCase().includes('bol')
      );
      if (!hasBol) {
        return res.status(409).json({
          error:
            'Cannot verify slip — no BOL document attached. Driver must upload the BOL first, then dispatcher can verify against the prenote.',
        });
      }

      // Gate 4: not already verified
      if (load.rail_slip_verified_at) {
        return res.status(409).json({
          error: 'Slip is already verified. Use unverify_rail_slip to clear it first.',
        });
      }

      // All gates passed — verify
      const now = new Date().toISOString();
      const { data: updated, error: updateErr } = await svc
        .from('orders')
        .update({
          rail_slip_verified_at: now,
          rail_slip_verified_by: ctx.userId,
        })
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .select('rail_slip_verified_at, rail_slip_verified_by')
        .single();
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.rail_slip_verified',
        entityType: 'order',
        entityId: id,
        newValues: {
          rail_slip_verified_at: now,
          load_type: load.load_type,
        },
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ verified: true, ...updated });
    }

    // ================================================================
    // Unverify Rail/Port Check-In Slip
    // ================================================================
    //
    // Manually clears the verification. Used when the dispatcher made
    // a mistake or wants to re-verify after editing a field. The
    // automatic cascade in the loads PUT handler clears verification
    // when fields change, so this manual action is mostly for the
    // "I changed my mind" case.
    // ================================================================
    if (action === 'unverify_rail_slip') {
      const { data: load } = await svc
        .from('orders')
        .select('rail_slip_verified_at, load_type')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (!load) return res.status(404).json({ error: 'Load not found' });

      if (!load.rail_slip_verified_at) {
        return res.status(200).json({ verified: false });
      }

      const { error: updateErr } = await svc
        .from('orders')
        .update({
          rail_slip_verified_at: null,
          rail_slip_verified_by: null,
        })
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null);
      if (updateErr) return res.status(500).json({ error: updateErr.message });

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.rail_slip_unverified',
        entityType: 'order',
        entityId: id,
        oldValues: { rail_slip_verified_at: load.rail_slip_verified_at },
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ verified: false });
    }

    // Start a move — sets started_at + status='in_progress'
    if (action === 'start_move') {
      if (!body.move_id) return res.status(400).json({ error: 'move_id required' });
      try {
        const { row } = await transitionMoveStatus(svc, {
          tenantId: ctx.tenantId,
          moveId: body.move_id,
          newStatus: 'in_progress',
          actorUserId: ctx.userId,
          extraFields: { started_at: new Date().toISOString() },
        });
        return res.status(200).json({ move: row });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Complete a single move
    if (action === 'complete_move') {
      if (!body.move_id) return res.status(400).json({ error: 'move_id required' });
      try {
        const { row } = await transitionMoveStatus(svc, {
          tenantId: ctx.tenantId,
          moveId: body.move_id,
          newStatus: 'completed',
          actorUserId: ctx.userId,
          extraFields: { completed_at: new Date().toISOString() },
        });
        return res.status(200).json({ move: row });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // Complete the whole load — mark every move completed + order delivered
    //
    // IMPORTANT: only complete moves that have actually been STARTED. A move
    // with no started_at (i.e. no driver has begun it) should NOT get
    // completed_at set, because that creates phantom "completed" state that
    // can't be undone by uncomplete_load (which historically only reopened
    // moves with started_at != null, leaving empty moves stuck in an
    // impossible state where status='completed' but the move never happened).
    if (action === 'complete_load') {
      const now = new Date().toISOString();

      // Fetch eligible moves first, then loop-serial through the helper so
      // each move transition gets a history row. Eligible = started_at set
      // AND not yet completed.
      const { data: eligibleMoves } = await svc
        .from('order_container_moves')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .is('completed_at', null)
        .not('started_at', 'is', null);

      // Pre-refactor this was a single bulk UPDATE — atomic. Now it's a serial loop.
      // Partial failure is self-healing: retry will skip already-completed moves via
      // the `is('completed_at', null)` filter. But the in-flight state is visible to
      // concurrent readers mid-loop. Acceptable for complete_load (user action, not
      // hot path).
      for (const { id: moveId } of (eligibleMoves || [])) {
        await transitionMoveStatus(svc, {
          tenantId: ctx.tenantId,
          moveId,
          newStatus: 'completed',
          actorUserId: ctx.userId,
          extraFields: { completed_at: now },
        });
      }

      // Fetch current order status BEFORE the update so we can pass it
      // to fireOrderStatusChangeTriggers (which writes order_status_history
      // + fires any active status triggers). Closes FU-071.
      const { data: currentOrder, error: fetchErr } = await svc
        .from('orders')
        .select('status')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (fetchErr || !currentOrder) {
        return res.status(404).json({ error: 'Load not found or deleted' });
      }
      const oldOrderStatus = currentOrder.status;

      const { data: order, error: orderErr } = await svc
        .from('orders')
        .update({ status: 'completed', actual_delivery_at: now })
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .select()
        .single();
      if (orderErr) return res.status(500).json({ error: orderErr.message });

      // Closes FU-071: route through the wrapper so the transition writes
      // to order_status_history and fires email triggers (delayed + immediate).
      // Fire-and-forget — does not block the response.
      try {
        await fireOrderStatusChangeTriggers(svc, {
          tenantId: ctx.tenantId,
          loadId: id,
          oldStatus: oldOrderStatus,
          newStatus: 'completed',
          userId: ctx.userId,
        });
      } catch (e) {
        console.error(`complete_load order trigger fire failed for ${id}:`, e?.message || e);
      }

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.complete',
        entityType: 'order',
        entityId: id,
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ order });
    }

    // Uncomplete / reopen a load
    if (action === 'uncomplete_load') {
      // Revert to pending_completion (all events still departed) rather
      // than in_transit. The routing read-repair will naturally re-derive
      // the correct status on the next GET based on the actual event state.
      const { data: currentOrder, error: fetchErr } = await svc
        .from('orders')
        .select('status')
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .maybeSingle();
      if (fetchErr || !currentOrder) {
        return res.status(404).json({ error: 'Load not found or deleted' });
      }
      const oldOrderStatus = currentOrder.status;

      const { data: order, error: orderErr } = await svc
        .from('orders')
        .update({ status: 'pending_completion', actual_delivery_at: null })
        .eq('tenant_id', ctx.tenantId)
        .eq('id', id)
        .is('deleted_at', null)
        .select()
        .single();
      if (orderErr) return res.status(500).json({ error: orderErr.message });

      // Closes FU-071 (second site).
      try {
        await fireOrderStatusChangeTriggers(svc, {
          tenantId: ctx.tenantId,
          loadId: id,
          oldStatus: oldOrderStatus,
          newStatus: 'pending_completion',
          userId: ctx.userId,
        });
      } catch (e) {
        console.error(`uncomplete_load order trigger fire failed for ${id}:`, e?.message || e);
      }

      // Reopen any completed moves. We do this in two passes:
      //   1. Moves that WERE started → revert to 'in_progress'
      //   2. Moves that were never started but somehow got completed (e.g.
      //      from the old complete_load bug that stamped every move) →
      //      revert to 'pending' so they don't show a bogus "completed" pill.
      //
      // Now routed through transitionMoveStatus per move so each reopen
      // writes a history row.

      // Pass 1: started + completed moves → in_progress
      const { data: startedCompletedMoves } = await svc
        .from('order_container_moves')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .not('started_at', 'is', null)
        .not('completed_at', 'is', null);

      // Pre-refactor this was two bulk UPDATEs — each atomic. Now two serial loops.
      // Retry behavior: on partial failure, the next uncomplete_load retry will skip
      // already-reverted moves via the `is('completed_at', not null)` filter, so it's
      // self-healing.
      for (const { id: moveId } of (startedCompletedMoves || [])) {
        await transitionMoveStatus(svc, {
          tenantId: ctx.tenantId,
          moveId,
          newStatus: 'in_progress',
          actorUserId: ctx.userId,
          extraFields: { completed_at: null },
        });
        // FU-081: revert events that the prior complete_load cascaded to
        // 'departed'. Runs AFTER the move's own status is reverted per
        // spec. Uses history to identify pre-cascade state and skips
        // events that weren't cascaded.
        try {
          await revertCascadedEventsForMove({
            supabase: svc,
            tenantId: ctx.tenantId,
            moveId,
            actor: {
              id: ctx.userId ?? null,
              type: 'system',
              context: { reason: 'uncomplete_load', loadId: id },
            },
          });
        } catch (e) {
          console.error(`uncomplete_load revert cascade failed for move ${moveId}:`, e?.message || e);
        }
      }

      // Pass 2: unstarted + completed moves → pending (cleanup for old bug)
      const { data: unstartedCompletedMoves } = await svc
        .from('order_container_moves')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('order_id', id)
        .is('started_at', null)
        .not('completed_at', 'is', null);

      for (const { id: moveId } of (unstartedCompletedMoves || [])) {
        await transitionMoveStatus(svc, {
          tenantId: ctx.tenantId,
          moveId,
          newStatus: 'pending',
          actorUserId: ctx.userId,
          extraFields: { completed_at: null },
        });
        // FU-081: revert events that the prior complete_load cascaded to
        // 'departed' (see comment on Pass 1 above). An unstarted-but-
        // completed move from the old bug usually has no cascaded events,
        // but the revert is a no-op in that case (skips events with no
        // cascade history rows) so it's safe to call unconditionally.
        try {
          await revertCascadedEventsForMove({
            supabase: svc,
            tenantId: ctx.tenantId,
            moveId,
            actor: {
              id: ctx.userId ?? null,
              type: 'system',
              context: { reason: 'uncomplete_load', loadId: id },
            },
          });
        } catch (e) {
          console.error(`uncomplete_load revert cascade failed for move ${moveId}:`, e?.message || e);
        }
      }

      await logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.uncomplete',
        entityType: 'order',
        entityId: id,
        ipAddress: getClientIp(req),
      });

      return res.status(200).json({ order });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
