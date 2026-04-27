# FU-035-H3 — Combined Invoice Document Designer

**Status:** Design (brainstormed 2026-04-27, after FU-035-H1 + FU-035-H2 ship)
**Depends on:** FU-035-H1 (single-load Invoice — established the section-registry pattern + cascade resolver), FU-035-H2 (proved cross-doc-type reuse)
**Unblocks:** FU-035-H4-H9 — H3's "ChargeDetails groupByLoad" + "LoadsSummary" patterns generalize

## 1. Goal

Replace H1's first-order-only fallback for consolidated invoices (the `"Includes charges from N loads"` footnote) with a proper multi-load layout. Tenants who bill multiple loads in one invoice (`is_consolidated = true`) get a printed PDF with:
- Loads Summary section (table listing each load with toggleable columns)
- Charge Details with sub-grouping by load (per-load subtotals + grand total)
- Per-customer cascade for combined invoices (independent of single-load Invoice template)

The transition is invisible to callers: `renderInvoicePdf(svc, invoiceId, tenantId)` keeps its 3-arg signature, peeks `invoice.is_consolidated`, and routes to the new combined-invoice composer when set. Tenants who never produce consolidated invoices see no change.

## 2. Non-goals (deferred)

- **Per-load Equipment / Commodity / Move Events sections** — H3 goes compact-table style. Tenants who need rich per-load detail can send the underlying single-load Invoice for that load separately. Including all those sections multiplied by N loads explodes page count.
- **Per-load page break (Layout D from the brainstorm)** — rejected. Most consolidated invoices are 5-15 loads; a per-load page would inflate to 5-15 pages from what fits in 2-3.
- **Carrier billing (rate-con-style)** — out of scope. Combined Invoices are AR (bill-to → tenant), not AP (carrier → tenant).
- **Sequence customization within Charge Details** — line items render in their stored sort order; per-load grouping is purely visual.
- **Multi-currency** — every line item assumed same currency (consolidated invoices today require same-customer; currency follows customer).

## 3. Architecture decisions

### 3.1 Separate `'combined_invoice'` doc type (Approach 1a)

`'combined_invoice'` is its own `DOCUMENT_TYPES` entry with its own `COMBINED_INVOICE_SECTIONS` registry. The cascade resolver looks up templates per-doc-type, so a tenant can have a Walmart-specific combined invoice template that's distinct from their Walmart-specific single Invoice template.

### 3.2 Layout C — Loads Summary table + Charge Details grouped by load

Visual structure:
```
HEADER
INVOICE DETAILS (Load Number renders as "(N loads)")
BILL TO

LOADS SUMMARY
  table with N rows, ~7 toggleable columns

CHARGE DETAILS — grouped by load
  Load #1 — L-ABC
    Linehaul   $750
    FSC        $125
    Subtotal   $875
  Load #2 — L-DEF
    ...
  ─────────────────
  GRAND TOTAL    $1,750

NOTES (billing_notes only)
DISCLAIMER
FOOTER
```

### 3.3 Public API entry point unchanged

`renderInvoicePdf(svc, invoiceId, tenantId)` peeks the invoice's `is_consolidated` flag and delegates to a new `renderCombinedInvoicePdf` when set. Both are exported from `lib/pdf/render-invoice.js` (or via a clean dynamic import). All 4 existing callers (`send-email.js`, `bulk-send.js`, `pdf/invoice/[id].js`, `archive.js`) keep working without edits.

### 3.4 Peek-and-delegate pattern

```js
export async function renderInvoicePdf(svc, invoiceId, tenantId) {
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

  // existing single-load path
  const doc = await fetchInvoiceData(svc, invoiceId, tenantId);
  if (!doc) throw new Error('Invoice not found');
  const sectionConfig = await resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, 'invoice');
  return await renderToBuffer(React.createElement(InvoiceTemplate, { doc, sectionConfig }));
}
```

The peek query is a 1-column SELECT (~ms). For non-consolidated invoices it's a tiny perf cost in exchange for keeping the public signature unchanged. For consolidated, it's the only DB hit before delegation. Acceptable.

