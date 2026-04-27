# FU-035-H2 Rate Confirmation Document Designer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `components/pdf/RateConTemplate.js` with a section-registry-driven composer mirroring FU-035-H1. Tenants can toggle Rate Con section/field visibility from `/settings/document-designer`; per-customer cascade works (keyed on `order.customer_id`); live HTML preview matches printed PDF.

**Architecture:** Independent `RATE_CON_SECTIONS` registry (sibling to DELIVERY_ORDER_SECTIONS + INVOICE_SECTIONS). 11 sections, 44 leaf toggles. Massive component reuse from H1: Header, AddressDetails (passes `data.customer = null`), OrderDetails, CommodityDetails, Notes, Signature, Disclaimer, MoveBlock, DocumentFooter all reused without changes. ChargeDetails + ChargeDetailsPreview gain a `showSubtotal` prop (default true preserves Invoice; rate_con passes false). One new section component: RateConDetails (PDF) + preview mirror. Single-page composer keyed by chargeSetId. Public `renderRateConPdf(svc, chargeSetId, tenantId)` signature unchanged — 4 callers untouched.

**Tech Stack:** Next.js 15 + React 19, @react-pdf/renderer 4.5, Supabase Postgres, Tailwind 4, native Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-04-27-fu-035-h2-rate-con-document-designer-design.md`](../specs/2026-04-27-fu-035-h2-rate-con-document-designer-design.md)

---

## Task 1: Add `'rate_con'` to `DOCUMENT_TYPES` registry

**Files:**
- Create: `tests/document-types-constants-rate-con.test.mjs`
- Modify: `lib/constants/document-types.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-types-constants-rate-con.test.mjs`:

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

test("'rate_con' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('rate_con'), `missing 'rate_con' in: ${ids.join(', ')}`);
});

test("getDocumentType('rate_con') returns category 'ar', label 'Rate Confirmation'", () => {
  const entry = getDocumentType('rate_con');
  assert.equal(entry.value, 'rate_con');
  assert.equal(entry.label, 'Rate Confirmation');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('rate_con') is true", () => {
  assert.equal(isValidDocumentType('rate_con'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('rate_con'));
  assert.equal(DOCUMENT_TYPE_LABELS['rate_con'], 'Rate Confirmation');
});

test('all 4 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-types-constants-rate-con.test.mjs`
Expected: FAIL — `missing 'rate_con'`.

- [ ] **Step 3: Add 'rate_con' to DOCUMENT_TYPES**

Edit `lib/constants/document-types.js`. Append the new entry to the existing `DOCUMENT_TYPES` array (after the `'invoice'` entry):

```js
  {
    value: 'rate_con',
    label: 'Rate Confirmation',
    description: 'Confirmation of a negotiated rate sent to a carrier',
    category: 'ar',
  },
```

The full array should now have 4 entries: `delivery_order_full`, `delivery_order_next_move`, `invoice`, `rate_con`.

- [ ] **Step 4: Update the existing exhaustive-list test in `tests/document-types-constants.test.mjs`**

The existing file likely has a hardcoded `deepEqual` exhaustive check on `DOCUMENT_TYPES.map((t) => t.value)`. After Tasks 1 (Invoice) the assertion was updated to include `'invoice'`. Now update again to include `'rate_con'` so this regression doesn't break the suite. Read the existing file and update the exhaustive list to include all 4 doc types — same minimal kind of edit Task 1 of FU-035-H1 made.

- [ ] **Step 5: Run new test to verify it passes**

Run: `node --test tests/document-types-constants-rate-con.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Run all existing tests to verify no regression**

Run: `node --test tests/document-types-constants.test.mjs`
Expected: PASS — all DO + Invoice tests still green.

- [ ] **Step 7: Commit**

```bash
git add tests/document-types-constants-rate-con.test.mjs tests/document-types-constants.test.mjs lib/constants/document-types.js
git commit -m "feat(doc-designer): register 'rate_con' in DOCUMENT_TYPES (FU-035-H2)"
```

---

## Task 2: Add `RATE_CON_SECTIONS` to section registry

**Files:**
- Create: `tests/document-sections-rate-con-constants.test.mjs`
- Modify: `lib/constants/document-sections.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-sections-rate-con-constants.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  RATE_CON_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('RATE_CON_SECTIONS entries have required keys', () => {
  for (const s of RATE_CON_SECTIONS) {
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

test('all 11 Rate Con sections present', () => {
  const ids = RATE_CON_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'rate_con_details', 'address_details', 'move_events',
    'order_details', 'commodity_details', 'charge_details', 'notes',
    'signature', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing Rate Con section: ${id}`);
  }
  assert.equal(RATE_CON_SECTIONS.length, 11);
});

test('footer is non-toggleable on Rate Con', () => {
  const footer = RATE_CON_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('move_events / commodity_details / signature / disclaimer default off on Rate Con', () => {
  for (const id of ['move_events', 'commodity_details', 'signature', 'disclaimer']) {
    const s = RATE_CON_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('rate_con_details has 5 fields', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'rate_con_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'confirmation_number', 'issue_date', 'reference_number',
    'pickup_appointment', 'delivery_appointment',
  ]) {
    assert.ok(fieldIds.includes(id), `missing rate_con_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 5);
});

test('address_details has 4 fields and NO customer/bill_to', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'pickup_location', 'delivery_location', 'return_location',
    'display_pickup_for_operational_street_turns',
  ]) {
    assert.ok(fieldIds.includes(id), `missing address_details field: ${id}`);
  }
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT be in rate_con address_details');
  assert.ok(!fieldIds.includes('bill_to'),  'bill_to should NOT be in rate_con address_details');
  assert.equal(fieldIds.length, 4);
});

