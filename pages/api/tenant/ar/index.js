import { requireTenantUser, getServiceClient } from '../../../../lib/tenant-api';

/**
 * GET /api/tenant/ar
 *
 * Returns charge sets aggregated for the AR pipeline.
 * Includes load data, customer info, and status counts for the filter cards.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const { status, load_status, search } = req.query;

  // Fetch all charge sets with load + customer data.
  // We include `deleted_at` on the joined order so we can filter out
  // charge sets whose parent load has been soft-deleted.
  let query = svc
    .from('order_charge_sets')
    .select(`
      *,
      order:orders(id, order_number, status, load_type, customer_id, customer_reference, created_at, deleted_at,
        customer:customers!orders_customer_id_fkey(id, name)
      ),
      bill_to:customers!order_charge_sets_bill_to_customer_id_fkey(id, name),
      line_items:order_charge_set_line_items(id, name, total_cents, is_auto)
    `)
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: chargeSets, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Exclude charge sets belonging to deleted loads.
  // (Supabase can't filter joined foreign tables in the main query, so we
  // filter client-side here.)
  const sets = (chargeSets || []).filter((cs) => !cs.order || cs.order.deleted_at == null);

  // Compute pipeline counts + sums per bucket.
  // Shape: { <bucket>: { count, total_cents } } with `total`/`total_cents`
  // at the top level preserving grand totals for backwards-compat display.
  const emptyBucket = () => ({ count: 0, total_cents: 0 });
  const counts = {
    // Pre-Invoice Pipeline
    uncompleted_loads: emptyBucket(),
    completed_loads: emptyBucket(),
    rate_con_sent: emptyBucket(),
    unapproved: emptyBucket(),
    approved: emptyBucket(),
    // Invoice Pipeline
    invoiced: emptyBucket(),
    rebilling: emptyBucket(),
    // Other
    void: emptyBucket(),
    total: sets.length,
    total_cents: 0,
  };

  for (const cs of sets) {
    const loadStatus = cs.order?.status;
    const csStatus = cs.status;
    const cents = cs.total_cents || 0;

    counts.total_cents += cents;

    const addTo = (bucket) => {
      counts[bucket].count += 1;
      counts[bucket].total_cents += cents;
    };

    if (csStatus === 'void') { addTo('void'); continue; }
    if (csStatus === 'invoiced' || csStatus === 'billed') { addTo('invoiced'); continue; }
    if (csStatus === 'rebilling') { addTo('rebilling'); continue; }
    if (csStatus === 'rate_con_sent') { addTo('rate_con_sent'); continue; }
    if (csStatus === 'unapproved') { addTo('unapproved'); continue; }
    if (csStatus === 'approved') { addTo('approved'); continue; }

    // Draft — split by load completion status
    if (loadStatus === 'completed' || loadStatus === 'delivered') {
      addTo('completed_loads');
    } else {
      addTo('uncompleted_loads');
    }
  }

  // Apply client-side filters for search
  let filtered = sets;
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((cs) =>
      cs.charge_set_number?.toLowerCase().includes(q) ||
      cs.order?.order_number?.toLowerCase().includes(q) ||
      cs.order?.customer?.name?.toLowerCase().includes(q)
    );
  }

  // Apply load_status filter
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
