# FU-035-H5 Statement Document Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brand-new Statement of Account doc type to the Document Designer + a download URL endpoint (`GET /api/tenant/pdf/statement/[customerId]?asOfDate=YYYY-MM-DD`) + a minimal "Generate Statement" trigger on the organization detail page (`pages/organizations/[id].js`).

**Architecture:** Independent `STATEMENT_SECTIONS` registry (sibling to existing 5 registries). 9 sections, 20 leaf toggles. NEW component pairs: `StatementDetails`, `OpenInvoicesTable`, `AgingSummary`, `TotalOutstanding`. Reuses Header / AddressDetails / Notes / Disclaimer / DocumentFooter from prior FUs. NEW pure helper `computeAging(invoices, asOfDate)` lives in `lib/pdf/compute-aging.js` with a regression test against `lib/ar-utils.js`'s `getAgingBucket()` for bucket-assignment parity. Cascade by `customer_id`. NEW download endpoint and a small "Generate Statement" modal launched from the existing organization detail header.

**Tech Stack:** Next.js 15 + React 19, @react-pdf/renderer 4.5, Supabase Postgres, Tailwind 4, native Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-04-27-fu-035-h5-statement-document-designer-design.md`](../specs/2026-04-27-fu-035-h5-statement-document-designer-design.md)

---

## Task 1: Add `'statement'` to `DOCUMENT_TYPES` registry

**Files:**
- Create: `tests/document-types-constants-statement.test.mjs`
- Modify: `lib/constants/document-types.js`
- Modify: `tests/document-types-constants.test.mjs` (exhaustive list update — same minimal pattern as H1/H2/H3/H4)

- [ ] **Step 1: Write the failing test**

Create `tests/document-types-constants-statement.test.mjs`:

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

test("'statement' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('statement'), `missing 'statement' in: ${ids.join(', ')}`);
});

test("getDocumentType('statement') returns category 'ar', label 'Statement of Account'", () => {
  const entry = getDocumentType('statement');
  assert.equal(entry.value, 'statement');
  assert.equal(entry.label, 'Statement of Account');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('statement') is true", () => {
  assert.equal(isValidDocumentType('statement'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('statement'));
  assert.equal(DOCUMENT_TYPE_LABELS['statement'], 'Statement of Account');
});

test('all 7 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
  assert.ok(ids.includes('pod'));
  assert.ok(ids.includes('statement'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-types-constants-statement.test.mjs`
Expected: FAIL — `missing 'statement'`.

- [ ] **Step 3: Add 'statement' to DOCUMENT_TYPES**

Edit `lib/constants/document-types.js`. Append the new entry after the existing `'pod'` entry:

```js
  {
    value: 'statement',
    label: 'Statement of Account',
    description: 'Customer statement listing outstanding invoices and aging',
    category: 'ar',
  },
```

The full array should now have 7 entries: `delivery_order_full`, `delivery_order_next_move`, `invoice`, `rate_con`, `combined_invoice`, `pod`, `statement`.

- [ ] **Step 4: Update the existing exhaustive-list test**

Read `tests/document-types-constants.test.mjs`. Find the hardcoded `deepEqual` exhaustive check on `DOCUMENT_TYPES.map((t) => t.value)` (the line that was updated in H1/H2/H3/H4 Tasks 1). Update to include `'statement'` as the 7th sorted entry. Update the test name/description if it references a count.

- [ ] **Step 5: Run new test to verify it passes**

Run: `node --test tests/document-types-constants-statement.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Run all existing constant tests to verify no regression**

Run: `node --test tests/document-types-constants.test.mjs`
Expected: PASS — all DO + Invoice + Rate Con + Combined Invoice + POD tests still green.

- [ ] **Step 7: Commit**

```bash
git add tests/document-types-constants-statement.test.mjs tests/document-types-constants.test.mjs lib/constants/document-types.js
git commit -m "feat(doc-designer): register 'statement' in DOCUMENT_TYPES (FU-035-H5)"
```

---

## Task 2: Add `STATEMENT_SECTIONS` to section registry

**Files:**
- Create: `tests/document-sections-statement-constants.test.mjs`
- Modify: `lib/constants/document-sections.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-sections-statement-constants.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  STATEMENT_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('STATEMENT_SECTIONS entries have required keys', () => {
  for (const s of STATEMENT_SECTIONS) {
    assert.equal(typeof s.id, 'string');
    assert.equal(typeof s.label, 'string');
    assert.equal(typeof s.defaultVisible, 'boolean');
    assert.equal(typeof s.toggleable, 'boolean');
    if (s.fields) {
      assert.ok(Array.isArray(s.fields));
      for (const f of s.fields) {
        assert.equal(typeof f.id, 'string');
        assert.equal(typeof f.label, 'string');
        assert.equal(typeof f.defaultVisible, 'boolean');
      }
    }
  }
});

test('all 9 STATEMENT sections present in expected order', () => {
  const ids = STATEMENT_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'statement_details', 'address_details',
    'open_invoices', 'aging_summary', 'total_outstanding',
    'notes', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing STATEMENT section: ${id}`);
  }
  assert.equal(STATEMENT_SECTIONS.length, 9);
});

test('footer is non-toggleable on Statement', () => {
  const footer = STATEMENT_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('notes and disclaimer default OFF on Statement', () => {
  for (const id of ['notes', 'disclaimer']) {
    const s = STATEMENT_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('aging_summary, open_invoices, total_outstanding default ON', () => {
  for (const id of ['aging_summary', 'open_invoices', 'total_outstanding']) {
    const s = STATEMENT_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, true, `${id} should default on`);
  }
});

test('statement_details has 2 fields', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'statement_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['as_of_date', 'account_number']) {
    assert.ok(fieldIds.includes(id), `missing statement_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 2);
});

test('address_details uses bill_to (NOT customer)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'), 'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on statement (DO-only)');
  assert.equal(fieldIds.length, 3);  // bill_to + phone + email
});

test('open_invoices has 7 fields', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'open_invoices');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of [
    'invoice_number', 'invoice_date', 'due_date',
    'days_past_due', 'customer_reference',
    'original_amount', 'balance_due',
  ]) {
    assert.ok(fieldIds.includes(id), `missing open_invoices field: ${id}`);
  }
  assert.equal(fieldIds.length, 7);
});

test('aging_summary has no fields (master toggle only)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'aging_summary');
  assert.equal(s.fields, undefined);
});

test('disclaimer has no fields (master toggle only)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'disclaimer');
  assert.equal(s.fields, undefined);
});

test('notes has payment_instructions + custom_notes (NOT driver/billing/load notes)', () => {
  const s = STATEMENT_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('payment_instructions'));
  assert.ok(fieldIds.includes('custom_notes'));
  assert.ok(!fieldIds.includes('driver_notes'));
  assert.ok(!fieldIds.includes('billing_notes'));
  assert.ok(!fieldIds.includes('load_notes'));
  assert.equal(fieldIds.length, 2);
});

test("getSectionsForDocumentType('statement') returns STATEMENT_SECTIONS", () => {
  assert.equal(getSectionsForDocumentType('statement'), STATEMENT_SECTIONS);
});

test('computeVisibility honors STATEMENT_SECTIONS defaults with no config', () => {
  const result = computeVisibility(STATEMENT_SECTIONS, undefined);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.statement_details, true);
  assert.equal(result.visibility.open_invoices, true);
  assert.equal(result.visibility.aging_summary, true);
  assert.equal(result.visibility.total_outstanding, true);
  assert.equal(result.visibility.notes, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.footer, true);
  assert.equal(result.fields.statement_details.as_of_date, true);
  assert.equal(result.fields.open_invoices.balance_due, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-statement-constants.test.mjs`
Expected: FAIL — `STATEMENT_SECTIONS` not exported.

- [ ] **Step 3: Add `STATEMENT_SECTIONS` and register it**

Edit `lib/constants/document-sections.js`. **Append** the following AFTER the existing `POD_SECTIONS` constant (do NOT touch any of the prior 5 registries):

```js
export const STATEMENT_SECTIONS = [
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
    id: 'statement_details',
    label: 'Statement Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'as_of_date',     label: 'As of Date',     defaultVisible: true },
      { id: 'account_number', label: 'Account Number', defaultVisible: true },
    ],
  },
  {
    id: 'address_details',
    label: 'Address Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'bill_to', label: 'Bill To', defaultVisible: true },
      { id: 'phone',   label: 'Phone',   defaultVisible: true },
      { id: 'email',   label: 'Email',   defaultVisible: true },
    ],
  },
  {
    id: 'open_invoices',
    label: 'Open Invoices',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'invoice_number',     label: 'Invoice #',         defaultVisible: true },
      { id: 'invoice_date',       label: 'Invoice Date',      defaultVisible: true },
      { id: 'due_date',           label: 'Due Date',          defaultVisible: true },
      { id: 'days_past_due',      label: 'Days Past Due',     defaultVisible: true },
      { id: 'customer_reference', label: 'PO # / Reference',  defaultVisible: true },
      { id: 'original_amount',    label: 'Original',          defaultVisible: true },
      { id: 'balance_due',        label: 'Balance Due',       defaultVisible: true },
    ],
  },
  {
    id: 'aging_summary',
    label: 'Aging Summary',
    defaultVisible: true,
    toggleable: true,
  },
  {
    id: 'total_outstanding',
    label: 'Total Outstanding',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'total', label: 'Total Amount', defaultVisible: true },
    ],
  },
  {
    id: 'notes',
    label: 'Notes',
    defaultVisible: false,
    toggleable: true,
    fields: [
      { id: 'payment_instructions', label: 'Payment Instructions', defaultVisible: true },
      { id: 'custom_notes',         label: 'Custom Notes',         defaultVisible: false },
    ],
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

Then update `SECTIONS_BY_DOCUMENT_TYPE`. After H4's Task 2 it has 6 entries. Add `statement`:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
  combined_invoice: COMBINED_INVOICE_SECTIONS,
  pod: POD_SECTIONS,
  statement: STATEMENT_SECTIONS,
};
```

- [ ] **Step 4: Run new test to verify it passes**

Run: `node --test tests/document-sections-statement-constants.test.mjs`
Expected: PASS — all 13 tests pass.

- [ ] **Step 5: Run existing constant tests to verify no regression**

Run: `node --test tests/document-sections-constants.test.mjs tests/document-sections-invoice-constants.test.mjs tests/document-sections-rate-con-constants.test.mjs tests/document-sections-combined-invoice-constants.test.mjs tests/document-sections-pod-constants.test.mjs`
Expected: PASS — all existing 5 doc-type tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add tests/document-sections-statement-constants.test.mjs lib/constants/document-sections.js
git commit -m "feat(doc-designer): add STATEMENT_SECTIONS registry (FU-035-H5)"
```

