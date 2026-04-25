import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS, hasPermission } from '../../../../lib/permissions';
import { buildRoutingEventsForTemplate } from '../../../../lib/routing-template-seed';
import { computeKpiStats } from '../../../../lib/kpi-engine';
import { findMatchingCharges, applyChargesToLoad } from '../../../../lib/tariff-engine';
import { applyBranchFilter } from '../../../../lib/branch-filter';
import { fetchLoadMarginInputs, computeLoadMargin } from '../../../../lib/load-margin';
import { LOAD_TYPE_LETTER } from '../../../../lib/constants/load-types.js';
import { validateLoadPayload } from '../../../../lib/validation/load-payload.js';

const VALID_STATUSES = ['pending', 'available', 'dispatched', 'in_transit', 'dropped', 'delivered', 'completed', 'cancelled'];
// VALID_STATUSES consolidation is a separate FU — stays here for now.

async function generateOrderNumber(svc, tenantId, loadType) {
  // Fetch tenant settings — prefer SCAC code, fall back to legacy order_prefix, then "ORD"
  const { data: settings } = await svc
    .from('tenant_settings')
    .select('order_prefix, scac_code')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const prefix =
    (settings?.scac_code && settings.scac_code.trim()) ||
    settings?.order_prefix ||
    'ORD';

  const typeLetter = LOAD_TYPE_LETTER[loadType] || 'M';

  // Global counter per tenant — never resets by year. Every load gets a unique
  // sequence number regardless of type.
  const { count } = await svc
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);

  const seq = String((count || 0) + 1).padStart(6, '0');
  return `${prefix}-${typeLetter}${seq}`;
}

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

    const {
      status,
      customer_id,
      driver_id,
      load_type,
      from,
      to,
      search,
      // New 5b-3 filters
      hazmat,
      overweight,
      overheight,
      reefer,
      hot,
      genset,
      scale,
      ev,
      street_turn,
      oog,
      bonded,
      double: isDouble,
      tanker,
      liquor,
      container_type,
      container_size,
      steamship_line,
      chassis_type,
      chassis_owner,
      csr_user_id,
      terminal_status,
      pickup_location_id,
      delivery_location_id,
      return_location_id,
      active_only,
    } = req.query;

    let query = svc
      .from('orders')
      .select(
        `
        *,
        customer:customers!orders_customer_id_fkey(id, name),
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, city, state),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, city, state),
        return_org:customers!orders_return_location_id_fkey(id, name, city, state),
        final_delivery_org:customers!orders_final_delivery_location_id_fkey(id, name, city, state),
        driver:drivers(id, first_name, last_name, name),
        csr:users!orders_csr_user_id_fkey(id, name, email),
        container_owner:container_owners(id, name, label, scac_code),
        branch:branches(id, name, code),
        holds:order_holds(hold_type, status),
        routing_events:order_routing_events(
          id, sequence, event_type, location_id, location_name, city, state,
          arrived_at, departed_at, move_id,
          move:order_container_moves!move_id(driver_id, started_at),
          location:customers!location_id(id, customer_types)
        )
      `
      )
      .eq('tenant_id', ctx.tenantId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    // Branch filtering — scoped users see only their branch data + unassigned
    query = applyBranchFilter(query, ctx);

    // Explicit branch filter from query params (admin use)
    const { branch_id } = req.query;
    if (branch_id) query = query.eq('branch_id', branch_id);

    if (status) query = query.eq('status', status);
    if (customer_id) query = query.eq('customer_id', customer_id);
    if (driver_id) query = query.eq('driver_id', driver_id);
    if (load_type) query = query.eq('load_type', load_type);
    if (pickup_location_id) query = query.eq('pickup_location_id', pickup_location_id);
    if (delivery_location_id) query = query.eq('delivery_location_id', delivery_location_id);
    if (return_location_id) query = query.eq('return_location_id', return_location_id);
    if (csr_user_id) query = query.eq('csr_user_id', csr_user_id);
    if (container_type) query = query.eq('container_type', container_type);
    if (container_size) query = query.eq('container_size', container_size);
    if (steamship_line) query = query.eq('steamship_line', steamship_line);
    if (chassis_type) query = query.eq('chassis_type', chassis_type);
    if (chassis_owner) query = query.eq('chassis_owner', chassis_owner);
    if (terminal_status) query = query.eq('terminal_status', terminal_status);
    if (from) query = query.gte('pickup_date', from);
    if (to) query = query.lte('pickup_date', to);

    // Flag boolean filters
    if (hazmat === 'true') query = query.eq('is_hazmat', true);
    if (overweight === 'true') query = query.eq('is_overweight', true);
    if (overheight === 'true') query = query.eq('is_overheight', true);
    if (reefer === 'true') query = query.eq('container_type', 'reefer');
    if (hot === 'true') query = query.eq('is_hot', true);
    if (genset === 'true') query = query.eq('is_genset', true);
    if (scale === 'true') query = query.eq('is_scale', true);
    if (ev === 'true') query = query.eq('is_ev', true);
    if (street_turn === 'true') query = query.eq('is_street_turn', true);
    if (oog === 'true') query = query.eq('is_oog', true);
    if (bonded === 'true') query = query.eq('is_bonded', true);
    if (isDouble === 'true') query = query.eq('is_double', true);
    if (tanker === 'true') query = query.eq('is_tanker', true);
    if (liquor === 'true') query = query.eq('is_liquor', true);

    if (search) {
      // Support comma-separated multi-term search (e.g. paste from the bulk-bar
      // Copy Container output: "MSDU1234, MSDU5678, ..."). Without splitting,
      // commas inside the search value collide with PostgREST's OR-clause
      // separator and produce a "failed to parse logic tree" 400.
      const terms = search.split(',').map((s) => s.trim()).filter(Boolean);
      const fields = ['order_number', 'container_number', 'bill_of_lading', 'booking_number', 'house_bol'];
      const clauses = [];
      for (const term of terms) {
        for (const f of fields) {
          clauses.push(`${f}.ilike.%${term}%`);
        }
      }
      if (clauses.length > 0) {
        query = query.or(clauses.join(','));
      }
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Derive has_unresolved_distance: any AR charge line OR AP driver-pay line
    // with needs_distance=true AND a null amount. Two flat queries + set lookup
    // avoids bloating the main SELECT with more nested arrays.
    const orderIds = data.map((l) => l.id);
    let unresolvedDistanceOrderIds = new Set();
    if (orderIds.length > 0) {
      const [{ data: arRows }, { data: apRows }] = await Promise.all([
        svc
          .from('order_charge_set_line_items')
          .select('order_charge_sets!inner(order_id)')
          .eq('tenant_id', ctx.tenantId)
          .eq('needs_distance', true)
          .is('total_cents', null)
          .in('order_charge_sets.order_id', orderIds),
        svc
          .from('order_driver_pay_lines')
          .select('order_id')
          .eq('tenant_id', ctx.tenantId)
          .eq('needs_distance', true)
          .is('amount_cents', null)
          .in('order_id', orderIds),
      ]);
      for (const r of arRows || []) {
        const orderId = r.order_charge_sets?.order_id;
        if (orderId) unresolvedDistanceOrderIds.add(orderId);
      }
      for (const r of apRows || []) {
        if (r.order_id) unresolvedDistanceOrderIds.add(r.order_id);
      }
    }

    // Fetch all order_notes for these orders in one shot, then group into notes_by_audience per load
    let notesByOrder = {};
    if (orderIds.length > 0) {
      const { data: notesData } = await svc
        .from('order_notes')
        .select('order_id, audience, body, created_at')
        .eq('tenant_id', ctx.tenantId)
        .in('order_id', orderIds)
        .order('created_at', { ascending: false });
      for (const n of notesData || []) {
        if (!notesByOrder[n.order_id]) notesByOrder[n.order_id] = {};
        // Keep only the most recent note per audience
        if (!notesByOrder[n.order_id][n.audience]) {
          notesByOrder[n.order_id][n.audience] = n.body;
        }
      }
    }

    // Post-process each load: derive current_event + attach notes_by_audience + distance flag
    for (const load of data) {
      // Sort routing_events by sequence, pick the first incomplete (no departed_at)
      const events = (load.routing_events || []).slice().sort((a, b) => a.sequence - b.sequence);
      load.current_event = events.find((e) => !e.departed_at) || null;
      load.notes_by_audience = notesByOrder[load.id] || {};
      load.has_unresolved_distance = unresolvedDistanceOrderIds.has(load.id);
    }

    // KPI stats — computed by the engine using the universal date filter.
    // Per the canonical spec, Finished Today is now load-based (not move-based),
    // so the engine handles it directly with no API-side override.
    const dateFilter = req.query.date_filter || 'all';
    const stats = computeKpiStats(data, dateFilter);
    stats.total = data.length;

    // Pending document validation: count distinct loads with at least one
    // 'received' submission. Also return the order IDs so the board can
    // filter to those loads when the KPI card is clicked.
    let pendingDocOrderIds = [];
    try {
      const { data: pendingRows } = await svc
        .from('document_submissions')
        .select('order_id')
        .eq('tenant_id', ctx.tenantId)
        .eq('status', 'received');
      pendingDocOrderIds = [
        ...new Set((pendingRows || []).map((r) => r.order_id).filter(Boolean)),
      ];
      stats.pending_docs = pendingDocOrderIds.length;
    } catch {
      stats.pending_docs = 0;
    }

    // active_only=true: hide completed + cancelled loads from the dispatcher
    // board's main grid. Stats + KPIs are computed BEFORE this filter so the
    // "Finished Today" KPI card still reports today's completions accurately.
    // Per user policy: completed loads belong in the billing/AR section, not
    // on the active dispatch board.
    const visibleLoads =
      active_only === 'true'
        ? data.filter((l) => l.status !== 'completed' && l.status !== 'cancelled')
        : data;

    // Attach margin per row for users with AR/reporting access.
    // Uses the full `data` set (before active_only filter) so every row in
    // visibleLoads already has .margin when it reaches the client.
    if (data.length > 0 && hasPermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.REPORTING])) {
      try {
        const { data: tenant, error: tErr } = await svc
          .from('tenants')
          .select('margin_red_threshold, margin_yellow_threshold, margin_include_dry_runs')
          .eq('id', ctx.tenantId)
          .single();
        if (!tErr && tenant) {
          const inputs = await fetchLoadMarginInputs(svc, {
            tenantId: ctx.tenantId,
            orderIds: data.map((r) => r.id),
            includeDryRuns: tenant.margin_include_dry_runs,
          });
          for (const row of data) {
            const { revenueCents, costCents } = inputs.get(row.id) ?? { revenueCents: 0, costCents: 0 };
            row.margin = computeLoadMargin({
              revenueCents,
              costCents,
              redThreshold:    Number(tenant.margin_red_threshold),
              yellowThreshold: Number(tenant.margin_yellow_threshold),
            });
          }
        }
      } catch (err) {
        // Non-fatal — if margin attach fails, log and continue. The loads
        // list is still usable without the margin field.
        console.error('loads list margin attach failed', err);
      }
    }

    return res.status(200).json({ loads: visibleLoads, stats, pendingDocOrderIds });
  }

  if (req.method === 'POST') {
    if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

    const body = req.body || {};
    if (!body.customer_id) {
      return res.status(400).json({ error: 'Customer is required' });
    }

    // Validate load_type + load_type-specific required fields (e.g. chassis
    // locations for chassis_reposition). Single source of truth lives in
    // lib/validation/load-payload.js so POST + PUT stay in sync.
    // Default to 'import' when omitted so the validator sees a known type.
    const effectivePayload = { ...body, load_type: body.load_type || 'import' };
    const validation = validateLoadPayload(effectivePayload);
    if (!validation.ok) {
      return res
        .status(400)
        .json({ error: validation.error, step: 'validate_load_payload' });
    }

    const loadType = effectivePayload.load_type;

    // Auto-generate order_number — format: {SCAC}-{TYPE}{SEQ}
    const orderNumber = await generateOrderNumber(svc, ctx.tenantId, loadType);

    // Snapshot location addresses from linked orgs
    const pickupSnap = await snapshotLocation(svc, ctx.tenantId, body.pickup_location_id);
    const deliverySnap = await snapshotLocation(svc, ctx.tenantId, body.delivery_location_id);
    const returnSnap = await snapshotLocation(svc, ctx.tenantId, body.return_location_id);

    const insertData = {
      tenant_id: ctx.tenantId,
      order_number: orderNumber,
      customer_id: body.customer_id,
      status: 'pending',
      load_type: loadType,
      is_bill_only: loadType === 'bill_only',
      routing_template_id: body.routing_template_id || null,
      routing_template_name: body.routing_template_name || null,
      pickup_location_id: body.pickup_location_id || null,
      delivery_location_id: body.delivery_location_id || null,
      return_location_id: body.return_location_id || null,
      final_delivery_location_id: body.final_delivery_location_id || null,
      // Chassis location fields (migration 065). Required by validator for
      // chassis_reposition load type; optional for others (chassis split).
      hook_chassis_location_id: body.hook_chassis_location_id || null,
      terminate_chassis_location_id: body.terminate_chassis_location_id || null,
      // Snapshot pickup → origin_*
      origin_address: pickupSnap.address_line1 || null,
      origin_city: pickupSnap.city || null,
      origin_state: pickupSnap.state || null,
      origin_zip: pickupSnap.zip || null,
      // Snapshot delivery → destination_*
      destination_address: deliverySnap.address_line1 || null,
      destination_city: deliverySnap.city || null,
      destination_state: deliverySnap.state || null,
      destination_zip: deliverySnap.zip || null,
      // Core fields from body
      container_number: body.container_number || null,
      container_size: body.container_size || null,
      container_size_id: body.container_size_id || null,
      seal_number: body.seal_number || null,
      pickup_date: body.pickup_date || null,
      delivery_date: body.delivery_date || null,
      bill_of_lading: body.bill_of_lading || null,
      booking_number: body.booking_number || null,
      created_by: ctx.userId,
      // Branch: explicit from body, or auto-assign if user has exactly one branch
      branch_id: body.branch_id || (ctx.branchIds?.length === 1 ? ctx.branchIds[0] : null),
    };

    const { data, error } = await svc.from('orders').insert(insertData).select().single();

    if (error) return res.status(500).json({ error: error.message });

    // Seed 6 default hold rows (all "released")
    const holdTypes = ['freight', 'custom', 'terminal', 'fees_storage', 'carrier', 'other'];
    await svc.from('order_holds').insert(
      holdTypes.map((ht) => ({
        tenant_id: ctx.tenantId,
        order_id: data.id,
        hold_type: ht,
        status: 'released',
      }))
    );

    // Auto-seed Container Moves + routing events from the selected template.
    // The seeder returns { moves, events } — we insert moves first (so each
    // gets an id), then insert events with `move_id` wired from `move_index`.
    if (body.routing_template_id) {
      const { data: template } = await svc
        .from('routing_templates')
        .select('id, name, event_sequence')
        .eq('id', body.routing_template_id)
        .maybeSingle();

      if (template) {
        const { moves, events } = buildRoutingEventsForTemplate({
          template,
          load: data,
          locations: {
            pickup: pickupSnap,
            delivery: deliverySnap,
            return: returnSnap,
          },
        });

        let insertedMoves = [];
        if (moves.length > 0) {
          const { data: mRows } = await svc
            .from('order_container_moves')
            .insert(
              moves.map((m) => ({
                tenant_id: ctx.tenantId,
                order_id: data.id,
                sequence: m.sequence,
                move_type: m.move_type,
                status: m.status || 'pending',
              }))
            )
            .select('id, sequence');
          insertedMoves = mRows || [];
        }

        if (events.length > 0 && insertedMoves.length > 0) {
          // Map move_index -> move_id
          const moveIdByIndex = {};
          for (const m of insertedMoves) moveIdByIndex[m.sequence] = m.id;

          const rows = events.map((ev) => {
            const { move_index, ...rest } = ev;
            return { ...rest, move_id: moveIdByIndex[move_index] || null };
          });
          await svc.from('order_routing_events').insert(rows);
        }
      }
    }

    // ── Auto-apply tariff charges to billing ──────────────
    try {
      const charges = await findMatchingCharges(svc, data, ctx.tenantId);
      if (charges.length > 0) {
        await applyChargesToLoad(svc, data.id, ctx.tenantId, charges);
        // Log as "System" action
        await logTenantAction(svc, {
          tenantId: ctx.tenantId,
          userId: null, // null = System
          action: 'billing.auto_apply',
          entityType: 'order',
          entityId: data.id,
          newValues: {
            charges_applied: charges.length,
            tariffs: [...new Set(charges.filter((c) => c.tariff_name).map((c) => c.tariff_name))],
            profiles: charges.map((c) => c.name),
          },
          ipAddress: 'system',
        });
      }
    } catch (e) {
      // Don't fail load creation if tariff engine errors
      console.error('Tariff auto-apply error:', e.message);
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'load.create',
      entityType: 'order',
      entityId: data.id,
      newValues: {
        order_number: data.order_number,
        customer_id: data.customer_id,
        load_type: data.load_type,
      },
      ipAddress: getClientIp(req),
    });

    // Auto-apply tariff charges on new load creation (fire-and-forget)
    findMatchingCharges(svc, data, ctx.tenantId)
      .then((charges) => {
        if (charges.length > 0) return applyChargesToLoad(svc, data.id, ctx.tenantId, charges);
      })
      .catch((e) => console.error('tariff auto-apply on create error:', e));

    return res.status(201).json({ load: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
