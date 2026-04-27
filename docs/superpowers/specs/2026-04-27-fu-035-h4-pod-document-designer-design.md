# FU-035-H4 — Proof of Delivery (POD) Document Designer

**Status:** Design (brainstormed 2026-04-27, after FU-035-H1/H2/H3 ship)
**Depends on:** FU-035-H1/H2/H3 (architecture pattern + cross-doc-type reuse)
**Unblocks:** FU-035-H4-followup-B (send-email + bulk-send), FU-035-H4-followup-C (embedded image thumbnails)

## 1. Goal

Add a Proof of Delivery (POD) doc type to the Document Designer + a download URL endpoint so tenants can generate a POD PDF for any order. Send-email infrastructure deferred to a follow-up FU. Tenants can customize their POD template per-bill-to-customer via the existing cascade resolver.

After this lands:
- The Document Designer's doc-type dropdown adds a 6th entry (DO Full + DO Next Move + Invoice + Rate Con + Combined Invoice + POD)
- Per-customer cascade for POD templates (keyed on `order.customer_id` — same as Invoice/Combined)
- New endpoint `GET /api/tenant/pdf/pod/[orderId]` returns the rendered POD as `application/pdf` (inline)
- Live HTML preview matches printed PDF

## 2. Non-goals (deferred)

- **Send-email + bulk-send infrastructure for PODs.** No `/api/tenant/orders/[id]/send-pod-email.js` or bulk variant. UI integration (Loads sidebar "Send POD" button) is NOT in scope. **FU-035-H4-followup-B** will pick this up.
- **Embedded POD image thumbnails.** v1 lists `order_documents` filenames + uploaded_at only. Embedded React-PDF `<Image>` thumbnails (with Supabase Storage signed-URL fetch) deferred. **FU-035-H4-followup-C**.
- **Customer signature capture.** No schema for it today. The `signature` section is registered with `defaultVisible: false` for tenants who want a paper-signing block, but no auto-populated captured signature.
- **Driver signature image storage.** Same — no schema.
- **POD reference numbering.** No `pod_reference` ID column anywhere. Skipped.
- **POD archive (Storage upload on render).** Renders fresh on each request. Archive comes with the send-email follow-up.

## 3. Architecture decisions

### 3.1 Independent `POD_SECTIONS` registry (Approach A — same as H1/H2/H3)

`POD_SECTIONS` is its own array in `lib/constants/document-sections.js`. Its category in DOCUMENT_TYPES is **`'load'`** (not `'ar'`) — POD is a load-side artifact like Delivery Order, not a billing artifact like Invoice/Rate Con/Combined.

### 3.2 Cascade by `order.customer_id`

Same pattern as Invoice and Combined Invoice. Tenants can have a Walmart-specific POD template distinct from their Walmart-specific Invoice.

### 3.3 Public API: NEW download endpoint, NO send-email

```
GET /api/tenant/pdf/pod/[id]   (id = orderId)
  → 200 application/pdf (PDF binary, inline disposition)
  → 404 Order not found
  → 403 Permission denied
  Permission gate: ORDER_ENTRY / DISPATCHING / ACCOUNTS_RECEIVABLE / ALL
```

Mirrors the existing `pages/api/tenant/pdf/rate-con/[id].js` shape. The new public renderer is `renderPodPdf(svc, orderId, tenantId)` (keyed by orderId, not chargeSetId or invoiceId).

NO peek-and-delegate logic — POD is a standalone doc type with its own renderer entry point. There's no consolidation concept to detect.

### 3.4 Component reuse from prior FUs

Reuse without changes (no new props):
- `Header` (PDF + preview)
- `AddressDetails` (PDF + preview) — same `customerLabel='Bill To'` + `bill_to → customer` field-ID translation as Invoice / Combined Invoice
- `OrderDetails` (19 fields shared across DO/Invoice/Rate Con/POD/Combined)
- `CommodityDetails` (5 fields)
- `Notes` — registry only includes `driver_notes` for POD; component renders whatever data is present
- `Signature` — defaultVisible:false; renders the paper-signing fields when toggled
- `Disclaimer` — defaultVisible:false; tenant configures via section_config (still subject to FU-035-H1-followup-E wiring)
- `MoveBlock` — used; defaultVisible:**TRUE** for POD (the timeline IS the proof)
- `DocumentFooter` — used
- All preview mirrors

