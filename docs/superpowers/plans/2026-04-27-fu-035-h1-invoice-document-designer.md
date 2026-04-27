# FU-035-H1 Invoice Document Designer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `components/pdf/InvoiceTemplate.js` with a section-registry-driven composer mirroring the FU-035-D2 Delivery Order pattern. Tenants can toggle Invoice section/field visibility from `/settings/document-designer`; per-customer cascade works; live preview matches print.

**Architecture:** Independent `INVOICE_SECTIONS` registry (sibling to `DELIVERY_ORDER_SECTIONS`). `AddressDetails` parameterized by `customerLabel` prop (default `'Customer'`, Invoice passes `'Bill To'`). New `InvoiceDetails` + `ChargeDetails` PDF + HTML preview components. Single-page composer rewrites `InvoiceTemplate.js`; `lib/pdf/render-invoice.js` rewritten to fetch data via new `fetchInvoiceData` and resolve template via existing cascade resolver. `renderInvoicePdf(svc, invoiceId, tenantId)` signature unchanged. Multi-load consolidated invoices render first-order data + a footnote (proper multi-load layout deferred to FU-035-H3).

**Tech Stack:** Next.js 15 + React 19, @react-pdf/renderer 4.5, Supabase Postgres, Tailwind 4, native Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-04-27-fu-035-h1-invoice-document-designer-design.md`](../specs/2026-04-27-fu-035-h1-invoice-document-designer-design.md)

---

## Task 1: Add `'invoice'` to `DOCUMENT_TYPES` registry

**Files:**
- Create: `tests/document-types-constants-invoice.test.mjs`
- Modify: `lib/constants/document-types.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-types-constants-invoice.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DOCUMENT_TYPES,
  VALID_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getDocumentType,
  isValidDocumentType,
} from '../lib/constants/document-types.js';

test("'invoice' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('invoice'), `missing 'invoice' in: ${ids.join(', ')}`);
});