---

## Task 3: Validator regression tests for Statement

**Files:**
- Create: `tests/validate-section-config-statement.test.mjs`

The validator at `lib/pdf/validate-section-config.js` is per-doc-type-aware (FU-112). After Task 2, it auto-supports Statement. These tests confirm field-ID isolation across all 6 prior doc types.

- [ ] **Step 1: Write the test file**

Create `tests/validate-section-config-statement.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/pdf/validate-section-config.js';

test("validator accepts bill_to=false on statement's address_details", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { bill_to: false } } } },
    'statement',
  );
  assert.equal(r.ok, true);
});

test("validator REJECTS customer=false on statement (DO-only field)", () => {
  const r = validateSectionConfig(
    { perSection: { address_details: { fields: { customer: false } } } },
    'statement',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown field id/);
  assert.match(r.error, /customer/);
});

test("validator REJECTS billing_notes=false on statement's notes (Invoice-only)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { billing_notes: false } } } },
    'statement',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /billing_notes/);
});

test("validator REJECTS driver_notes=false on statement's notes (POD-only)", () => {
  const r = validateSectionConfig(
    { perSection: { notes: { fields: { driver_notes: false } } } },
    'statement',
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /driver_notes/);
});

test("validator accepts statement_details.as_of_date=false", () => {
  const r = validateSectionConfig(
    { perSection: { statement_details: { fields: { as_of_date: false } } } },
    'statement',
  );
  assert.equal(r.ok, true);
});

test("validator accepts open_invoices.days_past_due=false", () => {
  const r = validateSectionConfig(
    { perSection: { open_invoices: { fields: { days_past_due: false } } } },
    'statement',
  );
  assert.equal(r.ok, true);
});

test('field-ID isolation: statement_details fields rejected on other doc types', () => {
  const payload = { perSection: { statement_details: { fields: { as_of_date: false } } } };
  assert.equal(validateSectionConfig(payload, 'statement').ok,           true);
  assert.equal(validateSectionConfig(payload, 'invoice').ok,             false);
  assert.equal(validateSectionConfig(payload, 'rate_con').ok,            false);
  assert.equal(validateSectionConfig(payload, 'combined_invoice').ok,    false);
  assert.equal(validateSectionConfig(payload, 'pod').ok,                 false);
  assert.equal(validateSectionConfig(payload, 'delivery_order_full').ok, false);
});

test('field-ID isolation: invoice_details fields rejected on statement', () => {
  const payload = { perSection: { invoice_details: { fields: { invoice_number: false } } } };
  assert.equal(validateSectionConfig(payload, 'statement').ok, false);
});

test('field-ID isolation: pod_details fields rejected on statement', () => {
  const payload = { perSection: { pod_details: { fields: { driver_name: false } } } };
  assert.equal(validateSectionConfig(payload, 'statement').ok, false);
});

test('validator accepts a full statement section_config payload', () => {
  const r = validateSectionConfig(
    {
      visibility: { open_invoices: true, aging_summary: true, notes: true },
      perSection: {
        statement_details:  { fields: { as_of_date: true, account_number: false } },
        address_details:    { fields: { bill_to: true, phone: true, email: false } },
        open_invoices:      { fields: { invoice_number: true, due_date: true, days_past_due: true, customer_reference: false, original_amount: true, balance_due: true, invoice_date: true } },
        notes:              { fields: { payment_instructions: true, custom_notes: false } },
      },
      colors: { accent: '#1e40af', text: '#222222' },
    },
    'statement',
  );
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/validate-section-config-statement.test.mjs`
Expected: PASS — all 10 tests pass without any code change. Validator already supports Statement via `getSectionsForDocumentType('statement')`.

- [ ] **Step 3: Commit**

```bash
git add tests/validate-section-config-statement.test.mjs
git commit -m "test(doc-designer): regression tests for validator against STATEMENT_SECTIONS (FU-035-H5)"
```

---

## Task 4: `computeAging()` helper + parity test against `getAgingBucket()`

**Files:**
- Create: `lib/pdf/compute-aging.js`
- Create: `tests/statement-compute-aging.test.mjs`

A pure function that takes an array of `{ due_date, balance_due_cents }` rows + an `asOfDate`, and returns 5-bucket totals: `{ current, days_1_30, days_31_60, days_61_90, days_90_plus }`.

This function MUST agree with `lib/ar-utils.js`'s existing `getAgingBucket(dueDate)` on bucket assignment for any single invoice.

- [ ] **Step 1: Write the failing test**

Create `tests/statement-compute-aging.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeAging } from '../lib/pdf/compute-aging.js';
import { getAgingBucket } from '../lib/ar-utils.js';

const asOf = new Date('2026-04-27T00:00:00Z');

test('computeAging returns zero-bucket object for empty input', () => {
  const r = computeAging([], asOf);
  assert.deepEqual(r, { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 });
});

test('computeAging puts not-yet-due invoice in current bucket', () => {
  const r = computeAging([{ due_date: '2026-05-15', balance_due_cents: 1000 }], asOf);
  assert.equal(r.current, 1000);
  assert.equal(r.days_1_30, 0);
});

test('computeAging puts invoice due 13 days ago in 1-30 bucket', () => {
  const r = computeAging([{ due_date: '2026-04-14', balance_due_cents: 850 }], asOf);
  assert.equal(r.days_1_30, 850);
  assert.equal(r.current, 0);
});

test('computeAging puts invoice due 36 days ago in 31-60 bucket', () => {
  const r = computeAging([{ due_date: '2026-03-22', balance_due_cents: 2100 }], asOf);
  assert.equal(r.days_31_60, 2100);
});

test('computeAging puts invoice due 75 days ago in 61-90 bucket', () => {
  const r = computeAging([{ due_date: '2026-02-11', balance_due_cents: 500 }], asOf);
  assert.equal(r.days_61_90, 500);
});

test('computeAging puts invoice due 113 days ago in 90+ bucket', () => {
  const r = computeAging([{ due_date: '2026-01-04', balance_due_cents: 3250 }], asOf);
  assert.equal(r.days_90_plus, 3250);
});

test('computeAging sums multiple invoices into correct buckets', () => {
  const r = computeAging([
    { due_date: '2026-05-15', balance_due_cents: 1200 },  // current
    { due_date: '2026-04-14', balance_due_cents: 850 },   // 1-30 (13 days)
    { due_date: '2026-03-22', balance_due_cents: 2100 },  // 31-60 (36 days)
    { due_date: '2026-01-04', balance_due_cents: 3250 },  // 90+ (113 days)
  ], asOf);
  assert.deepEqual(r, {
    current: 1200,
    days_1_30: 850,
    days_31_60: 2100,
    days_61_90: 0,
    days_90_plus: 3250,
  });
});

test('boundary: invoice due exactly today is in current bucket (0 days past due)', () => {
  const r = computeAging([{ due_date: '2026-04-27', balance_due_cents: 100 }], asOf);
  assert.equal(r.current, 100);
});

test('boundary: invoice due 30 days ago is in 1-30 bucket', () => {
  const r = computeAging([{ due_date: '2026-03-28', balance_due_cents: 100 }], asOf);
  assert.equal(r.days_1_30, 100);
});

test('boundary: invoice due 31 days ago is in 31-60 bucket', () => {
  const r = computeAging([{ due_date: '2026-03-27', balance_due_cents: 100 }], asOf);
  assert.equal(r.days_31_60, 100);
});

test('boundary: invoice due 60 days ago is in 31-60 bucket', () => {
  const r = computeAging([{ due_date: '2026-02-26', balance_due_cents: 100 }], asOf);
  assert.equal(r.days_31_60, 100);
});

test('boundary: invoice due 61 days ago is in 61-90 bucket', () => {
  const r = computeAging([{ due_date: '2026-02-25', balance_due_cents: 100 }], asOf);
  assert.equal(r.days_61_90, 100);
});

test('boundary: invoice due 90 days ago is in 61-90 bucket', () => {
  const r = computeAging([{ due_date: '2026-01-27', balance_due_cents: 100 }], asOf);
  assert.equal(r.days_61_90, 100);
});

test('boundary: invoice due 91 days ago is in 90+ bucket', () => {
  const r = computeAging([{ due_date: '2026-01-26', balance_due_cents: 100 }], asOf);
  assert.equal(r.days_90_plus, 100);
});

// Parity test against the existing ar-utils helper. Both must classify the
// same invoice into the same bucket. computeAging buckets are summed; getAgingBucket
// returns a per-invoice classification — but the classification must agree.
test('parity: computeAging buckets agree with getAgingBucket() classifications', () => {
  // Build a representative set of invoices spanning all 5 buckets.
  const invs = [
    { due_date: '2026-05-15', balance_due_cents: 100 },  // current (-18)
    { due_date: '2026-04-27', balance_due_cents: 100 },  // current (0)
    { due_date: '2026-04-14', balance_due_cents: 100 },  // 1-30 (13)
    { due_date: '2026-03-28', balance_due_cents: 100 },  // 1-30 (30)
    { due_date: '2026-03-27', balance_due_cents: 100 },  // 31-60 (31)
    { due_date: '2026-02-26', balance_due_cents: 100 },  // 31-60 (60)
    { due_date: '2026-02-25', balance_due_cents: 100 },  // 61-90 (61)
    { due_date: '2026-01-27', balance_due_cents: 100 },  // 61-90 (90)
    { due_date: '2026-01-26', balance_due_cents: 100 },  // 90+ (91)
  ];

  // Use ar-utils to compute expected bucket per-invoice.
  const expected = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
  // Map ar-utils bucket names to our keys.
  // ar-utils returns: 'current' | '1_30' | '31_60' | '61_90' | '90_plus' (per /api/tenant/ar/aging endpoint convention)
  const KEY_MAP = {
    current:   'current',
    '1_30':    'days_1_30',
    '31_60':   'days_31_60',
    '61_90':   'days_61_90',
    '90_plus': 'days_90_plus',
  };
  for (const inv of invs) {
    const { bucket } = getAgingBucket(inv.due_date, asOf);
    const key = KEY_MAP[bucket];
    assert.ok(key, `Unknown bucket from getAgingBucket: ${bucket}`);
    expected[key] += inv.balance_due_cents;
  }

  const actual = computeAging(invs, asOf);
  assert.deepEqual(actual, expected, 'computeAging and getAgingBucket disagree');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/statement-compute-aging.test.mjs`