NEW components (2 pairs):
- `PodDetails.js` (PDF) + `PodDetailsPreview.js` (HTML) — 5-field 3-col grid analogous to RateConDetails
- `AttachedDocuments.js` (PDF) + `AttachedDocumentsPreview.js` (HTML) — file-listing table

### 3.5 Driver name resolution heuristic

An order with N moves can have different drivers per move. POD's "Driver" should be the driver of the move that actually delivered. Implementation: scan moves in reverse, find the first move whose `events[]` includes `event_type='deliver'`, take that move's driver. Fallback chain: last-move-with-deliver → last move overall → first move → null. Tested in `pod-build-section-data.test.mjs`.

### 3.6 `formatTime` helper extension

`lib/pdf/format-date.js` (created in H1+H2 hotfix `19da780`) exports `formatDate(input) → "Apr 26, 2026"`. POD's `delivery_time` field needs an analogous time-only format. Add a sibling export `formatTime(input) → "2:30 PM"` to the same file. `delivery_date` stays separate from `delivery_time` so tenants can hide one and not the other.

### 3.7 Single-page composer

Like Invoice/Rate Con/Combined Invoice, PodTemplate renders one `<Page>` per call. No multi-doc iteration.

### 3.8 No eligibility gate on the download endpoint

Tenants can render a POD for an order that hasn't been delivered yet. Sections degrade gracefully (empty Move Events, empty `pod_details.delivery_date`, empty Attached Documents). The Document Designer customization point + sparse render is acceptable for early v1; if it surfaces as confusion in the field, an "is_delivered" gate becomes a follow-up.

## 4. File touch-list

```
EDIT     lib/constants/document-types.js                  add 'pod' DOCUMENT_TYPES entry
EDIT     lib/constants/document-sections.js               add POD_SECTIONS + register in SECTIONS_BY_DOCUMENT_TYPE
EDIT     lib/pdf/format-date.js                           +formatTime() helper
NEW      lib/pdf/build-pod-section-data.js                pure helper (testable)
NEW      lib/pdf/render-pod.js                            fetchPodData + renderPodPdf
NEW      components/pdf/PodTemplate.js                    composer (single Page)
NEW      components/pdf/sections/PodDetails.js            5-field grid
NEW      components/pdf/sections/AttachedDocuments.js     file-listing table

NEW      pages/api/tenant/pdf/pod/[id].js                 download endpoint

NEW      components/settings/document-designer/preview/PodDetailsPreview.js
NEW      components/settings/document-designer/preview/AttachedDocumentsPreview.js
EDIT     components/settings/document-designer/preview/DocumentPreview.js
         (register pod_details + attached_documents previews + sample data lookup)

NEW      lib/document-designer/sample-data-pod.js         POD sample data

NEW      tests/document-sections-pod-constants.test.mjs           ~10 cases
NEW      tests/document-types-constants-pod.test.mjs              ~3 cases
NEW      tests/validate-section-config-pod.test.mjs               ~6 cases
NEW      tests/pod-build-section-data.test.mjs                    ~6 cases
```

**Files explicitly NOT touched:**
- `lib/pdf/resolve-template-config.js` — already per-doc-type
- `lib/pdf/validate-section-config.js` — auto-supports any registered doc type
- `pages/settings/document-designer/index.js`, ConfigurationBar, etc. — auto-iterate DOCUMENT_TYPES
- All H1/H2/H3 doc-type-specific files (InvoiceTemplate, RateConTemplate, CombinedInvoiceTemplate, render-invoice, render-rate-con, render-combined-invoice)
- All shared section components — used unchanged
- `lib/pdf/archive.js` — POD archive comes with the send-email follow-up

**Migrations:** none. POD pulls from existing `orders`, `order_routing_events`, `order_container_moves`, `order_documents`, `tenants`, `tenant_settings`. No schema changes.

## 5. `POD_SECTIONS` registry (full)

