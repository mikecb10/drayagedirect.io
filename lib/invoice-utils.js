/**
 * Invoice number utilities for QuickBooks-compatible numbering.
 *
 * Format: {SCAC3}{seq6}{Rn?}
 *   - ABC001001      (original, 9 chars)
 *   - ABC001001R1    (1st rebill, 11 chars)
 *   - ABC001001R9    (9th rebill, 11 chars)
 *
 * Max 11 characters total — works with QuickBooks Desktop's RefNumber
 * limit AND QuickBooks Online's DocNumber (21 char) limit.
 */

/**
 * Format the full displayed invoice number from the base + rebill count.
 *
 * @param {string|null} base — the 9-char base (e.g., "ABC001001")
 * @param {number} [rebillCount=0] — 0 = original, 1+ = nth rebill
 * @returns {string|null} — the full number, or null if no base provided
 */
export function formatInvoiceNumber(base, rebillCount = 0) {
  if (!base) return null;
  if (!rebillCount || rebillCount <= 0) return base;
  return `${base}R${rebillCount}`;
}

/**
 * Assign a new invoice number base to a charge set by:
 *   1. Validating the tenant has a SCAC code set (≥3 chars)
 *   2. Taking the first 3 characters of the SCAC
 *   3. Atomically incrementing tenant_settings.next_invoice_number via
 *      the Postgres next_invoice_seq() function
 *   4. Returning the formatted 9-char base (e.g., "ABC001001")
 *
 * Must be called from a server-side context with a service client (bypasses RLS).
 *
 * @param {object} svc — Supabase service client
 * @param {string} tenantId
 * @returns {Promise<string>} the 9-char base invoice number
 * @throws {Error} if SCAC is missing, too short, or the sequence RPC fails
 */
export async function assignInvoiceNumberBase(svc, tenantId) {
  // Step 1: Fetch SCAC from tenant settings
  const { data: settings, error: settingsErr } = await svc
    .from('tenant_settings')
    .select('scac_code')
    .eq('tenant_id', tenantId)
    .single();

  if (settingsErr) {
    throw new Error(`Failed to read tenant settings: ${settingsErr.message}`);
  }

  const rawScac = (settings?.scac_code || '').trim().toUpperCase();

  if (!rawScac) {
    throw new Error(
      'SCAC code is required to generate invoice numbers. Please set your 4-character SCAC in Settings → Company Settings.'
    );
  }
  if (rawScac.length < 3) {
    throw new Error(
      `SCAC code "${rawScac}" must be at least 3 characters. Please update it in Settings → Company Settings.`
    );
  }

  // Use first 3 chars of SCAC per spec
  const prefix = rawScac.slice(0, 3);

  // Step 2: Atomically get next sequence number via the Postgres function
  const { data: seqValue, error: rpcErr } = await svc.rpc('next_invoice_seq', {
    p_tenant_id: tenantId,
  });

  if (rpcErr) {
    throw new Error(`Failed to generate invoice sequence: ${rpcErr.message}`);
  }

  const seq = String(seqValue || 1001).padStart(6, '0');
  return `${prefix}${seq}`; // e.g., "ABC001001"
}
