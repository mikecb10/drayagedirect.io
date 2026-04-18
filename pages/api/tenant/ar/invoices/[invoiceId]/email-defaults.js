import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../../lib/permissions';
import {
  resolveBillingRecipients,
  buildInvoiceContext,
} from '../../../../../../lib/email-dispatch';
import { resolveEmailTemplate } from '../../../../../../lib/email-variable-resolver';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { invoiceId: id } = req.query;
  const svc = getServiceClient();

  try {
    // 1. Build context (hydrates invoice.*, charge_set.*, load.*, customer.*, etc.)
    const context = await buildInvoiceContext(svc, id, ctx.tenantId);

    // 2. Fetch tenant format preferences so currency/date tokens render correctly
    const { data: formatPrefs } = await svc
      .from('tenant_format_preferences')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle();
    // formatPrefs may be null — resolveEmailTemplate merges FORMAT_DEFAULTS as fallback

    // 3. Resolve recipients
    const recipients = await resolveBillingRecipients(
      svc,
      context.invoice?.customer_id ?? context.customer?.id,
      ctx.tenantId,
      'invoice'
    );

    // 4. Fetch template
    const { data: template, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body_text, body_html, body_format')
      .eq('tenant_id', ctx.tenantId)
      .eq('system_slug', 'invoice_send')
      .eq('category', 'ar')
      .maybeSingle();
    if (tplErr) throw new Error(`Template lookup: ${tplErr.message}`);
    if (!template) throw new Error('invoice_send template not seeded — run migration 079');

    // 5. Render subject + bodies in one pass
    const resolved = resolveEmailTemplate({
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text,
      context,
      formatPrefs: formatPrefs || null,
    });

    // Derive the invoice number from the context for the attachment filename
    const invoiceNumber = context.invoice?.number;

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
        filename: `invoice-${invoiceNumber || id}.pdf`,
        preview_url: `/api/tenant/pdf/invoice/${id}`,
      },
    });
  } catch (e) {
    const status = e.message === 'Invoice not found' ? 404 : 500;
    return res.status(status).json({ error: e.message });
  }
}
