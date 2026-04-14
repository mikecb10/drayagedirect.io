import { requireTenantUser, getServiceClient } from '../../../../lib/tenant-api';

/**
 * GET /api/tenant/document-submissions/count
 *
 * Returns the count of 'received' (pending review) submissions whose parent
 * load is NOT soft-deleted. Used by the sidebar badge.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  // Pull the joined order's deleted_at so we can exclude submissions on deleted loads
  const { data, error } = await svc
    .from('document_submissions')
    .select('id, order:orders(deleted_at)')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'received');

  if (error) return res.status(500).json({ error: error.message });

  const count = (data || []).filter((row) => !row.order || row.order.deleted_at == null).length;

  return res.status(200).json({ count });
}
