import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/sender-addresses
 *
 * Specific From: identities on a verified sender domain. Once a
 * tenant_sender_domains row is verified, users create named addresses
 * under it — dispatch@, billing@, ops@ — each with a friendly display
 * name that the configuration picker shows.
 *
 *   GET  — list all addresses for the tenant. Joins the parent domain
 *          so the UI can render "dispatch@carrier.com" without an extra
 *          lookup. Supports ?domain_id=<uuid> to filter to one domain.
 *
 *   POST — create a new address.
 *          Body: {
 *            domain_id,
 *            local_part,
 *            display_name,
 *            reply_to?,
 *            is_active?,
 *            is_default?
 *          }
 *
 *          If is_default=true, any existing default address on the
 *          tenant is unset first (the partial unique index enforces
 *          one default per tenant).
 *
 *          Phase 1 (Milestone 4a-1) does NOT validate that the parent
 *          domain is verified — the config editor will let users pick
 *          an address on an unverified domain, but 4a-2's SendGrid
 *          adapter will refuse to dispatch it. That way single-sender
 *          verification flows (where the "domain" is really just a
 *          placeholder row) still work for testing.
 *
 * Permission gate: admin / super_admin.
 */

const WRITE_PERMS = [
  PERMISSIONS.MANAGE_SYSTEM_EMAILS,
  PERMISSIONS.SETTINGS,
  PERMISSIONS.ALL,
];

const MAX_LOCAL = 64; // RFC 5321
// Conservative local-part pattern — letters, digits, dot, dash, underscore, plus.
// Not trying to match the full RFC grammar, just reject obvious garbage.
const LOCAL_PART_RE = /^[a-z0-9._+-]+$/i;

function cleanStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export default async function handler(req, res) {
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;

  const svc = getServiceClient();

  function isAdminOrSuper() {
    return ctx.role === 'admin' || ctx.role === 'super_admin';
  }

  // ── LIST ──
  if (req.method === 'GET') {
    const { domain_id: domainId } = req.query;

    let query = svc
      .from('tenant_sender_addresses')
      .select(
        '*, domain:tenant_sender_domains!inner(id, domain, status, default_from_name)'
      )
      .eq('tenant_id', ctx.tenantId)
      .order('is_default', { ascending: false })
      .order('is_active', { ascending: false })
      .order('display_name', { ascending: true });

    if (domainId && typeof domainId === 'string') {
      query = query.eq('domain_id', domainId);
    }

    const { data: addresses, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // Flatten the domain join for easier consumption + add a computed
    // `full_address` field that the picker UIs can display directly.
    const rows = (addresses || []).map((a) => ({
      ...a,
      full_address: a.domain?.domain
        ? `${a.local_part}@${a.domain.domain}`
        : a.local_part,
      domain_name: a.domain?.domain || null,
      domain_status: a.domain?.status || null,
    }));

    return res.status(200).json({ addresses: rows });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res.status(403).json({
        error: 'Only admins or super_admins can create sender addresses',
      });
    }

    const body = req.body || {};
    const domainId = cleanStr(body.domain_id);
    if (!domainId) {
      return res.status(400).json({ error: 'domain_id is required' });
    }

    const localPart = cleanStr(body.local_part)?.toLowerCase();
    if (!localPart) {
      return res.status(400).json({ error: 'local_part is required' });
    }
    if (localPart.length > MAX_LOCAL) {
      return res.status(400).json({ error: `local_part exceeds ${MAX_LOCAL} characters` });
    }
    if (!LOCAL_PART_RE.test(localPart)) {
      return res.status(400).json({
        error: 'local_part must contain only letters, digits, dot, dash, underscore, or plus',
      });
    }

    const displayName = cleanStr(body.display_name);
    if (!displayName) {
      return res.status(400).json({ error: 'display_name is required' });
    }

    // Scope guard — confirm the parent domain belongs to this tenant
    const { data: domain } = await svc
      .from('tenant_sender_domains')
      .select('id, tenant_id, domain, status')
      .eq('id', domainId)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    if (!domain) {
      return res.status(404).json({ error: 'Sender domain not found' });
    }

    // If user wants this to be default, clear any existing default first
    // (partial unique index enforces one default per tenant).
    if (body.is_default === true) {
      await svc
        .from('tenant_sender_addresses')
        .update({ is_default: false })
        .eq('tenant_id', ctx.tenantId)
        .eq('is_default', true);
    }

    const insertData = {
      tenant_id: ctx.tenantId,
      domain_id: domainId,
      local_part: localPart,
      display_name: displayName,
      reply_to: cleanStr(body.reply_to),
      is_active: body.is_active !== false,
      is_default: !!body.is_default,
    };

    const { data, error } = await svc
      .from('tenant_sender_addresses')
      .insert(insertData)
      .select('*, domain:tenant_sender_domains!inner(id, domain, status)')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: `Address "${localPart}@${domain.domain}" already exists`,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'sender_address.create',
      entityType: 'tenant_sender_address',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({
      address: {
        ...data,
        full_address: `${data.local_part}@${data.domain.domain}`,
        domain_name: data.domain.domain,
        domain_status: data.domain.status,
      },
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
