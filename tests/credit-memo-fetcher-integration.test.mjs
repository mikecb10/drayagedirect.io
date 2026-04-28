// Integration smoke for fetchCreditMemoData (FU-035-H6-followup-A, scoped).
//
// Mocks the Supabase client to exercise the actual 4-query plan in
// fetchCreditMemoData and asserts the resulting `doc` shape is populated
// correctly. Catches drift between the query SELECTs, the PostgREST
// chained-method API expectations, and the doc shape consumed downstream
// by buildSectionData + the composer.
//
// Scope note: this stops short of `renderToBuffer(<CreditMemoTemplate ... />)`
// because that requires JSX-transforming `node --test` (not configured for
// this project). The full render-to-PDF-bytes smoke needs a shared test
// utility (e.g., esbuild-register or @swc-node/register) — tracked as the
// remaining work in FU-035-H6-followup-A.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fetchCreditMemoData } from '../lib/pdf/render-credit-memo.js';
import { makeMockSvc } from './helpers/mock-supabase.mjs';

// ── Fixture rows ────────────────────────────────────────────────────

const memoRow = {
  id: '9f0a602a-ac7b-4d68-a26b-a9c9b7bdb092',
  memo_number: null,                      // exercises CM-{id:0:8} fallback
  amount_cents: 2500,
  reason: 'QA test credit — overpayment adjustment',
  notes: 'Issued during AR pipeline QA run 2026-04-17',
  status: 'applied',
  invoice_id: 'inv-issued-from-uuid',
  applied_to_invoice_id: 'inv-applied-to-uuid',
  applied_at: '2026-04-28T10:00:00.000Z',
  created_at: '2026-04-17T08:00:00.000Z',
  deleted_at: null,
  customer: {
    id: '4bcf9370-8fcc-4758-9ec3-4c69826314f7',
    name: 'Jolly Greens brews',
    short_name: 'JOLLY',
    address_line1: '14155 Dallas Pkwy',
    address_line2: null,
    city: 'Dallas',
    state: 'TX',
    zip: '75254-4430',
    billing_email: 'mikecb2010@gmail.com',
    phone: '555-555-1234',
    deleted_at: null,
  },
};

const issuedFromInvoice = {
  id: 'inv-issued-from-uuid',
  invoice_number: 'TES001004',
  invoice_date:   '2026-04-17',
  due_date:       '2026-05-17',
  total_amount_cents: 28750,
  balance_due_cents:  28750,
};

const appliedToInvoice = {
  id: 'inv-applied-to-uuid',
  invoice_number: 'INV-2026-103',
  invoice_date:   '2026-04-25',
  due_date:       '2026-05-25',
  total_amount_cents: 142000,
  balance_due_cents:  139500,
};

const tenantRow   = { name: 'Acme Drayage' };
const settingsRow = {
  company_display_name: 'Acme Drayage Inc.',
  logo_small_url: null,
  logo_large_url: 'https://example.com/logo-large.png',
  address_line1: '123 Main Street',
  address_line2: null,
  city:  'Newark',
  state: 'NJ',
  zip:   '07102',
  phone: '555-555-1212',
  website: 'www.acme.example',
};

// ── Tests ───────────────────────────────────────────────────────────

test('fetchCreditMemoData returns the full doc shape for an applied memo with both invoice FKs', async () => {
  const svc = makeMockSvc({
    credit_memos:    { data: memoRow, error: null },
    invoices:        { data: [issuedFromInvoice, appliedToInvoice], error: null },
    tenants:         { data: tenantRow, error: null },
    tenant_settings: { data: settingsRow, error: null },
  });

  const doc = await fetchCreditMemoData(svc, memoRow.id, 'tenant-uuid');

  // Top-level shape
  assert.equal(doc.memo_id, memoRow.id);
  assert.equal(doc.status, 'applied');
  assert.equal(doc.is_void, false);
  assert.equal(doc.tenant_name, 'Acme Drayage');
  assert.equal(doc.bill_to_customer_id, memoRow.customer.id);

  // Header info
  assert.equal(doc.tenant_info.logo_url, 'https://example.com/logo-large.png');
  assert.match(doc.tenant_info.address, /123 Main Street/);
  assert.equal(doc.tenant_info.phone, '555-555-1212');

  // Bill To / customer contact
  assert.equal(doc.bill_to.name, 'Jolly Greens brews');
  assert.equal(doc.bill_to.city, 'Dallas');
  assert.equal(doc.customer_contact.email, 'mikecb2010@gmail.com');

  // Memo meta — fallback memo number, formatted dates, reason passthrough
  assert.equal(doc.memo_meta.memo_number, 'CM-9F0A602A');         // CM-{id:0:8 uppercase}
  assert.match(doc.memo_meta.issue_date, /^Apr 17, 2026$/);
  assert.match(doc.memo_meta.applied_date, /^Apr 28, 2026$/);
  assert.equal(doc.memo_meta.reason, memoRow.reason);

  // Issued From Invoice
  assert.ok(doc.issued_from_invoice, 'issued_from_invoice should be populated');
  assert.equal(doc.issued_from_invoice.invoice_number, 'TES001004');
  assert.equal(doc.issued_from_invoice.total_cents, 28750);

  // Applied To Invoice + computed applied amount (min(2500, 142000) = 2500)
  assert.ok(doc.applied_to_invoice, 'applied_to_invoice should be populated');
  assert.equal(doc.applied_to_invoice.invoice_number, 'INV-2026-103');
  assert.equal(doc.applied_to_invoice.balance_due_cents, 139500);
  assert.equal(doc.applied_to_invoice.applied_amount_cents, 2500);
  assert.match(doc.applied_to_invoice.applied_date, /^Apr 28, 2026$/);

  // Credit amount (passthrough)
  assert.equal(doc.credit_amount_cents, 2500);

  // Notes — payment_instructions sourced from cm.notes; custom_notes always null
  assert.equal(doc.notes.payment_instructions, memoRow.notes);
  assert.equal(doc.notes.custom_notes, null);
});

