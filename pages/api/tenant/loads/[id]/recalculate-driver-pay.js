import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { findMatchingDriverCharges, applyDriverPayToLoad } from '../../../../../lib/driver-tariff-engine';

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

  const { data: load, error: loadErr } = await svc
    .from('live_orders')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .single();

  if (loadErr || !load) return res.status(404).json({ error: 'Load not found' });

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
      source: c.source,
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

    if (t.pickup_conditions && !t.pickup_conditions.all && t.pickup_conditions.ids?.length > 0) {
      if (!t.pickup_conditions.ids.includes(load.pickup_location_id)) {
        checks.push({ check: 'pickup_location', pass: false, detail: `load pickup_location_id = "${load.pickup_location_id || '(empty)'}" not in tariff list` });
        matched = false;
      } else checks.push({ check: 'pickup_location', pass: true });
    } else checks.push({ check: 'pickup_location', pass: true, detail: 'all pickup locations' });

    if (t.delivery_conditions && !t.delivery_conditions.all && t.delivery_conditions.ids?.length > 0) {
      if (!t.delivery_conditions.ids.includes(load.delivery_location_id)) {
        checks.push({ check: 'delivery_location', pass: false, detail: `load delivery_location_id = "${load.delivery_location_id || '(empty)'}" not in tariff list` });
        matched = false;
      } else checks.push({ check: 'delivery_location', pass: true });
    } else checks.push({ check: 'delivery_location', pass: true, detail: 'all delivery locations' });

    if (t.return_conditions && !t.return_conditions.all && t.return_conditions.ids?.length > 0) {
      if (!t.return_conditions.ids.includes(load.return_location_id)) {
        checks.push({ check: 'return_location', pass: false, detail: `load return_location_id = "${load.return_location_id || '(empty)'}" not in tariff list` });
        matched = false;
      } else checks.push({ check: 'return_location', pass: true });
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

  return {
    load: {
      id: load.id,
      load_type: load.load_type,
      pickup_location_id: load.pickup_location_id,
      delivery_location_id: load.delivery_location_id,
      return_location_id: load.return_location_id,
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
  };
}