Expected: FAIL — `computeAging` not exported (import error).

- [ ] **Step 3: Read the existing `getAgingBucket` to confirm signature + bucket names**

Read `lib/ar-utils.js`. Find `getAgingBucket(dueDate)`. Confirm:
1. Bucket return values use the keys: `'current'`, `'1_30'`, `'31_60'`, `'61_90'`, `'90_plus'` (with underscores).
2. The signature accepts a `dueDate` (Date or string) — and optionally a second `asOf` Date argument. If it does NOT accept a second arg, the parity test above must be rewritten to mock `Date.now()` instead.

If the signature DIFFERS from the test's expectation (e.g., it doesn't accept `asOf`), update the parity test to use whatever real interface `getAgingBucket` exposes, OR add a TODO note in the parity test explaining the limitation.

- [ ] **Step 4: Create the helper**

Create `lib/pdf/compute-aging.js`:

```js
/**
 * Compute aging-bucket totals for a Statement of Account.
 *
 * @param {Array<{due_date: string|Date, balance_due_cents: number}>} invoices
 * @param {Date} asOfDate - the reference date for "today"
 * @returns {{current: number, days_1_30: number, days_31_60: number, days_61_90: number, days_90_plus: number}}
 *
 * Bucket definitions (must agree with lib/ar-utils.js's getAgingBucket):
 *   current:      due_date >= asOfDate                  (0 or negative days past due)
 *   days_1_30:    1 <= daysPastDue <= 30
 *   days_31_60:   31 <= daysPastDue <= 60
 *   days_61_90:   61 <= daysPastDue <= 90
 *   days_90_plus: daysPastDue > 90
 *
 * Returned amounts are in CENTS (matches invoice.balance_due_cents).
 *
 * NOTE: This duplicates per-invoice classification logic from lib/ar-utils.js.
 * tests/statement-compute-aging.test.mjs has a parity test that asserts both
 * helpers agree. Cleanup-FU FU-035-H5-followup-E will factor into a single
 * shared helper.
 */
export function computeAging(invoices, asOfDate) {
  const buckets = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  };

  const ms = 1000 * 60 * 60 * 24;
  const asOfTs = asOfDate.getTime();

  for (const inv of invoices || []) {
    const due = new Date(inv.due_date);
    const daysPastDue = Math.floor((asOfTs - due.getTime()) / ms);
    const cents = inv.balance_due_cents || 0;

    if (daysPastDue <= 0)        buckets.current      += cents;
    else if (daysPastDue <= 30)  buckets.days_1_30    += cents;
    else if (daysPastDue <= 60)  buckets.days_31_60   += cents;
    else if (daysPastDue <= 90)  buckets.days_61_90   += cents;
    else                         buckets.days_90_plus += cents;
  }

  return buckets;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/statement-compute-aging.test.mjs`
Expected: PASS — all 15 tests pass (including parity).

If the parity test fails, the bucket boundaries between `computeAging` and `getAgingBucket` disagree. Read `lib/ar-utils.js`, find the discrepancy, and fix `computeAging` to match. Do NOT modify `lib/ar-utils.js` — that touches the live AR aging dashboard.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf/compute-aging.js tests/statement-compute-aging.test.mjs
git commit -m "feat(pdf): computeAging() helper for Statement aging-bucket totals (FU-035-H5)"
```

---

## Task 5: Create sample-data-statement.js + register in DocumentPreview

**Files:**
- Create: `lib/document-designer/sample-data-statement.js`
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Create the new statement sample data file**

Create `lib/document-designer/sample-data-statement.js`:

```js
// Mirror this shape against buildSectionData() in lib/pdf/build-statement-section-data.js —
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
  statement_details: {
    as_of_date: 'Apr 27, 2026',
    account_number: 'CUST-WMT-0042',
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
    pickup_location: null,
    delivery_location: null,
    return_location: null,
    appointment_times: null,
    is_operational_street_turn: false,
  },
  open_invoices: [
    { invoice_id: 'inv-1', invoice_number: 'INV-2026-001', invoice_date: 'Apr 18, 2026', due_date: 'May 18, 2026', days_past_due: -21, customer_reference: 'PO-99821', original_amount_cents: 120000, balance_due_cents: 120000 },
    { invoice_id: 'inv-2', invoice_number: 'INV-2026-005', invoice_date: 'Mar 15, 2026', due_date: 'Apr 14, 2026', days_past_due: 13,  customer_reference: 'PO-99750', original_amount_cents: 247500, balance_due_cents: 85000  },
    { invoice_id: 'inv-3', invoice_number: 'INV-2026-007', invoice_date: 'Feb 28, 2026', due_date: 'Mar 30, 2026', days_past_due: 28,  customer_reference: 'PO-99701', original_amount_cents: 184000, balance_due_cents: 184000 },
    { invoice_id: 'inv-4', invoice_number: 'INV-2026-009', invoice_date: 'Feb 20, 2026', due_date: 'Mar 22, 2026', days_past_due: 36,  customer_reference: 'PO-99680', original_amount_cents: 210000, balance_due_cents: 210000 },
    { invoice_id: 'inv-5', invoice_number: 'INV-2025-127', invoice_date: 'Dec 5, 2025',  due_date: 'Jan 4, 2026',  days_past_due: 113, customer_reference: 'PO-99412', original_amount_cents: 325000, balance_due_cents: 325000 },
  ],
  aging: {
    current: 120000,
    days_1_30: 85000,
    days_31_60: 394000,
    days_61_90: 0,
    days_90_plus: 325000,
  },
  total_outstanding_cents: 924000,
  notes: {
    payment_instructions: 'Please remit to: Your Company, 123 Main Street, City, ST 12345.',
    custom_notes: '',
  },
  disclaimer: {
    text: 'Terms & Conditions text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
```

- [ ] **Step 2: Register the new sample in DocumentPreview.js**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Find the imports section. After the existing 5 sample-data imports (the most recent being `sampleDataPod`), add:

```js
import sampleDataStatement        from '../../../../lib/document-designer/sample-data-statement';
```

Then find the `SAMPLE_BY_DOCUMENT_TYPE` map and add the `statement` entry:

```js
const SAMPLE_BY_DOCUMENT_TYPE = {
  delivery_order_full:      sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice:                  sampleDataInvoice,
  rate_con:                 sampleDataRateCon,
  combined_invoice:         sampleDataCombinedInvoice,
  pod:                      sampleDataPod,
  statement:                sampleDataStatement,
};
```

Also update the JSDoc comment block to add `'statement'` to the union (after `'pod'`) — same shape change made for `'pod'` in H4 Task 8 fix:

```
 * `documentType`: 'delivery_order_full' | 'delivery_order_next_move' | 'invoice'
 *                 | 'rate_con' | 'combined_invoice' | 'pod' | 'statement'
 *                 — picks the per-doc-type sample data slice
```

- [ ] **Step 3: Commit**

```bash
git add lib/document-designer/sample-data-statement.js components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): add Statement sample data + DocumentPreview registration (FU-035-H5)"
```

---

## Task 6: Build `StatementDetails` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/StatementDetails.js`
- Create: `components/settings/document-designer/preview/StatementDetailsPreview.js`

2-field 3-col grid (one cell empty for visual symmetry — matches PodDetails / RateConDetails 3-col pattern).

- [ ] **Step 1: Create StatementDetails.js (PDF)**

Create `components/pdf/sections/StatementDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Statement Details section — 2 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values. Mirrors PodDetails.js's structure.
 *
 * `data` shape: { as_of_date, account_number }
 * `opts.fields`: { as_of_date, account_number }
 */
const FIELD_ORDER = [
  ['as_of_date',     'As of Date'],
  ['account_number', 'Account Number'],
];

export default function StatementDetails({ data, opts, colors }) {
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

- [ ] **Step 2: Create StatementDetailsPreview.js (HTML)**

Create `components/settings/document-designer/preview/StatementDetailsPreview.js`:

```js
/**
 * HTML preview of Statement Details. Mirrors components/pdf/sections/StatementDetails.js.
 * 3-col label-value grid; skips empty values.
 */
const FIELD_ORDER = [
  ['as_of_date',     'As of Date'],
  ['account_number', 'Account Number'],
];

