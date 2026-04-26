import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { fetchDeliveryOrderData } from './render-delivery-order';
import { resolveTemplateConfig } from './resolve-template-config';
import DeliveryOrderTemplate from '../../components/pdf/DeliveryOrderTemplate';

/**
 * Render a multi-page PDF with one page per order id. Skips orders
 * that NEXT_MOVE variant deems ineligible (no remaining moves) AND
 * orders whose individual fetch failed (logged + skipped, never
 * fails the whole bulk).
 *
 * Each order resolves its own sectionConfig via the FU-035-A cascade
 * (customer-specific → tenant default → system default), so a bulk
 * print of N loads with M different bill-to customers can produce a
 * single PDF where each load uses its customer's custom template.
 * If the resolver returns undefined (no template stored), the
 * composer falls back to the section registry's defaults.
 *
 * Returns { buffer, skipped } where:
 *   buffer:  Buffer | null   (null if every order was skipped)
 *   skipped: string[]        (order ids that were skipped)
 */
export async function renderBulkDeliveryOrdersPdf(svc, orderIds, tenantId, variant) {
  const docs = [];
  const skipped = [];
  for (const id of orderIds) {
    try {
      const data = await fetchDeliveryOrderData(svc, id, tenantId, variant);
      if (data === null) {
        skipped.push(id);
        continue;
      }
      docs.push(data);
    } catch (e) {
      console.error(`bulk-print: order ${id} fetch failed:`, e.message);
      skipped.push(id);
    }
  }

  if (docs.length === 0) return { buffer: null, skipped };

  // Resolve each load's sectionConfig via the cascade. Parallelized
  // because each call is an independent SELECT.
  const perDocConfigs = await Promise.all(
    docs.map((d) =>
      resolveTemplateConfig(svc, tenantId, d.bill_to_customer_id, variant)
    )
  );

  const buffer = await renderToBuffer(
    React.createElement(DeliveryOrderTemplate, {
      docs,
      variant,
      perDocSectionConfigs: perDocConfigs,
    })
  );

  return { buffer, skipped };
}
