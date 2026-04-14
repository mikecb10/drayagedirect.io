import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { applyBranchFilter } from '../../../../../lib/branch-filter';

/**
 * /api/tenant/ap/driver-pay
 *
 * GET — list all driver pay lines across all loads (module-level view)
 * Filters: status, driver_id, from, to, search
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_PAYABLE, PERMISSIONS.ALL], res)) return;
  const svc = getServiceClient();

  const { status, driver_id, from, to, search } = req.query;

  let query = svc
    .from('order_driver_pay_lines')
    .select(`
      *,
      driver:drivers(id, name, first_name, last_name, truck_number),
      order:orders(id, order_number, container_number, status, branch_id,
        customer:customers!orders_customer_id_fkey(id, name),
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, city, state),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, city, state)
      )
    `)
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);
  if (driver_id) query = query.eq('driver_id', driver_id);
  if (from) query = query.gte('worked_at', from);
  if (to) query = query.lte('worked_at', to);
  if (search) {
    query = query.or(`description.ilike.%${search}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const lines = data || [];

  // Pipeline stats
  const stats = {
    drafted: { count: 0, cents: 0 },
    unapproved: { count: 0, cents: 0 },
    approved: { count: 0, cents: 0 },
    reviewed: { count: 0, cents: 0 },
    finalized: { count: 0, cents: 0 },
    total_cents: 0,
  };
  for (const line of lines) {
    const s = line.status || 'drafted';
    if (stats[s]) {
      stats[s].count++;
      stats[s].cents += line.amount_cents || 0;
    }
    stats.total_cents += line.amount_cents || 0;
  }

  return res.status(200).json({ pay_lines: lines, stats });
}
