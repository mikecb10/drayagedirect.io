# FU-035-H3 Combined Invoice Document Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace H1's first-order-only fallback for `is_consolidated` invoices with a proper multi-load layout (Loads Summary table + Charge Details grouped by load with per-load subtotals + grand total). Public `renderInvoicePdf(svc, invoiceId, tenantId)` signature unchanged — peeks `is_consolidated` and delegates to a new combined-invoice composer.

**Architecture:** New `'combined_invoice'` doc type with its own `COMBINED_INVOICE_SECTIONS` registry (8 sections, 24 leaf toggles). New section component pair (LoadsSummary PDF + Preview). Two extensions to existing components: `ChargeDetails` gains `opts.groupByLoad` (default `false` preserves Invoice + Rate Con); `InvoiceDetails` renders Load Number as `"(N loads)"` when `consolidated_count > 1`. New fetcher in `lib/pdf/render-combined-invoice.js` reads ALL N orders (no per-order moves+events fetch — uses `orders.pickup_org` / `delivery_org` directly, cheaper). `lib/pdf/render-invoice.js`'s public entry point peeks the invoice's `is_consolidated` flag and routes to the new composer when set.

**Tech Stack:** Next.js 15 + React 19, @react-pdf/renderer 4.5, Supabase Postgres, Tailwind 4, native Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-04-27-fu-035-h3-combined-invoice-document-designer-design.md`](../specs/2026-04-27-fu-035-h3-combined-invoice-document-designer-design.md)

---

## Task 1: Add `'combined_invoice'` to `DOCUMENT_TYPES` registry

**Files:**
- Create: `tests/document-types-constants-combined-invoice.test.mjs`
- Modify: `lib/constants/document-types.js`
- Modify: `tests/document-types-constants.test.mjs` (exhaustive list update — same minimal pattern as H1 + H2)

- [ ] **Step 1: Write the failing test**

Create `tests/document-types-constants-combined-invoice.test.mjs`:

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

test("'combined_invoice' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('combined_invoice'), `missing 'combined_invoice' in: ${ids.join(', ')}`);
});

test("getDocumentType('combined_invoice') returns category 'ar', label 'Combined Invoice'", () => {
  const entry = getDocumentType('combined_invoice');
  assert.equal(entry.value, 'combined_invoice');
  assert.equal(entry.label, 'Combined Invoice');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('combined_invoice') is true", () => {
  assert.equal(isValidDocumentType('combined_invoice'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('combined_invoice'));
  assert.equal(DOCUMENT_TYPE_LABELS['combined_invoice'], 'Combined Invoice');
});

test('all 5 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-types-constants-combined-invoice.test.mjs`
Expected: FAIL — `missing 'combined_invoice'`.

- [ ] **Step 3: Add 'combined_invoice' to DOCUMENT_TYPES**

Edit `lib/constants/document-types.js`. Append the new entry after the `'rate_con'` entry:

```js
  {
    value: 'combined_invoice',
    label: 'Combined Invoice',
    description: 'Multi-load invoice consolidating charges from N loads',
    category: 'ar',
  },
```

The full array should now have 5 entries: `delivery_order_full`, `delivery_order_next_move`, `invoice`, `rate_con`, `combined_invoice`.

- [ ] **Step 4: Update the existing exhaustive-list test**

Read `tests/document-types-constants.test.mjs`. Find the hardcoded `deepEqual` exhaustive list assertion (the same line that was updated in H1 + H2 Tasks 1). Update the array to include `'combined_invoice'`. One-line change to a single assertion.

- [ ] **Step 5: Run new test to verify it passes**

Run: `node --test tests/document-types-constants-combined-invoice.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Run all existing tests to verify no regression**

Run: `node --test tests/document-types-constants.test.mjs`
Expected: PASS — all 4 doc-type tests still green.

- [ ] **Step 7: Commit**

```bash
git add tests/document-types-constants-combined-invoice.test.mjs tests/document-types-constants.test.mjs lib/constants/document-types.js
git commit -m "feat(doc-designer): register 'combined_invoice' in DOCUMENT_TYPES (FU-035-H3)"
```

---

## Task 2: Add `COMBINED_INVOICE_SECTIONS` to section registry

**Files:**
- Create: `tests/document-sections-combined-invoice-constants.test.mjs`
- Modify: `lib/constants/document-sections.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-sections-combined-invoice-constants.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  COMBINED_INVOICE_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('COMBINED_INVOICE_SECTIONS entries have required keys', () => {
  for (const s of COMBINED_INVOICE_SECTIONS) {
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

test('all 8 Combined Invoice sections present in expected order', () => {
  const ids = COMBINED_INVOICE_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'invoice_details', 'address_details', 'loads_summary',
    'charge_details', 'notes', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing Combined Invoice section: ${id}`);
  }
  assert.equal(COMBINED_INVOICE_SECTIONS.length, 8);
});

test('footer is non-toggleable on Combined Invoice', () => {
  const footer = COMBINED_INVOICE_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('disclaimer defaults off on Combined Invoice', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'disclaimer');
  assert.equal(s.defaultVisible, false);
});

test('invoice_details has 6 fields (same as Invoice)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'invoice_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'invoice_number', 'load_number', 'customer_reference',
    'invoice_date', 'terms', 'due_date',
  ]) {
    assert.ok(fieldIds.includes(id), `missing invoice_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 6);
});

test('address_details has ONLY bill_to (NO location fields)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'), 'bill_to required');
  assert.ok(!fieldIds.includes('customer'),           'customer should NOT be on combined_invoice');
  assert.ok(!fieldIds.includes('pickup_location'),    'pickup_location should NOT be on combined_invoice (per-load)');
  assert.ok(!fieldIds.includes('delivery_location'),  'delivery_location should NOT be on combined_invoice (per-load)');
  assert.ok(!fieldIds.includes('return_location'),    'return_location should NOT be on combined_invoice (per-load)');
  assert.equal(fieldIds.length, 1);
});

test('loads_summary has 7 fields', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'loads_summary');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'load_number', 'container_number', 'chassis_number',
    'pickup_location', 'delivery_location',
    'pickup_date', 'delivery_date',
  ]) {
    assert.ok(fieldIds.includes(id), `missing loads_summary field: ${id}`);
  }
  assert.equal(fieldIds.length, 7);
});

