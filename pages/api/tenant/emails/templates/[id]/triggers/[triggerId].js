import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';
import { validateTriggerPayload } from './index';

/**
 * /api/tenant/emails/templates/[id]/triggers/[triggerId]
 *
 *   GET    — fetch one trigger
 *   PUT    — replace the trigger (we re-validate the full payload so the
 *            transition between evented↔polled is handled cleanly)
 *   DELETE — remove the trigger
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: templateId, triggerId } = req.query;
  if (!templateId || !triggerId) {
    return res.status(400).json({ error: 'Missing template or trigger id' });
  }

  const svc = getServiceClient();

  // Fetch the existing trigger with a tenant + template scope guard.
  const { data: existing, error: fetchErr } = await svc
    .from('email_template_triggers')
    .select('*')
    .eq('id', triggerId)
    .eq('template_id', templateId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Trigger not found' });

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ trigger: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const validation = validateTriggerPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }

    const { data: updated, error: updErr } = await svc
      .from('email_template_triggers')
      .update({
        ...validation.row,
      })
      .eq('id', triggerId)
      .eq('template_id', templateId)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (updErr) return res.status(500).json({ error: updErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_template_trigger.update',
      entityType: 'email_template_trigger',
      entityId: updated.id,
      oldValues: existing,
      newValues: updated,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ trigger: updated });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { error: delErr } = await svc
      .from('email_template_triggers')
      .delete()
      .eq('id', triggerId)
      .eq('template_id', templateId)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) return res.status(500).json({ error: delErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_template_trigger.delete',
      entityType: 'email_template_trigger',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