Alternative considered: register `'combined_invoice'` and let send-email pick which `renderXPdf` to call. Rejected because it would require touching all 4 callers and creates a public-API decision they shouldn't have to make.

### 3.5 Component reuse from H1

Reuse without changes:
- `Header.js` (PDF + preview)
- `InvoiceDetails.js` (PDF + preview) — except multi-load `Load Number` rendering, see §3.6
- `AddressDetails.js` (PDF + preview) — combined invoice's address_details registry only has `bill_to`; the 4 location fields are dropped
- `Notes.js` (PDF + preview) — combined invoice's notes registry only has `billing_notes`; driver/load notes are dropped (per-load, ambiguous)
- `Disclaimer.js`, `DocumentFooter.js`

Reuse with one extension:
- `ChargeDetails.js` + `ChargeDetailsPreview.js` — gain `opts.groupByLoad` prop (default `false` preserves Invoice + Rate Con). When `true`, groups line items by `order_id` with per-load subtotal rows and a grand total. Combined invoice composer passes `true`. (See §10.2 + §10.3.)

NEW components:
- `LoadsSummary.js` (PDF) + `LoadsSummaryPreview.js` (HTML) — table renderer with up to 7 toggleable columns.

### 3.6 InvoiceDetails Load Number rendering for multi-load

When `data.consolidated_count > 1`, `data.load_number` should render as `"(3 loads)"` instead of an arbitrary single order_number. Single-line conditional in InvoiceDetails (PDF + preview): if multi-load, show `"(${count} loads)"`; otherwise show the load_number string as today.

Alternative considered: render a comma-separated list of all order numbers (e.g., `"L-ABC, L-DEF, L-GHI"`). Rejected — fits poorly in the 33% grid cell width and provides no real value when the Loads Summary table below shows them all anyway.

### 3.7 Separate fetcher and composer files

- `lib/pdf/render-invoice.js` — public `renderInvoicePdf` entry point with peek + delegation. Existing `fetchInvoiceData` + single-load `renderInvoicePdf` body kept inline.
- `lib/pdf/render-combined-invoice.js` (NEW) — `fetchCombinedInvoiceData` + `renderCombinedInvoicePdf` exported. Fetches all N orders, all events, groups line items by order.
- `lib/pdf/build-combined-invoice-section-data.js` (NEW) — pure data-shape mapper. Same testability pattern as H1/H2.
- `components/pdf/CombinedInvoiceTemplate.js` (NEW) — composer. Mirrors InvoiceTemplate.js's shape; renderSection switch with combined-invoice-specific section IDs.

## 4. File touch-list

```
EDIT     lib/constants/document-types.js                  add 'combined_invoice' DOCUMENT_TYPES entry
EDIT     lib/constants/document-sections.js               add COMBINED_INVOICE_SECTIONS + register in SECTIONS_BY_DOCUMENT_TYPE
NEW      lib/pdf/build-combined-invoice-section-data.js   pure helper (testable)
NEW      lib/pdf/render-combined-invoice.js               fetchCombinedInvoiceData + renderCombinedInvoicePdf
EDIT     lib/pdf/render-invoice.js                        add peek-and-delegate to renderInvoicePdf
NEW      components/pdf/CombinedInvoiceTemplate.js        composer
NEW      components/pdf/sections/LoadsSummary.js          new section component (PDF table)
EDIT     components/pdf/sections/InvoiceDetails.js        +consolidated_count → "(N loads)" rendering
EDIT     components/pdf/sections/ChargeDetails.js         +groupByLoad prop, default false

NEW      components/settings/document-designer/preview/LoadsSummaryPreview.js
EDIT     components/settings/document-designer/preview/InvoiceDetailsPreview.js  +(N loads) rendering parity
EDIT     components/settings/document-designer/preview/ChargeDetailsPreview.js   +groupByLoad mirror
EDIT     components/settings/document-designer/preview/DocumentPreview.js        register loads_summary preview + sample data + groupByLoad override for combined_invoice

NEW      lib/document-designer/sample-data-combined-invoice.js     Combined Invoice sample data (3 sample loads)

NEW      tests/document-sections-combined-invoice-constants.test.mjs        ~10 cases
NEW      tests/document-types-constants-combined-invoice.test.mjs           ~3 cases
NEW      tests/validate-section-config-combined-invoice.test.mjs            ~6 cases
NEW      tests/combined-invoice-build-section-data.test.mjs                 ~7 cases
```

