import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { findMatchingDriverCharges, applyDriverPayToLoad } from '../../../../../lib/driver-tariff-engine';
import { evaluateConditions } from '../../../../../lib/condition-evaluator';
import { formatDuration, formatPounds, formatMiles } from '../../../../../lib/pricing-uom';

/**
 * POST /api/tenant/loads/[id]/recalculate-driver-pay
 *
 * Re-runs the driver tariff matching engine against the current load + assigned
 * driver. Returns a diagnostic report (why each tariff matched or didn't) in
 * addition to applying matched pay lines. Manual lines are preserved — same
 * "replace auto, keep manual" policy as the AR recalculate endpoint.
 *
 * The diagnostic report is the whole point of this endpoint existing: the
 * auto-apply hook on the PUT /loads/[id] path fires only once per driver
 * assignment change and gives zero feedback. When pay doesn't populate, you
 * need this endpoint to tell you whether it's a "no driver assigned," a
 * "tariff didn't match" (and why), or a "tariff matched but produced 0" case.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Nest pickup/delivery/return org names so the diagnostic can show the
  // human label ("UP - HUTCHINS") instead of a UUID — the panel is shown
  // during customer conversations and raw uuids there are ugly and leak
  // internal ids. Nested as aliases so the engine still sees the flat
  // *_location_id fields it matches on.
  const { data: load, error: loadErr } = await svc
    .from('live_orders')
    .select(`
      *,
      pickup_org:customers!pickup_location_id(id, name),
      delivery_org:customers!delivery_location_id(id, name),
      return_org:customers!return_location_id(id, name)
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .single();

  if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

  // Hydrate routing events on the load. The condition evaluator's
  // 'dropped' field (Before Delivery / After Delivery rule) needs these
  // to resolve; without them the evaluator returns '' and any_in fails
  // silently. live_orders is a view so we can't rely on PostgREST FK
  // embedding — do a separate query instead. Done here (not only in
  // the engine) so the auto_add diagnostic further down can evaluate
  // profile conditions the same way the engine will.
  const { data: routingEvents } = await svc
    .from('order_routing_events')
    .select('id, event_type, arrived_at, departed_at, sequence, location_id, city, state, zip')
    .eq('tenant_id', ctx.tenantId)
    .eq('order_id', id)
    .order('sequence', { ascending: true });
  load.routing_events = routingEvents || [];

  if (!load.driver_id) {
    return res.status(200).json({
      success: false,
      applied: 0,
      reason: 'no_driver',
      message: 'No driver assigned to this load — nothing to calculate.',
    });
  }

  const diag = await diagnoseDriverTariffMatch(svc, load, load.driver_id, ctx.tenantId);

  const charges = await findMatchingDriverCharges(svc, load, load.driver_id, ctx.tenantId);

  if (charges.length > 0) {
    await applyDriverPayToLoad(svc, id, load.driver_id, ctx.tenantId, charges);
  }

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'load.recalculate_driver_pay',
    entityType: 'order',
    entityId: id,
    newValues: { charges_applied: charges.length, winning_tariff: diag.winning_tariff_name },
    ipAddress: getClientIp(req),
  });

  return res.status(200).json({
    success: true,
    applied: charges.length,
    charges: charges.map((c) => ({
      name: c.name,
      charge_name: c.charge_name,
      unit_of_measure: c.unit_of_measure,
      amount_cents: c.amount_cents,
      minimum_amount_cents: c.minimum_amount_cents,
      source: c.source,
      // Diagnostic trace: tier_id tells the UI which rate row resolved,
      // duration_seconds + duration_label lets it explain time-based
      // charges (e.g. "Detention: 3h 30m × $75/hr = $262.50").
      tier_id: c.tier_id || null,
      duration_seconds: c.duration_seconds || 0,
      duration_label: c.duration_seconds ? formatDuration(c.duration_seconds) : null,
      pounds: c.pounds || 0,
      pounds_label: c.pounds ? formatPounds(c.pounds) : null,
      miles: c.miles || 0,
      miles_label: c.miles ? formatMiles(c.miles) : null,
      radius_bracket_index: c.radius_bracket_index ?? null,
    })),
    diagnostic: diag,
    message: charges.length > 0
      ? `${charges.length} driver pay line${charges.length !== 1 ? 's' : ''} generated`
      : 'No matching driver charges — see diagnostic for reason',
  });
}

/**
 * Build a readable trace of why each tariff matched or didn't. Returns a
 * shape the UI can display verbatim (tariff name + list of check results).
 */
