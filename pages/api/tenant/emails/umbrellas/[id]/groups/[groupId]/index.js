import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../../lib/permissions';

/**
 * /api/tenant/emails/umbrellas/[id]/groups/[groupId]
 *
 *   GET    — fetch a single group with attached templates
 *   PUT    — partial update (name, recipients, active, reply_to)
 *   DELETE — remove the group (also cascades group_templates rows)
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

function normalizeRecipients(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({
      type: r.type || 'email',
      value: r.value,
      label: r.label,
    }))
    .filter((r) => r.value != null && r.value !== '');
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: umbrellaId, groupId } = req.query;
  if (!umbrellaId || !groupId) {
    return res.status(400).json({ error: 'Missing umbrella or group id' });
  }

  const svc = getServiceClient();

  // Fetch existing group (also serves as the tenant-scoping guard)
  const { data: existing, error: fetchErr } = await svc
    .from('email_umbrella_groups')
    .select('*')
    .eq('id', groupId)
    .eq('umbrella_id', umbrellaId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!existing) return res.status(404).json({ error: 'Group not found' });

  // ── GET ──
  if (req.method === 'GET') {
    const { data: attachments, error: aErr } = await svc
      .from('email_umbrella_group_templates')
      .select('*, template:email_templates(id,name,system_slug,is_system,subject,is_active,body_format)')
      .eq('group_id', groupId)
      .eq('tenant_id', ctx.tenantId)
      .order('sort_order', { ascending: true });
    if (aErr) return res.status(500).json({ error: aErr.message });

    return res.status(200).json({
      group: {
        ...existing,
        templates: (attachments || []).map((a) => ({
          attachment_id: a.id,
          sort_order: a.sort_order,
          ...a.template,
        })),
      },
    });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const updates = {};

    if ('name' in body) {
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
      updates.name = name;
    }
    if ('is_active' in body) updates.is_active = !!body.is_active;
    if ('sort_order' in body) updates.sort_order = Number(body.sort_order) || 0;
    if ('reply_to' in body) {
      updates.reply_to = body.reply_to ? String(body.reply_to).trim() : null;
    }
    if ('to_recipients' in body) {
      updates.to_recipients = normalizeRecipients(body.to_recipients);
    }
    if ('cc_recipients' in body) {
      updates.cc_recipients = normalizeRecipients(body.cc_recipients);
    }
    if ('bcc_recipients' in body) {
      updates.bcc_recipients = normalizeRecipients(body.bcc_recipients);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    const { data, error } = await svc
      .from('email_umbrella_groups')
      .update(updates)
      .eq('id', groupId)
      .eq('umbrella_id', umbrellaId)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella_group.update',
      entityType: 'email_umbrella_group',
      entityId: data.id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ group: data });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { error: delErr } = await svc
      .from('email_umbrella_groups')
      .delete()
      .eq('id', groupId)
      .eq('umbrella_id', umbrellaId)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) return res.status(500).json({ error: delErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella_group.delete',
      entityType: 'email_umbrella_group',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
