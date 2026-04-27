import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderPodPdf } from '../../../../../lib/pdf/render-pod';

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

  try {
    const buffer = await renderPodPdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="pod-${id}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Order not found') {
      return res.status(404).json({ error: 'Order not found' });
    }
    console.error(`POD ${id} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
