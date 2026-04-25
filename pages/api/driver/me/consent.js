import { requireDriver } from '../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../lib/tenant-api.js';
import { CURRENT_CONSENT_VERSION } from '../../../../lib/driver-consent/version.js';
import { logTenantAction, getClientIp } from '../../../../lib/tenant-audit.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const version = Number.isInteger(req.body?.version) ? req.body.version : CURRENT_CONSENT_VERSION;
  if (version !== CURRENT_CONSENT_VERSION) {
    return res.status(400).json({ error: 'consent_version_mismatch', current_version: CURRENT_CONSENT_VERSION });
  }

  const svc = getServiceClient();
  const now = new Date().toISOString();
  const { error } = await svc
    .from('drivers')
    .update({
      tracking_consented_at: now,
      tracking_consent_version: version,
      tracking_revoked_at: null,
    })
    .eq('id', ctx.driverId)
    .eq('tenant_id', ctx.tenantId);
  if (error) return res.status(500).json({ error: error.message });

  // Capture user-agent + IP for the audit record (legal evidence).
  await logTenantAction(svc, {
    tenantId: ctx.tenantId,
    userId: null,
    action: 'driver.consent_accepted',
    entityType: 'driver',
    entityId: ctx.driverId,
    actorType: 'human',
    agentMetadata: {
      source: 'driver_app',
      driver_id: ctx.driverId,
      consent_version: version,
      user_agent: req.headers['user-agent'] ?? null,
    },
    ipAddress: getClientIp(req),
  });

  return res.status(204).end();
}