test('charge_details has 4 fields (label "Rate Details")', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'charge_details');
  assert.equal(s.label, 'Rate Details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['charge_name', 'units', 'rates', 'charges']) {
    assert.ok(fieldIds.includes(id), `missing charge_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 4);
});

test('notes has 2 fields, NOT billing_notes / yard_notes / customer_notes', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['driver_notes', 'load_notes']) {
    assert.ok(fieldIds.includes(id), `missing notes field: ${id}`);
  }
  assert.ok(!fieldIds.includes('billing_notes'),  'billing_notes should NOT be on rate_con (Invoice-only)');
  assert.ok(!fieldIds.includes('yard_notes'),     'yard_notes should NOT be on rate_con');
  assert.ok(!fieldIds.includes('customer_notes'), 'customer_notes should NOT be on rate_con');
  assert.equal(fieldIds.length, 2);
});

test('order_details has 19 fields (label "Equipment Details", same field IDs as DO/Invoice)', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'order_details');
  assert.equal(s.label, 'Equipment Details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'reference_number', 'booking_bl', 'mbol', 'hbol',
    'container_number', 'container_size', 'container_type',
    'chassis_number', 'chassis_size', 'chassis_type', 'chassis_owner',
    'steamship_line', 'seal', 'hazmat', 'pickup_number',
    'pull_container_date', 'return_container_date',
    'last_free_day', 'per_diem_free_day',
  ]) {
    assert.ok(fieldIds.includes(id), `missing order_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 19);
});

test('disclaimer label is "Terms & Conditions"', () => {
  const s = RATE_CON_SECTIONS.find((x) => x.id === 'disclaimer');
  assert.equal(s.label, 'Terms & Conditions');
});

test("getSectionsForDocumentType('rate_con') returns RATE_CON_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('rate_con'), RATE_CON_SECTIONS);
});

test('computeVisibility honors RATE_CON_SECTIONS defaults with no config', () => {
  const result = computeVisibility(RATE_CON_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.rate_con_details, true);
  assert.equal(result.visibility.charge_details, true);
  assert.equal(result.visibility.move_events, false);          // default off
  assert.equal(result.visibility.commodity_details, false);    // default off
  assert.equal(result.visibility.signature, false);            // default off (per feedback memory)
  assert.equal(result.visibility.disclaimer, false);           // default off
  assert.equal(result.visibility.footer, true);                // non-toggleable
  assert.equal(result.fields.charge_details.charge_name, true);
  assert.equal(result.fields.notes.driver_notes, true);
  assert.equal(result.fields.notes.load_notes, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-rate-con-constants.test.mjs`
Expected: FAIL — `RATE_CON_SECTIONS` not exported.

- [ ] **Step 3: Add `RATE_CON_SECTIONS` and register it**

Edit `lib/constants/document-sections.js`. Append the following after the existing `INVOICE_SECTIONS` constant (do NOT touch DELIVERY_ORDER_SECTIONS or INVOICE_SECTIONS):

```js
export const RATE_CON_SECTIONS = [
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
    id: 'rate_con_details',
    label: 'Rate Confirmation Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'confirmation_number',  label: 'Confirmation #',       defaultVisible: true },
      { id: 'issue_date',           label: 'Issue Date',           defaultVisible: true },
      { id: 'reference_number',     label: 'Reference #',          defaultVisible: true },
      { id: 'pickup_appointment',   label: 'Pickup Appointment',   defaultVisible: true },
      { id: 'delivery_appointment', label: 'Delivery Appointment', defaultVisible: true },
    ],
  },
  {
    id: 'address_details',
    label: 'Address Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'pickup_location',                              label: 'Pick Up Location',  defaultVisible: true },
      { id: 'delivery_location',                            label: 'Delivery Location', defaultVisible: true },
      { id: 'return_location',                              label: 'Return Location',   defaultVisible: true },
      { id: 'display_pickup_for_operational_street_turns',  label: 'Display Pickup Location for Operational Street Turns', defaultVisible: false },
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
    label: 'Equipment Details',
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
    label: 'Rate Details',
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
      { id: 'driver_notes', label: 'Driver Notes', defaultVisible: true },
      { id: 'load_notes',   label: 'Load Notes',   defaultVisible: true },
    ],
  },
  {
    id: 'signature',
    label: 'Signature Block',
    defaultVisible: false,
    toggleable: true,
  },
  {
    id: 'disclaimer',
    label: 'Terms & Conditions',
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

Then update `SECTIONS_BY_DOCUMENT_TYPE`. The current export looks like:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
};
```

Replace with:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
};
```

- [ ] **Step 4: Run new test to verify it passes**

Run: `node --test tests/document-sections-rate-con-constants.test.mjs`
Expected: PASS — 12 tests pass.

- [ ] **Step 5: Run existing DO + Invoice tests to verify no regression**

Run: `node --test tests/document-sections-constants.test.mjs tests/document-sections-invoice-constants.test.mjs`
Expected: PASS — all existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/document-sections-rate-con-constants.test.mjs lib/constants/document-sections.js
git commit -m "feat(doc-designer): add RATE_CON_SECTIONS registry (FU-035-H2)"
```

---

## Task 3: Validator regression tests for Rate Con

**Files:**
- Create: `tests/validate-section-config-rate-con.test.mjs`

The validator at `lib/pdf/validate-section-config.js` is per-doc-type-aware (FU-112). After Task 2, it auto-supports Rate Con with no code change. These tests confirm the field-ID isolation works correctly across all 3 doc types.

- [ ] **Step 1: Write the test file**

Create `tests/validate-section-config-rate-con.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts pickup_location=false on rate_con's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { pickup_location: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS bill_to=false on rate_con (Invoice-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /bill_to/);
});

test("validator REJECTS customer=false on rate_con (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /customer/);
});

test("validator REJECTS billing_notes=false on rate_con (Invoice-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { billing_notes: false } } } },
    'rate_con',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /billing_notes/);
});

test('field-ID isolation: customer accepted on DO, REJECTED on rate_con', () => {
  const payload = { perSection: { address_details: { fields: { customer: false } } } };
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, true);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
});

test('field-ID isolation: bill_to accepted on Invoice, REJECTED on rate_con', () => {
  const payload = { perSection: { address_details: { fields: { bill_to: false } } } };
  assert.equal(validateSectionConfig(payload, 'invoice').ok,  true);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok, false);
});

