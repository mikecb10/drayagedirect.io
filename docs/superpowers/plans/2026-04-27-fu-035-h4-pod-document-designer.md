# FU-035-H4 Proof of Delivery Document Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brand-new Proof of Delivery (POD) doc type to the Document Designer + a download URL endpoint (`GET /api/tenant/pdf/pod/[orderId]`). Send-email + bulk-send infrastructure deferred to a follow-up FU.

**Architecture:** Independent `POD_SECTIONS` registry (sibling to existing 4 registries). 11 sections, 40 leaf toggles. Move Events defaultVisible:**TRUE** (the timeline IS the proof — different from Invoice/Rate Con/Combined). NEW component pairs: `PodDetails` (5-field grid analogous to RateConDetails) + `AttachedDocuments` (file-listing table from `order_documents` where `document_type='POD'`). Reuses 9 components from prior FUs unchanged. NEW download endpoint mirrors existing `pages/api/tenant/pdf/rate-con/[id].js` shape. Adds a `formatTime()` helper to `lib/pdf/format-date.js` so the POD's delivery_date and delivery_time can be toggled independently.

**Tech Stack:** Next.js 15 + React 19, @react-pdf/renderer 4.5, Supabase Postgres, Tailwind 4, native Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-04-27-fu-035-h4-pod-document-designer-design.md`](../specs/2026-04-27-fu-035-h4-pod-document-designer-design.md)

---

## Task 1: Add `'pod'` to `DOCUMENT_TYPES` registry

**Files:**
- Create: `tests/document-types-constants-pod.test.mjs`
- Modify: `lib/constants/document-types.js`
- Modify: `tests/document-types-constants.test.mjs` (exhaustive list update — same minimal pattern as H1/H2/H3)

- [ ] **Step 1: Write the failing test**

Create `tests/document-types-constants-pod.test.mjs`:

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

test("'pod' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('pod'), `missing 'pod' in: ${ids.join(', ')}`);
});

test("getDocumentType('pod') returns category 'load', label 'Proof of Delivery'", () => {
  const entry = getDocumentType('pod');
  assert.equal(entry.value, 'pod');
  assert.equal(entry.label, 'Proof of Delivery');
  assert.equal(entry.category, 'load');  // NOT 'ar' — POD is a load-side artifact
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('pod') is true", () => {
  assert.equal(isValidDocumentType('pod'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('pod'));
  assert.equal(DOCUMENT_TYPE_LABELS['pod'], 'Proof of Delivery');
});

test('all 6 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
  assert.ok(ids.includes('pod'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-types-constants-pod.test.mjs`
Expected: FAIL — `missing 'pod'`.

- [ ] **Step 3: Add 'pod' to DOCUMENT_TYPES**

Edit `lib/constants/document-types.js`. Append the new entry after the existing `'combined_invoice'` entry:

```js
  {
    value: 'pod',
    label: 'Proof of Delivery',
    description: 'Document confirming a load was delivered',
    category: 'load',
  },
```

The full array should now have 6 entries: `delivery_order_full`, `delivery_order_next_move`, `invoice`, `rate_con`, `combined_invoice`, `pod`.

- [ ] **Step 4: Update the existing exhaustive-list test**

Read `tests/document-types-constants.test.mjs`. Find the hardcoded `deepEqual` exhaustive check on `DOCUMENT_TYPES.map((t) => t.value)` (the line that was updated in H1/H2/H3 Tasks 1). Update to include `'pod'` as the 6th entry. Should be a 1-line change to a single assertion. Update the test name/description if it references a count.

- [ ] **Step 5: Run new test to verify it passes**

Run: `node --test tests/document-types-constants-pod.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Run all existing tests to verify no regression**

Run: `node --test tests/document-types-constants.test.mjs`
Expected: PASS — all DO + Invoice + Rate Con + Combined Invoice tests still green.

- [ ] **Step 7: Commit**

```bash
git add tests/document-types-constants-pod.test.mjs tests/document-types-constants.test.mjs lib/constants/document-types.js
git commit -m "feat(doc-designer): register 'pod' in DOCUMENT_TYPES (FU-035-H4)"
```

---

## Task 2: Add `POD_SECTIONS` to section registry

**Files:**
- Create: `tests/document-sections-pod-constants.test.mjs`
- Modify: `lib/constants/document-sections.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-sections-pod-constants.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  POD_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('POD_SECTIONS entries have required keys', () => {
  for (const s of POD_SECTIONS) {
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

test('all 11 POD sections present in expected order', () => {
  const ids = POD_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'pod_details', 'address_details', 'move_events',
    'order_details', 'commodity_details', 'attached_documents',
    'notes', 'signature', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing POD section: ${id}`);
  }
  assert.equal(POD_SECTIONS.length, 11);
});

test('footer is non-toggleable on POD', () => {
  const footer = POD_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('move_events defaults TRUE on POD (different from Invoice/Rate Con/Combined)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'move_events');
  assert.equal(s.defaultVisible, true);
});

test('commodity_details / signature / disclaimer default OFF on POD', () => {
  for (const id of ['commodity_details', 'signature', 'disclaimer']) {
    const s = POD_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('pod_details has 5 fields', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'pod_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'order_number', 'customer_reference', 'driver_name',
    'delivery_date', 'delivery_time',
  ]) {
    assert.ok(fieldIds.includes(id), `missing pod_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 5);
});

test('address_details uses bill_to (NOT customer)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'),  'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on POD (DO-only)');
  assert.equal(fieldIds.length, 5);  // bill_to + 4 location fields
});

test('attached_documents has no fields (master toggle only)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'attached_documents');
  assert.equal(s.fields, undefined);
});

test('notes has ONLY driver_notes (NOT billing/load notes)', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('driver_notes'),     'driver_notes required');
  assert.ok(!fieldIds.includes('billing_notes'),   'billing_notes should NOT be on pod');
  assert.ok(!fieldIds.includes('load_notes'),      'load_notes should NOT be on pod');
  assert.equal(fieldIds.length, 1);
});

