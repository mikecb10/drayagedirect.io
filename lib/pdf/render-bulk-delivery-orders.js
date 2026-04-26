import React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { fetchDeliveryOrderData } from './render-delivery-order';
import DeliveryOrderTemplate from '../../components/pdf/DeliveryOrderTemplate';

/**
 * Render a multi-page PDF with one page per order id. Skips orders
 * that NEXT_MOVE variant deems ineligible (no remaining moves) AND
 * orders whose individual fetch failed (logged + skipped, never
 * fails the whole bulk).
 *
 * Returns { buffer, skipped } where:
 *   buffer:  Buffer | null   (null if every order was skipped)
 *   skipped: string[]        (order ids that were skipped)
 *
 * FU-035 will inject per-doc sectionConfig (resolved per
 * bill_to_customer_id) via a future cascade resolver. v1 passes
 * undefined so the composer uses registry defaults.
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

  // FU-035 hook (intentionally commented; ship in that FU):
  // const perDocConfigs = await Promise.all(
  //   docs.map(d => resolveTemplateConfig(svc, tenantId, d.bill_to_customer_id, variant))
  // );

  const buffer = await renderToBuffer(
    React.createElement(DeliveryOrderTemplate, {
      docs,
      variant,
      sectionConfig: undefined,
    })
  );

  return { buffer, skipped };
}
