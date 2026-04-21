import { requireTenantUser, getServiceClient } from '../../../../lib/tenant-api';
import { parseCsvParam } from '../../../../lib/ar-filter-params';

/**
 * GET /api/tenant/ar
 *
 * Returns charge sets aggregated for the AR pipeline.
 * Includes load data, customer info, and status counts for the filter cards.
 *
 * Query params:
 *   status         - single charge-set status
 *   load_status    - 'uncompleted' | 'completed' (draft split)
 *   search         - substring match (client-side) on charge_set_number /
 *                    order_number / customer.name
 *   customer_ids   - CSV of customer UUIDs (matches order.customer_id OR
 *                    order_charge_sets.bill_to_customer_id)
 *   branch_ids     - CSV of branch UUIDs (matches order.branch_id)
 *   from, to       - ISO dates; filters order_charge_sets.created_at
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const { status, load_status, search, from, to } = req.query;
  const customerIds = parseCsvParam(req.query.customer_ids);
  const branchIds   = parseCsvParam(req.query.branch_ids);
  const { reference_number } = req.query;
  const loadTypes       = parseCsvParam(req.query.load_types);
  const containerTypes  = parseCsvParam(req.query.container_types);
  const containerSizes  = parseCsvParam(req.query.container_sizes);
  const flagKeys        = parseCsvParam(req.query.flags);
  const sslCodes        = parseCsvParam(req.query.ssl_codes);
  const driverIds       = parseCsvParam(req.query.driver_ids);

  let query = svc
    .from('order_charge_sets')
    .select(`
      *,
      order:orders(id, order_number, status, load_type, customer_id, customer_reference, branch_id, driver_id, container_type, container_size, steamship_line_scac, is_hazmat, is_overweight, is_overheight, is_liquor, is_hot, is_genset, is_scale, is_ev, is_street_turn, is_oog, is_bonded, is_double, is_tanker, created_at, deleted_at,
        customer:customers!orders_customer_id_fkey(id, name)
      ),
      bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name),
      line_items:order_charge_set_line_items(id, name, total_cents, is_auto)
    `)
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (from)   query = query.gte('created_at', from);
  if (to)     query = query.lte('created_at', to);

  const { data: chargeSets, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const sets = (chargeSets || []).filter((cs) => !cs.order || cs.order.deleted_at == null);

  // Customer filter — match on order.customer_id OR bill_to_customer_id.
  // Bill-to override is common in 3PL flows, so either column counts.
  let scopedSets = sets;
  if (customerIds.length > 0) {
    const ids = new Set(customerIds);
    scopedSets = scopedSets.filter((cs) =>
      (cs.order?.customer_id && ids.has(cs.order.customer_id)) ||
      (cs.bill_to_customer_id && ids.has(cs.bill_to_customer_id))
    );
  }
  if (branchIds.length > 0) {
    const ids = new Set(branchIds);
    scopedSets = scopedSets.filter((cs) => cs.order?.branch_id && ids.has(cs.order.branch_id));
  }

  // Reference number — substring match on orders.customer_reference (case-insensitive).
  if (reference_number && typeof reference_number === 'string' && reference_number.trim().length > 0) {
    const q = reference_number.trim().toLowerCase();
    scopedSets = scopedSets.filter((cs) =>
      cs.order?.customer_reference?.toLowerCase().includes(q)
    );
  }

  // Load type — multi-select on orders.load_type.
  if (loadTypes.length > 0) {
    const types = new Set(loadTypes);
    scopedSets = scopedSets.filter((cs) => cs.order?.load_type && types.has(cs.order.load_type));
  }

  // Container type + size — multi-select on orders.container_type / .container_size.
  if (containerTypes.length > 0) {
    const types = new Set(containerTypes);
    scopedSets = scopedSets.filter((cs) => cs.order?.container_type && types.has(cs.order.container_type));
  }
  if (containerSizes.length > 0) {
    const sizes = new Set(containerSizes);
    scopedSets = scopedSets.filter((cs) => cs.order?.container_size && sizes.has(cs.order.container_size));
  }

  // Load flags — AND semantics (row must have EVERY selected flag set true).
  // flag keys are bare labels (e.g. "hazmat"); the DB columns are is_<key>.
  if (flagKeys.length > 0) {
    scopedSets = scopedSets.filter((cs) =>
      flagKeys.every((key) => cs.order?.[`is_${key}`] === true)
    );
  }

  // SSL multi-select on orders.steamship_line_scac (uppercased SCAC code).
  if (sslCodes.length > 0) {
    const codes = new Set(sslCodes.map((c) => c.toUpperCase()));
    scopedSets = scopedSets.filter((cs) =>
      cs.order?.steamship_line_scac && codes.has(cs.order.steamship_line_scac.toUpperCase())
    );
  }

  // Driver multi-select on orders.driver_id.
  if (driverIds.length > 0) {
    const ids = new Set(driverIds);
    scopedSets = scopedSets.filter((cs) => cs.order?.driver_id && ids.has(cs.order.driver_id));
  }

  // Compute counts over the SCOPED set — filter cards reflect the current
  // customer/branch/date scope, not the unfiltered universe.
  const emptyBucket = () => ({ count: 0, total_cents: 0 });
  const counts = {
    uncompleted_loads: emptyBucket(),
    completed_loads:   emptyBucket(),
    rate_con_sent:     emptyBucket(),
    unapproved:        emptyBucket(),
    approved:          emptyBucket(),
    invoiced:          emptyBucket(),
    rebilling:         emptyBucket(),
    void:              emptyBucket(),
    total:             scopedSets.length,
    total_cents:       0,
  };

  for (const cs of scopedSets) {
    const loadStatus = cs.order?.status;
    const csStatus   = cs.status;
    const cents      = cs.total_cents || 0;
    counts.total_cents += cents;

    const addTo = (bucket) => {
      counts[bucket].count += 1;
      counts[bucket].total_cents += cents;
    };

    if (csStatus === 'void')         { addTo('void'); continue; }
    if (csStatus === 'invoiced' || csStatus === 'billed') { addTo('invoiced'); continue; }
    if (csStatus === 'rebilling')    { addTo('rebilling'); continue; }
    if (csStatus === 'rate_con_sent'){ addTo('rate_con_sent'); continue; }
    if (csStatus === 'unapproved')   { addTo('unapproved'); continue; }
    if (csStatus === 'approved')     { addTo('approved'); continue; }

    if (loadStatus === 'completed' || loadStatus === 'delivered') {
      addTo('completed_loads');
    } else {
      addTo('uncompleted_loads');
    }
  }

  // Stage card (status + load_status) and search filters apply AFTER counts —
  // counts show "pipeline totals for the current scope", list shows "rows in
  // this bucket within the current scope".
  let filtered = scopedSets;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((cs) =>
      cs.charge_set_number?.toLowerCase().includes(q) ||
      cs.order?.order_number?.toLowerCase().includes(q) ||
      cs.order?.customer?.name?.toLowerCase().includes(q)
    );
  }

  if (load_status === 'uncompleted') {
    filtered = filtered.filter((cs) =>
      (cs.status === 'draft') &&
      cs.order?.status !== 'completed' && cs.order?.status !== 'delivered'
    );
  } else if (load_status === 'completed') {
    filtered = filtered.filter((cs) =>
      (cs.status === 'draft') &&
      (cs.order?.status === 'completed' || cs.order?.status === 'delivered')
    );
  }

  return res.status(200).json({ charge_sets: filtered, counts });
}
