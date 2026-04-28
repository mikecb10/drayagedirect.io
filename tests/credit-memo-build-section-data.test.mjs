import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-credit-memo-section-data.js';

const baseDoc = {
  memo_id: 'memo-uuid-123',
  status: 'applied',
  is_void: false,
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
  bill_to_customer_id: 'cust-walmart-uuid',
  memo_meta: {
    memo_number:  'CM-2026-014',
    issue_date:   'Apr 27, 2026',
    applied_date: 'Apr 28, 2026',
    reason:       'Overcharge on chassis days for LD-2026-7821.',
  },
  issued_from_invoice: {
    invoice_number: 'INV-2026-091',
    invoice_date:   'Apr 18, 2026',
    due_date:       'May 18, 2026',
    total_cents:    248500,
  },
  applied_to_invoice: {
    invoice_number:        'INV-2026-103',
    invoice_date:          'Apr 25, 2026',
    balance_due_cents:     142000,
    applied_amount_cents:  40000,
    applied_date:          'Apr 28, 2026',
  },
  credit_amount_cents: 40000,
  notes: { payment_instructions: 'Wire to Citi', custom_notes: '' },
};

test('buildSectionData maps memo_meta to memo_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.memo_details.memo_number, 'CM-2026-014');
  assert.equal(sd.memo_details.issue_date,  'Apr 27, 2026');
  assert.equal(sd.memo_details.applied_date,'Apr 28, 2026');
});

test('buildSectionData applied_date is null when memo_meta.applied_date is null', () => {
  const sd = buildSectionData({ ...baseDoc, memo_meta: { ...baseDoc.memo_meta, applied_date: null } });
  assert.equal(sd.memo_details.applied_date, null);
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.phone, '555-9999');
  assert.equal(sd.address_details.customer.email, 'ap@walmart.com');
});

test('buildSectionData maps memo_meta.reason to reason.text', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.reason.text, 'Overcharge on chassis days for LD-2026-7821.');
});

test('buildSectionData reason is null when memo_meta.reason is null', () => {
  const sd = buildSectionData({ ...baseDoc, memo_meta: { ...baseDoc.memo_meta, reason: null } });
  assert.equal(sd.reason, null);
});

test('buildSectionData reason is null when memo_meta.reason is empty string', () => {
  const sd = buildSectionData({ ...baseDoc, memo_meta: { ...baseDoc.memo_meta, reason: '' } });
  assert.equal(sd.reason, null);
});

test('buildSectionData issued_from_invoice passthrough', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.issued_from_invoice.invoice_number, 'INV-2026-091');
  assert.equal(sd.issued_from_invoice.total_cents, 248500);
});

test('buildSectionData issued_from_invoice is null when doc.issued_from_invoice is null', () => {
  const sd = buildSectionData({ ...baseDoc, issued_from_invoice: null });
  assert.equal(sd.issued_from_invoice, null);
});

test('buildSectionData applied_to_invoice passthrough', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.applied_to_invoice.invoice_number, 'INV-2026-103');
  assert.equal(sd.applied_to_invoice.balance_due_cents, 142000);
  assert.equal(sd.applied_to_invoice.applied_amount_cents, 40000);
});

test('buildSectionData applied_to_invoice is null when doc.applied_to_invoice is null', () => {
  const sd = buildSectionData({ ...baseDoc, applied_to_invoice: null });
  assert.equal(sd.applied_to_invoice, null);
});

test('buildSectionData maps credit_amount_cents to credit_amount.total_cents', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.credit_amount.total_cents, 40000);
});

test('buildSectionData credit_amount defaults total_cents to 0 when missing', () => {
  const sd = buildSectionData({ ...baseDoc, credit_amount_cents: undefined });
  assert.equal(sd.credit_amount.total_cents, 0);
});

test('buildSectionData notes uses payment_instructions / custom_notes from doc.notes', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.payment_instructions, 'Wire to Citi');
  assert.equal(sd.notes.custom_notes, '');
});

test('buildSectionData notes shape when doc.notes is null', () => {
  const sd = buildSectionData({ ...baseDoc, notes: null });
  assert.equal(sd.notes.payment_instructions, null);
  assert.equal(sd.notes.custom_notes, null);
});

test('buildSectionData returns null-safe shapes when bill_to is null', () => {
  const sd = buildSectionData({
    ...baseDoc,
    bill_to: null,
    customer_contact: null,
  });
  assert.equal(sd.address_details.customer, null);
});

test('buildSectionData honors disclaimer.enabled in section_config', () => {
  const sdEnabled = buildSectionData({ ...baseDoc, section_config: { disclaimer: { enabled: true, text: 'Custom T&C' } } });
  assert.deepEqual(sdEnabled.disclaimer, { text: 'Custom T&C' });

  const sdDisabled = buildSectionData(baseDoc);
  assert.equal(sdDisabled.disclaimer, null);
});
