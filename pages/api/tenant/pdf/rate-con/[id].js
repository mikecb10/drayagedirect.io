import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderRateConPdf } from '../../../../../lib/pdf/render-rate-con';
import { getSignedUrl } from '../../../../../lib/pdf/storage';

export const config = {
  runtime: 'nodejs',
};

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

  // Check if archived
  const { data: row, error: fetchErr } = await svc
    .from('order_charge_sets')
    .select('id, rate_con_pdf_url')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  if (!row) return res.status(404).json({ error: 'Charge set not found' });

  if (row.rate_con_pdf_url) {
    try {
      const signedUrl = await getSignedUrl(svc, row.rate_con_pdf_url);
      return res.redirect(302, signedUrl);
    } catch (e) {
      console.error(`Rate con ${id}: archived file unreachable, falling back to re-render:`, e.message);
    }
  }

  // Render on demand
  try {
    const buffer = await renderRateConPdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="rate-con-${id}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    console.error(`Rate con ${id} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
