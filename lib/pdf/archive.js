/**
 * PDF archive orchestrators.
 *
 * Called by sub-project 2a.2 (email popup) on "Send" action to:
 *   1. Render the PDF from current DB state
 *   2. Upload to the tenant's Storage bucket
 *   3. Write the storage path to the DB column (invoices.pdf_url
 *      or order_charge_sets.rate_con_pdf_url)
 *
 * After archive, subsequent calls to /api/tenant/pdf/{type}/[id] serve
 * the archived file rather than re-rendering from (potentially
 * changed) DB state — preserving the audit record of "what was sent".
 *
 * 2a.1 ships these helpers EXPORTED BUT UNCALLED. No 2a.1 code path
 * triggers archival; this is infrastructure for 2a.2 to consume.
 */

import { renderInvoicePdf } from './render-invoice';
import { renderRateConPdf } from './render-rate-con';
import { uploadPdfBuffer } from './storage';

/**
 * Render, upload, and record an invoice PDF.
 *
 * Callers that already have a freshly-rendered Buffer (e.g., the AR
 * send endpoint, which needs the bytes for the email attachment)
 * can pass it as `preRendered` to skip the internal render — the
 * uploaded file and the in-memory attachment then come from the
 * same byte sequence.
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} invoiceId
 * @param {string} tenantId
 * @param {Buffer | null} [preRendered=null] - optional pre-rendered PDF buffer
 * @returns {Promise<string>} the storage path written to invoices.pdf_url
 */
export async function archiveInvoicePdf(svc, invoiceId, tenantId, preRendered = null) {
  const buffer = preRendered || await renderInvoicePdf(svc, invoiceId, tenantId);
  const path = `${tenantId}/invoices/${invoiceId}.pdf`;
  await uploadPdfBuffer(svc, buffer, path);

  const { error } = await svc
    .from('invoices')
    .update({ pdf_url: path })
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`DB update after archive failed: ${error.message}`);

  return path;
}

/**
 * Render, upload, and record a rate confirmation PDF.
 *
 * See `archiveInvoicePdf` for the `preRendered` pass-through rationale.
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} chargeSetId
 * @param {string} tenantId
 * @param {Buffer | null} [preRendered=null] - optional pre-rendered PDF buffer
 * @returns {Promise<string>} the storage path written to order_charge_sets.rate_con_pdf_url
 */
export async function archiveRateConPdf(svc, chargeSetId, tenantId, preRendered = null) {
  const buffer = preRendered || await renderRateConPdf(svc, chargeSetId, tenantId);
  const path = `${tenantId}/rate-cons/${chargeSetId}.pdf`;
  await uploadPdfBuffer(svc, buffer, path);

  const { error } = await svc
    .from('order_charge_sets')
    .update({ rate_con_pdf_url: path })
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(`DB update after archive failed: ${error.message}`);

  return path;
}