test('charge_details has 4 fields (same as Invoice)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'charge_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['charge_name', 'units', 'rates', 'charges']) {
    assert.ok(fieldIds.includes(id), `missing charge_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 4);
});

test('notes has ONLY billing_notes (NOT driver/load notes)', () => {
  const s = COMBINED_INVOICE_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('billing_notes'), 'billing_notes required');
  assert.ok(!fieldIds.includes('driver_notes'), 'driver_notes should NOT be on combined_invoice (per-load, ambiguous)');
  assert.ok(!fieldIds.includes('load_notes'),   'load_notes should NOT be on combined_invoice (per-load, ambiguous)');
  assert.equal(fieldIds.length, 1);
});

test("getSectionsForDocumentType('combined_invoice') returns COMBINED_INVOICE_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('combined_invoice'), COMBINED_INVOICE_SECTIONS);
});

test('computeVisibility honors COMBINED_INVOICE_SECTIONS defaults with no config', () => {
  const result = computeVisibility(COMBINED_INVOICE_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.invoice_details, true);
  assert.equal(result.visibility.loads_summary, true);
  assert.equal(result.visibility.charge_details, true);
  assert.equal(result.visibility.disclaimer, false);  // default off
  assert.equal(result.visibility.footer, true);       // non-toggleable
  assert.equal(result.fields.charge_details.charge_name, true);
  assert.equal(result.fields.notes.billing_notes, true);
  assert.equal(result.fields.loads_summary.chassis_number, false);  // chassis_number defaults off per spec
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-combined-invoice-constants.test.mjs`
Expected: FAIL — `COMBINED_INVOICE_SECTIONS` not exported.

- [ ] **Step 3: Add `COMBINED_INVOICE_SECTIONS` and register it**

Edit `lib/constants/document-sections.js`. **Append** the following AFTER the existing `RATE_CON_SECTIONS` constant (do NOT touch DELIVERY_ORDER_SECTIONS, INVOICE_SECTIONS, or RATE_CON_SECTIONS):

```js
export const COMBINED_INVOICE_SECTIONS = [
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
      { id: 'bill_to', label: 'Bill To', defaultVisible: true },
    ],
  },
  {
    id: 'loads_summary',
    label: 'Loads Summary',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'load_number',       label: 'Load #',            defaultVisible: true },
      { id: 'container_number',  label: 'Container #',       defaultVisible: true },
      { id: 'chassis_number',    label: 'Chassis #',         defaultVisible: false },
      { id: 'pickup_location',   label: 'Pickup Location',   defaultVisible: true },
      { id: 'delivery_location', label: 'Delivery Location', defaultVisible: true },
      { id: 'pickup_date',       label: 'Pickup Date',       defaultVisible: true },
      { id: 'delivery_date',     label: 'Delivery Date',     defaultVisible: true },
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
      { id: 'billing_notes', label: 'Billing Notes', defaultVisible: true },
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

Then update `SECTIONS_BY_DOCUMENT_TYPE`. After H2's Task 2 it looks like:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
};
```

Replace with:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
  combined_invoice: COMBINED_INVOICE_SECTIONS,
};
```

- [ ] **Step 4: Run new test to verify it passes**

Run: `node --test tests/document-sections-combined-invoice-constants.test.mjs`
Expected: PASS — 11 tests pass.

- [ ] **Step 5: Run existing constant tests to verify no regression**

Run: `node --test tests/document-sections-constants.test.mjs tests/document-sections-invoice-constants.test.mjs tests/document-sections-rate-con-constants.test.mjs`
Expected: PASS — all existing DO + Invoice + Rate Con tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/document-sections-combined-invoice-constants.test.mjs lib/constants/document-sections.js
git commit -m "feat(doc-designer): add COMBINED_INVOICE_SECTIONS registry (FU-035-H3)"
```

---

## Task 3: Validator regression tests for Combined Invoice

**Files:**
- Create: `tests/validate-section-config-combined-invoice.test.mjs`

The validator (`lib/pdf/validate-section-config.js`) is per-doc-type-aware (FU-112). After Task 2, it auto-supports Combined Invoice. These tests confirm field-ID isolation across all 4 doc types now.

- [ ] **Step 1: Write the test file**

Create `tests/validate-section-config-combined-invoice.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on combined_invoice's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS pickup_location=false on combined_invoice (Invoice/Rate-Con-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { pickup_location: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /pickup_location/);
});

test("validator REJECTS customer=false on combined_invoice (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /customer/);
});

test("validator REJECTS driver_notes=false on combined_invoice's notes", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { driver_notes: false } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /driver_notes/);
});

test("validator accepts loads_summary fields on combined_invoice", () => {
  const r = validateSectionConfig(
    { perSection: { loads_summary: { fields: { container_number: false, chassis_number: true } } } },
    'combined_invoice',
  );
  assert.equal(r.ok, true);
});

test('field-ID isolation: loads_summary.fields rejected on Invoice / Rate Con / DO', () => {
  const payload = { perSection: { loads_summary: { fields: { load_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'combined_invoice').ok,    true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test("validator accepts a full combined_invoice section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { invoice_details: true, loads_summary: true, disclaimer: false },
      perSection: {
        loads_summary:   { fields: { load_number: true, container_number: true, chassis_number: false, pickup_location: true, delivery_location: true, pickup_date: true, delivery_date: true } },
        charge_details:  { fields: { charge_name: true, units: true, rates: true, charges: true } },
        notes:           { fields: { billing_notes: true } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'combined_invoice',
  );
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/validate-section-config-combined-invoice.test.mjs`
Expected: PASS — all 7 tests pass without any code change. Validator already supports Combined Invoice via `getSectionsForDocumentType('combined_invoice')` (which Task 2 wired up).

- [ ] **Step 3: Commit**

```bash
git add tests/validate-section-config-combined-invoice.test.mjs
git commit -m "test(doc-designer): regression tests for validator against COMBINED_INVOICE_SECTIONS (FU-035-H3)"
```

---

## Task 4: Create sample-data-combined-invoice.js + register in DocumentPreview

**Files:**
- Create: `lib/document-designer/sample-data-combined-invoice.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Create the new Combined Invoice sample data file**

Create `lib/document-designer/sample-data-combined-invoice.js`:

```js
// Mirror this shape against buildSectionData() in lib/pdf/build-combined-invoice-section-data.js —
// drift here means the preview shows different content than the printed PDF.
//
// Combined Invoice differs from Invoice in 3 ways:
//   1. invoice_details.consolidated_count = N > 1 → InvoiceDetails renders "(N loads)" for Load Number
//   2. address_details.customer is the Bill To (only field; no per-load locations)
//   3. NEW loads_summary array (N rows) and charge_details with charge_groups (N groups + grand total)

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
    invoice_number: 'INV-2026-007',
    load_number: null,  // overridden to "(3 loads)" by InvoiceDetails when consolidated_count > 1
    customer_reference: 'PO-99999',
    invoice_date: 'MONTH DD, YYYY',
    terms_days: 30,
    due_date: 'MONTH DD, YYYY',
    consolidated_count: 3,
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
    pickup_location:   null,  // per-load — not shown at the document level
    delivery_location: null,
    return_location:   null,
    appointment_times: null,
    is_operational_street_turn: false,
  },
  loads_summary: [
    {
      order_id: 'order-1-uuid',
      load_number: 'L-ABC',
      container_number: 'MSCU1234567',
      chassis_number: 'CHX9999',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
      pickup_date: 'MONTH DD',
      delivery_date: 'MONTH DD',
    },
    {
      order_id: 'order-2-uuid',
      load_number: 'L-DEF',
      container_number: 'MSCU5678901',
      chassis_number: 'CHX1234',
      pickup_location: { name: 'Elizabeth Port', city: 'Elizabeth', state: 'NJ' },
      delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
      pickup_date: 'MONTH DD',
      delivery_date: 'MONTH DD',
    },
    {
      order_id: 'order-3-uuid',
      load_number: 'L-GHI',
      container_number: 'MSCU9999999',
      chassis_number: 'CHX5555',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Bayonne Yard', city: 'Bayonne', state: 'NJ' },
      pickup_date: 'MONTH DD',
      delivery_date: 'MONTH DD',
    },
  ],
  charge_details: {
    charge_groups: [
      {
        order_id: 'order-1-uuid',
        load_number: 'L-ABC',
        lines: [
          { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
          { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
        ],
        subtotal_cents: 87500,
      },
      {
        order_id: 'order-2-uuid',
        load_number: 'L-DEF',
        lines: [
          { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
          { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
          { description: 'Chassis Day Use',           quantity: 2, unit_amount_cents: 3500,  total_amount_cents: 7000 },
        ],
        subtotal_cents: 94500,
      },
      {
        order_id: 'order-3-uuid',
        load_number: 'L-GHI',
        lines: [
          { description: 'Linehaul - 40\' Container', quantity: 1, unit_amount_cents: 100000, total_amount_cents: 100000 },
          { description: 'Fuel Surcharge',            quantity: 1, unit_amount_cents: 12000,  total_amount_cents: 12000 },
        ],
        subtotal_cents: 112000,
      },
    ],
    totals: {
      subtotal_cents: 294000,
      total_cents: 294000,
    },
  },
  notes: {
    billing_notes: 'SAMPLE billing notes — payment terms apply to total of all loads.',
  },
  disclaimer: {
    text: 'Disclaimer text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
```

- [ ] **Step 2: Register the new sample in DocumentPreview.js**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Find the imports section near the top:

```js
import sampleDataDeliveryOrder from '../../../../lib/document-designer/sample-data-delivery-order';
import sampleDataInvoice       from '../../../../lib/document-designer/sample-data-invoice';
import sampleDataRateCon       from '../../../../lib/document-designer/sample-data-rate-con';
```

Add a fourth import line:

```js
import sampleDataCombinedInvoice from '../../../../lib/document-designer/sample-data-combined-invoice';
```

Then find the `SAMPLE_BY_DOCUMENT_TYPE` map. After H2's Task 4 it looks like:

```js
const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
  rate_con:                 sampleDataRateCon,
};
```

Add the combined_invoice entry:

```js
const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
  rate_con:                 sampleDataRateCon,
  combined_invoice:         sampleDataCombinedInvoice,
};
```

- [ ] **Step 3: Commit**

```bash
git add lib/document-designer/sample-data-combined-invoice.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): add Combined Invoice sample data + DocumentPreview registration (FU-035-H3)"
```

---

## Task 5: Add `groupByLoad` prop to ChargeDetails (PDF + Preview)

**Files:**
- Modify: `components/pdf/sections/ChargeDetails.js`
- Modify: `components/settings/document-designer/preview/ChargeDetailsPreview.js`

When `opts.groupByLoad === true`, the component renders `data.charge_groups` (an array of per-load buckets with subtotals + grand total) instead of `data.charge_lines`. Default `false` preserves Invoice + Rate Con behavior.

- [ ] **Step 1: Edit ChargeDetails.js (PDF)**

Read `components/pdf/sections/ChargeDetails.js`. After H2's Task 5, the `showSubtotal` prop is already in place. We're adding a parallel `groupByLoad` prop and a separate rendering branch.

Find the destructuring at the top of the function:

```js
export default function ChargeDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
```

Add the `groupByLoad` flag after `showSubtotal`:

```js
export default function ChargeDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
  const groupByLoad = opts?.groupByLoad === true;
```

Then find the body table block. Currently after the `<View style={[styles.band, { backgroundColor: accent }]}>` accent header + the column header row + the body rows + the totals footer.

We need to add an early-branch when `groupByLoad`. Replace the section that renders the column header row + body rows + totals (everything inside the `<View style={styles.table}>` wrapper) with a conditional:

```js
      <View style={styles.table}>
        {groupByLoad ? (
          // Grouped mode (Combined Invoice): render data.charge_groups
          // Each group: Load # sub-header → group's lines → "Subtotal: $X" row
          // After all groups: "GRAND TOTAL: $Y" bold row
          (() => {
            const groups = data.charge_groups || [];
            const grand = data.totals?.total_cents ?? groups.reduce((sum, g) => sum + (g.subtotal_cents || 0), 0);

            if (groups.length === 0) {
              return <Text style={styles.emptyRow}>(No charges)</Text>;
            }

            return (
              <>
                {groups.map((g, gIdx) => (
                  <View key={g.order_id || gIdx}>
                    {/* Group sub-header */}
                    <View style={styles.groupHeader}>
                      <Text style={styles.groupHeaderText}>Load #{g.load_number || '—'}</Text>
                    </View>
                    {/* Column header row inside each group */}
                    <View style={styles.headerRow}>
                      {fields.charge_name !== false ? <Text style={[styles.cellName,   styles.headerText]}>Charge Name</Text> : null}
                      {fields.units       !== false ? <Text style={[styles.cellUnits,  styles.headerText]}>Units</Text>       : null}
                      {fields.rates       !== false ? <Text style={[styles.cellRates,  styles.headerText]}>Rates</Text>       : null}
                      {fields.charges     !== false ? <Text style={[styles.cellCharge, styles.headerText]}>Charges</Text>     : null}
                    </View>
                    {/* Group's line items */}
                    {(g.lines || []).map((line, lIdx) => (
                      <View key={lIdx} style={styles.row}>
                        {fields.charge_name !== false ? <Text style={styles.cellName}>{line.description || '—'}</Text>                 : null}
                        {fields.units       !== false ? <Text style={styles.cellUnits}>{line.quantity ?? 1}</Text>                       : null}
                        {fields.rates       !== false ? <Text style={styles.cellRates}>{formatCents(line.unit_amount_cents)}</Text>      : null}
                        {fields.charges     !== false ? <Text style={styles.cellCharge}>{formatCents(line.total_amount_cents)}</Text>    : null}
                      </View>
                    ))}
                    {/* Group subtotal */}
                    <View style={styles.totalsRow}>
                      <Text style={styles.totalsLabel}>Subtotal</Text>
                      <Text style={styles.totalsValue}>{formatCents(g.subtotal_cents)}</Text>
                    </View>
                  </View>
                ))}
                {/* Grand total */}
                <View style={styles.totalsBoldRow}>
                  <Text style={styles.totalsLabelBold}>GRAND TOTAL</Text>
                  <Text style={styles.totalsValueBold}>{formatCents(grand)}</Text>
                </View>
              </>
            );
          })()
        ) : (
          <>
            <View style={styles.headerRow}>
              {fields.charge_name !== false ? <Text style={[styles.cellName,   styles.headerText]}>Charge Name</Text> : null}
              {fields.units       !== false ? <Text style={[styles.cellUnits,  styles.headerText]}>Units</Text>       : null}
              {fields.rates       !== false ? <Text style={[styles.cellRates,  styles.headerText]}>Rates</Text>       : null}
              {fields.charges     !== false ? <Text style={[styles.cellCharge, styles.headerText]}>Charges</Text>     : null}
            </View>

            {(data.charge_lines || []).length === 0 ? (
              <Text style={styles.emptyRow}>(No charges)</Text>
            ) : (
              (data.charge_lines || []).map((line, idx) => (
                <View key={idx} style={styles.row}>
                  {fields.charge_name !== false ? <Text style={styles.cellName}>{line.description || '—'}</Text>                 : null}
                  {fields.units       !== false ? <Text style={styles.cellUnits}>{line.quantity ?? 1}</Text>                       : null}
                  {fields.rates       !== false ? <Text style={styles.cellRates}>{formatCents(line.unit_amount_cents)}</Text>      : null}
                  {fields.charges     !== false ? <Text style={styles.cellCharge}>{formatCents(line.total_amount_cents)}</Text>    : null}
                </View>
              ))
            )}

            {(data.charge_lines || []).length > 0 ? (
              <>
                {showSubtotal ? (
                  <View style={styles.totalsRow}>
                    <Text style={styles.totalsLabel}>Subtotal</Text>
                    <Text style={styles.totalsValue}>{formatCents(data.totals?.subtotal_cents)}</Text>
                  </View>
                ) : null}
                <View style={styles.totalsBoldRow}>
                  <Text style={styles.totalsLabelBold}>Total Due</Text>
                  <Text style={styles.totalsValueBold}>{formatCents(data.totals?.total_cents)}</Text>
                </View>
              </>
            ) : null}
          </>
        )}
      </View>
```

(The non-`groupByLoad` branch is the existing behavior, just relocated inside the new conditional.)

Then add 2 new style entries to the `styles` object near the top of the file (after existing entries like `totalsLabelBold`):

```js
  groupHeader: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: defaultColors.tableHeader,
    marginTop: 6,
  },
  groupHeaderText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: defaultColors.muted,
  },
