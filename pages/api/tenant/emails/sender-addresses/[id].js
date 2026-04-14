import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/sender-addresses/[id]
 *
 *   GET    — fetch a single address with its parent domain joined
 *   PUT    — partial update (display_name, reply_to, is_active,
 *            is_default). local_part + domain_id are immutable once
 *            set — to change those, delete + recreate.
 *   DELETE — delete the address. email_configurations that reference
 *            this address via sender_address_id will NULL out per the
 *            ON DELETE SET NULL FK on that column.
 *
 * Permission gate: admin / super_admin.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const EDITABLE_FIELDS = new Set([
  'display_name',
  'reply_to',
  'is_active',
  'is_default',
]);

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing address id' });
  }

  const svc = getServiceClient();

  const { data: existing, error: exErr } = await svc
    .from('tenant_sender_addresses')
    .select('*, domain:tenant_sender_domains!inner(id, domain, status)')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (exErr) return res.status(500).json({ error: exErr.message });
  if (!existing) return res.status(404).json({ error: 'Sender address not found' });

  function isAdminOrSuper() {
    return ctx.role === 'admin' || ctx.role === 'super_admin';
  }

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({
      address: {
        ...existing,
        full_address: `${existing.local_part}@${existing.domain.domain}`,
        domain_name: existing.domain.domain,
        domain_status: existing.domain.status,
      },
    });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins or super_admins can edit sender addresses' });
    }

    const body = req.body || {};
    const updates = {};
    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'is_active' || key === 'is_default') {
        updates[key] = !!body[key];
      } else {
        updates[key] = cleanStr(body[key]);
      }
    }

    // If setting is_default=true, unset any prior default
    if (updates.is_default === true && existing.is_default !== true) {
      await svc
        .from('tenant_sender_addresses')
        .update({ is_default: false })
        .eq('tenant_id', ctx.tenantId)
        .eq('is_default', true);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    const { data, error } = await svc
      .from('tenant_sender_addresses')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*, domain:tenant_sender_domains!inner(id, domain, status)')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'sender_address.update',
      entityType: 'tenant_sender_address',
      entityId: data.id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({
      address: {
        ...data,
        full_address: `${data.local_part}@${data.domain.domain}`,
        domain_name: data.domain.domain,
        domain_status: data.domain.status,
      },
    });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins or super_admins can delete sender addresses' });
    }

    const { error } = await svc
      .from('tenant_sender_addresses')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'sender_address.delete',
      entityType: 'tenant_sender_address',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
