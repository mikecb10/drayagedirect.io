# FU-093: Bulk-Print Delivery Order — Design

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-093 (this session), forward-looking foundation for FU-035 (Document Designer, deferred).
**Discovered during:** bulk-bar gap audit (2026-04-25 polish marathon).

## 1. Goal

Wire the dispatcher bulk-action bar's Print button (currently a "coming soon" toast) to generate a multi-page PDF — one page per selected load — containing each load's **Delivery Order**: a real drayage industry document listing the load's routing, locations, dates, driver assignments, and special instructions.

Two variants of the Delivery Order are supported:

- **FULL Delivery Order** — the entire routing across all moves (e.g., pick container → deliver → drop → hook → return)
- **NEXT MOVE Delivery Order** — only the next non-completed move (e.g., for a load mid-flight, the upcoming "hook + return" leg only)

Architecture is laid out so that the future Document Designer (FU-035) can plug in **per-tenant customization** (section visibility, ordering, per-section options) AND **per-customer overrides** (a tenant can ship a Walmart-specific Delivery Order template alongside their tenant default), with **zero changes** to the v1 template code or data fetch.

## 2. Scope

### In scope (this session)

- New `lib/constants/document-types.js` — registry of document types (`delivery_order_full`, `delivery_order_next_move`).
- New `lib/constants/document-sections.js` — registry of available sections per document type, with `defaultVisible` and `toggleable` flags.
- New `lib/pdf/select-moves.js` — pure helper: given a moves array and variant, returns the moves to render (full set or just the next non-completed one). Returns `null` for NEXT_MOVE when no eligible move exists.
- New `lib/pdf/render-delivery-order.js` — `fetchDeliveryOrderData(svc, orderId, tenantId, variant)` returns the full data shape (or `null` on the NEXT_MOVE no-eligible-move case) for one load.
- New `lib/pdf/render-bulk-delivery-orders.js` — loops over order ids, calls `fetchDeliveryOrderData`, accumulates docs + skipped ids, renders one multi-page PDF buffer.
- New `components/pdf/DeliveryOrderTemplate.js` — composer; iterates docs and section config; wraps each load in a `<Page>`.
- New `components/pdf/sections/*.js` — focused section components (one per logical block; see §5).
- New `pages/api/tenant/loads/bulk-print.js` — POST endpoint accepting `{ ids, variant }`, returns `application/pdf` buffer with `Content-Disposition: inline`.
- Modify `components/dispatcher/BulkActionBar.js` — Print button transitions from `handleStub` to `hasPopover: true`. New inline `PrintForm` component shows two buttons (Full / Next Move), each fires the API call and opens the PDF in a new tab.
- New unit tests:
  - `tests/document-types-constants.test.mjs` (mirrors `tests/load-types-constants.test.mjs`)
  - `tests/document-sections-constants.test.mjs`
  - `tests/select-moves.test.mjs`

### Out of scope (deferred)

- **FU-035 Document Designer UI** — drag-and-drop section config editor in Settings.
- **FU-035 `document_templates` table** — per-tenant + per-customer overrides storage.
- **FU-035 cascade resolver** — `lib/pdf/resolve-template-config.js` that returns a `sectionConfig` keyed by `(tenant, customer, doc_type)`.
- **Live preview** in designer.
- **Variable / token system** for free-text sections.
- **Per-load-type / per-terminal cascade dimensions** beyond `customer_id` — YAGNI; the schema can grow later.
- **Single-load Print on the Load Detail page** — the same endpoint can serve `{ ids: [oneId] }`, but the Load Detail wiring is a separate small follow-up (file as a new FU after this ships).

## 3. Document type registry

`lib/constants/document-types.js` mirrors the shape of `lib/constants/load-types.js` exactly so consumers can `import { DOCUMENT_TYPES, isValidDocumentType } from '...';` with familiar ergonomics.

```js
export const DOCUMENT_TYPES = [
  {
    value: 'delivery_order_full',
    label: 'Delivery Order — Full',
    description: 'Entire routing across all moves',
    category: 'load',
  },
  {
    value: 'delivery_order_next_move',
    label: 'Delivery Order — Next Move',
    description: 'Only the next non-completed move',
    category: 'load',
  },
];

export const VALID_DOCUMENT_TYPES = DOCUMENT_TYPES.map((t) => t.value);
export const DOCUMENT_TYPE_LABELS = Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.value, t.label]));

export function getDocumentType(value) {
  return DOCUMENT_TYPES.find((t) => t.value === value) || null;
}

export function isValidDocumentType(value) {
  return VALID_DOCUMENT_TYPES.includes(value);
}
```

