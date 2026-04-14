import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { resolveSenderColumns } from './index';
import { fetchFullConfiguration } from '../../../../../lib/email-configuration-helpers';

/**
 * /api/tenant/emails/configurations/[id]
 *
 *   GET    — fetch a single configuration with attached umbrellas + sender
 *            entity eager-loaded
 *   PUT    — partial update. Supports sender_kind switch (flips the 3
 *            mutually-exclusive columns atomically).
 *   DELETE — delete the configuration (cascade removes junction rows)
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

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
    return res.status(400).json({ error: 'Missing configuration id' });
  }

  const svc = getServiceClient();

  let existing;
  try {
    existing = await fetchFullConfiguration(svc, ctx.tenantId, id);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!existing) {
    return res.status(404).json({ error: 'Configuration not found' });
  }

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ configuration: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const body = req.body || {};
    const updates = {};

    if ('name' in body) {
      const name = cleanStr(body.name);
      if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
      updates.name = name;
    }
    if ('description' in body) {
      updates.description = cleanStr(body.description);
    }
    if ('is_active' in body) updates.is_active = !!body.is_active;
    if ('priority' in body) {
      const n = Number(body.priority);
      if (!Number.isFinite(n)) {
        return res.status(400).json({ error: 'priority must be a number' });
      }
      updates.priority = n;
    }

    // Sender kind change — must flip all 3 columns atomically
    if ('sender_kind' in body) {
      const sender = resolveSenderColumns(body);
      if (!sender.ok) return res.status(400).json({ error: sender.error });
      updates.sender_address_id = sender.cols.sender_address_id;
      updates.shared_account_id = sender.cols.shared_account_id;
      updates.use_user_gmail = sender.cols.use_user_gmail;
    }

    // is_default change — unset any existing default first (partial unique)
    if ('is_default' in body) {
      if (body.is_default === true && !existing.is_default) {
        await svc
          .from('email_configurations')
          .update({ is_default: false })
          .eq('tenant_id', ctx.tenantId)
          .eq('is_default', true);
      }
      updates.is_default = !!body.is_default;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    const { data: updated, error: updErr } = await svc
      .from('email_configurations')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .select('*')
      .single();

    if (updErr) return res.status(500).json({ error: updErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_configuration.update',
      entityType: 'email_configuration',
      entityId: updated.id,
      oldValues: existing,
      newValues: updated,
      ipAddress: getClientIp(req),
    });

    // Return the full refreshed configuration so the editor stays in sync
    try {
      const refreshed = await fetchFullConfiguration(svc, ctx.tenantId, id);
      return res.status(200).json({ configuration: refreshed });
    } catch (e) {
      return res.status(200).json({ configuration: updated });
    }
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;

    const { error: delErr } = await svc
      .from('email_configurations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId);

    if (delErr) return res.status(500).json({ error: delErr.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'email_configuration.delete',
      entityType: 'email_configuration',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
