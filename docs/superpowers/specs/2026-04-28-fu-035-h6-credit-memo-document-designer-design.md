# FU-035-H6: Credit Memo Document Designer — Design Spec

**Status:** Draft → user review pending
**Author:** Claude (brainstorming session 2026-04-28)
**Predecessors:** FU-035-D/D2 (designer foundation), FU-035-H1 (Invoice), H2 (Rate Con), H3 (Combined Invoice), H4 (POD), H5 (Statement)

---

## 1. Goal

Add a brand-new **Credit Memo** doc type to the Document Designer + a download endpoint (`GET /api/tenant/pdf/credit-memo/[memoId]`) + a small "PDF" text link in each row of the existing `CreditMemosTab` actions cell.

A Credit Memo is a customer-facing record of credit issued — optionally tied to a source invoice (the one that prompted the credit) and optionally applied to a destination invoice (the one whose balance was reduced). Both linkages are independent and may be present, absent, or only one.

## 2. Non-Goals (deferred to follow-ups)

- **Send-email infrastructure** (single + bulk) — deferred to `FU-035-H6-followup-D`. **Batch this with H4-followup-B (POD) and H5-followup-A (Statement)** as a single follow-up FU that ships email-send for all three deferred AR doc types together.
- **Auto-generated `memo_number`** — every credit memo currently in the database has `memo_number = NULL` because the create form doesn't capture it. The fallback `CM-{id:0:8}` is a v1 stopgap. Tenant-scoped sequence (`CM-{tenant-prefix}-{yyyy}-{nnnn}`) deferred to `FU-035-H6-followup-B`.
- **Persisted `applied_amount_cents`** — calculated approximately at render-time as `min(memo.amount_cents, dest_invoice.total_amount_cents)`. Schema column + backfill deferred to `FU-035-H6-followup-C`.
- **Apply / void actions in the new Actions UI** — the existing inline "Void" link stays; we just add "PDF" next to it. A redesigned actions dropdown is out of scope.
- **VOID watermark customization** — the watermark is hardcoded (50pt, rotated -22°, semi-transparent red). Tenants can't toggle, customize color, or replace text. Per-tenant watermark customization is part of `FU-035-G`.
- **Watermark / disclaimer rich-text / named configs** — covered by `FU-035-G`.

## 3. Architecture

### 3.1 Independent registry (mirrors H4 POD / H5 Statement pattern)

`CREDIT_MEMO_SECTIONS` is a sibling registry alongside the existing 7 in `lib/constants/document-sections.js`. After H6 lands, the file holds **8 doc-type registries** at ~850 lines — splitting per `FU-035-H3-followup-B` becomes urgent. Recommend that be the very-next FU after H6.

### 3.2 Cascade resolver

Cascade keyed on `customer_id` (the Bill To customer; same as Invoice / Combined Invoice / POD / Statement). Resolved via `resolveTemplateConfig(svc, tenantId, customerId, 'credit_memo')`.

### 3.3 No legacy template (NEW doc type)

Same as POD + Statement — no existing hardcoded React-PDF template to migrate. We build the registry, sample data, fetcher, composer, endpoint, and minimal UI from scratch.

### 3.4 Public renderer signature

```js
renderCreditMemoPdf(svc, memoId, tenantId)
```

Throws `Error('Credit memo not found')` on missing/wrong-tenant/soft-deleted. No peek-and-delegate (Credit Memo is its own renderer). Status (`draft` / `applied` / `void`) is read from the row and used to gate the VOID watermark; renderer never refuses to render based on status.

### 3.5 Component reuse + new components

**Reused unchanged from prior FUs:** Header, AddressDetails (with `customerLabel="Bill To"` translation), Notes, Disclaimer, DocumentFooter.

**New component pairs (PDF + HTML preview):**