Future additions (e.g., `driver_settlement_summary`, `customer_statement`, `bol`) just append entries.

## 4. Section registry

`lib/constants/document-sections.js` declares the sections available for each document type. Both Delivery Order variants share the same section set.

```js
export const DELIVERY_ORDER_SECTIONS = [
  { id: 'load_metadata',      label: 'Load metadata',                defaultVisible: true,  toggleable: false },
  { id: 'bill_to',            label: 'Bill-to customer',             defaultVisible: true,  toggleable: true  },
  { id: 'customer_contact',   label: 'Customer phone / email',       defaultVisible: true,  toggleable: true  },
  { id: 'equipment_details',  label: 'Container / chassis details',  defaultVisible: true,  toggleable: true  },
  { id: 'hazmat_details',     label: 'Hazmat details',               defaultVisible: true,  toggleable: true  },
  { id: 'instructions',       label: 'Driver notes / instructions',  defaultVisible: true,  toggleable: true  },
  { id: 'appointment_details',label: 'Appointment #s / gate codes',  defaultVisible: true,  toggleable: true  },
  { id: 'move_block',         label: 'Routing (moves + events)',     defaultVisible: true,  toggleable: false },
  { id: 'driver_per_move',    label: 'Driver name per move',         defaultVisible: true,  toggleable: true  },
  { id: 'signature_block',    label: 'Signature block',              defaultVisible: false, toggleable: true  },
  { id: 'barcode',            label: 'Load # barcode',               defaultVisible: false, toggleable: true  },
  { id: 'footer',             label: 'Footer (timestamp, page #)',   defaultVisible: true,  toggleable: false },
];

export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
};

export function getSectionsForDocumentType(value) {
  return SECTIONS_BY_DOCUMENT_TYPE[value] || [];
}
```

`toggleable: false` means the section is load-bearing for this document — the future Document Designer must surface it as "always on, no toggle". `move_block` is the routing itself; without it the Delivery Order isn't a Delivery Order.

`defaultVisible: false` means the section ships disabled by default; tenants opt in via FU-035. `signature_block` and `barcode` are examples — useful for some workflows but visual clutter for others.

## 5. Section-based composition

The template is **decomposed** into named section components. Each section is a small focused file in `components/pdf/sections/`, takes only the data it renders, and **conditionally renders nothing if its data is empty** (so even before FU-035 toggles ship, sections like `HazmatDetails` only appear when the load actually has hazmat data).

### File structure

```
components/pdf/
├── DeliveryOrderTemplate.js                (composer — ~60 LoC)
├── sections/
│   ├── LoadMetadata.js                     (load #, customer ref, container, chassis)
│   ├── BillTo.js                           (bill-to customer name + address)
│   ├── CustomerContact.js                  (phone, email)
│   ├── EquipmentDetails.js                 (container size/type, chassis size/type, weight, seal #)
│   ├── HazmatDetails.js                    (UN code, hazmat class, emergency phone)
│   ├── Instructions.js                     (driver notes, special instructions)
│   ├── AppointmentDetails.js               (appt #s, gate codes, terminal/warehouse contact)
│   ├── MoveBlock.js                        (one move + its events; loops over events internally)
│   ├── SignatureBlock.js                   (customer + driver signature lines)
│   ├── BarcodeBlock.js                     (load # as scannable code — placeholder; renders as monospace text in v1)
│   └── DocumentFooter.js                   (tenant contact, generated-at, page X of Y)
└── shared/
    ├── Header.js                            (existing — reuse)
    └── typography.js                        (existing — reuse)
```

### Composer signature

```jsx
<DeliveryOrderTemplate
  docs={[/* one entry per load */]}
  variant="delivery_order_full"
  sectionConfig={undefined}  // v1: undefined → use defaults from registry
/>
```

`sectionConfig` shape (when provided in FU-035):