async function diagnoseDriverTariffMatch(svc, load, driverId, tenantId) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: memberships } = await svc
    .from('driver_group_members')
    .select('driver_group_id, driver_groups(name)')
    .eq('driver_id', driverId)
    .eq('tenant_id', tenantId);

  const driverGroupIds = (memberships || []).map((m) => m.driver_group_id);
  const driverGroupNames = (memberships || []).map((m) => m.driver_groups?.name).filter(Boolean);

  // Only consider tariffs the user can actually see in Settings. Soft-deleted
  // rows (is_enabled=false) stay in the table for audit purposes but are
  // hidden from the UI — showing them here would confuse the user ("why are
  // these tariffs I can't even find listed as failing matches?").
  const { data: allTariffs } = await svc
    .from('driver_tariffs')
    .select('id, name, status, is_enabled, effective_start, effective_end, driver_group_id, load_types, pickup_conditions, delivery_conditions, return_conditions, container_type, container_size, is_hazmat, is_overweight, is_overheight, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker, is_liquor, priority')
    .eq('tenant_id', tenantId)
    .eq('is_enabled', true);

  const tariffResults = [];
  for (const t of allTariffs || []) {
    const checks = [];
    let matched = true;

    if (t.status !== 'active') { checks.push({ check: 'status', pass: false, detail: `status = "${t.status}" (must be "active")` }); matched = false; }
    else checks.push({ check: 'status', pass: true });

    if (t.effective_start && t.effective_start > today) { checks.push({ check: 'date_range', pass: false, detail: `starts ${t.effective_start}, today is ${today}` }); matched = false; }
    else if (t.effective_end && t.effective_end < today) { checks.push({ check: 'date_range', pass: false, detail: `ended ${t.effective_end}, today is ${today}` }); matched = false; }
    else checks.push({ check: 'date_range', pass: true });

    if (t.driver_group_id && !driverGroupIds.includes(t.driver_group_id)) {
      checks.push({ check: 'driver_group', pass: false, detail: `tariff requires specific group; driver is in [${driverGroupNames.join(', ') || 'none'}]` });
      matched = false;
    } else checks.push({ check: 'driver_group', pass: true, detail: t.driver_group_id ? 'matched' : 'all driver groups' });

    if (t.load_types?.length > 0) {
      const lt = (load.load_type || '').toLowerCase();
      if (!t.load_types.map((x) => x.toLowerCase()).includes(lt)) {
        checks.push({ check: 'load_type', pass: false, detail: `load is "${lt}", tariff allows [${t.load_types.join(', ')}]` });
        matched = false;
      } else checks.push({ check: 'load_type', pass: true, detail: lt });
    } else checks.push({ check: 'load_type', pass: true, detail: 'all load types' });

    // For the failure detail, prefer the nested org name over the raw
    // UUID so the message reads naturally ('load pickup = "UP - HUTCHINS"'
    // not 'load pickup_location_id = "0163ce6c-…"'). The tariff's
    // `labels` map (saved when the user picked the org) gives us names
    // for the expected side.
    const pickupName = load.pickup_org?.name || load.pickup_location_id || '(empty)';
    const deliveryName = load.delivery_org?.name || load.delivery_location_id || '(empty)';
    const returnName = load.return_org?.name || load.return_location_id || '(empty)';

    if (t.pickup_conditions && !t.pickup_conditions.all && t.pickup_conditions.ids?.length > 0) {
      if (!t.pickup_conditions.ids.includes(load.pickup_location_id)) {
        const expected = t.pickup_conditions.ids.map((uid) => t.pickup_conditions.labels?.[uid] || uid).join(', ');
        checks.push({ check: 'pickup_location', pass: false, detail: `load pickup = "${pickupName}", tariff requires [${expected}]` });
        matched = false;
      } else checks.push({ check: 'pickup_location', pass: true, detail: pickupName });
    } else checks.push({ check: 'pickup_location', pass: true, detail: 'all pickup locations' });

    if (t.delivery_conditions && !t.delivery_conditions.all && t.delivery_conditions.ids?.length > 0) {
      if (!t.delivery_conditions.ids.includes(load.delivery_location_id)) {
        const expected = t.delivery_conditions.ids.map((uid) => t.delivery_conditions.labels?.[uid] || uid).join(', ');
        checks.push({ check: 'delivery_location', pass: false, detail: `load delivery = "${deliveryName}", tariff requires [${expected}]` });
        matched = false;
      } else checks.push({ check: 'delivery_location', pass: true, detail: deliveryName });
    } else checks.push({ check: 'delivery_location', pass: true, detail: 'all delivery locations' });

    if (t.return_conditions && !t.return_conditions.all && t.return_conditions.ids?.length > 0) {
      if (!t.return_conditions.ids.includes(load.return_location_id)) {
        const expected = t.return_conditions.ids.map((uid) => t.return_conditions.labels?.[uid] || uid).join(', ');
        checks.push({ check: 'return_location', pass: false, detail: `load return = "${returnName}", tariff requires [${expected}]` });
        matched = false;
      } else checks.push({ check: 'return_location', pass: true, detail: returnName });
    } else checks.push({ check: 'return_location', pass: true, detail: 'all return locations' });

    if (t.container_type && t.container_type !== load.container_type) {
      checks.push({ check: 'container_type', pass: false, detail: `load = "${load.container_type || '(empty)'}", tariff requires "${t.container_type}"` });
      matched = false;
    } else checks.push({ check: 'container_type', pass: true });

    if (t.container_size && t.container_size !== load.container_size) {
      checks.push({ check: 'container_size', pass: false, detail: `load = "${load.container_size || '(empty)'}", tariff requires "${t.container_size}"` });
      matched = false;
    } else checks.push({ check: 'container_size', pass: true });

    const flags = ['is_hazmat','is_overweight','is_overheight','is_hot','is_genset','is_scale','is_ev','is_street_turn','is_oog','is_bonded','is_double','is_tanker','is_liquor'];
    for (const f of flags) {
      if (t[f] === true && !load[f]) {
        checks.push({ check: f, pass: false, detail: `tariff requires ${f} = true, load = false` });
        matched = false;
        break;
      }
    }

    tariffResults.push({ id: t.id, name: t.name, status: t.status, matched, priority: t.priority, checks });
  }

  const matching = tariffResults.filter((r) => r.matched);
  const winning = matching[0] || null;

  // ── Standalone auto_add profile trace ──
  //
  // These run only when no tariff wins (engine line ~114), but we
  // still evaluate every auto_add profile here regardless — the user
  // needs to see WHY a profile they built didn't fire, even if the
  // reason is "a tariff won and blocked the auto-add branch." That's
  // an important piece of information when debugging ("your Pre Pull
  // profile was correct, but the Company Driver tariff won first").
  //
  // The condition evaluator needs load.routing_events for the
  // 'dropped' Before/After Delivery field — we hydrated that on load
  // at the top of the handler so this just works.
  const { data: autoProfiles } = await svc
    .from('driver_charge_profiles')
    .select('id, name, charge_name, driver_group_id, conditions, auto_add, is_enabled, calculation_mode')
    .eq('tenant_id', tenantId)
    .eq('is_enabled', true)
    .eq('auto_add', true)
    .is('deleted_at', null);

  const autoAddResults = [];
  for (const p of autoProfiles || []) {
    const checks = [];
    let matched = true;

    if (p.driver_group_id && !driverGroupIds.includes(p.driver_group_id)) {
      checks.push({
        check: 'driver_group',
        pass: false,
        detail: `profile restricted to a specific group; driver is in [${driverGroupNames.join(', ') || 'none'}]`,
      });
      matched = false;
    } else {
      checks.push({
        check: 'driver_group',
        pass: true,
        detail: p.driver_group_id ? 'matched' : 'all driver groups',
      });
    }

    if (p.conditions && p.conditions.length > 0) {
      const pass = evaluateConditions(load, p.conditions);
      const summary = p.conditions
        .map((c) => `${c.field} ${c.operator} [${(c.values || []).join(', ')}]`)
        .join(' AND ');
      if (!pass) {
        checks.push({ check: 'conditions', pass: false, detail: summary });
        matched = false;
      } else {
        checks.push({ check: 'conditions', pass: true, detail: summary });
      }
    } else {
      checks.push({ check: 'conditions', pass: true, detail: 'no conditions' });
    }

    // Note whether this profile would be blocked by a winning tariff.
    // Not a "check" in the pass/fail sense — informational only.
    const blockedByTariff = matched && !!winning;

    autoAddResults.push({
      id: p.id,
      name: p.name,
      charge_name: p.charge_name,
      calculation_mode: p.calculation_mode,
      matched,
      blocked_by_tariff: blockedByTariff,
      checks,
    });
  }

  return {
    load: {
      id: load.id,
      load_type: load.load_type,
      // Prefer the nested org name for display; keep the id for the
      // "copy the exact id" debugging case. UI picks name first.
      pickup_location_id: load.pickup_location_id,
      pickup_location_name: load.pickup_org?.name || null,
      delivery_location_id: load.delivery_location_id,
      delivery_location_name: load.delivery_org?.name || null,
      return_location_id: load.return_location_id,
      return_location_name: load.return_org?.name || null,
      container_type: load.container_type,
      container_size: load.container_size,
      driver_id: load.driver_id,
    },
    driver_group_ids: driverGroupIds,
    driver_group_names: driverGroupNames,
    tariffs_total: tariffResults.length,
    tariffs_matched: matching.length,
    winning_tariff_id: winning?.id || null,
    winning_tariff_name: winning?.name || null,
    tariffs: tariffResults,
    auto_add_profiles_total: autoAddResults.length,
    auto_add_profiles_matched: autoAddResults.filter((r) => r.matched && !r.blocked_by_tariff).length,
    auto_add_profiles: autoAddResults,
  };
}
