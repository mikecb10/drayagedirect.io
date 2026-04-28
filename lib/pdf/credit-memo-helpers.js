/**
 * Pure helpers for the Credit Memo renderer. Factored here so they can be
 * unit-tested without importing the React-PDF runtime.
 */

/**
 * Pick a display memo number for the credit memo. Preference order:
 *   1. memo.memo_number (trimmed, if non-empty)
 *   2. CM-{first 8 chars of memo.id, uppercased}
 *   3. 'CM-UNKNOWN' (last-ditch fallback for tests / corrupted rows)
 *
 * Mirrors lib/pdf/render-statement.js's resolveAccountNumber pattern.
 *
 * Note: every credit_memo row currently in the database has memo_number = NULL
 * because the create form (components/ar/CreditMemosTab.js) doesn't capture it.
 * Auto-generation is deferred to FU-035-H6-followup-B; until then, the fallback
 * path is the dominant case.
 */
export function resolveMemoNumber(memo) {
  if (memo?.memo_number) {
    const trimmed = memo.memo_number.trim();
    if (trimmed) return trimmed;
  }
  if (memo?.id) {
    return `CM-${memo.id.slice(0, 8).toUpperCase()}`;
  }
  return 'CM-UNKNOWN';
}

/**
 * How much of the credit memo's amount was applied to a destination invoice.
 *
 * The schema doesn't store applied_amount_cents on credit_memos. We approximate
 * by mirroring the PUT /api/tenant/ar/credit-memos/[memoId] {action: 'apply'}
 * endpoint's logic:
 *
 *   newBalance    = max(0, originalBalance - memo.amount_cents)
 *   appliedAmount = originalBalance - newBalance
 *                 = min(memo.amount_cents, originalBalance)
 *
 * Since we can't recover historical originalBalance from the schema, we use
 * total_amount_cents as a proxy — correct in the common case where the credit
 * fits within the invoice's billed amount.
 *
 * Returns `null` when the destination invoice is null/undefined.
 *
 * Edge case acknowledged in spec §13 R1 + tracked as FU-035-H6-followup-C.
 */
export function computeAppliedAmount(memo, appliedToInvoice) {
  if (!appliedToInvoice) return null;
  const memoAmount    = memo?.amount_cents ?? 0;
  const invoiceTotal  = appliedToInvoice.total_amount_cents ?? 0;
  return Math.min(memoAmount, invoiceTotal);
}