```js
{
  visibility: { bill_to: true, hazmat_details: false, signature_block: true, ... },
  order: ['load_metadata', 'bill_to', 'instructions', 'move_block', 'footer', ...],  // optional reorder
  perSection: {
    equipment_details: { show_seal: false },     // future field-level toggles
    instructions: { include_driver_notes: true, include_special_instructions: false },
  },
}
```

For v1: `sectionConfig` is undefined → composer uses `getSectionsForDocumentType(variant)` defaults. **The composer code is identical for v1 and FU-035** — only the source of `sectionConfig` changes.

### Composer behavior

```jsx
function DeliveryOrderTemplate({ docs, variant, sectionConfig }) {
  const registrySections = getSectionsForDocumentType(variant);
  const visibility = computeVisibility(registrySections, sectionConfig);
  const order = sectionConfig?.order || registrySections.map((s) => s.id);

  return (
    <Document>
      {docs.map((doc) => (
        <Page key={doc.order_id} size="LETTER" style={typography.page} wrap>
          <Header tenantName={doc.tenantName} title="DELIVERY ORDER" subtitle={variant === 'delivery_order_next_move' ? 'Next Move' : null} />
          {order.map((sectionId) => {
            if (!visibility[sectionId]) return null;
            return renderSection(sectionId, doc, sectionConfig?.perSection?.[sectionId]);
          })}
        </Page>
      ))}
    </Document>
  );
}
```

`renderSection(sectionId, doc, opts)` is a small dispatch table mapping section IDs to components. Adding a new section = one entry in this table + one new component file.

`<Page wrap>` so a single load's routing can span multiple pages if it's unusually long (e.g., 5+ moves with verbose instructions).

## 6. Cascade resolution contract (forward-looking; built in FU-035)

When FU-035 ships, the resolver determines `sectionConfig` for each load using a **three-step cascade**:

```
For each load being printed:
  customer_id := load.bill_to_customer_id (or load.customer_id as fallback)

  1. Customer-specific template:
     SELECT section_config FROM document_templates
     WHERE tenant_id = X AND customer_id = customer_id AND document_type = variant
     → if found, use it

  2. Tenant default:
     SELECT section_config FROM document_templates
     WHERE tenant_id = X AND customer_id IS NULL AND document_type = variant
     → if found, use it

  3. System default:
     → undefined (composer uses registry defaults)
```

Each load is resolved **independently**, so a bulk print of N loads with M different bill-to customers can produce a single PDF where each load uses its customer's template. React-PDF handles this naturally — each load is its own `<Page>`, and the per-load `sectionConfig` is just a different argument to the composer when constructing that page.

### v1 contract (this session)

- `fetchDeliveryOrderData` returns `bill_to_customer_id` alongside the rest of the data so the future resolver has it ready. **This is the only v1-side hook for the cascade.**
- The bulk renderer's loop body is structured so adding `const sectionConfig = await resolveTemplateConfig(svc, tenantId, doc.bill_to_customer_id, variant)` is a 1-line insert when FU-035 ships.

### FU-035 schema sketch (informational; not built now)

```sql
CREATE TABLE document_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE, -- null = tenant-wide default
  document_type TEXT NOT NULL,
  section_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_doc_templates_tenant_default
  ON document_templates(tenant_id, document_type)
  WHERE customer_id IS NULL;

CREATE UNIQUE INDEX idx_doc_templates_per_customer
  ON document_templates(tenant_id, customer_id, document_type)
  WHERE customer_id IS NOT NULL;
```

Partial indexes are required because Postgres doesn't treat NULL as equal in plain UNIQUE constraints. The two indexes together enforce: one tenant default per `(tenant, doc_type)`, and one customer-specific override per `(tenant, customer, doc_type)`.

## 7. NEXT_MOVE selection logic

```js
// lib/pdf/select-moves.js
export function selectMoves(moves, variant) {
  const sorted = [...moves].sort((a, b) => a.move_index - b.move_index);
  if (variant === 'delivery_order_full') return sorted;
  // delivery_order_next_move
  const next = sorted.find(
    (m) => m.status !== 'completed' && m.status !== 'cancelled'
  );
  return next ? [next] : null;
}
```

**Move statuses** (per migration 090): `unassigned | pending | dispatched | in_progress | completed | cancelled`.