**Files explicitly NOT touched:**
- `lib/pdf/resolve-template-config.js` — already per-doc-type
- `lib/pdf/validate-section-config.js` — auto-supports any registered doc type
- `pages/settings/document-designer/index.js`, `ConfigurationBar.js`, `CustomerDropdown.js`, `DocumentTypeDropdown.js` — auto-iterate DOCUMENT_TYPES
- `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js`, `pages/api/tenant/ar/invoices/bulk-send.js`, `pages/api/tenant/pdf/invoice/[id].js`, `lib/pdf/archive.js` — all call `renderInvoicePdf(svc, invoiceId, tenantId)` which now peek-and-delegates internally
- All H1/H2 sections that combined_invoice reuses unchanged: Header, AddressDetails, Notes, Disclaimer, DocumentFooter (and their previews)

**Migrations:** none. No schema changes — `invoices.is_consolidated`, `invoice_line_items.order_id`, and `invoice_charge_sets.charge_set_id → order_charge_sets.order_id` all exist today.

## 5. `COMBINED_INVOICE_SECTIONS` registry (full)

8 sections (7 toggleable + Footer always-on). 24 leaf toggles total: Header 5 + Invoice Details 6 + Address Details 1 + Loads Summary 7 + Charge Details 4 + Notes 1.

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

SECTIONS_BY_DOCUMENT_TYPE = {
  ...existing,
  combined_invoice: COMBINED_INVOICE_SECTIONS,
};
```

**Sections explicitly DROPPED from Invoice's 10:**
- `move_events` — per-load
- `order_details` (Equipment Details) — per-load
- `commodity_details` — per-load

**Field-ID isolation (validator regression coverage):**
- `address_details.fields.{customer, pickup_location, delivery_location, return_location, display_pickup_for_operational_street_turns}` — REJECTED on `combined_invoice`. Only `bill_to` is registered.
- `notes.fields.{driver_notes, load_notes}` — REJECTED on `combined_invoice`. Only `billing_notes` is registered.
- `loads_summary.fields.{...}` — REJECTED on Invoice / Rate Con / DO. Combined-invoice-only section.

## 6. `DOCUMENT_TYPES` addition

```js
{
  value: 'combined_invoice',
  label: 'Combined Invoice',
  description: 'Multi-load invoice consolidating charges from N loads',
  category: 'ar',
}
```

## 7. Renderer data shape (`fetchCombinedInvoiceData`)

```ts
{
  invoice_id: string,
  tenant_name: string,
  tenant_info: { logo_url, address, phone, website },

  bill_to: { name, address_line1, city, state, zip } | null,
  customer_contact: { phone, email } | null,
  bill_to_customer_id: string | null,

  invoice_meta: {
    invoice_number, invoice_date, due_date, terms_days,
    is_consolidated: true,                   // always true on this path
    consolidated_count: number,              // = N
    notes,
  },

  // NEW: array of N orders' summary rows
  loads_summary: Array<{
    order_id: string,
    load_number: string,
    container_number: string | null,
    chassis_number: string | null,
    pickup_location: { name, city, state } | null,
    delivery_location: { name, city, state } | null,
    pickup_date: string | null,              // formatted via formatDate()
    delivery_date: string | null,            // formatted
  }>,

  // NEW: line items grouped by order_id, with per-group subtotals
  charge_groups: Array<{
    order_id: string,
    load_number: string,                     // for the sub-header
    lines: Array<{ description, quantity, unit_amount_cents, total_amount_cents }>,
    subtotal_cents: number,
  }>,

  totals: {
    subtotal_cents: number,                  // sum of all charge lines
    total_cents: number,                     // = invoice.total_amount_cents
  },
}
```

**Fetch sequence (~5-7 round-trips):**
1. invoice + customer (1)
2. invoice_charge_sets → order_charge_sets → orders (1, joined — fetches ALL N orders + their pickup_org / delivery_org joined, plus pickup_apt_from / delivery_apt_from for the Loads Summary date columns)
3. For each order: moves + events (2 queries × N orders = 2N round-trips, **conditional on whether any LoadsSummary location field is enabled** — see optimization note below)
4. invoice_line_items (1, with `order_id` for grouping)
5. tenants + tenant_settings (1)

**Optimization:** Fetching N orders' moves + events purely to derive `pickup_location` + `delivery_location` for the LoadsSummary table can be expensive on a 10-load invoice. Cheaper alternative: read directly from the order's `pickup_org` + `delivery_org` (already joined in step 2 — these are the customers-table FK references for pickup and delivery sites). Skip moves/events entirely. The trade-off: `pickup_org` is the configured pickup location at order creation, while `deriveLoadLevelLocations(moves)` returns the actual first-pull / last-deliver event location which can differ if events were inserted/restructured. For Combined Invoice billing, the configured location is the right answer. **Decision: use `pickup_org` + `delivery_org` directly**, no per-order moves+events fetch. Drops the round-trip count to 5.

**`charge_groups` construction:** group `invoice_line_items` by `order_id`. For each group, look up the matching `loads_summary[].load_number` and compute the group `subtotal_cents = sum(line.total_amount_cents)`. Order of groups follows `loads_summary` order (which follows the invoice_charge_sets join order — typically charge_set creation order).

## 8. Composer (`components/pdf/CombinedInvoiceTemplate.js`)

```js
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

