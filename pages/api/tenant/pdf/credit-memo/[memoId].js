import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderCreditMemoPdf } from '../../../../../lib/pdf/render-credit-memo';

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

  const { memoId } = req.query;
  const svc = getServiceClient();

  try {
    const buffer = await renderCreditMemoPdf(svc, memoId, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="credit-memo-${memoId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Credit memo not found') {
      return res.status(404).json({ error: 'Credit memo not found' });
    }
    console.error(`Credit memo ${memoId} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
