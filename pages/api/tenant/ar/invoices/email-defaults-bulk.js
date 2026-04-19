import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import {
  buildBulkInvoiceContext,
  resolveBulkBillingRecipients,
} from '../../../../../lib/email-dispatch';
import { resolveEmailTemplate } from '../../../../../lib/email-variable-resolver';

export const config = { runtime: 'nodejs' };

/**
 * POST /api/tenant/ar/invoices/email-defaults-bulk
 *
 * Returns pre-filled recipients/subject/body/attachments for a bulk invoice email.
 * All invoice_ids must belong to the same customer (enforced by resolveBulkBillingRecipients).
 *
 * Request body:
 *   { invoice_ids: string[], customer_id?: string }
 *
 * Response (mirrors single-invoice email-defaults.js shape):
 *   {
 *     to: string[],
 *     cc: [],
 *     bcc: [],
 *     subject: string,
 *     body_text: string,
 *     body_html: string,
 *     body_format: string,
 *     recipients_source: string,
 *     attachments: Array<{ filename: string, preview_url: string, invoice_id: string }>
 *   }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { invoice_ids, customer_id: customerIdHint } = req.body || {};

  if (!Array.isArray(invoice_ids) || invoice_ids.length === 0) {
    return res.status(400).json({ error: 'invoice_ids (non-empty array) required' });
  }

  const svc = getServiceClient();

  try {
    // 1. Build context from all invoices (validates tenant ownership + soft-delete guard)
    //    buildBulkInvoiceContext signature: (svc, tenantId, invoiceIds)
    const { context, formatPrefs } = await buildBulkInvoiceContext(svc, ctx.tenantId, invoice_ids);

    // 2. Derive customer_id from first invoice (all invoices share it by contract)
    const customerId = context.invoice?.customer_id || customerIdHint;
    if (!customerId) {
      return res.status(400).json({ error: 'customer_id could not be resolved from invoices' });
    }

    // 3. Fetch AR invoice template
    const { data: template, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body_html, body_text, body_format')
      .eq('tenant_id', ctx.tenantId)
      .eq('category', 'ar')
      .eq('system_slug', 'invoice_send')
      .maybeSingle();
    if (tplErr) throw new Error(`Template lookup: ${tplErr.message}`);
    if (!template) {
      const err = new Error('AR invoice template missing — configure in Settings > AR Configuration');
      err.code = 'TEMPLATE_NOT_FOUND';
      throw err;
    }

    // 4. Resolve subject + bodies against the bulk context
    //    resolveEmailTemplate signature: ({ subject, body_html, body_text, context, formatPrefs })
    const resolved = resolveEmailTemplate({
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text,
      context,
      formatPrefs,
    });

    // 5. Resolve recipients via cross-customer-guarded function
    //    resolveBulkBillingRecipients signature: (svc, customerId, tenantId, emailType, invoiceIds)
    const { to, source } = await resolveBulkBillingRecipients(
      svc, customerId, ctx.tenantId, 'invoice', invoice_ids
    );

    // 6. Build attachments array (one per invoice)
    //    invoices.invoice_number is a single field (not invoice_number_base + rebill_count)
    const attachments = context.invoices.map((inv) => ({
      filename: `invoice-${inv.invoice_number || inv.id}.pdf`,
      preview_url: `/api/tenant/pdf/invoice/${inv.id}`,
      invoice_id: inv.id,
    }));

    return res.status(200).json({
      to,
      cc: [],
      bcc: [],
      subject: resolved.subject,
      body_text: resolved.text,
      body_html: resolved.html,
      body_format: template.body_format,
      recipients_source: source,
      attachments,
    });
  } catch (e) {
    const status = (e.code === 'NOT_FOUND' || e.code === 'TEMPLATE_NOT_FOUND') ? 404 : 500;
    console.error('[email-defaults-bulk] error:', e);
    return res.status(status).json({ error: e.message, code: e.code });
  }
}
