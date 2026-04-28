import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderStatementPdf } from '../../../../../lib/pdf/render-statement';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { customerId } = req.query;
  const asOfDate = req.query.asOfDate || null;  // 'YYYY-MM-DD' or undefined
  const svc = getServiceClient();

  try {
    const buffer = await renderStatementPdf(svc, customerId, ctx.tenantId, asOfDate);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${customerId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    console.error(`Statement ${customerId} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
