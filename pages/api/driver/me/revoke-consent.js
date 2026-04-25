import { requireDriver } from '../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../lib/tenant-api.js';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const { error } = await svc
    .from('drivers')
    .update({ tracking_revoked_at: new Date().toISOString() })
    .eq('id', ctx.driverId)
    .eq('tenant_id', ctx.tenantId);
  if (error) return res.status(500).json({ error: error.message });

  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: null,
    action: 'driver.consent_revoked',
    entityType: 'driver',
    entityId: ctx.driverId,
    actorType: 'human',
    agentMetadata: { source: 'driver_app', driver_id: ctx.driverId },
    ipAddress: getClientIp(req),
  });

  return res.status(204).end();
}