```

- [ ] **Step 2: Edit ChargeDetailsPreview.js (HTML)**

Apply the same `groupByLoad` parameterization. Read `components/settings/document-designer/preview/ChargeDetailsPreview.js`. Find the destructuring at the top:

```js
export default function ChargeDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
```

Add `groupByLoad`:

```js
export default function ChargeDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
  const groupByLoad = opts?.groupByLoad === true;
```

Wrap the existing `<table>` block in a conditional. The full structure becomes:

```js
  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Charge Details
      </div>
      {groupByLoad ? (
        (() => {
          const groups = data.charge_groups || [];
          const grand = data.totals?.total_cents ?? groups.reduce((sum, g) => sum + (g.subtotal_cents || 0), 0);
          if (groups.length === 0) {
            return <div className="text-center italic text-gray-500 py-3">(No charges)</div>;
          }
          return (
            <div>
              {groups.map((g, gIdx) => (
                <div key={g.order_id || gIdx} className="mb-3">
                  <div className="bg-gray-100 px-2 py-1 font-bold text-[11px]">
                    Load #{g.load_number || '—'}
                  </div>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        {fields.charge_name !== false ? <th className="text-left  px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charge Name</th> : null}
                        {fields.units       !== false ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Units</th>       : null}
                        {fields.rates       !== false ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Rates</th>       : null}
                        {fields.charges     !== false ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charges</th>     : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(g.lines || []).map((line, lIdx) => (
                        <tr key={lIdx} className="border-b border-gray-100">
                          {fields.charge_name !== false ? <td className="px-2 py-1.5">{line.description || '—'}</td>                                : null}
                          {fields.units       !== false ? <td className="text-right px-2 py-1.5">{line.quantity ?? 1}</td>                            : null}
                          {fields.rates       !== false ? <td className="text-right px-2 py-1.5">{formatCents(line.unit_amount_cents)}</td>           : null}
                          {fields.charges     !== false ? <td className="text-right px-2 py-1.5">{formatCents(line.total_amount_cents)}</td>          : null}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="text-right px-2 py-1 text-gray-600">Subtotal</td>
                        <td className="text-right px-2 py-1">{formatCents(g.subtotal_cents)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}
              <div className="mt-2 border-t border-gray-300 pt-2 flex justify-end">
                <div className="font-bold mr-4">GRAND TOTAL</div>
                <div className="font-bold w-24 text-right">{formatCents(grand)}</div>
              </div>
            </div>
          );
        })()
      ) : (
        <table className="w-full text-[11px]">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {fields.charge_name !== false ? <th className="text-left  px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charge Name</th> : null}
              {fields.units       !== false ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Units</th>       : null}
              {fields.rates       !== false ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Rates</th>       : null}
              {fields.charges     !== false ? <th className="text-right px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Charges</th>     : null}
            </tr>
          </thead>
          <tbody>
            {(data.charge_lines || []).length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center italic text-gray-500 py-3">
                  (No charges)
                </td>
              </tr>
            ) : (
              (data.charge_lines || []).map((line, idx) => (
                <tr key={idx} className="border-b border-gray-100">
                  {fields.charge_name !== false ? <td className="px-2 py-1.5">{line.description || '—'}</td>                                : null}
                  {fields.units       !== false ? <td className="text-right px-2 py-1.5">{line.quantity ?? 1}</td>                            : null}
                  {fields.rates       !== false ? <td className="text-right px-2 py-1.5">{formatCents(line.unit_amount_cents)}</td>           : null}
                  {fields.charges     !== false ? <td className="text-right px-2 py-1.5">{formatCents(line.total_amount_cents)}</td>          : null}
                </tr>
              ))
            )}
          </tbody>
          {(data.charge_lines || []).length > 0 ? (
            <tfoot>
              {showSubtotal ? (
                <tr>
                  <td colSpan={3} className="text-right px-2 py-1 text-gray-600">Subtotal</td>
                  <td className="text-right px-2 py-1">{formatCents(data.totals?.subtotal_cents)}</td>
                </tr>
              ) : null}
              <tr className="border-t border-gray-300">
                <td colSpan={3} className="text-right px-2 py-1 font-bold">Total Due</td>
                <td className="text-right px-2 py-1 font-bold">{formatCents(data.totals?.total_cents)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      )}
    </div>
  );
```

(The non-`groupByLoad` branch is the existing behavior unchanged.)

- [ ] **Step 3: Run all DO + Invoice + Rate Con regression tests**

Run: `node --test tests/`
Expected: ALL existing tests pass. The default `groupByLoad === false` (i.e., not `true`) means no behavior change for any existing Invoice or Rate Con caller.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/ChargeDetails.js components/settings/document-designer/preview/ChargeDetailsPreview.js
git commit -m "feat(pdf): ChargeDetails groupByLoad prop for combined invoices (FU-035-H3)"
```

---

## Task 6: Add `(N loads)` Load Number rendering to InvoiceDetails (PDF + Preview)

**Files:**
- Modify: `components/pdf/sections/InvoiceDetails.js`
- Modify: `components/settings/document-designer/preview/InvoiceDetailsPreview.js`

When `data.consolidated_count > 1`, the Load Number row renders as `"(N loads)"` instead of a single load_number string.

- [ ] **Step 1: Edit InvoiceDetails.js (PDF)**

Read `components/pdf/sections/InvoiceDetails.js`. Find the `.map()` block that constructs `rows`:

```js
  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = key === 'terms' ? termsLabel : data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);
```

Replace with:

```js
  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      let value;
      if (key === 'terms') {
        value = termsLabel;
      } else if (key === 'load_number' && data.consolidated_count > 1) {
        value = `(${data.consolidated_count} loads)`;
      } else {
        value = data[key];
      }
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);
```

(One condition added: when `key === 'load_number'` AND `consolidated_count > 1`, render `"(N loads)"` instead of `data.load_number`.)

- [ ] **Step 2: Edit InvoiceDetailsPreview.js (HTML)**

Apply the same change to the preview. Read `components/settings/document-designer/preview/InvoiceDetailsPreview.js`. Find the equivalent `.map()` block and apply the identical transformation.

- [ ] **Step 3: Run all existing tests**

Run: `node --test tests/`
Expected: ALL existing tests pass. The new branch only activates when `consolidated_count > 1`, which Invoice's sample data doesn't have (consolidated_count = 1).

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/InvoiceDetails.js components/settings/document-designer/preview/InvoiceDetailsPreview.js
git commit -m "feat(pdf): InvoiceDetails Load Number renders '(N loads)' when consolidated (FU-035-H3)"
```

---

## Task 7: Build `LoadsSummary` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/LoadsSummary.js`
- Create: `components/settings/document-designer/preview/LoadsSummaryPreview.js`

7-column toggle-aware table renderer. Mirrors ChargeDetails's accent-banded header pattern but operates on the loads array.

- [ ] **Step 1: Create LoadsSummary.js (PDF)**

Create `components/pdf/sections/LoadsSummary.js`:

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
  cell: { flex: 1, fontSize: 9 },
  cellLoad:    { flex: 1, fontSize: 9 },
  cellCont:    { flex: 1.4, fontSize: 9 },
  cellChassis: { flex: 1, fontSize: 9 },
  cellLoc:     { flex: 1.6, fontSize: 9 },
  cellDate:    { flex: 1, fontSize: 9 },
  headerText: {
    fontWeight: 'bold',
    fontSize: 8,
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
};

function locationText(loc) {
  if (!loc) return '—';
  const parts = [loc.city, loc.state].filter(Boolean).join(', ');
  return parts || loc.name || '—';
}

/**
 * Loads Summary section — toggle-aware N-row table for consolidated invoices.
 *   Header band (accent-color) + column header row + N body rows (one per load).
 *
 * `data` shape: Array<{ order_id, load_number, container_number, chassis_number,
 *                       pickup_location: { name, city, state } | null,
 *                       delivery_location: { name, city, state } | null,
 *                       pickup_date, delivery_date }>
 *
 * `opts.fields`: { load_number, container_number, chassis_number,
 *                  pickup_location, delivery_location, pickup_date, delivery_date }
 *   Default-true semantics (chassis_number defaults false per registry).
 */
export default function LoadsSummary({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';

  const showLoad     = fields.load_number       !== false;
  const showCont     = fields.container_number  !== false;
  const showChassis  = fields.chassis_number    !== false;
  const showPickup   = fields.pickup_location   !== false;
  const showDelivery = fields.delivery_location !== false;
  const showPDate    = fields.pickup_date       !== false;
  const showDDate    = fields.delivery_date     !== false;

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Loads</Text>
      </View>

      <View style={styles.headerRow}>
        {showLoad     ? <Text style={[styles.cellLoad,    styles.headerText]}>Load #</Text>     : null}
        {showCont     ? <Text style={[styles.cellCont,    styles.headerText]}>Container</Text>  : null}
        {showChassis  ? <Text style={[styles.cellChassis, styles.headerText]}>Chassis</Text>    : null}
        {showPickup   ? <Text style={[styles.cellLoc,     styles.headerText]}>Pickup</Text>     : null}
        {showDelivery ? <Text style={[styles.cellLoc,     styles.headerText]}>Delivery</Text>   : null}
        {showPDate    ? <Text style={[styles.cellDate,    styles.headerText]}>P. Date</Text>    : null}
        {showDDate    ? <Text style={[styles.cellDate,    styles.headerText]}>D. Date</Text>    : null}
      </View>

      {data.length === 0 ? (
        <Text style={styles.emptyRow}>(No loads)</Text>
      ) : (
        data.map((load, idx) => (
          <View key={load.order_id || idx} style={styles.row}>
            {showLoad     ? <Text style={styles.cellLoad}>{load.load_number || '—'}</Text>                    : null}
            {showCont     ? <Text style={styles.cellCont}>{load.container_number || '—'}</Text>               : null}
            {showChassis  ? <Text style={styles.cellChassis}>{load.chassis_number || '—'}</Text>              : null}
            {showPickup   ? <Text style={styles.cellLoc}>{locationText(load.pickup_location)}</Text>          : null}
            {showDelivery ? <Text style={styles.cellLoc}>{locationText(load.delivery_location)}</Text>        : null}
            {showPDate    ? <Text style={styles.cellDate}>{load.pickup_date || '—'}</Text>                    : null}
            {showDDate    ? <Text style={styles.cellDate}>{load.delivery_date || '—'}</Text>                  : null}
          </View>
        ))
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create LoadsSummaryPreview.js (HTML)**

Create `components/settings/document-designer/preview/LoadsSummaryPreview.js`:

```js
/**
 * HTML preview of the Loads Summary section. Mirrors components/pdf/sections/LoadsSummary.js.
 * Accent-banded header + 7 toggleable columns + N rows.
 */
function locationText(loc) {
  if (!loc) return '—';
  const parts = [loc.city, loc.state].filter(Boolean).join(', ');
  return parts || loc.name || '—';
}

export default function LoadsSummaryPreview({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';

  const showLoad     = fields.load_number       !== false;
  const showCont     = fields.container_number  !== false;
  const showChassis  = fields.chassis_number    !== false;
  const showPickup   = fields.pickup_location   !== false;
  const showDelivery = fields.delivery_location !== false;
  const showPDate    = fields.pickup_date       !== false;
  const showDDate    = fields.delivery_date     !== false;

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Loads
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {showLoad     ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Load #</th>    : null}
            {showCont     ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Container</th> : null}
            {showChassis  ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Chassis</th>   : null}
            {showPickup   ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Pickup</th>    : null}
            {showDelivery ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Delivery</th>  : null}
            {showPDate    ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">P. Date</th>   : null}
            {showDDate    ? <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">D. Date</th>   : null}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={7} className="text-center italic text-gray-500 py-3">
                (No loads)
              </td>
            </tr>
          ) : (
            data.map((load, idx) => (
              <tr key={load.order_id || idx} className="border-b border-gray-100">
                {showLoad     ? <td className="px-2 py-1.5">{load.load_number || '—'}</td>                    : null}
                {showCont     ? <td className="px-2 py-1.5">{load.container_number || '—'}</td>               : null}
                {showChassis  ? <td className="px-2 py-1.5">{load.chassis_number || '—'}</td>                 : null}
                {showPickup   ? <td className="px-2 py-1.5">{locationText(load.pickup_location)}</td>         : null}
                {showDelivery ? <td className="px-2 py-1.5">{locationText(load.delivery_location)}</td>       : null}
                {showPDate    ? <td className="px-2 py-1.5">{load.pickup_date || '—'}</td>                    : null}
                {showDDate    ? <td className="px-2 py-1.5">{load.delivery_date || '—'}</td>                  : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/pdf/sections/LoadsSummary.js components/settings/document-designer/preview/LoadsSummaryPreview.js
git commit -m "feat(pdf): LoadsSummary section component (PDF + HTML preview) (FU-035-H3)"
```

---

## Task 8: Wire combined_invoice in DocumentPreview (LoadsSummary registration + groupByLoad + customerLabel)

**Files:**
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Register LoadsSummaryPreview**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Add import for the new component near the other preview imports:

```js
import LoadsSummaryPreview          from './LoadsSummaryPreview';
```

Then find the `PREVIEW_BY_SECTION_ID` map. After H2's tasks it has 11 entries. Add `loads_summary` between `address_details` and `order_details`:

```js
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  invoice_details:        InvoiceDetailsPreview,
  rate_con_details:       RateConDetailsPreview,
  address_details:        AddressDetailsPreview,
  loads_summary:          LoadsSummaryPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  charge_details:         ChargeDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};
```

- [ ] **Step 2: Add per-doc-type override block for combined_invoice**

In the same file, find the section-render loop with the existing per-doc-type override blocks (placed after `const opts = ...` and before the JSX return). After the existing `address_details && documentType === 'invoice'` and `charge_details && documentType === 'rate_con'` blocks, add:

```js
if (s.id === 'address_details' && documentType === 'combined_invoice') {
  // Same field-ID translation as Invoice. INVOICE_SECTIONS uses bill_to;
  // AddressDetailsPreview reads opts.fields.customer.
  // Mirrored in components/pdf/CombinedInvoiceTemplate.js renderSection().
  opts.customerLabel = 'Bill To';
  opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
}
if (s.id === 'charge_details' && documentType === 'combined_invoice') {
  // Combined invoice groups line items by load. ChargeDetailsPreview reads
  // data.charge_groups (per-load buckets) instead of data.charge_lines.
  // Mirrored in components/pdf/CombinedInvoiceTemplate.js renderSection().
  opts.groupByLoad = true;
}
```

- [ ] **Step 3: Manual verify**

Defer to Task 12. For now, just confirm the file imports without obvious typos.

- [ ] **Step 4: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): preview wires combined_invoice section overrides (FU-035-H3)"
```

---

## Task 9: Build `buildSectionData` for Combined Invoice + tests

**Files:**
- Create: `lib/pdf/build-combined-invoice-section-data.js`
- Create: `tests/combined-invoice-build-section-data.test.mjs`

Per H1's lesson learned, `buildSectionData` lives in `lib/pdf/` so the unit test runs under bare Node without a JSX transformer.

- [ ] **Step 1: Write the failing test**

Create `tests/combined-invoice-build-section-data.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-combined-invoice-section-data.js';

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
    invoice_number: 'INV-007',
    invoice_date: 'Apr 25, 2026',
    due_date: 'May 25, 2026',
    terms_days: 30,
    is_consolidated: true,
    consolidated_count: 3,
    notes: 'Multi-load batch billing',
  },
  loads_summary: [
    { order_id: 'o1', load_number: 'L-ABC', container_number: 'MSCU1', chassis_number: 'CHX1',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Edison WH', city: 'Edison', state: 'NJ' },
      pickup_date: 'Apr 26', delivery_date: 'Apr 26' },
    { order_id: 'o2', load_number: 'L-DEF', container_number: 'MSCU2', chassis_number: 'CHX2',
      pickup_location: { name: 'Elizabeth Port', city: 'Elizabeth', state: 'NJ' },
      delivery_location: { name: 'Edison WH', city: 'Edison', state: 'NJ' },
      pickup_date: 'Apr 27', delivery_date: 'Apr 27' },
    { order_id: 'o3', load_number: 'L-GHI', container_number: 'MSCU3', chassis_number: 'CHX3',
      pickup_location: { name: 'Newark Terminal', city: 'Newark', state: 'NJ' },
      delivery_location: { name: 'Bayonne Yard', city: 'Bayonne', state: 'NJ' },
      pickup_date: 'Apr 28', delivery_date: 'Apr 28' },
  ],
  charge_groups: [
    { order_id: 'o1', load_number: 'L-ABC', lines: [
        { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
      ], subtotal_cents: 75000 },
    { order_id: 'o2', load_number: 'L-DEF', lines: [
        { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
        { description: 'FSC',      quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
      ], subtotal_cents: 87500 },
    { order_id: 'o3', load_number: 'L-GHI', lines: [
        { description: 'Linehaul', quantity: 1, unit_amount_cents: 100000, total_amount_cents: 100000 },
      ], subtotal_cents: 100000 },
  ],
  totals: { subtotal_cents: 262500, total_cents: 262500 },
};

test('buildSectionData maps invoice metadata with consolidated_count > 1', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.invoice_details.invoice_number, 'INV-007');
  assert.equal(sd.invoice_details.consolidated_count, 3);
  assert.equal(sd.invoice_details.terms_days, 30);
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.phone, '555-9999');
  assert.equal(sd.address_details.customer.email, 'ap@walmart.com');
});

test('buildSectionData passes loads_summary array through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.loads_summary.length, 3);
  assert.equal(sd.loads_summary[0].load_number, 'L-ABC');
  assert.equal(sd.loads_summary[1].container_number, 'MSCU2');
  assert.equal(sd.loads_summary[2].pickup_location.city, 'Newark');
});

test('buildSectionData passes charge_groups + totals through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.charge_details.charge_groups.length, 3);
  assert.equal(sd.charge_details.charge_groups[0].subtotal_cents, 75000);
  assert.equal(sd.charge_details.charge_groups[1].lines.length, 2);
  assert.equal(sd.charge_details.totals.total_cents, 262500);
});

test('buildSectionData maps notes.billing_notes from invoice_meta.notes', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.billing_notes, 'Multi-load batch billing');
});

test('buildSectionData returns null-safe shapes when arrays are missing', () => {
  const sd = buildSectionData({ ...baseDoc, loads_summary: null, charge_groups: null });
  assert.deepEqual(sd.loads_summary, []);
  assert.deepEqual(sd.charge_details.charge_groups, []);
});

test('buildSectionData omits per-load notes (driver/load notes are not registered for combined_invoice)', () => {
  const sd = buildSectionData(baseDoc);
  // billing_notes is the only registered field
  assert.ok('billing_notes' in sd.notes);
  // driver_notes / load_notes should NOT be in the output
  assert.equal(sd.notes.driver_notes, undefined);
  assert.equal(sd.notes.load_notes,   undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/combined-invoice-build-section-data.test.mjs`
Expected: FAIL — `buildSectionData` not exported (import error).

- [ ] **Step 3: Create the helper**

Create `lib/pdf/build-combined-invoice-section-data.js`:

```js
/**
 * Build per-section data subsets for the Combined Invoice composer.
 * Pure function; exported for unit testing. Lives in lib/pdf/ so tests/
 * can import it without a JSX-capable runner.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/CombinedInvoiceTemplate.js).
 *
 * Combined Invoice differs from Invoice in 4 places:
 *   1. invoice_details.consolidated_count drives "(N loads)" rendering
 *   2. address_details has only the customer (Bill To); pickup/delivery/return are per-load
 *   3. NEW loads_summary: pass-through of doc.loads_summary[]
 *   4. charge_details has charge_groups (per-load buckets with subtotals) instead of charge_lines
 *   5. notes has only billing_notes (driver/load notes are per-load, ambiguous)
 */
export function buildSectionData(doc) {
  const meta = doc.invoice_meta || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    invoice_details: {
      invoice_number:     meta.invoice_number ?? null,
      load_number:        null,  // overridden by InvoiceDetails when consolidated_count > 1 → "(N loads)"
      customer_reference: null,  // ambiguous on consolidated; could populate if all orders share same PO — defer
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
      // Combined Invoice has no per-load locations at the document level.
      pickup_location:   null,
      delivery_location: null,
      return_location:   null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    loads_summary: doc.loads_summary || [],
    charge_details: {
      charge_groups: doc.charge_groups || [],
      totals:        doc.totals       || { subtotal_cents: 0, total_cents: 0 },
    },
    notes: {
      billing_notes: meta.notes ?? null,
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/combined-invoice-build-section-data.test.mjs`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/build-combined-invoice-section-data.js tests/combined-invoice-build-section-data.test.mjs
git commit -m "feat(pdf): buildSectionData for Combined Invoice + tests (FU-035-H3)"
```

---

## Task 10: Build `fetchCombinedInvoiceData` + `renderCombinedInvoicePdf`

**Files:**
- Create: `lib/pdf/render-combined-invoice.js`

NEW renderer module that fetches all N orders + groups line items by order_id. Skips per-order moves+events fetch — uses `orders.pickup_org` / `delivery_org` directly (cheaper, billing-correct).

- [ ] **Step 1: Create render-combined-invoice.js**

Create `lib/pdf/render-combined-invoice.js`:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import CombinedInvoiceTemplate from '../../components/pdf/CombinedInvoiceTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';

/**
 * Fetch consolidated invoice data and shape it for the combined-invoice
 * composer. Returns null if the invoice doesn't exist for this tenant.
 *
 * Uses orders.pickup_org / orders.delivery_org directly for the Loads Summary
 * locations (cheaper than per-order moves+events fetch — and the configured
 * pickup/delivery is the billing-correct answer, not the actual first-pull /
 * last-deliver event location).
 */
export async function fetchCombinedInvoiceData(svc, invoiceId, tenantId) {
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

  // 2. ALL linked charge sets → ALL N orders + their pickup_org / delivery_org (1 query, joined)
  const { data: linkRows, error: linkErr } = await svc
    .from('invoice_charge_sets')
    .select(`
      charge_set:order_charge_sets(
        id, charge_set_number, order_id,
        order:orders(
          id, order_number, customer_reference,
          container_number, chassis_number,
          pickup_apt_from, delivery_apt_from,
          pickup_org:customers!orders_pickup_location_id_fkey(id, name, city, state),
          delivery_org:customers!orders_delivery_location_id_fkey(id, name, city, state)
        )
      )
    `)
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId);

  if (linkErr) throw new Error(`invoice_charge_sets lookup failed: ${linkErr.message}`);

  const consolidatedCount = (linkRows || []).length;

  // Build loads_summary array, one per order. Preserve link order.
  const loadsSummary = (linkRows || [])
    .map((link) => link.charge_set?.order)
    .filter(Boolean)
    .map((order) => ({
      order_id:          order.id,
      load_number:       order.order_number,
      container_number:  order.container_number,
      chassis_number:    order.chassis_number,
      pickup_location:   order.pickup_org
        ? { name: order.pickup_org.name, city: order.pickup_org.city, state: order.pickup_org.state }
        : null,
      delivery_location: order.delivery_org
        ? { name: order.delivery_org.name, city: order.delivery_org.city, state: order.delivery_org.state }
        : null,
      pickup_date:       formatDate(order.pickup_apt_from),
      delivery_date:     formatDate(order.delivery_apt_from),
    }));

  // 3. Invoice line items grouped by order_id (1 query)
  const { data: lineItems, error: liErr } = await svc
    .from('invoice_line_items')
    .select('id, order_id, description, quantity, unit_amount_cents, total_amount_cents, sort_order')
    .eq('invoice_id', invoiceId)
    .eq('tenant_id', tenantId)
    .order('sort_order', { ascending: true });
  if (liErr) throw new Error(`invoice_line_items fetch failed: ${liErr.message}`);

  // Group by order_id, preserving the loadsSummary order.
  const linesByOrder = new Map();
  for (const li of lineItems || []) {
    const key = li.order_id || '__orphan__';
    if (!linesByOrder.has(key)) linesByOrder.set(key, []);
    linesByOrder.get(key).push({
      description:        li.description,
      quantity:           li.quantity,
      unit_amount_cents:  li.unit_amount_cents,
      total_amount_cents: li.total_amount_cents,
    });
  }
  const chargeGroups = loadsSummary
    .map((load) => {
      const lines = linesByOrder.get(load.order_id) || [];
      const subtotal_cents = lines.reduce((sum, l) => sum + (l.total_amount_cents || 0), 0);
      return { order_id: load.order_id, load_number: load.load_number, lines, subtotal_cents };
    })
    .filter((g) => g.lines.length > 0); // omit groups with no line items (defensive)

  // 4. Tenant + tenant_settings for Header (1 query each)
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
      invoice_date:       formatDate(invoice.invoice_date || invoice.sent_at || invoice.created_at),
      due_date:           formatDate(invoice.due_date),
      terms_days:         invoice.payment_terms_days,
      is_consolidated:    !!invoice.is_consolidated,
      consolidated_count: consolidatedCount,
      notes:              invoice.notes,
    },
    loads_summary: loadsSummary,
    charge_groups: chargeGroups,
    totals: {
      subtotal_cents: invoice.subtotal_cents,
      total_cents:    invoice.total_amount_cents,
    },
  };
}

/**
 * Fetch combined-invoice data + render as PDF Buffer. Public entry-point
 * is renderInvoicePdf in lib/pdf/render-invoice.js (which delegates here
 * when invoice.is_consolidated is true).
 *
 * @param {SupabaseClient} svc
 * @param {string} invoiceId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Invoice not found' if missing or wrong tenant
 */
export async function renderCombinedInvoicePdf(svc, invoiceId, tenantId) {
  const doc = await fetchCombinedInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'combined_invoice'
  );

  return await renderToBuffer(
    React.createElement(CombinedInvoiceTemplate, { doc, sectionConfig })
  );
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all existing tests continue to pass. Note: at this point `CombinedInvoiceTemplate` doesn't yet exist (Task 11). The renderer can still be imported because the import is only used at JSX time inside `renderCombinedInvoicePdf`, which isn't called by any test.

If any test fails because of the new import, address before continuing.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/render-combined-invoice.js
git commit -m "feat(pdf): fetchCombinedInvoiceData + cascade-aware renderCombinedInvoicePdf (FU-035-H3)"
```

---

## Task 11: Add peek-and-delegate to `renderInvoicePdf`

**Files:**
- Modify: `lib/pdf/render-invoice.js`

`renderInvoicePdf` peeks `invoice.is_consolidated` and delegates to `renderCombinedInvoicePdf` when set. Public 3-arg signature preserved.

- [ ] **Step 1: Edit lib/pdf/render-invoice.js**

Read the existing file. Find `export async function renderInvoicePdf(svc, invoiceId, tenantId)` (around line 168). Replace its body:

```js
export async function renderInvoicePdf(svc, invoiceId, tenantId) {
  // Peek at is_consolidated to decide which composer to use.
  // Single-column SELECT — microseconds. Trade-off: 1 extra round-trip on
  // every Invoice render in exchange for keeping renderInvoicePdf's public
  // signature unchanged (callers in send-email + bulk-send + pdf/invoice/[id]
  // + archive.js stay untouched).
  const { data: peek } = await svc
    .from('invoices')
    .select('is_consolidated')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (peek?.is_consolidated) {
    const { renderCombinedInvoicePdf } = await import('./render-combined-invoice');
    return renderCombinedInvoicePdf(svc, invoiceId, tenantId);
  }

  // Single-load path (existing logic)
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

(`fetchInvoiceData` itself stays unchanged — the new logic only adds a peek + delegation at the top, then falls through to the existing single-load body.)

- [ ] **Step 2: Run all tests**

Run: `node --test tests/`
Expected: PASS — all existing tests continue to pass. The peek is only exercised at runtime, not in unit tests.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/render-invoice.js
git commit -m "feat(pdf): renderInvoicePdf peeks is_consolidated + delegates to combined-invoice composer (FU-035-H3)"
```

Note: At this point, `CombinedInvoiceTemplate.js` doesn't exist yet, so the delegation would fail at runtime if a consolidated invoice is rendered. Task 12 fixes that.

---

## Task 12: Build `CombinedInvoiceTemplate.js` composer

**Files:**
- Create: `components/pdf/CombinedInvoiceTemplate.js`

Mirrors InvoiceTemplate.js's pattern. Renders 8 sections with renderSection switch. Injects `groupByLoad: true` for charge_details and translates `bill_to → customer` for address_details (same as Invoice).

- [ ] **Step 1: Create components/pdf/CombinedInvoiceTemplate.js**

Create the file:

```js
import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import { buildSectionData } from '../../lib/pdf/build-combined-invoice-section-data';

import Header             from './sections/Header';
import InvoiceDetails     from './sections/InvoiceDetails';
import AddressDetails     from './sections/AddressDetails';
import LoadsSummary       from './sections/LoadsSummary';
import ChargeDetails      from './sections/ChargeDetails';
import Notes              from './sections/Notes';
import Disclaimer         from './sections/Disclaimer';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-combined-invoice-section-data';

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
      // Field-ID translation: COMBINED_INVOICE_SECTIONS uses `bill_to`;
      // AddressDetails reads `opts.fields.customer` internally. Per-doc-type
      // "Bill To" label is supplied via opts.customerLabel here. Mirrored in
      // components/settings/document-designer/preview/DocumentPreview.js for
      // the live HTML preview path — keep the two in sync.
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'loads_summary':
      return <LoadsSummary data={sectionData.loads_summary} opts={opts} colors={colors} />;
    case 'charge_details': {
      // Combined invoice groups line items by load. ChargeDetails reads
      // data.charge_groups (per-load buckets) instead of data.charge_lines
      // when groupByLoad is true.
      // Mirrored in DocumentPreview.js for the live HTML preview path.
      const chargeOpts = { ...opts, groupByLoad: true };
      return <ChargeDetails data={sectionData.charge_details} opts={chargeOpts} colors={colors} />;
    }
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

export default function CombinedInvoiceTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('combined_invoice');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'combined_invoice', title: 'INVOICE', subtitle: null };

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

- [ ] **Step 2: Re-run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all tests pass except the pre-existing fire-trigger-entity-aware failure.

- [ ] **Step 3: Commit**

```bash
git add components/pdf/CombinedInvoiceTemplate.js
git commit -m "feat(pdf): CombinedInvoiceTemplate composer (FU-035-H3)"
```

---

## Task 13: Manual verification + dd-qa pass

This task has no code changes — it's the manual smoke pass that a unit test layer can't reach.

- [ ] **Step 1: Run all unit tests one more time**

Run: `node --test tests/`
Expected: ALL pass — DO + Invoice + Rate Con regressions + new Combined Invoice tests. Only the pre-existing fire-trigger failure should remain.

- [ ] **Step 2: Restart the dev server**

```bash
npm run dev
```

Wait for clean compile.

- [ ] **Step 3: Open Document Designer for Combined Invoice**

Navigate to `/settings/document-designer?type=combined_invoice`. Verify:
- The Configuration Bar shows "Combined Invoice" in the doc-type dropdown
- The toggle list shows 8 sections (Header, Invoice Details, Address Details, Loads Summary, Charge Details, Notes, Disclaimer, Footer)
- Disclaimer's master toggle is OFF; others ON
- Right pane preview renders sample combined invoice:
  - Header: "Your Company"
  - Invoice Details: 6 fields including Load Number rendered as "(3 loads)"
  - Address Details: 1 block titled "Bill To" with "SAMPLE BILL TO"
  - Loads Summary: 3-row table with Load # / Container / Pickup / Delivery / Dates
  - Charge Details: 3 grouped sections (Load #L-ABC, L-DEF, L-GHI), each with line items + Subtotal, then GRAND TOTAL = $2,940
- Toggle off "Chassis #" in Loads Summary → that column disappears from preview
- Toggle off "Charge Details" master → entire section disappears

- [ ] **Step 4: Test customer-scoped override**

Switch the customer dropdown to a specific customer. Edit accent color. Save. Switch back to All Customers → tenant default's color is unchanged.

- [ ] **Step 5: Test single-load Invoice regression**

Switch the doc-type dropdown to "Invoice". Verify:
- Address Details shows "Bill To" (Invoice's behavior preserved)
- Charge Details shows BOTH Subtotal AND Total Due rows (showSubtotal default true preserved)
- 10 sections still listed

- [ ] **Step 6: Test Rate Con regression**

Switch to "Rate Confirmation". Verify:
- 11 sections listed
- Address Details: NO customer block (rate_con doesn't have customer/bill_to fields)
- Rate Details (charge_details with rate-con label): shows ONLY Total Due (showSubtotal=false)

- [ ] **Step 7: Test Delivery Order regression**

Switch to "Delivery Order — Full". Verify:
- Address Details says "Customer" label (DO regression preserved)

- [ ] **Step 8: Send-email a real consolidated invoice**

Find or create an invoice with 2+ linked charge_sets (`is_consolidated=true`). Send email via `/ar/invoices`. Open the resulting PDF and verify:
- Header has tenant branding
- Invoice Details with "Load Number: (N loads)" instead of a single load_number
- Address Details "Bill To" block (NOT showing Pickup/Delivery)
- Loads Summary table with N rows
- Charge Details grouped by load with per-load Subtotals + GRAND TOTAL
- Footer

- [ ] **Step 9: Send-email a single-load Invoice (regression)**

Pick a non-consolidated invoice. Send-email. Verify:
- Old single-load Invoice layout still renders correctly
- Charge Details shows flat table with Subtotal + Total Due
- The peek-and-delegate correctly routed to the single-load path

- [ ] **Step 10: Run dd-qa skill**

```
/dd-qa
```

Address any findings.

- [ ] **Step 11: Optional commit (verification artifacts)**

If you saved screenshots or notes:

```bash
git add docs/handoffs/  # only if anything new was saved
git commit -m "docs: FU-035-H3 manual verification artifacts" --allow-empty
```

---

## Task 14: Close FU-035-H3 in followups.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Update FU-035-H3 entry in followups.md**

Find the FU-035-H3 sub-bullet (after the resolved H1 + H2 entries). Currently:

```
  - **FU-035-H3 Combined Invoice** — multi-load invoice; new fetch logic spans N orders + their charge sets.
```

Replace with:

```
  - **FU-035-H3 Combined Invoice** — ✅ Resolved YYYY-MM-DD. Replaced H1's first-order-only fallback with a proper multi-load layout: Loads Summary table (N rows, 7 toggleable columns) + Charge Details grouped by load with per-load Subtotal + GRAND TOTAL. New 'combined_invoice' doc type with own COMBINED_INVOICE_SECTIONS registry (8 sections, 24 leaf toggles). New LoadsSummary section component pair. ChargeDetails gained groupByLoad prop (default false preserves Invoice + Rate Con). InvoiceDetails Load Number renders "(N loads)" when consolidated_count > 1. Public renderInvoicePdf signature unchanged — peeks invoice.is_consolidated and delegates to renderCombinedInvoicePdf. Spec `docs/superpowers/specs/2026-04-27-fu-035-h3-...-design.md`, plan `docs/superpowers/plans/2026-04-27-fu-035-h3-...md`. ~13 commits. New tests: 4 files. See FU-035-H3-followup-A below.
```

(Use today's date when committing.)

- [ ] **Step 2: Append new FU-035-H3-followup-A**

After the existing `FU-035-H2-followup-A` block:

```
### FU-035-H3-followup-A: Integration smoke for renderCombinedInvoicePdf + peek-and-delegate
- Source: FU-035-H3 spec §13
- Scope: small
- Area: pdf / tests
- Intent: Add Supabase-mock-backed integration tests for both renderCombinedInvoicePdf (5-query fetch + grouping) AND the peek-and-delegate logic in renderInvoicePdf (peek query + dynamic import + correct routing). Same pattern as the H1/H2 integration smoke followups.
- Notes: With 4 doc types now sharing the document-designer architecture, the previously-filed FU-035-H1-followup-C (hoist deriveLoadLevelLocations) now applies to 4 renderers — even higher priority. FU-035-H1-followup-D (extract fetch-moves-with-events) does NOT apply to combined_invoice (it skips per-order moves+events fetch). The pre-H4 consideration (split lib/constants/document-sections.js into per-doc-type sibling files) is now even more compelling — the file is approaching ~570 lines with 4 registries.
```

- [ ] **Step 3: Update MEMORY.md index header**

Find the lead bullet line in MEMORY.md (the one starting `- **[followups.md](followups.md) — open follow-ups...`). Replace its descriptive text to reflect H3 ship state. The new content should describe:
- HEAD SHA after Task 12 commit
- Task count (~13 commits)
- Architecture milestone: "now proven across 4 doc types (DO + Invoice + Rate Con + Combined Invoice)"
- New cleanup FU filed (H3-followup-A)
- Outstanding sub-FUs: H4-H9 + FU-035-G

- [ ] **Step 4: Memory directory persists via auto-memory system**

Memory file edits persist via the auto-memory system. No git commit needed for the memory directory.

- [ ] **Step 5: Optional final wrap-up commit**

```bash
git log --oneline -15
git commit --allow-empty -m "$(cat <<'EOF'
chore: FU-035-H3 Combined Invoice Document Designer migration complete

Replaces H1's first-order-only fallback for is_consolidated invoices with a
proper multi-load layout. New 'combined_invoice' doc type with Loads Summary
table + Charge Details grouped by load (per-load Subtotals + GRAND TOTAL).
ChargeDetails gained groupByLoad prop (default false preserves Invoice +
Rate Con). InvoiceDetails renders "(N loads)" for the Load Number row when
consolidated. renderInvoicePdf peeks is_consolidated and delegates without
breaking the public 3-arg signature.

Resolves: FU-035-H3
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- §1 Goal: Task 12 (composer) + Task 11 (peek-and-delegate) are the keystone integrations ✅
- §2 Non-goals: explicitly skipped per-load Equipment / Move Events / Commodity sections ✅
- §3 Architecture: 3.1 (separate doc type) → Task 1; 3.2 (Layout C) → Tasks 5-7; 3.3 (public API unchanged) → Task 11; 3.4 (peek-and-delegate) → Task 11; 3.5 (component reuse) → Task 12; 3.6 (InvoiceDetails (N loads)) → Task 6; 3.7 (separate fetcher/composer files) → Tasks 10 + 12 ✅
- §4 File touch-list: every entry has a task ✅
- §5 COMBINED_INVOICE_SECTIONS: Task 2 inlines the full registry ✅
- §6 DOCUMENT_TYPES: Task 1 ✅
- §7 Renderer data shape: Task 10 ✅
- §8 Composer: Task 12 ✅
- §9 Renderer: Task 10 + Task 11 ✅
- §10 Component breakdown: 10.1 (LoadsSummary) → Task 7; 10.2 (ChargeDetails groupByLoad) → Task 5; 10.3 (InvoiceDetails (N loads)) → Task 6; 10.4 (HTML previews) → Tasks 5/6/7/8; 10.5 (sample data) → Task 4 ✅
- §11 Test plan: Tasks 1, 2, 3, 9 ✅
- §12 Risks: covered by tasks ✅
- §13 Follow-ups: filed in Task 14 ✅

**Type/name consistency check:**
- `buildSectionData` exported from `lib/pdf/build-combined-invoice-section-data.js` (Task 9) and re-exported from `components/pdf/CombinedInvoiceTemplate.js` (Task 12)
- `fetchCombinedInvoiceData` + `renderCombinedInvoicePdf` named consistently in Task 10
- Section IDs: header / invoice_details / address_details / loads_summary / charge_details / notes / disclaimer / footer — consistent in Tasks 2, 4 (sample-data), 7, 9, 12
- Field IDs: combined_invoice's `address_details.fields = [bill_to]` (no customer/pickup_location/etc.) — validator rejects them. `notes.fields = [billing_notes]` — validator rejects driver_notes/load_notes. `loads_summary.fields = [7 IDs]` — validator rejects them on Invoice/Rate Con/DO.
- `groupByLoad` prop name consistent across ChargeDetails (Task 5), ChargeDetailsPreview (Task 5), DocumentPreview override (Task 8), CombinedInvoiceTemplate composer (Task 12)
- `consolidated_count` field consistent across InvoiceDetails (Task 6), buildSectionData (Task 9), fetchCombinedInvoiceData (Task 10), sample data (Task 4)

**Open spec items not directly testable in tests/ layer:** LoadsSummary / LoadsSummaryPreview / fetchCombinedInvoiceData / peek-and-delegate routing are all manual-smoke (Task 13). Matches H1+H2's approach.
