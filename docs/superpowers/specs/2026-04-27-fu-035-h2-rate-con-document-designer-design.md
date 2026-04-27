# FU-035-H2 — Rate Confirmation Document Designer Migration

**Status:** Design (brainstormed 2026-04-27, after FU-035-H1 ships)
**Depends on:** FU-035-H1 (which delivered the architecture, the AddressDetails customerLabel pattern, and the ChargeDetails component this design extends)
**Unblocks:** FU-035-H3..H9 — same architecture; once H2 lands two doc types prove the cross-doc-type reuse pattern

## 1. Goal

Replace the hardcoded `components/pdf/RateConTemplate.js` (~92 lines, no toggles, no colors, no preview) with a section-registry-driven composer mirroring FU-035-H1's pattern. Tenants can toggle Rate Con section/field visibility from `/settings/document-designer`; per-customer cascade works; live HTML preview matches the printed PDF.

After this lands:
- The Document Designer's doc-type dropdown adds a third entry: Rate Confirmation
- Per-customer Rate Con templates cascade through the existing resolver (keyed on `order.customer_id` — the bill-to who originated the load)
- Existing send + bulk-send + preview + archive paths keep working with NO signature change to `renderRateConPdf(svc, chargeSetId, tenantId)`

## 2. Non-goals (deferred)

- **Per-carrier cascade.** Carriers (driver companies) aren't first-class entities in our schema today — drivers are; their companies are loosely tracked at best. Cascade by `order.customer_id` (the bill-to) is the only viable cascade key.
- **Multi-charge-set "consolidated rate con."** Doesn't exist as a workflow today. Each rate con maps 1:1 to a charge set.
- **Free-form Carrier address block on the PDF** (TO: [carrier name + address]). Requires carrier-data wiring not in scope. Defer.
- **"Confirmed by reply" disclaimer footer copy.** Per `feedback_rate_con_no_signature.md`, rate cons are confirmed via email reply, not signature. The reply-to-confirm expectation belongs in the email body (not the PDF). The Disclaimer section in the registry (defaultVisible:false) lets a tenant add custom T&Cs if they want.
- **Watermark, named configurations, rich-text disclaimer editor** — covered by FU-035-G across all doc types. Out of H2 scope.

## 3. Architecture decisions

### 3.1 Independent `RATE_CON_SECTIONS` registry (Approach A — same as H1)

`RATE_CON_SECTIONS` is its own array in `lib/constants/document-sections.js`, sibling to `DELIVERY_ORDER_SECTIONS` and `INVOICE_SECTIONS`. No shared section helpers. No per-doc-type label override map. Field IDs are scoped per `(documentType, sectionId, fieldId)` by the validator, so cross-doc-type field-ID overlap is safe and intentional where it makes sense (e.g., `order_details` field IDs are shared across DO + Invoice + Rate Con because they refer to the same underlying order columns).

### 3.2 Cascade by `order.customer_id`

Same pattern as H1's Invoice (which used `invoice.customer_id`). For Rate Con, the cascade resolver is called with the order's bill-to customer ID. This lets a tenant make per-customer Rate Con templates if they want; if they don't, the tenant default applies for all rate cons.

### 3.3 Component reuse (the architectural payoff of having shipped H1)

Reuse without changes:
- `components/pdf/sections/Header.js`
- `components/pdf/sections/AddressDetails.js` — Rate Con's composer passes `data.customer = null`, and the existing component short-circuits the customer block when null. Zero change required.
- `components/pdf/sections/OrderDetails.js` — same 19 fields, just labeled "Equipment Details" in the registry
- `components/pdf/sections/CommodityDetails.js`
- `components/pdf/sections/Notes.js`
- `components/pdf/sections/Signature.js`
- `components/pdf/sections/Disclaimer.js`
- `components/pdf/sections/MoveBlock.js`
- `components/pdf/sections/DocumentFooter.js`
- All 9 of those files' HTML preview mirrors

Reuse with one tiny change:
- `components/pdf/sections/ChargeDetails.js` — adds `opts.showSubtotal` prop, default `true` (Invoice behavior preserved). Rate Con composer passes `showSubtotal: false` because `charge_set.total_cents` is the only authoritative total for a rate con (no subtotal_cents column).
- Same `showSubtotal` prop on `ChargeDetailsPreview.js` for preview-print parity.

NEW (1 PDF section + 1 preview mirror):
- `components/pdf/sections/RateConDetails.js` — 5-field 3-col grid, mirrors `InvoiceDetails.js` minus the consolidated_count footnote and minus the terms_days special case
- `components/settings/document-designer/preview/RateConDetailsPreview.js` — HTML mirror