11 sections (10 toggleable + Footer always-on). 40 leaf toggles total: Header 5 + POD Details 5 + Address Details 5 + Order Details 19 + Commodity Details 5 + Notes 1 = 40.

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
      { id: 'display_pickup_for_operational_street_turns', label: 'Display Pickup Location for Operational Street Turns', defaultVisible: false },
    ],
  },
  {
    id: 'move_events',
    label: 'Move Events',
    defaultVisible: true,           // ← TRUE for POD (the timeline IS the proof)
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

SECTIONS_BY_DOCUMENT_TYPE = {
  ...existing,
  pod: POD_SECTIONS,
};
```

**Field-ID isolation across doc types (validator regression coverage):**
- `pod_details.fields.{order_number, driver_name, delivery_date, delivery_time}` — POD-only. Validator rejects on Invoice / Rate Con / Combined / DO.
- `attached_documents` master toggle — POD-only.
- `notes.fields.{billing_notes, load_notes, customer_notes, yard_notes}` — REJECTED on POD (only `driver_notes` is registered).
- `address_details.fields.customer` — REJECTED on POD (uses `bill_to`, like Invoice).

## 6. `DOCUMENT_TYPES` addition

```js
{
  value: 'pod',
  label: 'Proof of Delivery',
  description: 'Document confirming a load was delivered',
  category: 'load',
}
```

`category: 'load'` matches DO (PODs are load-side artifacts, not billing).

## 7. Renderer data shape

`fetchPodData(svc, orderId, tenantId)` returns:

```ts
{
  order_id: string,
  tenant_name: string,
  tenant_info: { logo_url, address, phone, website },

  // Bill To (cascade key)
  bill_to: { name, address_line1, city, state, zip } | null,
  customer_contact: { phone, email } | null,
  bill_to_customer_id: string | null,

  // POD Details section
  pod_meta: {
    order_number: string,                       // = order.order_number
    customer_reference: string | null,          // = order.customer_reference
    driver_name: string | null,                 // resolved via driver-name heuristic (§3.5)
    delivery_date: string | null,               // formatDate(last deliver event's departed_at || arrived_at)
    delivery_time: string | null,               // formatTime(same source)
  },

  // Equipment Details
  first_order: { /* same shape as Invoice's first_order — 19 columns */ } | null,

  // Address Details (load-level locations)
  load_level_locations: { pickup_location, delivery_location, return_location } | null,

  // Move Events
  moves: Array<{ id, move_index, move_type, status, driver, events }>,

  // Attached Documents (NEW)
  attached_documents: Array<{
    id: string,
    file_name: string,
    document_type: string,                      // always 'POD' but kept for future flexibility
    uploaded_at: string,                        // formatted via formatDate
  }>,
}
```

**Fetch sequence (~5-6 round trips):**
1. order + customer (1 query, joined — same shape as `fetchDeliveryOrderData`)
2. moves + events (2 queries — same as DO/Invoice/Rate Con; 2nd query conditional on `moveIds.length > 0`)
3. order_documents WHERE document_type='POD' (1 query, sorted by uploaded_at ascending)
4. tenants + tenant_settings (1 query)

**Driver name resolution per §3.5.** Last-move-with-deliver-event → last move → first move → null. Driver name is `${first_name} ${last_name}` from the move's joined `drivers` row, or null if no driver assigned.

**`delivery_date` + `delivery_time` source.** Find the last `deliver` event across all moves (sorted by `sequence`). Use `event.departed_at || event.arrived_at`. Both formatted via `formatDate()` and `formatTime()` respectively. Null if no deliver event exists.

**`attached_documents` filter.** `eq('document_type', 'POD')` is critical — `order_documents` may have BOL / WEIGHT_TICKET / etc. rows that should NOT show up here.

## 8. Composer (`components/pdf/PodTemplate.js`)

Mirrors RateConTemplate.js's pattern exactly. Section spine + renderSection switch:

- `header` → Header (title='PROOF OF DELIVERY')
- `pod_details` → PodDetails (NEW)
- `address_details` → AddressDetails with `customerLabel: 'Bill To'` + `bill_to → customer` field-ID translation (mirrored from Invoice/Combined)
- `move_events` → MoveBlock (`isNextMoveOnly={false}`, `totalMoves={doc.moves?.length ?? 0}`)
- `order_details` → OrderDetails
- `commodity_details` → CommodityDetails
- `attached_documents` → AttachedDocuments (NEW)
- `notes` → Notes
- `signature` → Signature
- `disclaimer` → Disclaimer
- `footer` → DocumentFooter

`buildSectionData` is exported separately to `lib/pdf/build-pod-section-data.js` (lessons learned from H1).

`ctx = { variant: 'pod', title: 'PROOF OF DELIVERY', subtitle: null }`.

Single-page render (`<Document><Page wrap>`).

## 9. Renderer (`lib/pdf/render-pod.js`)

```js
import { renderToBuffer } from '@react-pdf/renderer';
import React from 'react';
import PodTemplate from '../../components/pdf/PodTemplate';
import { resolveTemplateConfig } from './resolve-template-config';
import { formatDate, formatTime } from './format-date';

export async function fetchPodData(svc, orderId, tenantId) {
  // 5-6 query fetcher per §7
}

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

## 10. Component breakdown

### 10.1 `components/pdf/sections/PodDetails.js` (NEW)

3-col label-value grid. Skips empty values. 5 fields. Mirrors RateConDetails.js minus the rate-con-specific labeling.

```js
const FIELD_ORDER = [
  ['order_number',       'Order #'],
  ['customer_reference', 'Customer Reference / PO #'],
  ['driver_name',        'Driver'],
  ['delivery_date',      'Delivery Date'],
  ['delivery_time',      'Delivery Time'],
];

export default function PodDetails({ data, opts, colors }) {
  // Same shape as RateConDetails.js / InvoiceDetails.js minus consolidated footnote
}
```

### 10.2 `components/pdf/sections/AttachedDocuments.js` (NEW)

Toggle-aware (master only). Accent-banded header. 2-column table: File Name | Uploaded. Empty-state "(No attached documents)" italic.

```js
export default function AttachedDocuments({ data, opts, colors }) {
  // data: Array<{ id, file_name, document_type, uploaded_at }>
  // opts: master toggle only — no fields registry
  // colors.accent for header band

  // Empty state when data.length === 0:
  //   ATTACHED DOCUMENTS (band)
  //   (No attached documents) (italic)

  // With data:
  //   ATTACHED DOCUMENTS (band)
  //   File Name              Uploaded
  //   POD_signed.jpg         Apr 26, 2026
  //   BOL_delivery_copy.pdf  Apr 26, 2026
}
```

### 10.3 HTML preview components (NEW + EDIT)

- `PodDetailsPreview.js` — Tailwind 3-col grid mirror
- `AttachedDocumentsPreview.js` — Tailwind table mirror
- `DocumentPreview.js` (EDIT):
  - Import 2 new previews
  - Register `pod_details: PodDetailsPreview` and `attached_documents: AttachedDocumentsPreview` in PREVIEW_BY_SECTION_ID
  - Import sample-data-pod, register in SAMPLE_BY_DOCUMENT_TYPE
  - Add per-doc-type override block for `pod`'s `address_details`:
    ```js
    if (s.id === 'address_details' && documentType === 'pod') {
      // Same field-ID translation as Invoice/Combined.
      opts.customerLabel = 'Bill To';
      opts.fields = { ...opts.fields, customer: opts.fields?.bill_to !== false };
    }
    ```

### 10.4 `pages/api/tenant/pdf/pod/[id].js` (NEW)

Mirrors `pages/api/tenant/pdf/rate-con/[id].js`:

```js
import { requireTenantUser, requirePermission, getServiceClient } from '../../../../../lib/tenant-api';
import { PERMISSIONS } from '../../../../../lib/permissions';
import { renderPodPdf } from '../../../../../lib/pdf/render-pod';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ctx = await requireTenantUser(req, res);
  if (!ctx) return;
  if (!requirePermission(
    ctx,
    [PERMISSIONS.ORDER_ENTRY, PERMISSIONS.DISPATCHING, PERMISSIONS.ACCOUNTS_RECEIVABLE, PERMISSIONS.ALL],
    res,
  )) return;

  const { id } = req.query;
  const svc = getServiceClient();

  try {
    const buffer = await renderPodPdf(svc, id, ctx.tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="pod-${id}.pdf"`);
    return res.status(200).send(buffer);
  } catch (e) {
    if (e.message === 'Order not found') {
      return res.status(404).json({ error: 'Order not found' });
    }
    return res.status(500).json({ error: `Render failed: ${e.message}` });
  }
}
```

### 10.5 Sample data

`lib/document-designer/sample-data-pod.js` — POD sample:
- header: same shape as DO sample
- pod_details: `Order #: L-ABC123`, `Customer Reference: PO-12345`, `Driver: John Driver`, `Delivery Date: MONTH DD, YYYY`, `Delivery Time: h:mm AM/PM`
- address_details: customer "SAMPLE BILL TO" + sample pickup/delivery/return (same as Invoice's pattern)
- order_details: 19 ABC123 placeholders
- commodity_details: same as DO
- attached_documents: 2 sample rows (`POD_signed.jpg`, `BOL_delivery_copy.pdf` with `MONTH DD, YYYY` uploaded dates)
- notes: `driver_notes: 'SAMPLE driver notes — delivered without incident'`
- signature: same shape as DO's signature sample
- disclaimer: same as Invoice's

## 11. Test plan

### 11.1 Test infrastructure

`tests/*.test.mjs` using `node:test` + `node:assert/strict`. Same as H1/H2/H3.

### 11.2 New test files

**`tests/document-types-constants-pod.test.mjs`** (~3 cases):
- `'pod'` is in DOCUMENT_TYPES
- `getDocumentType('pod')` returns category `'load'` (NOT 'ar'), label 'Proof of Delivery'
- `isValidDocumentType('pod')` is true

**`tests/document-sections-pod-constants.test.mjs`** (~10 cases):
- POD_SECTIONS entries have required keys
- All 11 sections present in expected order
- Footer non-toggleable
- `move_events` defaultVisible: **TRUE** (different from Invoice/Rate Con/Combined)
- `commodity_details` / `signature` / `disclaimer` defaultVisible: false
- `pod_details` has 5 fields (the POD-specific ones)
- `address_details` has 5 fields including `bill_to` (NOT `customer`)
- `notes` has only `driver_notes` (NOT billing/load notes)
- `attached_documents` has no `fields` (master only)
- `getSectionsForDocumentType('pod') === POD_SECTIONS`
- `computeVisibility` honors POD_SECTIONS defaults

**`tests/validate-section-config-pod.test.mjs`** (~6 cases):
- Validator accepts a full POD section_config payload
- Rejects `customer` on pod's address_details (DO-only field)
- Rejects `billing_notes` on pod's notes
- Rejects `pod_details.fields.invoice_number` (no such field)
- Field-ID isolation: pod_details fields rejected on Invoice / Rate Con / Combined / DO
- Field-ID isolation: invoice_details fields rejected on POD

**`tests/pod-build-section-data.test.mjs`** (~6 cases):
- Maps order metadata to pod_meta (5 fields)
- Driver name resolved from last-move-with-deliver-event
- Driver name fallback chain when no deliver event
- Maps load_level_locations correctly
- Returns null-safe shapes when first_order is null
- Maps attached_documents pass-through

### 11.3 Manual verification (Chrome subagent)

Task 13 of the plan dispatches a Chrome MCP subagent (`mcp__Claude_in_Chrome__*` tools) to:
1. Navigate to `localhost:3000/settings/document-designer?type=pod`
2. Verify 11-section toggle list, default-on/off matrix
3. Click toggles to test on/off behavior; capture screenshots / GIF
4. Read page content via `mcp__Claude_in_Chrome__read_page` to verify sample data renders
5. Navigate to `/loads`, find a delivered order, then `/api/tenant/pdf/pod/<orderId>` → verify PDF opens inline
6. Read console messages + network requests to flag any 500s
7. Regression: visit each prior doc type (Invoice / Combined / Rate Con / DO Full / DO Next Move) — verify no behavior change

Things still deferred to user manual:
- Real customer email send (not implemented)
- Real-tenant production verification

## 12. Risks

**R1. Driver name resolution across multi-move orders.** A drayage order with N moves can have different drivers per move. Heuristic: scan moves in reverse, find first move with a `deliver` event in `events[]`, take that move's driver. Fallback: last move overall → first move → null. Test in `pod-build-section-data.test.mjs` covers all branches.

**R2. `delivery_time` requires a new helper.** `formatDate()` is date-only. POD wants the time too. Adds a sibling export `formatTime(input) → "2:30 PM"` to `lib/pdf/format-date.js`.

**R3. POD with no deliver event yet.** Sections degrade gracefully — empty pod_details fields, empty Move Events, empty Attached Documents. No render error.

**R4. POD across N orders is undefined.** PODs are per-order. No bulk shape considered.

**R5. `order_documents` filter must be `document_type='POD'` only.** Defensive — without it, BOL / WEIGHT_TICKET / etc. would pollute the section.

**R6. Multi-page wrap on long Move Events.** Same trade-off DO/Invoice/Rate Con accept. Acceptable for v1.

**R7. No archive (Storage upload) for POD PDFs.** Renders fresh on every request. Acceptable for v1 (low volume; render is fast). Add archive when send-email lands (FU-035-H4-followup-D).

**R8. `signature` defaults FALSE on POD even though it's more relevant.** No customer-signature schema today. Tenants who want a paper-signing block can enable; not the default.

**R9. New endpoint adds attack surface.** `GET /api/tenant/pdf/pod/[id]` exposes order data via PDF render. Permission gate (ORDER_ENTRY/DISPATCHING/AR/ALL) + tenant_id filter in fetcher = same defense as the existing `pdf/rate-con/[id].js` and `pdf/invoice/[id].js` endpoints. No tenant-isolation regression.

## 13. Follow-ups (post-H4)

To file in `followups.md` after H4 ships:

- **FU-035-H4-followup-A:** Integration smoke for `renderPodPdf` (Supabase mock + `renderToBuffer` + magic bytes assertion).
- **FU-035-H4-followup-B:** POD send-email + bulk-send infrastructure. New endpoints: `/api/tenant/orders/[id]/send-pod-email.js`, `/api/tenant/orders/bulk-send-pod.js`. Loads UI integration ("Send POD" button on load-detail page + bulk action on dispatcher board). The 1c work from the brainstorm.
- **FU-035-H4-followup-C:** Embed POD image thumbnails in the AttachedDocuments section. Requires fetcher to download/sign Supabase Storage URLs + React-PDF `<Image>` integration. Multi-MB PDF cost.
- **FU-035-H4-followup-D:** Archive POD PDFs to Supabase Storage on render (mirror `archiveInvoicePdf`).

H4 inherits/extends existing follow-ups:
- FU-035-H1-followup-C (hoist `deriveLoadLevelLocations`) — applies to 5 renderers
- FU-035-H1-followup-D (extract `fetch-moves-with-events`) — applies to DO + Invoice + Rate Con + POD (combined-invoice still skips this fetch)
- FU-035-H1-followup-E (wire `section_config.disclaimer`) — applies to 5 renderers
- **FU-035-H3-followup-B (split `lib/constants/document-sections.js`)** — file is now ~600 lines after H4. **Strongly recommended before H5.**

H4 implementation closes with `Resolves: FU-035-H4` in the final commit.

## 14. Implementation order (preview)

(Detailed plan via writing-plans next.)

1. Constants + types: 'pod' in DOCUMENT_TYPES + POD_SECTIONS → 2 test files green
2. Validator regression coverage → 1 test file green
3. Sample data + DocumentPreview registration of pod sample
4. Add `formatTime()` helper to format-date.js
5. PodDetails (PDF + Preview)
6. AttachedDocuments (PDF + Preview)
7. DocumentPreview wiring for pod's address_details override (customerLabel + bill_to translation)
8. buildSectionData for POD + tests
9. fetchPodData + renderPodPdf
10. PodTemplate.js composer
11. NEW download endpoint `/api/tenant/pdf/pod/[id].js`
12. Manual verification via Chrome subagent + dd-qa
13. Close FU-035-H4 in followups.md
