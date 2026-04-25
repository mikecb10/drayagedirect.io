import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * Bulk-create notes across many loads in one round-trip.
 *
 * POST body: { load_ids: [uuid, uuid, ...], audience: 'driver' | 'billing' |
 *   'yard' | 'load' | 'terminal', body: string }
 *
 * Inserts ONE row into `order_notes` per load_id with the same audience +
 * body. Used by the dispatcher's bulk-action bar so a single "Add Load
 * Info" submit can land notes on every selected load without N round-trips
 * through the per-load `/api/tenant/loads/[id]/notes` POST.
 */

const VALID_AUDIENCES = ['driver', 'billing', 'yard', 'load', 'terminal'];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL], res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { load_ids, audience, body } = req.body || {};

  if (!Array.isArray(load_ids) || load_ids.length === 0) {
    return res.status(400).json({ error: 'load_ids must be a non-empty array' });
  }
  if (!VALID_AUDIENCES.includes(audience)) {
    return res.status(400).json({ error: 'Invalid audience' });
  }
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'Note body is required' });
  }

  const svc = getServiceClient();
  const trimmedBody = body.trim();

  // Tenant-scope guard: ensure all load_ids belong to this tenant before
  // inserting. A malicious caller could otherwise drop notes onto loads in
  // a different tenant by spoofing UUIDs.
  const { data: scoped, error: scopeErr } = await svc
    .from('orders')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .in('id', load_ids)
    .is('deleted_at', null);

  if (scopeErr) return res.status(500).json({ error: scopeErr.message });

  const validIds = (scoped || []).map((r) => r.id);
  if (validIds.length === 0) {
    return res.status(400).json({ error: 'No matching loads in this tenant' });
  }

  const rows = validIds.map((order_id) => ({
    tenant_id: ctx.tenantId,
    order_id,
    audience,
    body: trimmedBody,
    created_by: ctx.userId,
  }));

  const { data: inserted, error: insertErr } = await svc
    .from('order_notes')
    .insert(rows)
    .select('id, order_id');

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: 'load.bulk_note_create',
    entityType: 'order',
    entityId: null,
    newValues: {
      count: inserted?.length || 0,
      load_ids: validIds,
      audience,
      body_preview: trimmedBody.slice(0, 100),
    },
    ipAddress: getClientIp(req),
  });

  return res.status(201).json({
    count: inserted?.length || 0,
    requested: load_ids.length,
    skipped: load_ids.length - validIds.length,
  });
}