test("getDocumentType('invoice') returns the entry with category 'ar'", () => {
  const entry = getDocumentType('invoice');
  assert.equal(entry.value, 'invoice');
  assert.equal(entry.label, 'Invoice');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('invoice') is true", () => {
  assert.equal(isValidDocumentType('invoice'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('invoice'));
  assert.equal(DOCUMENT_TYPE_LABELS['invoice'], 'Invoice');
});

test("existing DO doc types still present (regression)", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-types-constants-invoice.test.mjs`
Expected: FAIL — `missing 'invoice'` (3 tests fail; the regression test for existing DO entries passes).

- [ ] **Step 3: Add 'invoice' to DOCUMENT_TYPES**

Edit `lib/constants/document-types.js`. Replace the `DOCUMENT_TYPES` array with:

```js
export const DOCUMENT_TYPES = [
  {
    value: 'delivery_order_full',
    label: 'Delivery Order — Full',
    description: 'Entire routing across all moves',
    category: 'load',
  },
  {
    value: 'delivery_order_next_move',
    label: 'Delivery Order — Next Move',
    description: 'Only the next non-completed move',
    category: 'load',
  },
  {
    value: 'invoice',
    label: 'Invoice',
    description: 'AR invoice for a customer',
    category: 'ar',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/document-types-constants-invoice.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Run all existing tests to verify no regression**

Run: `node --test tests/document-types-constants.test.mjs`
Expected: PASS — existing DO tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/document-types-constants-invoice.test.mjs lib/constants/document-types.js
git commit -m "feat(doc-designer): register 'invoice' in DOCUMENT_TYPES (FU-035-H1)"
```

---

## Task 2: Add `INVOICE_SECTIONS` to section registry

**Files:**
- Create: `tests/document-sections-invoice-constants.test.mjs`
- Modify: `lib/constants/document-sections.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-sections-invoice-constants.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  INVOICE_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('INVOICE_SECTIONS entries have required keys', () => {
  for (const s of INVOICE_SECTIONS) {
    assert.equal(typeof s.id, 'string', `missing id: ${JSON.stringify(s)}`);
    assert.equal(typeof s.label, 'string', `missing label: ${s.id}`);
    assert.equal(typeof s.defaultVisible, 'boolean', `defaultVisible: ${s.id}`);
    assert.equal(typeof s.toggleable, 'boolean', `toggleable: ${s.id}`);
    if (s.fields) {
      assert.ok(Array.isArray(s.fields), `fields must be array: ${s.id}`);
      for (const f of s.fields) {
        assert.equal(typeof f.id, 'string', `field missing id in ${s.id}`);
        assert.equal(typeof f.label, 'string', `field missing label: ${s.id}.${f.id}`);
        assert.equal(typeof f.defaultVisible, 'boolean', `field defaultVisible: ${s.id}.${f.id}`);
      }
    }
  }
});

test('all 10 Invoice sections present', () => {
  const ids = INVOICE_SECTIONS.map((s) => s.id);
  for (const id of [
    'header',
    'invoice_details',
    'address_details',
    'move_events',
    'order_details',
    'commodity_details',
    'charge_details',
    'notes',
    'disclaimer',
    'footer',
  ]) {
    assert.ok(ids.includes(id), `missing Invoice section: ${id}`);
  }
  assert.equal(INVOICE_SECTIONS.length, 10);
});

test('footer is non-toggleable on Invoice', () => {
  const footer = INVOICE_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('move_events / commodity_details / disclaimer default off on Invoice', () => {
  for (const id of ['move_events', 'commodity_details', 'disclaimer']) {
    const s = INVOICE_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('invoice_details has 6 fields', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'invoice_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'invoice_number', 'load_number', 'customer_reference',
    'invoice_date', 'terms', 'due_date',
  ]) {
    assert.ok(fieldIds.includes(id), `missing invoice_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 6);
});

test('charge_details has 4 fields, NOT free_units or hours', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'charge_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['charge_name', 'units', 'rates', 'charges']) {
    assert.ok(fieldIds.includes(id), `missing charge_details field: ${id}`);
  }
  assert.ok(!fieldIds.includes('free_units'), 'free_units should NOT be registered (no data source)');
  assert.ok(!fieldIds.includes('hours'),      'hours should NOT be registered (no data source)');
  assert.equal(fieldIds.length, 4);
});

test('notes has 3 fields, NOT yard_notes or customer_notes', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['driver_notes', 'billing_notes', 'load_notes']) {
    assert.ok(fieldIds.includes(id), `missing notes field: ${id}`);
  }
  assert.ok(!fieldIds.includes('yard_notes'),     'yard_notes should NOT be registered (no data source)');
  assert.ok(!fieldIds.includes('customer_notes'), 'customer_notes should NOT be registered (no data source)');
  assert.equal(fieldIds.length, 3);
});

test('address_details has bill_to (NOT customer)', () => {
  const s = INVOICE_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'),   'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on Invoice (DO-only)');
});

test("getSectionsForDocumentType('invoice') returns INVOICE_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('invoice'), INVOICE_SECTIONS);
});

test('computeVisibility honors INVOICE_SECTIONS defaults with no config', () => {
  const result = computeVisibility(INVOICE_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.invoice_details, true);
  assert.equal(result.visibility.charge_details, true);
  assert.equal(result.visibility.move_events, false);          // default off
  assert.equal(result.visibility.commodity_details, false);    // default off
  assert.equal(result.visibility.disclaimer, false);           // default off
  assert.equal(result.visibility.footer, true);                // non-toggleable
  assert.equal(result.fields.charge_details.charge_name, true);
  assert.equal(result.fields.notes.billing_notes, true);
  assert.equal(result.fields.notes.driver_notes, false);       // default off
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-invoice-constants.test.mjs`
Expected: FAIL — `INVOICE_SECTIONS` not exported (multiple test failures).

- [ ] **Step 3: Add `INVOICE_SECTIONS` and register it**

Edit `lib/constants/document-sections.js`. **Append** the following after the existing `DELIVERY_ORDER_SECTIONS` constant (do NOT touch DELIVERY_ORDER_SECTIONS):

```js
export const INVOICE_SECTIONS = [
  {
    id: 'header',
    label: 'Header',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'logo',         label: 'Logo',         defaultVisible: true },
      { id: 'address',      label: 'Address',      defaultVisible: true },
      { id: 'phone',        label: 'Phone',        defaultVisible: true },
      { id: 'website',      label: 'Website',      defaultVisible: false },
      { id: 'company_name', label: 'Company Name', defaultVisible: true },
    ],
  },
  {
    id: 'invoice_details',
    label: 'Invoice Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'invoice_number',     label: 'Invoice Number',           defaultVisible: true },
      { id: 'load_number',        label: 'Load Number',              defaultVisible: true },
      { id: 'customer_reference', label: 'Customer Reference / PO #', defaultVisible: true },
      { id: 'invoice_date',       label: 'Invoice Date',             defaultVisible: true },
      { id: 'terms',              label: 'Terms',                    defaultVisible: true },
      { id: 'due_date',           label: 'Due Date',                 defaultVisible: true },
    ],
  },
  {
    id: 'address_details',
    label: 'Address Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'bill_to',           label: 'Bill To',           defaultVisible: true },
      { id: 'pickup_location',   label: 'Pick Up Location',  defaultVisible: true },
      { id: 'delivery_location', label: 'Delivery Location', defaultVisible: true },
      { id: 'return_location',   label: 'Return Location',   defaultVisible: true },
      { id: 'display_pickup_for_operational_street_turns',
        label: 'Display Pickup Location for Operational Street Turns',
        defaultVisible: false },
    ],
  },
  {
    id: 'move_events',
    label: 'Move Events',
    defaultVisible: false,
    toggleable: true,
  },
  {
    id: 'order_details',
    label: 'Order Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'reference_number',      label: 'Reference #',           defaultVisible: true },
      { id: 'booking_bl',            label: 'Booking/BL',            defaultVisible: true },
      { id: 'mbol',                  label: 'MBOL #',                defaultVisible: true },
      { id: 'hbol',                  label: 'HBOL #',                defaultVisible: true },
      { id: 'container_number',      label: 'Container #',           defaultVisible: true },
      { id: 'container_size',        label: 'Container Size',        defaultVisible: true },
      { id: 'container_type',        label: 'Container Type',        defaultVisible: true },
      { id: 'chassis_number',        label: 'Chassis #',             defaultVisible: true },
      { id: 'chassis_size',          label: 'Chassis Size',          defaultVisible: true },
      { id: 'chassis_type',          label: 'Chassis Type',          defaultVisible: true },
      { id: 'chassis_owner',         label: 'Chassis Owner',         defaultVisible: true },
      { id: 'steamship_line',        label: 'Steamship Line',        defaultVisible: true },
      { id: 'seal',                  label: 'Seal #',                defaultVisible: true },
      { id: 'hazmat',                label: 'Hazmat',                defaultVisible: true },
      { id: 'pickup_number',         label: 'Pickup #',              defaultVisible: true },
      { id: 'pull_container_date',   label: 'Pull Container Date',   defaultVisible: true },
      { id: 'return_container_date', label: 'Return Container Date', defaultVisible: true },
      { id: 'last_free_day',         label: 'Last Free Day',         defaultVisible: true },
      { id: 'per_diem_free_day',     label: 'Per Diem Free Day',     defaultVisible: true },
    ],
  },
  {
    id: 'commodity_details',
    label: 'Commodity Details',
    defaultVisible: false,
    toggleable: true,
    fields: [
      { id: 'commodity',   label: 'Commodity',   defaultVisible: true },
      { id: 'description', label: 'Description', defaultVisible: true },
      { id: 'weight',      label: 'Weight',      defaultVisible: true },
      { id: 'pallets',     label: 'Pallets',     defaultVisible: true },
      { id: 'pieces',      label: 'Pieces',      defaultVisible: true },
    ],
  },
  {
    id: 'charge_details',
    label: 'Charge Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'charge_name', label: 'Charge Name', defaultVisible: true },
      { id: 'units',       label: 'Units',       defaultVisible: true },
      { id: 'rates',       label: 'Rates',       defaultVisible: true },
      { id: 'charges',     label: 'Charges',     defaultVisible: true },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'driver_notes',  label: 'Driver Notes',  defaultVisible: false },
      { id: 'billing_notes', label: 'Billing Notes', defaultVisible: true },
      { id: 'load_notes',    label: 'Load Notes',    defaultVisible: false },
    ],
  },
  {
    id: 'disclaimer',
    label: 'Disclaimer',
    defaultVisible: false,
    toggleable: true,
  },
  {
    id: 'footer',
    label: 'Footer',
    defaultVisible: true,
    toggleable: false,
  },
];
```

Then update `SECTIONS_BY_DOCUMENT_TYPE` (currently lines 143-146 of the file). Replace:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
};
```

with:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
};
```

- [ ] **Step 4: Run new test to verify it passes**

Run: `node --test tests/document-sections-invoice-constants.test.mjs`
Expected: PASS — 10 tests pass.

- [ ] **Step 5: Run existing DO test to verify no regression**

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: PASS — all existing DO tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/document-sections-invoice-constants.test.mjs lib/constants/document-sections.js
git commit -m "feat(doc-designer): add INVOICE_SECTIONS registry (FU-035-H1)"
```

---

## Task 3: Validator regression tests for Invoice

**Files:**
- Create: `tests/validate-section-config-invoice.test.mjs`

The validator (`lib/pdf/validate-section-config.js`) is already per-doc-type-aware (FU-112) — it scopes field-ID validation to `getSectionsForDocumentType(documentType)`. After Task 2, it should automatically support Invoice with no code change. These tests confirm the field-ID isolation works correctly.

- [ ] **Step 1: Write the test file**

Create `tests/validate-section-config-invoice.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on Invoice's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'invoice',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS customer=false on Invoice (no such field in INVOICE_SECTIONS)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /customer/);
});

test("validator REJECTS free_units on Invoice's charge_details (FU-112 enforcement)", () => {
  const r = validateSectionConfig(
    { perSection: { charge_details: { fields: { free_units: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /free_units/);
});

test("validator REJECTS hours on Invoice's charge_details", () => {
  const r = validateSectionConfig(
    { perSection: { charge_details: { fields: { hours: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /hours/);
});

test("validator REJECTS yard_notes on Invoice's notes (no data source)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { yard_notes: false } } } },
    'invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /yard_notes/);
});

test('field-ID isolation: customer accepted on DO, REJECTED on Invoice', () => {
  const payload = { perSection: { address_details: { fields: { customer: false } } } };
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
});

test('field-ID isolation: bill_to accepted on Invoice, REJECTED on DO', () => {
  const payload = { perSection: { address_details: { fields: { bill_to: false } } } };
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             true);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test("validator accepts a full Invoice section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { invoice_details: true, move_events: false },
      perSection: {
        charge_details: { fields: { charge_name: true, units: true, rates: false, charges: true } },
        notes:          { fields: { driver_notes: false, billing_notes: true, load_notes: true } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'invoice',
  );
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/validate-section-config-invoice.test.mjs`
Expected: PASS — all 8 tests pass without any code change. Validator already supports Invoice via `getSectionsForDocumentType('invoice')`.

If any test fails, investigate `validateSectionConfig` against the new INVOICE_SECTIONS — there is likely a Task-2 bug.

- [ ] **Step 3: Commit**

```bash
git add tests/validate-section-config-invoice.test.mjs
git commit -m "test(doc-designer): regression tests for validator against INVOICE_SECTIONS (FU-035-H1)"
```

---

## Task 4: Split sample-data.js into per-doc-type files

**Files:**
- Rename: `lib/document-designer/sample-data.js` → `lib/document-designer/sample-data-delivery-order.js`
- Create: `lib/document-designer/sample-data-invoice.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`
- Modify: `components/settings/document-designer/TemplateEditor.js`

- [ ] **Step 1: Rename existing sample-data.js**

```bash
git mv lib/document-designer/sample-data.js lib/document-designer/sample-data-delivery-order.js
```

- [ ] **Step 2: Create the new Invoice sample data file**

Create `lib/document-designer/sample-data-invoice.js`:

```js
// Mirror this shape against buildSectionData() in components/pdf/InvoiceTemplate.js —
// drift here means the preview shows different content than the printed PDF.

const sampleData = {
  header: {
    tenantName: 'Your Company',
    tenantInfo: {
      logo_url: null,
      address: '123 Main Street, City, ST 12345, USA',
      phone: '555-555-1212',
      website: 'www.yourcompany.com',
    },
  },
  invoice_details: {
    invoice_number: 'INV-2026-001',
    load_number: 'L-ABC123',
    customer_reference: 'PO-12345',
    invoice_date: 'MONTH DD, YYYY',
    terms_days: 30,
    due_date: 'MONTH DD, YYYY',
    consolidated_count: 1,
  },
  address_details: {
    customer: {
      name: 'SAMPLE BILL TO',
      address_line1: '500 Customer Plaza',
      city: 'Newark',
      state: 'NJ',
      zip: '07102',
      phone: '555-123-4567',
      email: 'ap@example.com',
    },
    pickup_location: {
      name: 'SAMPLE PICKUP',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    delivery_location: {
      name: 'SAMPLE DELIVERY',
      address_line1: '900 Warehouse Way',
      city: 'Edison',
      state: 'NJ',
      zip: '08837',
    },
    return_location: {
      name: 'SAMPLE RETURN',
      address_line1: '1210 Corbin Street',
      city: 'Elizabeth',
      state: 'NJ',
      zip: '07201',
    },
    appointment_times: { pickup: 'MONTH DD, YYYY h:mm', delivery: 'MONTH DD, YYYY h:mm' },
    is_operational_street_turn: false,
  },
  order_details: {
    reference_number: 'ABC123',
    booking_bl: 'ABC123',
    mbol: 'ABC123',
    hbol: 'ABC123',
    container_number: 'ABC123',
    container_size: 'ABC123',
    container_type: 'ABC123',
    chassis_number: 'ABC123',
    chassis_size: 'ABC123',
    chassis_type: 'ABC123',
    chassis_owner: 'ABC123',
    steamship_line: 'ABC123',
    seal: 'ABC123',
    hazmat: 'ABC123',
    pickup_number: 'ABC123',
    pull_container_date: 'ABC123',
    return_container_date: 'ABC123',
    last_free_day: 'ABC123',
    per_diem_free_day: 'ABC123',
  },
  commodity_details: {
    commodity: 'ABC123',
    description: 'ABC123',
    weight: 'ABC123 LBS',
    pallets: 'ABC123',
    pieces: 'ABC123',
  },
  charge_details: {
    charge_lines: [
      { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
      { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
      { description: 'Chassis Day Use',           quantity: 3, unit_amount_cents: 3500,  total_amount_cents: 10500 },
    ],
    totals: { subtotal_cents: 98000, total_cents: 98000 },
  },
  notes: {
    driver_notes:  'SAMPLE driver notes',
    billing_notes: 'SAMPLE billing notes — payment terms apply.',
    load_notes:    'SAMPLE load notes',
  },
  disclaimer: {
    text: 'Disclaimer text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
```

- [ ] **Step 3: Update DocumentPreview.js to support per-doc-type sample data**

Edit `components/settings/document-designer/preview/DocumentPreview.js`. Replace the entire file contents with:

```js
import sampleDataDeliveryOrder from '../../../../lib/document-designer/sample-data-delivery-order';
import sampleDataInvoice       from '../../../../lib/document-designer/sample-data-invoice';
import HeaderPreview               from './HeaderPreview';
import DeliveryOrderDetailsPreview from './DeliveryOrderDetailsPreview';
import AddressDetailsPreview       from './AddressDetailsPreview';
import OrderDetailsPreview         from './OrderDetailsPreview';
import CommodityDetailsPreview     from './CommodityDetailsPreview';
import NotesPreview                from './NotesPreview';
import SignaturePreview            from './SignaturePreview';
import DisclaimerPreview           from './DisclaimerPreview';

const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
};

/**
 * Maps section ID → its HTML preview component. Sections without preview
 * components (move_events / barcode / footer) are intentionally absent —
 * the preview pane is a one-page snapshot, not a multi-page render.
 *
 * Tasks 6, 7, 8 will register `invoice_details` and `charge_details` here.
 */
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  address_details:        AddressDetailsPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};

/**
 * Live HTML preview of the document. Iterates the section registry, renders
 * each visible section through its corresponding preview component, passing
 * sample data + resolved field-visibility map + per-template colors.
 *
 * `documentType`: 'delivery_order_full' | 'delivery_order_next_move' | 'invoice'
 *                 — picks the per-doc-type sample data slice
 * `visibility`:   { [sectionId]: boolean }
 * `fields`:       { [sectionId]: { [fieldId]: boolean } }
 * `sections`:     the section registry array
 * `colors`:       { accent, text } — per-template colors with defaults applied
 * `branding`:     { tenantName, logo_url } — overrides sample-data values for the header section
 */
export default function DocumentPreview({ documentType, visibility, fields, sections, colors, branding }) {
  const sampleData = SAMPLE_BY_DOCUMENT_TYPE[documentType] || sampleDataDeliveryOrder;

  return (
    <div className="bg-white rounded-lg shadow-lg ring-1 ring-gray-200 p-8 text-sm text-gray-900">
      {sections.map((s) => {
        if (!visibility[s.id]) return null;
        const Component = PREVIEW_BY_SECTION_ID[s.id];
        if (!Component) return null;
        let data = sampleData[s.id];
        // Apply branding override to the header section's data.
        if (s.id === 'header' && branding) {
          data = {
            ...data,
            tenantName: branding.tenantName || data.tenantName,
            tenantInfo: {
              ...data.tenantInfo,
              logo_url: branding.logo_url || data.tenantInfo?.logo_url,
            },
          };
        }
        const opts = { fields: fields[s.id] || {} };
        return <Component key={s.id} data={data} opts={opts} colors={colors} />;
      })}
    </div>
  );
}
```

- [ ] **Step 4: Update TemplateEditor.js to pass documentType to DocumentPreview**

Edit `components/settings/document-designer/TemplateEditor.js`. Find the `<DocumentPreview ... />` call (around line 266-272 in the current file) and add `documentType={template.document_type}`:

```js
        <DocumentPreview
          documentType={template.document_type}
          visibility={visibility}
          fields={fields}
          sections={sections}
          colors={colors}
          branding={branding}
        />
```

- [ ] **Step 5: Manually verify DO preview still renders**

Start the dev server (`npm run dev`), open `/settings/document-designer` (default = Delivery Order), confirm the right pane still renders the DO sample preview correctly with sample customer "SAMPLE CUSTOMER", containers etc. (No regression from the rename + import path change.)

If the editor renders nothing in the right pane, fix imports before continuing.

- [ ] **Step 6: Commit**

```bash
git add lib/document-designer/sample-data-delivery-order.js lib/document-designer/sample-data-invoice.js components/settings/document-designer/preview/DocumentPreview.js components/settings/document-designer/TemplateEditor.js
git commit -m "refactor(doc-designer): split sample data per doc type, add Invoice sample (FU-035-H1)"
```

---

## Task 5: Add `customerLabel` prop to AddressDetails (PDF + Preview)

**Files:**
- Modify: `components/pdf/sections/AddressDetails.js`
- Modify: `components/settings/document-designer/preview/AddressDetailsPreview.js`

This is on DO's hot path. The default value `'Customer'` preserves existing DO behavior. Existing 35 DO tests must remain green.

- [ ] **Step 1: Edit AddressDetails.js (PDF) to accept customerLabel prop**

Edit `components/pdf/sections/AddressDetails.js`. Find this block (around line 52-64):

```js
export default function AddressDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showCustomer  = fields.customer          !== false;
  ...
  if (showCustomer && data.customer) {
    rows.push(<AddressBlock key="customer" label="Customer" org={data.customer} accent={accent} />);
  }
```

Change to:

```js
export default function AddressDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const customerLabel = opts?.customerLabel || 'Customer';
  const showCustomer  = fields.customer          !== false;
  ...
  if (showCustomer && data.customer) {
    rows.push(<AddressBlock key="customer" label={customerLabel} org={data.customer} accent={accent} />);
  }
```

(Two changes: one new line `const customerLabel = ...`, one edit to `label="Customer"` → `label={customerLabel}`.)

- [ ] **Step 2: Edit AddressDetailsPreview.js to accept customerLabel from opts**

Edit `components/settings/document-designer/preview/AddressDetailsPreview.js`. Find this block (around lines 33-46):

```js
export default function AddressDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showCustomer  = fields.customer          !== false;
  ...
  if (showCustomer && data.customer) {
    blocks.push(<AddressBlock key="customer" label="Customer" org={data.customer} accent={accent} />);
  }
```

Change to:

```js
export default function AddressDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const customerLabel = opts?.customerLabel || 'Customer';
  const showCustomer  = fields.customer          !== false;
  ...
  if (showCustomer && data.customer) {
    blocks.push(<AddressBlock key="customer" label={customerLabel} org={data.customer} accent={accent} />);
  }
```

(One new line `const customerLabel = ...`, and one edit on the `<AddressBlock>` for the customer block: `label="Customer"` → `label={customerLabel}`. Do NOT change the other AddressBlock `label="Pick Up Location"` / `"Delivery Location"` / `"Return Location"` lines — those are the same across DO and Invoice.)

- [ ] **Step 3: Run all DO regression tests**

Run: `node --test tests/`
Expected: ALL existing tests pass (including 35 DO-related ones). The default `'Customer'` label means no behavior change for any existing DO caller.

- [ ] **Step 4: Manually verify DO preview**

Refresh `/settings/document-designer` (Delivery Order). The customer block should still say "Customer" (not "Bill To") because no `customerLabel` is passed in the DO render path.

- [ ] **Step 5: Commit**

```bash
git add components/pdf/sections/AddressDetails.js components/settings/document-designer/preview/AddressDetailsPreview.js
git commit -m "feat(pdf): parameterize AddressDetails customer label via prop (FU-035-H1)"
```

---

## Task 6: Build `InvoiceDetails` PDF section component

**Files:**
- Create: `components/pdf/sections/InvoiceDetails.js`

3-col label-value grid, mirrors `OrderDetails.js`'s pattern. Renders the consolidated footnote when `data.consolidated_count > 1`.

- [ ] **Step 1: Create InvoiceDetails.js**

Create `components/pdf/sections/InvoiceDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Invoice Details section — 6 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Appends an italic muted
 * "Includes charges from N loads" footnote when consolidated.
 *
 * `data` shape:
 *   {
 *     invoice_number, load_number, customer_reference,
 *     invoice_date, terms_days, due_date,
 *     consolidated_count: number  // when > 1, renders the footnote
 *   }
 *
 * `opts.fields`: { invoice_number, load_number, customer_reference,
 *                  invoice_date, terms, due_date }
 *
 * Terms field renders as `Net ${terms_days}` when terms_days > 0;
 * otherwise the row is hidden (avoids "Net 0" in the output).
 */
const FIELD_ORDER = [
  ['invoice_number',     'Invoice Number'],
  ['load_number',        'Load Number'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['invoice_date',       'Invoice Date'],
  ['terms',              'Terms'],
  ['due_date',           'Due Date'],
];

export default function InvoiceDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';
  const termsLabel = data.terms_days > 0 ? `Net ${data.terms_days}` : null;

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = key === 'terms' ? termsLabel : data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0 && !(data.consolidated_count > 1)) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ width: '33.33%', marginBottom: 4 }}>
            <Text style={[typography.label, { color: textColor }]}>{label}</Text>
            <Text style={typography.value}>{String(value)}</Text>
          </View>
        ))}
      </View>
      {data.consolidated_count > 1 ? (
        <Text style={[typography.value, typography.muted, { fontStyle: 'italic', marginTop: 2 }]}>
          Includes charges from {data.consolidated_count} loads
        </Text>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/InvoiceDetails.js
git commit -m "feat(pdf): InvoiceDetails section component (FU-035-H1)"
```

(No test for React-PDF rendering at this layer; manual smoke verifies in Task 13.)

---

## Task 7: Build `ChargeDetails` PDF section component

**Files:**
- Create: `components/pdf/sections/ChargeDetails.js`

Toggle-aware table with accent-banded header. Columns hide based on `opts.fields`. Totals footer always shown when there are rows.

- [ ] **Step 1: Create ChargeDetails.js**

Create `components/pdf/sections/ChargeDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

const styles = {
  section: { marginBottom: 12 },
  band: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    marginBottom: 4,
  },
  bandText: {
    color: 'white',
    fontSize: 7,
    fontWeight: 'bold',
    textTransform: 'uppercase',
  },
  table: {},
  headerRow: {
    flexDirection: 'row',
    backgroundColor: defaultColors.tableHeader,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: defaultColors.border,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: defaultColors.border,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  totalsBoldRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderTopWidth: 1,
    borderTopColor: defaultColors.border,
    marginTop: 2,
  },
  cellName:   { flex: 4, fontSize: 10 },
  cellUnits:  { flex: 1, fontSize: 10, textAlign: 'right' },
  cellRates:  { flex: 1, fontSize: 10, textAlign: 'right' },
  cellCharge: { flex: 1, fontSize: 10, textAlign: 'right' },
  headerText: {
    fontWeight: 'bold',
    fontSize: 9,
    color: defaultColors.muted,
    textTransform: 'uppercase',
  },
  emptyRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    color: defaultColors.muted,
    fontStyle: 'italic',
    textAlign: 'center',
    fontSize: 10,
  },
  totalsLabel: { width: 80, fontSize: 10, textAlign: 'right' },
  totalsValue: { width: 90, fontSize: 10, textAlign: 'right', paddingLeft: 8 },
  totalsLabelBold: { width: 80, fontSize: 10, textAlign: 'right', fontWeight: 'bold' },
  totalsValueBold: { width: 90, fontSize: 10, textAlign: 'right', paddingLeft: 8, fontWeight: 'bold' },
};

function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Charge Details section — toggle-aware table.
 *   Header band (accent-color) + column header row + body rows + totals footer.
 *
 * `data` shape: { charge_lines: [...], totals: { subtotal_cents, total_cents } }
 *   charge_lines[]: { description, quantity, unit_amount_cents, total_amount_cents }
 *
 * `opts.fields`: { charge_name, units, rates, charges } — column visibility.
 *   Default-true semantics: any field not specified is shown.
 */
export default function ChargeDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';

  const showName    = fields.charge_name !== false;
  const showUnits   = fields.units       !== false;
  const showRates   = fields.rates       !== false;
  const showCharges = fields.charges     !== false;

  const lines = data.charge_lines || [];
  const totals = data.totals || {};

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Charge Details</Text>
      </View>

      <View style={styles.table}>
        <View style={styles.headerRow}>
          {showName    ? <Text style={[styles.cellName,   styles.headerText]}>Charge Name</Text> : null}
          {showUnits   ? <Text style={[styles.cellUnits,  styles.headerText]}>Units</Text>       : null}
          {showRates   ? <Text style={[styles.cellRates,  styles.headerText]}>Rates</Text>       : null}
          {showCharges ? <Text style={[styles.cellCharge, styles.headerText]}>Charges</Text>     : null}
        </View>

        {lines.length === 0 ? (
          <Text style={styles.emptyRow}>(No charges)</Text>
        ) : (
          lines.map((line, idx) => (
            <View key={idx} style={styles.row}>
              {showName    ? <Text style={styles.cellName}>{line.description || '—'}</Text>                 : null}
              {showUnits   ? <Text style={styles.cellUnits}>{line.quantity ?? 1}</Text>                       : null}
              {showRates   ? <Text style={styles.cellRates}>{formatCents(line.unit_amount_cents)}</Text>      : null}
              {showCharges ? <Text style={styles.cellCharge}>{formatCents(line.total_amount_cents)}</Text>    : null}
            </View>
          ))
        )}

        {lines.length > 0 ? (
          <>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatCents(totals.subtotal_cents)}</Text>
            </View>
            <View style={styles.totalsBoldRow}>
              <Text style={styles.totalsLabelBold}>Total Due</Text>
              <Text style={styles.totalsValueBold}>{formatCents(totals.total_cents)}</Text>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/ChargeDetails.js
git commit -m "feat(pdf): ChargeDetails section component with toggle-aware columns + totals (FU-035-H1)"
```

---

## Task 8: HTML preview components for InvoiceDetails + ChargeDetails

**Files:**
- Create: `components/settings/document-designer/preview/InvoiceDetailsPreview.js`
- Create: `components/settings/document-designer/preview/ChargeDetailsPreview.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js` (register both new previews)

- [ ] **Step 1: Create InvoiceDetailsPreview.js**

Create `components/settings/document-designer/preview/InvoiceDetailsPreview.js`:

```js
/**
 * HTML preview of Invoice Details. Mirrors components/pdf/sections/InvoiceDetails.js.
 * 3-col label-value grid; skips empty values; consolidated footnote.
 */
const FIELD_ORDER = [
  ['invoice_number',     'Invoice Number'],
  ['load_number',        'Load Number'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['invoice_date',       'Invoice Date'],
  ['terms',              'Terms'],
  ['due_date',           'Due Date'],
];

export default function InvoiceDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';
  const termsLabel = data.terms_days > 0 ? `Net ${data.terms_days}` : null;

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = key === 'terms' ? termsLabel : data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0 && !(data.consolidated_count > 1)) return null;

  return (
    <div className="mb-4 pb-3 border-b border-gray-200">
      <div className="grid grid-cols-3 gap-x-4 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: textColor }}>
              {label}
            </div>
            <div className="text-[12px] text-gray-900">{String(value)}</div>
          </div>
        ))}
      </div>
      {data.consolidated_count > 1 ? (
        <div className="mt-2 text-[11px] text-gray-500 italic">
          Includes charges from {data.consolidated_count} loads
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Create ChargeDetailsPreview.js**

Create `components/settings/document-designer/preview/ChargeDetailsPreview.js`:

```js
/**
 * HTML preview of Charge Details. Mirrors components/pdf/sections/ChargeDetails.js.
 * Accent-banded header + dynamic columns + totals footer.
 */
function formatCents(cents) {
  const num = (cents || 0) / 100;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ChargeDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';

  const showName    = fields.charge_name !== false;
  const showUnits   = fields.units       !== false;
  const showRates   = fields.rates       !== false;
  const showCharges = fields.charges     !== false;

  const lines = data.charge_lines || [];
  const totals = data.totals || {};

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Charge Details
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {showName    ? <th className="text-left  px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charge Name</th> : null}
            {showUnits   ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Units</th>       : null}
            {showRates   ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Rates</th>       : null}
            {showCharges ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charges</th>     : null}
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-center italic text-gray-500 py-3">
                (No charges)
              </td>
            </tr>
          ) : (
            lines.map((line, idx) => (
              <tr key={idx} className="border-b border-gray-100">
                {showName    ? <td className="px-2 py-1.5">{line.description || '—'}</td>                                : null}
                {showUnits   ? <td className="text-right px-2 py-1.5">{line.quantity ?? 1}</td>                            : null}
                {showRates   ? <td className="text-right px-2 py-1.5">{formatCents(line.unit_amount_cents)}</td>           : null}
                {showCharges ? <td className="text-right px-2 py-1.5">{formatCents(line.total_amount_cents)}</td>          : null}
              </tr>
            ))
          )}
        </tbody>
        {lines.length > 0 ? (
          <tfoot>
            <tr>
              <td colSpan={3} className="text-right px-2 py-1 text-gray-600">Subtotal</td>
              <td className="text-right px-2 py-1">{formatCents(totals.subtotal_cents)}</td>
            </tr>
            <tr className="border-t border-gray-300">
              <td colSpan={3} className="text-right px-2 py-1 font-bold">Total Due</td>
              <td className="text-right px-2 py-1 font-bold">{formatCents(totals.total_cents)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Register both new preview components in DocumentPreview.js**

Edit `components/settings/document-designer/preview/DocumentPreview.js`. Add the new imports near the top, with the other preview imports:

```js
import InvoiceDetailsPreview        from './InvoiceDetailsPreview';
import ChargeDetailsPreview         from './ChargeDetailsPreview';
```

Then update the `PREVIEW_BY_SECTION_ID` map to include them:

```js
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  invoice_details:        InvoiceDetailsPreview,
  address_details:        AddressDetailsPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  charge_details:         ChargeDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};
```

- [ ] **Step 4: Manually verify Invoice preview renders**

Restart dev server if needed. Open `/settings/document-designer`, switch the doc-type dropdown to **Invoice**. Confirm:
- The toggle list shows 10 sections (Header, Invoice Details, Address Details, Move Events, Order Details, Commodity Details, Charge Details, Notes, Disclaimer, Footer)
- Move Events / Commodity Details / Disclaimer are off by default
- The right pane preview renders with the Invoice sample data:
  - Header: "Your Company"
  - Invoice Details: 6 fields including "INV-2026-001", "L-ABC123", "PO-12345", "Net 30"
  - Address Details: customer block titled "Customer" (Task 5 default — the "Bill To" override comes via composer in Task 11; the preview pane does NOT pass `customerLabel` for now)
  - Charge Details: 4-column table with 3 sample rows + totals footer
- Toggle off "Charge Name" → that column disappears from the Charge Details table

(Note: AddressDetailsPreview will say "Customer" rather than "Bill To" until we add the per-doc-type label override to the preview side. Mark this as a finer-grain follow-up — the **printed PDF** correctness is what matters and will be wired in Task 11.)

- [ ] **Step 5: Commit**

```bash
git add components/settings/document-designer/preview/InvoiceDetailsPreview.js components/settings/document-designer/preview/ChargeDetailsPreview.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): InvoiceDetails + ChargeDetails HTML preview components (FU-035-H1)"
```

---

## Task 9: AddressDetailsPreview customer label parity for Invoice

**Files:**
- Modify: `components/settings/document-designer/preview/AddressDetailsPreview.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

So the Invoice live preview shows "Bill To" (not "Customer"), per the spec's preview-print parity goal. We do this by having `DocumentPreview` pass a per-doc-type `customerLabel` into AddressDetailsPreview.

- [ ] **Step 1: Confirm Task 5 already added customerLabel to AddressDetailsPreview**

Task 5's Step 2 made AddressDetailsPreview accept `opts.customerLabel`. Verify by greping:

```bash
grep -n "customerLabel" components/settings/document-designer/preview/AddressDetailsPreview.js
```

Expected: 2 hits (the const declaration + the `<AddressBlock label={customerLabel}` usage). If the grep returns nothing, go back and finish Task 5 Step 2 before continuing.

- [ ] **Step 2: Update DocumentPreview.js to pass customerLabel for Invoice**

Edit `components/settings/document-designer/preview/DocumentPreview.js`. After computing `opts` for each section:

```js
const opts = { fields: fields[s.id] || {} };
```

Add a per-doc-type override for `address_details` on Invoice:

```js
const opts = { fields: fields[s.id] || {} };
if (s.id === 'address_details' && documentType === 'invoice') {
  opts.customerLabel = 'Bill To';
  // Field-ID translation to keep AddressDetailsPreview's internal API stable:
  // INVOICE_SECTIONS uses bill_to; AddressDetailsPreview reads opts.fields.customer.
  opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
}
```

- [ ] **Step 3: Manually verify Invoice preview shows "Bill To"**

Refresh `/settings/document-designer` with doc type = Invoice. The customer block in the preview's Address Details section should now say "Bill To" (not "Customer"). Toggling off "Bill To" in the editor should hide that block.

Switch back to Delivery Order. Customer block should still say "Customer" — DO is unaffected.

- [ ] **Step 4: Commit**

```bash
git add components/settings/document-designer/preview/AddressDetailsPreview.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): preview shows 'Bill To' for Invoice address (FU-035-H1)"
```

---

## Task 10: Write `buildSectionData` for Invoice + tests

**Files:**
- Create (partial): `components/pdf/InvoiceTemplate.js` (will be completed in Task 12 — for now, only `buildSectionData` is added)
- Create: `tests/invoice-build-section-data.test.mjs`

`buildSectionData(doc)` is a pure function that maps the renderer's data shape into per-section subsets. Exported separately for unit testing.

- [ ] **Step 1: Write the failing test**

Create `tests/invoice-build-section-data.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../components/pdf/InvoiceTemplate.js';

const baseDoc = {
  invoice_id: 'inv-uuid',
  tenant_name: 'Acme Drayage',
  tenant_info: {
    logo_url: 'https://example.com/logo.png',
    address: '1 Main St, Newark, NJ 07102',
    phone: '555-1212',
    website: 'acme.com',
  },
  bill_to: { name: 'Walmart', address_line1: '702 SW 8th', city: 'Bentonville', state: 'AR', zip: '72716' },
  customer_contact: { phone: '555-9999', email: 'ap@walmart.com' },
  bill_to_customer_id: 'cust-walmart-uuid',
  invoice_meta: {
    invoice_number: 'INV-001',
    invoice_date: '2026-04-25',
    due_date: '2026-05-25',
    terms_days: 30,
    is_consolidated: false,
    consolidated_count: 1,
    notes: 'Thank you for your business.',
  },
  first_order: {
    order_id: 'order-uuid',
    order_number: 'L-ABC',
    customer_reference: 'PO-12345',
    container_number: 'MSCU1234567',
    container_size: '40',
    container_type: 'HC',
    chassis_number: 'CHX9999',
    chassis_size: null,
    chassis_type: null,
    chassis_owner: null,
    steamship_line: 'MSC',
    seal_number: 'SEAL999',
    mbol: 'MBL123',
    hbol: 'HBL456',
    booking_number: 'BK789',
    pickup_number: 'PU123',
    is_hazmat: false,
    last_free_day: '2026-04-22',
    per_diem_free_day: '2026-04-25',
    pull_container_date: '2026-04-20',
    return_container_date: '2026-04-23',
    notes: 'Driver notes here',
    internal_notes: 'Load/internal notes here',
  },
  load_level_locations: {
    pickup_location:   { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
    delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
    return_location:   { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
  },
  moves: [],
  charge_lines: [
    { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
    { description: 'FSC',      quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
  ],
  totals: { subtotal_cents: 87500, total_cents: 87500 },
};

test('buildSectionData maps invoice metadata to invoice_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.invoice_details.invoice_number, 'INV-001');
  assert.equal(sd.invoice_details.load_number, 'L-ABC');
  assert.equal(sd.invoice_details.customer_reference, 'PO-12345');
  assert.equal(sd.invoice_details.invoice_date, '2026-04-25');
  assert.equal(sd.invoice_details.terms_days, 30);
  assert.equal(sd.invoice_details.due_date, '2026-05-25');
  assert.equal(sd.invoice_details.consolidated_count, 1);
});

test('buildSectionData passes consolidated_count for consolidated invoice', () => {
  const sd = buildSectionData({
    ...baseDoc,
    invoice_meta: { ...baseDoc.invoice_meta, is_consolidated: true, consolidated_count: 3 },
  });
  assert.equal(sd.invoice_details.consolidated_count, 3);
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.city, 'Bentonville');
  assert.equal(sd.address_details.customer.phone, '555-9999');  // from customer_contact
  assert.equal(sd.address_details.customer.email, 'ap@walmart.com');
});

test('buildSectionData maps load_level_locations to address_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.pickup_location.name,   'Newark Terminal');
  assert.equal(sd.address_details.delivery_location.name, 'Edison Warehouse');
  assert.equal(sd.address_details.return_location.name,   'Newark Terminal');
});

test('buildSectionData maps first_order columns to order_details (19 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.order_details.reference_number,      'PO-12345');
  assert.equal(sd.order_details.container_number,      'MSCU1234567');
  assert.equal(sd.order_details.chassis_number,        'CHX9999');
  assert.equal(sd.order_details.steamship_line,        'MSC');
  assert.equal(sd.order_details.seal,                  'SEAL999');
  assert.equal(sd.order_details.mbol,                  'MBL123');
  assert.equal(sd.order_details.booking_bl,            'BK789');  // sourced from booking_number
  assert.equal(sd.order_details.pickup_number,         'PU123');
  assert.equal(sd.order_details.last_free_day,         '2026-04-22');
  assert.equal(sd.order_details.pull_container_date,   '2026-04-20');
  assert.equal(sd.order_details.return_container_date, '2026-04-23');
});

test('buildSectionData returns null-safe shapes when first_order is null', () => {
  const sd = buildSectionData({ ...baseDoc, first_order: null, load_level_locations: null });
  // Should not crash; sections degrade gracefully.
  assert.equal(sd.address_details.pickup_location, null);
  assert.equal(sd.address_details.delivery_location, null);
  assert.equal(sd.address_details.return_location, null);
  assert.equal(sd.order_details.reference_number, null);  // all 19 fields null
  assert.equal(sd.notes.driver_notes, null);
  assert.equal(sd.notes.load_notes, null);
});

test('buildSectionData maps charge_lines + totals to charge_details', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.charge_details.charge_lines.length, 2);
  assert.equal(sd.charge_details.charge_lines[0].description, 'Linehaul');
  assert.equal(sd.charge_details.totals.subtotal_cents, 87500);
  assert.equal(sd.charge_details.totals.total_cents, 87500);
});

test('buildSectionData maps notes correctly (driver from order.notes, billing from invoice.notes, load from order.internal_notes)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.driver_notes,  'Driver notes here');
  assert.equal(sd.notes.billing_notes, 'Thank you for your business.');
  assert.equal(sd.notes.load_notes,    'Load/internal notes here');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/invoice-build-section-data.test.mjs`
Expected: FAIL — `buildSectionData` not exported (import error).

- [ ] **Step 3: Create the InvoiceTemplate.js skeleton with `buildSectionData` exported**

Create `components/pdf/InvoiceTemplate.js`. For now, just export `buildSectionData`; the composer body comes in Task 12. Replace whatever is currently there with:

```js
import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';

/**
 * Build per-section data subsets for the Invoice composer. Pure function;
 * exported for unit testing. Mirrors DeliveryOrderTemplate.js's pattern.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared between DO and Invoice) reads
 * `data.customer` internally. The Invoice-specific label "Bill To" is
 * applied at the renderSection switch site (Task 12), not here.
 */
export function buildSectionData(doc) {
  const meta = doc.invoice_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    invoice_details: {
      invoice_number:     meta.invoice_number ?? null,
      load_number:        order?.order_number ?? null,
      customer_reference: order?.customer_reference ?? null,
      invoice_date:       meta.invoice_date ?? null,
      terms_days:         meta.terms_days ?? null,
      due_date:           meta.due_date ?? null,
      consolidated_count: meta.consolidated_count ?? 1,
    },
    address_details: {
      customer: doc.bill_to ? {
        name:          doc.bill_to.name,
        address_line1: doc.bill_to.address_line1,
        city:          doc.bill_to.city,
        state:         doc.bill_to.state,
        zip:           doc.bill_to.zip,
        phone:         doc.customer_contact?.phone,
        email:         doc.customer_contact?.email,
      } : null,
      pickup_location:   locations.pickup_location   ?? null,
      delivery_location: locations.delivery_location ?? null,
      return_location:   locations.return_location   ?? null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    order_details: {
      reference_number:      order?.customer_reference  ?? null,
      booking_bl:            order?.booking_number      ?? order?.bl_number ?? null,
      mbol:                  order?.mbol                ?? null,
      hbol:                  order?.hbol                ?? null,
      container_number:      order?.container_number    ?? null,
      container_size:        order?.container_size      ?? null,
      container_type:        order?.container_type      ?? null,
      chassis_number:        order?.chassis_number      ?? null,
      chassis_size:          order?.chassis_size        ?? null,
      chassis_type:          order?.chassis_type        ?? null,
      chassis_owner:         order?.chassis_owner       ?? null,
      steamship_line:        order?.steamship_line      ?? null,
      seal:                  order?.seal_number         ?? null,
      hazmat:                order?.is_hazmat ? 'HAZMAT' : null,
      pickup_number:         order?.pickup_number       ?? null,
      pull_container_date:   order?.pull_container_date ?? null,
      return_container_date: order?.return_container_date ?? null,
      last_free_day:         order?.last_free_day       ?? null,
      per_diem_free_day:     order?.per_diem_free_day   ?? null,
    },
    commodity_details: null,  // No real source yet; sample-data fills preview
    charge_details: {
      charge_lines: doc.charge_lines || [],
      totals:       doc.totals       || { subtotal_cents: 0, total_cents: 0 },
    },
    notes: {
      driver_notes:  order?.notes          ?? null,    // orders.notes  → driver_notes
      billing_notes: meta.notes            ?? null,    // invoices.notes → billing_notes
      load_notes:    order?.internal_notes ?? null,    // orders.internal_notes → load_notes
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}

// Composer body completed in Task 12.
export default function InvoiceTemplate(/* { doc, sectionConfig } */) {
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/invoice-build-section-data.test.mjs`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add components/pdf/InvoiceTemplate.js tests/invoice-build-section-data.test.mjs
git commit -m "feat(pdf): buildSectionData for Invoice + tests (FU-035-H1)"
```

---

## Task 11: Build `fetchInvoiceData`

**Files:**
- Modify: `lib/pdf/render-invoice.js`

`fetchInvoiceData(svc, invoiceId, tenantId)` returns the data shape the composer expects (per spec §7). DB-touching; manual smoke verification only at this layer.

- [ ] **Step 1: Replace `lib/pdf/render-invoice.js` with the new fetcher + skeleton renderer**

Read the current file (`lib/pdf/render-invoice.js`) so you can preserve any error-handling or test-touched edges. Then replace contents with:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import InvoiceTemplate from '../../components/pdf/InvoiceTemplate';
import { resolveTemplateConfig } from './resolve-template-config';

/**
 * Fetch invoice data and shape it for the Document Designer composer.
 * Mirrors fetchDeliveryOrderData's pattern. Returns null if the invoice
 * doesn't exist for this tenant.
 */
export async function fetchInvoiceData(svc, invoiceId, tenantId) {
  // 1. Invoice + bill-to customer (1 query)
  const { data: invoice, error: invErr } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, invoice_date, sent_at, created_at, due_date,
      payment_terms_days, is_consolidated,
      subtotal_cents, total_amount_cents, notes,
      customer_id,
      customer:customers!customer_id(
        id, name, address_line1, address_line2, city, state, zip,
        billing_email, phone
      )
    `)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (invErr) throw new Error(`Invoice fetch failed: ${invErr.message}`);
  if (!invoice) return null;

  // 2. Linked charge sets → orders (1 query, joined)
  const { data: linkRows, error: linkErr } = await svc
    .from('invoice_charge_sets')
    .select(`
      charge_set:order_charge_sets(
        id, charge_set_number, order_id,
        order:orders(
          id, order_number, customer_reference,
          container_number, chassis_number,
          container_size, container_type, chassis_size, chassis_type,
          chassis_owner, steamship_line, seal_number,
          mbol, hbol, booking_number, pickup_number,
          is_hazmat, last_free_day, per_diem_free_day,
          pull_container_date, return_container_date,
          notes, internal_notes
        )
      )
    `)
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId);

  if (linkErr) throw new Error(`invoice_charge_sets lookup failed: ${linkErr.message}`);

  const consolidatedCount = (linkRows || []).length;
  const firstOrder = linkRows?.[0]?.charge_set?.order || null;

  // 3. First order's moves + events (skip if no order)
  let moves = [];
  let loadLevelLocations = { pickup_location: null, delivery_location: null, return_location: null };
  if (firstOrder?.id) {
    const { data: rawMoves, error: movesErr } = await svc
      .from('order_container_moves')
      .select(`
        id, sequence, move_type, status,
        driver:drivers(id, first_name, last_name, phone)
      `)
      .eq('order_id', firstOrder.id)
      .eq('tenant_id', tenantId)
      .order('sequence', { ascending: true });
    if (movesErr) throw new Error(`Moves fetch failed: ${movesErr.message}`);

    const moveIds = (rawMoves || []).map((m) => m.id);
    let events = [];
    if (moveIds.length > 0) {
      const { data: evs, error: evsErr } = await svc
        .from('order_routing_events')
        .select(`
          id, move_id, sequence, event_type,
          scheduled_at, arrived_at, departed_at,
          location_id, location_name, city, state,
          location:customers!order_routing_events_location_id_fkey(id, name, city, state)
        `)
        .in('move_id', moveIds)
        .eq('tenant_id', tenantId)
        .order('sequence', { ascending: true });
      if (evsErr) throw new Error(`Events fetch failed: ${evsErr.message}`);
      events = evs || [];
    }

    moves = (rawMoves || []).map((m) => ({
      id: m.id,
      move_index: m.sequence,
      move_type: m.move_type,
      status: m.status,
      driver: m.driver,
      events: events
        .filter((e) => e.move_id === m.id)
        .map((e) => ({
          sequence: e.sequence,
          event_type: e.event_type,
          scheduled_at: e.scheduled_at,
          arrived_at: e.arrived_at,
          departed_at: e.departed_at,
          location: e.location
            ? { name: e.location.name, city: e.location.city, state: e.location.state }
            : { name: e.location_name, city: e.city, state: e.state },
        })),
    }));

    // Derive load-level locations from the first order's events (matches DO behavior)
    const { deriveLoadLevelLocations } = await import('./render-delivery-order');
    loadLevelLocations = deriveLoadLevelLocations(moves);
  }

  // 4. Invoice line items (1 query)
  const { data: lineItems, error: liErr } = await svc
    .from('invoice_line_items')
    .select('id, description, quantity, unit_amount_cents, total_amount_cents, sort_order')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true });
  if (liErr) throw new Error(`invoice_line_items fetch failed: ${liErr.message}`);

  const chargeLines = (lineItems || []).map((li) => ({
    description:        li.description,
    quantity:           li.quantity,
    unit_amount_cents:  li.unit_amount_cents,
    total_amount_cents: li.total_amount_cents,
  }));

  // 5. Tenant + tenant_settings for Header
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
    invoice_id: invoice.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: invoice.customer
      ? {
          name:          invoice.customer.name,
          address_line1: invoice.customer.address_line1,
          city:          invoice.customer.city,
          state:         invoice.customer.state,
          zip:           invoice.customer.zip,
        }
      : null,
    customer_contact: invoice.customer
      ? { phone: invoice.customer.phone, email: invoice.customer.billing_email }
      : null,
    bill_to_customer_id: invoice.customer_id || null,
    invoice_meta: {
      invoice_number:     invoice.invoice_number,
      invoice_date:       invoice.invoice_date || invoice.sent_at || invoice.created_at,
      due_date:           invoice.due_date,
      terms_days:         invoice.payment_terms_days,
      is_consolidated:    !!invoice.is_consolidated,
      consolidated_count: consolidatedCount,
      notes:              invoice.notes,
    },
    first_order: firstOrder,
    load_level_locations: loadLevelLocations,
    moves,
    charge_lines: chargeLines,
    totals: {
      subtotal_cents: invoice.subtotal_cents,
      total_cents:    invoice.total_amount_cents,
    },
  };
}

/**
 * Fetch invoice data + render as PDF Buffer. Public signature unchanged
 * (callers in send-email + bulk-send pass these 3 args verbatim).
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Invoice not found' if missing or wrong tenant
 */
export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  const doc = await fetchInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'invoice'
  );

  return await renderToBuffer(
    React.createElement(InvoiceTemplate, { doc, sectionConfig })
  );
}
```

- [ ] **Step 2: Verify the file imports cleanly**

Run: `node -e "import('./lib/pdf/render-invoice.js').then(m => console.log(Object.keys(m)))"`
Expected: prints `[ 'fetchInvoiceData', 'renderInvoicePdf' ]` (or similar — no import errors).

If this errors, fix imports before continuing. Note: at this point, `InvoiceTemplate` returns `null` (Task 10 stub) so the actual PDF render would produce an empty document. Task 12 fixes that.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/render-invoice.js
git commit -m "feat(pdf): fetchInvoiceData + cascade-aware renderInvoicePdf (FU-035-H1)"
```

---

## Task 12: Replace `InvoiceTemplate.js` with full composer

**Files:**
- Modify: `components/pdf/InvoiceTemplate.js` (replace the stub composer with the real one)

This is where the section spine + `bill_to ↔ customer` translation lives. After this task, sending an email with an invoice attachment renders a real PDF.

- [ ] **Step 1: Replace the stub composer body**

Edit `components/pdf/InvoiceTemplate.js`. **Keep** the existing `import` block and the `buildSectionData` function (Task 10). **Replace** the stub default export `function InvoiceTemplate() { return null; }` with the full composer.

The complete file should look like this:

```js
import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';

import Header             from './sections/Header';
import InvoiceDetails     from './sections/InvoiceDetails';
import AddressDetails     from './sections/AddressDetails';
import OrderDetails       from './sections/OrderDetails';
import CommodityDetails   from './sections/CommodityDetails';
import ChargeDetails      from './sections/ChargeDetails';
import Notes              from './sections/Notes';
import Disclaimer         from './sections/Disclaimer';
import MoveBlock          from './sections/MoveBlock';
import DocumentFooter     from './sections/DocumentFooter';

/**
 * Build per-section data subsets for the Invoice composer. Pure function;
 * exported for unit testing. Mirrors DeliveryOrderTemplate.js's pattern.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared between DO and Invoice) reads
 * `data.customer` internally. The Invoice-specific label "Bill To" is
 * applied at the renderSection switch site below, not here.
 */
export function buildSectionData(doc) {
  const meta = doc.invoice_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    invoice_details: {
      invoice_number:     meta.invoice_number ?? null,
      load_number:        order?.order_number ?? null,
      customer_reference: order?.customer_reference ?? null,
      invoice_date:       meta.invoice_date ?? null,
      terms_days:         meta.terms_days ?? null,
      due_date:           meta.due_date ?? null,
      consolidated_count: meta.consolidated_count ?? 1,
    },
    address_details: {
      customer: doc.bill_to ? {
        name:          doc.bill_to.name,
        address_line1: doc.bill_to.address_line1,
        city:          doc.bill_to.city,
        state:         doc.bill_to.state,
        zip:           doc.bill_to.zip,
        phone:         doc.customer_contact?.phone,
        email:         doc.customer_contact?.email,
      } : null,
      pickup_location:   locations.pickup_location   ?? null,
      delivery_location: locations.delivery_location ?? null,
      return_location:   locations.return_location   ?? null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    order_details: {
      reference_number:      order?.customer_reference  ?? null,
      booking_bl:            order?.booking_number      ?? order?.bl_number ?? null,
      mbol:                  order?.mbol                ?? null,
      hbol:                  order?.hbol                ?? null,
      container_number:      order?.container_number    ?? null,
      container_size:        order?.container_size      ?? null,
      container_type:        order?.container_type      ?? null,
      chassis_number:        order?.chassis_number      ?? null,
      chassis_size:          order?.chassis_size        ?? null,
      chassis_type:          order?.chassis_type        ?? null,
      chassis_owner:         order?.chassis_owner       ?? null,
      steamship_line:        order?.steamship_line      ?? null,
      seal:                  order?.seal_number         ?? null,
      hazmat:                order?.is_hazmat ? 'HAZMAT' : null,
      pickup_number:         order?.pickup_number       ?? null,
      pull_container_date:   order?.pull_container_date ?? null,
      return_container_date: order?.return_container_date ?? null,
      last_free_day:         order?.last_free_day       ?? null,
      per_diem_free_day:     order?.per_diem_free_day   ?? null,
    },
    commodity_details: null,
    charge_details: {
      charge_lines: doc.charge_lines || [],
      totals:       doc.totals       || { subtotal_cents: 0, total_cents: 0 },
    },
    notes: {
      driver_notes:  order?.notes          ?? null,
      billing_notes: meta.notes            ?? null,
      load_notes:    order?.internal_notes ?? null,
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}

function renderSection(sectionId, doc, sectionData, opts, ctx, colors) {
  switch (sectionId) {
    case 'header':
      return (
        <Header
          tenantName={sectionData.header.tenantName}
          tenantInfo={sectionData.header.tenantInfo}
          title={ctx.title}
          subtitle={ctx.subtitle}
          opts={opts}
          colors={colors}
        />
      );
    case 'invoice_details':
      return <InvoiceDetails data={sectionData.invoice_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: Invoice's registry uses `bill_to`; AddressDetails
      // reads `opts.fields.customer` internally. Per-doc-type "Bill To" label
      // is supplied via opts.customerLabel here. See spec §3.2.
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'order_details':
      return <OrderDetails data={sectionData.order_details} opts={opts} colors={colors} />;
    case 'move_events':
      return (
        <MoveBlock
          data={{ moves: doc.moves }}
          opts={opts}
          isNextMoveOnly={false}
          totalMoves={doc.moves?.length ?? 0}
        />
      );
    case 'commodity_details':
      return <CommodityDetails data={sectionData.commodity_details} opts={opts} colors={colors} />;
    case 'charge_details':
      return <ChargeDetails data={sectionData.charge_details} opts={opts} colors={colors} />;
    case 'notes':
      return <Notes data={sectionData.notes} opts={opts} />;
    case 'disclaimer':
      return <Disclaimer data={sectionData.disclaimer} colors={colors} />;
    case 'footer':
      return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:
      return null;
  }
}

export default function InvoiceTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('invoice');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'invoice', title: 'INVOICE', subtitle: null };

  return (
    <Document>
      <Page size="LETTER" style={typography.page} wrap>
        {order.map((sectionId) => {
          if (!visibility[sectionId]) return null;
          const baseOpts = sectionConfig?.perSection?.[sectionId] || {};
          const opts = { ...baseOpts, fields: fields[sectionId] || {} };
          const node = renderSection(sectionId, doc, sectionData, opts, ctx, colors);
          return node ? <React.Fragment key={sectionId}>{node}</React.Fragment> : null;
        })}
      </Page>
    </Document>
  );
}
```

- [ ] **Step 2: Re-run buildSectionData tests to confirm export still works**

Run: `node --test tests/invoice-build-section-data.test.mjs`
Expected: PASS — 8 tests still pass (export structure unchanged).

- [ ] **Step 3: Run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all tests, including 35 existing DO tests + new Invoice tests, all green.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/InvoiceTemplate.js
git commit -m "feat(pdf): InvoiceTemplate composer replaces hardcoded template (FU-035-H1)"
```

---

## Task 13: Manual verification + dd-qa pass

This task has no code changes — it's the manual smoke pass that a unit test layer can't reach (React-PDF render output, end-to-end flow, multi-load behavior).

- [ ] **Step 1: Run all unit tests one more time**

Run: `node --test tests/`
Expected: ALL pass — DO regression + new Invoice tests.

- [ ] **Step 2: Restart the dev server**

```bash
npm run dev
```

Wait for it to compile clean. If there's any ESM import error, fix and re-run.

- [ ] **Step 3: Open Document Designer for Invoice**

Navigate to `/settings/document-designer?type=invoice`. Verify:

- The toggle list shows 10 sections (Header, Invoice Details, Address Details, Move Events, Order Details, Commodity Details, Charge Details, Notes, Disclaimer, Footer)
- Default-off sections (Move Events, Commodity Details, Disclaimer) have their master toggle OFF; others ON
- Right pane preview renders Invoice's sample data (Bill To says "Bill To" not "Customer"; Charge Details shows the 3-row sample table with totals)
- Toggling off "Charge Name" → that column disappears from the table preview
- Toggling off the "Charge Details" master → entire section disappears from the preview
- Save button enables when dirty; clicking Save persists with no validation error

- [ ] **Step 4: Test customer-scoped override**

In the doc designer, switch the customer dropdown to a specific customer. Edit an accent color (e.g. red). Save. Switch back to "All Customers" — confirm the tenant default's color is the original blue (override is isolated to the customer).

- [ ] **Step 5: Send-email a real invoice**

In a new tab, navigate to `/ar/invoices`. Pick an invoice (any unsent one) and click Send Email. Send to a test inbox. Open the resulting PDF and verify:

- Header has tenant logo + address + phone
- Invoice Details grid shows Invoice Number, Load Number, Customer Reference, Invoice Date, "Net 30" terms, Due Date
- Address Details has "Bill To" block (NOT "Customer"), pickup/delivery/return location blocks if available
- Charge Details table with accent-banded header, line items, Subtotal + Total Due footer
- Footer with tenant name

Take a screenshot of the rendered PDF for the followups.md note.

- [ ] **Step 6: Print a real Delivery Order (regression check)**

In a new tab, navigate to `/loads` and bulk-print a single load as a Delivery Order. Open the PDF. Verify:
- Customer block still says "Customer" (NOT "Bill To") — DO regression check
- All other DO sections render as before

- [ ] **Step 7: Test consolidated invoice**

Find or create an invoice with `is_consolidated = true` (multiple charge sets). Send-email it. Verify:
- Italic "Includes charges from N loads" footnote appears below Invoice Details
- Address/Order/Move sections render the FIRST linked order's data
- Charge Details aggregates all line items
- No crashes

- [ ] **Step 8: Run the dd-qa skill**

Use the dd-qa skill (auto-runs after file edits, but invoke explicitly here as a final check):

```
/dd-qa
```

Address any findings before final commit.

- [ ] **Step 9: Commit verification artifacts (if any)**

If you saved screenshots or captured anything to put in handoffs, commit those:

```bash
git add docs/handoffs/  # (only if anything new was saved)
git commit -m "docs: FU-035-H1 manual verification artifacts" --allow-empty
```

If nothing to commit, skip this step.

---

## Task 14: Close FU-035-H1 in followups.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`

- [ ] **Step 1: Update FU-035-H1 entry**

Open `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`. Find the FU-035-H1 entry (under FU-035-H, around the area showing "FU-035-H1 Invoice"). Change its status from open to "Resolved" and add a one-line summary:

```
- **FU-035-H1 Invoice** — ✅ Resolved YYYY-MM-DD. Migrated from hardcoded
  React-PDF template to section-registry composer. INVOICE_SECTIONS (10 sections,
  47 leaf toggles). Cascade resolver per-customer. Live preview matches print.
  Multi-load consolidated invoices show first-order data + footnote (proper
  multi-load = H3). Spec/plan: docs/superpowers/specs/2026-04-27-...,
  docs/superpowers/plans/2026-04-27-... .
```

(Use the actual date when you commit — `git log -1 --format=%cd` if needed.)

- [ ] **Step 2: Add new follow-ups noted in spec §13**

Append two new entries after the resolved FU-035-H1:

```
### FU-035-H1-followup-A: Integration smoke for renderInvoicePdf
- Source: FU-035-H1 spec §13
- Scope: small
- Area: pdf / tests
- Intent: Add a Supabase-mock-backed integration test that calls renderInvoicePdf and asserts the returned Buffer starts with the PDF magic bytes (%PDF-). Currently only manual smoke verifies the renderer end-to-end.
- Notes: Pattern: stub svc with the 5-6 query mock responses that fetchInvoiceData expects. Cheap insurance against future regression.

### FU-035-H1-followup-B: Visual diff harness for old vs new templates
- Source: FU-035-H1 spec §13
- Scope: medium
- Area: pdf / tools
- Intent: Build a small CLI that renders the same invoice ID via the legacy template (revert checkout + render) and the new composer (HEAD render), then byte-diffs or pixel-diffs the outputs. Useful before H2/H3 to catch composer regressions in shared components.
- Notes: Could leverage existing `npx pdftotext` for text-only diff, or pdf-image-extract for visual diff.
```

- [ ] **Step 3: Stage memory file change**

```bash
git -C C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory add followups.md
git -C C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory commit -m "ledger: resolve FU-035-H1 + open H1-followup-A/B"
```

(The memory directory is its own git repo — separate from the app repo.)

- [ ] **Step 4: Final app-repo commit**

```bash
git log --oneline -15
```

Expected: shows ~13 commits from this plan, ending with Task 12's composer-rewrite commit. Verify the chain looks clean.

If you want a wrap-up commit referencing the FU number explicitly:

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: FU-035-H1 Invoice Document Designer migration complete

Replaces hardcoded InvoiceTemplate.js with a section-registry composer
mirroring FU-035-D2's Delivery Order pattern. 10 sections, 47 leaf
toggles. AddressDetails parameterized via customerLabel. New ChargeDetails
component with toggle-aware columns + totals. Multi-load consolidated
invoices: first-order data + footnote (H3 = proper redesign).

Resolves: FU-035-H1
EOF
)"
```

---

## Self-review notes

After writing the plan, I scanned it against the spec:

**Spec coverage check:**
- §1 Goal: Task 12 (composer rewrite) is the keystone; Tasks 1-11 build the inputs
- §2 Non-goals: explicitly skipped (no migrations, no name/description split, no Free Units/Hours toggles)
- §3 Architecture: 3.1 (independent registry) → Task 2; 3.2 (customerLabel) → Task 5; 3.3 (new ChargeDetails) → Task 7; 3.4 (single-page composer) → Task 12; 3.5 (consolidated footnote) → Task 6 (InvoiceDetails component) + Task 10 (buildSectionData) + Task 11 (consolidated_count from fetcher)
- §4 File touch-list: every entry has a task
- §5 INVOICE_SECTIONS: Task 2 inlines the full registry
- §6 DOCUMENT_TYPES: Task 1
- §7 Renderer data shape: Task 11
- §8 Composer: Task 12
- §9 Renderer: Task 11
- §10 Component breakdown: 10.1 → Task 6; 10.2 → Task 7; 10.3 → Task 5; 10.4 → Tasks 8 + 9; 10.5 → Task 4; 10.6 → Task 4
- §11 Test plan: Tasks 1, 2, 3, 10
- §12 Risks: covered via the file touches the tasks make
- §13 Follow-ups: filed in Task 14

**Type/name consistency check:**
- `buildSectionData` exported from `components/pdf/InvoiceTemplate.js` — same name in Task 10, Task 12, and the test file
- `fetchInvoiceData` + `renderInvoicePdf` named consistently in Task 11
- Section IDs: header / invoice_details / address_details / move_events / order_details / commodity_details / charge_details / notes / disclaimer / footer — consistent in Tasks 2, 4 (sample-data), 6, 7, 8, 10, 12
- Field IDs: `bill_to` (Invoice registry) → `customer` (AddressDetails internal) translation in Task 12 only; consistent with §3.2

No placeholder issues noted; every step has either explicit code or an explicit command + expected output.

**Open spec items not directly testable in tests/ layer:** ChargeDetails / InvoiceDetails / their previews / fetchInvoiceData are all manual-smoke (Task 13). This matches the spec's §11.1 acknowledgement that React-PDF / HTML rendering / DB-backed code is not automated at the test layer.
