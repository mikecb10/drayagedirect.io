import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import { AR_SYSTEM_SLUGS } from '../../../../../../lib/email-dispatch';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const svc = getServiceClient();

  const { data, error } = await svc
    .from('email_templates')
    .select('id, system_slug, name, description, subject, body_text, body_html, body_format, updated_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('category', 'ar')
    .in('system_slug', AR_SYSTEM_SLUGS);

  if (error) return res.status(500).json({ error: error.message });

  // Shape: { invoice_send: {...}, rate_con_send: {...} }
  const byslug = {};
  for (const row of data || []) {
    byslug[row.system_slug] = row;
  }
  return res.status(200).json(byslug);
}
