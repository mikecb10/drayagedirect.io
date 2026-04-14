import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * /api/tenant/emails/configurations/[id]/umbrellas
 *
 * Manages the junction table email_configuration_umbrellas.
 *
 *   POST   — attach an umbrella to the configuration
 *            Body: { umbrella_id }
 *
 *   DELETE — detach an umbrella from the configuration
 *            Query: ?umbrella_id=<uuid>  OR  ?attachment_id=<uuid>
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: configurationId } = req.query;
  if (!configurationId) {
    return res.status(400).json({ error: 'Missing configuration id' });
  }

  const svc = getServiceClient();

  // Tenant-scope guard — confirm the configuration belongs to this tenant
  const { data: config, error: cErr } = await svc
    .from('email_configurations')
    .select('id, tenant_id')
    .eq('id', configurationId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (cErr) return res.status(500).json({ error: cErr.message });
  if (!config) {
    return res.status(404).json({ error: 'Configuration not found' });
  }

  // ── ATTACH ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const umbrellaId = body.umbrella_id;
    if (!umbrellaId) {
      return res.status(400).json({ error: 'umbrella_id is required' });
    }

    // Confirm the umbrella exists + belongs to this tenant
    const { data: umbrella, error: uErr } = await svc
      .from('email_umbrellas')
      .select('id, name')
      .eq('id', umbrellaId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (uErr) return res.status(500).json({ error: uErr.message });
    if (!umbrella) return res.status(404).json({ error: 'Umbrella not found' });

    const { data, error } = await svc
      .from('email_configuration_umbrellas')
      .insert({
        tenant_id: ctx.tenantId,
        configuration_id: configurationId,
        umbrella_id: umbrellaId,
      })
      .select('*, umbrella:email_umbrellas(id, name, description, specificity_score, is_active, always_run, is_default)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'This umbrella is already attached to the configuration',
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_configuration_umbrella.attach',
      entityType: 'email_configuration_umbrella',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({
      attachment: {
        attachment_id: data.id,
        ...data.umbrella,
      },
    });
  }

  // ── DETACH ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { attachment_id, umbrella_id } = req.query;
    if (!attachment_id && !umbrella_id) {
      return res
        .status(400)
        .json({ error: 'Must provide attachment_id or umbrella_id' });
    }

    let query = svc
      .from('email_configuration_umbrellas')
      .delete()
      .eq('configuration_id', configurationId)
      .eq('tenant_id', ctx.tenantId);

    if (attachment_id) {
      query = query.eq('id', attachment_id);
    } else {
      query = query.eq('umbrella_id', umbrella_id);
    }

    const { error: delErr } = await query;
    if (delErr) return res.status(500).json({ error: delErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_configuration_umbrella.detach',
      entityType: 'email_configuration_umbrella',
      entityId: attachment_id || umbrella_id,
      oldValues: null,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
