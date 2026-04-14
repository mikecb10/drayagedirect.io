import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../../lib/permissions';

/**
 * /api/tenant/emails/shared-accounts/[id]/permissions
 *
 *   GET — list all permission grants for this shared account.
 *         Returns an array of { user_id, can_send, can_view_inbox, user: {...} }.
 *
 *   PUT — bulk-replace the permission set for this account.
 *         Body: { grants: [{ user_id, can_send, can_view_inbox }, ...] }
 *
 *         Diffs against the existing grants:
 *           - Users in the new set that weren't granted before → INSERT
 *           - Users that were granted before but aren't in the new set → DELETE
 *           - Users in both sets → UPDATE their can_send/can_view_inbox values
 *
 * Permission gate: admin / super_admin only. RLS on the permissions
 * table enforces this at the DB level as well.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const { id: accountId } = req.query;
  if (!accountId) {
    return res.status(400).json({ error: 'Missing shared account id' });
  }

  const svc = getServiceClient();

  // Scope guard — confirm the shared account belongs to this tenant
  const { data: account, error: aErr } = await svc
    .from('email_accounts')
    .select('id, tenant_id, scope')
    .eq('id', accountId)
    .eq('tenant_id', ctx.tenantId)
    .eq('scope', 'tenant')
    .maybeSingle();
  if (aErr) return res.status(500).json({ error: aErr.message });
  if (!account) {
    return res.status(404).json({ error: 'Shared account not found' });
  }

  function isAdminOrSuper() {
    return ctx.role === 'admin' || ctx.role === 'super_admin';
  }

  // ── GET grants ──
  if (req.method === 'GET') {
    const { data: grants, error } = await svc
      .from('email_account_permissions')
      .select('*, user:users(id, email, first_name, last_name, name, role)')
      .eq('account_id', accountId)
      .eq('tenant_id', ctx.tenantId);

    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({
      permissions: (grants || []).map((g) => ({
        id: g.id,
        account_id: g.account_id,
        user_id: g.user_id,
        can_send: g.can_send,
        can_view_inbox: g.can_view_inbox,
        granted_by_user_id: g.granted_by_user_id,
        created_at: g.created_at,
        updated_at: g.updated_at,
        user: g.user || null,
      })),
    });
  }

  // ── BULK UPDATE grants ──
  if (req.method === 'PUT') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res
        .status(403)
        .json({ error: 'Only admins/super_admins can manage shared account permissions' });
    }

    const body = req.body || {};
    if (!Array.isArray(body.grants)) {
      return res.status(400).json({ error: 'grants must be an array' });
    }

    // Validate each grant shape
    const targetGrants = [];
    for (const g of body.grants) {
      if (!g || typeof g !== 'object') {
        return res.status(400).json({ error: 'each grant must be an object' });
      }
      if (!g.user_id) {
        return res.status(400).json({ error: 'each grant needs user_id' });
      }
      targetGrants.push({
        user_id: g.user_id,
        can_send: g.can_send !== false,
        can_view_inbox: g.can_view_inbox !== false,
      });
    }

    // Fetch existing grants
    const { data: existing, error: exErr } = await svc
      .from('email_account_permissions')
      .select('*')
      .eq('account_id', accountId)
      .eq('tenant_id', ctx.tenantId);
    if (exErr) return res.status(500).json({ error: exErr.message });

    const existingByUser = new Map();
    for (const row of existing || []) {
      existingByUser.set(row.user_id, row);
    }
    const targetByUser = new Map();
    for (const g of targetGrants) {
      targetByUser.set(g.user_id, g);
    }

    const toInsert = [];
    const toUpdate = [];
    const toDelete = [];

    // New / updated
    for (const [userId, target] of targetByUser.entries()) {
      const prev = existingByUser.get(userId);
      if (!prev) {
        toInsert.push({
          tenant_id: ctx.tenantId,
          account_id: accountId,
          user_id: userId,
          can_send: target.can_send,
          can_view_inbox: target.can_view_inbox,
          granted_by_user_id: ctx.userId,
        });
      } else if (
        prev.can_send !== target.can_send ||
        prev.can_view_inbox !== target.can_view_inbox
      ) {
        toUpdate.push({
          id: prev.id,
          can_send: target.can_send,
          can_view_inbox: target.can_view_inbox,
        });
      }
    }

    // Removed
    for (const [userId, prev] of existingByUser.entries()) {
      if (!targetByUser.has(userId)) {
        toDelete.push(prev.id);
      }
    }

    // Apply. These don't need to be in a single transaction — each
    // row is independent and a partial failure just means the admin
    // needs to retry with the remaining diff.
    try {
      if (toInsert.length > 0) {
        const { error } = await svc
          .from('email_account_permissions')
          .insert(toInsert);
        if (error) throw new Error(`insert: ${error.message}`);
      }

      for (const upd of toUpdate) {
        const { error } = await svc
          .from('email_account_permissions')
          .update({
            can_send: upd.can_send,
            can_view_inbox: upd.can_view_inbox,
          })
          .eq('id', upd.id)
          .eq('tenant_id', ctx.tenantId);
        if (error) throw new Error(`update: ${error.message}`);
      }

      if (toDelete.length > 0) {
        const { error } = await svc
          .from('email_account_permissions')
          .delete()
          .in('id', toDelete)
          .eq('tenant_id', ctx.tenantId);
        if (error) throw new Error(`delete: ${error.message}`);
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'shared_email_account.permissions_updated',
      entityType: 'email_account',
      entityId: accountId,
      oldValues: { count: existing?.length || 0 },
      newValues: {
        inserted: toInsert.length,
        updated: toUpdate.length,
        deleted: toDelete.length,
      },
      ipAddress: getClientIp(req),
    });

    // Re-fetch the current state and return it
    const { data: refreshed } = await svc
      .from('email_account_permissions')
      .select('*, user:users(id, email, first_name, last_name, name, role)')
      .eq('account_id', accountId)
      .eq('tenant_id', ctx.tenantId);

    return res.status(200).json({
      permissions: refreshed || [],
      diff: {
        inserted: toInsert.length,
        updated: toUpdate.length,
        deleted: toDelete.length,
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
