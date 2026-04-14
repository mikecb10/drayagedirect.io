import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    if (
      !requirePermission(
        ctx,
        [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
        res
      )
    )
      return;

    const { load_type } = req.query;

    // System templates (tenant_id IS NULL) + tenant-owned templates
    let query = svc
      .from('routing_templates')
      .select('*')
      .eq('is_enabled', true)
      .or(`is_system.eq.true,tenant_id.eq.${ctx.tenantId}`)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (load_type) query = query.or(`load_type.eq.${load_type},load_type.is.null`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ templates: data || [] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