`renderSection` switch dispatches to:
- `header` → Header (title='INVOICE')
- `invoice_details` → InvoiceDetails (passes `consolidated_count` from doc.invoice_meta; component switches Load Number rendering to `(N loads)` when `consolidated_count > 1`)
- `address_details` → AddressDetails with the same field-ID translation as H1's Invoice (Invoice's registry uses `bill_to`; AddressDetails reads `customer`). passes `customerLabel: 'Bill To'`. Same as Invoice.
- `loads_summary` → LoadsSummary (NEW component)
- `charge_details` → ChargeDetails with `opts.groupByLoad = true` injected. Reads `data.charge_details.charge_groups` instead of `charge_lines` when grouped.
- `notes` → Notes (only billing_notes registered; component renders the Billing Notes row from `data.notes.billing_notes`)
- `disclaimer` → Disclaimer
- `footer` → DocumentFooter

`buildSectionData` is exported from `lib/pdf/build-combined-invoice-section-data.js` (lessons learned from H1 Task 10 review).

## 9. Renderer (`lib/pdf/render-combined-invoice.js`)

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import CombinedInvoiceTemplate from '../../components/pdf/CombinedInvoiceTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate } from './format-date';

export async function fetchCombinedInvoiceData(svc, invoiceId, tenantId) {
  // 5-query fetcher per §7
}

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

`render-invoice.js`'s `renderInvoicePdf` adds the peek + delegate at the top per §3.4. Public 3-arg signature `(svc, invoiceId, tenantId)` is preserved.

## 10. Component breakdown

### 10.1 `components/pdf/sections/LoadsSummary.js` (NEW)

Toggle-aware table. Up to 7 columns, columns hide when their toggle is off. Accent-color header band like Charge Details.

