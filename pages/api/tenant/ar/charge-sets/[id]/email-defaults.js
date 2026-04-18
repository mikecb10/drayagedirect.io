import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import {
  resolveBillingRecipients,
  buildChargeSetContext,
} from '../../../../../../lib/email-dispatch';
import { resolveEmailTemplate } from '../../../../../../lib/email-variable-resolver';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { id } = req.query;
  const svc = getServiceClient();

  try {
    // 1. Build context + format prefs in one call (builder surfaces both now)
    const { context, formatPrefs } = await buildChargeSetContext(svc, id, ctx.tenantId);

    // 2. Resolve recipients — customer FK may live on context.customer or nested on charge_set.order
    const customerId = context.customer?.id ?? context.charge_set?.order?.customer_id;
    const recipients = await resolveBillingRecipients(
      svc,
      customerId,
      ctx.tenantId,
      'rate_confirmation'
    );

    // 3. Fetch template
    const { data: template, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body_text, body_html, body_format')
      .eq('tenant_id', ctx.tenantId)
      .eq('system_slug', 'rate_con_send')
      .eq('category', 'ar')
      .maybeSingle();
    if (tplErr) throw new Error(`Template lookup: ${tplErr.message}`);
    if (!template) throw new Error('rate_con_send template not seeded — run migration 079');

    // 4. Render subject + bodies in one pass
    const resolved = resolveEmailTemplate({
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text,
      context,
      formatPrefs,
    });

    const chargeSetNumber = context.charge_set?.number;

    return res.status(200).json({
      to: recipients.to,
      cc: [],
      bcc: [],
      subject: resolved.subject,
      body_text: resolved.text,
      body_html: resolved.html,
      body_format: template.body_format,
      recipients_source: recipients.source,
      attachment: {
        filename: `rate-con-${chargeSetNumber || id}.pdf`,
        preview_url: `/api/tenant/pdf/rate-con/${id}`,
      },
    });
  } catch (e) {
    const status = e.code === 'NOT_FOUND' ? 404 : 500;
    return res.status(status).json({ error: e.message });
  }
}
