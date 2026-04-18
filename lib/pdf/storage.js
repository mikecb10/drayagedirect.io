/**
 * Thin Supabase Storage wrapper for PDF archival.
 * Used by:
 *   - lib/pdf/archive.js: writes rendered PDFs on email send (via 2a.2)
 *   - pages/api/tenant/pdf/invoice/[id].js: serves archived PDFs via signed URL
 *   - pages/api/tenant/pdf/rate-con/[id].js: same
 */

const BUCKET = 'documents';
const DEFAULT_SIGNED_URL_TTL_SECONDS = 900; // 15 min

/**
 * Upload a PDF Buffer to the tenant's Storage bucket.
 * @param {SupabaseClient} svc - service-role client
 * @param {Buffer} buffer - rendered PDF bytes
 * @param {string} path - full storage path, e.g. "{tenant_id}/invoices/{invoice_id}.pdf"
 * @returns {Promise<{ storagePath: string }>}
 */
export async function uploadPdfBuffer(svc, buffer, path) {
  const { error } = await svc.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: 'application/pdf',
      upsert: true, // support rebill + re-archive
    });
  if (error) {
    throw new Error(`PDF upload failed: ${error.message}`);
  }
  return { storagePath: path };
}

/**
 * Generate a short-lived signed URL for a stored PDF.
 * @param {SupabaseClient} svc
 * @param {string} storagePath - value from invoices.pdf_url or order_charge_sets.rate_con_pdf_url
 * @param {number} [ttlSeconds=900]
 * @returns {Promise<string>} signed URL
 */
export async function getSignedUrl(svc, storagePath, ttlSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS) {
  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Signed URL generation failed: ${error?.message || 'unknown error'}`);
  }
  return data.signedUrl;
}