export default function StatementDetailsPreview({ data, opts, colors }) {
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

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass (only pre-existing fire-trigger failure).

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/StatementDetails.js components/settings/document-designer/preview/StatementDetailsPreview.js
git commit -m "feat(pdf): StatementDetails section component (PDF + HTML preview) (FU-035-H5)"
```

---

## Task 7: Build `OpenInvoicesTable` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/OpenInvoicesTable.js`
- Create: `components/settings/document-designer/preview/OpenInvoicesTablePreview.js`

Accent-banded header + 7-column table. Color-coded "Days Past Due" cell. Empty-state row.

- [ ] **Step 1: Create OpenInvoicesTable.js (PDF)**

Create `components/pdf/sections/OpenInvoicesTable.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

const styles = {
  section:    { marginBottom: 12 },
  band:       { paddingHorizontal: 4, paddingVertical: 3, marginBottom: 4 },
  bandText:   { color: 'white', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' },
  headerRow:  { flexDirection: 'row', backgroundColor: defaultColors.tableHeader, paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: defaultColors.border },
  row:        { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: defaultColors.border },
  headerText: { fontWeight: 'bold', fontSize: 8, color: defaultColors.muted, textTransform: 'uppercase' },
  emptyRow:   { paddingVertical: 12, paddingHorizontal: 4, color: defaultColors.muted, fontStyle: 'italic', textAlign: 'center', fontSize: 10 },
};

// Column widths sum to 100% — order must match OpenInvoicesTablePreview's <colgroup>
const COLUMNS = [
  { key: 'invoice_number',     label: 'Invoice #',         width: '14%', align: 'left'  },
  { key: 'invoice_date',       label: 'Inv. Date',         width: '11%', align: 'left'  },
  { key: 'due_date',           label: 'Due Date',          width: '11%', align: 'left'  },
  { key: 'days_past_due',      label: 'Days Past Due',     width: '14%', align: 'right' },
  { key: 'customer_reference', label: 'PO #',              width: '14%', align: 'left'  },
  { key: 'original_amount',    label: 'Original',          width: '13%', align: 'right' },
  { key: 'balance_due',        label: 'Balance Due',       width: '23%', align: 'right' },
];

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function daysPastDueColor(daysPastDue) {
  if (daysPastDue == null)   return '#374151';   // gray (data missing)
  if (daysPastDue <= 0)      return '#059669';   // green (current)
  if (daysPastDue <= 30)     return '#d97706';   // amber
  if (daysPastDue <= 90)     return '#dc2626';   // red
  return '#7f1d1d';                              // dark red (90+)
}

function daysPastDueLabel(daysPastDue) {
  if (daysPastDue == null) return '—';
  if (daysPastDue <= 0)    return 'Current';
  return `${daysPastDue} days`;
}

/**
 * Open Invoices section — list of unpaid invoices. Color-codes the
 * "Days Past Due" cell (green/amber/red/dark-red). Honors per-column
 * toggles via opts.fields[col.key].
 *
 * `data` shape: Array<{
 *   invoice_id, invoice_number, invoice_date, due_date,
 *   days_past_due, customer_reference,
 *   original_amount_cents, balance_due_cents
 * }>
 * `opts.fields`: { invoice_number, invoice_date, due_date, days_past_due,
 *                  customer_reference, original_amount, balance_due }
 */
export default function OpenInvoicesTable({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';
  const fields = opts?.fields || {};
  const visibleCols = COLUMNS.filter((c) => fields[c.key] !== false);

  if (visibleCols.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Open Invoices</Text>
      </View>

      <View style={styles.headerRow}>
        {visibleCols.map((c) => (
          <Text
            key={c.key}
            style={[styles.headerText, { width: c.width, textAlign: c.align, paddingHorizontal: 2 }]}
          >
            {c.label}
          </Text>
        ))}
      </View>

      {data.length === 0 ? (
        <Text style={styles.emptyRow}>(No outstanding invoices)</Text>
      ) : (
        data.map((inv, idx) => (
          <View key={inv.invoice_id || idx} style={styles.row}>
            {visibleCols.map((c) => {
              let value = '—';
              let cellStyle = { color: '#111827', fontWeight: 'normal' };
              switch (c.key) {
                case 'invoice_number':
                  value = inv.invoice_number || '—';
                  cellStyle = { color: '#111827', fontWeight: 'bold' };
                  break;
                case 'invoice_date':
                  value = inv.invoice_date || '—';
                  cellStyle = { color: '#374151' };
                  break;
                case 'due_date':
                  value = inv.due_date || '—';
                  cellStyle = { color: '#374151' };
                  break;
                case 'days_past_due':
                  value = daysPastDueLabel(inv.days_past_due);
                  cellStyle = { color: daysPastDueColor(inv.days_past_due), fontWeight: 'bold' };
                  break;
                case 'customer_reference':
                  value = inv.customer_reference || '—';
                  cellStyle = { color: '#374151' };
                  break;
                case 'original_amount':
                  value = fmtDollars(inv.original_amount_cents);
                  cellStyle = { color: '#374151' };
                  break;
                case 'balance_due':
                  value = fmtDollars(inv.balance_due_cents);
                  cellStyle = { color: '#111827', fontWeight: 'bold' };
                  break;
              }
              return (
                <Text
                  key={c.key}
                  style={[
                    { width: c.width, textAlign: c.align, paddingHorizontal: 2, fontSize: 9 },
                    cellStyle,
                  ]}
                >
                  {value}
                </Text>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}
```

- [ ] **Step 2: Create OpenInvoicesTablePreview.js (HTML)**

Create `components/settings/document-designer/preview/OpenInvoicesTablePreview.js`:

```js
/**
 * HTML preview of Open Invoices. Mirrors components/pdf/sections/OpenInvoicesTable.js.
 * Accent-banded header + 7-column table with color-coded Days Past Due cell.
 */
const COLUMNS = [
  { key: 'invoice_number',     label: 'Invoice #',     align: 'left'  },
  { key: 'invoice_date',       label: 'Inv. Date',     align: 'left'  },
  { key: 'due_date',           label: 'Due Date',      align: 'left'  },
  { key: 'days_past_due',      label: 'Days Past Due', align: 'right' },
  { key: 'customer_reference', label: 'PO #',          align: 'left'  },
  { key: 'original_amount',    label: 'Original',      align: 'right' },
  { key: 'balance_due',        label: 'Balance Due',   align: 'right' },
];

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function daysPastDueColor(daysPastDue) {
  if (daysPastDue == null)   return '#374151';
  if (daysPastDue <= 0)      return '#059669';
  if (daysPastDue <= 30)     return '#d97706';
  if (daysPastDue <= 90)     return '#dc2626';
  return '#7f1d1d';
}

function daysPastDueLabel(daysPastDue) {
  if (daysPastDue == null) return '—';
  if (daysPastDue <= 0)    return 'Current';
  return `${daysPastDue} days`;
}

export default function OpenInvoicesTablePreview({ data, opts, colors }) {
  if (!Array.isArray(data)) return null;
  const accent = colors?.accent || '#3B82F6';
  const fields = opts?.fields || {};
  const visibleCols = COLUMNS.filter((c) => fields[c.key] !== false);
  if (visibleCols.length === 0) return null;

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Open Invoices
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {visibleCols.map((c) => (
              <th
                key={c.key}
                className="px-2 py-1.5 font-bold uppercase text-gray-600 text-[9px] tracking-wider"
                style={{ textAlign: c.align }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={visibleCols.length} className="text-center italic text-gray-500 py-3">
                (No outstanding invoices)
              </td>
            </tr>
          ) : (
            data.map((inv, idx) => (
              <tr key={inv.invoice_id || idx} className="border-b border-gray-100">
                {visibleCols.map((c) => {
                  let value = '—';
                  let cellClass = 'px-2 py-1.5';
                  let cellStyle = { textAlign: c.align };
                  switch (c.key) {
                    case 'invoice_number':
                      value = inv.invoice_number || '—';
                      cellClass += ' font-bold text-gray-900';
                      break;
                    case 'invoice_date':
                      value = inv.invoice_date || '—';
                      cellClass += ' text-gray-700';
                      break;
                    case 'due_date':
                      value = inv.due_date || '—';
                      cellClass += ' text-gray-700';
                      break;
                    case 'days_past_due':
                      value = daysPastDueLabel(inv.days_past_due);
                      cellClass += ' font-bold';
                      cellStyle = { ...cellStyle, color: daysPastDueColor(inv.days_past_due) };
                      break;
                    case 'customer_reference':
                      value = inv.customer_reference || '—';
                      cellClass += ' text-gray-700';
                      break;
                    case 'original_amount':
                      value = fmtDollars(inv.original_amount_cents);
                      cellClass += ' text-gray-700';
                      break;
                    case 'balance_due':
                      value = fmtDollars(inv.balance_due_cents);
                      cellClass += ' font-bold text-gray-900';
                      break;
                  }
                  return (
                    <td key={c.key} className={cellClass} style={cellStyle}>
                      {value}
                    </td>
                  );
                })}
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

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/OpenInvoicesTable.js components/settings/document-designer/preview/OpenInvoicesTablePreview.js
git commit -m "feat(pdf): OpenInvoicesTable section component (PDF + HTML preview) (FU-035-H5)"
```

---

## Task 8: Build `AgingSummary` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/AgingSummary.js`
- Create: `components/settings/document-designer/preview/AgingSummaryPreview.js`

Horizontal 5-bucket grid with color-coordinated panels. Master toggle only (no leaf fields).

- [ ] **Step 1: Create AgingSummary.js (PDF)**

Create `components/pdf/sections/AgingSummary.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { colors as defaultColors } from '../shared/typography';

/**
 * Aging Summary — 5-bucket horizontal grid. Each bucket: label + amount.
 * Master toggle only; no leaf field toggles (the 5 buckets are fixed by
 * the lib/pdf/compute-aging.js helper).
 *
 * `data` shape: { current, days_1_30, days_31_60, days_61_90, days_90_plus }
 *   All cents.
 */
const BUCKETS = [
  { key: 'current',      label: 'Current',     bg: '#ecfdf5', border: '#a7f3d0', textLight: '#059669', textDark: '#065f46' },
  { key: 'days_1_30',    label: '1-30 Days',   bg: '#fffbeb', border: '#fde68a', textLight: '#d97706', textDark: '#92400e' },
  { key: 'days_31_60',   label: '31-60 Days',  bg: '#fef2f2', border: '#fecaca', textLight: '#dc2626', textDark: '#991b1b' },
  { key: 'days_61_90',   label: '61-90 Days',  bg: '#f9fafb', border: '#e5e7eb', textLight: '#6b7280', textDark: '#9ca3af' },
  { key: 'days_90_plus', label: '90+ Days',    bg: '#fef2f2', border: '#dc2626', textLight: '#7f1d1d', textDark: '#7f1d1d', emphasized: true },
];

const styles = {
  section: { marginBottom: 12 },
  band: { paddingHorizontal: 4, paddingVertical: 3, marginBottom: 4 },
  bandText: { color: 'white', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' },
  grid: { flexDirection: 'row', gap: 6 },
  bucket: { flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 4, alignItems: 'center' },
  bucketLabel: { fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 2 },
  bucketAmount: { fontSize: 10, fontWeight: 'bold' },
};

function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function AgingSummary({ data, opts, colors }) {
  if (!data) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <View style={styles.section}>
      <View style={[styles.band, { backgroundColor: accent }]}>
        <Text style={styles.bandText}>Aging Summary</Text>
      </View>
      <View style={styles.grid}>
        {BUCKETS.map((b) => {
          const cents = data[b.key] || 0;
          const bucketStyle = {
            ...styles.bucket,
            backgroundColor: b.bg,
            borderWidth: b.emphasized ? 2 : 1,
            borderColor: b.border,
          };
          return (
            <View key={b.key} style={bucketStyle}>
              <Text style={[styles.bucketLabel, { color: b.textLight }]}>{b.label}</Text>
              <Text style={[styles.bucketAmount, { color: b.textDark }]}>{fmtDollars(cents)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create AgingSummaryPreview.js (HTML)**

Create `components/settings/document-designer/preview/AgingSummaryPreview.js`:

```js
/**
 * HTML preview of Aging Summary. Mirrors components/pdf/sections/AgingSummary.js.
 */
const BUCKETS = [
  { key: 'current',      label: 'Current',     bg: '#ecfdf5', border: '#a7f3d0', textLight: '#059669', textDark: '#065f46' },
  { key: 'days_1_30',    label: '1-30 Days',   bg: '#fffbeb', border: '#fde68a', textLight: '#d97706', textDark: '#92400e' },
  { key: 'days_31_60',   label: '31-60 Days',  bg: '#fef2f2', border: '#fecaca', textLight: '#dc2626', textDark: '#991b1b' },
  { key: 'days_61_90',   label: '61-90 Days',  bg: '#f9fafb', border: '#e5e7eb', textLight: '#6b7280', textDark: '#9ca3af' },
  { key: 'days_90_plus', label: '90+ Days',    bg: '#fef2f2', border: '#dc2626', textLight: '#7f1d1d', textDark: '#7f1d1d', emphasized: true },
];

function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function AgingSummaryPreview({ data, opts, colors }) {
  if (!data) return null;
  const accent = colors?.accent || '#3B82F6';

  return (
    <div className="mb-4">
      <div
        className="px-2 py-1 mb-1 text-[10px] uppercase tracking-wider font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        Aging Summary
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {BUCKETS.map((b) => {
          const cents = data[b.key] || 0;
          return (
            <div
              key={b.key}
              className="text-center py-2 px-1.5 rounded"
              style={{
                backgroundColor: b.bg,
                border: `${b.emphasized ? 2 : 1}px solid ${b.border}`,
              }}
            >
              <div
                className="text-[9px] uppercase font-bold tracking-wider mb-0.5"
                style={{ color: b.textLight }}
              >
                {b.label}
              </div>
              <div className="text-[12px] font-bold" style={{ color: b.textDark }}>
                {fmtDollars(cents)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run all tests**

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/AgingSummary.js components/settings/document-designer/preview/AgingSummaryPreview.js
git commit -m "feat(pdf): AgingSummary section component (PDF + HTML preview) (FU-035-H5)"
```

---

## Task 9: Build `TotalOutstanding` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/TotalOutstanding.js`
- Create: `components/settings/document-designer/preview/TotalOutstandingPreview.js`

Right-aligned accent-bg panel with single label + currency.

- [ ] **Step 1: Create TotalOutstanding.js (PDF)**

Create `components/pdf/sections/TotalOutstanding.js`:

```js
import { View, Text } from '@react-pdf/renderer';

/**
 * Total Outstanding — single right-aligned panel with accent background.
 * `data` shape: { total_outstanding_cents }  (cents)
 * `opts.fields.total`: false → render nothing.
 */
function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function TotalOutstanding({ data, opts, colors }) {
  if (!data) return null;
  if (opts?.fields?.total === false) return null;
  const accent = colors?.accent || '#1e40af';
  const cents = data.total_outstanding_cents ?? 0;

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 }}>
      <View
        style={{
          backgroundColor: accent,
          paddingHorizontal: 18,
          paddingVertical: 10,
          minWidth: 280,
          borderRadius: 4,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Text
          style={{
            color: 'white',
            fontSize: 9,
            fontWeight: 'bold',
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}
        >
          Total Outstanding
        </Text>
        <Text style={{ color: 'white', fontSize: 16, fontWeight: 'bold' }}>
          {fmtDollars(cents)}
        </Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create TotalOutstandingPreview.js (HTML)**

Create `components/settings/document-designer/preview/TotalOutstandingPreview.js`:

```js
/**
 * HTML preview of Total Outstanding. Mirrors components/pdf/sections/TotalOutstanding.js.
 */
function fmtDollars(cents) {
  if (cents == null) return '$0.00';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function TotalOutstandingPreview({ data, opts, colors }) {
  if (!data) return null;
  if (opts?.fields?.total === false) return null;
  const accent = colors?.accent || '#1e40af';
  const cents = data.total_outstanding_cents ?? 0;

  return (
    <div className="flex justify-end mb-4">
      <div
        className="rounded px-5 py-2.5 min-w-[280px] flex justify-between items-center"
        style={{ backgroundColor: accent }}
      >
        <div className="text-white text-[11px] uppercase tracking-wider font-bold">
          Total Outstanding
        </div>
        <div className="text-white text-[18px] font-bold">{fmtDollars(cents)}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run all tests**

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/TotalOutstanding.js components/settings/document-designer/preview/TotalOutstandingPreview.js
git commit -m "feat(pdf): TotalOutstanding section component (PDF + HTML preview) (FU-035-H5)"
```

---

## Task 10: Wire `statement` in DocumentPreview (register previews + address_details override)

**Files:**
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

- [ ] **Step 1: Register the 4 new preview components**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Add 4 imports near the other preview imports (after `AttachedDocumentsPreview`):

```js
import StatementDetailsPreview      from './StatementDetailsPreview';
import OpenInvoicesTablePreview     from './OpenInvoicesTablePreview';
import AgingSummaryPreview          from './AgingSummaryPreview';
import TotalOutstandingPreview      from './TotalOutstandingPreview';
```

Find the `PREVIEW_BY_SECTION_ID` map. After H4's Task 8 it has 14 entries. Add 4 entries:
- `statement_details` (between `pod_details` and `address_details`)
- `open_invoices` (between `attached_documents` and `charge_details`)
- `aging_summary` (after `charge_details`)
- `total_outstanding` (after `aging_summary`)

```js
const PREVIEW_BY_SECTION_ID = {
  header:                 HeaderPreview,
  delivery_order_details: DeliveryOrderDetailsPreview,
  invoice_details:        InvoiceDetailsPreview,
  rate_con_details:       RateConDetailsPreview,
  pod_details:            PodDetailsPreview,
  statement_details:      StatementDetailsPreview,
  address_details:        AddressDetailsPreview,
  loads_summary:          LoadsSummaryPreview,
  order_details:          OrderDetailsPreview,
  commodity_details:      CommodityDetailsPreview,
  attached_documents:     AttachedDocumentsPreview,
  open_invoices:          OpenInvoicesTablePreview,
  charge_details:         ChargeDetailsPreview,
  aging_summary:          AgingSummaryPreview,
  total_outstanding:      TotalOutstandingPreview,
  notes:                  NotesPreview,
  signature:              SignaturePreview,
  disclaimer:             DisclaimerPreview,
};
```

- [ ] **Step 2: Add per-doc-type override block for `statement`'s address_details**

In the same file, find the section-render loop with the existing per-doc-type override blocks. After the existing `pod` override block, add:

```js
if (s.id === 'address_details' && documentType === 'statement') {
  // Same field-ID translation as Invoice / Combined Invoice / POD.
  // STATEMENT_SECTIONS uses bill_to; AddressDetailsPreview reads opts.fields.customer.
  // Mirrored in components/pdf/StatementTemplate.js renderSection() for the print path.
  opts.customerLabel = 'Bill To';
  opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
}
```

- [ ] **Step 3: Run all tests**

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): preview wires statement section overrides (FU-035-H5)"
```

---

## Task 11: Build `buildSectionData` for Statement + tests

**Files:**
- Create: `lib/pdf/build-statement-section-data.js`
- Create: `tests/statement-build-section-data.test.mjs`

Per H1's lesson learned, `buildSectionData` lives in `lib/pdf/` so the unit test runs under bare Node without a JSX transformer.

- [ ] **Step 1: Write the failing test**

Create `tests/statement-build-section-data.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/statement-build-section-data.test.mjs`
Expected: FAIL — `buildSectionData` not exported (import error).

- [ ] **Step 3: Create the helper**

Create `lib/pdf/build-statement-section-data.js`:

```js
/**
 * Build per-section data subsets for the Statement composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner. Same pattern as
 * lib/pdf/build-{invoice,rate-con,combined-invoice,pod}-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/StatementTemplate.js).
 */
export function buildSectionData(doc) {
  const meta = doc.statement_meta || {};
  const notes = doc.notes || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    statement_details: {
      as_of_date:     meta.as_of_date     ?? null,
      account_number: meta.account_number ?? null,
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
      // Statement has no per-load locations.
      pickup_location: null,
      delivery_location: null,
      return_location: null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    open_invoices: doc.open_invoices || [],
    aging_summary: doc.aging || { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 },
    total_outstanding: {
      total_outstanding_cents: doc.total_outstanding_cents ?? 0,
    },
    notes: {
      payment_instructions: notes.payment_instructions ?? null,
      custom_notes:         notes.custom_notes         ?? null,
    },
    disclaimer: doc.section_config?.disclaimer?.enabled
      ? { text: doc.section_config.disclaimer.text || '' }
      : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/statement-build-section-data.test.mjs`
Expected: PASS — 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/build-statement-section-data.js tests/statement-build-section-data.test.mjs
git commit -m "feat(pdf): buildSectionData for Statement + tests (FU-035-H5)"
```

---

## Task 12: Build `fetchStatementData` + `renderStatementPdf`

**Files:**
- Create: `lib/pdf/render-statement.js`

NEW renderer module. Fetches customer + open invoices + tenant info. Uses `computeAging()` from Task 4 to bucket. Coerces `asOfDate` argument.

- [ ] **Step 1: Create render-statement.js**

Create `lib/pdf/render-statement.js`:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import StatementTemplate from '../../components/pdf/StatementTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';
import { computeAging } from './compute-aging';

/**
 * Compute days past due for a single invoice given an asOfDate.
 */
function computeDaysPastDue(dueDate, asOfDate) {
  const ms = 1000 * 60 * 60 * 24;
  const due = new Date(dueDate);
  return Math.floor((asOfDate.getTime() - due.getTime()) / ms);
}

/**
 * Pick a display "account number" for the customer. Preference order:
 *   1. customer.short_name (if set)
 *   2. CUST-{first 8 chars of customer.id}
 */
function resolveAccountNumber(customer) {
  if (!customer) return null;
  if (customer.short_name) return customer.short_name;
  if (customer.id) return `CUST-${customer.id.slice(0, 8).toUpperCase()}`;
  return null;
}

/**
 * Fetch Statement data for a customer + asOfDate and shape it for the composer.
 * Returns null if the customer doesn't exist for this tenant.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {string|Date|null} asOfDate - ISO 'YYYY-MM-DD' or Date; default = now
 */
export async function fetchStatementData(svc, customerId, tenantId, asOfDate) {
  const asOf = asOfDate ? new Date(asOfDate) : new Date();

  // 1. Customer (1 query)
  const { data: customer, error: custErr } = await svc
    .from('customers')
    .select(`
      id, name, short_name, address_line1, address_line2, city, state, zip,
      billing_email, phone
    `)
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (custErr) throw new Error(`Customer fetch failed: ${custErr.message}`);
  if (!customer) return null;

  // 2. Open invoices (1 query, filtered)
  const asOfIso = asOf.toISOString().slice(0, 10);  // YYYY-MM-DD
  const { data: invoices, error: invErr } = await svc
    .from('invoices')
    .select(`
      id, invoice_number, customer_reference,
      invoice_date, due_date, payment_terms_days,
      total_amount_cents, balance_due_cents,
      status, is_consolidated
    `)
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .is('deleted_at', null)
    .not('status', 'in', '("void","draft")')
    .gt('balance_due_cents', 0)
    .lte('invoice_date', asOfIso)
    .order('invoice_date', { ascending: true });

  if (invErr) throw new Error(`Invoices fetch failed: ${invErr.message}`);

  const openInvoices = (invoices || []).map((inv) => ({
    invoice_id:            inv.id,
    invoice_number:        inv.invoice_number,
    invoice_date:          formatDate(inv.invoice_date),
    due_date:              formatDate(inv.due_date),
    days_past_due:         computeDaysPastDue(inv.due_date, asOf),
    customer_reference:    inv.customer_reference,
    original_amount_cents: inv.total_amount_cents,
    balance_due_cents:     inv.balance_due_cents,
  }));

  // 3. Aging — pure JS
  const aging = computeAging(invoices || [], asOf);
  const totalOutstandingCents = (invoices || []).reduce((sum, i) => sum + (i.balance_due_cents || 0), 0);

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
    customer_id: customer.id,
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: {
      name:          customer.name,
      address_line1: customer.address_line1,
      address_line2: customer.address_line2,
      city:          customer.city,
      state:         customer.state,
      zip:           customer.zip,
    },
    customer_contact: {
      phone: customer.phone,
      email: customer.billing_email,
    },
    customer_account_number: resolveAccountNumber(customer),
    bill_to_customer_id: customer.id,
    statement_meta: {
      as_of_date:     formatDate(asOf),
      account_number: resolveAccountNumber(customer),
    },
    open_invoices: openInvoices,
    aging,
    total_outstanding_cents: totalOutstandingCents,
  };
}

/**
 * Fetch Statement data + render as PDF Buffer.
 *
 * @param {SupabaseClient} svc
 * @param {string} customerId
 * @param {string} tenantId
 * @param {string|Date|null} asOfDate
 * @returns {Promise<Buffer>}
 * @throws {Error} 'Customer not found' if missing or wrong tenant
 */
export async function renderStatementPdf(svc, customerId, tenantId, asOfDate) {
  const doc = await fetchStatementData(svc, customerId, tenantId, asOfDate);
  if (!doc) throw new Error('Customer not found');

  const sectionConfig = await resolveTemplateConfig(
    svc, tenantId, doc.bill_to_customer_id, 'statement'
  );

  return await renderToBuffer(
    React.createElement(StatementTemplate, { doc, sectionConfig })
  );
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/*.mjs`
Expected: PASS — all existing tests continue to pass. Note: `StatementTemplate` doesn't exist yet (Task 13) — but the static import only fails at JSX time inside `renderStatementPdf`, which isn't called by any test.

- [ ] **Step 3: Commit**

```bash
git add lib/pdf/render-statement.js
git commit -m "feat(pdf): fetchStatementData + cascade-aware renderStatementPdf (FU-035-H5)"
```

---

## Task 13: Build `StatementTemplate.js` composer

**Files:**
- Create: `components/pdf/StatementTemplate.js`

This is the keystone integration step. After this commits, `renderStatementPdf` produces a working PDF.

- [ ] **Step 1: Create components/pdf/StatementTemplate.js**

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
import { buildSectionData } from '../../lib/pdf/build-statement-section-data';

import Header             from './sections/Header';
import StatementDetails   from './sections/StatementDetails';
import AddressDetails     from './sections/AddressDetails';
import OpenInvoicesTable  from './sections/OpenInvoicesTable';
import AgingSummary       from './sections/AgingSummary';
import TotalOutstanding   from './sections/TotalOutstanding';
import Notes              from './sections/Notes';
import Disclaimer         from './sections/Disclaimer';
import DocumentFooter     from './sections/DocumentFooter';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-statement-section-data';

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
    case 'statement_details':
      return <StatementDetails data={sectionData.statement_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: STATEMENT_SECTIONS uses `bill_to`; AddressDetails reads
      // `opts.fields.customer` internally. Per-doc-type "Bill To" label is supplied via
      // opts.customerLabel here. Mirrored in DocumentPreview.js for the live HTML
      // preview path — keep the two in sync.
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'open_invoices':
      return <OpenInvoicesTable data={sectionData.open_invoices} opts={opts} colors={colors} />;
    case 'aging_summary':
      return <AgingSummary data={sectionData.aging_summary} opts={opts} colors={colors} />;
    case 'total_outstanding':
      return <TotalOutstanding data={sectionData.total_outstanding} opts={opts} colors={colors} />;
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

export default function StatementTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('statement');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = { variant: 'statement', title: 'STATEMENT', subtitle: 'OF ACCOUNT' };

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

Run: `node --test tests/*.mjs`
Expected: PASS — all tests pass except the pre-existing fire-trigger-entity-aware failure.

- [ ] **Step 3: Commit**

```bash
git add components/pdf/StatementTemplate.js
git commit -m "feat(pdf): StatementTemplate composer (FU-035-H5)"
```

---

## Task 14: Build the download endpoint

**Files:**
- Create: `pages/api/tenant/pdf/statement/[customerId].js`

NEW endpoint: `GET /api/tenant/pdf/statement/[customerId]?asOfDate=YYYY-MM-DD` returns the rendered Statement as `application/pdf`.

- [ ] **Step 1: Create the endpoint**

Create `pages/api/tenant/pdf/statement/[customerId].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderStatementPdf } from '../../../../../lib/pdf/render-statement';

export const config = {
  runtime: 'nodejs',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res
  )) return;

  const { customerId } = req.query;
  const asOfDate = req.query.asOfDate || null;  // 'YYYY-MM-DD' or undefined
  const svc = getServiceClient();

  try {
    const buffer = await renderStatementPdf(svc, customerId, ctx.tenantId, asOfDate);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${customerId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Customer not found') {
      return res.status(404).json({ error: 'Customer not found' });
    }
    console.error(`Statement ${customerId} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/*.mjs`
Expected: PASS — all existing tests continue to pass. The new endpoint isn't covered by unit tests; manual smoke verifies in Task 16.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/pdf/statement/[customerId].js
git commit -m "feat(api): GET /api/tenant/pdf/statement/[customerId] download endpoint (FU-035-H5)"
```

---

## Task 15: Add "Generate Statement" button on organization detail page

**Files:**
- Create: `components/organizations/GenerateStatementModal.js`
- Modify: `pages/organizations/[id].js`

A small modal launched from the organization header: as-of-date picker (default: today) + "Download PDF" button that opens the API URL in a new tab.

- [ ] **Step 1: Create the modal**

Create `components/organizations/GenerateStatementModal.js`:

```js
import { useState, useEffect } from 'react';
import { X, FileText, Download } from 'lucide-react';

/**
 * Modal that lets the user pick an as-of-date and download a Statement PDF
 * for a customer. Renders nothing when isOpen=false.
 *
 * Props:
 *   - isOpen: boolean
 *   - onClose: () => void
 *   - customerId: uuid
 *   - customerName: string (for the modal title)
 */
export default function GenerateStatementModal({ isOpen, onClose, customerId, customerName }) {
  const today = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD
  const [asOfDate, setAsOfDate] = useState(today);

  // Reset on open
  useEffect(() => {
    if (isOpen) setAsOfDate(today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const downloadUrl = `/api/tenant/pdf/statement/${customerId}?asOfDate=${asOfDate}`;

  function handleDownload() {
    window.open(downloadUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" strokeWidth={1.75} />
            <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
              Generate Statement
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
          Generate a Statement of Account for <strong>{customerName}</strong> showing all
          outstanding invoices as of the chosen date.
        </p>

        <label className="block mb-4">
          <span className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1 uppercase tracking-wider">
            As of Date
          </span>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            max={today}
            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            <Download className="w-4 h-4" strokeWidth={2} />
            Download PDF
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the button + modal into the organization detail page**

Read `pages/organizations/[id].js`. Add the import near the top:

```js
import GenerateStatementModal from '../../components/organizations/GenerateStatementModal';
```

Add a state variable near the existing `editOpen` useState (around line 53):

```js
const [statementOpen, setStatementOpen] = useState(false);
```

Add a button to the organization header. Find the existing header `<div className="flex items-start justify-between gap-4">` block (around line 111). The right side is currently empty — add a button group:

```jsx
<div className="flex items-start justify-between gap-4">
  <div className="flex-1 min-w-0">
    {/* ... existing left-side content (h1, badges, info) ... */}
  </div>
  <div className="flex flex-col gap-2 flex-shrink-0">
    <button
      onClick={() => setStatementOpen(true)}
      className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 rounded-lg whitespace-nowrap"
    >
      <FileText className="w-4 h-4" strokeWidth={1.75} />
      Generate Statement
    </button>
  </div>
</div>
```

Note: `FileText` is already imported. If a different icon is preferred, use `Receipt` (also already imported on this page).

Add the modal at the bottom of the JSX tree, just before the closing `</TenantLayout>` of the existing OrganizationModal block (around line 187):

```jsx
<GenerateStatementModal
  isOpen={statementOpen}
  onClose={() => setStatementOpen(false)}
  customerId={organization?.id}
  customerName={organization?.name || ''}
/>
```

- [ ] **Step 3: Verify the build doesn't break**

Run: `node --test tests/*.mjs`
Expected: PASS — no test regressions. (UI changes aren't unit-tested; verification is via Task 16's Chrome MCP smoke.)

- [ ] **Step 4: Commit**

```bash
git add components/organizations/GenerateStatementModal.js pages/organizations/[id].js
git commit -m "feat(organizations): Generate Statement button + modal on org detail page (FU-035-H5)"
```

---

## Task 16: Manual verification via Chrome MCP subagent + dd-qa

This task has minimal code changes — it's the manual smoke pass. Uses the Chrome MCP subagent (`mcp__Claude_in_Chrome__*`) for DOM-aware testing, same as H4 Task 13.

- [ ] **Step 1: Run all unit tests one more time**

Run: `node --test tests/*.mjs`
Expected: ALL pass — DO + Invoice + Rate Con + Combined + POD + new Statement tests + pre-existing fire-trigger failure.

- [ ] **Step 2: Confirm dev server is running**

Ask the user the dev-server URL (e.g., `http://localhost:58973`). Verify it's up by hitting `/api/health`.

- [ ] **Step 3: Dispatch a Chrome MCP subagent to verify the Document Designer UI**

Subagent prompt should:
1. Use `mcp__Claude_in_Chrome__navigate` to open `http://localhost:<port>/settings/document-designer?type=statement`
2. Use `mcp__Claude_in_Chrome__read_page` to verify the toggle list shows 9 sections in order: Header, Statement Details, Address Details, Open Invoices, Aging Summary, Total Outstanding, Notes, Terms & Conditions, Footer
3. Verify the right-pane preview renders the Statement sample data:
   - Header with logo placeholder + tenant info
   - Statement Details: As of Date "Apr 27, 2026", Account Number "CUST-WMT-0042"
   - Bill To block with SAMPLE BILL TO + 500 Customer Plaza
   - Open Invoices table with 5 rows (INV-2026-001 through INV-2025-127), color-coded Days Past Due
   - Aging Summary: 5 bucket panels with values $1,200 / $850 / $3,940 / $0 / $3,250
   - Total Outstanding panel showing $9,240.00
   - Notes section NOT visible (defaults OFF)
   - Footer
4. Use `mcp__Claude_in_Chrome__find` + click on the "Aging Summary" toggle. Verify the bucket row disappears from the preview.
5. Click "Days Past Due" column toggle inside Open Invoices. Verify that column disappears from the table.
6. Read console + network — flag any 4xx/5xx responses or red errors.
7. NO SCREENSHOTS (per H4 Task 13 lesson — image-size limit).

- [ ] **Step 4: Test the Generate Statement modal**

Navigate to `http://localhost:<port>/organizations`. Pick a real customer (one with at least one open invoice). Click into the detail page. Verify the "Generate Statement" button appears in the header.

Click it. Verify the modal opens with:
- Title "Generate Statement"
- Customer name in the body
- Date picker defaulting to today
- "Cancel" + "Download PDF" buttons

Click "Download PDF". Verify a new tab opens with `/api/tenant/pdf/statement/<customerId>?asOfDate=YYYY-MM-DD`. Verify the PDF renders correctly (real customer data, real open invoices, real aging).

- [ ] **Step 5: Test the back-dated as-of-date**

Re-open the modal. Pick a date 30+ days in the past. Click "Download PDF". Verify the resulting statement only shows invoices dated on or before that date. Aging buckets should be re-computed for that earlier "today."

- [ ] **Step 6: Test the empty-state path**

Find a customer with NO open invoices (e.g., a fully-paid customer, or a brand-new customer with no invoices yet). Click "Generate Statement" → "Download PDF". Verify:
- The PDF still renders (no 404).
- Open Invoices section shows "(No outstanding invoices)" empty row.
- Aging Summary shows all $0.00.
- Total Outstanding shows $0.00.

- [ ] **Step 7: Regression check — print prior doc types**

Verify the 6 existing doc types still render unchanged:
- `/settings/document-designer?type=delivery_order_full`
- `/settings/document-designer?type=invoice`
- `/settings/document-designer?type=rate_con`
- `/settings/document-designer?type=combined_invoice`
- `/settings/document-designer?type=pod`

All previews should load without console errors.

- [ ] **Step 8: Per-customer override test**

In `/settings/document-designer?type=statement`, switch the customer dropdown to a specific customer. Edit the accent color (e.g., red). Save. Switch back to "All Customers" → tenant default's accent is unchanged.

- [ ] **Step 9: Run dd-qa skill**

```
/dd-qa
```

Address any findings.

- [ ] **Step 10: Optional commit verification artifacts**

```bash
git commit --allow-empty -m "docs: FU-035-H5 manual verification artifacts"
```

If nothing to commit, skip.

---

## Task 17: Close FU-035-H5 in followups.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Update FU-035-H5 entry in followups.md**

Find the FU-035-H5 sub-bullet (after the resolved H1/H2/H3/H4 entries). Replace its content:

```
  - **FU-035-H5 Statement of Account** — ✅ Resolved YYYY-MM-DD. NEW doc type (no legacy template existed). STATEMENT_SECTIONS (9 sections, 20 leaf toggles). NEW component pairs: StatementDetails (2-field grid), OpenInvoicesTable (7-column table with color-coded Days Past Due), AgingSummary (5-bucket grid), TotalOutstanding (right-aligned accent panel). Reuses 5 components from prior FUs unchanged (Header, AddressDetails, Notes, Disclaimer, DocumentFooter). NEW download endpoint GET /api/tenant/pdf/statement/[customerId]?asOfDate=YYYY-MM-DD (Permission: ACCOUNTS_RECEIVABLE/ALL). NEW pure helper `lib/pdf/compute-aging.js` with parity test against `lib/ar-utils.js`'s `getAgingBucket()`. NEW `GenerateStatementModal` component + button on `pages/organizations/[id].js` (header right-side action). Public `renderStatementPdf(svc, customerId, tenantId, asOfDate)` signature. Cascade by `customer_id`. Spec docs/superpowers/specs/2026-04-27-fu-035-h5-statement-document-designer-design.md, plan docs/superpowers/plans/2026-04-27-fu-035-h5-statement-document-designer.md. ~17 commits. New tests: 5 files. Architecture milestone: Document Designer pattern now proven across 7 distinct doc-type registries (DO + Invoice + Rate Con + Combined Invoice + POD + Statement). Send-email + bulk-send + persistence deferred to FU-035-H5-followup-A/B/F.
```

(Use today's date — `git log -1 --format=%cd` if needed.)

- [ ] **Step 2: Append new FU-035-H5 follow-ups**

After the last existing FU-035-H4-followup-E block:

```
### FU-035-H5-followup-A: Statement send-email + bulk-send infrastructure
- Source: FU-035-H5 spec §2 (Non-Goals)
- Scope: large
- Area: pdf / api / ar
- Intent: Build the customer-email-out path for Statements. New endpoints:
    - `POST /api/tenant/customers/[id]/send-statement` — single send
    - `POST /api/tenant/customers/bulk-send-statements` — bulk send across N customers
  Loads UI integration:
    - "Email Statement" button on customer detail (alongside the existing Generate Statement button)
    - Bulk action page or AR aging dashboard "Send Statements" multi-select
  Email subject: "Statement of Account — As of {Date}". Body: customer-facing copy with balance summary + "Statement attached. Please remit at your earliest convenience."
  Permission gate: ACCOUNTS_RECEIVABLE + EMAIL_OUTBOUND.
- Notes: This parallels FU-035-H4-followup-B for POD send-email. Roughly 2-3 hours of work.

### FU-035-H5-followup-B: Bulk Statements UI
- Source: FU-035-H5 spec §2 (Non-Goals)
- Scope: medium
- Area: ar / ui
- Intent: AR clerk workflow page: select N customers (or filter by aging bucket — "all customers with balance > 90 days"), batch-generate ZIP of statement PDFs. Useful for monthly statement runs.
- Notes: Pairs naturally with FU-035-H5-followup-A — same workflow, different output (download ZIP vs send emails).

### FU-035-H5-followup-C: Integration smoke for renderStatementPdf
- Source: FU-035-H5 spec §12
- Scope: small
- Area: pdf / tests
- Intent: Add a Supabase-mock-backed integration test that calls `renderStatementPdf` with a stubbed svc client (returning the 4 query results that `fetchStatementData` expects), runs `renderToBuffer`, and asserts the returned Buffer starts with `%PDF-`. Same pattern as the H1-H4 integration smoke followups. With H5 shipped, this pattern now applies to 6 distinct renderers — strong candidate for a shared test utility.

### FU-035-H5-followup-D: Show consolidated indicator on Open Invoices rows
- Source: FU-035-H5 spec §13 R4
- Scope: small
- Area: pdf
- Intent: When `invoices.is_consolidated = true`, render an indicator (e.g., asterisk + footnote "* combined from N loads") on the Statement's Open Invoices table row. Helps customers understand why one invoice covers multiple loads. Requires fetching the consolidated child count via `invoice_charge_sets` join in `fetchStatementData`.
- Notes: Low-priority cosmetic enhancement; defer until customer-facing feedback warrants.

### FU-035-H5-followup-E: Factor computeAging() and getAgingBucket() into a shared helper
- Source: FU-035-H5 spec §13 R1 + Task 4 design note
- Scope: small
- Area: ar / cleanup
- Intent: `lib/pdf/compute-aging.js` (Statement) and `lib/ar-utils.js`'s `getAgingBucket()` (AR aging dashboard) duplicate per-invoice classification logic. The H5 plan added a parity test ensuring they agree, but the duplication is still a drift risk. Factor into a single shared helper. Both consumers re-import.

### FU-035-H5-followup-F: Persist generated statements + statement_number assignment
- Source: FU-035-H5 spec §2 (Non-Goals)
- Scope: medium
- Area: ar / pdf
- Intent: Currently statements are computed on-the-fly per request and not stored. To enable: (a) statement_number assignment for human reference; (b) audit trail of "what we sent the customer on what date"; (c) avoid re-rendering on subsequent reads. Add `statements` table with `tenant_id, customer_id, statement_number, as_of_date, total_outstanding_cents, pdf_url, sent_at, created_at`. Mirror `lib/pdf/archive.js`'s archiveInvoicePdf pattern.
- Notes: Schema migration needed. Pair this with followup-A to avoid double-rendering during email send.
```

- [ ] **Step 3: Update MEMORY.md index header**

Find the lead bullet line in MEMORY.md (the one starting `- **[followups.md](followups.md) — open follow-ups...`). Replace its descriptive text to reflect H5 ship state. Mention:
- HEAD SHA after Task 14 commit
- Architecture milestone: 7 doc-type registries proven
- New cleanup FUs filed (H5-followup-A through F)
- Outstanding sub-FUs: H6-H9 + FU-035-G + FU-035-H5-followup-A (the deferred Statement send-email work)

- [ ] **Step 4: Memory directory persists via auto-memory system**

Memory file edits persist via the auto-memory system. No git commit needed for the memory directory.

- [ ] **Step 5: Optional final wrap-up commit**

```bash
git log --oneline -20
git commit --allow-empty -m "$(cat <<'EOF'
chore: FU-035-H5 Statement of Account Document Designer migration complete

Brand-new Statement doc type added to the Document Designer + GET /api/tenant/pdf/statement/[customerId]
download endpoint. STATEMENT_SECTIONS (9 sections, 20 leaf toggles). NEW StatementDetails +
OpenInvoicesTable + AgingSummary + TotalOutstanding section component pairs. Reuses 5
components from prior FUs. NEW computeAging() helper with parity test against
lib/ar-utils.js's getAgingBucket(). Minimal "Generate Statement" button + modal on
organization detail page. Send-email + bulk-send + persistence deferred to FU-035-H5-followup-A/B/F.

Architecture milestone: Document Designer pattern now proven across 7 distinct doc-type
registries (DO + Invoice + Rate Con + Combined Invoice + POD + Statement).

Resolves: FU-035-H5
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- §1 Goal: Tasks 13 (composer) + 14 (endpoint) + 15 (UI button) are the keystone shipping units; Tasks 1-12 build inputs.
- §2 Non-goals: explicitly skipped send-email, bulk-generate UI, persistence, transaction-log layout, consolidated indicator → all filed as follow-ups A-F.
- §3 Architecture: 3.1 (independent registry) → Task 2; 3.2 (cascade by customer_id) → Task 12 passes to resolveTemplateConfig; 3.3 (no legacy template) → Task 13 builds composer from scratch; 3.4 (public signature) → Task 12; 3.5 (component reuse + 4 new) → Tasks 6, 7, 8, 9; 3.6 (single-page wrap) → Task 13's `<Page wrap>`; 3.7 (no eligibility gate) → Task 12 always proceeds.
- §4 File touch list: every entry has a task. Customer detail UI insertion point resolved to `pages/organizations/[id].js` during plan writing.
- §5 STATEMENT_SECTIONS: Task 2 inlines the full registry.
- §6 DOCUMENT_TYPES entry: Task 1.
- §7 Data behavior: 7.1 (eligible invoices query) → Task 12; 7.2 (computeAging) → Task 4 + 12; 7.3 (Days Past Due display) → Task 7 (color thresholds); 7.4 (empty state) → Task 11 sample data + Tasks 7/8/9 components handle null/zero; 7.5 (renderer data shape) → Task 12 returns it.
- §8 Composer: Task 13.
- §9 Renderer: Task 12.
- §10 Component breakdown: 10.1-10.5 → Tasks 6-9 + 10; 10.6 (UI button) → Task 15.
- §11 Endpoint: Task 14.
- §12 Test plan: Tasks 1, 2, 3, 4, 11.
- §13 Risks R1-R5: covered by tasks (R1 → Task 4 parity test; R2 → Task 12 fallback; R3-R5 accepted for v1).
- §14 Follow-ups A-F: filed in Task 17.

**Type/name consistency check:**
- `buildSectionData` exported from `lib/pdf/build-statement-section-data.js` (Task 11) and re-exported from `components/pdf/StatementTemplate.js` (Task 13) — consistent.
- `fetchStatementData` + `renderStatementPdf` named consistently in Task 12.
- `computeAging` named consistently in Task 4 + Task 12.
- `resolveAccountNumber` defined in Task 12's render-statement.js (helper, not exported).
- Section IDs: header / statement_details / address_details / open_invoices / aging_summary / total_outstanding / notes / disclaimer / footer — consistent in Tasks 2, 5 (sample-data), 6, 7, 8, 9, 11, 13.
- Field IDs: statement's `address_details.fields = [bill_to, phone, email]` — same as POD. Validator rejects `customer` (DO-only).
- Field IDs: statement's `statement_details.fields = [as_of_date, account_number]` — Statement-only. Validator rejects on Invoice/Rate Con/Combined/POD/DO.
- Field IDs: statement's `open_invoices.fields = [invoice_number, invoice_date, due_date, days_past_due, customer_reference, original_amount, balance_due]` — Statement-only.
- Field IDs: statement's `notes.fields = [payment_instructions, custom_notes]` — Statement-only. Validator rejects `driver_notes` (POD-only) and `billing_notes` (Invoice-only).
- Aging bucket keys: `current` / `days_1_30` / `days_31_60` / `days_61_90` / `days_90_plus` — consistent in Tasks 4 (computeAging), 8 (AgingSummary BUCKETS), 11 (sample data + buildSectionData), 12 (fetcher).
- Days Past Due color thresholds: 0/30/90 boundaries — consistent in Task 7 (helper) and visible in mockup spec.

**Open spec items not directly testable in tests/ layer:** OpenInvoicesTable / AgingSummary / TotalOutstanding / GenerateStatementModal / fetchStatementData / renderStatementPdf / endpoint — all manual-smoke (Task 16). Matches H1+H2+H3+H4's approach.

**Plan-specific notes:**
- Task 4 (computeAging parity test) MAY require updating the test if `lib/ar-utils.js`'s `getAgingBucket` doesn't accept an `asOf` second arg. Implementer must read the existing helper and adapt the parity test to whatever signature exists. This is documented inline in Task 4 Step 3.
- Task 15 references `pages/organizations/[id].js` directly; the spec said "implementer must explore" but that exploration was done at plan-writing time. The exact line numbers (~111 for the header div, ~187 for the modal block) are based on the file as it stood at plan-write time and may have drifted by execution time — implementer should use grep/Read to locate the matching JSX.
