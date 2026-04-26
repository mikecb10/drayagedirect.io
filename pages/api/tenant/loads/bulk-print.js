import {
  requireTenantUser,
  requirePermission,
  getServiceClient,
} from '../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../lib/permissions';
import { renderBulkDeliveryOrdersPdf } from '../../../../lib/pdf/render-bulk-delivery-orders';
import { isValidDocumentType } from '../../../../lib/constants/document-types';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (
    !requirePermission(
      ctx,
      [PERMISSIONS.DISPATCHING, PERMISSIONS.ORDER_ENTRY, PERMISSIONS.ALL],
      res
    )
  ) {
    return;
  }

  const { ids, variant } = req.body || {};

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (ids.some((id) => typeof id !== 'string' || id.length === 0)) {
    return res.status(400).json({ error: 'ids must contain non-empty strings' });
  }
  if (!isValidDocumentType(variant)) {
    return res.status(400).json({ error: `invalid variant: ${variant}` });
  }
  // Allow only the delivery_order_* variants on this endpoint; future doc
  // types bound here would be added explicitly rather than implicitly.
  if (!variant.startsWith('delivery_order_')) {
    return res.status(400).json({ error: `unsupported variant for this endpoint: ${variant}` });
  }

  const svc = getServiceClient();

  try {
    const { buffer, skipped } = await renderBulkDeliveryOrdersPdf(
      svc,
      ids,
      ctx.tenantId,
      variant
    );

    if (buffer === null) {
      return res.status(422).json({
        error: 'No printable loads',
        skipped,
        skippedCount: skipped.length,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="delivery-orders-${variant}-${Date.now()}.pdf"`
    );
    res.setHeader('X-Skipped-Count', String(skipped.length));
    if (skipped.length > 0) {
      res.setHeader('X-Skipped-Load-Ids', skipped.join(','));
    }
    return res.send(buffer);
  } catch (e) {
    console.error('bulk-print failed:', e);
    return res.status(500).json({ error: e.message || 'Render failed' });
  }
}