```js
const FIELD_ORDER = [
  ['load_number',       'Load #'],
  ['container_number',  'Container #'],
  ['chassis_number',    'Chassis #'],
  ['pickup_location',   'Pickup'],
  ['delivery_location', 'Delivery'],
  ['pickup_date',       'Pickup Date'],
  ['delivery_date',     'Delivery Date'],
];

export default function LoadsSummary({ data, opts, colors }) {
  // data: Array<{ order_id, load_number, container_number, chassis_number,
  //               pickup_location, delivery_location, pickup_date, delivery_date }>
  // opts.fields: 7 toggleable columns
  // colors.accent for header band

  // Render: accent-banded "LOADS" header + table with N rows + visible columns
  // For pickup_location / delivery_location, show "City, ST" (compact).
  // Empty-state if data.length === 0: italic "(No loads)" — shouldn't happen for is_consolidated invoices but defensive.
}
```

### 10.2 `components/pdf/sections/ChargeDetails.js` (EDIT — add `groupByLoad`)

Add `opts.groupByLoad` prop (default `false`). When `true`:
- Read `data.charge_groups` instead of `data.charge_lines`
- For each group, render: sub-header bar with `Load #${load_number}` → group's lines → `Subtotal: $X` row
- Final row: `GRAND TOTAL: $Y` in bold

```js
export default function ChargeDetails({ data, opts, colors }) {
  ...
  const groupByLoad = opts?.groupByLoad === true;
  const showSubtotal = opts?.showSubtotal !== false;

  if (groupByLoad) {
    // Iterate data.charge_groups, render per-group subtables + sub-subtotal
    // Then a final Grand Total row
    return (...);
  }

  // Existing flat-mode rendering (preserved for Invoice + Rate Con)
  ...
}
```

The grouped path is a separate rendering branch — ~50 lines added. `showSubtotal` and other Invoice/Rate-Con props still apply only in flat mode.

### 10.3 `components/pdf/sections/InvoiceDetails.js` (EDIT — multi-load Load Number rendering)

Add the conditional in the FIELD_ORDER value mapper:

```js
const value = key === 'terms'
  ? termsLabel
  : key === 'load_number' && data.consolidated_count > 1
    ? `(${data.consolidated_count} loads)`
    : data[key];
```

One-line addition. Default behavior (single-load) unchanged when `consolidated_count <= 1`.

### 10.4 HTML preview components (NEW + EDIT)

- `LoadsSummaryPreview.js` (NEW) — Tailwind table mirror of LoadsSummary
- `ChargeDetailsPreview.js` (EDIT) — same `groupByLoad` prop + grouped rendering for HTML
- `InvoiceDetailsPreview.js` (EDIT) — same `(N loads)` Load Number rendering
- `DocumentPreview.js` (EDIT):
  - Import LoadsSummaryPreview, register in PREVIEW_BY_SECTION_ID
  - Import sample-data-combined-invoice, register in SAMPLE_BY_DOCUMENT_TYPE
  - Per-doc-type override block for `charge_details` on combined_invoice:
    ```js
    if (s.id === 'charge_details' && documentType === 'combined_invoice') {
      opts.groupByLoad = true;
    }
    if (s.id === 'address_details' && documentType === 'combined_invoice') {
      // Same field-ID translation as Invoice
      opts.customerLabel = 'Bill To';
      opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
    }
    ```

### 10.5 Sample data (NEW)

`lib/document-designer/sample-data-combined-invoice.js` — 3 sample loads with realistic values:
- Load 1: L-ABC, MSCU1234567, Newark → Edison
- Load 2: L-DEF, MSCU5678901, Elizabeth → Edison
- Load 3: L-GHI, MSCU9999999, Newark → Bayonne

Charge groups: each load has 2-3 sample line items (Linehaul, FSC, Chassis); per-load subtotals + grand total = $2,940.

`invoice_details.consolidated_count = 3` so the preview shows the `"(3 loads)"` Load Number rendering.

`charge_lines` (for the flat representation) is omitted — `charge_groups` is the only source for combined_invoice.

## 11. Test plan

### 11.1 Test infrastructure

`tests/*.test.mjs` using `node:test` + `node:assert/strict`. Same as H1/H2.

### 11.2 New test files