- **CreditMemoDetails** — 2-or-3-col grid: memo_number, issue_date, applied_date (auto-hides leaf when null). Mirrors StatementDetails / PodDetails.
- **Reason** — amber-tinted callout block (`#fef3c7` bg + `#f59e0b` left border). Single text field. NEW pattern; no equivalent in prior FUs.
- **IssuedFromInvoice** — invoice card with blue 3px left border. Compact 4-field layout (Invoice #, Invoice Date, Due Date, Total). NEW pattern.
- **AppliedToInvoice** — invoice card with green 3px left border. 5-field layout (Invoice #, Invoice Date, Balance Due, Applied Amount, Applied Date). NEW pattern.
- **CreditAmountPanel** — right-aligned green accent panel (`#f0fdf4` bg + `#16a34a` border). Mirrors Statement's TotalOutstanding. **Always green regardless of status** — VOID is conveyed by the watermark, not the panel.

**New non-toggleable hardcoded element:**

- **VoidWatermark** — diagonal "VOID" overlay rendered as a fixed-position absolute View inside `<Page>` body. Conditional on `doc.is_void === true`. Not registered as a section; not toggleable in Designer.

### 3.6 Single-page layout

Credit memos render on a single Letter page in 99%+ of cases (one memo, one reason, at most two invoice cards, no line items). Only Notes and Disclaimer can drive overflow; React-PDF `wrap` on `<Page>` handles those naturally. VOID watermark uses `fixed` to render on every page if overflow does occur.

### 3.7 No eligibility gate

Any non-deleted credit_memo row for the tenant can have a PDF generated, including drafts and voided memos. Voided memos render with the watermark; otherwise identical to applied memos.

---

## 4. File Touch List

### New files

| Path | Purpose |
|---|---|
| `lib/constants/document-sections.js` | Append `CREDIT_MEMO_SECTIONS` constant + `credit_memo: CREDIT_MEMO_SECTIONS` to `SECTIONS_BY_DOCUMENT_TYPE` |
| `lib/constants/document-types.js` | Append `'credit_memo'` entry (category: `'ar'`) |
| `lib/document-designer/sample-data-credit-memo.js` | Sample data, **keyed by section ID** (the H5 trap — DocumentPreview dispatches by section ID, not buildSectionData input shape) |
| `lib/pdf/build-credit-memo-section-data.js` | Pure-JS data shaper |
| `lib/pdf/render-credit-memo.js` | Fetcher (`fetchCreditMemoData`) + renderer (`renderCreditMemoPdf`) + helpers (`resolveMemoNumber`, `computeAppliedAmount`) |
| `components/pdf/CreditMemoTemplate.js` | React-PDF composer with `wrap` + VOID watermark overlay |
| `components/pdf/sections/CreditMemoDetails.js` | New section component |
| `components/pdf/sections/Reason.js` | New section component |
| `components/pdf/sections/IssuedFromInvoice.js` | New section component |
| `components/pdf/sections/AppliedToInvoice.js` | New section component |
| `components/pdf/sections/CreditAmountPanel.js` | New section component |
| `components/pdf/sections/VoidWatermark.js` | New non-toggleable component |
| `components/settings/document-designer/preview/CreditMemoDetailsPreview.js` | HTML preview |
| `components/settings/document-designer/preview/ReasonPreview.js` | HTML preview |
| `components/settings/document-designer/preview/IssuedFromInvoicePreview.js` | HTML preview |
| `components/settings/document-designer/preview/AppliedToInvoicePreview.js` | HTML preview |
| `components/settings/document-designer/preview/CreditAmountPanelPreview.js` | HTML preview |
| `pages/api/tenant/pdf/credit-memo/[memoId].js` | GET endpoint |
| `tests/document-types-constants-credit-memo.test.mjs` | Registry registration |
| `tests/document-sections-credit-memo-constants.test.mjs` | CREDIT_MEMO_SECTIONS shape |
| `tests/validate-section-config-credit-memo.test.mjs` | Validator field-ID isolation |
| `tests/credit-memo-build-section-data.test.mjs` | Data shaper |
| `tests/credit-memo-render-helpers.test.mjs` | Memo-number fallback + applied-amount calc + reason auto-hide |

### Modified files

| Path | Change |
|---|---|
| `tests/document-types-constants.test.mjs` | Update exhaustive list to **8 entries** |
| `components/settings/document-designer/preview/DocumentPreview.js` | Register 5 new previews + override block for `credit_memo`'s address_details (bill_to → customer translation, identical to Statement's) |
| `components/ar/CreditMemosTab.js` | Add 10px blue "PDF" text link to each row's Actions cell, left of any existing Void link. Always rendered regardless of status. |

---

## 5. CREDIT_MEMO_SECTIONS Registry

10 sections, ~26 leaf toggles.

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
      { id: 'applied_date', label: 'Applied Date', defaultVisible: true },  // auto-hides when null
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
      { id: 'invoice_number', label: 'Invoice #',     defaultVisible: true },
      { id: 'invoice_date',   label: 'Invoice Date',  defaultVisible: true },
      { id: 'due_date',       label: 'Due Date',      defaultVisible: true },
      { id: 'total',          label: 'Original Total', defaultVisible: true },
    ],
  },
  {
    id: 'applied_to_invoice',
    label: 'Applied To Invoice',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'invoice_number',  label: 'Invoice #',       defaultVisible: true },
      { id: 'invoice_date',    label: 'Invoice Date',    defaultVisible: true },
      { id: 'balance_due',     label: 'Balance Due',     defaultVisible: true },
      { id: 'applied_amount',  label: 'Applied Amount',  defaultVisible: true },
      { id: 'applied_date',    label: 'Applied Date',    defaultVisible: true },
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

