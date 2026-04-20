// IMPORT DEPTH: pages/api/tenant/ar/charge-sets/email-defaults-bulk-rate-con.js -> repo root is ../../../../../
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import {
  buildBulkChargeSetContext,
  resolveBulkChargeSetRecipients,
} from '../../../../../lib/email-dispatch';
import { resolveEmailTemplate } from '../../../../../lib/email-variable-resolver';

export const config = { runtime: 'nodejs' };

/**
 * POST /api/tenant/ar/charge-sets/email-defaults-bulk-rate-con
 *
 * Returns pre-filled recipients/subject/body/attachments for a bulk
 * rate-con email. All charge_set_ids must belong to the same customer
 * (enforced by resolveBulkChargeSetRecipients).
 *
 * Request body:
 *   { charge_set_ids: string[], customer_id?: string }
 *
 * Response (mirrors email-defaults-bulk.js shape):
 *   {
 *     to: string[], cc: [], bcc: [],
 *     subject: string,
 *     body_text: string, body_html: string, body_format: string,
 *     recipients_source: string,
 *     attachments: Array<{ filename, preview_url, item_id, charge_set_id }>
 *   }
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { charge_set_ids, customer_id: customerIdHint } = req.body || {};

  if (!Array.isArray(charge_set_ids) || charge_set_ids.length === 0) {
    return res.status(400).json({ error: 'charge_set_ids (non-empty array) required' });
  }

  const svc = getServiceClient();

  try {
    // 1. Build context (validates tenant ownership, raises if missing)
    const { context, formatPrefs } = await buildBulkChargeSetContext(
      svc, ctx.tenantId, charge_set_ids
    );

    // 2. Derive customer_id. buildChargeSetContext spreads buildTriggerContext's
    //    output (which surfaces context.customer = { id, ... } at line 225-234
    //    of context-builder.js) and also sets context.charge_set.order =
    //    { customer_id } as a fallback. Prefer context.customer.id, fall back to
    //    the explicit charge_set.order.customer_id, then the hint.
    const customerId =
      context.customer?.id ||
      context.charge_set?.order?.customer_id ||
      customerIdHint;
    if (!customerId) {
      return res.status(400).json({ error: 'customer_id could not be resolved from charge-sets' });
    }

    // 3. Fetch AR rate-con template (seeded in migration 079 as
    //    system_slug='rate_con_send', category='ar').
    const { data: template, error: tplErr } = await svc
      .from('email_templates')
      .select('subject, body_html, body_text, body_format')
      .eq('tenant_id', ctx.tenantId)
      .eq('category', 'ar')
      .eq('system_slug', 'rate_con_send')
      .maybeSingle();
    if (tplErr) throw new Error(`Template lookup: ${tplErr.message}`);
    if (!template) {
      const err = new Error('AR rate-con template missing — configure in Settings > AR Configuration');
      err.code = 'TEMPLATE_NOT_FOUND';
      throw err;
    }

    // 4. Resolve subject + bodies against the bulk context
    const resolved = resolveEmailTemplate({
      subject: template.subject,
      body_html: template.body_html,
      body_text: template.body_text,
      context,
      formatPrefs,
    });

    // 5. Resolve recipients via cross-customer-guarded function
    const { to, source } = await resolveBulkChargeSetRecipients(
      svc, customerId, ctx.tenantId, 'rate_confirmation', charge_set_ids
    );

    // 6. Build attachments array (one per charge-set). `item_id` is the
    //    generalized ID field read by useBulkEmailQueue when building the
    //    bulk-send payload (Task 11 will consume this). Keep `charge_set_id`
    //    as a convenience alias for readability.
    const attachments = context.charge_sets.map((cs) => ({
      filename: `rate-con-${cs.charge_set_number || cs.id}.pdf`,
      preview_url: `/api/tenant/pdf/rate-con/${cs.id}`,
      item_id: cs.id,
      charge_set_id: cs.id,
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
    console.error('[email-defaults-bulk-rate-con] error:', e);
    return res.status(status).json({ error: e.message, code: e.code });
  }
}