"Eligible next move" excludes both `completed` and `cancelled`. For a brand-new load (all moves `unassigned` or `pending`), this returns move 1. For a mid-flight load, it returns the first non-finished move. For a fully-completed load, it returns `null`.

When `null`, the bulk renderer **skips the load** and adds its id to the `skipped` array. The endpoint surfaces this via headers + an optional toast.

## 8. Data fetch shape

`fetchDeliveryOrderData(svc, orderId, tenantId, variant)` returns either `null` (NEXT_MOVE with no eligible move) or:

```js
{
  order_id: 'uuid',
  tenant_name: 'Acme Drayage',
  load_metadata: {
    load_number: 'ORD-001234',
    customer_reference: 'PO-9988',
    container_number: 'TCKU1234567',
    chassis_number: 'ABCZ123456',
  },
  bill_to_customer_id: 'uuid',  // for FU-035 resolver
  bill_to: {
    name: 'Acme Logistics',
    address_line1: '123 Main St',
    city: 'Long Beach',
    state: 'CA',
    zip: '90802',
  },
  customer_contact: {
    phone: '(555) 555-1234',
    email: 'ops@acme.com',
  },
  equipment_details: {
    container_size: '40HC',
    container_type: 'Standard',
    chassis_size: '40',
    chassis_type: 'Tri-axle',
    seal_number: 'SEAL12345',
    weight_lbs: 38000,
  },
  hazmat_details: null,  // or { un_code, hazmat_class, emergency_phone, ... }
  instructions: {
    driver_notes: 'Call 30 min out',
    special_instructions: 'Lumper required',
  },
  appointment_details: {
    pickup_appt_number: 'APPT-123',
    delivery_appt_number: 'APPT-456',
    gate_codes: { pickup: 'A1234', delivery: 'B5678' },
  },
  moves: [
    {
      move_index: 1,
      move_type: 'pickup_delivery',
      status: 'in_progress',
      driver: { id, first_name, last_name, phone },  // or null
      events: [
        {
          sequence: 1,
          event_type: 'pick_container',
          location: { name: 'Long Beach Terminal', city: 'Long Beach', state: 'CA' },
          scheduled_at: '2026-04-28T09:00:00Z',
          arrived_at: '2026-04-28T09:15:00Z',
          departed_at: '2026-04-28T09:45:00Z',
          status: 'departed',
        },
        // ...
      ],
    },
    // ...
  ],
}
```

Sections grab the slice they need:
- `<LoadMetadata data={doc.load_metadata} />`
- `<BillTo data={doc.bill_to} />`
- `<HazmatDetails data={doc.hazmat_details} />` (renders `null` if `data` is `null`)
- etc.

The fetch always returns the full shape (even fields the v1 default config hides) so FU-035 can flip a section on without re-fetching.

`selectMoves` is applied **before** populating the `moves` field, so the data shape always reflects the variant's filtered moves.

## 9. Bulk renderer

```js
// lib/pdf/render-bulk-delivery-orders.js
export async function renderBulkDeliveryOrdersPdf(svc, orderIds, tenantId, variant) {
  const docs = [];
  const skipped = [];
  for (const id of orderIds) {
    const data = await fetchDeliveryOrderData(svc, id, tenantId, variant);
    if (data === null) {
      skipped.push(id);
      continue;
    }
    docs.push(data);
  }
  if (docs.length === 0) return { buffer: null, skipped };

  // FU-035 hook (not built now): per-load sectionConfig resolution
  // const perDocConfigs = await Promise.all(docs.map(d =>
  //   resolveTemplateConfig(svc, tenantId, d.bill_to_customer_id, variant)
  // ));
  // For v1: sectionConfig is undefined for all docs (composer uses registry defaults).

  const buffer = await renderToBuffer(
    <DeliveryOrderTemplate docs={docs} variant={variant} sectionConfig={undefined} />
  );
  return { buffer, skipped };
}
```

## 10. Endpoint

`pages/api/tenant/loads/bulk-print.js`:

- `POST { ids: string[], variant: string }` — body
- Permission check: `DISPATCHING | ORDER_ENTRY | ALL`
- Validation: `ids` is non-empty array; `variant` passes `isValidDocumentType`
- Calls `renderBulkDeliveryOrdersPdf`
- If `buffer === null` (everything skipped) → `422` with `{ error: 'No printable loads', skipped }`
- If `buffer` exists:
  - `Content-Type: application/pdf`
  - `Content-Disposition: inline; filename="delivery-orders-<variant>-<timestamp>.pdf"`
  - `X-Skipped-Count: N` (always set; `0` if none skipped)
  - `X-Skipped-Load-Ids: comma,joined,uuids` (only if any skipped — small enough for a header)
  - body = PDF buffer

