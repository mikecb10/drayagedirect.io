import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * Bulk soft-delete loads.
 *
 * POST body: { load_ids: [uuid, uuid, ...] }
 *
 * Sets `deleted_at = now()` on each row scoped to the current tenant,
 * skipping any rows that don't match the tenant or are already deleted.
 * Soft delete only — the rows remain queryable from the tenant Trash
 * view and can be restored.
 *
 * Audit: writes ONE row per affected load (entity_id scoped to that
 * load), matching the pattern from FU-026 / bulk-update / bulk-notes
 * so each load's per-load audit page surfaces the bulk delete with a
 * `bulk_count` breadcrumb.
 *
 * Permission: ORDER_ENTRY (or ALL). Dispatching alone is not enough —
 * deletion is a higher-trust operation than per-field bulk edits.
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  const { load_ids } = req.body || {};
  if (!Array.isArray(load_ids) || load_ids.length === 0) {
    return res.status(400).json({ error: 'load_ids must be a non-empty array' });
  }

  const svc = getServiceClient();
  const now = new Date().toISOString();

  // Single .update().in() — atomic-ish at the DB level. Returns the IDs
  // that were actually updated so we can audit per-load and report
  // accurate counts to the dispatcher (handles "this load was already
  // deleted in another window" gracefully).
  const { data: updated, error: updErr } = await svc
    .from('orders')
    .update({ deleted_at: now })
    .eq('tenant_id', ctx.tenantId)
    .in('id', load_ids)
    .is('deleted_at', null)
    .select('id, order_number');

  if (updErr) return res.status(500).json({ error: updErr.message });

  const deletedIds = (updated || []).map((r) => r.id);
  const ip = getClientIp(req);

  // Per-load audit row so each load's audit page records the deletion
  // with the bulk_count context. Matches the FU-026 pattern.
  await Promise.all(
    deletedIds.map((load_id) =>
      logTenantAction(svc, {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: 'load.bulk_soft_delete',
        entityType: 'order',
        entityId: load_id,
        oldValues: { deleted_at: null },
        newValues: { deleted_at: now, bulk_count: deletedIds.length },
        ipAddress: ip,
      })
    )
  );

  return res.status(200).json({
    deleted: deletedIds.length,
    requested: load_ids.length,
    skipped: load_ids.length - deletedIds.length,
  });
}