**`tests/document-types-constants-combined-invoice.test.mjs`** (~3 cases):
- `'combined_invoice'` is in `DOCUMENT_TYPES`
- `getDocumentType('combined_invoice')` returns category `'ar'`, label `'Combined Invoice'`
- `isValidDocumentType('combined_invoice')` returns true

**`tests/document-sections-combined-invoice-constants.test.mjs`** (~10 cases):
- COMBINED_INVOICE_SECTIONS entries have required keys
- All 8 sections present in expected order
- footer non-toggleable, disclaimer defaultVisible:false
- invoice_details has 6 fields (same as Invoice's)
- address_details has ONLY bill_to (NOT customer / pickup_location / etc.)
- loads_summary has 7 fields (and NO other field IDs)
- charge_details has 4 fields (same as Invoice's)
- notes has ONLY billing_notes (NOT driver_notes / load_notes)
- `getSectionsForDocumentType('combined_invoice') === COMBINED_INVOICE_SECTIONS`
- `computeVisibility` honors defaults

**`tests/validate-section-config-combined-invoice.test.mjs`** (~6 cases):
- Validator accepts `bill_to` on address_details for combined_invoice
- Validator REJECTS `customer` on combined_invoice (Invoice-only)
- Validator REJECTS `pickup_location` on combined_invoice's address_details (Invoice-only)
- Validator REJECTS `driver_notes` / `load_notes` on combined_invoice's notes
- Validator REJECTS `loads_summary.fields.*` on Invoice / Rate Con / DO (combined_invoice-only fields)
- Validator accepts a full combined_invoice section_config payload

**`tests/combined-invoice-build-section-data.test.mjs`** (~7 cases):
- Maps invoice_meta to invoice_details with consolidated_count > 1
- Maps bill_to to address_details.customer (AddressDetails-internal ID translation)
- Maps loads_summary array correctly (each row's load_number, container, etc.)
- charge_groups grouped by order_id with per-group subtotals
- Grand total = sum of group subtotals
- Returns null-safe shapes when invoices have 0 linked charge sets (edge case — shouldn't happen for is_consolidated but defensive)
- Maps notes.billing_notes only (driver_notes + load_notes not present)

### 11.3 Manual verification (pre-merge)

1. Run all existing tests + new tests — all green except pre-existing fire-trigger failure
2. Open `/settings/document-designer?type=combined_invoice` → toggle list shows 8 sections, preview renders 3 sample loads
3. Toggle off "Chassis #" in Loads Summary → that column disappears from preview
4. Toggle off "Charge Details" master → entire section disappears
5. Verify `(3 loads)` shows in Load Number row of Invoice Details (NOT a single load_number)
6. Save a per-customer override + change accent → reload picks up
7. Find or create a real `is_consolidated = true` invoice with 2-3 charge_sets → send-email → verify the PDF renders Loads Summary table + grouped Charge Details (per-load subtotals + grand total)
8. Send-email a single-load invoice → verify the OLD InvoiceTemplate.js still runs (peek-and-delegate routes to single-load when `is_consolidated = false`)
9. Print a real DO + Rate Con → regression check (other doc types unaffected)

## 12. Risks

**R1. The peek query adds 1 round-trip to every invoice render.** Single-column SELECT on `invoices` indexed by id → microsecond. Negligible perf cost; payoff is preserving the public renderInvoicePdf signature for all 4 callers.

**R2. `invoice_line_items.order_id` consistency.** The grouping logic relies on every line item having an `order_id` matching one of the linked charge_sets' orders. The invoice creation code (`pages/api/tenant/ar/invoices/index.js:500`) sets it correctly. If a line item ever has a NULL or stale order_id, it would land in an "Unknown Load" bucket. Mitigation: defensive grouping in buildSectionData — drop or warn-log lines with orphaned order_ids.

**R3. Loads Summary for invoices with 0 or 1 charge sets.** A consolidated invoice with 1 charge_set is technically possible (admin manually flipped the flag, edge case). The Loads Summary section would render a single-row table; functionally fine but visually the "Loads Summary" section title looks redundant for 1 load. Acceptable — admin shouldn't be marking 1-load invoices as is_consolidated.

**R4. `pickup_org` / `delivery_org` may be null on orders.** The Loads Summary "Pickup" + "Delivery" columns would show "—" or empty cells in those cases. Defensive empty-handling in the LoadsSummary component (each cell can short-circuit) — consistent with how AddressDetails handles missing locations.

**R5. ChargeDetails groupByLoad changes the data path.** The component now reads either `data.charge_lines` (flat) or `data.charge_groups` (grouped). Risk that future maintainers will pass `charge_lines` to a `groupByLoad: true` ChargeDetails or vice versa. Mitigation: TypeScript-style JSDoc comments on the component documenting the dual contract; explicit `if (!Array.isArray(data?.charge_groups)) return null;` guard in the grouped branch.

**R6. Page break behavior with N=many loads.** A 20-load invoice with 5+ line items per load could push to 5+ pages. React-PDF's `<Page wrap>` handles automatic pagination but the Loads Summary table header won't repeat on subsequent pages. Acceptable for v1; a 20-load combined invoice is rare. If it surfaces as a real issue, add `<View break>` markers between Loads Summary and Charge Details, and per-page repeat the table headers via `fixed` props.

**R7. Cascade resolver gets a NEW key.** Existing tenants have NO `combined_invoice` template rows. Cascade returns `undefined` → composer falls back to registry defaults. Existing single-load Invoice templates continue to apply unchanged for non-consolidated invoices. Tenants who want different combined-invoice styling create a new override.

**R8. Multi-load consolidated send-email regression risk.** The peek-and-delegate adds a new code path; bug there means consolidated invoices break. Mitigated by Task 12's manual verification (send-email a real consolidated invoice + verify PDF). Test layer can't catch this.

## 13. Follow-ups (post-H3)

To file in `followups.md` after H3 ships:

- **FU-035-H3-followup-A:** Integration smoke for `renderCombinedInvoicePdf` + `renderInvoicePdf` peek-and-delegate. Same pattern as H1-followup-A and H2-followup-A.
- **FU-035-H3-followup-B:** "Load # collapse" in InvoiceDetails when consolidated_count is large (e.g., `"(15 loads)"` already works but `"(150 loads)"` looks odd; consider `"(N+ loads)"` truncation at some threshold).

H3 inherits the existing follow-ups:
- FU-035-H1-followup-C (hoist deriveLoadLevelLocations) — now applies to 4 renderers
- FU-035-H1-followup-D (extract fetch-moves-with-events) — combined_invoice doesn't fetch moves+events per-order, so this FU does NOT apply to combined_invoice. Still applies to DO + Invoice + Rate Con.
- FU-035-H1-followup-E (wire section_config.disclaimer through) — now applies to 4 renderers
- (Pre-H4 consideration: split lib/constants/document-sections.js by per-doc-type sibling files — now even more compelling with 4 registries)

H3 implementation closes with `Resolves: FU-035-H3` in the final commit.

## 14. Implementation order (preview)

(Detailed plan via writing-plans next.)

1. Constants + types: add 'combined_invoice' to DOCUMENT_TYPES + COMBINED_INVOICE_SECTIONS → 2 test files green
2. Validator regression coverage → 1 test file green
3. Sample data file + DocumentPreview registration of combined_invoice sample
4. ChargeDetails + ChargeDetailsPreview `groupByLoad` prop addition (PDF + HTML)
5. InvoiceDetails + InvoiceDetailsPreview `(N loads)` Load Number rendering
6. LoadsSummary (PDF) + LoadsSummaryPreview (HTML)
7. DocumentPreview wiring for combined_invoice doc-type (groupByLoad + customerLabel overrides)
8. buildSectionData for combined_invoice + tests
9. fetchCombinedInvoiceData + renderCombinedInvoicePdf
10. renderInvoicePdf peek-and-delegate
11. CombinedInvoiceTemplate.js composer
12. Manual verification + dd-qa
13. Close FU-035-H3 in followups.md