Inline disposition opens in a new browser tab; user can hit Cmd+P / Ctrl+P or Save As.

## 11. Bulk-bar UI

The Print menu item in `BulkActionBar.js` line 172 changes from:

```js
{ key: 'print', label: 'Print', icon: Printer, onClick: () => handleStub('Print') }
```

to:

```js
{ key: 'print', label: 'Print', icon: Printer, hasPopover: true }
```

A new `PrintForm` component (~40 LoC) inside `BulkActionBar.js` is rendered when the popover opens. It shows:

```
┌────────────────────────────────────────────────┐
│  Print which?                                  │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  Full Delivery Order                     │  │
│  │  Entire routing across all moves         │  │
│  └──────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────┐  │
│  │  Next Move Only                          │  │
│  │  Just the upcoming non-completed move    │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

Each button:
1. Calls `POST /api/tenant/loads/bulk-print` with `{ ids: selectedIds, variant }`
2. Awaits the response. If non-2xx, shows a red toast with the error.
3. On 2xx, reads `X-Skipped-Count`. If `> 0`, shows a yellow toast "Printed X of Y loads (M skipped — no remaining moves)".
4. Reads body as Blob. Calls `URL.createObjectURL(blob)` and `window.open(url, '_blank')` to open in a new tab. Revokes the object URL after a short delay.
5. Closes the popover.

## 12. Error handling

| Case | Behavior |
|---|---|
| Bulk-bar opened with 0 loads | Print button disabled (existing pattern in BulkActionBar). |
| Bulk-bar opened with N loads, click Print, no variant chosen | Popover stays open with the two buttons; nothing fires. |
| Variant invalid (request bypasses UI) | API returns 400. |
| All loads skipped (NEXT_MOVE with all completed) | API returns 422. Frontend shows red toast: "All N loads have no remaining moves." |
| Some loads skipped | API returns 200 + `X-Skipped-Count: M`. Frontend shows yellow toast. |
| Single load's render fails | Caught in `fetchDeliveryOrderData`; logged server-side; load is skipped (added to `skipped`). Other loads still render. |
| All renders fail | API returns 500 with the first error message. |
| Network / fetch error on frontend | Red toast: "Print failed: \<error\>". |
| Permission denied | API returns 403; toast "Permission denied". |

## 13. Testing

**Unit tests (`tests/*.test.mjs` using Node's built-in test runner):**

- `tests/document-types-constants.test.mjs` — mirrors `tests/load-types-constants.test.mjs`. Confirms `DOCUMENT_TYPES` shape, `isValidDocumentType` true/false cases, `getDocumentType` lookup.
- `tests/document-sections-constants.test.mjs` — confirms `DELIVERY_ORDER_SECTIONS` shape (every entry has `id`, `label`, `defaultVisible`, `toggleable`), confirms `getSectionsForDocumentType` returns the correct list for each variant, returns `[]` for unknown types.
- `tests/select-moves.test.mjs` —
  - `delivery_order_full` returns all moves sorted by `move_index`
  - `delivery_order_next_move` returns the first move whose status is not `completed`/`cancelled`
  - `delivery_order_next_move` skips `cancelled` moves correctly
  - `delivery_order_next_move` returns `null` when all moves are `completed`
  - `delivery_order_next_move` returns `null` when all moves are `cancelled`
  - moves passed in random order are sorted before selection

**Integration / live verification:**

Browser preview is auth-gated (per tonight's pattern), so verification combines:

- A subagent that confirms the file structure, registry shapes, import wiring, and section registry usage statically.
- A subagent that exercises the `selectMoves` helper against a few seed orders fetched via service-role client (since `selectMoves` is pure JS, it imports cleanly).
- **Manual browser test** by the user once shipped: open dispatcher, select 1-3 loads, open Print popover, click "Full Delivery Order" and confirm a PDF opens in a new tab. Then click "Next Move Only" and confirm the PDF only contains the upcoming move per load.

Note: a standalone Node verify script that calls `renderBulkDeliveryOrdersPdf` directly is *not* feasible because the renderer imports JSX (`<DeliveryOrderTemplate ... />`) which requires Next.js's build step. Live verification of the actual PDF render therefore goes through either (a) the API endpoint via authenticated fetch, or (b) the user's manual click-through. We rely on (b) for the v1 ship and may add a Playwright-style E2E later if regressions appear.

## 14. File list + LoC estimate

| File | Action | Approx LoC |
|---|---|---|
| `lib/constants/document-types.js` | new | 40 |
| `lib/constants/document-sections.js` | new | 60 |
| `lib/pdf/select-moves.js` | new | 20 |
| `lib/pdf/render-delivery-order.js` | new | 130 |
| `lib/pdf/render-bulk-delivery-orders.js` | new | 35 |
| `components/pdf/DeliveryOrderTemplate.js` | new (composer) | 70 |
| `components/pdf/sections/LoadMetadata.js` | new | 30 |
| `components/pdf/sections/BillTo.js` | new | 25 |
| `components/pdf/sections/CustomerContact.js` | new | 20 |
| `components/pdf/sections/EquipmentDetails.js` | new | 35 |
| `components/pdf/sections/HazmatDetails.js` | new | 25 |
| `components/pdf/sections/Instructions.js` | new | 25 |
| `components/pdf/sections/AppointmentDetails.js` | new | 30 |
| `components/pdf/sections/MoveBlock.js` | new | 60 |
| `components/pdf/sections/SignatureBlock.js` | new | 25 |
| `components/pdf/sections/BarcodeBlock.js` | new | 20 |
| `components/pdf/sections/DocumentFooter.js` | new | 25 |
| `pages/api/tenant/loads/bulk-print.js` | new | 60 |
| `components/dispatcher/BulkActionBar.js` | modify | +50 |
| `tests/document-types-constants.test.mjs` | new | 35 |
| `tests/document-sections-constants.test.mjs` | new | 30 |
| `tests/select-moves.test.mjs` | new | 50 |

**Total:** ~900 LoC across 22 files. Realistic 3-3.5 hour build including verification.

## 15. Risk and rollback

**Risk:** moderate. New endpoint + new templates + new section components. PDF rendering itself is well-trodden (rate-con and invoice already use the same React-PDF stack with the same `renderToBuffer` pattern). Main risks:

1. **Layout overflow on long routings** — mitigated by `<Page wrap>` so long content spans pages.
2. **Per-section data shape drift** — if a section component reads a field that the fetch doesn't return, the section renders empty (intentional, per "render-if-data-present" pattern). Tests verify the data shape contract.
3. **Bulk size** — N loads = N pages. Performance scales linearly; for typical bulk-print scenarios (≤30 loads) the render is sub-second.

**Rollback:** revert the commit. Bulk-bar Print returns to "coming soon" toast. No schema changes, no migration. Templates, registries, endpoint all untouched by other code.

## 16. Forward path summary (FU-035 readiness)

When FU-035 lands, what changes:

1. New migration: `document_templates` table + the two partial unique indexes
2. New `lib/pdf/resolve-template-config.js` exporting `resolveTemplateConfig(svc, tenantId, customerId, documentType)`
3. `render-bulk-delivery-orders.js` adds 2-3 lines to call the resolver per-doc and pass the resulting `sectionConfig` to the template
4. New Settings UI under `pages/settings/document-designer/` that reads `document-types.js` + `document-sections.js` registries to render its palette of available toggles + sections, and writes to `document_templates`

What does **NOT** change in FU-035:

- The data fetch shape (`fetchDeliveryOrderData`) — already returns the full data; FU-035 just hides sections, never asks for new data.
- The composer (`DeliveryOrderTemplate`) — already accepts `sectionConfig`; FU-035 just passes a non-undefined value.
- Section components — each renders its own slice; toggling visibility happens in the composer's `if (!visibility[sectionId]) return null;` guard.
- Document-type registry, section registry — open for extension by appending entries.
- Endpoint contract — unchanged; resolver is internal to the renderer.
- Bulk-bar UI — unchanged; the variant picker continues to do its job.

This is the test of whether the architecture is right: when FU-035 ships, every existing v1 file should be touched in a small additive way, not restructured.
