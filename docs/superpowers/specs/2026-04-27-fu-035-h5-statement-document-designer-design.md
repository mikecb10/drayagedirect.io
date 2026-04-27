# FU-035-H5: Statement Document Designer — Design Spec

**Status:** Draft → user review pending
**Author:** Claude (brainstorming session 2026-04-27)
**Predecessors:** FU-035-D/D2 (designer foundation), FU-035-H1 (Invoice), H2 (Rate Con), H3 (Combined Invoice), H4 (POD)

---

## 1. Goal

Add a brand-new **Statement of Account** doc type to the Document Designer + a download endpoint (`GET /api/tenant/pdf/statement/[customerId]?asOfDate=YYYY-MM-DD`) + a minimal "Generate Statement" trigger on the customer detail page.

A Statement is an Open-Balance snapshot listing all unpaid invoices for one customer as of a chosen date, with aging-bucket summary and total outstanding.

## 2. Non-Goals (deferred to follow-ups)

- **Send-email infrastructure** (single + bulk) — deferred to `FU-035-H5-followup-A` (parallel to H4-followup-B for POD).
- **Persisted statement records** — statements are computed on-the-fly per request; no `statements` table. Persistence (and statement_number assignment) deferred to a future FU.
- **Bulk-generate UI** — "select N customers, batch download as ZIP" is `FU-035-H5-followup-B`.
- **Aging bucket customization** — buckets stay fixed at `Current / 1-30 / 31-60 / 61-90 / 90+` from the existing `getAgingBucket()` utility. Tenant-defined buckets is a separate FU.
- **Transaction-log statement** (Pattern B from brainstorm: opening balance + activity + closing balance) — Pattern A (open balance) only in v1.
- **Combined invoice splitting** — consolidated invoices show as one line, not child charge sets.
- **Watermark / disclaimer rich-text / named configs** — covered by FU-035-G.

## 3. Architecture

### 3.1 Independent registry (mirrors H4 POD pattern)

`STATEMENT_SECTIONS` is a sibling registry alongside `DELIVERY_ORDER_SECTIONS`, `INVOICE_SECTIONS`, `RATE_CON_SECTIONS`, `COMBINED_INVOICE_SECTIONS`, `POD_SECTIONS` in `lib/constants/document-sections.js`. After H5 lands, the file holds **6 doc-type registries** — at this point splitting into per-doc-type files (`FU-035-H3-followup-B`) becomes increasingly important.

### 3.2 Cascade resolver

Cascade keyed on `customer_id` (the Bill To customer). Same pattern as Invoice / Combined Invoice / POD — `resolveTemplateConfig(svc, tenantId, customerId, 'statement')`.

### 3.3 No legacy template (NEW doc type)

Same as POD — there is no existing hardcoded React-PDF template to migrate. We build the registry, sample data, fetcher, composer, endpoint, and minimal UI from scratch.

### 3.4 Public renderer signature

```js
renderStatementPdf(svc, customerId, tenantId, asOfDate)
```

`asOfDate` is a `Date` (or ISO string `'YYYY-MM-DD'`); fetcher coerces and uses `now()` if null/undefined. Throws `Error('Customer not found')` on missing/wrong-tenant. No peek-and-delegate (Statement is its own renderer, not delegated from another).

### 3.5 Component reuse + new components

**Reused unchanged from prior FUs:** Header, AddressDetails (with `customerLabel="Bill To"` translation), Notes, Disclaimer, DocumentFooter.

**New component pairs (PDF + HTML preview):**

