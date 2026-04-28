// React-PDF + CreditMemoTemplate (a JSX-bearing React component) are
// dynamically imported inside renderCreditMemoPdf so that this module's
// pure-JS fetcher (fetchCreditMemoData) can be unit-tested under bare
// `node --test` without a JSX transformer. See
// tests/credit-memo-fetcher-integration.test.mjs (FU-035-H6-followup-A).
import { resolveTemplateConfig } from './resolve-template-config.js';
import { formatDate } from './format-date.js';
import { resolveMemoNumber, computeAppliedAmount } from './credit-memo-helpers.js';

/**
 * Fetch Credit Memo data for a memoId and shape it for the composer.
 * Returns null if the memo doesn't exist for this tenant or is soft-deleted.
 *
 * Query plan:
 *   1. credit_memos JOIN customers          (1 query, single row)
 *   2. invoices WHERE id IN (...)           (1 query, optional — skipped if both FKs null)
 *   3. tenants                              (1 query)
 *   4. tenant_settings                      (1 query)
 *
 * @param {SupabaseClient} svc
 * @param {string} memoId
 * @param {string} tenantId
 */
export async function fetchCreditMemoData(svc, memoId, tenantId) {
  // 1. Memo + customer (1 query, joined). Foreign-table select pulls
  //    customer.deleted_at so we can filter post-fetch.
  const { data: row, error: memoErr } = await svc
    .from('credit_memos')
    .select(`
      id, memo_number, amount_cents, reason, notes,
      status, invoice_id, applied_to_invoice_id, applied_at,
      created_at, deleted_at,
      customer:customers!customer_id(
        id, name, short_name, address_line1, address_line2, city, state, zip,
        billing_email, phone, deleted_at
      )
    `)
    .eq('id', memoId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (memoErr) throw new Error(`Credit memo fetch failed: ${memoErr.message}`);
  if (!row || !row.customer || row.customer.deleted_at) return null;

  // 2. Linked invoices (1 query — skipped if both FKs are null)
  const invoiceIds = [row.invoice_id, row.applied_to_invoice_id].filter(Boolean);
  let issuedFromInvoiceRow = null;
  let appliedToInvoiceRow  = null;

  if (invoiceIds.length > 0) {
    const { data: invoices, error: invErr } = await svc
      .from('invoices')
      .select('id, invoice_number, invoice_date, due_date, total_amount_cents, balance_due_cents')
      .in('id', invoiceIds)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    if (invErr) throw new Error(`Invoices fetch failed: ${invErr.message}`);

    for (const inv of invoices || []) {
      if (inv.id === row.invoice_id)            issuedFromInvoiceRow = inv;
      if (inv.id === row.applied_to_invoice_id) appliedToInvoiceRow  = inv;
    }
  }

  const appliedAmountCents = computeAppliedAmount(row, appliedToInvoiceRow);

  // 3. Tenant + 4. tenant_settings for Header (1 query each)
  const { data: tenant } = await svc
    .from('tenants')
    .select('name')
    .eq('id', tenantId)
    .maybeSingle();
  const { data: settings } = await svc
    .from('tenant_settings')
    .select('company_display_name, logo_small_url, logo_large_url, address_line1, address_line2, city, state, zip, phone, website')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const tenant_info = {
    logo_url: settings?.logo_large_url || settings?.logo_small_url || null,
    address: [
      settings?.address_line1,
      settings?.address_line2,
      [settings?.city, settings?.state, settings?.zip].filter(Boolean).join(', '),
    ].filter(Boolean).join(', ') || null,
    phone: settings?.phone || null,
    website: settings?.website || null,
  };

  return {
    memo_id: row.id,
    status: row.status,
    is_void: row.status === 'void',
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: {
      name:          row.customer.name,
      address_line1: row.customer.address_line1,
      address_line2: row.customer.address_line2,
      city:          row.customer.city,
      state:         row.customer.state,
      zip:           row.customer.zip,
    },
    customer_contact: {
      phone: row.customer.phone,
      email: row.customer.billing_email,
    },
    bill_to_customer_id: row.customer.id,
    memo_meta: {
      memo_number:  resolveMemoNumber(row),
      issue_date:   formatDate(row.created_at),
      applied_date: row.applied_at ? formatDate(row.applied_at) : null,
      reason:       row.reason || null,
    },
    issued_from_invoice: issuedFromInvoiceRow ? {
      invoice_number: issuedFromInvoiceRow.invoice_number,
      invoice_date:   formatDate(issuedFromInvoiceRow.invoice_date),
      due_date:       formatDate(issuedFromInvoiceRow.due_date),
      total_cents:    issuedFromInvoiceRow.total_amount_cents,
    } : null,
    applied_to_invoice: appliedToInvoiceRow ? {
      invoice_number:        appliedToInvoiceRow.invoice_number,
      invoice_date:          formatDate(appliedToInvoiceRow.invoice_date),
      balance_due_cents:     appliedToInvoiceRow.balance_due_cents,
      applied_amount_cents:  appliedAmountCents,
      applied_date:          row.applied_at ? formatDate(row.applied_at) : null,
    } : null,
    credit_amount_cents: row.amount_cents,
    notes: {
      payment_instructions: row.notes || null,
      custom_notes:         null,
    },
  };
}

/**
 * Fetch Credit Memo data + render as PDF Buffer.
 *
 * @param {SupabaseClient} svc
 * @param {string} memoId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Credit memo not found' if missing or wrong tenant
 */
export async function renderCreditMemoPdf(svc, memoId, tenantId) {
  const doc = await fetchCreditMemoData(svc, memoId, tenantId);
  if (!doc) throw new Error('Credit memo not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'credit_memo'
  );

  // Dynamic imports (React-PDF + CreditMemoTemplate JSX) keep the
  // module-load path pure-JS — see top-of-file comment.
  const [{ renderToBuffer }, React, { default: CreditMemoTemplate }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('react'),
    import('../../components/pdf/CreditMemoTemplate'),
  ]);

  return await renderToBuffer(
    React.createElement(CreditMemoTemplate, { doc, sectionConfig })
  );
}