`SECTIONS_BY_DOCUMENT_TYPE` adds: `credit_memo: CREDIT_MEMO_SECTIONS`.

---

## 6. DOCUMENT_TYPES entry

```js
{
  value: 'credit_memo',
  label: 'Credit Memo',
  description: 'Credit issued to a customer, optionally applied to an invoice',
  category: 'ar',  // AR-side artifact
}
```

After H6: **8 entries total**.

---

## 7. Data Behavior

### 7.1 Memo + customer fetch

```sql
SELECT
  cm.id, cm.memo_number, cm.amount_cents, cm.reason, cm.notes,
  cm.status, cm.invoice_id, cm.applied_to_invoice_id, cm.applied_at,
  cm.created_at, cm.deleted_at,
  c.id AS customer_id, c.name, c.short_name,
  c.address_line1, c.address_line2, c.city, c.state, c.zip,
  c.billing_email, c.phone
FROM credit_memos cm
JOIN customers c ON c.id = cm.customer_id AND c.deleted_at IS NULL
WHERE cm.id = ? AND cm.tenant_id = ? AND cm.deleted_at IS NULL
```

Returns null → fetcher returns null → renderer throws `'Credit memo not found'`.

### 7.2 Linked invoices fetch

```sql
SELECT id, invoice_number, invoice_date, due_date, total_amount_cents, balance_due_cents
FROM invoices
WHERE id IN (?, ?) AND tenant_id = ? AND deleted_at IS NULL
```

Skipped entirely if both `cm.invoice_id` and `cm.applied_to_invoice_id` are null. Result rows are mapped to `issued_from_invoice` (key=`cm.invoice_id`) and `applied_to_invoice` (key=`cm.applied_to_invoice_id`); either may be null in the result shape.

### 7.3 Applied-amount calculation

```js
function computeAppliedAmount(memo, appliedToInvoice) {
  if (!appliedToInvoice) return null;
  // The schema doesn't store applied_amount_cents on credit_memos. We reconstruct
  // by mirroring the PUT /apply endpoint's logic:
  //   newBalance = max(0, originalBalance - memo.amount_cents)
  //   appliedAmount = originalBalance - newBalance = min(memo.amount_cents, originalBalance)
  // We use total_amount_cents (the invoice's billed amount) as a proxy for
  // originalBalance because the historical balance at apply-time is unrecoverable.
  // This is correct in the common case where the credit fits within the invoice's billed amount.
  // FU-035-H6-followup-C will add a real applied_amount_cents column.
  return Math.min(memo.amount_cents, appliedToInvoice.total_amount_cents);
}
```

### 7.4 Memo-number fallback

```js
function resolveMemoNumber(memo) {
  if (memo.memo_number && memo.memo_number.trim()) return memo.memo_number.trim();
  if (memo.id) return `CM-${memo.id.slice(0, 8).toUpperCase()}`;
  return 'CM-UNKNOWN';
}
```

Mirrors H5's `resolveAccountNumber` pattern. All current credit_memos in the database have `memo_number = NULL` (the create form doesn't capture it), so the fallback path is the dominant case in v1.

### 7.5 Renderer data shape

`fetchCreditMemoData` returns:

```js
{
  memo_id: '<uuid>',
  status: 'draft' | 'applied' | 'void',
  is_void: false,                                // for VOID watermark dispatch
  tenant_name: '<string>',
  tenant_info: { logo_url, address, phone, website },
  bill_to: { name, address_line1, address_line2, city, state, zip },
  customer_contact: { phone, email },
  bill_to_customer_id: '<uuid>',                 // for cascade resolution
  memo_meta: {
    memo_number:  'CM-2026-014',                  // resolved with fallback
    issue_date:   'Apr 27, 2026',                 // formatted
    applied_date: 'Apr 28, 2026' | null,          // formatted from applied_at; null when not yet applied
    reason:       '<string>' | null,
  },
  issued_from_invoice: null | {
    invoice_number, invoice_date, due_date, total_cents,
  },
  applied_to_invoice: null | {
    invoice_number, invoice_date, balance_due_cents, applied_amount_cents, applied_date,
  },
  credit_amount_cents: 40000,
  notes: { payment_instructions, custom_notes },
}
```

### 7.6 Status / void rendering

- `status === 'void'` → `is_void: true` flag drives `VoidWatermark` overlay inside `<Page>` body. Watermark is `fixed` so it renders on every page if overflow occurs.
- `status === 'draft'` and `'applied'` render identically — the presence/absence of the Applied To Invoice section already conveys the difference.
- No status badge in the header. No "Pending" / "Issued" labels on the Credit Amount panel. The doc is visually identical for draft and applied states except for the Applied To section.

### 7.7 Empty / null state behavior

| Field / linkage | Null behavior |
|---|---|
| `cm.reason` is null or empty | Reason section auto-hides (composer returns null regardless of Designer toggle) |
| `cm.invoice_id` is null | Issued From Invoice section auto-hides |
| `cm.applied_to_invoice_id` is null | Applied To Invoice section auto-hides |
| `cm.applied_at` is null | Applied Date leaf in CreditMemoDetails auto-hides |
| `cm.memo_number` is null | Renderer substitutes `CM-{id:0:8}` (see §7.4) |
| `customer.short_name` is null | No "account number" displayed; CreditMemoDetails has no equivalent field anyway |
| `customer.billing_email` / `phone` is null | AddressDetails skip-empty logic (already implemented for Statement) hides the empty field |

**Key invariant:** data-driven hide takes precedence over Designer toggle. Designer toggle = "tenant doesn't want this section ever" (overrides data). Data-null = "this memo doesn't have this data" (overrides defaults). Both result in section omission.

---

## 8. Composer (CreditMemoTemplate.js)

Standard pattern matching StatementTemplate / PodTemplate. Switch dispatch over 10 section IDs, plus VOID overlay:

```jsx
function renderSection(sectionId, doc, sectionData, opts, ctx, colors) {
  switch (sectionId) {
    case 'header':              return <Header ... title="CREDIT MEMO" subtitle={ctx.subtitle} />;
    case 'memo_details':        return <CreditMemoDetails data={sectionData.memo_details} opts={opts} colors={colors} />;
    case 'address_details': {
      // Same translation as Statement: STATEMENT/CREDIT_MEMO use `bill_to` field id;
      // shared AddressDetails reads `opts.fields.customer`. customerLabel='Bill To'.
      const addrOpts = {
        ...opts,
        customerLabel: 'Bill To',
        fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
      };
      return <AddressDetails data={sectionData.address_details} opts={addrOpts} colors={colors} />;
    }
    case 'reason':
      return doc.memo_meta.reason
        ? <Reason data={sectionData.reason} colors={colors} />
        : null;
    case 'issued_from_invoice':
      return doc.issued_from_invoice
        ? <IssuedFromInvoice data={sectionData.issued_from_invoice} opts={opts} colors={colors} />
        : null;
    case 'applied_to_invoice':
      return doc.applied_to_invoice
        ? <AppliedToInvoice data={sectionData.applied_to_invoice} opts={opts} colors={colors} />
        : null;
    case 'credit_amount':       return <CreditAmountPanel data={sectionData.credit_amount} opts={opts} colors={colors} />;
    case 'notes':               return <Notes data={sectionData.notes} opts={opts} />;
    case 'disclaimer':          return <Disclaimer data={sectionData.disclaimer} colors={colors} />;
    case 'footer':              return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:                    return null;
  }
}
```

