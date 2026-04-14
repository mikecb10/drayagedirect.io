import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/shared-accounts/[id]
 *
 *   GET    — fetch a single shared account with its permission grants
 *   PUT    — partial update of the account metadata
 *   DELETE — soft-disable (set is_active=false) instead of hard delete.
 *            Keeps historical references intact (configurations that
 *            were pointing at this shared account will NULL out via
 *            ON DELETE SET NULL on shared_account_id).
 *
 * Phase 1 does not support re-connecting OAuth tokens via this route —
 * that's Milestone 4. For now PUT is metadata-only (display_name,
 * is_active, provider change).
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const EDITABLE_FIELDS = new Set([
  'display_name',
  'is_active',
]);

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

async function fetchFullAccount(svc, tenantId, accountId) {
  const { data: account, error } = await svc
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('tenant_id', tenantId)
    .eq('scope', 'tenant')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!account) return null;

  // Hide sensitive token columns
  delete account.access_token_encrypted;
  delete account.refresh_token_encrypted;

  // Fetch grants with user details
  const { data: grants } = await svc
    .from('email_account_permissions')
    .select('*, user:users(id, email, first_name, last_name, name, role)')
    .eq('account_id', accountId)
    .eq('tenant_id', tenantId);

  return {
    ...account,
    permissions: (grants || []).map((g) => ({
      ...g,
      user: g.user || null,
    })),
  };
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing shared account id' });
  }

  const svc = getServiceClient();

  let existing;
  try {
    existing = await fetchFullAccount(svc, ctx.tenantId, id);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!existing) {
    return res.status(404).json({ error: 'Shared account not found' });
  }

  function isAdminOrSuper() {
    return ctx.role === 'admin' || ctx.role === 'super_admin';
  }

  // ── GET ──
  if (req.method === 'GET') {
    return res.status(200).json({ shared_account: existing });
  }

  // ── PUT ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins/super_admins can edit shared accounts' });
    }

    const body = req.body || {};
    const updates = {};

    for (const key of Object.keys(body)) {
      if (!EDITABLE_FIELDS.has(key)) continue;
      if (key === 'is_active') {
        updates[key] = !!body[key];
      } else {
        updates[key] = cleanStr(body[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No editable fields in request' });
    }

    const { data, error } = await svc
      .from('email_accounts')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .eq('scope', 'tenant')
      .select('*')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    delete data.access_token_encrypted;
    delete data.refresh_token_encrypted;

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'shared_email_account.update',
      entityType: 'email_account',
      entityId: data.id,
      oldValues: existing,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ shared_account: data });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins/super_admins can delete shared accounts' });
    }

    // Hard-delete the shared account. The FK from email_configurations
    // .shared_account_id has ON DELETE SET NULL, so any configurations
    // pointing here will gracefully unlink.
    const { error } = await svc
      .from('email_accounts')
      .delete()
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
      .eq('scope', 'tenant');

    if (error) return res.status(500).json({ error: error.message });

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'shared_email_account.delete',
      entityType: 'email_account',
      entityId: existing.id,
      oldValues: existing,
      newValues: null,
      ipAddress: getClientIp(req),
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
