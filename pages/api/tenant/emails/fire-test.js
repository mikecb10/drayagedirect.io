import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { fireTrigger } from '../../../../lib/email-dispatch';

/**
 * /api/tenant/emails/fire-test
 *
 * POST body: { trigger_id, load_id, fire_key? }
 *
 * Manually fires a trigger against a load using the full dispatch
 * pipeline. Used for end-to-end verification of Milestone 4c —
 * dispatchers can hit this endpoint from the browser console (or a
 * scratch script) to verify their trigger → umbrella → configuration →
 * group → template → message chain works before the real trigger
 * hooks (field-change, notification, cron) are wired up.
 *
 * Every run writes an `email_trigger_log` row and, if any umbrellas
 * matched + groups expanded, one `email_messages` row per group.
 *
 * Gated on MANAGE_SYSTEM_EMAILS so random dispatchers can't fire
 * arbitrary templates.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, WRITE_PERMS, res)) return;

  const { trigger_id: triggerId, load_id: loadId, fire_key } = req.body || {};
  if (!triggerId || typeof triggerId !== 'string') {
    return res.status(400).json({ error: 'trigger_id is required' });
  }
  if (!loadId || typeof loadId !== 'string') {
    return res.status(400).json({ error: 'load_id is required' });
  }

  const fireKey = fire_key || `test_${Date.now()}`;
  const svc = getServiceClient();

  try {
    const result = await fireTrigger(svc, {
      tenantId: ctx.tenantId,
      triggerId,
      loadId,
      fireKey,
      userId: ctx.userId,
      eventName: 'manual_test',
    });

    return res.status(200).json({
      ok: true,
      fire_key: fireKey,
      result,
    });
  } catch (e) {
    console.error('fire-test error:', e);
    return res.status(500).json({
      ok: false,
      fire_key: fireKey,
      error: e.message,
    });
  }
}