`ctx`: `{ variant: 'credit_memo', title: 'CREDIT MEMO', subtitle: doc.memo_meta.memo_number }`.

`<Page>` body:

```jsx
<Page size="LETTER" style={typography.page} wrap>
  {doc.is_void && <VoidWatermark />}
  {order.map((sectionId) => { ... })}
</Page>
```

---

## 9. Renderer (render-credit-memo.js)

```js
export async function fetchCreditMemoData(svc, memoId, tenantId) {
  // 1. Memo + customer (1 query, joined)
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

  // 2. Linked invoices (1 query, .in() — skipped when both FKs are null)
  const invoiceIds = [row.invoice_id, row.applied_to_invoice_id].filter(Boolean);
  let issuedFromInvoice = null;
  let appliedToInvoice = null;
  if (invoiceIds.length > 0) {
    const { data: invoices } = await svc
      .from('invoices')
      .select('id, invoice_number, invoice_date, due_date, total_amount_cents, balance_due_cents')
      .in('id', invoiceIds)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null);

    for (const inv of invoices || []) {
      if (inv.id === row.invoice_id) issuedFromInvoice = inv;
      if (inv.id === row.applied_to_invoice_id) appliedToInvoice = inv;
    }
  }

  const appliedAmountCents = computeAppliedAmount(row, appliedToInvoice);

  // 3. Tenant + tenant_settings (2 queries)
  // ... same pattern as render-statement.js ...

  return {
    memo_id: row.id,
    status: row.status,
    is_void: row.status === 'void',
    tenant_name: tenant?.name || '',
    tenant_info,
    bill_to: { name: row.customer.name, /* ... */ },
    customer_contact: { phone: row.customer.phone, email: row.customer.billing_email },
    bill_to_customer_id: row.customer.id,
    memo_meta: {
      memo_number:  resolveMemoNumber(row),
      issue_date:   formatDate(row.created_at),
      applied_date: row.applied_at ? formatDate(row.applied_at) : null,
      reason:       row.reason || null,
    },
    issued_from_invoice: issuedFromInvoice ? {
      invoice_number: issuedFromInvoice.invoice_number,
      invoice_date:   formatDate(issuedFromInvoice.invoice_date),
      due_date:       formatDate(issuedFromInvoice.due_date),
      total_cents:    issuedFromInvoice.total_amount_cents,
    } : null,
    applied_to_invoice: appliedToInvoice ? {
      invoice_number:        appliedToInvoice.invoice_number,
      invoice_date:          formatDate(appliedToInvoice.invoice_date),
      balance_due_cents:     appliedToInvoice.balance_due_cents,
      applied_amount_cents:  appliedAmountCents,
      applied_date:          row.applied_at ? formatDate(row.applied_at) : null,
    } : null,
    credit_amount_cents: row.amount_cents,
    notes: {
      payment_instructions: row.notes || null,
      custom_notes: null,  // credit_memos has only `notes` and `reason`; map notes → payment_instructions
    },
  };
}

export async function renderCreditMemoPdf(svc, memoId, tenantId) {
  const doc = await fetchCreditMemoData(svc, memoId, tenantId);
  if (!doc) throw new Error('Credit memo not found');
  const sectionConfig = await resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, 'credit_memo');
  return await renderToBuffer(React.createElement(CreditMemoTemplate, { doc, sectionConfig }));
}
```

**4 queries total** (3 if both invoice FKs are null).

---

## 10. Component Breakdown

### 10.1 CreditMemoDetails

2-or-3 column grid (3 columns when applied_date is non-null; collapses to 2 when null). Field-ID order: `memo_number → issue_date → applied_date`. Skip-empty applied to applied_date leaf.

### 10.2 Reason

Single-text-block component. Visual: amber-tinted callout (`#fef3c7` background, `#f59e0b` 3px left border, 8px padding, `#78350f` text). The amber palette distinguishes it from the generic Notes section visually — Reason is the *why* and gets emphasis.

### 10.3 IssuedFromInvoice

Card layout with blue 3px left border (`#3b82f6`). Two-row internal grid:
- Row 1: Invoice # (left, bold) · Original Total (right, bold)
- Row 2: "Issued {invoice_date} · Due {due_date}" (small, muted)

### 10.4 AppliedToInvoice

