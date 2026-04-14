import {
  requireTenantUser,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { fireNotificationTrigger } from '../../../../lib/email-dispatch';

/**
 * /api/tenant/emails/fire-notification
 *
 * POST body: { load_id, event_name }
 *
 * Fires all active notification triggers matching (tenant, event_name)
 * for the given load. Intended to be called from UI actions where a
 * dispatcher explicitly signals that something happened:
 *
 *   - document_validation  — Load detail → Documents tab → "Mark validated"
 *   - load_empty           — Load detail → status panel → "Mark Empty"
 *   - ready_to_return      — Load detail → status panel → "Ready to Return"
 *
 * TODO (follow-up): wire the three UI entry points above to POST this
 * endpoint. The endpoint is idempotent within a 10-second bucket via
 * the dispatcher's dedupe layer, so accidental double-clicks return
 * outcome='deduped' instead of sending duplicate mail.
 *
 * Permission: any authenticated tenant user can fire notification
 * triggers (they represent an explicit user action on a load, so the
 * load's edit gate is the meaningful gate — if a user can edit the
 * load they can trigger notifications on it).
 */

const VALID_EVENT_NAMES = new Set([
  'document_validation',
  'load_empty',
  'ready_to_return',
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { load_id: loadId, event_name: eventName } = req.body || {};
  if (!loadId || typeof loadId !== 'string') {
    return res.status(400).json({ error: 'load_id is required' });
  }
  if (!eventName || typeof eventName !== 'string') {
    return res.status(400).json({ error: 'event_name is required' });
  }
  if (!VALID_EVENT_NAMES.has(eventName)) {
    return res.status(400).json({
      error: `event_name must be one of: ${Array.from(VALID_EVENT_NAMES).join(', ')}`,
    });
  }

  const svc = getServiceClient();

  // Scope guard: confirm the load belongs to this tenant before we
  // accept the fire request. A 404 here is important — without it, a
  // malicious caller could probe for load IDs across tenants.
  const { data: load } = await svc
    .from('orders')
    .select('id')
    .eq('id', loadId)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!load) {
    return res.status(404).json({ error: 'Load not found' });
  }

  try {
    const result = await fireNotificationTrigger(svc, {
      tenantId: ctx.tenantId,
      loadId,
      eventName,
      userId: ctx.userId,
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error('fire-notification error:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