- **StatementDetails** — 2-field grid: as_of_date, account_number. Mirrors PodDetails / RateConDetails 3-col grid pattern.
- **OpenInvoicesTable** — accent-banded header + 7-column table (Invoice #, Inv. Date, Due Date, Days Past Due, PO #, Original, Balance Due) + empty-state "(No outstanding invoices)". Mirrors LoadsSummary + AttachedDocuments.
- **AgingSummary** — 5-bucket horizontal grid (Current / 1-30 / 31-60 / 61-90 / 90+) with color-coded panels (green / amber / red / grey / dark-red). NEW pattern; no equivalent in prior FUs.
- **TotalOutstanding** — accent-bg panel with single right-aligned currency label. NEW pattern.

### 3.6 Single-page layout

Statement renders on a single Letter page in 95%+ of cases (typical drayage customers carry 5–20 open invoices). For >20 invoices the React-PDF `wrap` attribute on `<Page>` handles overflow naturally — no special pagination logic in v1.

### 3.7 No eligibility gate

Any customer with at least one row in `customers` for the tenant can have a statement generated, including those with zero outstanding balance (empty-state rendering — see §7.4).

---

## 4. File Touch List

### New files

| Path | Purpose |
|---|---|
| `lib/constants/document-sections.js` | Append `STATEMENT_SECTIONS` constant + `statement: STATEMENT_SECTIONS` to `SECTIONS_BY_DOCUMENT_TYPE` |
| `lib/constants/document-types.js` | Append `'statement'` entry (category: `'ar'`) |
| `lib/document-designer/sample-data-statement.js` | Sample data for the live preview |
| `lib/pdf/build-statement-section-data.js` | Pure-JS data shaper |
| `lib/pdf/render-statement.js` | Fetcher (`fetchStatementData`) + renderer (`renderStatementPdf`) + `computeAging(invoices, asOfDate)` helper |
| `components/pdf/StatementTemplate.js` | React-PDF composer |
| `components/pdf/sections/StatementDetails.js` | New section component |
| `components/pdf/sections/OpenInvoicesTable.js` | New section component |
| `components/pdf/sections/AgingSummary.js` | New section component |
| `components/pdf/sections/TotalOutstanding.js` | New section component |
| `components/settings/document-designer/preview/StatementDetailsPreview.js` | HTML preview |
| `components/settings/document-designer/preview/OpenInvoicesTablePreview.js` | HTML preview |
| `components/settings/document-designer/preview/AgingSummaryPreview.js` | HTML preview |
| `components/settings/document-designer/preview/TotalOutstandingPreview.js` | HTML preview |
| `pages/api/tenant/pdf/statement/[customerId].js` | GET endpoint |
| `tests/document-types-constants-statement.test.mjs` | Registry registration |
| `tests/document-sections-statement-constants.test.mjs` | STATEMENT_SECTIONS shape |
| `tests/validate-section-config-statement.test.mjs` | Validator field-ID isolation |
| `tests/statement-build-section-data.test.mjs` | Data shaper |
| `tests/statement-compute-aging.test.mjs` | Aging computation correctness |

### Modified files

| Path | Change |
|---|---|
| `tests/document-types-constants.test.mjs` | Update exhaustive list to 7 entries |
| `components/settings/document-designer/preview/DocumentPreview.js` | Register 4 new previews + override block for `statement`'s address_details (bill_to → customer translation) |
| `components/customers/<customer detail UI>` | Add "Generate Statement" button → modal with as-of-date picker → opens download URL in new tab. **Implementer must explore the existing customer detail UI to choose the right insertion point during plan writing.** |

---

## 5. STATEMENT_SECTIONS Registry

9 sections, ~20 leaf toggles.

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
      { id: 'as_of_date',       label: 'As of Date',      defaultVisible: true },
      { id: 'account_number',   label: 'Account Number',  defaultVisible: true },
    ],
  },
  {
    id: 'address_details',
    label: 'Address Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'bill_to',          label: 'Bill To',         defaultVisible: true },
      { id: 'phone',            label: 'Phone',           defaultVisible: true },
      { id: 'email',            label: 'Email',           defaultVisible: true },
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
    // No leaf fields — buckets are fixed by the getAgingBucket() utility (Current/1-30/31-60/61-90/90+).
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

`SECTIONS_BY_DOCUMENT_TYPE` adds: `statement: STATEMENT_SECTIONS`.

---

## 6. DOCUMENT_TYPES entry

```js
{
  value: 'statement',
  label: 'Statement of Account',
  description: 'Customer statement listing outstanding invoices and aging',
  category: 'ar',  // AR-side artifact, like Invoice / Combined Invoice
}
```

After H5: 7 entries total.

---

## 7. Data Behavior

### 7.1 Eligible invoices

Fetched by `fetchStatementData`:

```sql
SELECT id, invoice_number, customer_reference,
       invoice_date, due_date, payment_terms_days,
       total_amount_cents, balance_due_cents,
       status, is_consolidated
FROM invoices
WHERE tenant_id = ?
  AND customer_id = ?
  AND deleted_at IS NULL
  AND status NOT IN ('void', 'draft')
  AND balance_due_cents > 0
  AND invoice_date <= asOfDate
ORDER BY invoice_date ASC
```

**Excluded:** soft-deleted, voided, draft, fully-paid (`balance_due_cents = 0`), invoices dated AFTER `asOfDate`.

**Sort order:** `invoice_date ASC` — oldest at top (accounting convention; surfaces collection-priority items first).

**Consolidated invoices:** one row per `invoices.id`, regardless of `is_consolidated`. Customer received the consolidated invoice; statement reflects that.

### 7.2 Aging computation

`computeAging(invoices, asOfDate)` is a pure helper in `lib/pdf/render-statement.js`:

```js
function computeAging(invoices, asOfDate) {
  const buckets = { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
  for (const inv of invoices) {
    const daysPastDue = Math.floor((asOfDate - new Date(inv.due_date)) / (1000 * 60 * 60 * 24));
    if (daysPastDue <= 0)        buckets.current      += inv.balance_due_cents;
    else if (daysPastDue <= 30)  buckets.days_1_30    += inv.balance_due_cents;
    else if (daysPastDue <= 60)  buckets.days_31_60   += inv.balance_due_cents;
    else if (daysPastDue <= 90)  buckets.days_61_90   += inv.balance_due_cents;
    else                         buckets.days_90_plus += inv.balance_due_cents;
  }
  return buckets;
}
```

Note: this is duplicated logic from `lib/ar-utils.js`'s `getAgingBucket()` — both must agree. The plan must add a regression test that asserts they produce identical bucket assignments for the same `due_date` + `asOfDate` pair. (Cleanup-FU candidate: factor into a single shared helper post-H5.)

### 7.3 Days Past Due display

For each invoice row, the `days_past_due` field is computed at fetch time:

```
daysPastDue = floor((asOfDate - due_date) / 1 day)
```

Rendered:
- `<= 0`  → "Current" (green)
- `1-30`  → "X days" (amber)
- `31-60` → "X days" (red)
- `61-90` → "X days" (red)
- `> 90`  → "X days" (dark red)

Color thresholds wired in the section component, not the data layer.

### 7.4 Empty state ($0 outstanding)

If the eligible invoice query returns 0 rows:
- Statement still renders (no 404).
- Open Invoices section shows "(No outstanding invoices)" italicized empty row (mirrors AttachedDocuments empty state).
- Aging Summary boxes all show $0.00.
- Total Outstanding panel shows $0.00.
- This is a useful "your account is current" affirmation document.

### 7.5 Renderer data shape

`fetchStatementData` returns:

```js
{
  customer_id: '<uuid>',
  tenant_name: '<string>',
  tenant_info: { logo_url, address, phone, website },
  bill_to: { name, address_line1, address_line2, city, state, zip },
  customer_contact: { phone, email },
  customer_account_number: '<string|null>',
  bill_to_customer_id: '<uuid>',  // for cascade resolution
  statement_meta: {
    as_of_date: 'Apr 27, 2026',  // formatted
    account_number: 'CUST-WMT-0042',  // e.g., short_name fallback
  },
  open_invoices: [
    {
      invoice_id, invoice_number, invoice_date, due_date, days_past_due,
      customer_reference,
      original_amount_cents, balance_due_cents,
    },
    ...
  ],
  aging: {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  },
  total_outstanding_cents: 0,
}
```

Note: `customer_account_number` source — per the brainstorm, customers don't have a dedicated account number column. Use the customer `short_name` field as the displayed account number (already exists in the `customers` table). If `short_name` is null, fall back to the customer's UUID first 8 chars (`CUST-{uuid:0:8}`). Implementers can revisit this when a real `account_number` column is added in a future migration.

---

## 8. Composer (StatementTemplate.js)

Standard pattern matching PodTemplate / RateConTemplate / etc. Switch dispatch over 9 section IDs:

```js
function renderSection(sectionId, doc, sectionData, opts, ctx, colors) {
  switch (sectionId) {
    case 'header':            // Header (with title='STATEMENT', subtitle='OF ACCOUNT')
    case 'statement_details': // StatementDetails
    case 'address_details':   // AddressDetails (with bill_to → customer translation)
    case 'open_invoices':     // OpenInvoicesTable
    case 'aging_summary':     // AgingSummary
    case 'total_outstanding': // TotalOutstanding
    case 'notes':             // Notes (with payment_instructions + custom_notes fields)
    case 'disclaimer':        // Disclaimer
    case 'footer':            // DocumentFooter
  }
}
```

`ctx`: `{ variant: 'statement', title: 'STATEMENT', subtitle: 'OF ACCOUNT' }`.

---

## 9. Renderer (render-statement.js)

```js
export async function fetchStatementData(svc, customerId, tenantId, asOfDate) {
  const asOf = asOfDate ? new Date(asOfDate) : new Date();
  // 1. Customer (1 query)
  // 2. Eligible invoices (1 query, filtered + ordered)
  // 3. Tenant + tenant_settings (2 queries)
  // 4. compute aging in JS, format dates
  // returns the shape from §7.5
}

export async function renderStatementPdf(svc, customerId, tenantId, asOfDate) {
  const doc = await fetchStatementData(svc, customerId, tenantId, asOfDate);
  if (!doc) throw new Error('Customer not found');
  const sectionConfig = await resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, 'statement');
  return await renderToBuffer(React.createElement(StatementTemplate, { doc, sectionConfig }));
}
```

4 queries total (vs POD's 5). No moves/events — statement is invoice-centric.

---

## 10. Component Breakdown

### 10.1 StatementDetails (§3.5)

2-field 3-col grid (3 col with one cell empty for visual symmetry — or 2-col, implementer's call).

### 10.2 OpenInvoicesTable

Accent-banded header. 7-column table. Color-coded "Days Past Due" cell (text color only, not background — readability). Empty-state row.

### 10.3 AgingSummary

Horizontal 5-grid layout. Each cell: bucket label (uppercase) + amount (large bold). Color palette:
- Current: green-50 bg, green-700 text
- 1-30: amber-50 bg, amber-700 text
- 31-60: red-50 bg, red-700 text
- 61-90: gray-50 bg, gray-500 text (visually muted; 61-90 is uncommon)
- 90+: red-50 bg, red-900 text, **2px red border** (emphasis)

### 10.4 TotalOutstanding

Right-aligned panel. Accent-color background. Label "TOTAL OUTSTANDING" + large currency. Mirrors the existing rate-con totals row but as a standalone block.

### 10.5 HTML previews

One `*Preview.js` for each new section component. Visual parity required — same field IDs in the same FIELD_ORDER constant; same skip-empty logic; same accent-color fallback.

### 10.6 "Generate Statement" UI button

Insertion point: customer detail page. **Implementer must explore during plan writing** — likely candidates:
- `pages/tenant/customers/[id].js` (if it exists)
- A modal opened from the customer list

Behavior:
1. Button labeled "Generate Statement" with a document icon.
2. On click → opens a small modal (or popover):
   - Date picker (default: today)
   - "Download PDF" button
3. "Download PDF" opens `/api/tenant/pdf/statement/${customerId}?asOfDate=${YYYY-MM-DD}` in a new tab.
4. Loading spinner is not needed (the browser shows the standard download spinner).

Reuse existing modal/picker components from the AR codebase. ~30 lines of UI code.

---

## 11. Endpoint

```js
// pages/api/tenant/pdf/statement/[customerId].js

import { requireTenantUser, requirePermission, getServiceClient } from '...';
import { PERMISSIONS } from '...';
import { renderStatementPdf } from '...';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { customerId } = req.query;
  const asOfDate = req.query.asOfDate || null;  // 'YYYY-MM-DD' or undefined

  const svc = getServiceClient();
  try {
    const buffer = await renderStatementPdf(svc, customerId, ctx.tenantId, asOfDate);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="statement-${customerId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Customer not found') return res.status(404).json({ error: 'Customer not found' });
    console.error(`Statement ${customerId} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

**Permissions:** `ACCOUNTS_RECEIVABLE` or `ALL`. Statements are billing artifacts; AR is the canonical owner. (Not as broad as POD, which is operational — POD spans dispatch/AR.)

---

## 12. Test Plan

### Unit tests (4 new files)

1. `tests/document-types-constants-statement.test.mjs` — registry registration, 7 doc types now present.
2. `tests/document-sections-statement-constants.test.mjs` — STATEMENT_SECTIONS shape (9 sections, 20 leaf toggles, default visibility — `aging_summary`, `total_outstanding`, `open_invoices` ON; `notes`, `disclaimer` OFF; `footer` non-toggleable).
3. `tests/validate-section-config-statement.test.mjs` — field-ID isolation (e.g., `pod_details` rejected on statement; `payment_instructions` accepted on statement.notes).
4. `tests/statement-build-section-data.test.mjs` — buildSectionData mappings (open_invoices array shape, aging breakdown, total cents → dollars, empty-state shape).
5. `tests/statement-compute-aging.test.mjs` — `computeAging()` correctness across all 5 buckets, boundary days (day 0, day 30, day 31, day 60, day 61, day 90, day 91), and parity with `lib/ar-utils.js`'s `getAgingBucket()`.

### Manual verification (Task 13 of plan)

- Document Designer page at `/settings/document-designer?type=statement` renders all 9 section toggles in correct order.
- Default visibility matches spec.
- Toggling "Aging Summary" off removes the bucket row.
- Toggling "Days Past Due" column off removes that table column.
- API URL `/api/tenant/pdf/statement/<customerId>?asOfDate=2026-04-27` returns valid PDF for a real customer with multiple open invoices.
- Empty-balance customer returns "(No outstanding invoices)" empty state, $0 totals.
- Per-customer override: change accent color to red for one customer, save, switch back to "All Customers" — defaults preserved.
- Regression: prior 6 doc types (DO Full, DO Next Move, Invoice, Rate Con, Combined Invoice, POD) all still render unchanged.

### Skipped in v1

- Integration smoke for `renderStatementPdf` with stubbed Supabase client → `FU-035-H5-followup-C` (parallel to all prior renderer integration smoke FUs).

---

## 13. Risks

### R1: Aging computation drift
**Risk:** `computeAging()` in render-statement.js diverges from `getAgingBucket()` in lib/ar-utils.js. Different rounding or boundary semantics → different bucket assignment → statement disagrees with the AR aging dashboard.
**Mitigation:** Plan task explicitly tests both helpers produce identical bucket assignments for the same input. Long-term: factor into a single shared helper (cleanup FU).

### R2: `customer.short_name` is sometimes null
**Risk:** Sample data assumes account_number is present. Real customers may have null `short_name`.
**Mitigation:** Renderer-level fallback `CUST-{uuid:0:8}` documented in §7.5. Test the fallback explicitly.

### R3: Customer with hundreds of open invoices
**Risk:** A customer who's been delinquent for 2+ years could have 200+ open invoices. Single-page layout fails; React-PDF `wrap` handles overflow but visual hierarchy degrades (aging summary on page 1, total on page 5).
**Mitigation:** Accept for v1; observe in production. If it becomes a real issue, add a pre-aggregation rule ("show 50 oldest, summarize remainder as 'X older invoices: $Y total'") in a follow-up.

### R4: Consolidated invoice surprise
**Risk:** Customer asks "why is one invoice on the statement showing $5,000 when my N PO references each were under $1,000?" — they don't know it was consolidated.
**Mitigation:** Show `is_consolidated` indicator in the Invoice # cell (e.g., "INV-2026-001 *" with a footnote "* combined from 5 loads"). Defer to follow-up `FU-035-H5-followup-D`. v1 just shows the consolidated invoice as one line.

### R5: Time zone handling for `asOfDate`
**Risk:** Tenant in PST sets asOfDate=2026-04-27. If the server interprets it as UTC, an invoice with due_date=2026-04-27T22:00 PST (= 2026-04-28T05:00 UTC) might bucket differently depending on time zone.
**Mitigation:** Always treat `asOfDate` as the start-of-day (00:00) in tenant's timezone, but for v1 use UTC midnight. Rare edge case; document and revisit if customers report bucket-mismatch issues.

---

## 14. Follow-ups (filed at Task 14 of plan)

| ID | Scope | Intent |
|---|---|---|
| FU-035-H5-followup-A | Large | Statement send-email infrastructure (single + bulk). New endpoints `POST /api/tenant/customers/[id]/send-statement` + `POST /api/tenant/customers/bulk-send-statements`. Email subject "Statement of Account — As of {Date}" + customer-facing body. |
| FU-035-H5-followup-B | Medium | Bulk-statements UI page: select N customers, batch-generate ZIP. AR clerk workflow. |
| FU-035-H5-followup-C | Small | Integration smoke test for `renderStatementPdf` with stubbed Supabase client. Same pattern as H1/H2/H3/H4 integration smoke FUs. |
| FU-035-H5-followup-D | Small | Show "consolidated" indicator + footnote on statement Open Invoices rows when `invoice.is_consolidated = true`. Useful for customer comprehension. |
| FU-035-H5-followup-E | Small | Factor `computeAging()` and `getAgingBucket()` into a single shared helper in `lib/ar-utils.js`. |
| FU-035-H5-followup-F | Small | Persist generated statements to a new `statements` table + `pdf_url` archive (mirrors `lib/pdf/archive.js` for invoice/rate-con). Enables statement_number, send-history audit, and reduces re-render cost. |

---

## Self-review notes

**Placeholder scan:** No "TBD"s. The customer-detail-page insertion point is explicitly flagged as "implementer must explore during plan writing" — that's a directed question for the planner, not a placeholder.

**Internal consistency:**
- §5 `STATEMENT_SECTIONS` has `total_outstanding` as a section. §10.4 names the component `TotalOutstanding`. §8 dispatches `case 'total_outstanding'`. Consistent.
- §3.4 says no peek-and-delegate; §9 confirms `renderStatementPdf` is the standalone entry point. Consistent.
- §7.1 says invoices sorted `invoice_date ASC` (oldest first). §10.2 doesn't specify table sort — implementer takes from data shape. Consistent.

**Scope check:** 1 plan, 14ish tasks. Comparable to H4 (also 14 tasks). Single shippable unit: registry + sample data + render path + endpoint + minimal UI button. Defers send-email, bulk-send, persistence, and consolidated indicator to clearly-scoped follow-ups.

**Ambiguity check:**
- "Empty state" §7.4 — "renders (no 404)" is explicit.
- §10.6 customer-detail-page entry point intentionally left to plan-time exploration.
- §7.5 account_number fallback is explicit.

No remaining ambiguities to resolve.