test('order_details has 19 fields (label "Equipment Details")', () => {
  const s = POD_SECTIONS.find((x) => x.id === 'order_details');
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

test("getSectionsForDocumentType('pod') returns POD_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('pod'), POD_SECTIONS);
});

test('computeVisibility honors POD_SECTIONS defaults with no config', () => {
  const result = computeVisibility(POD_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.pod_details, true);
  assert.equal(result.visibility.move_events, true);          // ← TRUE for POD
  assert.equal(result.visibility.attached_documents, true);
  assert.equal(result.visibility.commodity_details, false);
  assert.equal(result.visibility.signature, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.footer, true);
  assert.equal(result.fields.pod_details.driver_name, true);
  assert.equal(result.fields.notes.driver_notes, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-pod-constants.test.mjs`
Expected: FAIL — `POD_SECTIONS` not exported.

- [ ] **Step 3: Add `POD_SECTIONS` and register it**

Edit `lib/constants/document-sections.js`. **Append** the following AFTER the existing `COMBINED_INVOICE_SECTIONS` constant (do NOT touch DELIVERY_ORDER_SECTIONS / INVOICE_SECTIONS / RATE_CON_SECTIONS / COMBINED_INVOICE_SECTIONS):

```js
export const POD_SECTIONS = [
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
    id: 'pod_details',
    label: 'Delivery Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'order_number',       label: 'Order #',                    defaultVisible: true },
      { id: 'customer_reference', label: 'Customer Reference / PO #',  defaultVisible: true },
      { id: 'driver_name',        label: 'Driver',                     defaultVisible: true },
      { id: 'delivery_date',      label: 'Delivery Date',              defaultVisible: true },
      { id: 'delivery_time',      label: 'Delivery Time',              defaultVisible: true },
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
    defaultVisible: true,
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
    id: 'attached_documents',
    label: 'Attached Documents',
    defaultVisible: true,
    toggleable: true,
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'driver_notes', label: 'Driver Notes', defaultVisible: true },
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

Then update `SECTIONS_BY_DOCUMENT_TYPE`. After H3's Task 2 it has 5 entries. Add `pod`:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
  combined_invoice: COMBINED_INVOICE_SECTIONS,
  pod: POD_SECTIONS,
};
```

- [ ] **Step 4: Run new test to verify it passes**

Run: `node --test tests/document-sections-pod-constants.test.mjs`
Expected: PASS — 12 tests pass.

- [ ] **Step 5: Run existing constant tests to verify no regression**

Run: `node --test tests/document-sections-constants.test.mjs tests/document-sections-invoice-constants.test.mjs tests/document-sections-rate-con-constants.test.mjs tests/document-sections-combined-invoice-constants.test.mjs`
Expected: PASS — all existing DO + Invoice + Rate Con + Combined Invoice tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/document-sections-pod-constants.test.mjs lib/constants/document-sections.js
git commit -m "feat(doc-designer): add POD_SECTIONS registry (FU-035-H4)"
```

---

## Task 3: Validator regression tests for POD

**Files:**
- Create: `tests/validate-section-config-pod.test.mjs`

The validator at `lib/pdf/validate-section-config.js` is per-doc-type-aware (FU-112). After Task 2, it auto-supports POD. These tests confirm field-ID isolation across all 5 prior doc types.

- [ ] **Step 1: Write the test file**

Create `tests/validate-section-config-pod.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on pod's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'pod',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS customer=false on pod (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'pod',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /customer/);
});

test("validator REJECTS billing_notes=false on pod's notes (Invoice-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { billing_notes: false } } } },
    'pod',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /billing_notes/);
});

test("validator accepts pod_details.driver_name=false", () => {
  const r = validateSectionConfig(
    { perSection: { pod_details: { fields: { driver_name: false } } } },
    'pod',
  );
  assert.equal(r.ok, true);
});

test('field-ID isolation: pod_details fields rejected on other doc types', () => {
  const payload = { perSection: { pod_details: { fields: { driver_name: false } } } };
  assert.equal(validateSectionConfig(payload, 'pod').ok,                 true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
  assert.equal(validateSectionConfig(payload, 'combined_invoice').ok,    false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test('field-ID isolation: invoice_details fields rejected on pod', () => {
  const payload = { perSection: { invoice_details: { fields: { invoice_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'pod').ok, false);
});

test("validator accepts a full pod section_config payload", () => {
  const r = validateSectionConfig(
    {
      visibility: { pod_details: true, move_events: true, signature: false },
      perSection: {
        pod_details:        { fields: { order_number: true, customer_reference: true, driver_name: true, delivery_date: true, delivery_time: false } },
        address_details:    { fields: { bill_to: true, pickup_location: true, delivery_location: true, return_location: false, display_pickup_for_operational_street_turns: false } },
        notes:              { fields: { driver_notes: true } },
      },
      colors: { accent: '#FF0000', text: '#222222' },
    },
    'pod',
  );
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/validate-section-config-pod.test.mjs`
Expected: PASS — all 7 tests pass without any code change. Validator already supports POD via `getSectionsForDocumentType('pod')`.

- [ ] **Step 3: Commit**

```bash
git add tests/validate-section-config-pod.test.mjs
git commit -m "test(doc-designer): regression tests for validator against POD_SECTIONS (FU-035-H4)"
```

---

## Task 4: Add `formatTime()` helper

**Files:**
- Modify: `lib/pdf/format-date.js`

`POD_SECTIONS.pod_details.fields.delivery_time` requires a time-only formatter. `formatDate(input)` already exists (returns "Apr 26, 2026"); we add a sibling `formatTime(input)` returning "2:30 PM".

- [ ] **Step 1: Edit lib/pdf/format-date.js**

Read the current file. After the existing `export function formatDate(input)` block, add:

```js
/**
 * Format a date or timestamp's TIME component for printed PDFs.
 * Sibling to formatDate(); paired with it for fields like POD's
 * delivery_date + delivery_time, where tenants can toggle either or
 * both. Returns null for null/undefined/invalid input.
 *
 * Output: "2:30 PM" style — en-US, 12-hour, no seconds.
 *
 * @param {string|Date|null|undefined} input
 * @returns {string|null}
 */
export function formatTime(input) {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run a syntax check:

```bash
node -e "import('./lib/pdf/format-date.js').then(m => console.log('OK', Object.keys(m)))"
```

Expected: `OK [ 'formatDate', 'formatTime' ]`.

- [ ] **Step 3: Run all tests as a regression check**

Run: `node --test tests/`
Expected: ALL existing tests pass (only pre-existing fire-trigger failure).

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/format-date.js
git commit -m "feat(pdf): add formatTime() helper for POD delivery_time field (FU-035-H4)"
```

---

## Task 5: Create sample-data-pod.js + register in DocumentPreview

**Files:**
- Create: `lib/document-designer/sample-data-pod.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Create the new POD sample data file**

Create `lib/document-designer/sample-data-pod.js`:

```js
// Mirror this shape against buildSectionData() in lib/pdf/build-pod-section-data.js —
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
  pod_details: {
    order_number: 'L-ABC123',
    customer_reference: 'PO-12345',
    driver_name: 'John Driver',
    delivery_date: 'MONTH DD, YYYY',
    delivery_time: 'h:mm AM/PM',
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
  attached_documents: [
    { id: 'doc-1-uuid', file_name: 'POD_signed.jpg',          document_type: 'POD', uploaded_at: 'MONTH DD, YYYY' },
    { id: 'doc-2-uuid', file_name: 'BOL_delivery_copy.pdf',   document_type: 'POD', uploaded_at: 'MONTH DD, YYYY' },
  ],
  notes: {
    driver_notes: 'SAMPLE driver notes — delivered without incident',
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

Read `components/settings/document-designer/preview/DocumentPreview.js`. Find the imports section. After the existing 4 sample-data imports, add:

```js
import sampleDataPod              from '../../../../lib/document-designer/sample-data-pod';
```

Then find the `SAMPLE_BY_DOCUMENT_TYPE` map and add the `pod` entry:

```js
const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
  rate_con:                 sampleDataRateCon,
  combined_invoice:         sampleDataCombinedInvoice,
  pod:                      sampleDataPod,
};
```

- [ ] **Step 3: Commit**

```bash
git add lib/document-designer/sample-data-pod.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): add POD sample data + DocumentPreview registration (FU-035-H4)"
```

---

## Task 6: Build `PodDetails` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/PodDetails.js`
- Create: `components/settings/document-designer/preview/PodDetailsPreview.js`

5-field 3-col grid. Mirrors RateConDetails.js exactly (no consolidated footnote, no terms_days special case).

- [ ] **Step 1: Create PodDetails.js (PDF)**

Create `components/pdf/sections/PodDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * POD Delivery Details section — 5 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Mirrors RateConDetails.js's structure.
 *
 * `data` shape:
 *   {
 *     order_number, customer_reference, driver_name,
 *     delivery_date, delivery_time,
 *   }
 *
 * `opts.fields`: { order_number, customer_reference, driver_name,
 *                  delivery_date, delivery_time }
 */
const FIELD_ORDER = [
  ['order_number',       'Order #'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['driver_name',        'Driver'],
  ['delivery_date',      'Delivery Date'],
  ['delivery_time',      'Delivery Time'],
];

export default function PodDetails({ data, opts, colors }) {
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

- [ ] **Step 2: Create PodDetailsPreview.js (HTML)**

Create `components/settings/document-designer/preview/PodDetailsPreview.js`:

```js
/**
 * HTML preview of POD Delivery Details. Mirrors components/pdf/sections/PodDetails.js.
 * 3-col label-value grid; skips empty values.
 */
const FIELD_ORDER = [
  ['order_number',       'Order #'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['driver_name',        'Driver'],
  ['delivery_date',      'Delivery Date'],
  ['delivery_time',      'Delivery Time'],
];

export default function PodDetailsPreview({ data, opts, colors }) {
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

- [ ] **Step 3: Run all tests**

Run: `node --test tests/`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/PodDetails.js components/settings/document-designer/preview/PodDetailsPreview.js
git commit -m "feat(pdf): PodDetails section component (PDF + HTML preview) (FU-035-H4)"
```

---

## Task 7: Build `AttachedDocuments` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/AttachedDocuments.js`
- Create: `components/settings/document-designer/preview/AttachedDocumentsPreview.js`

Toggle-aware (master only) 2-col table. Accent-color band header. Empty-state "(No attached documents)".

- [ ] **Step 1: Create AttachedDocuments.js (PDF)**

Create `components/pdf/sections/AttachedDocuments.js`:

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
  cellName: { flex: 3, fontSize: 9 },
  cellDate: { flex: 1, fontSize: 9 },
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

/**
 * Attached Documents section — list of POD-typed files from order_documents.
 *   Header band (accent-color) + 2-column table: File Name | Uploaded.
 *
 * `data` shape: Array<{ id, file_name, document_type, uploaded_at }>
 *   uploaded_at is pre-formatted by fetchPodData (string).
 *
 * v1 lists files only; embedding image thumbnails is a future enhancement
 * (FU-035-H4-followup-C).
 */
export default function AttachedDocuments({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Attached Documents</Text>
      </View>

      <View style={styles.headerRow}>
        <Text style={[styles.cellName, styles.headerText]}>File Name</Text>
        <Text style={[styles.cellDate, styles.headerText]}>Uploaded</Text>
      </View>

      {data.length === 0 ? (
        <Text style={styles.emptyRow}>(No attached documents)</Text>
      ) : (
        data.map((doc, idx) => (
          <View key={doc.id || idx} style={styles.row}>
            <Text style={styles.cellName}>{doc.file_name || '—'}</Text>
            <Text style={styles.cellDate}>{doc.uploaded_at || '—'}</Text>
          </View>
        ))
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create AttachedDocumentsPreview.js (HTML)**

Create `components/settings/document-designer/preview/AttachedDocumentsPreview.js`:

```js
/**
 * HTML preview of Attached Documents. Mirrors components/pdf/sections/AttachedDocuments.js.
 * Accent-banded header + 2-column table.
 */
export default function AttachedDocumentsPreview({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Attached Documents
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">File Name</th>
            <th className="text-left px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={2} className="text-center italic text-gray-500 py-3">
                (No attached documents)
              </td>
            </tr>
          ) : (
            data.map((doc, idx) => (
              <tr key={doc.id || idx} className="border-b border-gray-100">
                <td className="px-2 py-1.5">{doc.file_name || '—'}</td>
                <td className="px-2 py-1.5">{doc.uploaded_at || '—'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Run all tests**

Run: `node --test tests/`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/AttachedDocuments.js components/settings/document-designer/preview/AttachedDocumentsPreview.js
git commit -m "feat(pdf): AttachedDocuments section component (PDF + HTML preview) (FU-035-H4)"
```

---

## Task 8: Wire `pod` in DocumentPreview (register previews + address_details override)

**Files:**
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Register the 2 new preview components**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Add 2 imports near the other preview imports:

```js
import PodDetailsPreview            from './PodDetailsPreview';
import AttachedDocumentsPreview     from './AttachedDocumentsPreview';
```

Find the `PREVIEW_BY_SECTION_ID` map. After H3's Task 8 it has 12 entries. Add `pod_details` (between `rate_con_details` and `address_details`) and `attached_documents` (between `commodity_details` and `notes`):

```js
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  invoice_details:        InvoiceDetailsPreview,
  rate_con_details:       RateConDetailsPreview,
  pod_details:            PodDetailsPreview,
  address_details:        AddressDetailsPreview,
  loads_summary:          LoadsSummaryPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  attached_documents:     AttachedDocumentsPreview,
  charge_details:         ChargeDetailsPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};
```

- [ ] **Step 2: Add per-doc-type override block for `pod`'s address_details**

In the same file, find the section-render loop with the existing per-doc-type override blocks. After the existing combined_invoice override blocks, add:

```js
if (s.id === 'address_details' && documentType === 'pod') {
  // Same field-ID translation as Invoice / Combined Invoice.
  // POD_SECTIONS uses bill_to; AddressDetailsPreview reads opts.fields.customer.
  // Mirrored in components/pdf/PodTemplate.js renderSection() for the print path.
  opts.customerLabel = 'Bill To';
  opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
}
```

- [ ] **Step 3: Run all tests**

Run: `node --test tests/`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): preview wires pod section overrides (FU-035-H4)"
```

---

## Task 9: Build `buildSectionData` for POD + tests

**Files:**
- Create: `lib/pdf/build-pod-section-data.js`
- Create: `tests/pod-build-section-data.test.mjs`

Per H1's lesson learned, `buildSectionData` lives in `lib/pdf/` so the unit test runs under bare Node without a JSX transformer.

- [ ] **Step 1: Write the failing test**

Create `tests/pod-build-section-data.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildSectionData } from '../lib/pdf/build-pod-section-data.js';

const baseDoc = {
  order_id: 'order-uuid',
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
  pod_meta: {
    order_number: 'L-ABC',
    customer_reference: 'PO-12345',
    driver_name: 'John Driver',
    delivery_date: 'Apr 26, 2026',
    delivery_time: '2:30 PM',
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
    notes: 'Driver delivered without incident',
    internal_notes: 'Internal: route went smoothly',
  },
  load_level_locations: {
    pickup_location:   { name: 'Newark Terminal',  city: 'Newark', state: 'NJ' },
    delivery_location: { name: 'Edison Warehouse', city: 'Edison', state: 'NJ' },
    return_location:   { name: 'Newark Terminal',  city: 'Newark', state: 'NJ' },
  },
  moves: [],
  attached_documents: [
    { id: 'doc-1', file_name: 'POD_signed.jpg', document_type: 'POD', uploaded_at: 'Apr 26, 2026' },
    { id: 'doc-2', file_name: 'BOL_copy.pdf',   document_type: 'POD', uploaded_at: 'Apr 26, 2026' },
  ],
};

test('buildSectionData maps pod_meta to pod_details (5 fields)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.pod_details.order_number, 'L-ABC');
  assert.equal(sd.pod_details.customer_reference, 'PO-12345');
  assert.equal(sd.pod_details.driver_name, 'John Driver');
  assert.equal(sd.pod_details.delivery_date, 'Apr 26, 2026');
  assert.equal(sd.pod_details.delivery_time, '2:30 PM');
});

test('buildSectionData maps bill_to to address_details.customer (AddressDetails-internal ID)', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.address_details.customer.name, 'Walmart');
  assert.equal(sd.address_details.customer.phone, '555-9999');
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
  assert.equal(sd.order_details.steamship_line,        'MSC');
  assert.equal(sd.order_details.booking_bl,            'BK789');
  assert.equal(sd.order_details.last_free_day,         '2026-04-22');
});

test('buildSectionData passes attached_documents through verbatim', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.attached_documents.length, 2);
  assert.equal(sd.attached_documents[0].file_name, 'POD_signed.jpg');
  assert.equal(sd.attached_documents[1].file_name, 'BOL_copy.pdf');
});

test('buildSectionData maps notes.driver_notes from first_order.notes', () => {
  const sd = buildSectionData(baseDoc);
  assert.equal(sd.notes.driver_notes, 'Driver delivered without incident');
});

test('buildSectionData returns null-safe shapes when first_order is null', () => {
  const sd = buildSectionData({ ...baseDoc, first_order: null, load_level_locations: null, attached_documents: null });
  assert.equal(sd.address_details.pickup_location, null);
  assert.equal(sd.address_details.delivery_location, null);
  assert.equal(sd.address_details.return_location, null);
  assert.equal(sd.order_details.reference_number, null);
  assert.equal(sd.notes.driver_notes, null);
  assert.deepEqual(sd.attached_documents, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pod-build-section-data.test.mjs`
Expected: FAIL — `buildSectionData` not exported (import error).

- [ ] **Step 3: Create the helper**

Create `lib/pdf/build-pod-section-data.js`:

```js
/**
 * Build per-section data subsets for the POD composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner. Same pattern as
 * lib/pdf/build-{invoice,rate-con,combined-invoice}-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/PodTemplate.js).
 */
export function buildSectionData(doc) {
  const meta = doc.pod_meta || {};
  const order = doc.first_order || null;
  const locations = doc.load_level_locations || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    pod_details: {
      order_number:       meta.order_number       ?? null,
      customer_reference: meta.customer_reference ?? null,
      driver_name:        meta.driver_name        ?? null,
      delivery_date:      meta.delivery_date      ?? null,
      delivery_time:      meta.delivery_time      ?? null,
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
    attached_documents: doc.attached_documents || [],
    notes: {
      driver_notes: order?.notes ?? null,
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

Run: `node --test tests/pod-build-section-data.test.mjs`
Expected: PASS — 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/build-pod-section-data.js tests/pod-build-section-data.test.mjs
git commit -m "feat(pdf): buildSectionData for POD + tests (FU-035-H4)"
```

---

## Task 10: Build `fetchPodData` + `renderPodPdf`

**Files:**
- Create: `lib/pdf/render-pod.js`

NEW renderer module. Fetches order + customer + moves/events + order_documents (POD-typed only) + tenant info. Resolves driver_name via the heuristic described in spec §3.5. Resolves delivery_date/delivery_time from the last `deliver` event.

- [ ] **Step 1: Create render-pod.js**

Create `lib/pdf/render-pod.js`:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import PodTemplate from '../../components/pdf/PodTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate, formatTime } from './format-date';

/**
 * Resolve the POD's "Driver" field via this fallback chain:
 *   1. Driver of the LAST move whose events[] contains a `deliver` event
 *   2. Driver of the last move overall
 *   3. Driver of the first move
 *   4. null
 *
 * Each "driver" is `${first_name} ${last_name}` from the move's joined
 * drivers row, or null if no driver assigned.
 */
function resolveDriverName(moves) {
  if (!Array.isArray(moves) || moves.length === 0) return null;

  // Pass 1: last move with a deliver event
  for (let i = moves.length - 1; i >= 0; i--) {
    const m = moves[i];
    const hasDeliver = (m.events || []).some((e) => e.event_type === 'deliver');
    if (hasDeliver && m.driver) {
      return [m.driver.first_name, m.driver.last_name].filter(Boolean).join(' ') || null;
    }
  }

  // Pass 2: last move with any driver
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].driver) {
      return [moves[i].driver.first_name, moves[i].driver.last_name].filter(Boolean).join(' ') || null;
    }
  }

  // Pass 3: first move with any driver (already covered by pass 2 reverse loop, but keep for clarity)
  // Pass 4: null
  return null;
}

/**
 * Find the last `deliver` event across all moves, sorted by sequence.
 * Returns the event row, or null.
 */
function findLastDeliverEvent(moves) {
  const allDelivers = (moves || [])
    .flatMap((m) => (m.events || []).filter((e) => e.event_type === 'deliver'));
  if (allDelivers.length === 0) return null;
  // Sort by sequence ascending; take last
  allDelivers.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  return allDelivers[allDelivers.length - 1];
}

/**
 * Fetch POD data for an order and shape it for the composer.
 * Returns null if the order doesn't exist for this tenant.
 */
export async function fetchPodData(svc, orderId, tenantId) {
  // 1. Order + bill-to customer (1 query, joined)
  const { data: order, error: orderErr } = await svc
    .from('orders')
    .select(`
      id, order_number, customer_reference,
      container_number, chassis_number,
      container_size, container_type, chassis_size, chassis_type,
      chassis_owner, steamship_line, seal_number,
      mbol, hbol, booking_number, pickup_number,
      is_hazmat, last_free_day, per_diem_free_day,
      pull_container_date, return_container_date,
      notes, internal_notes,
      customer_id,
      customer:customers!orders_customer_id_fkey(
        id, name, address_line1, address_line2, city, state, zip,
        billing_email, phone
      )
    `)
    .eq('id', orderId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (orderErr) throw new Error(`Order fetch failed: ${orderErr.message}`);
  if (!order) return null;

  // 2. Order's moves + events (2 queries — same shape as DO/Invoice/Rate Con)
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

  const moves = (rawMoves || []).map((m) => ({
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

  // Derive load-level locations (same as DO/Invoice/Rate Con)
  const { deriveLoadLevelLocations } = await import('./render-delivery-order');
  const loadLevelLocations = deriveLoadLevelLocations(moves);

  // 3. POD documents from order_documents (1 query)
  const { data: docRows, error: docErr } = await svc
    .from('order_documents')
    .select('id, file_name, document_type, uploaded_at')
    .eq('order_id', order.id)
    .eq('tenant_id', tenantId)
    .eq('document_type', 'POD')
    .order('uploaded_at', { ascending: true });
  if (docErr) throw new Error(`order_documents fetch failed: ${docErr.message}`);

  const attachedDocuments = (docRows || []).map((d) => ({
    id: d.id,
    file_name: d.file_name,
    document_type: d.document_type,
    uploaded_at: formatDate(d.uploaded_at),
  }));

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

  // Compute pod_meta: driver_name from heuristic, delivery_date/time from last deliver event
  const driverName = resolveDriverName(moves);
  const lastDeliver = findLastDeliverEvent(moves);
  const deliveryTs = lastDeliver?.departed_at || lastDeliver?.arrived_at || null;

  return {
    order_id: order.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: order.customer
      ? {
          name:          order.customer.name,
          address_line1: order.customer.address_line1,
          city:          order.customer.city,
          state:         order.customer.state,
          zip:           order.customer.zip,
        }
      : null,
    customer_contact: order.customer
      ? { phone: order.customer.phone, email: order.customer.billing_email }
      : null,
    bill_to_customer_id: order.customer_id || null,
    pod_meta: {
      order_number:       order.order_number,
      customer_reference: order.customer_reference,
      driver_name:        driverName,
      delivery_date:      formatDate(deliveryTs),
      delivery_time:      formatTime(deliveryTs),
    },
    first_order: order,
    load_level_locations: loadLevelLocations,
    moves,
    attached_documents: attachedDocuments,
  };
}

/**
 * Fetch POD data + render as PDF Buffer.
 *
 * @param {SupabaseClient} svc - service-role client
 * @param {string} orderId
 * @param {string} tenantId
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Order not found' if missing or wrong tenant
 */
export async function renderPodPdf(svc, orderId, tenantId) {
  const doc = await fetchPodData(svc, orderId, tenantId);
  if (!doc) throw new Error('Order not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'pod'
  );

  return await renderToBuffer(
    React.createElement(PodTemplate, { doc, sectionConfig })
  );
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all existing tests continue to pass. Note: `PodTemplate` doesn't exist yet (Task 11) — but the import is only used at JSX time inside `renderPodPdf`, which isn't called by any test.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/render-pod.js
git commit -m "feat(pdf): fetchPodData + cascade-aware renderPodPdf (FU-035-H4)"
```

---

## Task 11: Build `PodTemplate.js` composer

**Files:**
- Create: `components/pdf/PodTemplate.js`

This is the keystone integration step. After this commits, `renderPodPdf` produces a working PDF.

- [ ] **Step 1: Create components/pdf/PodTemplate.js**

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
import { buildSectionData } from '../../lib/pdf/build-pod-section-data';

import Header             from './sections/Header';
import PodDetails         from './sections/PodDetails';
import AddressDetails     from './sections/AddressDetails';
import OrderDetails       from './sections/OrderDetails';
import CommodityDetails   from './sections/CommodityDetails';
import AttachedDocuments  from './sections/AttachedDocuments';
import Notes              from './sections/Notes';
import Signature          from './sections/Signature';
import Disclaimer         from './sections/Disclaimer';
import MoveBlock          from './sections/MoveBlock';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-pod-section-data';

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
    case 'pod_details':
      return <PodDetails data={sectionData.pod_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: POD_SECTIONS uses `bill_to`; AddressDetails reads
      // `opts.fields.customer` internally. Per-doc-type "Bill To" label is
      // supplied via opts.customerLabel here. Mirrored in
      // components/settings/document-designer/preview/DocumentPreview.js for
      // the live HTML preview path — keep the two in sync.
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
    case 'attached_documents':
      return <AttachedDocuments data={sectionData.attached_documents} opts={opts} colors={colors} />;
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

export default function PodTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('pod');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'pod', title: 'PROOF OF DELIVERY', subtitle: null };

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

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all tests pass except the pre-existing fire-trigger-entity-aware failure.

- [ ] **Step 3: Commit**

```bash
git add components/pdf/PodTemplate.js
git commit -m "feat(pdf): PodTemplate composer (FU-035-H4)"
```

---

## Task 12: Build the download endpoint

**Files:**
- Create: `pages/api/tenant/pdf/pod/[id].js`

NEW endpoint: `GET /api/tenant/pdf/pod/[id]` returns the rendered POD as `application/pdf`. Mirrors the existing `pages/api/tenant/pdf/rate-con/[id].js` shape but without the archive-check (POD doesn't have an archive in v1).

- [ ] **Step 1: Create the endpoint**

Create `pages/api/tenant/pdf/pod/[id].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderPodPdf } from '../../../../../lib/pdf/render-pod';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { id } = req.query;
  const svc = getServiceClient();

  try {
    const buffer = await renderPodPdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="pod-${id}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Order not found') {
      return res.status(404).json({ error: 'Order not found' });
    }
    console.error(`POD ${id} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/`
Expected: PASS — all existing tests continue to pass. The new endpoint isn't covered by unit tests; manual smoke verifies in Task 13.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/pdf/pod/[id].js
git commit -m "feat(api): GET /api/tenant/pdf/pod/[id] download endpoint (FU-035-H4)"
```

---

## Task 13: Manual verification via Chrome MCP subagent + dd-qa

This task has minimal code changes — it's the manual smoke pass. Uses the Chrome MCP subagent (`mcp__Claude_in_Chrome__*`) for DOM-aware testing, replacing the preview-tool approach we tried in H2 (which hit auth issues).

- [ ] **Step 1: Run all unit tests one more time**

Run: `node --test tests/`
Expected: ALL pass — DO + Invoice + Rate Con + Combined + new POD tests + pre-existing fire-trigger failure.

- [ ] **Step 2: Restart the dev server**

```bash
npm run dev
```

Wait for clean compile.

- [ ] **Step 3: Dispatch a Chrome MCP subagent to verify the Document Designer UI**

The subagent prompt should:
1. Use `mcp__Claude_in_Chrome__navigate` to open `http://localhost:3000/settings/document-designer?type=pod`
2. Use `mcp__Claude_in_Chrome__read_page` to verify the toggle list shows 11 sections in order: Header, Delivery Details, Address Details, Move Events, Equipment Details, Commodity Details, Attached Documents, Notes, Signature Block, Terms & Conditions, Footer
3. Verify the right pane preview renders the POD sample data (Order #, Driver: John Driver, 2 attached documents, etc.)
4. Use `mcp__Claude_in_Chrome__find` to locate toggle inputs; click "Move Events" to toggle it off; verify the section disappears from the preview
5. Click "Charge Name" toggle inside Charge Details — wait, POD doesn't have charge_details. Skip.
6. Click "Chassis #" toggle inside Equipment Details; verify the chassis row disappears from the preview
7. Use `mcp__Claude_in_Chrome__read_console_messages` and `mcp__Claude_in_Chrome__read_network_requests` to flag any errors
8. Take a screenshot via `mcp__Claude_in_Chrome__gif_creator` or screenshot of the preview

The subagent should report: section list correctness, default visibility, toggle behavior, console/network cleanliness.

- [ ] **Step 4: Test the new download endpoint manually**

In a new browser tab (or have the Chrome MCP subagent do it), navigate to `http://localhost:3000/api/tenant/pdf/pod/<orderId>` for some real orderId from `/loads`.

Expected:
- The PDF opens inline in the browser viewer
- All sections render with real order data
- Move Events shows the actual delivery timeline
- Attached Documents lists any POD-typed files (or "(No attached documents)" if none)
- pod_details shows real driver name, real delivery date/time, real customer reference

- [ ] **Step 5: Regression check — print prior doc types**

Verify the 5 existing doc types still work:
- `/api/tenant/pdf/invoice/<invoiceId>` (single-load invoice)
- `/api/tenant/pdf/invoice/<consolidatedInvoiceId>` (combined invoice — peek-and-delegate routes to renderCombinedInvoicePdf)
- `/api/tenant/pdf/rate-con/<chargeSetId>`
- `/loads` bulk-print → DO

All should render unchanged.

- [ ] **Step 6: Per-customer override test**

In `/settings/document-designer?type=pod`, switch the customer dropdown to a specific customer. Edit accent color (e.g., red). Save. Switch back to "All Customers" → tenant default's color is unchanged.

- [ ] **Step 7: Run dd-qa skill**

```
/dd-qa
```

Address any findings.

- [ ] **Step 8: Commit verification artifacts (if any)**

```bash
git add docs/handoffs/  # only if anything new was saved
git commit -m "docs: FU-035-H4 manual verification artifacts" --allow-empty
```

If nothing to commit, skip.

---

## Task 14: Close FU-035-H4 in followups.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Update FU-035-H4 entry in followups.md**

Find the FU-035-H4 sub-bullet (after the resolved H1/H2/H3 entries). Replace its content:

```
  - **FU-035-H4 Proof of Delivery (POD)** — ✅ Resolved YYYY-MM-DD. NEW doc type (no legacy template existed). POD_SECTIONS (11 sections, 40 leaf toggles). Move Events defaultVisible:TRUE (the timeline IS the proof). NEW component pairs: PodDetails (5-field grid) + AttachedDocuments (file-listing table from order_documents where document_type='POD'). Reuses 9 components from prior FUs unchanged. NEW download endpoint GET /api/tenant/pdf/pod/[orderId] (Permission: ORDER_ENTRY/DISPATCHING/AR/ALL). NEW formatTime() helper in lib/pdf/format-date.js. Driver name resolved via heuristic: last-move-with-deliver → last-move → first-move → null. Spec docs/superpowers/specs/2026-04-27-fu-035-h4-pod-document-designer-design.md, plan docs/superpowers/plans/2026-04-27-fu-035-h4-pod-document-designer.md. ~13 commits. New tests: 4 files. Architecture milestone: Document Designer pattern now proven across 5 distinct doc-type registries (DO + Invoice + Rate Con + Combined Invoice + POD). Send-email + bulk-send infrastructure deferred to FU-035-H4-followup-B. See followups A-D below.
```

(Use today's date — `git log -1 --format=%cd` if needed.)

- [ ] **Step 2: Append new FU-035-H4 follow-ups**

After the existing FU-035-H3-followup-C block:

```
### FU-035-H4-followup-A: Integration smoke for renderPodPdf
- Source: FU-035-H4 spec §13
- Scope: small
- Area: pdf / tests
- Intent: Add a Supabase-mock-backed integration test that calls `renderPodPdf` with a stubbed svc client (returning the 5-6 query results that `fetchPodData` expects), runs `renderToBuffer`, and asserts the returned Buffer starts with the PDF magic bytes (`%PDF-`). Same pattern as the H1/H2/H3 followups.
- Notes: With H4 shipped, the renderer integration smoke FU now applies to 5 doc types — pattern is well-established. Could be extracted to a shared test utility.

### FU-035-H4-followup-B: POD send-email + bulk-send infrastructure
- Source: FU-035-H4 spec §13 (1c work deferred from the brainstorm)
- Scope: large
- Area: pdf / api / ar
- Intent: Build the customer-email-out path for PODs. New endpoints:
    - `POST /api/tenant/orders/[id]/send-pod-email.js` — single send
    - `POST /api/tenant/orders/bulk-send-pod.js` — bulk send across N orders
  Loads UI integration:
    - "Send POD" button on the load-detail page (probably under the Documents tab)
    - Bulk action "Send POD" on the dispatcher board for multi-select
  Email body templates: customer-facing copy. Subject: "POD - Order #L-ABC123". Body: "Your delivery for [load #] is confirmed. POD attached."
  Email attachment: render the POD PDF + attach the actual driver-uploaded POD images from order_documents (where document_type='POD').
- Notes: This is the "1c" scope from the brainstorm. Roughly 2-3 hours of work — similar shape to H1's invoice send-email but per-order keying. Permission gate: same as the GET endpoint + EMAIL_OUTBOUND.

### FU-035-H4-followup-C: Embed POD image thumbnails in AttachedDocuments
- Source: FU-035-H4 brainstorm Q2-A2 deferral
- Scope: medium
- Area: pdf / supabase-storage
- Intent: Replace the file-listing AttachedDocuments table with embedded React-PDF `<Image>` thumbnails of each POD document. Requires fetching image bytes from Supabase Storage (or generating short-TTL signed URLs) in the fetcher. Inflates PDF size to multi-MB but provides real visual proof.
- Notes: Must handle non-image documents (PDF BOLs) gracefully — fall back to listing for those. Consider a registry-level field toggle (embed_thumbnails: bool) so tenants can opt out for low-bandwidth use cases.

### FU-035-H4-followup-D: Archive POD PDFs to Supabase Storage
- Source: FU-035-H4 spec §12 (R7) and §13
- Scope: small
- Area: pdf
- Intent: When a POD is rendered (either via the GET endpoint or via the future send-email endpoint), upload the PDF buffer to Supabase Storage and stamp `orders.pod_pdf_url` (or a new column). Return the signed URL on subsequent reads to skip the re-render. Mirrors `lib/pdf/archive.js`'s archiveInvoicePdf / archiveRateConPdf pattern.
- Notes: Schema migration needed: `ALTER TABLE orders ADD COLUMN pod_pdf_url TEXT;` (or a new pod_archives table if multiple PODs per order are ever supported). Pair this with followup-B to avoid double-rendering during email send.
```

- [ ] **Step 3: Update MEMORY.md index header**

Find the lead bullet line in MEMORY.md (the one starting `- **[followups.md](followups.md) — open follow-ups...`). Replace its descriptive text to reflect H4 ship state. Mention:
- HEAD SHA after Task 11 commit
- Architecture milestone: 5 doc-type registries proven (DO + Invoice + Rate Con + Combined Invoice + POD)
- New cleanup FUs filed (H4-followup-A through D)
- Outstanding sub-FUs: H5-H9 + FU-035-G + FU-035-H4-followup-B (the deferred POD send-email work)

- [ ] **Step 4: Memory directory persists via auto-memory system**

Memory file edits persist via the auto-memory system. No git commit needed for the memory directory.

- [ ] **Step 5: Optional final wrap-up commit**

```bash
git log --oneline -15
git commit --allow-empty -m "$(cat <<'EOF'
chore: FU-035-H4 Proof of Delivery Document Designer migration complete

Brand-new POD doc type added to the Document Designer + GET /api/tenant/pdf/pod/[orderId]
download endpoint. POD_SECTIONS (11 sections, 40 leaf toggles). Move Events
defaultVisible:TRUE — the timeline IS the proof. NEW PodDetails + AttachedDocuments
section component pairs. Reuses 9 components from prior FUs. NEW formatTime()
helper. Driver name resolved via last-move-with-deliver-event heuristic.
Send-email + bulk-send deferred to FU-035-H4-followup-B.

Resolves: FU-035-H4
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- §1 Goal: Tasks 11 (composer) + 12 (endpoint) are the keystone shipping units; Tasks 1-10 build inputs
- §2 Non-goals: explicitly skipped send-email, image embedding, signature capture, archive
- §3 Architecture: 3.1 (independent registry) → Task 2; 3.2 (cascade by order.customer_id) → Task 10 (passed to resolveTemplateConfig); 3.3 (download endpoint, no send-email) → Task 12; 3.4 (component reuse) → Task 11; 3.5 (driver-name heuristic) → Task 10's `resolveDriverName`; 3.6 (formatTime helper) → Task 4; 3.7 (single-page) → Task 11; 3.8 (no eligibility gate) → no task needed (default behavior)
- §4 File touch-list: every entry has a task
- §5 POD_SECTIONS: Task 2 inlines the full registry
- §6 DOCUMENT_TYPES: Task 1
- §7 Renderer data shape: Task 10
- §8 Composer: Task 11
- §9 Renderer: Task 10
- §10 Component breakdown: 10.1 (PodDetails) → Task 6; 10.2 (AttachedDocuments) → Task 7; 10.3 (HTML previews) → Tasks 6, 7, 8; 10.4 (download endpoint) → Task 12; 10.5 (sample data) → Task 5
- §11 Test plan: Tasks 1, 2, 3, 9
- §12 Risks: covered by tasks
- §13 Follow-ups: filed in Task 14

**Type/name consistency check:**
- `buildSectionData` exported from `lib/pdf/build-pod-section-data.js` (Task 9) and re-exported from `components/pdf/PodTemplate.js` (Task 11) — consistent
- `fetchPodData` + `renderPodPdf` named consistently in Task 10
- `formatTime` named consistently in Task 4 + Task 10
- `resolveDriverName` defined in Task 10's render-pod.js
- Section IDs: header / pod_details / address_details / move_events / order_details / commodity_details / attached_documents / notes / signature / disclaimer / footer — consistent in Tasks 2, 5 (sample-data), 6, 7, 9, 11
- Field IDs: pod's `address_details.fields = [bill_to, pickup_location, delivery_location, return_location, display_pickup_for_operational_street_turns]` — same as Invoice's. Validator rejects `customer` (DO-only).
- Field IDs: pod's `pod_details.fields = [order_number, customer_reference, driver_name, delivery_date, delivery_time]` — POD-only. Validator rejects on Invoice/Rate Con/Combined/DO.
- `attached_documents` master toggle — POD-only.

**Open spec items not directly testable in tests/ layer:** PodDetails / AttachedDocuments / fetchPodData / renderPodPdf / endpoint are all manual-smoke (Task 13). Matches H1+H2+H3's approach.

**Plan-specific:** Task 13 leverages the Chrome MCP subagent for the first time in this plan family — this is a new verification mechanism that bypasses the auth issues we hit in H2.
