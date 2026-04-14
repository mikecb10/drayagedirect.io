import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/shared-accounts
 *
 * Manages email_accounts rows with scope='tenant' — the shared company
 * mailboxes (shared Gmail, Outlook, or SendGrid identities) that any
 * tenant user can send from if granted via email_account_permissions.
 *
 *   GET  — list all shared accounts for the current tenant.
 *          Each row includes permission_count (how many users have grants).
 *
 *   POST — create a new shared account "stub".
 *          Body: {
 *            email_address, display_name, provider,
 *            is_active?
 *          }
 *          NOTE: Phase 1 ships WITHOUT the real OAuth flow. This
 *          endpoint stores the metadata only — no tokens are captured.
 *          Milestone 4 will wire up the Gmail/Outlook OAuth redirect
 *          so the connected_by_user_id can actually authorize.
 *
 * Permission gate for CREATE: admin or super_admin role (shared accounts
 * are sensitive). The RLS policy on email_accounts also enforces this
 * at the DB level.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const VALID_PROVIDERS = new Set(['gmail', 'outlook', 'sendgrid']);

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  // Additional role check — only admin/super_admin can create shared
  // accounts (matches the RLS policy installed in migration 053's edit)
  function isAdminOrSuper() {
    return ctx.role === 'admin' || ctx.role === 'super_admin';
  }

  // ── LIST ──
  if (req.method === 'GET') {
    const { data: accounts, error } = await svc
      .from('email_accounts')
      .select(
        '*, email_account_permissions(count)'
      )
      .eq('tenant_id', ctx.tenantId)
      .eq('scope', 'tenant')
      .order('is_active', { ascending: false })
      .order('display_name', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const rows = (accounts || []).map((a) => ({
      ...a,
      permission_count: a.email_account_permissions?.[0]?.count ?? 0,
      email_account_permissions: undefined,
      // Never leak encrypted tokens to the client — they're server-only
      access_token_encrypted: undefined,
      refresh_token_encrypted: undefined,
    }));

    return res.status(200).json({ shared_accounts: rows });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res.status(403).json({
        error:
          'Only admins or super_admins can create shared email accounts. Ask a super_admin to grant you admin role first.',
      });
    }

    const body = req.body || {};
    const email = cleanStr(body.email_address);
    if (!email) {
      return res.status(400).json({ error: 'email_address is required' });
    }
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'email_address must be a valid email' });
    }

    const provider = cleanStr(body.provider);
    if (!VALID_PROVIDERS.has(provider)) {
      return res.status(400).json({
        error: `provider must be one of: ${Array.from(VALID_PROVIDERS).join(', ')}`,
      });
    }

    const insertData = {
      tenant_id: ctx.tenantId,
      scope: 'tenant',
      user_id: null, // tenant-scoped rows MUST have user_id NULL per schema CHECK
      connected_by_user_id: ctx.userId,
      email_address: email,
      display_name: cleanStr(body.display_name) || email,
      provider,
      is_active: body.is_active !== false,
      // Phase 1: no OAuth tokens captured yet
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expires_at: null,
      oauth_scopes: null,
    };

    const { data, error } = await svc
      .from('email_accounts')
      .insert(insertData)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: `A shared account already exists for ${email}`,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    // Hide encrypted tokens on the response
    delete data.access_token_encrypted;
    delete data.refresh_token_encrypted;

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'shared_email_account.create',
      entityType: 'email_account',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ shared_account: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
