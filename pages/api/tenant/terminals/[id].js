import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../lib/permissions';

/**
 * /api/tenant/terminals/[id]
 *
 * PUT — update tenant override for a system terminal.
 *       Accepts: { custom_name, enabled }
 *       Upserts into tenant_terminal_overrides.
 */
export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  if (req.method === 'PUT') {
    const { custom_name, enabled } = req.body || {};

    const upsertData = {
      tenant_id: ctx.tenantId,
      terminal_id: id,
      updated_at: new Date().toISOString(),
    };
    if (custom_name !== undefined) upsertData.custom_name = custom_name || null;
    if (typeof enabled === 'boolean') upsertData.enabled = enabled;

    const { data, error } = await svc
      .from('tenant_terminal_overrides')
      .upsert(upsertData, { onConflict: 'tenant_id,terminal_id' })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'terminal.override_update',
      entityType: 'terminal',
      entityId: id,
      newValues: { custom_name, enabled },
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ override: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
