/**
 * GET  /api/tenant/feature-flags/move-tracking → { enabled: boolean }
 * PUT  /api/tenant/feature-flags/move-tracking → 204
 *   Body: { enabled: boolean }
 *
 * Reads/writes the per-tenant move_tracking feature flag in the
 * tenant_feature_flags table. Joins through feature_flags.name.
 *
 * NOTE: tenant_feature_flags has a 3-column unique constraint:
 *   UNIQUE (tenant_id, feature_flag_id, user_id)
 * Tenant-level flags always use user_id = NULL.
 *
 * Auth: requireTenantUser + SETTINGS permission (matches other tenant-admin
 * settings endpoints).
 */

import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit';

const FLAG_NAME = 'move_tracking';

async function getFlagId(svc) {
  const { data: ff } = await svc
    .from('feature_flags')
    .select('id')
    .eq('name', FLAG_NAME)
    .maybeSingle();
  return ff?.id ?? null;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.SETTINGS, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  if (req.method === 'GET') {
    const { data: tff } = await svc
      .from('tenant_feature_flags')
      .select('enabled, feature_flag:feature_flags!inner(name)')
      .eq('tenant_id', ctx.tenantId)
      .eq('feature_flag.name', FLAG_NAME)
      .is('user_id', null)
      .maybeSingle();
    return res.status(200).json({ enabled: !!tff?.enabled });
  }

  if (req.method === 'PUT') {
    const enabled = !!req.body?.enabled;
    const flagId = await getFlagId(svc);
    if (!flagId) {
      return res.status(500).json({
        error: 'feature_flag_not_registered',
        detail: `${FLAG_NAME} flag missing from feature_flags table`,
      });
    }

    // Upsert the tenant-level row (user_id = NULL).
    // The unique constraint is (tenant_id, feature_flag_id, user_id).
    const { error } = await svc
      .from('tenant_feature_flags')
      .upsert(
        { tenant_id: ctx.tenantId, feature_flag_id: flagId, enabled, user_id: null },
        { onConflict: 'tenant_id,feature_flag_id,user_id' }
      );
    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: enabled ? 'tenant.feature_enabled' : 'tenant.feature_disabled',
      entityType: 'tenant_feature_flag',
      entityId: ctx.tenantId,
      newValues: { feature_flag: FLAG_NAME, enabled },
      actorType: 'human',
      ipAddress: getClientIp(req),
    });

    return res.status(204).end();
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
