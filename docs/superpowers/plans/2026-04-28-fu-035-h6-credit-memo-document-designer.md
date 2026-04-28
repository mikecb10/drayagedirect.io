# FU-035-H6 Credit Memo Document Designer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a brand-new Credit Memo doc type to the Document Designer + a download URL endpoint (`GET /api/tenant/pdf/credit-memo/[memoId]`) + a small "PDF" text link in the Actions cell of each row in `components/ar/CreditMemosTab.js`.

**Architecture:** Independent `CREDIT_MEMO_SECTIONS` registry (sibling to existing 7 registries). 10 sections, ~26 leaf toggles. NEW component pairs: `CreditMemoDetails`, `Reason`, `IssuedFromInvoice`, `AppliedToInvoice`, `CreditAmountPanel`. NEW non-toggleable hardcoded element: `VoidWatermark` (renders only when `doc.is_void === true`). Reuses Header / AddressDetails / Notes / Disclaimer / DocumentFooter from prior FUs. NEW pure helpers `resolveMemoNumber()` + `computeAppliedAmount()` live in `lib/pdf/render-credit-memo.js` (with tests in `tests/credit-memo-render-helpers.test.mjs`). Cascade by `customer_id`. Conditional auto-hide for Reason / Issued From / Applied To sections when their corresponding data field is null.

**Tech Stack:** Next.js 15 + React 19, @react-pdf/renderer 4.5, Supabase Postgres, Tailwind 4, native Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-04-28-fu-035-h6-credit-memo-document-designer-design.md`](../specs/2026-04-28-fu-035-h6-credit-memo-document-designer-design.md)

---

## Task 1: Add `'credit_memo'` to `DOCUMENT_TYPES` registry

**Files:**
- Create: `tests/document-types-constants-credit-memo.test.mjs`
- Modify: `lib/constants/document-types.js`
- Modify: `tests/document-types-constants.test.mjs` (exhaustive list update — same minimal pattern as H1/H2/H3/H4/H5)

- [ ] **Step 1: Write the failing test**

Create `tests/document-types-constants-credit-memo.test.mjs`:

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

test("'credit_memo' is in DOCUMENT_TYPES", () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('credit_memo'), `missing 'credit_memo' in: ${ids.join(', ')}`);
});

test("getDocumentType('credit_memo') returns category 'ar', label 'Credit Memo'", () => {
  const entry = getDocumentType('credit_memo');
  assert.equal(entry.value, 'credit_memo');
  assert.equal(entry.label, 'Credit Memo');
  assert.equal(entry.category, 'ar');
  assert.equal(typeof entry.description, 'string');
});

test("isValidDocumentType('credit_memo') is true", () => {
  assert.equal(isValidDocumentType('credit_memo'), true);
  assert.ok(VALID_DOCUMENT_TYPES.includes('credit_memo'));
  assert.equal(DOCUMENT_TYPE_LABELS['credit_memo'], 'Credit Memo');
});

test('all 8 doc types now present (regression)', () => {
  const ids = DOCUMENT_TYPES.map((t) => t.value);
  assert.ok(ids.includes('delivery_order_full'));
  assert.ok(ids.includes('delivery_order_next_move'));
  assert.ok(ids.includes('invoice'));
  assert.ok(ids.includes('rate_con'));
  assert.ok(ids.includes('combined_invoice'));
  assert.ok(ids.includes('pod'));
  assert.ok(ids.includes('statement'));
  assert.ok(ids.includes('credit_memo'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-types-constants-credit-memo.test.mjs`
Expected: FAIL — `missing 'credit_memo'`.

- [ ] **Step 3: Add 'credit_memo' to DOCUMENT_TYPES**

Edit `lib/constants/document-types.js`. Append the new entry after the existing `'statement'` entry:

```js
  {
    value: 'credit_memo',
    label: 'Credit Memo',
    description: 'Credit issued to a customer, optionally applied to an invoice',
    category: 'ar',
  },
```

The full array should now have 8 entries: `delivery_order_full`, `delivery_order_next_move`, `invoice`, `rate_con`, `combined_invoice`, `pod`, `statement`, `credit_memo`.

- [ ] **Step 4: Update the existing exhaustive-list test**

Read `tests/document-types-constants.test.mjs`. Find the hardcoded `deepEqual` exhaustive check on `DOCUMENT_TYPES.map((t) => t.value)` (the line that was updated in H1/H2/H3/H4/H5 Tasks 1). Update to include `'credit_memo'` as the 8th entry. Update the test name/description if it references a count.

- [ ] **Step 5: Run new test to verify it passes**

Run: `node --test tests/document-types-constants-credit-memo.test.mjs`
Expected: PASS — 4 tests pass.

- [ ] **Step 6: Run all existing constant tests to verify no regression**

Run: `node --test tests/document-types-constants.test.mjs`
Expected: PASS — all DO + Invoice + Rate Con + Combined Invoice + POD + Statement tests still green.

- [ ] **Step 7: Commit**

```bash
git add tests/document-types-constants-credit-memo.test.mjs tests/document-types-constants.test.mjs lib/constants/document-types.js
git commit -m "feat(doc-designer): register 'credit_memo' in DOCUMENT_TYPES (FU-035-H6)"
```

---

## Task 2: Add `CREDIT_MEMO_SECTIONS` to section registry

**Files:**
- Create: `tests/document-sections-credit-memo-constants.test.mjs`
- Modify: `lib/constants/document-sections.js`

- [ ] **Step 1: Write the failing test**

Create `tests/document-sections-credit-memo-constants.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CREDIT_MEMO_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('CREDIT_MEMO_SECTIONS entries have required keys', () => {
  for (const s of CREDIT_MEMO_SECTIONS) {
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

test('all 10 CREDIT_MEMO sections present in expected order', () => {
  const ids = CREDIT_MEMO_SECTIONS.map((s) => s.id);
  for (const id of [
    'header', 'memo_details', 'address_details',
    'reason', 'issued_from_invoice', 'applied_to_invoice',
    'credit_amount', 'notes', 'disclaimer', 'footer',
  ]) {
    assert.ok(ids.includes(id), `missing CREDIT_MEMO section: ${id}`);
  }
  assert.equal(CREDIT_MEMO_SECTIONS.length, 10);
});

test('footer is non-toggleable on Credit Memo', () => {
  const footer = CREDIT_MEMO_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('notes and disclaimer default OFF on Credit Memo', () => {
  for (const id of ['notes', 'disclaimer']) {
    const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, false, `${id} should default off`);
  }
});

test('memo_details, reason, issued_from_invoice, applied_to_invoice, credit_amount default ON', () => {
  for (const id of ['memo_details', 'reason', 'issued_from_invoice', 'applied_to_invoice', 'credit_amount']) {
    const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === id);
    assert.equal(s.defaultVisible, true, `${id} should default on`);
  }
});

test('memo_details has 3 fields including applied_date', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'memo_details');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['memo_number', 'issue_date', 'applied_date']) {
    assert.ok(fieldIds.includes(id), `missing memo_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 3);
});

test('address_details uses bill_to (NOT customer)', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'address_details');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('bill_to'), 'bill_to required');
  assert.ok(!fieldIds.includes('customer'), 'customer should NOT exist on credit_memo (DO-only)');
  assert.equal(fieldIds.length, 3);  // bill_to + phone + email
});

test('reason has no fields (master-toggle only)', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'reason');
  assert.equal(s.fields, undefined, 'reason should not have fields array');
});

test('issued_from_invoice has 4 fields', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'issued_from_invoice');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['invoice_number', 'invoice_date', 'due_date', 'total']) {
    assert.ok(fieldIds.includes(id), `missing issued_from_invoice field: ${id}`);
  }
  assert.equal(fieldIds.length, 4);
});

test('applied_to_invoice has 5 fields including applied_amount', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'applied_to_invoice');
  const fieldIds = s.fields.map((f) => f.id);
  for (const id of ['invoice_number', 'invoice_date', 'balance_due', 'applied_amount', 'applied_date']) {
    assert.ok(fieldIds.includes(id), `missing applied_to_invoice field: ${id}`);
  }
  assert.equal(fieldIds.length, 5);
});

test('credit_amount has 1 field (total)', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'credit_amount');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('total'));
  assert.equal(fieldIds.length, 1);
});

test('notes has payment_instructions + custom_notes fields', () => {
  const s = CREDIT_MEMO_SECTIONS.find((x) => x.id === 'notes');
  const fieldIds = s.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('payment_instructions'));
  assert.ok(fieldIds.includes('custom_notes'));
  assert.equal(fieldIds.length, 2);
});

test('SECTIONS_BY_DOCUMENT_TYPE wired for credit_memo', () => {
  assert.equal(SECTIONS_BY_DOCUMENT_TYPE.credit_memo, CREDIT_MEMO_SECTIONS);
  assert.equal(getSectionsForDocumentType('credit_memo'), CREDIT_MEMO_SECTIONS);
});