test('field-ID isolation: rate_con_details fields accepted on rate_con only', () => {
  const payload = { perSection: { rate_con_details: { fields: { confirmation_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test("validator accepts a full rate_con section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { rate_con_details: true, move_events: false, signature: false },
      perSection: {
        charge_details: { fields: { charge_name: true, units: true, rates: false, charges: true } },
        notes:          { fields: { driver_notes: true, load_notes: false } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'rate_con',
  );
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/validate-section-config-rate-con.test.mjs`
Expected: PASS — all 8 tests pass without any code change. Validator already supports Rate Con via `getSectionsForDocumentType('rate_con')`.

If any test fails, investigate `validateSectionConfig` against the new RATE_CON_SECTIONS — likely a Task-2 bug.

- [ ] **Step 3: Commit**

```bash
git add tests/validate-section-config-rate-con.test.mjs
git commit -m "test(doc-designer): regression tests for validator against RATE_CON_SECTIONS (FU-035-H2)"
```

---

## Task 4: Create sample-data-rate-con.js + register in DocumentPreview

**Files:**
- Create: `lib/document-designer/sample-data-rate-con.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Create the new Rate Con sample data file**

Create `lib/document-designer/sample-data-rate-con.js`:

```js
// Mirror this shape against buildSectionData() in lib/pdf/build-rate-con-section-data.js —
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
  rate_con_details: {
    confirmation_number: 'RC-2026-001',
    issue_date: 'MONTH DD, YYYY',
    reference_number: 'PO-12345',
    pickup_appointment: 'MONTH DD, YYYY h:mm',
    delivery_appointment: 'MONTH DD, YYYY h:mm',
  },
  address_details: {
    customer: null,  // Rate Con never shows a customer block
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
    totals: { total_cents: 98000 },  // No subtotal_cents — charge_set.total_cents is the only total
  },
  notes: {
    driver_notes: 'SAMPLE driver notes',
    load_notes:   'SAMPLE load notes',
  },
  signature: {
    print_name: 'ABC123',
    signature: 'ABC123',
    time_in: 'MONTH DD, YYYY h:mm',
    time_out: 'MONTH DD, YYYY h:mm',
    date: 'MONTH DD, YYYY',
  },
  disclaimer: {
    text: 'Terms & Conditions text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
```

- [ ] **Step 2: Register the new sample in DocumentPreview.js**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Find the imports section near the top:

```js
import sampleDataDeliveryOrder from '../../../../lib/document-designer/sample-data-delivery-order';
import sampleDataInvoice       from '../../../../lib/document-designer/sample-data-invoice';
```

Add a third import line:

```js
import sampleDataRateCon       from '../../../../lib/document-designer/sample-data-rate-con';
```

Then find the `SAMPLE_BY_DOCUMENT_TYPE` map:

```js
const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
};
```

Add the rate_con entry:

```js
const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
  rate_con:                 sampleDataRateCon,
};
```

- [ ] **Step 3: Verify no other importers of an old `sample-data` path exist**

Run: `grep -rn "document-designer/sample-data['\"]" components lib pages 2>/dev/null`
Expected: NO results.

- [ ] **Step 4: Commit**

```bash
git add lib/document-designer/sample-data-rate-con.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): add Rate Con sample data + DocumentPreview registration (FU-035-H2)"
```

---

## Task 5: Add `showSubtotal` prop to ChargeDetails (PDF + Preview)

**Files:**
- Modify: `components/pdf/sections/ChargeDetails.js`
- Modify: `components/settings/document-designer/preview/ChargeDetailsPreview.js`

The default value `true` preserves existing Invoice behavior. Rate Con composer (Task 11) will pass `false`.

- [ ] **Step 1: Edit ChargeDetails.js (PDF) to accept showSubtotal prop**

Read `components/pdf/sections/ChargeDetails.js`. Find the destructuring at the top of the function (around line 87-89):

```js
export default function ChargeDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
```

Add a line for `showSubtotal`:

```js
export default function ChargeDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
```

Then find the totals footer block (around line 132-141, the `lines.length > 0 ? (...) : null` section). Currently:

```js
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
```

Wrap the Subtotal `<View>` in a `showSubtotal ? ... : null` ternary:

```js
        {lines.length > 0 ? (
          <>
            {showSubtotal ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Subtotal</Text>
                <Text style={styles.totalsValue}>{formatCents(totals.subtotal_cents)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsBoldRow}>
              <Text style={styles.totalsLabelBold}>Total Due</Text>
              <Text style={styles.totalsValueBold}>{formatCents(totals.total_cents)}</Text>
            </View>
          </>
        ) : null}
```

- [ ] **Step 2: Edit ChargeDetailsPreview.js (HTML) to accept showSubtotal prop**

Read `components/settings/document-designer/preview/ChargeDetailsPreview.js`. Apply the same pattern. Find the destructuring at the top:

```js
export default function ChargeDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
```

Add showSubtotal:

```js
export default function ChargeDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const accent = colors?.accent || '#3B82F6';
  const showSubtotal = opts?.showSubtotal !== false;
```

Then find the `<tfoot>` block. Currently:

```js
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
```

Wrap the Subtotal `<tr>` in `showSubtotal ? ... : null`:

```js
        {lines.length > 0 ? (
          <tfoot>
            {showSubtotal ? (
              <tr>
                <td colSpan={3} className="text-right px-2 py-1 text-gray-600">Subtotal</td>
                <td className="text-right px-2 py-1">{formatCents(totals.subtotal_cents)}</td>
              </tr>
            ) : null}
            <tr className="border-t border-gray-300">
              <td colSpan={3} className="text-right px-2 py-1 font-bold">Total Due</td>
              <td className="text-right px-2 py-1 font-bold">{formatCents(totals.total_cents)}</td>
            </tr>
          </tfoot>
        ) : null}
```

- [ ] **Step 3: Run all DO + Invoice regression tests**

Run: `node --test tests/`
Expected: ALL existing tests pass. The default `showSubtotal !== false` (i.e. `true`) means no behavior change for any existing Invoice caller.

NOTE: There is one PRE-EXISTING failing test (`tests/fire-trigger-entity-aware.test.mjs`, 2 sub-assertions about orphan reason messages) that fails on the parent commit too — that's unrelated to this task. As long as the failure count is the same as before this commit, you're good.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/ChargeDetails.js components/settings/document-designer/preview/ChargeDetailsPreview.js
git commit -m "feat(pdf): ChargeDetails showSubtotal prop (default true) (FU-035-H2)"
```

---

## Task 6: Build `RateConDetails` PDF section component

**Files:**
- Create: `components/pdf/sections/RateConDetails.js`

5-field 3-col grid. Mirrors `InvoiceDetails.js` minus the consolidated_count footnote and minus the terms_days special case.

- [ ] **Step 1: Create RateConDetails.js**

Create `components/pdf/sections/RateConDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Rate Confirmation Details section — 5 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Mirrors InvoiceDetails.js's structure
 * minus the consolidated footnote (rate cons don't consolidate) and minus the
 * terms_days Net N special case (rate cons don't have payment terms).
 *
 * `data` shape:
 *   {
 *     confirmation_number, issue_date, reference_number,
 *     pickup_appointment, delivery_appointment,
 *   }
 *
 * `opts.fields`: { confirmation_number, issue_date, reference_number,
 *                  pickup_appointment, delivery_appointment }
 */
const FIELD_ORDER = [
  ['confirmation_number',  'Confirmation #'],
  ['issue_date',           'Issue Date'],
  ['reference_number',     'Reference #'],
  ['pickup_appointment',   'Pickup Appointment'],
  ['delivery_appointment', 'Delivery Appointment'],
];

export default function RateConDetails({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

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
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/RateConDetails.js
git commit -m "feat(pdf): RateConDetails section component (FU-035-H2)"
```

(No test for React-PDF rendering at this layer; manual smoke verifies in Task 12.)

---

## Task 7: Build `RateConDetailsPreview` HTML preview + register in DocumentPreview

**Files:**
- Create: `components/settings/document-designer/preview/RateConDetailsPreview.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Create RateConDetailsPreview.js**

Create `components/settings/document-designer/preview/RateConDetailsPreview.js`:

```js
/**
 * HTML preview of Rate Confirmation Details. Mirrors components/pdf/sections/RateConDetails.js.
 * 3-col label-value grid; skips empty values.
 */
const FIELD_ORDER = [
  ['confirmation_number',  'Confirmation #'],
  ['issue_date',           'Issue Date'],
  ['reference_number',     'Reference #'],
  ['pickup_appointment',   'Pickup Appointment'],
  ['delivery_appointment', 'Delivery Appointment'],
];

export default function RateConDetailsPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const textColor = colors?.text || '#111827';

  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

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
    </div>
  );
}
```

- [ ] **Step 2: Register in DocumentPreview.js's PREVIEW_BY_SECTION_ID map**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Find the imports for the other preview components (around lines 3-10). Add an import for the new component:

```js
import RateConDetailsPreview        from './RateConDetailsPreview';
```

Then find the `PREVIEW_BY_SECTION_ID` map. After Task 8 of FU-035-H1 it should look like:

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

Add `rate_con_details` between `invoice_details` and `address_details` (so the natural reading order header → details → addresses is preserved):

```js
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  invoice_details:        InvoiceDetailsPreview,
  rate_con_details:       RateConDetailsPreview,
  address_details:        AddressDetailsPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  charge_details:         ChargeDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/document-designer/preview/RateConDetailsPreview.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): RateConDetailsPreview HTML component + register (FU-035-H2)"
```

---

## Task 8: Wire `showSubtotal=false` override for rate_con in DocumentPreview

**Files:**
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

So the Invoice live preview shows Subtotal + Total Due, but the Rate Con preview shows only Total Due — matching the printed PDFs.

- [ ] **Step 1: Update DocumentPreview.js to pass showSubtotal=false for rate_con**

Read `components/settings/document-designer/preview/DocumentPreview.js`. After Task 9 of FU-035-H1 the section-render loop has an existing per-doc-type override block:

```js
const opts = { fields: fields[s.id] || {} };
if (s.id === 'address_details' && documentType === 'invoice') {
  opts.customerLabel = 'Bill To';
  // Field-ID translation to keep AddressDetailsPreview's internal API stable:
  // INVOICE_SECTIONS uses bill_to; AddressDetailsPreview reads opts.fields.customer.
  opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
}
```

Add a new override block immediately AFTER the existing one, BEFORE the JSX return:

```js
if (s.id === 'charge_details' && documentType === 'rate_con') {
  // Rate Con's charge_set.total_cents is the only authoritative total — there
  // is no subtotal_cents column. Suppress the Subtotal row in the totals footer.
  // Mirrored in components/pdf/RateConTemplate.js renderSection() for the
  // print path — keep the two in sync.
  opts.showSubtotal = false;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): preview hides Subtotal row for rate_con (FU-035-H2)"
```

---

## Task 9: Write `buildSectionData` for Rate Con + tests

**Files:**
- Create: `lib/pdf/build-rate-con-section-data.js` (NEW pure helper)
- Create: `tests/rate-con-build-section-data.test.mjs`

Per H1's lesson learned (Task 10's code review), `buildSectionData` lives in `lib/pdf/` so the unit test runs under bare Node without a JSX transformer.

- [ ] **Step 1: Write the failing test**

Create `tests/rate-con-build-section-data.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-rate-con-section-data.js';

const baseDoc = {
  charge_set_id: 'cs-uuid',
  tenant_name: 'Acme Drayage',
  tenant_info: {
    logo_url: 'https://example.com/logo.png',
    address: '1 Main St, Newark, NJ 07102',
    phone: '555-1212',
    website: 'acme.com',
  },
  bill_to_customer_id: 'cust-walmart-uuid',
  rate_con_meta: {
    confirmation_number: 'RC-001',
    issue_date: '2026-04-25',
    reference_number: 'PO-12345',
    pickup_appointment: '2026-04-26 09:00',
    delivery_appointment: '2026-04-26 16:00',
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
    pickup_location:   { name: 'Newark Terminal',   city: 'Newark', state: 'NJ' },
    delivery_location: { name: 'Edison Warehouse',  city: 'Edison', state: 'NJ' },
    return_location:   { name: 'Newark Terminal',   city: 'Newark', state: 'NJ' },
  },
  moves: [],
  charge_lines: [
    { description: 'Linehaul', quantity: 1, unit_amount_cents: 75000, total_amount_cents: 75000 },
    { description: 'FSC',      quantity: 1, unit_amount_cents: 12500, total_amount_cents: 12500 },
  ],
  totals: { total_cents: 87500 },
};

test('buildSectionData maps rate_con_meta to rate_con_details (5 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.rate_con_details.confirmation_number, 'RC-001');
  assert.equal(sd.rate_con_details.issue_date, '2026-04-25');
  assert.equal(sd.rate_con_details.reference_number, 'PO-12345');
  assert.equal(sd.rate_con_details.pickup_appointment, '2026-04-26 09:00');
  assert.equal(sd.rate_con_details.delivery_appointment, '2026-04-26 16:00');
});

test('buildSectionData maps load_level_locations to address_details (no customer field)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer, null);  // Rate Con never has a customer block
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
  assert.equal(sd.order_details.booking_bl,            'BK789');
  assert.equal(sd.order_details.pickup_number,         'PU123');
  assert.equal(sd.order_details.last_free_day,         '2026-04-22');
  assert.equal(sd.order_details.pull_container_date,   '2026-04-20');
  assert.equal(sd.order_details.return_container_date, '2026-04-23');
});

test('buildSectionData returns null-safe shapes when first_order is null', () => {
  const sd = buildSectionData({ ...baseDoc, first_order: null, load_level_locations: null });
  assert.equal(sd.address_details.customer, null);
  assert.equal(sd.address_details.pickup_location, null);
  assert.equal(sd.address_details.delivery_location, null);
  assert.equal(sd.address_details.return_location, null);
  assert.equal(sd.order_details.reference_number, null);
  assert.equal(sd.notes.driver_notes, null);
  assert.equal(sd.notes.load_notes, null);
});

test('buildSectionData maps charge_lines + totals to charge_details (no subtotal_cents)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.charge_details.charge_lines.length, 2);
  assert.equal(sd.charge_details.charge_lines[0].description, 'Linehaul');
  assert.equal(sd.charge_details.totals.total_cents, 87500);
  // No subtotal_cents on rate_con — charge_set.total_cents is the only total
  assert.equal(sd.charge_details.totals.subtotal_cents, undefined);
});

test('buildSectionData maps notes (driver from order.notes, load from order.internal_notes)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.driver_notes, 'Driver notes here');
  assert.equal(sd.notes.load_notes,   'Load/internal notes here');
  // Rate Con notes registry has only 2 fields — no billing_notes
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rate-con-build-section-data.test.mjs`
Expected: FAIL — `buildSectionData` not exported (import error).

- [ ] **Step 3: Create the buildSectionData helper**

Create `lib/pdf/build-rate-con-section-data.js`:

```js
/**
 * Build per-section data subsets for the Rate Con composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner (RateConTemplate.js itself contains JSX
 * which bare Node can't parse). Same pattern as
 * lib/pdf/build-invoice-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = null`
 * always — rate cons never show a customer block. AddressDetails.js
 * (shared component) reads `data.customer` and short-circuits when null.
 */
export function buildSectionData(doc) {
  const meta = doc.rate_con_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    rate_con_details: {
      confirmation_number:  meta.confirmation_number  ?? null,
      issue_date:           meta.issue_date           ?? null,
      reference_number:     meta.reference_number     ?? null,
      pickup_appointment:   meta.pickup_appointment   ?? null,
      delivery_appointment: meta.delivery_appointment ?? null,
    },
    address_details: {
      customer: null,  // Rate Con never shows a customer block — AddressDetails.js short-circuits
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
    commodity_details: null,  // No real source yet; sample-data fills preview only
    charge_details: {
      charge_lines: doc.charge_lines || [],
      totals:       doc.totals       || { total_cents: 0 },  // No subtotal_cents on rate_con
    },
    notes: {
      driver_notes: order?.notes          ?? null,    // orders.notes  → driver_notes
      load_notes:   order?.internal_notes ?? null,    // orders.internal_notes → load_notes
    },
    signature: {
      print_name: '',
      signature: '',
      date: '',
      time_in: '',
      time_out: '',
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/rate-con-build-section-data.test.mjs`
Expected: PASS — 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/build-rate-con-section-data.js tests/rate-con-build-section-data.test.mjs
git commit -m "feat(pdf): buildSectionData for Rate Con + tests (FU-035-H2)"
```

---

## Task 10: Build `fetchRateConData`

**Files:**
- Modify: `lib/pdf/render-rate-con.js`

`fetchRateConData(svc, chargeSetId, tenantId)` returns the data shape per spec §7. DB-touching; manual smoke verification only at this layer.

- [ ] **Step 1: Replace `lib/pdf/render-rate-con.js` with the new fetcher + skeleton renderer**

Read the current file (`lib/pdf/render-rate-con.js`) so you preserve the column references it already uses for the `pickup_org` / `delivery_org` joins. Then replace contents with:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import RateConTemplate from '../../components/pdf/RateConTemplate';
import { resolveTemplateConfig } from './resolve-template-config';

/**
 * Fetch rate-con data (charge set + order + line items + tenant info)
 * and shape it for the Document Designer composer. Returns null if the
 * charge set doesn't exist for this tenant.
 *
 * NOTE: pickup/delivery locations are stored on the orders table as foreign
 * keys to the customers table (not a separate locations table). The FK names
 * are orders_pickup_location_id_fkey and orders_delivery_location_id_fkey,
 * confirmed from the existing load-detail endpoint.
 */
export async function fetchRateConData(svc, chargeSetId, tenantId) {
  // 1. Charge set + order + pickup_org + delivery_org + line items (1 query, joined)
  const { data: cs, error: csErr } = await svc
    .from('order_charge_sets')
    .select(`
      id, charge_set_number, created_at, total_cents,
      order:orders(
        id, order_number, customer_reference, customer_id,
        container_number, chassis_number,
        container_size, container_type, chassis_size, chassis_type,
        chassis_owner, steamship_line, seal_number,
        mbol, hbol, booking_number, pickup_number,
        is_hazmat, last_free_day, per_diem_free_day,
        pull_container_date, return_container_date,
        notes, internal_notes,
        pickup_apt_from, delivery_apt_from,
        pickup_org:customers!orders_pickup_location_id_fkey(id, name, address_line1, city, state, zip),
        delivery_org:customers!orders_delivery_location_id_fkey(id, name, address_line1, city, state, zip)
      ),
      line_items:order_charge_set_line_items(
        id, name, description, unit_count, per_unit_price_cents, total_cents
      )
    `)
    .eq('id', chargeSetId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (csErr) throw new Error(`Charge set fetch failed: ${csErr.message}`);
  if (!cs) return null;

  const order = cs.order || null;

  // 2. Order's moves + events (skip if no order)
  let moves = [];
  let loadLevelLocations = { pickup_location: null, delivery_location: null, return_location: null };
  if (order?.id) {
    const { data: rawMoves, error: movesErr } = await svc
      .from('order_container_moves')
      .select(`
        id, sequence, move_type, status,
        driver:drivers(id, first_name, last_name, phone)
      `)
      .eq('order_id', order.id)
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

    // Derive load-level locations from the order's events (matches DO + Invoice behavior)
    const { deriveLoadLevelLocations } = await import('./render-delivery-order');
    loadLevelLocations = deriveLoadLevelLocations(moves);
  }

  // 3. Map charge lines from order_charge_set_line_items DIRECT (not invoice_line_items).
  // Preserve the legacy fallback: description || name (when only `name` is set).
  const chargeLines = (cs.line_items || []).map((li) => ({
    description:        li.description || li.name,
    quantity:           li.unit_count   || 1,
    unit_amount_cents:  li.per_unit_price_cents,
    total_amount_cents: li.total_cents,
  }));

  // 4. Tenant + tenant_settings for Header
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
    charge_set_id: cs.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to_customer_id: order?.customer_id || null,
    rate_con_meta: {
      confirmation_number:  cs.charge_set_number,
      issue_date:           cs.created_at,
      reference_number:     order?.customer_reference || order?.order_number || null,
      pickup_appointment:   order?.pickup_apt_from || null,
      delivery_appointment: order?.delivery_apt_from || null,
    },
    first_order: order,
    load_level_locations: loadLevelLocations,
    moves,
    charge_lines: chargeLines,
    totals: {
      total_cents: cs.total_cents,
      // No subtotal_cents — charge_set.total_cents is the only authoritative total
    },
  };
}

/**
 * Fetch rate-con data + render as PDF Buffer. Public signature unchanged
 * (callers in send-rate-con-email + bulk-send-rate-con + pdf/rate-con/[id]
 * + archive.js pass these 3 args verbatim).
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} chargeSetId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Charge set not found' if missing or wrong tenant
 */
export async function renderRateConPdf(svc, chargeSetId, tenantId) {
  const doc = await fetchRateConData(svc, chargeSetId, tenantId);
  if (!doc) throw new Error('Charge set not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'rate_con'
  );

  return await renderToBuffer(
    React.createElement(RateConTemplate, { doc, sectionConfig })
  );
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all existing tests continue to pass (excluding the pre-existing fire-trigger-entity-aware failure). Note: `tests/rate-con-build-section-data.test.mjs` from Task 9 should still pass — it imports buildSectionData from `lib/pdf/build-rate-con-section-data.js` which doesn't have JSX.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/render-rate-con.js
git commit -m "feat(pdf): fetchRateConData + cascade-aware renderRateConPdf (FU-035-H2)"
```

Note: at this point, `RateConTemplate` is still the OLD hardcoded template that takes the old prop shape. Calling `renderRateConPdf` would error or produce a broken PDF until Task 11 lands. That's intentional — Task 11 fixes it.

---

## Task 11: Replace `RateConTemplate.js` with full composer

**Files:**
- Replace: `components/pdf/RateConTemplate.js`

This is the keystone integration step. After Task 11 commits, sending a rate-con email renders a real PDF using the new section-registry pattern.

- [ ] **Step 1: Replace the entire file**

Replace `components/pdf/RateConTemplate.js` with:

```js
import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
  extractColors,
} from '../../lib/constants/document-sections';
import { buildSectionData } from '../../lib/pdf/build-rate-con-section-data';

import Header             from './sections/Header';
import RateConDetails     from './sections/RateConDetails';
import AddressDetails     from './sections/AddressDetails';
import OrderDetails       from './sections/OrderDetails';
import CommodityDetails   from './sections/CommodityDetails';
import ChargeDetails      from './sections/ChargeDetails';
import Notes              from './sections/Notes';
import Signature          from './sections/Signature';
import Disclaimer         from './sections/Disclaimer';
import MoveBlock          from './sections/MoveBlock';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
// New consumers should import directly from lib/pdf/build-rate-con-section-data.
export { buildSectionData } from '../../lib/pdf/build-rate-con-section-data';

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
    case 'rate_con_details':
      return <RateConDetails data={sectionData.rate_con_details} opts={opts} colors={colors} />;
    case 'address_details':
      // Rate Con's address_details registry has no `customer` or `bill_to` field
      // (only the 4 location fields), so no field-ID translation is needed.
      // buildSectionData sets data.customer = null so AddressDetails's customer
      // block short-circuits regardless of opts.fields.
      return <AddressDetails data={sectionData.address_details} opts={opts} colors={colors} />;
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
    case 'charge_details': {
      // Rate Con's charge_set.total_cents is the only authoritative total.
      // No subtotal_cents column → suppress the Subtotal row in the totals footer.
      // Mirrored in components/settings/document-designer/preview/DocumentPreview.js
      // for the live HTML preview path — keep the two in sync.
      const chargeOpts = { ...opts, showSubtotal: false };
      return <ChargeDetails data={sectionData.charge_details} opts={chargeOpts} colors={colors} />;
    }
    case 'notes':
      return <Notes data={sectionData.notes} opts={opts} />;
    case 'signature':
      return <Signature data={sectionData.signature} colors={colors} />;
    case 'disclaimer':
      return <Disclaimer data={sectionData.disclaimer} colors={colors} />;
    case 'footer':
      return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:
      return null;
  }
}

export default function RateConTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('rate_con');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'rate_con', title: 'RATE CONFIRMATION', subtitle: null };

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
Expected: PASS — all tests pass (except the pre-existing fire-trigger-entity-aware failure).

- [ ] **Step 3: Commit**

```bash
git add components/pdf/RateConTemplate.js
git commit -m "feat(pdf): RateConTemplate composer replaces hardcoded template (FU-035-H2)"
```

---

## Task 12: Manual verification + dd-qa pass

This task has no code changes — it's the manual smoke pass that a unit test layer can't reach.

- [ ] **Step 1: Run all unit tests one more time**

Run: `node --test tests/`
Expected: ALL pass — DO regression + Invoice regression + new Rate Con tests. The pre-existing fire-trigger-entity-aware failure should be the ONLY failure.

- [ ] **Step 2: Restart the dev server**

```bash
npm run dev
```

Wait for clean compile. If there's an ESM import error, fix and re-run.

- [ ] **Step 3: Open Document Designer for Rate Confirmation**

Navigate to `/settings/document-designer?type=rate_con`. Verify:
- Toggle list shows 11 sections (Header, Rate Confirmation Details, Address Details, Move Events, Equipment Details, Commodity Details, Rate Details, Notes, Signature Block, Terms & Conditions, Footer)
- Default-off sections (Move Events, Commodity Details, Signature Block, Terms & Conditions) have their master toggle OFF
- Right pane preview renders Rate Con sample data:
  - Header: "Your Company"
  - Rate Confirmation Details: 5 fields (Confirmation #, Issue Date, Reference #, Pickup/Delivery Appointment)
  - Address Details: Pickup / Delivery / Return blocks (NO customer / Bill To block)
  - Equipment Details: 19-field grid
  - Rate Details: 4-column table with 3 sample charge rows + Total Due footer (NO Subtotal row)
- Toggling off "Charge Name" → that column disappears from the Rate Details preview's table
- Save the config → no validator error → reload picks up

- [ ] **Step 4: Test customer-scoped override**

In the doc designer, switch the customer dropdown to a specific customer. Edit accent color (e.g. red). Save. Switch back to "All Customers" → confirm tenant default's color is the original blue.

- [ ] **Step 5: Send-email a real rate confirmation**

In a new tab, navigate to `/ar/charge-sets`. Pick a charge set + click Send Rate Con. Send to a test inbox. Open the resulting PDF and verify:
- Header has tenant logo + address + phone
- Rate Confirmation Details grid shows all 5 fields populated
- Address Details has Pickup / Delivery / Return blocks (NO customer / Bill To block)
- Equipment Details shows the 19-field grid
- Rate Details table with accent-banded "Charge Details" header, line items, ONLY a "Total Due" row at the bottom (NO Subtotal row)
- Footer with tenant name

Take a screenshot of the rendered PDF for the followups.md note.

- [ ] **Step 6: Print a real Delivery Order (regression check)**

Navigate to `/loads` and bulk-print a single load as a Delivery Order. Open the PDF. Verify:
- Customer block still says "Customer" — DO regression check
- Charge Details (if any) still shows BOTH Subtotal AND Total Due rows — Invoice/DO regression check
- All other DO sections render as before

- [ ] **Step 7: Print a real Invoice (regression check)**

Navigate to `/ar/invoices` and send-email an invoice. Open the PDF. Verify:
- Address Details says "Bill To" (NOT "Customer") — Invoice regression check
- Charge Details shows BOTH Subtotal AND Total Due rows — Invoice regression (showSubtotal default true preserved)
- All other Invoice sections render as before

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
git commit -m "docs: FU-035-H2 manual verification artifacts" --allow-empty
```

If nothing to commit, skip this step.

---

## Task 13: Close FU-035-H2 in followups.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Update FU-035-H2 entry in followups.md**

Open `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`. Find the FU-035-H2 entry (sub-bullet under FU-035-H, after the resolved FU-035-H1 entry). Currently:

```
  - **FU-035-H2 Rate Confirmation** — already has `lib/pdf/render-rate-con.js` + `RateConTemplate.js`; same migration.
```

Replace with:

```
  - **FU-035-H2 Rate Confirmation** — ✅ Resolved YYYY-MM-DD. Migrated from hardcoded React-PDF template to section-registry composer matching FU-035-H1. RATE_CON_SECTIONS (11 sections, 44 leaf toggles). Cascade resolver per-customer (keyed on order.customer_id). Live preview matches print. Spec `docs/superpowers/specs/2026-04-27-fu-035-h2-rate-con-document-designer-design.md`, plan `docs/superpowers/plans/2026-04-27-fu-035-h2-rate-con-document-designer.md`. ~13 commits. New tests: 4 files, ~25 unit tests. Public `renderRateConPdf(svc, chargeSetId, tenantId)` signature unchanged so all 4 existing callers (send-rate-con-email, bulk-send-rate-con, pdf/rate-con/[id], archive.js) work unmodified. ChargeDetails + ChargeDetailsPreview gained showSubtotal prop (default true preserves Invoice). See FU-035-H2-followup-A below.
```

(Use the actual date when committing — `git log -1 --format=%cd` if needed.)

- [ ] **Step 2: Add new follow-up after the existing FU-035-H1-followup-E**

Append after the existing `### FU-035-H1-followup-E:` block:

```
### FU-035-H2-followup-A: Integration smoke for renderRateConPdf
- Source: FU-035-H2 spec §13
- Scope: small
- Area: pdf / tests
- Intent: Add a Supabase-mock-backed integration test that calls `renderRateConPdf` with a stubbed svc client (returning the 4-5 query results that `fetchRateConData` expects), runs `renderToBuffer`, and asserts the returned Buffer starts with the PDF magic bytes (`%PDF-`). Same pattern as the H1-followup-A we already filed for renderInvoicePdf.
- Notes: With H1 + H2 both shipped, hoisting `deriveLoadLevelLocations` (FU-035-H1-followup-C) and extracting `fetch-moves-with-events` (FU-035-H1-followup-D) now apply to 3 renderers — higher priority post-H2.
```

- [ ] **Step 3: Update MEMORY.md index header**

Open `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`. Find the lead bullet (line 11) that starts with `**[followups.md](followups.md) — open follow-ups across all sessions...`. After Task 14 of FU-035-H1 it should describe the H1 ship state. Update it to include H2:

```
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited YYYY-MM-DD (HEAD `<commit>` — FU-035-H2 Rate Confirmation Document Designer shipped: ~13 commits migrating hardcoded `RateConTemplate.js` to the same section-registry composer pattern as Invoice and Delivery Order. RATE_CON_SECTIONS (11 sections, 44 leaf toggles), per-customer cascade keyed on order.customer_id, live HTML preview matches printed PDF. Public `renderRateConPdf` signature unchanged — 4 existing callers (send-rate-con-email, bulk-send-rate-con, pdf/rate-con/[id], archive.js) work unmodified. ChargeDetails + ChargeDetailsPreview gained `showSubtotal` prop (default true preserves Invoice). 4 new test files, ~25 unit tests, 100% pass. Per FU-035-H1, H2 also closes — both Invoice + Rate Con are now in the Document Designer. Outstanding H sub-FUs: H3-H9 (Combined Invoice, POD, Statement, Credit Memo, Quote, Aging Report, Driver Settlement) + FU-035-G (watermark + disclaimer rich-text + named configs). New cleanup FU filed: H2-followup-A (renderer integration smoke). H1 follow-ups C/D/E now apply to 3 renderers. ~71 open, ~58 recently-resolved.
```

(Replace `YYYY-MM-DD` with `git log -1 --format=%cd` and `<commit>` with the final HEAD SHA.)

- [ ] **Step 4: Memory directory is NOT a git repo (per H1)**

Memory file edits persist via the auto-memory system. No commit needed. Skip git operations on the memory directory.

- [ ] **Step 5: Optional final wrap-up commit**

```bash
git log --oneline -15
```

Verify the chain looks clean — should show ~13 H2 commits. Optional empty wrap-up commit:

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore: FU-035-H2 Rate Confirmation Document Designer migration complete

Replaces hardcoded RateConTemplate.js with a section-registry composer
mirroring FU-035-H1's Invoice pattern. 11 sections, 44 leaf toggles.
ChargeDetails gained showSubtotal prop (default true preserves Invoice;
rate_con passes false because charge_set.total_cents is the only
authoritative total). All 4 existing renderRateConPdf callers untouched.

Resolves: FU-035-H2
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- §1 Goal: Task 11 (composer rewrite) is keystone; Tasks 1-10 build inputs ✅
- §2 Non-goals: explicitly skipped per-carrier cascade, multi-charge-set, carrier address block ✅
- §3 Architecture: 3.1 (independent registry) → Task 2; 3.2 (cascade by order.customer_id) → Task 10 (passed to resolveTemplateConfig); 3.3 (component reuse) → Tasks 11 (renderSection imports + reuses); 3.4 (single-page) → Task 11; 3.5 (field-ID isolation) → Task 3; 3.6 (cross-doc-type field-ID sharing) → Task 2 ✅
- §4 File touch-list: every entry has a task ✅
- §5 RATE_CON_SECTIONS: Task 2 inlines the full registry ✅
- §6 DOCUMENT_TYPES: Task 1 ✅
- §7 Renderer data shape: Task 10 ✅
- §8 Composer: Task 11 ✅
- §9 Renderer: Task 10 ✅
- §10 Component breakdown: 10.1 → Task 6; 10.2 → Task 5; 10.3 → Tasks 7 + 8; 10.4 → Task 4 ✅
- §11 Test plan: Tasks 1, 2, 3, 9 ✅
- §12 Risks: covered by tasks ✅
- §13 Follow-ups: filed in Task 13 ✅

**Type/name consistency check:**
- `buildSectionData` exported from `lib/pdf/build-rate-con-section-data.js` (Task 9) and re-exported from `components/pdf/RateConTemplate.js` (Task 11) — consistent
- `fetchRateConData` + `renderRateConPdf` named consistently in Task 10
- Section IDs: header / rate_con_details / address_details / move_events / order_details / commodity_details / charge_details / notes / signature / disclaimer / footer — consistent in Tasks 2, 4 (sample-data), 6, 7, 9, 11
- Field IDs: `bill_to` and `customer` correctly REJECTED by Rate Con's address_details registry (only the 4 location fields). `billing_notes` correctly REJECTED by Rate Con's notes (only driver_notes + load_notes).
- `showSubtotal` prop name consistent across ChargeDetails (Task 5), ChargeDetailsPreview (Task 5), DocumentPreview override (Task 8), and RateConTemplate composer (Task 11)

**Open spec items not directly testable in tests/ layer:** RateConDetails / RateConDetailsPreview / fetchRateConData are all manual-smoke (Task 12). This matches the spec's §11.1 acknowledgement that React-PDF / HTML rendering / DB-backed code is not automated at the test layer.
