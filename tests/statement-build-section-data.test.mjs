import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-statement-section-data.js';

const baseDoc = {
  customer_id: 'cust-walmart-uuid',
  tenant_name: 'Acme Drayage',
  tenant_info: {
    logo_url: 'https://example.com/logo.png',
    address: '1 Main St, Newark, NJ 07102',
    phone: '555-1212',
    website: 'acme.com',
  },
  bill_to: {
    name: 'Walmart',
    address_line1: '702 SW 8th',
    city: 'Bentonville',
    state: 'AR',
    zip: '72716',
  },
  customer_contact: { phone: '555-9999', email: 'ap@walmart.com' },
  customer_account_number: 'CUST-WMT-0042',
  bill_to_customer_id: 'cust-walmart-uuid',
  statement_meta: {
    as_of_date: 'Apr 27, 2026',
    account_number: 'CUST-WMT-0042',
  },
  open_invoices: [
    { invoice_id: 'inv-1', invoice_number: 'INV-001', invoice_date: 'Apr 18, 2026', due_date: 'May 18, 2026', days_past_due: -21, customer_reference: 'PO-001', original_amount_cents: 120000, balance_due_cents: 120000 },
    { invoice_id: 'inv-2', invoice_number: 'INV-005', invoice_date: 'Mar 15, 2026', due_date: 'Apr 14, 2026', days_past_due: 13, customer_reference: 'PO-005', original_amount_cents: 247500, balance_due_cents: 85000 },
  ],
  aging: { current: 120000, days_1_30: 85000, days_31_60: 0, days_61_90: 0, days_90_plus: 0 },
  total_outstanding_cents: 205000,
};

test('buildSectionData maps statement_meta to statement_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.statement_details.as_of_date, 'Apr 27, 2026');
  assert.equal(sd.statement_details.account_number, 'CUST-WMT-0042');
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.phone, '555-9999');
  assert.equal(sd.address_details.customer.email, 'ap@walmart.com');
});

test('buildSectionData passes open_invoices through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.open_invoices.length, 2);
  assert.equal(sd.open_invoices[0].invoice_number, 'INV-001');
  assert.equal(sd.open_invoices[1].balance_due_cents, 85000);
});

test('buildSectionData passes aging through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.aging_summary.current, 120000);
  assert.equal(sd.aging_summary.days_1_30, 85000);
  assert.equal(sd.aging_summary.days_31_60, 0);
});

test('buildSectionData maps total_outstanding_cents to total_outstanding section', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.total_outstanding.total_outstanding_cents, 205000);
});

test('buildSectionData notes section uses payment_instructions / custom_notes from doc.notes', () => {
  const sd = buildSectionData({ ...baseDoc, notes: { payment_instructions: 'Wire to Citi', custom_notes: '' } });
  assert.equal(sd.notes.payment_instructions, 'Wire to Citi');
  assert.equal(sd.notes.custom_notes, '');
});

test('buildSectionData notes is null when doc.notes is missing', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.payment_instructions, null);
});

test('buildSectionData returns null-safe shapes when bill_to is null (zero-balance customer)', () => {
  const sd = buildSectionData({
    ...baseDoc,
    bill_to: null,
    customer_contact: null,
    open_invoices: [],
    aging: { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 },
    total_outstanding_cents: 0,
  });
  assert.equal(sd.address_details.customer, null);
  assert.deepEqual(sd.open_invoices, []);
  assert.equal(sd.total_outstanding.total_outstanding_cents, 0);
  assert.equal(sd.aging_summary.current, 0);
});

test('buildSectionData honors disclaimer.enabled in section_config', () => {
  const sdEnabled = buildSectionData({ ...baseDoc, section_config: { disclaimer: { enabled: true, text: 'Custom T&C' } } });
  assert.deepEqual(sdEnabled.disclaimer, { text: 'Custom T&C' });

  const sdDisabled = buildSectionData(baseDoc);
  assert.equal(sdDisabled.disclaimer, null);
});
