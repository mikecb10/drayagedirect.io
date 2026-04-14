import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../../lib/permissions';

/**
 * /api/tenant/emails/umbrellas/[id]/groups/[groupId]/templates
 *
 * Manages the template attachments on an email group. Each row in
 * email_umbrella_group_templates represents "when this umbrella's group
 * fires a trigger, include this template in the fan-out".
 *
 *   POST   — attach a template to the group
 *            Body: { template_id, sort_order? }
 *
 *   DELETE — detach a template from the group (batch-safe)
 *            Query: ?template_id=<uuid>  OR  ?attachment_id=<uuid>
 *
 *   PUT    — reorder all attachments in the group
 *            Body: { attachment_ids: [uuid, uuid, ...] } — the desired
 *            order. sort_order is assigned based on array position.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: umbrellaId, groupId } = req.query;
  if (!umbrellaId || !groupId) {
    return res.status(400).json({ error: 'Missing umbrella or group id' });
  }

  const svc = getServiceClient();

  // Tenant-scope guard — confirm the group belongs to the umbrella which
  // belongs to this tenant
  const { data: group, error: gErr } = await svc
    .from('email_umbrella_groups')
    .select('id, umbrella_id, tenant_id')
    .eq('id', groupId)
    .eq('umbrella_id', umbrellaId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (gErr) return res.status(500).json({ error: gErr.message });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // ── ATTACH template ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const templateId = body.template_id;
    if (!templateId) {
      return res.status(400).json({ error: 'template_id is required' });
    }

    // Confirm the template exists and belongs to this tenant
    const { data: tpl, error: tErr } = await svc
      .from('email_templates')
      .select('id, name')
      .eq('id', templateId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (tErr) return res.status(500).json({ error: tErr.message });
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    // Pick next sort_order
    const { data: existingAttachments } = await svc
      .from('email_umbrella_group_templates')
      .select('sort_order')
      .eq('group_id', groupId)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSortOrder =
      existingAttachments && existingAttachments[0]
        ? existingAttachments[0].sort_order + 1
        : 0;

    const { data, error } = await svc
      .from('email_umbrella_group_templates')
      .insert({
        tenant_id: ctx.tenantId,
        group_id: groupId,
        template_id: templateId,
        sort_order: nextSortOrder,
      })
      .select('*, template:email_templates(id,name,system_slug,is_system,subject,is_active,body_format)')
      .single();

    if (error) {
      // Unique constraint violation (template already attached to this group)
      if (error.code === '23505') {
        return res.status(409).json({
          error: 'This template is already attached to the group',
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella_group_template.attach',
      entityType: 'email_umbrella_group_template',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({
      attachment: {
        attachment_id: data.id,
        sort_order: data.sort_order,
        ...data.template,
      },
    });
  }

  // ── DETACH template ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { attachment_id, template_id } = req.query;
    if (!attachment_id && !template_id) {
      return res
        .status(400)
        .json({ error: 'Must provide attachment_id or template_id' });
    }

    let query = svc
      .from('email_umbrella_group_templates')
      .delete()
      .eq('group_id', groupId)
      .eq('tenant_id', ctx.tenantId);

    if (attachment_id) {
      query = query.eq('id', attachment_id);
    } else {
      query = query.eq('template_id', template_id);
    }

    const { error: delErr } = await query;
    if (delErr) return res.status(500).json({ error: delErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella_group_template.detach',
      entityType: 'email_umbrella_group_template',
      entityId: attachment_id || template_id,
      oldValues: null,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  // ── REORDER ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { attachment_ids } = req.body || {};
    if (!Array.isArray(attachment_ids)) {
      return res.status(400).json({ error: 'attachment_ids array is required' });
    }

    // Update each row with its new sort_order based on array position
    const updates = [];
    for (let i = 0; i < attachment_ids.length; i++) {
      updates.push(
        svc
          .from('email_umbrella_group_templates')
          .update({ sort_order: i })
          .eq('id', attachment_ids[i])
          .eq('group_id', groupId)
          .eq('tenant_id', ctx.tenantId)
      );
    }

    const results = await Promise.all(updates);
    for (const r of results) {
      if (r.error) {
        return res.status(500).json({ error: r.error.message });
      }
    }

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
