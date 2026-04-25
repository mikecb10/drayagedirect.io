import { requireDriver } from '../../../../../lib/driver-auth/middleware.js';
import { getServiceClient } from '../../../../../lib/tenant-api.js';
import { checkTrackingGates } from '../../../../../lib/driver-auth/tracking-gates.js';
import { applyDriverAction } from '../../../../../lib/routing/driver-action.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  const ctx = await requireDriver(req, res);
  if (!ctx) return;

  const svc = getServiceClient();
  const gateFail = await checkTrackingGates({
    supabase: svc, tenantId: ctx.tenantId, driver: ctx.driver,
  });
  if (gateFail) return res.status(gateFail.status).json({ error: gateFail.error });

  const { id: moveId } = req.query;
  const { gpsPing } = req.body || {};
  if (!gpsPing || typeof gpsPing.latitude !== 'number' || typeof gpsPing.longitude !== 'number' || !gpsPing.recorded_at) {
    return res.status(400).json({ error: 'gpsPing_required', detail: 'latitude/longitude/recorded_at required' });
  }

  try {
    const result = await applyDriverAction({
      supabase: svc, tenantId: ctx.tenantId, moveId, actionType: 'start',
      driverId: ctx.driverId, gpsPing,
    });
    return res.status(200).json(result);
  } catch (e) {
    if (e.message === 'ping_cap_reached') return res.status(429).json({ error: 'ping_cap_reached' });
    if (e.message === 'move_unassigned') return res.status(409).json({ error: 'move_unassigned' });
    if (e.message?.startsWith('forbidden')) return res.status(403).json({ error: 'forbidden' });
    if (e.message?.startsWith('Invalid transition')) return res.status(409).json({ error: 'invalid_transition', detail: e.message });
    console.error('driver start error:', e);
    return res.status(500).json({ error: 'internal_error', detail: e.message });
  }
}