### 3.4 Single-page composer

Like Invoice, Rate Con renders one `<Page>` per document. No multi-doc iteration.

### 3.5 Field-ID isolation across doc types

Validator behavior under FU-112 means a Rate Con `section_config` payload that references `bill_to` (Invoice's only customer-block field) or `customer` (DO's only customer-block field) will be rejected. Rate Con's `address_details.fields` only contains the 4 location fields. Same isolation applies to `notes.fields.billing_notes` (Invoice-only) and `invoice_details.*` (also Invoice-only).

### 3.6 Cross-doc-type field-ID sharing where it makes sense

`order_details.fields.*` (the 19 equipment fields) are shared verbatim across DO / Invoice / Rate Con. They reference the same underlying order columns (container_number, chassis_size, etc.) and there's no value in renaming them per-doc-type. The label-vs-ID separation lets each doc type LABEL the section differently ("Order Details" / "Order Details" / "Equipment Details") without forking the field IDs.

Same principle for `charge_details.fields.*` (4 fields shared between Invoice and Rate Con).

## 4. File touch-list

```
EDIT     lib/constants/document-types.js                  add 'rate_con' DOCUMENT_TYPES entry
EDIT     lib/constants/document-sections.js               add RATE_CON_SECTIONS + register in SECTIONS_BY_DOCUMENT_TYPE
NEW      lib/pdf/build-rate-con-section-data.js           pure helper (testable; matches H1 pattern)
EDIT     lib/pdf/render-rate-con.js                       rewrite: fetchRateConData + cascade resolve + composer
REPLACE  components/pdf/RateConTemplate.js                composer (single Page; mirrors InvoiceTemplate.js)
NEW      components/pdf/sections/RateConDetails.js        5-field grid PDF
EDIT     components/pdf/sections/ChargeDetails.js         +showSubtotal prop, default true
NEW      components/settings/document-designer/preview/RateConDetailsPreview.js
EDIT     components/settings/document-designer/preview/ChargeDetailsPreview.js   +showSubtotal mirror
EDIT     components/settings/document-designer/preview/DocumentPreview.js        register rate_con_details + showSubtotal=false override for rate_con
NEW      lib/document-designer/sample-data-rate-con.js    Rate Con sample data

NEW      tests/document-sections-rate-con-constants.test.mjs        ~10 cases
NEW      tests/document-types-constants-rate-con.test.mjs           ~3 cases
NEW      tests/validate-section-config-rate-con.test.mjs            ~6 cases
NEW      tests/rate-con-build-section-data.test.mjs                 ~6 cases
```

**Files explicitly NOT touched:**
- `lib/pdf/resolve-template-config.js` (already per-doc-type)
- `lib/pdf/validate-section-config.js` (auto-supports any registered doc type via `getSectionsForDocumentType`)
- `pages/settings/document-designer/index.js`, `ConfigurationBar.js`, `CustomerDropdown.js`, `DocumentTypeDropdown.js` (auto-iterate DOCUMENT_TYPES)
- All 4 rate-con send/render API endpoints: `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js`, `pages/api/tenant/ar/charge-sets/bulk-send-rate-con.js`, `pages/api/tenant/pdf/rate-con/[id].js`, `lib/pdf/archive.js`
- All H1-shipped Invoice files
- All H1-shipped section components (Header, AddressDetails, OrderDetails, CommodityDetails, Notes, Signature, Disclaimer, MoveBlock, DocumentFooter, InvoiceDetails) and their preview mirrors

**Migrations:** none. No existing `document_templates` rows reference `'rate_con'`, so the cascade resolver returns `undefined` for current tenants and the composer falls back to registry defaults.

**Old `RateConTemplate.js` fate:** Replaced wholesale (D1 pattern from H1). Pre-merge: visually compare 2-3 representative rate cons against the legacy template's output.

## 5. `RATE_CON_SECTIONS` registry (full)

11 sections (10 toggleable + Footer always-on). 44 leaf toggles total: Header 5 + Rate Confirmation Details 5 + Address Details 4 + Order Details 19 + Commodity Details 5 + Charge Details 4 + Notes 2.

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

SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
  invoice: INVOICE_SECTIONS,
  rate_con: RATE_CON_SECTIONS,
};
```

**Differences from Invoice's address_details:** No `bill_to` field — only the 4 location fields. The validator will reject `bill_to: false` on a rate_con payload.

**Differences from Invoice's notes:** Only 2 fields (driver_notes, load_notes). No `billing_notes` (irrelevant on a rate con). Validator rejects `billing_notes: false` on rate_con.

## 6. `DOCUMENT_TYPES` addition

```js
{
  value: 'rate_con',
  label: 'Rate Confirmation',
  description: 'Confirmation of a negotiated rate sent to a carrier',
  category: 'ar',
}
```

## 7. Renderer data shape

`fetchRateConData(svc, chargeSetId, tenantId)` returns:

```ts
{
  charge_set_id: string,
  tenant_name: string,
  tenant_info: { logo_url, address, phone, website },

  // Cascade resolver key — order's bill-to customer
  bill_to_customer_id: string | null,

  // Rate Confirmation Details section
  rate_con_meta: {
    confirmation_number: string,           // = charge_set.charge_set_number
    issue_date: string | null,             // = charge_set.created_at
    reference_number: string | null,       // = order.customer_reference || order.order_number
    pickup_appointment: string | null,     // = order.pickup_apt_from
    delivery_appointment: string | null,   // = order.delivery_apt_from
  },

  // First (only) order linked via charge_set.order_id — same shape as Invoice's first_order
  first_order: {
    order_id, order_number, customer_reference,
    container_number, chassis_number,
    container_size, container_type, chassis_size, chassis_type, chassis_owner,
    steamship_line, seal_number, mbol, hbol, booking_number, pickup_number,
    is_hazmat, last_free_day, per_diem_free_day,
    pull_container_date, return_container_date,
    notes: string | null,                  // → driver_notes
    internal_notes: string | null,         // → load_notes
  } | null,

  load_level_locations: { pickup_location, delivery_location, return_location } | null,
  moves: Array<{ id, move_index, ... events }>,

  // Charge Details — sourced from order_charge_set_line_items DIRECT (not invoice_line_items)
  // because rate cons can be re-sent and the charge set is the live source of truth.
  charge_lines: Array<{
    description, quantity, unit_amount_cents, total_amount_cents,
  }>,
  totals: { total_cents },                 // NOTE: no subtotal_cents — charge_set.total_cents is the only total
}
```

**Fetch sequence (4-5 round trips):**
1. charge_set + order + pickup_org + delivery_org (1 query, joined — same shape as today's render-rate-con.js but extending the order select)
2. order's moves + events (2 queries, conditional — same as Invoice's pattern)
3. order_charge_set_line_items (1 query — direct, not invoice_line_items)
4. tenants + tenant_settings (1 query)

**`description || name` fallback** on charge lines must match the legacy renderer's behavior (`render-rate-con.js:48`) so blank rows don't appear when only `name` is set.

## 8. Composer

`components/pdf/RateConTemplate.js` follows InvoiceTemplate.js's exact pattern:

```js
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

`renderSection` switch dispatches to:
- `header` → Header (title='RATE CONFIRMATION')
- `rate_con_details` → RateConDetails
- `address_details` → AddressDetails (no field-ID translation needed since rate_con has no `customer`/`bill_to` toggle)
- `move_events` → MoveBlock
- `order_details` → OrderDetails (label "Equipment Details" lives in registry)
- `commodity_details` → CommodityDetails
- `charge_details` → ChargeDetails with `opts.showSubtotal = false` injected
- `notes` → Notes
- `signature` → Signature
- `disclaimer` → Disclaimer
- `footer` → DocumentFooter