Card layout with green 3px left border (`#10b981`). Same shape as IssuedFromInvoice but five fields:
- Row 1: Invoice # (left, bold) · Balance Due (right, bold)
- Row 2: "Issued {invoice_date} · Reduced by {applied_amount} on {applied_date}" (small, muted)

### 10.5 CreditAmountPanel

Right-aligned panel. Green background (`#f0fdf4`), green 1.5px border (`#16a34a`), 14px×18px padding. Label "CREDIT AMOUNT" (uppercase, 9pt, `#15803d`) above amount (22pt, weight 800, `#15803d`). **Always green** — no draft/applied/void variation.

### 10.6 VoidWatermark

Diagonal "VOID" overlay rendered as React-PDF `View` with:

```js
{
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%) rotate(-22deg)',
  fontSize: 50,
  fontWeight: 900,
  color: 'rgba(220, 38, 38, 0.18)',
  borderWidth: 4,
  borderColor: 'rgba(220, 38, 38, 0.18)',
  paddingHorizontal: 22,
  paddingVertical: 4,
  borderRadius: 6,
  letterSpacing: 4,
}
```

Wrapped in `<View fixed>` so React-PDF replicates it on every page if the doc overflows. **Not registered as a section; not toggleable in Designer.**

### 10.7 HTML previews

One `*Preview.js` for each new toggleable section component (5 total: CreditMemoDetails, Reason, IssuedFromInvoice, AppliedToInvoice, CreditAmountPanel). The VoidWatermark has **no preview** — the live preview shows the doc in a "default" state, not status-dependent variations.

Visual parity required between PDF and preview: same field-ID order, same skip-empty logic, same accent-color fallback semantic.

### 10.8 "PDF" download link in CreditMemosTab

In the existing Actions cell of [CreditMemosTab.js](components/ar/CreditMemosTab.js), add a 10px text link to the LEFT of the existing Void link:

```jsx
<a
  href={`/api/tenant/pdf/credit-memo/${m.id}`}
  target="_blank"
  rel="noopener noreferrer"
  className="text-[10px] font-semibold text-blue-500 dark:text-blue-400 hover:text-blue-600 px-1.5 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-950/40 mr-1"
>
  PDF
</a>
{m.status === 'draft' && (
  <button onClick={...}>Void</button>
)}
```

Always visible regardless of status (including voided memos — the watermark handles that). No icon, no tooltip — plain text matches the existing Void link's visual density.

---

## 11. Endpoint

