import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../../lib/permissions';
import { AR_TEMPLATE_DEFAULTS, isArSystemSlug } from '../../../../../../../lib/email-dispatch';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { slug } = req.query;
  if (!isArSystemSlug(slug)) return res.status(400).json({ error: 'Unknown AR template slug' });

  const defaults = AR_TEMPLATE_DEFAULTS[slug];

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('email_templates')
    .update({
      subject: defaults.subject,
      body_text: defaults.body_text,
      body_html: defaults.body_html,
      body_format: defaults.body_format,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', ctx.tenantId)
    .eq('system_slug', slug)
    .eq('category', 'ar')
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'AR template row not found' });
  return res.status(200).json(data);
}
