import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/sender-domains/[id]
 *
 *   GET    — fetch one domain with its full DNS record set
 *   PUT    — partial update of editable fields (status, dns_records,
 *            default_from_name, sendgrid_domain_id,
 *            last_verification_check_at, last_verification_error)
 *   DELETE — hard delete. Cascades to tenant_sender_addresses on this
 *            domain. Also NULLs out email_configurations.sender_address_id
 *            that pointed at any of this domain's addresses (via the
 *            existing ON DELETE SET NULL FK).
 *
 * Phase 1 note: PUT accepts a caller-provided status so operators can
 * manually mark a domain as 'verified' during single-sender testing.
 * In 4a-4 the "verified" transition is gated behind a successful call
 * to SendGrid's domain-auth validation API.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const VALID_STATUSES = new Set([
  'pending',
  'verifying',
  'verified',
  'failed',
  'revoked',
]);

const EDITABLE_FIELDS = new Set([
  'status',
  'dns_records',
  'default_from_name',
  'sendgrid_domain_id',
  'last_verification_check_at',
  'last_verification_error',
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
    return res.status(400).json({ error: 'Missing domain id' });
  }

  const svc = getServiceClient();

  const { data: existing, error: exErr } = await svc
    .from('tenant_sender_domains')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (exErr) return res.status(500).json({ error: exErr.message });
  if (!existing) return res.status(404).json({ error: 'Domain not found' });

  function isAdminOrSuper() {
    return ctx.role === 'admin' || ctx.role === 'super_admin';
  }

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ domain: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins or super_admins can edit sender domains' });
    }

    const body = req.body || {};
    const updates = {};
    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'status') {
        if (!VALID_STATUSES.has(body.status)) {
          return res.status(400).json({
            error: `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
          });
        }
        updates.status = body.status;
      } else if (key === 'dns_records') {
        updates.dns_records = Array.isArray(body.dns_records) ? body.dns_records : [];
      } else if (key === 'last_verification_check_at') {
        updates.last_verification_check_at = body.last_verification_check_at || null;
      } else {
        updates[key] = cleanStr(body[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    const { data, error } = await svc
      .from('tenant_sender_domains')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'sender_domain.update',
      entityType: 'tenant_sender_domain',
      entityId: data.id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ domain: data });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins or super_admins can delete sender domains' });
    }

    const { error } = await svc
      .from('tenant_sender_domains')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'sender_domain.delete',
      entityType: 'tenant_sender_domain',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
