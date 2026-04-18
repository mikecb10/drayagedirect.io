import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderInvoicePdf } from '../../../../../lib/pdf/render-invoice';
import { getSignedUrl } from '../../../../../lib/pdf/storage';

export const config = {
  // React-PDF needs Node APIs. Explicit pin against future Edge defaults.
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { id } = req.query;
  const svc = getServiceClient();

  // Check if archived
  const { data: row, error: fetchErr } = await svc
    .from('invoices')
    .select('id, pdf_url')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!row) return res.status(404).json({ error: 'Invoice not found' });

  if (row.pdf_url) {
    try {
      const signedUrl = await getSignedUrl(svc, row.pdf_url);
      return res.redirect(302, signedUrl);
    } catch (e) {
      console.error(`Invoice ${id}: archived file unreachable, falling back to re-render:`, e.message);
    }
  }

  // Render on demand (drafts or fallback)
  try {
    const buffer = await renderInvoicePdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${id}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    console.error(`Invoice ${id} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