```js
// pages/api/tenant/pdf/credit-memo/[memoId].js

import { requireTenantUser, requirePermission, getServiceClient } from '...';
import { PERMISSIONS } from '...';
import { renderCreditMemoPdf } from '...';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(ctx, [PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL], res)) return;

  const { memoId } = req.query;
  const svc = getServiceClient();
  try {
    const buffer = await renderCreditMemoPdf(svc, memoId, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="credit-memo-${memoId}.pdf"`);
    return res.send(buffer);
  } catch (e) {
    if (e.message === 'Credit memo not found') return res.status(404).json({ error: 'Credit memo not found' });
    console.error(`Credit memo ${memoId} render failed:`, e);
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

**Permissions:** `ACCOUNTS_RECEIVABLE` or `ALL` — same as the existing `/api/tenant/ar/credit-memos/*` endpoints. Voided memos render normally with the watermark; no special status check at the endpoint.

---

## 12. Test Plan

### Unit tests (5 new files)

1. `tests/document-types-constants-credit-memo.test.mjs` — registry registration, **8 doc types** total, label/category/description match.
2. `tests/document-sections-credit-memo-constants.test.mjs` — `CREDIT_MEMO_SECTIONS` shape (10 sections, ~26 leaf toggles, default visibility — `notes` + `disclaimer` OFF; `footer` non-toggleable; rest ON).
3. `tests/validate-section-config-credit-memo.test.mjs` — field-ID isolation:
   - `pod_details` rejected on credit_memo (PoD section ID, not credit-memo)
   - `payment_instructions` accepted on credit_memo.notes
   - `applied_amount` accepted on `applied_to_invoice` only (not on `issued_from_invoice`)
   - `total` accepted on `credit_amount`
4. `tests/credit-memo-build-section-data.test.mjs` — buildSectionData mappings:
   - `header` shape pulls tenantName/tenantInfo correctly
   - `memo_details` shape carries fallback memo_number when null
   - `address_details.customer` populated from doc.bill_to + customer_contact
   - `issued_from_invoice` is null when doc.issued_from_invoice is null
   - `applied_to_invoice` is null when doc.applied_to_invoice is null
   - `credit_amount.total_cents` passthrough
   - empty `notes` shape when doc.notes are null
5. `tests/credit-memo-render-helpers.test.mjs`:
   - `resolveMemoNumber({memo_number: 'CM-2026-014'})` → `'CM-2026-014'`
   - `resolveMemoNumber({memo_number: null, id: 'a1b2c3d4-...'})` → `'CM-A1B2C3D4'`
   - `resolveMemoNumber({memo_number: '   ', id: 'a1b2c3d4-...'})` → `'CM-A1B2C3D4'` (trim-empty fallback)
   - `resolveMemoNumber({})` → `'CM-UNKNOWN'`
   - `computeAppliedAmount(memo: $400, invoice: $500 total)` → `$400`
   - `computeAppliedAmount(memo: $500, invoice: $400 total)` → `$400` (clamped)
   - `computeAppliedAmount(memo, null)` → `null`

### Manual verification (Task ~14 of plan)

- Document Designer page at `/settings/document-designer?type=credit_memo` renders all 10 section toggles in correct order.
- Default visibility matches spec.
- Toggling "Issued From Invoice" off in Designer hides it for memos that *do* have invoice_id set.
- Auto-hide for null invoice_id works (memo with `invoice_id = null` doesn't show Issued From section regardless of Designer toggle).
- Toggling "Applied Date" leaf off in Designer hides that field in memo_details.
- API URL `/api/tenant/pdf/credit-memo/<memoId>` returns valid PDF for:
  - A draft standalone memo (no invoice links) — both invoice cards absent
  - An applied memo (both invoice links present) — both cards visible, applied amount calculated
  - A voided memo — VOID watermark visible, otherwise identical to applied
- "PDF" link in CreditMemosTab Actions cell opens the PDF in a new tab for all 3 statuses.
- Per-customer cascade override: change accent color to red for one customer, save, switch back to "All Customers" — defaults preserved.
- Regression: prior 7 doc types (DO Full, DO Next Move, Invoice, Rate Con, Combined Invoice, POD, Statement) all still render unchanged.

### Skipped in v1

- Integration smoke for `renderCreditMemoPdf` with stubbed Supabase client → `FU-035-H6-followup-A`. These will eventually be batched into a shared test utility (FU-035-H1-followup-A's eventual merger).

---

## 13. Risks

### R1: `applied_amount_cents` calculation drift
**Risk:** The schema doesn't store `applied_amount_cents` on credit_memos. We approximate as `min(memo.amount_cents, dest_invoice.total_amount_cents)`. If a credit was $500 against an invoice that already had partial payment (so original balance at apply time was, say, $400 but total was $1000), the historical applied amount would have been $400 — but our approximation returns `min($500, $1000) = $500`. Customer sees a wrong number.
**Mitigation:** Document approximation in fetcher comment + flag for `FU-035-H6-followup-C` if customers report drift. Long-term fix: add `applied_amount_cents` column to `credit_memos` and populate from PUT-action history (best-effort) and forward-going writes.

### R2: VOID watermark interaction with `wrap`
**Risk:** React-PDF `position: absolute` inside a wrapping page may render only on page 1 if not configured with `fixed`. Voided memos with very long notes/disclaimer could spill onto page 2 with no watermark.
**Mitigation:** Wrap watermark in `<View fixed>` so React-PDF replicates it on every page. Test path: a memo with status='void' AND a notes value long enough to force page 2.

### R3: `memo_number` fallback creates mixed display
**Risk:** Once auto-generate ships (`FU-035-H6-followup-B`), new memos will have proper numbers like `CM-ACME-2026-0001` while old memos still display the UUID fallback `CM-A1B2C3D4`. Customer might see an inconsistent set ("Why does this one look weird?").
**Mitigation:** Acceptable for v1 — current dataset has 100% null memo_numbers, so all memos look the same right now. Backfill old memos when auto-generate FU ships. Document this in the auto-generate FU's spec.

### R4: Reason auto-hide vs Designer toggle interaction
**Risk:** If a tenant disables "Reason" in Designer, then later issues a memo with non-null reason, the section stays hidden. Customer doesn't see why credit was issued.
**Mitigation:** Document the hide-precedence semantic in the Designer help text + spec section §7.7. Same precedence as Issued From / Applied To. The implementer's task includes documenting this in code (jsdoc on the composer dispatch case).

### R5: Soft-deleted customer leaks via join
**Risk:** Memo references a soft-deleted customer; without filter the memo renders with the deleted customer's name/address.
**Mitigation:** Spec'd `c.deleted_at IS NULL` in §7.1 SQL and the Supabase nested-select equivalent in §9 fetcher. Plan adds a unit test that injects a soft-deleted customer scenario and asserts fetcher returns null.

### R6: Approximation error when `total_amount_cents = 0`
**Risk:** A degenerate invoice (zero total) is impossible by business logic but possible via direct DB write or test data. `min(memo.amount_cents, 0)` returns `0`, which would show "Applied Amount: $0.00" — confusing.
**Mitigation:** Plan's unit test for `computeAppliedAmount` includes the zero-total case and the renderer test confirms the Applied Amount field renders correctly. Acceptable behavior is "show $0" — degenerate inputs produce degenerate output.

---

## 14. Follow-ups (filed at final task of plan)

| ID | Scope | Intent |
|---|---|---|
| `FU-035-H6-followup-A` | Small | Integration smoke test for `renderCreditMemoPdf` with stubbed Supabase client. Mirrors all prior renderer integration smoke FUs (H1/H2/H3/H4/H5). Eventually batched into a shared test utility. |
| `FU-035-H6-followup-B` | Small | Auto-generate `memo_number` on credit_memos insert (tenant-scoped sequence: `CM-{tenant-prefix}-{yyyy}-{nnnn}`). Backfill existing nulls. Updates the create form + POST endpoint. |
| `FU-035-H6-followup-C` | Small | Add `applied_amount_cents` column to credit_memos via migration; backfill from PUT-action history (best-effort) and update apply endpoint to write it. Switches the renderer from approximation to direct read. |
| `FU-035-H6-followup-D` | Medium-Large | Send-email infrastructure for credit memos (single + bulk). **Batch with H4-followup-B (POD) and H5-followup-A (Statement)** as a single follow-up FU that ships email-send for all three deferred AR doc types together. New endpoints `POST /api/tenant/ar/credit-memos/[id]/send-email` + `POST /api/tenant/ar/credit-memos/bulk-send-emails`. Shared email-template-and-send code lives in `lib/pdf/send-doc-email.js`. |

---

## Self-review notes

**Placeholder scan:** No "TBD"s. The component visual specs in §10 (border colors, padding, font sizes) are concrete enough to build from without ambiguity.

**Internal consistency:**
- §5 `CREDIT_MEMO_SECTIONS` has `memo_details` as section ID. §8 dispatches `case 'memo_details'`. §10.1 names the component `CreditMemoDetails`. Consistent.
- §3.4 says no peek-and-delegate; §9 confirms `renderCreditMemoPdf` is the standalone entry point. Consistent.
- §7.4 describes `resolveMemoNumber` returning `CM-{id:0:8}` uppercase. §9's fetcher calls `resolveMemoNumber(row)`. §12's helper test asserts uppercase. Consistent.
- §3.5 lists 5 new toggleable components + 1 watermark = 6 new section components. §4 file list shows 6 new components in `components/pdf/sections/`. Consistent.
- §10.7 says VOID has no preview. §4 file list shows 5 *Preview.js files (not 6). Consistent.

**Scope check:** 1 plan, ~14-16 tasks. Comparable to H5 (17 tasks). Single shippable unit: registry + sample data + render path + endpoint + minimal UI link. Defers send-email, auto-numbering, persisted applied amount to clearly-scoped follow-ups.

**Ambiguity check:**
- "Reason auto-hide" §7.7 — explicit precedence rule documented (data-null overrides Designer enable; Designer disable overrides data).
- §10.5 Credit Amount panel "always green regardless of status" is explicit.
- §10.6 VOID watermark "not toggleable in Designer" is explicit.
- §7.4 trim-empty fallback for memo_number (`'   '` → fallback) is explicit.

No remaining ambiguities to resolve.
