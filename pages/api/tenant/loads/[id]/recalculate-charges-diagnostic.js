/**
 * Recalculate Charges Diagnostic — AR parity for AP's recalculate-driver-pay
 *
 * Read-only. Runs the customer-tariff matcher + condition evaluator and
 * returns a tariff-by-tariff trace PLUS the would-be charges list WITHOUT
 * writing anything to order_charge_sets / order_charge_set_line_items.
 *
 * Use case: dispatcher asks "why did my customer tariff not match this
 * load?" The existing recalculate-charges endpoint applies charges and
 * returns a count — this one explains.
 *
 * Shape mirrors recalculate-driver-pay.js response so the UI can share
 * rendering components between the two diagnostics.
 */

import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { findMatchingCharges } from '../../../../../lib/tariff-engine';
import { formatDuration, formatPounds, formatMiles } from '../../../../../lib/pricing-uom';
import { diagnoseAdvancedRoute } from '../../../../../lib/advanced-route-matcher';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'missing load id' });

  const svc = getServiceClient();

  // Load the order with the shape the engine expects.
  const { data: load, error: loadErr } = await svc
    .from('orders')
    .select(`
      *,
      customer:customers!orders_customer_id_fkey(id, name),
      pickup_org:customers!orders_pickup_location_id_fkey(id, name, city, state, zip),
      delivery_org:customers!orders_delivery_location_id_fkey(id, name, city, state, zip),
      return_org:customers!orders_return_location_id_fkey(id, name, city, state, zip)
    `)
    .eq('tenant_id', ctx.tenantId)
    .eq('id', id)
    .maybeSingle();

  if (loadErr) return res.status(500).json({ error: `load fetch failed: ${loadErr.message}` });
  if (!load)   return res.status(404).json({ error: 'load not found' });

  // Build the would-be charges list WITHOUT applying them.
  const charges = await findMatchingCharges(svc, load, ctx.tenantId);

  // Build the tariff-match diagnostic trace.
  const diagnostic = await diagnoseTariffMatch(svc, load, ctx.tenantId);

  return res.status(200).json({
    success: true,
    applied: 0,              // read-only — we never apply
    would_apply: charges.length,
    charges: charges.map((c) => ({
      name: c.name,
      charge_name: c.charge_name,
      unit_of_measure: c.unit_of_measure,
      calculation_mode: c.calculation_mode,
      amount_cents: c.amount_cents,
      minimum_amount_cents: c.minimum_amount_cents,
      source: c.source,
      tier_id: c.tier_id || null,
      duration_seconds: c.duration_seconds || 0,
      duration_label: c.duration_seconds ? formatDuration(c.duration_seconds) : null,
      pounds: c.pounds || 0,
      pounds_label: c.pounds ? formatPounds(c.pounds) : null,
      miles: c.miles || 0,
      miles_label: c.miles ? formatMiles(c.miles) : null,
      radius_bracket_index: c.radius_bracket_index ?? null,
    })),
    diagnostic,
    message: charges.length > 0
      ? `${charges.length} charge${charges.length !== 1 ? 's' : ''} would be applied`
      : 'No matching charges — see diagnostic for reason',
  });
}

/**
 * Run each customer tariff against the load; return an array of
 * { tariff_id, tariff_name, priority, status, checks: [...], matched }.
 *
 * Checks mirror the matcher in lib/tariff-engine.js:
 *   status, date_range, customer, load_type, pickup_location,
 *   delivery_location, return_location, container_type, container_size,
 *   ssl, chassis_type, chassis_size, and every flag check.
 */
