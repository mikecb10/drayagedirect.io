# FU-035-H1 — Invoice Document Designer Migration

**Status:** Design (brainstormed 2026-04-27)
**Depends on:** FU-035-A foundation, FU-035-D hierarchical sections, FU-035-D2 PDF layout, FU-035-E live preview, FU-035-F configuration bar, FU-112 field-ID validator
**Unblocks:** FU-035-H2..H9 (Rate Con, POD, Statement, etc. — same architecture)

## 1. Goal

Replace the hardcoded `components/pdf/InvoiceTemplate.js` (95 lines, no toggles, no colors, no preview) with a section-registry-driven composer that mirrors the FU-035-D2 Delivery Order pattern shipped 2026-04-26. After this lands:

- Tenants can toggle Invoice section/field visibility from `/settings/document-designer` exactly like they do for Delivery Order.
- Per-customer Invoice template overrides cascade through the existing resolver.
- Live HTML preview pane works for Invoice. Print (PDF) matches preview.
- Existing send-email + bulk-send paths continue to work with **no signature change** to `renderInvoicePdf(svc, invoiceId, tenantId)`.

## 2. Non-goals (deferred)

- **Multi-load consolidated invoices** — out of scope. v1 renders the first linked order's load-keyed sections + an italic "Includes charges from N loads" footnote when `is_consolidated`. Proper multi-load layout is FU-035-H3 (Combined Invoice).
- **Restoring `name` vs `description` split on `invoice_line_items`** — schema migration deferred until a tenant asks. v1 treats the existing `description` column as the "Charge Name".
- **PortPro fields without a data source** — Free Units, Hours, Yard Notes, Customer Notes, and 17 Order Details extras (Vessel Name, Voyage Name, Genset #, Return #, Reservation #, Chassis Pickup, Chassis Termination, Total Distance, Gray Pool Container/Chassis #, Discharged Date, Ingate Date, Outgate Date, Trailer Number, Deliver Load Date, Purchase Order #, Shipment #) — not registered as toggles. Add when columns exist.
- **Watermark for draft invoices** — FU-035-G covers this for all doc types.
- **Named configurations per (tenant, customer, doc_type)** — FU-035-G.
- **Real-data preview in the editor** — sample-data only, same as DO.

## 3. Architecture decisions

### 3.1 Independent `INVOICE_SECTIONS` registry (Approach A)

`INVOICE_SECTIONS` is its own array in `lib/constants/document-sections.js`, sibling to `DELIVERY_ORDER_SECTIONS`. No shared section helpers. No per-doc-type label override map. Field IDs are scoped per-section and per-doc-type — collisions are not a problem since the validator scopes by `(documentType, sectionId, fieldId)`.

**Why:** YAGNI-correct. Today only DO + Invoice need sections; only AddressDetails has a label that diverges (`"Customer"` → `"Bill To"`), and that is solved with a single component prop (§3.2). When three+ doc types want to share a section, we extract a helper.

### 3.2 AddressDetails parameterized by `customerLabel` prop (A1)

`components/pdf/sections/AddressDetails.js` gets one new prop, `customerLabel`, defaulting to `"Customer"`. The composer passes `'Bill To'` for Invoice; DO passes nothing.

**Why:** Single 2-line change vs maintaining a forked `AddressDetailsInvoice.js` file.

The Invoice registry uses field ID `bill_to` (not `customer`). The composer translates inside its `renderSection` switch:
```js
case 'address_details': {
  const addrOpts = {
    ...opts,
    customerLabel: 'Bill To',
    fields: { ...opts.fields, customer: opts.fields?.bill_to !== false },
  };
  return <AddressDetails data={...} opts={addrOpts} colors={colors} />;
}
```
This isolates the field-ID translation to one site. AddressDetails internals remain stable for DO.

### 3.3 New ChargeDetails component (B1)

`components/pdf/sections/ChargeDetails.js` is a new toggle-aware table. `LineItemsTable.js` is left alone (still imported by anything that needs the simple 4-col Description/Qty/Rate/Amount layout).

**Why:** ChargeDetails has different semantics (4 toggleable columns + accent-banded header + totals footer). Extending LineItemsTable would overload it; new component is cleaner and lets the legacy template coexist briefly.

### 3.4 Single-page composer (no doc iteration)

`InvoiceTemplate.js` renders one `<Page>` for one invoice. Unlike `DeliveryOrderTemplate.js` (which iterates `docs` for bulk DO printing), the invoice composer takes a single `doc` prop. The bulk-send path renders each invoice through its own composer call (already the existing pattern in `pages/api/tenant/ar/invoices/bulk-send.js:258`).

### 3.5 Multi-load consolidated invoice handling (3a)

For an `is_consolidated = true` invoice with N linked charge sets:
- Charge Details aggregates all line items (matches today's behavior)
- Address Details / Order Details / Move Events render the **first** linked order's data
- Invoice Details renders an italic muted footnote `"Includes charges from N loads"` below the field grid

**Why:** Matches today's silent first-order behavior, but documented and visible to the tenant. Page-explosion risk avoided. H3 is the proper multi-load redesign.

## 4. File touch-list

```
EDIT     lib/constants/document-types.js                  add 'invoice' DOCUMENT_TYPES entry
EDIT     lib/constants/document-sections.js               add INVOICE_SECTIONS + register in SECTIONS_BY_DOCUMENT_TYPE
REPLACE  components/pdf/InvoiceTemplate.js                composer rewrite (single Page; buildSectionData + renderSection)
EDIT     lib/pdf/render-invoice.js                        rewrite: fetchInvoiceData + cascade resolve + render
NEW      components/pdf/sections/InvoiceDetails.js        6-field grid PDF, +consolidated footnote
NEW      components/pdf/sections/ChargeDetails.js         toggle-aware 4-col table, accent-banded header, totals footer
EDIT     components/pdf/sections/AddressDetails.js        +customerLabel prop, default 'Customer'
NEW      components/settings/document-designer/preview/InvoiceDetailsPreview.js
NEW      components/settings/document-designer/preview/ChargeDetailsPreview.js
EDIT     components/settings/document-designer/preview/AddressDetailsPreview.js   +customerLabel
EDIT     components/settings/document-designer/preview/DocumentPreview.js         +documentType prop, register new sections
EDIT     components/settings/document-designer/TemplateEditor.js                  pass documentType to DocumentPreview
NEW      lib/document-designer/sample-data-invoice.js     Invoice sample data
RENAME   lib/document-designer/sample-data.js             → sample-data-delivery-order.js
                                                          (update import in DocumentPreview.js)

NEW      tests/document-sections-invoice-constants.test.mjs       ~10 cases
NEW      tests/document-types-constants-invoice.test.mjs          ~3 cases
NEW      tests/validate-section-config-invoice.test.mjs           ~6 cases
NEW      tests/invoice-build-section-data.test.mjs                ~6 cases
```

**Files explicitly NOT touched:**
- `lib/pdf/resolve-template-config.js` — already per-doc-type-aware
- `lib/pdf/validate-section-config.js` — already validates against `getSectionsForDocumentType(type)`; auto-supports `'invoice'`
- `pages/settings/document-designer/index.js`, `ConfigurationBar.js`, `CustomerDropdown.js`, `DocumentTypeDropdown.js` — already iterate `DOCUMENT_TYPES`
- `pages/api/tenant/ar/invoices/[invoiceId]/send-email.js`
- `pages/api/tenant/ar/invoices/bulk-send.js`
- `lib/pdf/archive.js`

**Migrations:** none. No existing `document_templates` rows reference `'invoice'`, so cascade returns `undefined` for current tenants and the composer falls back to registry defaults.

## 5. `INVOICE_SECTIONS` registry (full)

10 sections (9 toggleable + Footer always-on). 47 leaf toggles total: Header 5 + Invoice Details 6 + Address Details 5 + Order Details 19 + Commodity Details 5 + Charge Details 4 + Notes 3. Move Events / Disclaimer / Footer have no leaf toggles.

```js
export const INVOICE_SECTIONS = [
  { id: 'header', label: 'Header', defaultVisible: true, toggleable: true,
    fields: [
      { id: 'logo',         label: 'Logo',         defaultVisible: true },
      { id: 'address',      label: 'Address',      defaultVisible: true },
      { id: 'phone',        label: 'Phone',        defaultVisible: true },
      { id: 'website',      label: 'Website',      defaultVisible: false },
      { id: 'company_name', label: 'Company Name', defaultVisible: true },
    ],
  },
  { id: 'invoice_details', label: 'Invoice Details', defaultVisible: true, toggleable: true,
    fields: [
      { id: 'invoice_number',     label: 'Invoice Number',           defaultVisible: true },
      { id: 'load_number',        label: 'Load Number',              defaultVisible: true },
      { id: 'customer_reference', label: 'Customer Reference / PO #', defaultVisible: true },
      { id: 'invoice_date',       label: 'Invoice Date',             defaultVisible: true },
      { id: 'terms',              label: 'Terms',                    defaultVisible: true },
      { id: 'due_date',           label: 'Due Date',                 defaultVisible: true },
    ],
  },
  { id: 'address_details', label: 'Address Details', defaultVisible: true, toggleable: true,
    fields: [
      { id: 'bill_to',           label: 'Bill To',           defaultVisible: true },
      { id: 'pickup_location',   label: 'Pick Up Location',  defaultVisible: true },
      { id: 'delivery_location', label: 'Delivery Location', defaultVisible: true },
      { id: 'return_location',   label: 'Return Location',   defaultVisible: true },
      { id: 'display_pickup_for_operational_street_turns', label: 'Display Pickup Location for Operational Street Turns', defaultVisible: false },
    ],
  },
  { id: 'move_events', label: 'Move Events', defaultVisible: false, toggleable: true },
  { id: 'order_details', label: 'Order Details', defaultVisible: true, toggleable: true,
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
  { id: 'commodity_details', label: 'Commodity Details', defaultVisible: false, toggleable: true,
    fields: [
      { id: 'commodity',   label: 'Commodity',   defaultVisible: true },
      { id: 'description', label: 'Description', defaultVisible: true },
      { id: 'weight',      label: 'Weight',      defaultVisible: true },
      { id: 'pallets',     label: 'Pallets',     defaultVisible: true },
      { id: 'pieces',      label: 'Pieces',      defaultVisible: true },
    ],
  },
  { id: 'charge_details', label: 'Charge Details', defaultVisible: true, toggleable: true,
    fields: [
      { id: 'charge_name', label: 'Charge Name', defaultVisible: true },
      { id: 'units',       label: 'Units',       defaultVisible: true },
      { id: 'rates',       label: 'Rates',       defaultVisible: true },
      { id: 'charges',     label: 'Charges',     defaultVisible: true },
    ],
  },
  { id: 'notes', label: 'Notes', defaultVisible: true, toggleable: true,
    fields: [
      { id: 'driver_notes',  label: 'Driver Notes',  defaultVisible: false },
      { id: 'billing_notes', label: 'Billing Notes', defaultVisible: true },
      { id: 'load_notes',    label: 'Load Notes',    defaultVisible: false },
    ],
  },
  { id: 'disclaimer', label: 'Disclaimer', defaultVisible: false, toggleable: true },
  { id: 'footer', label: 'Footer', defaultVisible: true, toggleable: false },
];

SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
};
```

## 6. `DOCUMENT_TYPES` addition

```js
{
  value: 'invoice',
  label: 'Invoice',
  description: 'AR invoice for a customer',
  category: 'ar',
}
```

The `category` value is currently descriptive only — not consumed by UI grouping. Earmarked for future grouping when H4 + H5 + H6 land.

## 7. Renderer data shape

`fetchInvoiceData(svc, invoiceId, tenantId)` returns:

```ts
{
  invoice_id: string,

  // Header section
  tenant_name: string,
  tenant_info: { logo_url, address, phone, website },     // tenants + tenant_settings

  // Address Details section (Bill To)
  bill_to: { name, address_line1, city, state, zip } | null,    // invoice's customer
  customer_contact: { phone, email } | null,
  bill_to_customer_id: string | null,                            // for cascade resolver

  // Invoice Details section
  invoice_meta: {
    invoice_number: string,
    invoice_date: string | null,                          // prefer invoices.invoice_date, fall back to sent_at, then created_at
    due_date: string | null,
    terms_days: number | null,                            // invoices.payment_terms_days
    is_consolidated: boolean,
    consolidated_count: number,                           // count of linked invoice_charge_sets
    notes: string | null,                                 // → billing_notes in Notes section
  },

  // First linked order (3a)
  first_order: {
    order_id, order_number, customer_reference,
    container_number, chassis_number,
    container_size, container_type, chassis_size, chassis_type, chassis_owner,
    steamship_line, seal_number, mbol, hbol, booking_number, pickup_number,
    is_hazmat, last_free_day, per_diem_free_day,
    pull_container_date, return_container_date,
    notes: string | null,                                 // → driver_notes
    internal_notes: string | null,                        // → load_notes
  } | null,

  // Address Details (load-level)
  load_level_locations: {                                 // derived from first_order's moves
    pickup_location, delivery_location, return_location,
  } | null,

  // Move Events section
  moves: Array<{ id, move_index, move_type, status, driver, events }>,

  // Charge Details section
  charge_lines: Array<{
    description, quantity, unit_amount_cents, total_amount_cents, sort_order,
  }>,
  totals: { subtotal_cents, total_cents },
}
```

Fetch sequence (5-6 round trips):
1. invoice + customer (1 query)
2. invoice_charge_sets → order_charge_sets → orders (1 query, joined)
3. first order's customer (already joined in #2)
4. first order's moves + events (2 queries — same shape as `fetchDeliveryOrderData`)
5. invoice_line_items (1 query)
6. tenants + tenant_settings (1 query)

## 8. Composer

```js
// components/pdf/InvoiceTemplate.js
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

`buildSectionData(doc)` is exported for testability. It maps the renderer payload into per-section data subsets (mirrors `DeliveryOrderTemplate.js`'s pattern). For Address Details specifically, it sets `data.customer = doc.bill_to ? {...} : null` — AddressDetails component still reads `data.customer` internally.

The **field-ID translation** `bill_to ↔ customer` lives at the `renderSection` switch site (§3.2), NOT in `buildSectionData`. `buildSectionData` deals with **data shape**; `renderSection` deals with **toggle wiring**. Keeping these orthogonal makes both helpers easier to reason about and test:

- `buildSectionData` is a pure data shape mapper — testable without rendering
- `renderSection` is the single site that knows about Invoice's "Bill To" label and the `bill_to → customer` toggle remap

The Invoice-specific label "Bill To" is supplied via `opts.customerLabel` from `renderSection`.

## 9. Renderer (`lib/pdf/render-invoice.js`)

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import InvoiceTemplate from '../../components/pdf/InvoiceTemplate';
import { resolveTemplateConfig } from './resolve-template-config';

export async function fetchInvoiceData(svc, invoiceId, tenantId) {
  // 5-6 query fetcher per §7
}

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

`fetchInvoiceData` is exported for future composability (real-data preview, bulk-send refactor) — same pattern as `fetchDeliveryOrderData`. **Public signature `renderInvoicePdf(svc, invoiceId, tenantId)` is unchanged** — both `[invoiceId]/send-email.js` and `bulk-send.js` continue to work without edits.

## 10. Component breakdown

### 10.1 `components/pdf/sections/InvoiceDetails.js` (NEW)

3-col label-value grid mirroring `OrderDetails.js`. Skips empty values. When `data.consolidated_count > 1`, appends a small italic muted line:

```
Includes charges from 3 loads
```

```js
export default function InvoiceDetails({ data, opts, colors }) {
  // data: { invoice_number, load_number, customer_reference, invoice_date,
  //         terms_days, due_date, consolidated_count }
  // opts.fields: { invoice_number, load_number, customer_reference,
  //                invoice_date, terms, due_date }
  // Terms rendered as `Net ${terms_days}` when terms_days > 0; row hidden
  //   otherwise (avoids "Net 0" looking awkward — see §12 R8).
  // Footnote `Includes charges from N loads` only when consolidated_count > 1.
}
```

### 10.2 `components/pdf/sections/ChargeDetails.js` (NEW)

Toggle-aware table:
- Top: accent-color band with title "CHARGE DETAILS"
- Header row: 1-4 columns based on `opts.fields.{charge_name, units, rates, charges}`
- Body: one row per `data.charge_lines[]`; columns hide together with their header
- Footer: thin top-border row showing `Subtotal` and `Total Due` (always rendered if any rows exist; not toggleable; no tax row — no tax model today)
- Empty state: italic "(No charges)"

### 10.3 `components/pdf/sections/AddressDetails.js` (EDIT)

Two-line change. Add `customerLabel` to the function signature, default `'Customer'`:
```js
export default function AddressDetails({ data, opts, colors }) {
  const customerLabel = opts?.customerLabel || 'Customer';
  // ... existing logic ...
  rows.push(<AddressBlock key="customer" label={customerLabel} ... />);
}
```

### 10.4 HTML preview components (NEW + EDIT)

- `InvoiceDetailsPreview.js` — Tailwind 3-col grid; consolidated footnote
- `ChargeDetailsPreview.js` — HTML table mirroring the PDF component
- `AddressDetailsPreview.js` (EDIT) — `customerLabel` parameterization parity

### 10.5 `DocumentPreview.js` (EDIT)

Add a `documentType` prop. Maps to per-doc-type sample data:
```js
const SAMPLE_BY_TYPE = {
  delivery_order_full: sampleDataDeliveryOrder,
  delivery_order_next_move: sampleDataDeliveryOrder,
  invoice: sampleDataInvoice,
};
const PREVIEW_BY_SECTION_ID = {
  ...existing,
  invoice_details: InvoiceDetailsPreview,
  charge_details:  ChargeDetailsPreview,
};
```
Caller `TemplateEditor.js` passes `documentType={template.document_type}` (1-line addition).

### 10.6 Sample data

`lib/document-designer/sample-data.js` renamed to `sample-data-delivery-order.js`. New `sample-data-invoice.js` with Invoice's per-section sample shapes — `invoice_details` and `charge_details` are new; `header`, `address_details`, `order_details`, `commodity_details`, `notes`, `disclaimer` reuse the same value patterns.

## 11. Test plan

### 11.1 Test infrastructure

`tests/*.test.mjs`, `node:test` + `node:assert/strict`, ESM. No bundler. React-PDF rendering and HTML preview rendering are **not** exercised at the test layer — manual smoke covers those (§11.3).

### 11.2 New test files

**`tests/document-sections-invoice-constants.test.mjs`** (~10 cases):
- INVOICE_SECTIONS entries have required keys (id/label/defaultVisible/toggleable)
- All 10 sections are present
- Footer is non-toggleable
- `move_events`, `commodity_details`, `disclaimer` are `defaultVisible: false`
- `invoice_details` has the 6 expected fields
- `charge_details` has exactly 4 fields — does NOT include Free Units or Hours
- `notes` has exactly 3 fields — does NOT include Yard Notes or Customer Notes
- `address_details` has `bill_to` field ID (NOT `customer`)
- `getSectionsForDocumentType('invoice') === INVOICE_SECTIONS`

**`tests/document-types-constants-invoice.test.mjs`** (~3 cases):
- `'invoice'` is in `DOCUMENT_TYPES`
- `getDocumentType('invoice')` returns category `'ar'`, label `'Invoice'`
- `isValidDocumentType('invoice')` returns true

**`tests/validate-section-config-invoice.test.mjs`** (~6 cases):
- Accepts `bill_to: false` for `'invoice'`
- Rejects `customer: false` for `'invoice'` (Invoice's address_details registry has no such field)
- Rejects `free_units: false` on charge_details (FU-112 enforcement)
- Rejects `hours: false` on charge_details
- Rejects `yard_notes: false` on notes for invoice
- Field-ID isolation regression: same payload accepted by `'delivery_order_full'` (which has `customer`) is rejected by `'invoice'` and vice versa

**`tests/invoice-build-section-data.test.mjs`** (~6 cases — requires exporting `buildSectionData` from `InvoiceTemplate.js`):
- Maps invoice metadata to `invoice_details` (number, dates, terms)
- Adds `consolidated_count` when `is_consolidated`
- Maps `bill_to` → `address_details.customer` (AddressDetails-internal ID)
- Maps `first_order` to `order_details` (19 fields)
- Returns null-safe shapes when `first_order: null`
- Maps `charge_lines` + `totals` to `charge_details`

### 11.3 Manual verification (pre-merge)

1. Run all 35 existing DO tests — must remain green (especially anything touching AddressDetails)
2. Send-email a real invoice through `/ar/invoices` → open PDF in inbox → verify:
   - Header has tenant branding (logo, address, phone if enabled)
   - Invoice Details shows all 6 fields populated
   - Address Details labels the customer block "Bill To" (not "Customer")
   - Charge Details table renders with accent-banded header, totals at bottom
   - Footer present
3. Print a real DO via `/loads` bulk-print → regression check that the AddressDetails parameterization didn't break DO ("Customer" label still renders)
4. Open `/settings/document-designer`, switch the doc-type dropdown to Invoice:
   - Toggle list renders 10 sections, ~47 leaf toggles
   - Live preview renders Invoice's sample data
   - Toggle off Charge Name → preview's table loses that column
   - Toggle off Move Events → no change to preview (no preview component for it; matches DO behavior)
   - Save → no validator error → reload picks up the saved config
5. Customer-scoped override: switch to a specific customer, change accent color to red, save, switch to All Customers, verify default still blue
6. Consolidated invoice: find or create an invoice with 2+ charge_sets, send-email, verify:
   - "Includes charges from 2 loads" footnote under Invoice Details
   - Address/Order/Move sections show first linked order's data
   - No crashes

## 12. Risks

**R1. Field-ID translation in `renderSection` is easy to misplace.** The `bill_to ↔ customer` translation is in one site. Mitigated by 11.2's "save bill_to=false → check Bill To block hidden" coverage and a code comment at the translation site.

**R2. Long lookup chain may produce `first_order: null`.** When `invoice_charge_sets` is empty or the linked `order_charge_sets[0].order` is soft-deleted. Address Details / Order Details / Move Events degrade gracefully (sections short-circuit; composer doesn't crash). 11.2 has a null-safe coverage case.

**R3. Multi-page wrap on long invoices.** A consolidated invoice with 50+ charge lines will paginate; the accent-banded table header won't repeat on subsequent pages (no per-section `wrap` declarations). Acceptable for v1; same as DO and PortPro.

**R4. AddressDetails `customerLabel` is on DO's hot path.** Default value preserves DO behavior. Verified by 35 existing tests + manual DO print.

**R5. Storage / archive path unchanged.** `archiveInvoicePdf` is layout-independent.

**R6. No feature-flag rollback.** Wholesale replacement; regression requires git revert. Pre-merge: visually compare 3 representative invoices old-vs-new.

**R7. Email body templates are independent of the PDF.** `lib/email-dispatch/context-builder.js` pulls fields from invoice + customer rows, not from the PDF. No cross-coupling.

**R8. `Net ${terms_days}` rendering is net-new copy.** Today's hardcoded template doesn't render Terms. If a tenant has unusual terms (e.g. "Due upon receipt", "Net EOM"), `Net 0` looks awkward. Mitigation: render Terms only when `terms_days > 0`; show nothing otherwise.

## 13. Follow-ups (post-H1)

To file in `followups.md`:
- **FU-035-H1-followup-A**: Integration smoke for `renderInvoicePdf` (Supabase mock + `renderToBuffer` + assert PDF byte signature). Currently manual.
- **FU-035-H1-followup-B**: Visual diff harness — render same invoice ID with old + new templates, byte-diff or pixel-diff. Useful before H2/H3.

H1 implementation will close FU-035-H1 in followups.md (commit body: `Resolves: FU-035-H1`).

## 14. Implementation order (preview)

(Detailed plan to follow in the writing-plans phase.)

1. Constants + types: add INVOICE_SECTIONS + 'invoice' to DOCUMENT_TYPES → write 2 test files → all green
2. Validator regression tests for Invoice (3 test files in tests/) → all green
3. Refactor `lib/document-designer/sample-data.js` → split into per-doc-type files; update DocumentPreview's import
4. Add `customerLabel` prop to AddressDetails (PDF + Preview); 35 DO tests still green
5. Build new components: InvoiceDetails (PDF + Preview), ChargeDetails (PDF + Preview)
6. Register new previews in DocumentPreview.js; pass documentType from TemplateEditor
7. Rewrite `lib/pdf/render-invoice.js` (fetchInvoiceData + cascade)
8. Replace `components/pdf/InvoiceTemplate.js` with composer
9. Manual smoke: print real invoice, print real DO, exercise Document Designer UI, exercise consolidated invoice
10. dd-qa pass; commit; close FU-035-H1
