import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../../lib/permissions';

/**
 * /api/tenant/emails/umbrellas/[id]/groups
 *
 *   POST — Create a new email group inside an umbrella. The group
 *          owns its own recipient lists (To/CC/BCC) and gets attached
 *          templates via the [groupId]/templates child route.
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

  const { id: umbrellaId } = req.query;
  if (!umbrellaId) {
    return res.status(400).json({ error: 'Missing umbrella id' });
  }

  const svc = getServiceClient();

  // Verify the umbrella exists and belongs to this tenant
  const { data: umbrella, error: uErr } = await svc
    .from('email_umbrellas')
    .select('id, tenant_id')
    .eq('id', umbrellaId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (uErr) return res.status(500).json({ error: uErr.message });
  if (!umbrella) return res.status(404).json({ error: 'Umbrella not found' });

  // ── CREATE GROUP ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    // Pick sort_order = max + 1 so new groups append at the bottom
    const { data: existingGroups } = await svc
      .from('email_umbrella_groups')
      .select('sort_order')
      .eq('umbrella_id', umbrellaId)
      .order('sort_order', { ascending: false })
      .limit(1);
    const nextSortOrder =
      existingGroups && existingGroups[0] ? existingGroups[0].sort_order + 1 : 0;

    const row = {
      tenant_id: ctx.tenantId,
      umbrella_id: umbrellaId,
      name,
      sort_order: nextSortOrder,
      is_active: body.is_active !== false,
      to_recipients: normalizeRecipients(body.to_recipients),
      cc_recipients: normalizeRecipients(body.cc_recipients),
      bcc_recipients: normalizeRecipients(body.bcc_recipients),
      reply_to: body.reply_to ? String(body.reply_to).trim() : null,
    };

    const { data, error } = await svc
      .from('email_umbrella_groups')
      .insert(row)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_umbrella_group.create',
      entityType: 'email_umbrella_group',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ group: { ...data, templates: [] } });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