async function diagnoseTariffMatch(svc, load, tenantId) {
  const today = new Date().toISOString().slice(0, 10);

  const { data: tariffs } = await svc
    .from('tariffs')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('priority', { ascending: false });

  // Pre-fetch advanced_route blobs for any advanced-mode tariffs.
  const advIds = (tariffs || []).filter((t) => t.matching_mode === 'advanced_route').map((t) => t.id);
  const advByTariff = new Map();
  if (advIds.length > 0) {
    const { data: advs } = await svc
      .from('tariff_advanced_routes')
      .select('tariff_id, routing_template_id, moves')
      .in('tariff_id', advIds)
      .eq('tenant_id', tenantId);
    for (const a of (advs || [])) advByTariff.set(a.tariff_id, a);
  }

  // Hydrate load.routing_events + container_moves so the advanced-route
  // matcher has data to compare against.
  if (!Array.isArray(load.routing_events)) {
    const { data: re } = await svc
      .from('order_routing_events')
      .select('id, event_type, sequence, location_id, city, state, zip, move_id')
      .eq('tenant_id', tenantId).eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.routing_events = re || [];
  }
  if (!Array.isArray(load.container_moves)) {
    const { data: cm } = await svc
      .from('order_container_moves')
      .select('id, sequence')
      .eq('tenant_id', tenantId).eq('order_id', load.id)
      .order('sequence', { ascending: true });
    load.container_moves = cm || [];
  }

  const results = [];

  for (const t of tariffs || []) {
    const checks = [];
    let matched = true;

    // Status
    if (t.status !== 'active') {
      checks.push({ check: 'status', pass: false, detail: `status = "${t.status}" (must be "active")` });
      matched = false;
    } else {
      checks.push({ check: 'status', pass: true });
    }

    // Date range
    if (t.effective_start && t.effective_start > today) {
      checks.push({ check: 'date_range', pass: false, detail: `starts ${t.effective_start}, today is ${today}` });
      matched = false;
    } else if (t.effective_end && t.effective_end < today) {
      checks.push({ check: 'date_range', pass: false, detail: `ended ${t.effective_end}, today is ${today}` });
      matched = false;
    } else {
      checks.push({ check: 'date_range', pass: true });
    }

    // Customer scope
    if (t.customer_ids?.length > 0) {
      const matchCustomer = t.customer_ids.includes(load.customer_id);
      if (!matchCustomer) {
        checks.push({
          check: 'customer',
          pass: false,
          detail: `load customer = "${load.customer?.name || load.customer_id || '—'}", tariff requires one of [${t.customer_ids.length} ids]`,
        });
        matched = false;
      } else {
        checks.push({ check: 'customer', pass: true, detail: load.customer?.name || load.customer_id });
      }
    } else {
      checks.push({ check: 'customer', pass: true, detail: 'all customers' });
    }

    // Load type
    if (t.load_types?.length > 0) {
      const lt = (load.load_type || '').toLowerCase();
      const allowed = t.load_types.map((x) => x.toLowerCase());
      if (!allowed.includes(lt)) {
        checks.push({ check: 'load_type', pass: false, detail: `load="${lt}", tariff allows [${allowed.join(', ')}]` });
        matched = false;
      } else {
        checks.push({ check: 'load_type', pass: true, detail: lt });
      }
    } else {
      checks.push({ check: 'load_type', pass: true, detail: 'all load types' });
    }

    if (t.matching_mode === 'advanced_route') {
      const ar = advByTariff.get(t.id) || null;
      const r = diagnoseAdvancedRoute(ar, load);
      checks.push({
        check: 'advanced_route',
        pass: r.matched,
        detail: r.matched ? 'route matched' : r.reason,
      });
      if (!r.matched) matched = false;
    } else {
      // Pickup / Delivery / Return location checks (basic mode)
      for (const field of ['pickup', 'delivery', 'return']) {
        const cond = t[`${field}_conditions`];
        const loadOrg = load[`${field}_org`];
        const loadId = load[`${field}_location_id`];
        if (cond && !cond.all && cond.ids?.length > 0) {
          if (!cond.ids.includes(loadId)) {
            const labels = cond.ids.map((uid) => cond.labels?.[uid] || uid).join(', ');
            checks.push({
              check: `${field}_location`,
              pass: false,
              detail: `load ${field} = "${loadOrg?.name || '—'}", tariff requires [${labels}]`,
            });
            matched = false;
          } else {
            checks.push({ check: `${field}_location`, pass: true, detail: loadOrg?.name || loadId });
          }
        } else {
          checks.push({ check: `${field}_location`, pass: true, detail: `all ${field} locations` });
        }
      }
    }

    // Equipment
    if (t.container_type && t.container_type !== load.container_type) {
      checks.push({ check: 'container_type', pass: false, detail: `load="${load.container_type || '(empty)'}", tariff="${t.container_type}"` });
      matched = false;
    } else {
      checks.push({ check: 'container_type', pass: true });
    }
    if (t.container_size && t.container_size !== load.container_size) {
      checks.push({ check: 'container_size', pass: false, detail: `load="${load.container_size || '(empty)'}", tariff="${t.container_size}"` });
      matched = false;
    } else {
      checks.push({ check: 'container_size', pass: true });
    }
    if (t.ssl_id && t.ssl_id !== load.container_owner_id) {
      checks.push({ check: 'ssl', pass: false, detail: 'SSL mismatch' });
      matched = false;
    } else {
      checks.push({ check: 'ssl', pass: true });
    }
    if (t.chassis_type && t.chassis_type !== load.chassis_type) {
      checks.push({ check: 'chassis_type', pass: false, detail: `load="${load.chassis_type || '(empty)'}"` });
      matched = false;
    } else {
      checks.push({ check: 'chassis_type', pass: true });
    }
    if (t.chassis_size && t.chassis_size !== load.chassis_size) {
      checks.push({ check: 'chassis_size', pass: false, detail: `load="${load.chassis_size || '(empty)'}"` });
      matched = false;
    } else {
      checks.push({ check: 'chassis_size', pass: true });
    }

    // Flags
    const flagFields = [
      'is_hazmat', 'is_overweight', 'is_liquor', 'is_hot', 'is_genset',
      'is_overheight', 'is_scale', 'is_ev', 'is_street_turn',
      'is_oog', 'is_bonded', 'is_double', 'is_tanker',
    ];
    for (const flag of flagFields) {
      if (t[flag] === true && !load[flag]) {
        checks.push({ check: flag, pass: false, detail: `tariff requires ${flag}=true, load=false` });
        matched = false;
        break;
      }
    }

    results.push({
      tariff_id: t.id,
      tariff_name: t.name,
      priority: t.priority || 0,
      status: t.status,
      checks,
      matched,
    });
  }

  const winning = results.find((r) => r.matched);

  return {
    total_tariffs: results.length,
    tariffs: results,
    winning_tariff_id: winning?.tariff_id || null,
    winning_tariff_name: winning?.tariff_name || null,
  };
}