`buildSectionData` is exported separately to `lib/pdf/build-rate-con-section-data.js` (per H1's lesson learned about JSX-vs-test-runner).

## 9. Renderer (`lib/pdf/render-rate-con.js`)

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import RateConTemplate from '../../components/pdf/RateConTemplate';
import { resolveTemplateConfig } from './resolve-template-config';

export async function fetchRateConData(svc, chargeSetId, tenantId) { /* §7 */ }

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

**Public signature `renderRateConPdf(svc, chargeSetId, tenantId)` is unchanged.** All 4 callers (`send-rate-con-email.js`, `bulk-send-rate-con.js`, `pdf/rate-con/[id].js`, `archive.js`) keep working without edits.

## 10. Component breakdown

### 10.1 `components/pdf/sections/RateConDetails.js` (NEW)

3-col label-value grid. Mirrors InvoiceDetails.js minus the `consolidated_count` footnote and minus the `terms_days` Net N special case. 5 fields:

```js
const FIELD_ORDER = [
  ['confirmation_number',  'Confirmation #'],
  ['issue_date',           'Issue Date'],
  ['reference_number',     'Reference #'],
  ['pickup_appointment',   'Pickup Appointment'],
  ['delivery_appointment', 'Delivery Appointment'],
];

export default function RateConDetails({ data, opts, colors }) {
  // Same shape as InvoiceDetails.js: filter empty, render 3-col grid, use textColor for labels.
}
```

### 10.2 `components/pdf/sections/ChargeDetails.js` (EDIT)

Add `opts.showSubtotal` prop (default `true`):
```js
const showSubtotal = opts?.showSubtotal !== false;
...
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

Same change mirrored in `ChargeDetailsPreview.js` (HTML version uses `colSpan` but the conditional gate is identical).

### 10.3 HTML preview components

- `RateConDetailsPreview.js` (NEW) — Tailwind 3-col grid, mirrors InvoiceDetailsPreview minus consolidated footnote / Net N
- `ChargeDetailsPreview.js` (EDIT) — same `showSubtotal` prop addition
- `DocumentPreview.js` (EDIT):
  - Import RateConDetailsPreview, register in PREVIEW_BY_SECTION_ID
  - Import sample-data-rate-con, register in SAMPLE_BY_DOCUMENT_TYPE
  - Per-doc-type override for charge_details on rate_con:
    ```js
    if (s.id === 'charge_details' && documentType === 'rate_con') {
      opts.showSubtotal = false;
    }
    ```

### 10.4 Sample data

`lib/document-designer/sample-data-rate-con.js` mirrors sample-data-invoice.js. Fields:
- `header`: same shape as Invoice (Your Company / placeholder logo / address / phone / website)
- `rate_con_details`: { confirmation_number: 'RC-2026-001', issue_date: 'MONTH DD, YYYY', reference_number: 'PO-12345', pickup_appointment: 'MONTH DD, YYYY h:mm', delivery_appointment: 'MONTH DD, YYYY h:mm' }
- `address_details`: pickup/delivery/return locations only — NO customer block (data.customer = null)
- `order_details`: same 19 ABC123 placeholders as Invoice's
- `commodity_details`: same as Invoice
- `charge_details`: 3 sample charge lines (Linehaul, FSC, Chassis Day Use); totals: { total_cents: 98000 } — no subtotal_cents
- `notes`: { driver_notes: 'SAMPLE driver notes', load_notes: 'SAMPLE load notes' }
- `signature`: same shape as DO's signature sample (only renders if toggled on)
- `disclaimer`: same shape as Invoice's

## 11. Test plan

### 11.1 Test infrastructure

`tests/*.test.mjs` using `node:test` + `node:assert/strict`. Same as H1.

### 11.2 New test files

**`tests/document-types-constants-rate-con.test.mjs`** (~3 cases):
- `'rate_con'` is in `DOCUMENT_TYPES`
- `getDocumentType('rate_con')` returns category `'ar'`, label `'Rate Confirmation'`
- `isValidDocumentType('rate_con')` returns true

**`tests/document-sections-rate-con-constants.test.mjs`** (~10 cases):
- RATE_CON_SECTIONS entries have required keys
- All 11 sections present in expected order (header, rate_con_details, address_details, move_events, order_details, commodity_details, charge_details, notes, signature, disclaimer, footer)
- footer is non-toggleable
- move_events / commodity_details / signature / disclaimer default OFF
- rate_con_details has 5 fields with the expected IDs
- charge_details has 4 fields (charge_name, units, rates, charges) — NOT free_units / hours
- notes has 2 fields (driver_notes, load_notes) — NOT billing_notes / yard_notes / customer_notes
- address_details has 4 fields — NOT customer / bill_to
- order_details has 19 fields (regression check that field IDs match DO + Invoice)
- `getSectionsForDocumentType('rate_con') === RATE_CON_SECTIONS`

**`tests/validate-section-config-rate-con.test.mjs`** (~6 cases):
- Validator accepts rate_con_details fields
- Validator rejects `bill_to: false` on rate_con (not in registry)
- Validator rejects `customer: false` on rate_con (not in registry)
- Validator rejects `billing_notes: false` on rate_con
- Field-ID isolation regression: customer accepted on DO + rejected on rate_con
- Field-ID isolation regression: bill_to accepted on Invoice + rejected on rate_con

**`tests/rate-con-build-section-data.test.mjs`** (~6 cases):
- Maps rate_con_meta to rate_con_details (5 fields)
- Maps load_level_locations to address_details (no customer field)
- Maps first_order to order_details (19 fields, same as Invoice)
- Returns null-safe shapes when first_order is null
- Maps charge_lines + totals to charge_details (totals has only total_cents, no subtotal_cents)
- Maps notes correctly (driver_notes from order.notes, load_notes from order.internal_notes)

### 11.3 Manual verification (pre-merge)

1. Run all existing tests + new tests — all green except the pre-existing fire-trigger-entity-aware failure
2. Send-email a real rate con via `/ar/charge-sets` → open PDF → verify:
   - Header has tenant branding
   - Rate Confirmation Details grid shows all 5 fields
   - Address Details has Pickup / Delivery / Return blocks (NO Bill To / Customer block)
   - Charge Details shows accent-banded "Rate Details" table with line items
   - Totals footer shows "Total Due" only (NO Subtotal row)
   - Footer present
3. Print a real Delivery Order via `/loads` bulk-print → DO regression check
4. Print a real invoice via `/ar/invoices` → Invoice regression check (especially: Subtotal row still renders for invoices; ChargeDetails default behavior preserved)
5. Open `/settings/document-designer?type=rate_con` → toggle list shows 11 sections, preview renders sample rate con (Pickup / Delivery / Return blocks; Rate Details table; Total only)
6. Save a per-customer override + change accent color to red → reload picks up
7. Toggle off "Charge Name" → that column disappears from the preview's Rate Details table

## 12. Risks

**R1. AddressDetails customer block silent-when-no-customer.** Existing component short-circuits when `data.customer` is null. Composer for Rate Con passes `data.customer = null`. No risk of "Customer:" appearing on a rate con. Verified by reading `components/pdf/sections/AddressDetails.js:64-66`.

**R2. ChargeDetails `showSubtotal` prop default-true preserves Invoice behavior.** Single-site change in PDF + HTML preview, both with default `true`. Tested by Invoice's existing manual smoke + new rate_con test of `showSubtotal: false`.

**R3. `order_charge_set_line_items.description` may be null when only `name` is set.** Existing renderer's fallback (`description || name`) must be preserved in `fetchRateConData`. Without it, blank rows would appear.

**R4. `charge_set.total_cents` has no corresponding subtotal_cents column.** Composer passes `totals = { total_cents }` only. ChargeDetails would default-read `totals.subtotal_cents` as undefined → `formatCents(undefined)` returns `$0.00` — but `showSubtotal: false` prevents that row from rendering on rate cons anyway. Defensive but invisible.

**R5. Distance gate (existing) blocks rate-con sends with unresolved distance charges.** `pages/api/tenant/ar/charge-sets/[id]/send-rate-con-email.js:54-67` already calls `checkChargeSetDistanceGate` BEFORE calling `renderRateConPdf`. Our renderer rewrite doesn't change this — gate still fires.

**R6. No feature-flag rollback.** Wholesale replacement; regression requires git revert. Pre-merge: visual comparison against legacy template's output.

**R7. Send-email body templates remain independent of the PDF.** `lib/email-dispatch/context-builder.js` reads from charge_set + order rows, not the PDF. No cross-coupling.

**R8. Disclaimer label rename to "Terms & Conditions" affects display only.** The section ID stays `disclaimer`, so the data shape and existing Disclaimer.js component work unchanged. The label is what tenants see in the editor.

## 13. Follow-ups (post-H2)

To file in `followups.md` after H2 ships:

- **FU-035-H2-followup-A:** Integration smoke for renderRateConPdf (Supabase mock + PDF magic bytes assertion). Same shape as the H1-followup-A we filed.

H2 inherits the existing H1 follow-ups:
- **FU-035-H1-followup-C** (hoist deriveLoadLevelLocations): now applies to 3 renderers (DO + Invoice + Rate Con). Higher priority once H2 ships.
- **FU-035-H1-followup-D** (extract fetch-moves-with-events): same.
- **FU-035-H1-followup-E** (wire section_config.disclaimer through renderer payload): now also blocking the disclaimer flow for Rate Con. Even higher priority.

H2 implementation closes with `Resolves: FU-035-H2` in the final commit body.

## 14. Implementation order (preview)

(Detailed plan to follow in writing-plans phase.)

1. Constants + types: add 'rate_con' to DOCUMENT_TYPES + RATE_CON_SECTIONS → 2 test files green
2. Validator regression coverage for Rate Con → 1 test file green
3. Sample data file + DocumentPreview registration of rate_con sample
4. ChargeDetails + ChargeDetailsPreview `showSubtotal` prop addition
5. RateConDetails (PDF) + RateConDetailsPreview (HTML)
6. DocumentPreview wiring for rate_con doc-type (showSubtotal=false override)
7. buildSectionData for Rate Con + tests
8. fetchRateConData + renderRateConPdf rewrite
9. RateConTemplate.js composer rewrite
10. Manual verification + dd-qa
11. Close FU-035-H2 in followups.md
