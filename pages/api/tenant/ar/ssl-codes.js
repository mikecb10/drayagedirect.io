import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * GET /api/tenant/ar/ssl-codes
 *
 * Returns the distinct `orders.steamship_line_scac` values present in the
 * current tenant's non-deleted orders, uppercased and sorted alphabetically.
 * Used to populate the AR FilterSidebar's SSL multi-select without hitting
 * a reference table (SCAC codes are free-text on orders).
 *
 * Response shape: { codes: ["MAEU", "MSCU", "ONEY", ...] }
 */
const AR_PERMS = [
  PERMISSIONS.ACCOUNTS_RECEIVABLE,
  PERMISSIONS.ORDER_ENTRY,
  PERMISSIONS.DISPATCHING,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, AR_PERMS, res)) return;

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('orders')
    .select('steamship_line_scac')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .not('steamship_line_scac', 'is', null);

  if (error) {
    console.error('[ar/ssl-codes] query failed:', error.message);
    return res.status(500).json({ error: 'query_failed' });
  }

  const codes = Array.from(
    new Set((data || [])
      .map((r) => (typeof r.steamship_line_scac === 'string' ? r.steamship_line_scac.trim().toUpperCase() : ''))
      .filter(Boolean))
  ).sort();

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ codes });
}