test('computeVisibility default for Credit Memo', () => {
  const result = computeVisibility(CREDIT_MEMO_SECTIONS, null);
  assert.equal(result.visibility.notes, false);
  assert.equal(result.visibility.disclaimer, false);
  assert.equal(result.visibility.memo_details, true);
  assert.equal(result.visibility.reason, true);
  assert.equal(result.visibility.issued_from_invoice, true);
  assert.equal(result.visibility.applied_to_invoice, true);
  assert.equal(result.visibility.credit_amount, true);
  assert.equal(result.visibility.footer, true);  // non-toggleable always on
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-credit-memo-constants.test.mjs`
Expected: FAIL — `CREDIT_MEMO_SECTIONS` not exported.

- [ ] **Step 3: Add CREDIT_MEMO_SECTIONS**

Edit `lib/constants/document-sections.js`. After the closing bracket of `STATEMENT_SECTIONS` (around line 693), and BEFORE the `SECTIONS_BY_DOCUMENT_TYPE` declaration, append:

```js
export const CREDIT_MEMO_SECTIONS = [
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
    id: 'memo_details',
    label: 'Credit Memo Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'memo_number',  label: 'Memo #',       defaultVisible: true },
      { id: 'issue_date',   label: 'Issue Date',   defaultVisible: true },
      { id: 'applied_date', label: 'Applied Date', defaultVisible: true },
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
    id: 'reason',
    label: 'Reason',
    defaultVisible: true,
    toggleable: true,
    // Master toggle only. Auto-hides regardless of toggle when reason is null/empty.
  },
  {
    id: 'issued_from_invoice',
    label: 'Issued From Invoice',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'invoice_number', label: 'Invoice #',      defaultVisible: true },
      { id: 'invoice_date',   label: 'Invoice Date',   defaultVisible: true },
      { id: 'due_date',       label: 'Due Date',       defaultVisible: true },
      { id: 'total',          label: 'Original Total', defaultVisible: true },
    ],
  },
  {
    id: 'applied_to_invoice',
    label: 'Applied To Invoice',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'invoice_number', label: 'Invoice #',      defaultVisible: true },
      { id: 'invoice_date',   label: 'Invoice Date',   defaultVisible: true },
      { id: 'balance_due',    label: 'Balance Due',    defaultVisible: true },
      { id: 'applied_amount', label: 'Applied Amount', defaultVisible: true },
      { id: 'applied_date',   label: 'Applied Date',   defaultVisible: true },
    ],
  },
  {
    id: 'credit_amount',
    label: 'Credit Amount',
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
    // Master-toggle only — rich text comes from FU-035-G.
  },
  {
    id: 'footer',
    label: 'Footer',
    defaultVisible: true,
    toggleable: false,
  },
];

```

Then update the `SECTIONS_BY_DOCUMENT_TYPE` map. Find the existing object (around line 695) and add:

```js
export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
  combined_invoice: COMBINED_INVOICE_SECTIONS,
  pod: POD_SECTIONS,
  statement: STATEMENT_SECTIONS,
  credit_memo: CREDIT_MEMO_SECTIONS,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/document-sections-credit-memo-constants.test.mjs`
Expected: PASS — 14 tests pass.

- [ ] **Step 5: Run all section tests to verify no regression**

Run: `node --test tests/document-sections-*.test.mjs`
Expected: PASS — all prior section tests (DO, Invoice, Rate Con, Combined Invoice, POD, Statement) still green.

- [ ] **Step 6: Commit**

```bash
git add tests/document-sections-credit-memo-constants.test.mjs lib/constants/document-sections.js
git commit -m "feat(doc-designer): CREDIT_MEMO_SECTIONS registry (10 sections, ~26 toggles) (FU-035-H6)"
```

---

## Task 3: Validator regression tests for Credit Memo

**Files:**
- Create: `tests/validate-section-config-credit-memo.test.mjs`

The validator at `lib/document-designer/validate-section-config.js` already accepts unknown doc types. But field-ID isolation between doc types is one of its responsibilities (e.g., `pod_details` is valid only on the POD doc type). This task adds Credit-Memo-specific cases to the existing test suite.

- [ ] **Step 1: Write the test**

Create `tests/validate-section-config-credit-memo.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateSectionConfig } from '../lib/document-designer/validate-section-config.js';

