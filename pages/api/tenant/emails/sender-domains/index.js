import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../../lib/tenant-api';
import { logTenantAction, getClientIp } from '../../../../../lib/tenant-audit';
import { PERMISSIONS } from '../../../../../lib/permissions';

/**
 * /api/tenant/emails/sender-domains
 *
 * Tenant-owned email sending domains registered with SendGrid. A domain
 * is the thing you verify once (via CNAME DNS records for DKIM/SPF);
 * once verified, you can create any number of `tenant_sender_addresses`
 * rows on it (dispatch@, billing@, ops@ etc.) and each becomes a valid
 * From: identity in the configuration picker.
 *
 *   GET  — list all domains for the tenant with address_count + a
 *          summary of DNS record verification status
 *
 *   POST — register a new domain
 *          Body: { domain, default_from_name?, status?, dns_records? }
 *
 *          Phase 1 (Milestone 4a-1) behavior: accepts whatever status
 *          the caller sets. Real SendGrid domain-auth API integration
 *          (the "create a domain, get back DNS records, check
 *          verification state") lands in Milestone 4a-4. For single-
 *          sender verification workflows, callers can seed a domain
 *          with status='verified' + empty dns_records so a single
 *          sender address can be created under it.
 *
 * Permission gate: admin / super_admin only — senders are a trust
 * boundary.
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

const MAX_DOMAIN = 253; // RFC 1035
const DOMAIN_RE = /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

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
    const { data: domains, error } = await svc
      .from('tenant_sender_domains')
      .select('*, tenant_sender_addresses(count)')
      .eq('tenant_id', ctx.tenantId)
      .order('status', { ascending: true })
      .order('domain', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const rows = (domains || []).map((d) => ({
      ...d,
      address_count: d.tenant_sender_addresses?.[0]?.count ?? 0,
      tenant_sender_addresses: undefined,
    }));

    return res.status(200).json({ domains: rows });
  }

  // ── CREATE ──
  if (req.method === 'POST') {
    if (!requirePermission(ctx, WRITE_PERMS, res)) return;
    if (!isAdminOrSuper()) {
      return res.status(403).json({
        error:
          'Only admins or super_admins can register sender domains. Ask a super_admin to grant you admin role first.',
      });
    }

    const body = req.body || {};
    const domain = cleanStr(body.domain)?.toLowerCase();
    if (!domain) {
      return res.status(400).json({ error: 'domain is required' });
    }
    if (domain.length > MAX_DOMAIN) {
      return res.status(400).json({ error: `domain exceeds ${MAX_DOMAIN} characters` });
    }
    if (!DOMAIN_RE.test(domain)) {
      return res.status(400).json({ error: 'domain must be a valid hostname (e.g. carrier.com)' });
    }

    // Phase 1: accept caller-provided status / dns_records as-is. Default
    // to 'pending' so the UI shows the "not verified yet" state.
    const status = cleanStr(body.status) || 'pending';
    if (!VALID_STATUSES.has(status)) {
      return res.status(400).json({
        error: `status must be one of: ${Array.from(VALID_STATUSES).join(', ')}`,
      });
    }

    const dnsRecords = Array.isArray(body.dns_records) ? body.dns_records : [];

    const insertData = {
      tenant_id: ctx.tenantId,
      domain,
      status,
      dns_records: dnsRecords,
      default_from_name: cleanStr(body.default_from_name),
      sendgrid_domain_id: cleanStr(body.sendgrid_domain_id), // Phase 1: usually null
      created_by: ctx.userId,
    };

    const { data, error } = await svc
      .from('tenant_sender_domains')
      .insert(insertData)
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: `A sender domain for "${domain}" already exists`,
        });
      }
      return res.status(500).json({ error: error.message });
    }

    await logTenantAction(svc, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: 'sender_domain.create',
      entityType: 'tenant_sender_domain',
      entityId: data.id,
      oldValues: null,
      newValues: data,
      ipAddress: getClientIp(req),
    });

    return res.status(201).json({ domain: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