test('fetchCreditMemoData returns null when memo missing', async () => {
  const svc = makeMockSvc({
    credit_memos: { data: null, error: null },
  });
  const doc = await fetchCreditMemoData(svc, 'nonexistent', 'tenant-uuid');
  assert.equal(doc, null);
});

test('fetchCreditMemoData returns null when customer is soft-deleted', async () => {
  const svc = makeMockSvc({
    credit_memos: {
      data: { ...memoRow, customer: { ...memoRow.customer, deleted_at: '2026-04-20T00:00:00.000Z' } },
      error: null,
    },
  });
  const doc = await fetchCreditMemoData(svc, memoRow.id, 'tenant-uuid');
  assert.equal(doc, null);
});

test('fetchCreditMemoData skips invoices query when both FKs are null (standalone draft)', async () => {
  let invoicesQueryFired = false;
  const svc = {
    from: (table) => {
      if (table === 'invoices') invoicesQueryFired = true;
      const responses = {
        credit_memos: {
          data: { ...memoRow, invoice_id: null, applied_to_invoice_id: null, status: 'draft', applied_at: null },
          error: null,
        },
        tenants: { data: tenantRow, error: null },
        tenant_settings: { data: settingsRow, error: null },
      };
      const response = responses[table] ?? { data: null, error: null };
      const obj = {
        maybeSingle: () => Promise.resolve(response),
        select: () => obj, eq: () => obj, in: () => obj, is: () => obj,
        not: () => obj, gt: () => obj, lte: () => obj, order: () => obj,
        then: (resolve, reject) => Promise.resolve(response).then(resolve, reject),
      };
      return obj;
    },
  };

  const doc = await fetchCreditMemoData(svc, memoRow.id, 'tenant-uuid');

  assert.equal(invoicesQueryFired, false, 'invoices query should be skipped when both FKs are null');
  assert.equal(doc.is_void, false);
  assert.equal(doc.status, 'draft');
  assert.equal(doc.issued_from_invoice, null);
  assert.equal(doc.applied_to_invoice, null);
  assert.equal(doc.memo_meta.applied_date, null);
});

test('fetchCreditMemoData sets is_void=true for void status', async () => {
  const svc = makeMockSvc({
    credit_memos: { data: { ...memoRow, status: 'void' }, error: null },
    invoices:     { data: [issuedFromInvoice, appliedToInvoice], error: null },
    tenants:      { data: tenantRow, error: null },
    tenant_settings: { data: settingsRow, error: null },
  });

  const doc = await fetchCreditMemoData(svc, memoRow.id, 'tenant-uuid');
  assert.equal(doc.status, 'void');
  assert.equal(doc.is_void, true);
});

test('fetchCreditMemoData uses real memo_number when provided (fallback path skipped)', async () => {
  const svc = makeMockSvc({
    credit_memos: { data: { ...memoRow, memo_number: 'CM-2026-014' }, error: null },
    invoices:     { data: [issuedFromInvoice, appliedToInvoice], error: null },
    tenants:      { data: tenantRow, error: null },
    tenant_settings: { data: settingsRow, error: null },
  });
  const doc = await fetchCreditMemoData(svc, memoRow.id, 'tenant-uuid');
  assert.equal(doc.memo_meta.memo_number, 'CM-2026-014');
});

test('fetchCreditMemoData throws on Supabase error', async () => {
  const svc = makeMockSvc({
    credit_memos: { data: null, error: { message: 'connection refused' } },
  });
  await assert.rejects(
    () => fetchCreditMemoData(svc, memoRow.id, 'tenant-uuid'),
    /Credit memo fetch failed: connection refused/,
  );
});