test('credit_memo accepts memo_number under memo_details.fields', () => {
  const config = {
    perSection: {
      memo_details: { fields: { memo_number: false, issue_date: true, applied_date: true } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('credit_memo accepts payment_instructions under notes.fields', () => {
  const config = {
    perSection: {
      notes: { fields: { payment_instructions: true, custom_notes: false } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('credit_memo accepts applied_amount on applied_to_invoice ONLY (not on issued_from_invoice)', () => {
  const okConfig = {
    perSection: {
      applied_to_invoice: { fields: { applied_amount: false } },
    },
  };
  assert.equal(validateSectionConfig(okConfig, 'credit_memo').valid, true);

  const badConfig = {
    perSection: {
      issued_from_invoice: { fields: { applied_amount: false } },
    },
  };
  const result = validateSectionConfig(badConfig, 'credit_memo');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /applied_amount/.test(e)),
    `expected applied_amount field-isolation error, got: ${JSON.stringify(result.errors)}`);
});

test('credit_memo accepts total on credit_amount.fields', () => {
  const config = {
    perSection: {
      credit_amount: { fields: { total: true } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('credit_memo rejects pod_details (POD-only section ID)', () => {
  const config = {
    visibility: { pod_details: false },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /pod_details/.test(e)),
    `expected pod_details rejection, got: ${JSON.stringify(result.errors)}`);
});

test('credit_memo rejects open_invoices section (Statement-only)', () => {
  const config = {
    visibility: { open_invoices: true },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /open_invoices/.test(e)),
    `expected open_invoices rejection, got: ${JSON.stringify(result.errors)}`);
});

test('credit_memo rejects unknown field on memo_details', () => {
  const config = {
    perSection: {
      memo_details: { fields: { fake_field: true } },
    },
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /fake_field/.test(e)),
    `expected fake_field rejection, got: ${JSON.stringify(result.errors)}`);
});

test('credit_memo accepts empty config (defaults)', () => {
  const result = validateSectionConfig({}, 'credit_memo');
  assert.equal(result.valid, true);
});

test('credit_memo accepts colors block', () => {
  const config = { colors: { accent: '#ff0000', text: '#222222' } };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, true);
});

test('credit_memo accepts order array', () => {
  const config = {
    order: ['header', 'memo_details', 'address_details', 'reason',
            'issued_from_invoice', 'applied_to_invoice', 'credit_amount',
            'notes', 'disclaimer', 'footer'],
  };
  const result = validateSectionConfig(config, 'credit_memo');
  assert.equal(result.valid, true);
});
```

- [ ] **Step 2: Run test to verify pass**

Run: `node --test tests/validate-section-config-credit-memo.test.mjs`
Expected: PASS — 10 tests pass. The validator already supports new doc types via `SECTIONS_BY_DOCUMENT_TYPE` lookup, so this works once Task 2 lands.

- [ ] **Step 3: Run full validator test suite as regression check**

Run: `node --test tests/validate-section-config-*.test.mjs`
Expected: PASS — all DO + Invoice + Rate Con + Combined Invoice + POD + Statement validator tests still green.

- [ ] **Step 4: Commit**

```bash
git add tests/validate-section-config-credit-memo.test.mjs
git commit -m "test(doc-designer): credit_memo validator regression tests (FU-035-H6)"
```

---

## Task 4: Build pure helpers (`resolveMemoNumber` + `computeAppliedAmount`) + tests

**Files:**
- Create: `lib/pdf/credit-memo-helpers.js`
- Create: `tests/credit-memo-render-helpers.test.mjs`

Two pure helpers used by the renderer. Factored into `lib/pdf/credit-memo-helpers.js` (rather than living inline in `render-credit-memo.js`) so they can be tested without importing the React-PDF runtime.

- [ ] **Step 1: Write the failing test**

Create `tests/credit-memo-render-helpers.test.mjs`:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  resolveMemoNumber,
  computeAppliedAmount,
} from '../lib/pdf/credit-memo-helpers.js';

// ── resolveMemoNumber ──────────────────────────────────────────

test('resolveMemoNumber returns the real memo_number when set', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: 'CM-2026-014', id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-2026-014',
  );
});

test('resolveMemoNumber falls back to CM-{id:0:8} uppercase when memo_number is null', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: null, id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-A1B2C3D4',
  );
});

test('resolveMemoNumber falls back when memo_number is empty string', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: '', id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-A1B2C3D4',
  );
});

test('resolveMemoNumber falls back when memo_number is whitespace only', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: '   ', id: 'a1b2c3d4-1111-2222-3333-444455556666' }),
    'CM-A1B2C3D4',
  );
});

test('resolveMemoNumber trims real memo_number', () => {
  assert.equal(
    resolveMemoNumber({ memo_number: '  CM-2026-014  ', id: 'a1b2c3d4-...' }),
    'CM-2026-014',
  );
});

test('resolveMemoNumber returns CM-UNKNOWN if both memo_number and id are missing', () => {
  assert.equal(resolveMemoNumber({}), 'CM-UNKNOWN');
  assert.equal(resolveMemoNumber({ memo_number: null, id: null }), 'CM-UNKNOWN');
});

// ── computeAppliedAmount ───────────────────────────────────────

test('computeAppliedAmount returns null when applied invoice is null', () => {
  assert.equal(computeAppliedAmount({ amount_cents: 40000 }, null), null);
  assert.equal(computeAppliedAmount({ amount_cents: 40000 }, undefined), null);
});

test('computeAppliedAmount returns memo amount when smaller than invoice total', () => {
  // memo is $400, invoice total is $1000 → applied = $400
  assert.equal(
    computeAppliedAmount({ amount_cents: 40000 }, { total_amount_cents: 100000 }),
    40000,
  );
});

test('computeAppliedAmount clamps to invoice total when memo exceeds it', () => {
  // memo is $1000, invoice total is $400 → applied = $400
  assert.equal(
    computeAppliedAmount({ amount_cents: 100000 }, { total_amount_cents: 40000 }),
    40000,
  );
});

test('computeAppliedAmount returns 0 when invoice total is 0', () => {
  // Degenerate case: zero-total invoice. min(any, 0) = 0.
  assert.equal(
    computeAppliedAmount({ amount_cents: 40000 }, { total_amount_cents: 0 }),
    0,
  );
});

test('computeAppliedAmount returns 0 when memo amount is 0', () => {
  assert.equal(
    computeAppliedAmount({ amount_cents: 0 }, { total_amount_cents: 100000 }),
    0,
  );
});

test('computeAppliedAmount handles equal amounts', () => {
  // memo and invoice both $400 → applied = $400
  assert.equal(
    computeAppliedAmount({ amount_cents: 40000 }, { total_amount_cents: 40000 }),
    40000,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-memo-render-helpers.test.mjs`
Expected: FAIL — `lib/pdf/credit-memo-helpers.js` doesn't exist.

- [ ] **Step 3: Create the helpers file**

Create `lib/pdf/credit-memo-helpers.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/credit-memo-render-helpers.test.mjs`
Expected: PASS — 12 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/credit-memo-helpers.js tests/credit-memo-render-helpers.test.mjs
git commit -m "feat(pdf): resolveMemoNumber + computeAppliedAmount helpers + tests (FU-035-H6)"
```

---

## Task 5: Create `sample-data-credit-memo.js` + register in DocumentPreview

**Files:**
- Create: `lib/document-designer/sample-data-credit-memo.js`

The Document Designer's live preview reads sample data per doc type. Sample data MUST be **keyed by section ID** because `DocumentPreview.js` dispatches via `sampleData[sectionId]` — not by buildSectionData input shape. (This is the H5 trap; verify field IDs match `CREDIT_MEMO_SECTIONS` exactly.)

The sample shows an **applied** memo (status 'applied', both invoice FKs present). VOID variant is not in the live preview.

- [ ] **Step 1: Create the file**

Create `lib/document-designer/sample-data-credit-memo.js`:

```js
// Mirror this shape against buildSectionData() in lib/pdf/build-credit-memo-section-data.js —
// drift here means the preview shows different content than the printed PDF.
//
// Keyed by SECTION ID (matches CREDIT_MEMO_SECTIONS ids) — DocumentPreview
// dispatches via sampleData[s.id], so keys must match exactly. The H5 spec §7.5
// has a regression note about this; the cost of getting it wrong is silent
// "section is empty" in the live preview while the PDF renders correctly.

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
  memo_details: {
    memo_number:  'CM-2026-014',
    issue_date:   'Apr 27, 2026',
    applied_date: 'Apr 28, 2026',
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
  reason: {
    text: 'Overcharge on chassis days for load LD-2026-7821 — billed 5 days, only 3 used.',
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
  credit_amount: {
    total_cents: 40000,
  },
  notes: {
    payment_instructions: 'This credit will be reflected on your next invoice or available for application upon request.',
    custom_notes: '',
  },
  disclaimer: {
    text: 'Terms & Conditions text shows here. This is editable per-tenant in FU-035-G.',
  },
};

export default sampleData;
```

- [ ] **Step 2: Verify the file looks clean (lesson from H5)**

Run: `tail -c 50 lib/document-designer/sample-data-credit-memo.js`
Expected: ends with `\n` (newline) followed by no markup leak. The closing `;\n` of `export default sampleData;` must be the last bytes. If you see trailing garbage like `</content>` or `</invoke>`, edit the file to remove it before committing.

- [ ] **Step 3: Run all tests as a sanity check**

Run: `node --test tests/*.mjs`
Expected: PASS — no regressions.

- [ ] **Step 4: Commit**

```bash
git add lib/document-designer/sample-data-credit-memo.js
git commit -m "feat(doc-designer): sample data for credit_memo (keyed by section ID) (FU-035-H6)"
```

---

## Task 6: Build `CreditMemoDetails` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/CreditMemoDetails.js`
- Create: `components/settings/document-designer/preview/CreditMemoDetailsPreview.js`

3-column label-value grid with skip-empty (the `applied_date` leaf auto-hides when null). Mirrors `StatementDetails.js` / `PodDetails.js`.

- [ ] **Step 1: Create CreditMemoDetails.js (PDF)**

Create `components/pdf/sections/CreditMemoDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Credit Memo Details section — 3 toggleable fields rendered as a 3-col
 * label-value grid. Skips empty values (so applied_date=null hides that
 * column at render time). Mirrors StatementDetails.js's structure.
 *
 * `data` shape: { memo_number, issue_date, applied_date }
 * `opts.fields`: { memo_number, issue_date, applied_date }
 */
const FIELD_ORDER = [
  ['memo_number',  'Memo #'],
  ['issue_date',   'Issue Date'],
  ['applied_date', 'Applied Date'],
];

export default function CreditMemoDetails({ data, opts, colors }) {
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

- [ ] **Step 2: Create CreditMemoDetailsPreview.js (HTML)**

Create `components/settings/document-designer/preview/CreditMemoDetailsPreview.js`:

```js
/**
 * HTML preview of Credit Memo Details. Mirrors components/pdf/sections/CreditMemoDetails.js.
 * 3-col label-value grid; skips empty values.
 */
const FIELD_ORDER = [
  ['memo_number',  'Memo #'],
  ['issue_date',   'Issue Date'],
  ['applied_date', 'Applied Date'],
];

export default function CreditMemoDetailsPreview({ data, opts, colors }) {
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
Expected: ALL existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/sections/CreditMemoDetails.js components/settings/document-designer/preview/CreditMemoDetailsPreview.js
git commit -m "feat(pdf): CreditMemoDetails section component (PDF + HTML preview) (FU-035-H6)"
```

---

## Task 7: Build `Reason` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/Reason.js`
- Create: `components/settings/document-designer/preview/ReasonPreview.js`

Single-text-block component. Amber-tinted callout (#fef3c7 background, #f59e0b 3px left border).

- [ ] **Step 1: Create Reason.js (PDF)**

Create `components/pdf/sections/Reason.js`:

```js
import { View, Text } from '@react-pdf/renderer';

const styles = {
  section: { marginBottom: 12 },
  callout: {
    backgroundColor: '#fef3c7',
    borderLeftWidth: 3,
    borderLeftColor: '#f59e0b',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 2,
  },
  text: { fontSize: 10, color: '#78350f', lineHeight: 1.45 },
  label: { fontSize: 8, color: '#92400e', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 'bold' },
};

/**
 * Reason section — single free-text block explaining why the credit was issued.
 * Amber-tinted callout for visual distinction from the generic Notes section.
 *
 * `data` shape: { text: string }
 *
 * Composer-level guard: this component is only rendered when doc.memo_meta.reason
 * is non-null/non-empty (see CreditMemoTemplate.js renderSection). So the
 * component itself doesn't need to check — but we still defensive-guard against
 * a `data === null` case for robustness.
 */
export default function Reason({ data, colors }) {
  if (!data || !data.text || !String(data.text).trim()) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Reason</Text>
      <View style={styles.callout}>
        <Text style={styles.text}>{String(data.text).trim()}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create ReasonPreview.js (HTML)**

Create `components/settings/document-designer/preview/ReasonPreview.js`:

```js
/**
 * HTML preview of Reason. Mirrors components/pdf/sections/Reason.js.
 */
export default function ReasonPreview({ data, colors }) {
  if (!data || !data.text || !String(data.text).trim()) return null;

  return (
    <div className="mb-4 pb-3">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#92400e' }}>
        Reason
      </div>
      <div
        className="px-3 py-2 rounded-sm text-[12px] leading-relaxed"
        style={{
          backgroundColor: '#fef3c7',
          borderLeft: '3px solid #f59e0b',
          color: '#78350f',
        }}
      >
        {String(data.text).trim()}
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
git add components/pdf/sections/Reason.js components/settings/document-designer/preview/ReasonPreview.js
git commit -m "feat(pdf): Reason section component (PDF + HTML preview) (FU-035-H6)"
```

---

## Task 8: Build `IssuedFromInvoice` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/IssuedFromInvoice.js`
- Create: `components/settings/document-designer/preview/IssuedFromInvoicePreview.js`

Card layout with blue 3px left border accent. 4 toggleable fields. Empty/null behavior: composer returns null when `doc.issued_from_invoice` is null, so the component itself only handles the per-field case.

- [ ] **Step 1: Create IssuedFromInvoice.js (PDF)**

Create `components/pdf/sections/IssuedFromInvoice.js`:

```js
import { View, Text } from '@react-pdf/renderer';

const styles = {
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: '#1e40af', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 'bold' },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 3,
    borderLeftColor: '#3b82f6',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fafbfc',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  invNum: { fontWeight: 'bold', fontSize: 11, color: '#0f172a' },
  total:  { fontWeight: 'bold', fontSize: 12, color: '#0f172a' },
  meta:   { fontSize: 9, color: '#64748b' },
};

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Issued From Invoice — small card showing the source invoice (the invoice
 * the credit was issued against). Blue 3px left border accent.
 *
 * `data` shape: { invoice_number, invoice_date, due_date, total_cents }
 * `opts.fields`: { invoice_number, invoice_date, due_date, total }
 *
 * Composer-level guard: rendered only when doc.issued_from_invoice is non-null.
 */
export default function IssuedFromInvoice({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv  = fields.invoice_number !== false;
  const showInvD = fields.invoice_date   !== false;
  const showDue  = fields.due_date       !== false;
  const showTot  = fields.total          !== false;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showDue  && data.due_date)     meta.push(`Due ${data.due_date}`);

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Issued From Invoice</Text>
      <View style={styles.card}>
        {(showInv || showTot) && (
          <View style={styles.topRow}>
            {showInv && data.invoice_number ? (
              <Text style={styles.invNum}>{data.invoice_number}</Text>
            ) : <Text style={styles.invNum}>—</Text>}
            {showTot ? (
              <Text style={styles.total}>{fmtDollars(data.total_cents)}</Text>
            ) : null}
          </View>
        )}
        {meta.length > 0 && <Text style={styles.meta}>{meta.join(' · ')}</Text>}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create IssuedFromInvoicePreview.js (HTML)**

Create `components/settings/document-designer/preview/IssuedFromInvoicePreview.js`:

```js
/**
 * HTML preview of Issued From Invoice. Mirrors components/pdf/sections/IssuedFromInvoice.js.
 */
function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function IssuedFromInvoicePreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv  = fields.invoice_number !== false;
  const showInvD = fields.invoice_date   !== false;
  const showDue  = fields.due_date       !== false;
  const showTot  = fields.total          !== false;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showDue  && data.due_date)     meta.push(`Due ${data.due_date}`);

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#1e40af' }}>
        Issued From Invoice
      </div>
      <div
        className="px-3 py-2 rounded text-[12px]"
        style={{
          backgroundColor: '#fafbfc',
          border: '1px solid #e2e8f0',
          borderLeft: '3px solid #3b82f6',
        }}
      >
        {(showInv || showTot) && (
          <div className="flex justify-between items-baseline mb-1">
            {showInv ? (
              <span className="font-bold text-[12px]" style={{ color: '#0f172a' }}>
                {data.invoice_number || '—'}
              </span>
            ) : <span>—</span>}
            {showTot ? (
              <span className="font-bold text-[13px]" style={{ color: '#0f172a' }}>
                {fmtDollars(data.total_cents)}
              </span>
            ) : null}
          </div>
        )}
        {meta.length > 0 && (
          <div className="text-[10px]" style={{ color: '#64748b' }}>
            {meta.join(' · ')}
          </div>
        )}
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
git add components/pdf/sections/IssuedFromInvoice.js components/settings/document-designer/preview/IssuedFromInvoicePreview.js
git commit -m "feat(pdf): IssuedFromInvoice section component (PDF + HTML preview) (FU-035-H6)"
```

---

## Task 9: Build `AppliedToInvoice` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/AppliedToInvoice.js`
- Create: `components/settings/document-designer/preview/AppliedToInvoicePreview.js`

Card layout with green 3px left border accent. 5 toggleable fields. Same shape as IssuedFromInvoice with one extra row showing applied amount + applied date.

- [ ] **Step 1: Create AppliedToInvoice.js (PDF)**

Create `components/pdf/sections/AppliedToInvoice.js`:

```js
import { View, Text } from '@react-pdf/renderer';

const styles = {
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: '#166534', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3, fontWeight: 'bold' },
  card: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fafbfc',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  invNum:   { fontWeight: 'bold', fontSize: 11, color: '#0f172a' },
  balance:  { fontWeight: 'bold', fontSize: 12, color: '#0f172a' },
  meta:     { fontSize: 9, color: '#64748b' },
};

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Applied To Invoice — small card showing the destination invoice (the
 * invoice this credit's amount was applied against). Green 3px left border.
 *
 * `data` shape: { invoice_number, invoice_date, balance_due_cents,
 *                 applied_amount_cents, applied_date }
 * `opts.fields`: { invoice_number, invoice_date, balance_due,
 *                  applied_amount, applied_date }
 *
 * Composer-level guard: rendered only when doc.applied_to_invoice is non-null.
 */
export default function AppliedToInvoice({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv      = fields.invoice_number  !== false;
  const showInvD     = fields.invoice_date    !== false;
  const showBalance  = fields.balance_due     !== false;
  const showApplied  = fields.applied_amount  !== false;
  const showAppliedD = fields.applied_date    !== false;

  const balanceLabel = showBalance && data.balance_due_cents != null
    ? `Bal: ${fmtDollars(data.balance_due_cents)}`
    : null;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showApplied && data.applied_amount_cents != null) {
    const amount = fmtDollars(data.applied_amount_cents);
    if (showAppliedD && data.applied_date) {
      meta.push(`Reduced by ${amount} on ${data.applied_date}`);
    } else {
      meta.push(`Reduced by ${amount}`);
    }
  } else if (showAppliedD && data.applied_date) {
    meta.push(`Applied ${data.applied_date}`);
  }

  return (
    <View style={styles.section}>
      <Text style={styles.label}>Applied To Invoice</Text>
      <View style={styles.card}>
        {(showInv || balanceLabel) && (
          <View style={styles.topRow}>
            {showInv && data.invoice_number ? (
              <Text style={styles.invNum}>{data.invoice_number}</Text>
            ) : <Text style={styles.invNum}>—</Text>}
            {balanceLabel ? (
              <Text style={styles.balance}>{balanceLabel}</Text>
            ) : null}
          </View>
        )}
        {meta.length > 0 && <Text style={styles.meta}>{meta.join(' · ')}</Text>}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create AppliedToInvoicePreview.js (HTML)**

Create `components/settings/document-designer/preview/AppliedToInvoicePreview.js`:

```js
/**
 * HTML preview of Applied To Invoice. Mirrors components/pdf/sections/AppliedToInvoice.js.
 */
function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function AppliedToInvoicePreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};

  const showInv      = fields.invoice_number  !== false;
  const showInvD     = fields.invoice_date    !== false;
  const showBalance  = fields.balance_due     !== false;
  const showApplied  = fields.applied_amount  !== false;
  const showAppliedD = fields.applied_date    !== false;

  const balanceLabel = showBalance && data.balance_due_cents != null
    ? `Bal: ${fmtDollars(data.balance_due_cents)}`
    : null;

  const meta = [];
  if (showInvD && data.invoice_date) meta.push(`Issued ${data.invoice_date}`);
  if (showApplied && data.applied_amount_cents != null) {
    const amount = fmtDollars(data.applied_amount_cents);
    if (showAppliedD && data.applied_date) {
      meta.push(`Reduced by ${amount} on ${data.applied_date}`);
    } else {
      meta.push(`Reduced by ${amount}`);
    }
  } else if (showAppliedD && data.applied_date) {
    meta.push(`Applied ${data.applied_date}`);
  }

  return (
    <div className="mb-4">
      <div className="text-[10px] uppercase tracking-wider font-bold mb-1" style={{ color: '#166534' }}>
        Applied To Invoice
      </div>
      <div
        className="px-3 py-2 rounded text-[12px]"
        style={{
          backgroundColor: '#fafbfc',
          border: '1px solid #e2e8f0',
          borderLeft: '3px solid #10b981',
        }}
      >
        {(showInv || balanceLabel) && (
          <div className="flex justify-between items-baseline mb-1">
            {showInv ? (
              <span className="font-bold text-[12px]" style={{ color: '#0f172a' }}>
                {data.invoice_number || '—'}
              </span>
            ) : <span>—</span>}
            {balanceLabel ? (
              <span className="font-bold text-[13px]" style={{ color: '#0f172a' }}>
                {balanceLabel}
              </span>
            ) : null}
          </div>
        )}
        {meta.length > 0 && (
          <div className="text-[10px]" style={{ color: '#64748b' }}>
            {meta.join(' · ')}
          </div>
        )}
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
git add components/pdf/sections/AppliedToInvoice.js components/settings/document-designer/preview/AppliedToInvoicePreview.js
git commit -m "feat(pdf): AppliedToInvoice section component (PDF + HTML preview) (FU-035-H6)"
```

---

## Task 10: Build `CreditAmountPanel` PDF + Preview components

**Files:**
- Create: `components/pdf/sections/CreditAmountPanel.js`
- Create: `components/settings/document-designer/preview/CreditAmountPanelPreview.js`

Right-aligned green accent panel. **Always green regardless of memo status** — VOID is conveyed by the watermark, not by changing the panel color. Mirrors the layout of Statement's `TotalOutstanding` but with green palette and "CREDIT AMOUNT" label.

- [ ] **Step 1: Create CreditAmountPanel.js (PDF)**

Create `components/pdf/sections/CreditAmountPanel.js`:

```js
import { View, Text } from '@react-pdf/renderer';

const PALETTE = {
  bg:        '#f0fdf4',
  border:    '#16a34a',
  textLight: '#15803d',
  textDark:  '#15803d',
};

const styles = {
  section: { marginBottom: 12, alignItems: 'flex-end' },
  panel: {
    backgroundColor: PALETTE.bg,
    borderWidth: 1.5,
    borderColor: PALETTE.border,
    borderRadius: 4,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minWidth: 180,
    alignItems: 'flex-end',
  },
  label: {
    fontSize: 9,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: PALETTE.textLight,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  amount: {
    fontSize: 22,
    fontWeight: 'bold',
    color: PALETTE.textDark,
  },
};

function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Credit Amount panel — right-aligned green accent block displaying the total
 * credit issued. Always green; VOID state is conveyed by the watermark, not
 * by changing this panel's color (per spec §3.5 and §10.5).
 *
 * `data` shape: { total_cents }
 * `opts.fields`: { total }  (only one leaf — disabling it hides the panel)
 */
export default function CreditAmountPanel({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  if (fields.total === false) return null;

  return (
    <View style={styles.section}>
      <View style={styles.panel}>
        <Text style={styles.label}>Credit Amount</Text>
        <Text style={styles.amount}>{fmtDollars(data.total_cents)}</Text>
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Create CreditAmountPanelPreview.js (HTML)**

Create `components/settings/document-designer/preview/CreditAmountPanelPreview.js`:

```js
/**
 * HTML preview of Credit Amount panel. Mirrors components/pdf/sections/CreditAmountPanel.js.
 */
function fmtDollars(cents) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

export default function CreditAmountPanelPreview({ data, opts, colors }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  if (fields.total === false) return null;

  return (
    <div className="mb-4 flex justify-end">
      <div
        className="px-5 py-3.5 rounded text-right"
        style={{
          backgroundColor: '#f0fdf4',
          border: '1.5px solid #16a34a',
          minWidth: '220px',
        }}
      >
        <div
          className="text-[10px] uppercase tracking-widest font-bold mb-0.5"
          style={{ color: '#15803d' }}
        >
          Credit Amount
        </div>
        <div className="text-[24px] font-extrabold" style={{ color: '#15803d' }}>
          {fmtDollars(data.total_cents)}
        </div>
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
git add components/pdf/sections/CreditAmountPanel.js components/settings/document-designer/preview/CreditAmountPanelPreview.js
git commit -m "feat(pdf): CreditAmountPanel section component (PDF + HTML preview) (FU-035-H6)"
```

---

## Task 11: Build `VoidWatermark` component (PDF only, no HTML preview)

**Files:**
- Create: `components/pdf/sections/VoidWatermark.js`

Diagonal "VOID" overlay rendered as React-PDF `<View fixed style={{ position: 'absolute', ... }}>`. Renders on every page if the doc overflows. **NOT registered as a section** in `CREDIT_MEMO_SECTIONS`, NOT toggleable in Designer, NOT in HTML preview (the preview always shows the doc as if non-void — status-dependent variations belong in the rendered PDF).

- [ ] **Step 1: Create VoidWatermark.js**

Create `components/pdf/sections/VoidWatermark.js`:

```js
import { View, Text } from '@react-pdf/renderer';

const styles = {
  // The overlay sits inside <Page>'s body. position: 'absolute' centers it.
  // `fixed` (passed as prop on the View) tells React-PDF to replicate it
  // on every page if the doc wraps to multiple pages.
  overlay: {
    position: 'absolute',
    top: '40%',         // approximate vertical center allowing for the rotation
    left: '15%',        // pull leftward so the rotated rectangle sits centered
    transform: 'rotate(-22deg)',
    paddingHorizontal: 22,
    paddingVertical: 4,
    borderWidth: 4,
    borderColor: 'rgba(220, 38, 38, 0.18)',
    borderRadius: 6,
    width: '70%',
    alignItems: 'center',
  },
  text: {
    fontSize: 100,
    fontWeight: 900,
    color: 'rgba(220, 38, 38, 0.18)',
    letterSpacing: 8,
    textAlign: 'center',
  },
};

/**
 * Diagonal "VOID" watermark for status='void' credit memos. Hardcoded —
 * not toggleable in Designer (per spec §3.5 + §10.6).
 *
 * Rendered inside <Page> body (NOT inside the section dispatch). The composer
 * is responsible for placing this conditionally:
 *
 *   <Page wrap>
 *     {doc.is_void && <VoidWatermark />}
 *     {sections.map(...)}
 *   </Page>
 *
 * The `fixed` attribute on the outer View tells React-PDF to replicate this
 * on every page if the doc overflows (long notes/disclaimer pushing onto
 * page 2). Without `fixed`, the watermark would only appear on page 1.
 */
export default function VoidWatermark() {
  return (
    <View fixed style={styles.overlay}>
      <Text style={styles.text}>VOID</Text>
    </View>
  );
}
```

- [ ] **Step 2: Run all tests**

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass. (The component isn't unit-tested — it's a pure visual element verified in Task 18 manual smoke.)

- [ ] **Step 3: Commit**

```bash
git add components/pdf/sections/VoidWatermark.js
git commit -m "feat(pdf): VoidWatermark hardcoded overlay for void-status credit memos (FU-035-H6)"
```

---

## Task 12: Wire `credit_memo` in DocumentPreview

**Files:**
- Modify: `components/settings/document-designer/preview/DocumentPreview.js`

Register the 5 new previews + add an `address_details` override block for `credit_memo` (bill_to → customer translation, identical to Statement's). The H5 implementation set the precedent — copy it exactly.

- [ ] **Step 1: Read the existing DocumentPreview.js to understand current shape**

Read `components/settings/document-designer/preview/DocumentPreview.js`. Note:
- Where prior previews are registered (likely a `PREVIEW_BY_SECTION_ID` map or a switch dispatch).
- Where the H5 `address_details` override block lives (it does the `bill_to → customer` field translation for Statement).
- The dispatch path: `sampleDataByType[docType][sectionId]` → preview component receives that as `data` prop.

- [ ] **Step 2: Register the 5 new previews**

In `DocumentPreview.js`, add the 5 imports near the existing preview imports:

```js
import CreditMemoDetailsPreview     from './CreditMemoDetailsPreview';
import ReasonPreview                from './ReasonPreview';
import IssuedFromInvoicePreview     from './IssuedFromInvoicePreview';
import AppliedToInvoicePreview      from './AppliedToInvoicePreview';
import CreditAmountPanelPreview     from './CreditAmountPanelPreview';
```

Add the 5 new section IDs to the dispatch map. Wherever `statement_details`, `open_invoices`, etc. are mapped, append:

```js
  memo_details:        CreditMemoDetailsPreview,
  reason:              ReasonPreview,
  issued_from_invoice: IssuedFromInvoicePreview,
  applied_to_invoice:  AppliedToInvoicePreview,
  credit_amount:       CreditAmountPanelPreview,
```

(Note: `notes`, `disclaimer`, `header`, `address_details`, `footer` are already wired — they reuse existing previews from prior FUs.)

- [ ] **Step 3: Import sample data**

Find the existing sample-data imports (likely a switch or map keyed by doc type, e.g. `SAMPLE_DATA_BY_DOCUMENT_TYPE`). Add:

```js
import sampleDataCreditMemo from '../../../../lib/document-designer/sample-data-credit-memo';
```

And register:

```js
const SAMPLE_DATA_BY_DOCUMENT_TYPE = {
  // ... existing entries ...
  credit_memo: sampleDataCreditMemo,
};
```

- [ ] **Step 4: Add the address_details override block for credit_memo**

Find the H5 / Statement `address_details` override block in DocumentPreview.js. It probably looks like:

```js
// Statement-specific override: STATEMENT_SECTIONS uses `bill_to` field id;
// shared AddressDetails reads `opts.fields.customer` internally.
if (docType === 'statement' && sectionId === 'address_details') {
  const addrOpts = {
    ...opts,
    customerLabel: 'Bill To',
    fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
  };
  // ... apply addrOpts ...
}
```

Update the condition to also match `credit_memo`:

```js
if ((docType === 'statement' || docType === 'credit_memo') && sectionId === 'address_details') {
  const addrOpts = {
    ...opts,
    customerLabel: 'Bill To',
    fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
  };
  // ... apply addrOpts ...
}
```

- [ ] **Step 5: Run all tests**

Run: `node --test tests/*.mjs`
Expected: ALL existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/settings/document-designer/preview/DocumentPreview.js
git commit -m "feat(doc-designer): wire credit_memo previews + bill_to override (FU-035-H6)"
```

---

## Task 13: Build `buildSectionData` for Credit Memo + tests

**Files:**
- Create: `lib/pdf/build-credit-memo-section-data.js`
- Create: `tests/credit-memo-build-section-data.test.mjs`

Per H1's lesson learned, `buildSectionData` lives in `lib/pdf/` so the unit test runs under bare Node without a JSX transformer.

- [ ] **Step 1: Write the failing test**

Create `tests/credit-memo-build-section-data.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/credit-memo-build-section-data.test.mjs`
Expected: FAIL — `buildSectionData` not exported (import error).

- [ ] **Step 3: Create the helper**

Create `lib/pdf/build-credit-memo-section-data.js`:

```js
/**
 * Build per-section data subsets for the Credit Memo composer. Pure function;
 * exported for unit testing. Lives in lib/pdf/ so tests/ can import it
 * without a JSX-capable runner. Same pattern as
 * lib/pdf/build-{invoice,rate-con,combined-invoice,pod,statement}-section-data.js.
 *
 * For Address Details specifically, this sets `data.customer = doc.bill_to`
 * because AddressDetails.js (shared) reads `data.customer` internally. The
 * "Bill To" label is applied at the renderSection switch site (see
 * components/pdf/CreditMemoTemplate.js).
 *
 * Reason / Issued From / Applied To sections may be null — the composer's
 * switch dispatch returns null in those cases, which auto-hides them from
 * the rendered output regardless of Designer toggle (per spec §7.7).
 */
export function buildSectionData(doc) {
  const meta = doc.memo_meta || {};
  const notes = doc.notes || {};
  const reasonText = meta.reason && String(meta.reason).trim();

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},
    },
    memo_details: {
      memo_number:  meta.memo_number  ?? null,
      issue_date:   meta.issue_date   ?? null,
      applied_date: meta.applied_date ?? null,
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
      // Credit Memo has no per-load locations.
      pickup_location: null,
      delivery_location: null,
      return_location: null,
      appointment_times: null,
      is_operational_street_turn: false,
    },
    reason: reasonText ? { text: reasonText } : null,
    issued_from_invoice: doc.issued_from_invoice
      ? {
          invoice_number: doc.issued_from_invoice.invoice_number,
          invoice_date:   doc.issued_from_invoice.invoice_date,
          due_date:       doc.issued_from_invoice.due_date,
          total_cents:    doc.issued_from_invoice.total_cents,
        }
      : null,
    applied_to_invoice: doc.applied_to_invoice
      ? {
          invoice_number:       doc.applied_to_invoice.invoice_number,
          invoice_date:         doc.applied_to_invoice.invoice_date,
          balance_due_cents:    doc.applied_to_invoice.balance_due_cents,
          applied_amount_cents: doc.applied_to_invoice.applied_amount_cents,
          applied_date:         doc.applied_to_invoice.applied_date,
        }
      : null,
    credit_amount: {
      total_cents: doc.credit_amount_cents ?? 0,
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

Run: `node --test tests/credit-memo-build-section-data.test.mjs`
Expected: PASS — 16 tests pass.

- [ ] **Step 5: EOF sanity check (lesson from H5)**

Run: `tail -c 50 lib/pdf/build-credit-memo-section-data.js`
Expected: ends with `}\n` — no trailing markup. If you see anything like `</content></invoke>` strip it.

- [ ] **Step 6: Commit**

```bash
git add lib/pdf/build-credit-memo-section-data.js tests/credit-memo-build-section-data.test.mjs
git commit -m "feat(pdf): buildSectionData for Credit Memo + tests (FU-035-H6)"
```

---

## Task 14: Build `fetchCreditMemoData` + `renderCreditMemoPdf`

**Files:**
- Create: `lib/pdf/render-credit-memo.js`

NEW renderer module. Fetches memo + customer, then linked invoices (only if either FK is set), then tenant info. Uses `resolveMemoNumber()` + `computeAppliedAmount()` from Task 4.

- [ ] **Step 1: Create render-credit-memo.js**

Create `lib/pdf/render-credit-memo.js`:

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import CreditMemoTemplate from '../../components/pdf/CreditMemoTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';
import { resolveMemoNumber, computeAppliedAmount } from './credit-memo-helpers';

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

  return await renderToBuffer(
    React.createElement(CreditMemoTemplate, { doc, sectionConfig })
  );
}
```

- [ ] **Step 2: EOF sanity check**

Run: `tail -c 50 lib/pdf/render-credit-memo.js`
Expected: clean newline. Check for any `</content>` / `</invoke>` markup leak — strip if present.

- [ ] **Step 3: Run all tests as a regression check**

Run: `node --test tests/*.mjs`
Expected: PASS — all existing tests continue to pass. Note: `CreditMemoTemplate` doesn't exist yet (Task 15) — but the static import only fails at JSX time inside `renderCreditMemoPdf`, which isn't called by any test.

- [ ] **Step 4: Commit**

```bash
git add lib/pdf/render-credit-memo.js
git commit -m "feat(pdf): fetchCreditMemoData + cascade-aware renderCreditMemoPdf (FU-035-H6)"
```

---

## Task 15: Build `CreditMemoTemplate.js` composer

**Files:**
- Create: `components/pdf/CreditMemoTemplate.js`

This is the keystone integration step. After this commits, `renderCreditMemoPdf` produces a working PDF.

- [ ] **Step 1: Create components/pdf/CreditMemoTemplate.js**

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
import { buildSectionData } from '../../lib/pdf/build-credit-memo-section-data';

import Header             from './sections/Header';
import CreditMemoDetails  from './sections/CreditMemoDetails';
import AddressDetails     from './sections/AddressDetails';
import Reason             from './sections/Reason';
import IssuedFromInvoice  from './sections/IssuedFromInvoice';
import AppliedToInvoice   from './sections/AppliedToInvoice';
import CreditAmountPanel  from './sections/CreditAmountPanel';
import Notes              from './sections/Notes';
import Disclaimer         from './sections/Disclaimer';
import DocumentFooter     from './sections/DocumentFooter';
import VoidWatermark      from './sections/VoidWatermark';

// Re-export buildSectionData for any consumer that imports from this path.
export { buildSectionData } from '../../lib/pdf/build-credit-memo-section-data';

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
    case 'memo_details':
      return <CreditMemoDetails data={sectionData.memo_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Field-ID translation: CREDIT_MEMO_SECTIONS uses `bill_to`; AddressDetails reads
      // `opts.fields.customer` internally. Per-doc-type "Bill To" label is supplied via
      // opts.customerLabel here. Mirrored in DocumentPreview.js for the live HTML
      // preview path — keep the two in sync. (Same translation as Statement.)
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'reason':
      // Data-driven auto-hide: composer returns null when reason data is missing,
      // independent of Designer toggle (per spec §7.7).
      return doc.memo_meta?.reason && sectionData.reason
        ? <Reason data={sectionData.reason} colors={colors} />
        : null;
    case 'issued_from_invoice':
      return doc.issued_from_invoice && sectionData.issued_from_invoice
        ? <IssuedFromInvoice data={sectionData.issued_from_invoice} opts={opts} colors={colors} />
        : null;
    case 'applied_to_invoice':
      return doc.applied_to_invoice && sectionData.applied_to_invoice
        ? <AppliedToInvoice data={sectionData.applied_to_invoice} opts={opts} colors={colors} />
        : null;
    case 'credit_amount':
      return <CreditAmountPanel data={sectionData.credit_amount} opts={opts} colors={colors} />;
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

export default function CreditMemoTemplate({ doc, sectionConfig }) {
  const sections = getSectionsForDocumentType('credit_memo');
  const { visibility, fields } = computeVisibility(sections, sectionConfig);
  const colors = extractColors(sectionConfig);
  const order = sectionConfig?.order || sections.map((s) => s.id);
  const sectionData = buildSectionData(doc);
  const ctx = {
    variant: 'credit_memo',
    title: 'CREDIT MEMO',
    subtitle: doc.memo_meta?.memo_number || '',
  };

  return (
    <Document>
      <Page size="LETTER" style={typography.page} wrap>
        {/* VOID watermark layered behind/over the section body for void-status memos.
            <View fixed> ensures it replicates on every page if the doc overflows
            (long notes/disclaimer pushing onto page 2). Hardcoded — not section-toggleable. */}
        {doc.is_void && <VoidWatermark />}
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

- [ ] **Step 2: EOF sanity check**

Run: `tail -c 50 components/pdf/CreditMemoTemplate.js`
Expected: clean newline. Check for any `</content>` / `</invoke>` markup leak — strip if present.

- [ ] **Step 3: Run all tests**

Run: `node --test tests/*.mjs`
Expected: PASS — all existing tests still green.

- [ ] **Step 4: Commit**

```bash
git add components/pdf/CreditMemoTemplate.js
git commit -m "feat(pdf): CreditMemoTemplate composer with VOID-watermark dispatch (FU-035-H6)"
```

---

## Task 16: Build the download endpoint

**Files:**
- Create: `pages/api/tenant/pdf/credit-memo/[memoId].js`

NEW endpoint: `GET /api/tenant/pdf/credit-memo/[memoId]` returns the rendered Credit Memo as `application/pdf`.

- [ ] **Step 1: Create the endpoint**

Create `pages/api/tenant/pdf/credit-memo/[memoId].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderCreditMemoPdf } from '../../../../../lib/pdf/render-credit-memo';

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

  const { memoId } = req.query;
  const svc = getServiceClient();

  try {
    const buffer = await renderCreditMemoPdf(svc, memoId, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="credit-memo-${memoId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Credit memo not found') {
      return res.status(404).json({ error: 'Credit memo not found' });
    }
    console.error(`Credit memo ${memoId} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

- [ ] **Step 2: Run all tests as a regression check**

Run: `node --test tests/*.mjs`
Expected: PASS — all existing tests continue to pass. The new endpoint isn't covered by unit tests; manual smoke verifies in Task 18.

- [ ] **Step 3: Commit**

```bash
git add pages/api/tenant/pdf/credit-memo/[memoId].js
git commit -m "feat(api): GET /api/tenant/pdf/credit-memo/[memoId] download endpoint (FU-035-H6)"
```

---

## Task 17: Add "PDF" link in CreditMemosTab

**Files:**
- Modify: `components/ar/CreditMemosTab.js`

Tiny 10px text link in the row's Actions cell, left of the existing Void link. Always visible regardless of memo status (voided memos render with the VOID watermark).

- [ ] **Step 1: Read the existing CreditMemosTab.js**

Read `components/ar/CreditMemosTab.js`. Find the `<td>` for the Actions column inside the table body — currently looks roughly like:

```jsx
<td className="px-4 py-2.5">
  {m.status === 'draft' && (
    <button onClick={() => { if (confirm('Void this credit memo?')) handleAction(m.id, 'void'); }}
      className="text-[10px] font-semibold text-red-500 dark:text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
      Void
    </button>
  )}
</td>
```

- [ ] **Step 2: Add the PDF link before the Void button**

Update the Actions `<td>` to:

```jsx
<td className="px-4 py-2.5">
  <a
    href={`/api/tenant/pdf/credit-memo/${m.id}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 hover:text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40 mr-1"
  >
    PDF
  </a>
  {m.status === 'draft' && (
    <button onClick={() => { if (confirm('Void this credit memo?')) handleAction(m.id, 'void'); }}
      className="text-[10px] font-semibold text-red-500 dark:text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40">
      Void
    </button>
  )}
</td>
```

The `mr-1` margin-right on the PDF link gives a small gap before Void.

- [ ] **Step 3: Verify the build doesn't break**

Run: `node --test tests/*.mjs`
Expected: PASS — no test regressions. UI changes aren't unit-tested; verification is via Task 18's Chrome MCP smoke.

- [ ] **Step 4: Commit**

```bash
git add components/ar/CreditMemosTab.js
git commit -m "feat(ar): per-row PDF link in CreditMemosTab (FU-035-H6)"
```

---

## Task 18: Manual verification via Chrome MCP subagent + dd-qa

This task has minimal code changes — it's the manual smoke pass. Uses the Chrome MCP subagent (`mcp__Claude_in_Chrome__*`) for DOM-aware testing, same as H4/H5 final tasks.

- [ ] **Step 1: Run all unit tests one more time**

Run: `node --test tests/*.mjs`
Expected: ALL pass — DO + Invoice + Rate Con + Combined + POD + Statement + new Credit Memo tests + pre-existing fire-trigger failure (unrelated, expected).

- [ ] **Step 2: Confirm dev server is running**

Ask the user the dev-server URL (e.g., `http://localhost:58973`). Verify it's up by hitting `/api/health`.

- [ ] **Step 3: Dispatch a Chrome MCP subagent to verify the Document Designer UI**

Subagent prompt should:
1. Use `mcp__Claude_in_Chrome__navigate` to open `http://localhost:<port>/settings/document-designer?type=credit_memo`
2. Use `mcp__Claude_in_Chrome__read_page` to verify the toggle list shows 10 sections in order: Header, Credit Memo Details, Address Details, Reason, Issued From Invoice, Applied To Invoice, Credit Amount, Notes, Terms & Conditions, Footer
3. Verify the right-pane preview renders the Credit Memo sample data (applied state):
   - Header with logo placeholder + tenant info + "CREDIT MEMO" title + memo number subtitle
   - Credit Memo Details: Memo # CM-2026-014, Issue Date Apr 27 2026, Applied Date Apr 28 2026
   - Bill To block with SAMPLE BILL TO + 500 Customer Plaza
   - Reason callout (amber-tinted): "Overcharge on chassis days for load LD-2026-7821..."
   - Issued From Invoice card (blue-bordered): INV-2026-091 + $2,485.00 + Issued Apr 18 · Due May 18
   - Applied To Invoice card (green-bordered): INV-2026-103 + Bal $1,420.00 + Issued Apr 25 · Reduced by $400.00 on Apr 28
   - Credit Amount panel (green, right-aligned): $400.00
   - Notes section NOT visible (defaults OFF)
   - Footer
4. Use `mcp__Claude_in_Chrome__find` + click on the "Reason" toggle. Verify the amber callout disappears from the preview.
5. Click "Issued From Invoice" toggle. Verify the blue card disappears.
6. Click the "Applied Date" leaf inside Applied To Invoice. Verify the "on Apr 28" suffix disappears from the meta line.
7. Read console + network — flag any 4xx/5xx responses or red errors.
8. NO SCREENSHOTS (per H4/H5 lesson — image-size limit).

- [ ] **Step 4: Test the PDF download link in CreditMemosTab**

Navigate to `http://localhost:<port>/ar` and click into the "Credit Memos" tab. Pick a real memo (or create one via the existing "New Credit Memo" button if none exist). Click the small "PDF" link in the row's Actions cell.

Verify:
- A new tab opens with `/api/tenant/pdf/credit-memo/<memoId>`
- The PDF renders correctly: Header + Credit Memo Details + Bill To + Reason (if present) + Credit Amount + Footer
- If the memo has `invoice_id` set, the Issued From Invoice card shows correct INV# / total
- If the memo has `applied_to_invoice_id` set (status='applied'), the Applied To Invoice card shows correct details

- [ ] **Step 5: Test the void state**

Find an existing memo in status='draft'. Use the "Void" link in CreditMemosTab to void it (or directly UPDATE in psql). Re-click the PDF link. Verify:
- The PDF still renders (no 404, no 500).
- A large diagonal "VOID" watermark is visible across the page (rotated -22°, semi-transparent red).
- Otherwise the doc looks identical to the non-void render.

- [ ] **Step 6: Test the standalone-draft state (both invoice FKs null)**

Create a brand-new credit memo via the "New Credit Memo" button without specifying an invoice (the create form doesn't ask for one — `invoice_id` will be NULL). Click PDF. Verify:
- Issued From Invoice section is absent (no blue card).
- Applied To Invoice section is absent (no green card).
- Credit Amount panel still shows green.
- Reason section shows IF the memo has a reason; absent otherwise.

- [ ] **Step 7: Regression check — print prior doc types**

Verify the 7 existing doc types still render unchanged:
- `/settings/document-designer?type=delivery_order_full`
- `/settings/document-designer?type=delivery_order_next_move`
- `/settings/document-designer?type=invoice`
- `/settings/document-designer?type=rate_con`
- `/settings/document-designer?type=combined_invoice`
- `/settings/document-designer?type=pod`
- `/settings/document-designer?type=statement`

All previews should load without console errors.

- [ ] **Step 8: Per-customer override test**

In `/settings/document-designer?type=credit_memo`, switch the customer dropdown to a specific customer. Edit the accent color (e.g., red). Save. Switch back to "All Customers" → tenant default's accent is unchanged. Verify isolation.

- [ ] **Step 9: Run dd-qa skill**

```
/dd-qa
```

Address any findings.

- [ ] **Step 10: Optional commit verification artifacts**

```bash
git commit --allow-empty -m "docs: FU-035-H6 manual verification artifacts"
```

If nothing to commit, skip.

---

## Task 19: Close FU-035-H6 in followups.md

**Files:**
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\followups.md`
- Modify: `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`

- [ ] **Step 1: Update FU-035-H6 entry in followups.md**

Find the FU-035-H6 sub-bullet (after the resolved H5 entry). Replace its content with a resolved-style summary:

```
  - **FU-035-H6 Credit Memo** — ✅ Resolved YYYY-MM-DD. NEW doc type (no legacy template existed). CREDIT_MEMO_SECTIONS (10 sections, ~26 leaf toggles). NEW component pairs: CreditMemoDetails (3-col grid), Reason (amber callout), IssuedFromInvoice (blue-bordered card), AppliedToInvoice (green-bordered card), CreditAmountPanel (right-aligned green panel). NEW non-toggleable element: VoidWatermark (diagonal "VOID" overlay, hardcoded, rendered when status='void'). Reuses 5 components from prior FUs unchanged (Header, AddressDetails, Notes, Disclaimer, DocumentFooter). NEW download endpoint GET /api/tenant/pdf/credit-memo/[memoId] (Permission: ACCOUNTS_RECEIVABLE/ALL). NEW pure helpers `lib/pdf/credit-memo-helpers.js` (resolveMemoNumber + computeAppliedAmount) with unit tests. NEW per-row "PDF" text link in components/ar/CreditMemosTab.js Actions cell (always visible regardless of status). Public `renderCreditMemoPdf(svc, memoId, tenantId)` signature. Cascade by `customer_id`. Conditional auto-hide for Reason / Issued From / Applied To sections when their data field is null. Spec docs/superpowers/specs/2026-04-28-fu-035-h6-credit-memo-document-designer-design.md, plan docs/superpowers/plans/2026-04-28-fu-035-h6-credit-memo-document-designer.md. ~19 commits. New tests: 5 files, ~50 unit tests. Architecture milestone: Document Designer pattern now proven across **8 distinct doc-type registries** (DO Full + DO Next-Move + Invoice + Rate Con + Combined Invoice + POD + Statement + Credit Memo). Send-email + auto-numbering + persisted applied amount deferred to FU-035-H6-followup-A/B/C/D.
```

(Use today's date — `git log -1 --format=%cd` if needed.)

- [ ] **Step 2: Append new FU-035-H6 follow-ups**

After the last existing FU-035-H5-followup-F block:

```
### FU-035-H6-followup-A: Integration smoke for renderCreditMemoPdf
- Source: FU-035-H6 spec §12
- Scope: small
- Area: pdf / tests
- Intent: Add a Supabase-mock-backed integration test that calls `renderCreditMemoPdf` with a stubbed svc client (returning the 4 query results that `fetchCreditMemoData` expects), runs `renderToBuffer`, and asserts the returned Buffer starts with the PDF magic bytes (`%PDF-`). Currently only manual smoke verifies the renderer end-to-end.
- Notes: Pairs with FU-035-H1-followup-A through H5-followup-C. Apply across **6 renderers** at this point. Eventually batch into a single shared test utility — `tests/_shared/integration-smoke-helpers.mjs` — and add one tiny call-site test per renderer.

### FU-035-H6-followup-B: Auto-generate memo_number on credit_memos insert
- Source: FU-035-H6 spec §2 (Non-Goals) + §13 R3
- Scope: small
- Area: ar / db
- Intent: Currently 100% of credit_memos rows have memo_number = NULL because the create form doesn't capture it. Add a tenant-scoped sequence (`CM-{tenant-prefix}-{yyyy}-{nnnn}`) generated server-side on insert, and backfill existing nulls. Updates the create form / POST endpoint to display the generated number in the success response.
- Notes: Mirrors the auto-generate pattern used elsewhere (e.g., invoice numbers from FU-019-era infra). After this lands, the renderer's CM-{id:0:8} fallback path becomes a degenerate edge case for corrupted rows only.

### FU-035-H6-followup-C: Persist applied_amount_cents on credit_memos
- Source: FU-035-H6 spec §13 R1 + Task 4
- Scope: small
- Area: ar / db / pdf
- Intent: Add `applied_amount_cents INTEGER` column to credit_memos via migration. Backfill from PUT-action history (best-effort) — for memos where applied_to_invoice_id is set, compute as `min(amount_cents, applied_to_invoice.total_amount_cents_at_apply_time)` from audit log if available, else use the current `min(amount_cents, total_amount_cents)`. Update PUT /apply endpoint to write the column directly. Switch render-credit-memo.js to read the column instead of computing — eliminates the historical-balance approximation drift.
- Notes: Schema change is small. Backfill is the work. Long-term cleanup of the FU-035-H6 R1 risk.

### FU-035-H6-followup-D: Send-email infrastructure for AR doc-types (POD + Statement + Credit Memo)
- Source: FU-035-H6 spec §2 (Non-Goals); supersedes FU-035-H4-followup-B + FU-035-H5-followup-A
- Scope: large
- Area: pdf / api / ar
- Intent: Build single + bulk send-email for the three deferred AR doc types in one focused FU. Avoids the inconsistency of "Send Email available for credit memo but not POD or Statement." New endpoints (per doc type):
    - `POST /api/tenant/pdf/<doctype>/[id]/send-email` — single send
    - `POST /api/tenant/pdf/<doctype>/bulk-send-emails` — bulk send
  Shared module `lib/pdf/send-doc-email.js` with per-doc-type subject + body templates. Permission gate: ACCOUNTS_RECEIVABLE + EMAIL_OUTBOUND. UI integration: Send button next to existing Download/PDF buttons + bulk-action page. **This single FU closes H4-followup-B + H5-followup-A + the H6 send-email gap together.**
- Notes: ~6-8 hour effort total. Highest-impact follow-up across the H-series.
```

- [ ] **Step 3: Update MEMORY.md ledger summary**

Read `C:\Users\bento\.claude\projects\C--Users-bento-app-drayagedirect\memory\MEMORY.md`. Find the "Last audited" line for `followups.md`. Replace its content with a paragraph summarizing the H6 work (mirror the H5 summary's structure):

```
- **[followups.md](followups.md) — open follow-ups across all sessions. Check FIRST.** Last audited YYYY-MM-DD (HEAD `<commit>` — FU-035-H6 Credit Memo Document Designer shipped: ~19 commits introducing a brand-new Credit Memo doc type to the section-registry-driven Document Designer. CREDIT_MEMO_SECTIONS (10 sections, ~26 leaf toggles). 5 NEW section component pairs (CreditMemoDetails, Reason, IssuedFromInvoice, AppliedToInvoice, CreditAmountPanel) + 1 NEW non-toggleable element (VoidWatermark). Reuses 5 components from prior FUs. NEW download endpoint `GET /api/tenant/pdf/credit-memo/[memoId]` (Permission: ACCOUNTS_RECEIVABLE/ALL). NEW pure helpers `lib/pdf/credit-memo-helpers.js`. NEW per-row "PDF" link in CreditMemosTab. Public `renderCreditMemoPdf(svc, memoId, tenantId)` signature. Cascade by `customer_id`. Conditional auto-hide for Reason / Issued From / Applied To sections when data is null. **Architecture milestone: Document Designer pattern now proven across 8 distinct doc-type registries (DO Full + DO Next-Move + Invoice + Rate Con + Combined Invoice + POD + Statement + Credit Memo).** New cleanup FUs filed: H6-followup-A (integration smoke — applies to 6 renderers now), H6-followup-B (auto-generate memo_number), H6-followup-C (persist applied_amount_cents), H6-followup-D (consolidated send-email FU for POD + Statement + Credit Memo, supersedes H4-followup-B + H5-followup-A). Outstanding H sub-FUs: H7-H9 (Quote, Aging Report, Driver Settlement) + FU-035-G (watermark + disclaimer rich-text + named configs).
```

(Use today's date and the actual HEAD commit.)

- [ ] **Step 4: Run /update-followups skill if available, otherwise commit manually**

```bash
git add C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/followups.md C:/Users/bento/.claude/projects/C--Users-bento-app-drayagedirect/memory/MEMORY.md
git commit -m "chore: FU-035-H6 Credit Memo Document Designer migration complete"
```

- [ ] **Step 5: Final regression check**

Run: `node --test tests/*.mjs`
Expected: ALL pass except pre-existing fire-trigger failure (unrelated). Total file count ≈ +5 new files. Total test count ≈ +50.

---

## Self-review notes

**Spec coverage scan:**

- Spec §3.1 Independent registry → Task 2 ✓
- Spec §3.2 Cascade resolver → Task 14 ✓ (`resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, 'credit_memo')`)
- Spec §3.3 NEW doc type (no legacy migration) → all tasks build from scratch ✓
- Spec §3.4 Public renderer signature `renderCreditMemoPdf(svc, memoId, tenantId)` → Task 14 ✓
- Spec §3.5 5 new toggleable components + 1 hardcoded VoidWatermark → Tasks 6-11 ✓
- Spec §3.6 Single-page layout with `wrap` → Task 15 (`<Page wrap>`) ✓
- Spec §3.7 No eligibility gate → Task 16 (endpoint doesn't filter by status) ✓
- Spec §4 File touch list → all 23 new files + 3 modified files covered across Tasks 1-17 ✓
- Spec §5 CREDIT_MEMO_SECTIONS registry → Task 2 ✓
- Spec §6 DOCUMENT_TYPES entry → Task 1 ✓
- Spec §7.1 Memo + customer fetch → Task 14 ✓
- Spec §7.2 Linked invoices fetch → Task 14 ✓
- Spec §7.3 Applied-amount calculation → Task 4 ✓
- Spec §7.4 Memo-number fallback → Task 4 ✓
- Spec §7.5 Renderer data shape → Task 14 ✓
- Spec §7.6 Status / void rendering → Task 11 + Task 15 (composer dispatch) ✓
- Spec §7.7 Empty / null state behavior → Task 13 (build*) + Task 15 (composer dispatch) ✓
- Spec §8 Composer dispatch → Task 15 ✓
- Spec §9 Renderer (full code listing) → Task 14 ✓
- Spec §10.1-10.6 Component breakdown → Tasks 6-11 ✓
- Spec §10.7 HTML previews (5 of them, no preview for VoidWatermark) → Tasks 6-10 ✓
- Spec §10.8 PDF link in CreditMemosTab → Task 17 ✓
- Spec §11 Endpoint → Task 16 ✓
- Spec §12 Test plan (5 unit-test files + manual verification) → Tasks 1-4 + 13 + 18 ✓
- Spec §13 Risks (R1-R6) → R1 documented in Task 4 + spec; R2 mitigation in Task 11 + Task 15 (`<View fixed>`); R3 documented in spec only (no code work); R4 documented in Task 15 jsdoc; R5 covered by Task 14's customer.deleted_at filter; R6 covered by Task 4 unit tests ✓
- Spec §14 Follow-ups (A-D) → Task 19 ✓

No gaps.

**Placeholder scan:** Searched for "TBD", "TODO", "fill in", "implement later". None found in the body. The follow-up entries in Task 19 say "Use today's date" / "Use the actual HEAD commit" — those are runtime substitutions, not plan placeholders.

**Type / signature consistency:**

- `renderCreditMemoPdf(svc, memoId, tenantId)` defined in Task 14, used in Task 16. Match ✓
- `fetchCreditMemoData` returns `{ memo_id, status, is_void, ..., memo_meta: {memo_number, issue_date, applied_date, reason}, issued_from_invoice|null, applied_to_invoice|null, credit_amount_cents, ... }`. Used by `buildSectionData` in Task 13 + composer in Task 15. Match ✓
- `buildSectionData` returns `{ header, memo_details, address_details, reason|null, issued_from_invoice|null, applied_to_invoice|null, credit_amount, notes, disclaimer|null }`. Match composer dispatch in Task 15 ✓
- `resolveMemoNumber(memo)` + `computeAppliedAmount(memo, invoice)` defined in Task 4, used in Task 14. Match ✓
- `CREDIT_MEMO_SECTIONS` exported in Task 2, used by `getSectionsForDocumentType('credit_memo')` in Task 15 + by `validateSectionConfig` test in Task 3 + by sample-data registration in Task 12. Match ✓
- `VoidWatermark` exported in Task 11, used in Task 15 composer dispatch. Match ✓

No type drift across tasks.

**Sample data coverage:** Task 5's `sample-data-credit-memo.js` covers the 9 toggleable section IDs (`memo_details`, `address_details`, `reason`, `issued_from_invoice`, `applied_to_invoice`, `credit_amount`, `notes`, `disclaimer`, plus the implicit `header`). VoidWatermark / `footer` aren't keyed because they're not dispatched through sampleData.

**Scope check:** 19 tasks (vs H5's 17). Two extra tasks: Task 7 (Reason — H5 didn't have a Reason section) and Task 11 (VoidWatermark — H5 didn't have a hardcoded overlay). Each task is bite-sized (5-min target). No task exceeds ~150 lines of new code.

**Lessons-from-H5 incorporated:**

- ✓ Task 5 sample data keyed by section ID (with explicit comment about the H5 trap)
- ✓ Task 5 + 13 + 14 + 15 EOF sanity check (`tail -c 50`) for Write-tool markup leak
- ✓ Task 14 verifies the customer-table column existence by reading `supabase/migrations/064_ar_module_expansion.sql` — but in practice we already did this during brainstorming, so the SELECT in Task 14 is correct (no joining surprises like H5's invoices.customer_reference)
- ✓ Task 15 jsdoc on the auto-hide composer dispatch documents the data-driven precedence

**Ambiguity check:** None remaining.
