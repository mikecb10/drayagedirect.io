# FU-035-D: Document Designer — Hierarchical Section Schema + Nested-Toggle UI

**Status:** Design approved 2026-04-26 (brainstorm).
**Tracks:** FU-035-D. Builds on FU-035-A (foundation, commit `1ba77ef`) + FU-035-B (basic editor UI, commit `e08e680`).
**Discovered during:** PortPro DO screenshot review at end of 2026-04-26 session, after the user surfaced PortPro's per-doc-type Document Designer as the target UX.
**Splits with:** FU-035-D2 (separate session) — PDF *render* layout rewrite. D ships the registry, editor UI, and migration. D2 ships the new PDF layout. Both together = full PortPro DO parity.

## 1. Goal

Refactor the Document Designer's Delivery Order section registry from the flat 12-section list FU-035-B shipped to a PortPro-style parent-child hierarchy: 11 parent sections, each with optional child fields, totaling 56 toggles (11 master + 45 children).

Refactor `TemplateEditor.js` to render parent + collapsible 2-col child grids. Backfill existing tenant default + customer override rows to the new shape via SQL migration.

After this ships:
- The Document Designer editor visually matches PortPro's DO design (parent sections with collapsible children).
- Existing flat `visibility` configs are translated to the new shape via migration 109.
- The PDF render is **unchanged in this FU** — toggles map to existing render points; many new toggles are "soft" (no visible PDF effect until D2 lands the layout rewrite). This is deliberate — D and D2 split was the call to keep each session under 5 hours.

## 2. Scope

### In scope (this session)

- Refactor `lib/constants/document-sections.js` to support hierarchical sections with optional `fields` arrays.
- Replace the 12-section flat registry with the 11-section PortPro-mirror tree in §4.
- Promote `<Header>` from `components/pdf/shared/Header.js` to a registered section at `components/pdf/sections/Header.js`.
- Add new section components: `DeliveryOrderDetails.js`, `AddressDetails.js`, `OrderDetails.js`, `Notes.js` — each renders the same data the old components rendered, but gated by `opts.fields`.
- Add stub section components: `CommodityDetails.js`, `Signature.js`, `Disclaimer.js` — return null in D, real in D2/G.
- Refactor `components/settings/document-designer/TemplateEditor.js` for parent + collapsible children with 2-col field grid.
- Update `DeliveryOrderTemplate.js` `renderSection` switch to map new IDs to new components.
- Migration `109_document_template_visibility_backfill.sql`: translate old visibility keys to new shape.
- Update `computeVisibility` in `document-sections.js` to return `{ visibility, fields }` shape.

### Out of scope (deferred)

- **PDF render layout** (D2): top-of-page address blocks, Order Details 3-col label-value grid, signature block layout, Move Events repositioning, multi-move semantics.
- **Live preview pane** (E).
- **Configuration tab + Customer/DocType dropdowns + accent/text colors** (F).
- **Watermark + Disclaimer rich-text content** (G).
- **Per-doc-type label remap** (e.g., DO's "CUSTOMER" vs Invoice's "Bill To") — for D, just use new section labels statically; H1 may revisit.
- **Indeterminate parent toggle state**.
- **Drag-reorder of sections**.
- **Removal of old section components** (`BillTo.js`, `EquipmentDetails.js`, etc.) — kept on disk through D; D2 removes after the new components fully cover the rendering needs.

## 3. Schema shape

`document-sections.js` registry entries gain optional `fields`:

```js
{
  id: 'order_details',
  label: 'Order Details',
  defaultVisible: true,
  toggleable: true,
  fields: [
    { id: 'reference_number', label: 'Reference #', defaultVisible: true },
    { id: 'mbol',             label: 'MBOL #',      defaultVisible: true },
    // ...
  ],
}
```

Storage in `document_templates.section_config`:

```jsonc
{
  "visibility": {
    "header": true,
    "address_details": true,
    "order_details": false  // master OFF — all children hidden, regardless of fields map
  },
  "perSection": {
    "header":        { "fields": { "logo": true,             "phone": false } },
    "order_details": { "fields": { "container_number": true, "seal":  false } }
  }
}
```

**Default-true semantics** (matches FU-035-A behavior, extended to fields):
- If `visibility[section_id]` is undefined → use `defaultVisible` from registry.
- If `perSection[section_id].fields[field_id]` is undefined → resolves to that field's registry `defaultVisible`. Most field defaults are `true`, but a few are `false` (e.g., `header.website`, `notes.billing_notes`, `address_details.display_pickup_for_operational_street_turns`) — those stay hidden until explicitly enabled.

Default-true on fields means new fields added to the registry later are visible by default for existing rows — the right behavior for additive changes.

`computeVisibility(sections, sectionConfig)` is updated to return:

```js
{
  visibility: { [sectionId]: boolean, ... },  // master toggle resolved
  fields:     { [sectionId]: { [fieldId]: boolean, ... }, ... }  // per-field resolved
}
```

Section components receive `opts = sectionConfig.perSection?.[sectionId]` plus computed `opts.fields` injected by the composer.

## 4. The DO section tree

| ID | Label | Toggleable | `defaultVisible` | Children (`fields`) |
|---|---|---|---|---|
| `header` | Header | yes | true | logo, address, phone, website, company_name |
| `delivery_order_details` | Delivery Order Details | yes | true | delivery_order_number, pickup_number, driver_name, delivery_appointment, reference_number |
| `address_details` | Address Details | yes | true | customer, pickup_location, delivery_location, return_location, appointment_times, display_pickup_for_operational_street_turns |
| `move_events` | Move Events | yes | true | (none — master only) |
| `order_details` | Order Details | yes | true | reference_number, booking_bl, mbol, hbol, container_number, container_size, container_type, chassis_number, chassis_size, chassis_type, chassis_owner, steamship_line, seal, hazmat, pickup_number, pull_container_date, return_container_date, last_free_day, per_diem_free_day |
| `commodity_details` | Commodity Details | yes | false | commodity, description, weight, pallets, pieces |
| `notes` | Notes | yes | true | driver_notes, yard_notes, customer_notes, billing_notes, load_notes |
| `signature` | Signature Block | yes | false | (none in D — populated in D2) |
| `disclaimer` | Disclaimer | yes | false | (none — content area in G) |
| `barcode` | Load # Barcode | yes | false | (none) |
| `footer` | Footer | no (always-on) | true | (none) |

**Field totals:** 5 + 5 + 6 + 0 + 19 + 5 + 5 + 0 + 0 + 0 + 0 = **45 child fields** + 11 master toggles = **56 toggles**.

**Per Q2 (data sources):** Order Details registers only the 19 fields we have data for today. The remaining ~19 PortPro fields (Vessel Name, Voyage Name, Genset #, Discharged/Ingate/Outgate Dates, Gray Pool, Reservation #, Trailer #, Total Distance, Temperature, etc.) require port-API integrations (FU-001 / FU-002 from `project_api_integrations.md`); they're added when the data lands.

Both `delivery_order_full` and `delivery_order_next_move` use the same `DELIVERY_ORDER_SECTIONS` constant — no per-variant divergence in this FU.

## 5. Migration strategy

`migrations/109_document_template_visibility_backfill.sql`:

```sql
BEGIN;

UPDATE document_templates
SET section_config = jsonb_build_object(
  'visibility', jsonb_build_object(
    'header',                  true,
    'delivery_order_details',  true,
    'address_details',         COALESCE((section_config->'visibility'->>'bill_to')::boolean,            true),
    'move_events',             COALESCE((section_config->'visibility'->>'move_block')::boolean,         true),
    'order_details',           CASE
                                  WHEN COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true) = false
                                   AND COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true) = false
                                   AND COALESCE((section_config->'visibility'->>'hazmat_details')::boolean,      true) = false
                                  THEN false ELSE true
                                END,
    'commodity_details',       false,
    'notes',                   COALESCE((section_config->'visibility'->>'instructions')::boolean,       true),
    'signature',               COALESCE((section_config->'visibility'->>'signature_block')::boolean,    false),
    'disclaimer',              false,
    'barcode',                 COALESCE((section_config->'visibility'->>'barcode')::boolean,            false),
    'footer',                  true
  ),
  'perSection', jsonb_build_object(
    -- Rename old perSection.move_block → new perSection.move_events (preserves any per-section opts like show_driver).
    'move_events', COALESCE(
      section_config->'perSection'->'move_events',
      section_config->'perSection'->'move_block',
      '{}'::jsonb
    ),
    'address_details', jsonb_build_object('fields', jsonb_build_object(
      'customer', COALESCE((section_config->'visibility'->>'bill_to')::boolean, true)
    )),
    'order_details', jsonb_build_object('fields', jsonb_build_object(
      'container_number',     COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'container_size',       COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'container_type',       COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_number',       COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_size',         COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_type',         COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'chassis_owner',        COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'seal',                 COALESCE((section_config->'visibility'->>'equipment_details')::boolean,   true),
      'hazmat',               COALESCE((section_config->'visibility'->>'hazmat_details')::boolean,      true),
      'pickup_appointment',   COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true),
      'delivery_appointment', COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true),
      'last_free_day',        COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true),
      'per_diem_free_day',    COALESCE((section_config->'visibility'->>'appointment_details')::boolean, true)
    )),
    'notes', jsonb_build_object('fields', jsonb_build_object(
      'driver_notes',   COALESCE((section_config->'visibility'->>'instructions')::boolean, true),
      'yard_notes',     COALESCE((section_config->'visibility'->>'instructions')::boolean, true),
      'customer_notes', COALESCE((section_config->'visibility'->>'instructions')::boolean, true)
    ))
  )
)
WHERE section_config IS NOT NULL
  AND section_config != '{}'::jsonb
  AND NOT (section_config ? 'perSection' AND section_config->'perSection' ? 'order_details');

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**Idempotent guard:** the WHERE clause excludes rows that already have `perSection.order_details` (the marker that translation already happened), so re-running the migration is a no-op.

**Rows skipped:** any row with `section_config IS NULL` or `'{}'` is left alone — those are "use registry defaults" rows, and the registry defaults are now the new tree.

**Dropped intent (acceptable per Q decision):**
- `customer_contact: false` → not preserved (subsumed into `address_details > customer`).
- `driver_per_move: false` → not preserved (subsumed into `delivery_order_details > driver_name`).

These drops are acceptable because: (a) FU-035-B shipped this same day so very few rows exist (~3 max), (b) the toggles are absorbed into more granular controls in the new tree.

## 6. Editor UI behavior

`components/settings/document-designer/TemplateEditor.js` refactors:

State shape (formerly `{ visibility }`):
```js
{
  visibility: { [sectionId]: boolean },
  fields:     { [sectionId]: { [fieldId]: boolean } },
}
```

UI structure per section:

```
┌─ Section Card ────────────────────────────────────┐
│ [Master Toggle]  Section Label       [▼ collapse] │  ← always-on sections show "Always on" badge instead of toggle
├───────────────────────────────────────────────────┤
│ When expanded AND section has children:           │
│   ┌──────────────┬──────────────┐                 │
│   │ [Toggle] Field A │ [Toggle] Field B │         │
│   │ [Toggle] Field C │ [Toggle] Field D │         │
│   └──────────────┴──────────────┘                 │
│ When master is OFF: child toggles disabled + grey │
└───────────────────────────────────────────────────┘
```

**Behavior:**
- Default: all sections expanded on first render.
- Local-only collapse state — resets on page reload, no persistence.
- Strict on/off at master — toggling master OFF disables children but does NOT flip child boolean state (preserves user intent if they toggle master back on).
- Child toggle clicks update `fields[sectionId][fieldId]`.
- Save serializes `{ visibility, perSection: <fields wrapped> }` and PUT/POSTs to existing `/api/tenant/document-templates` endpoints.
- Reset reverts to last-saved state.
- Delete only on customer overrides (unchanged from FU-035-B).

**Card header layout:**
- Toggle (left, hidden if `!toggleable`)
- Label (center-left)
- "Always on" badge (right, only if `!toggleable`)
- Collapse arrow (rightmost, only if section has children)

## 7. Section component refactor

New components in `components/pdf/sections/`:

| File | Purpose | Reads from `opts.fields` |
|---|---|---|
| `Header.js` | Tenant header (moved from `shared/`) | logo, address, phone, website, company_name |
| `DeliveryOrderDetails.js` | Top-of-doc reference info | delivery_order_number, pickup_number, driver_name, delivery_appointment, reference_number |
| `AddressDetails.js` | Customer + pickup/delivery/return locations | customer, pickup_location, delivery_location, return_location, appointment_times |
| `OrderDetails.js` | Equipment + container + appointment fields | (19 fields per §4) |
| `Notes.js` | Driver/yard/customer/billing/load notes | driver_notes, yard_notes, customer_notes, billing_notes, load_notes |

Stub components (return null in D, real in D2/G):
- `CommodityDetails.js`
- `Signature.js`
- `Disclaimer.js`

**Behavior of each new component:**
- Reads `opts.fields?.[fieldId]` defaulting to `true` if undefined.
- Renders only fields where the resolved toggle is true.
- If `opts.fields` is undefined entirely (e.g., legacy code path), all fields render (back-compat).

**Composer (`DeliveryOrderTemplate.js`) `renderSection` switch updates:**
```js
case 'header':                  return <Header data={...} opts={opts} />;
case 'delivery_order_details':  return <DeliveryOrderDetails data={...} opts={opts} />;
case 'address_details':         return <AddressDetails data={...} opts={opts} />;
case 'order_details':           return <OrderDetails data={...} opts={opts} />;
case 'move_events':             return <MoveBlock data={...} opts={opts} ... />;  // existing component, renamed in switch only
case 'commodity_details':       return null; // D2
case 'notes':                   return <Notes data={...} opts={opts} />;
case 'signature':               return null; // D2
case 'disclaimer':              return null; // G
case 'barcode':                 return <BarcodeBlock data={...} />;
case 'footer':                  return <DocumentFooter data={...} />;
```

The composer also updates the `<Header>` import: `./shared/Header` → `./sections/Header`. The shared header is removed if grep shows nothing else imports it.

**Existing components kept on disk (still imported nowhere new, no changes):** `BillTo.js`, `CustomerContact.js`, `EquipmentDetails.js`, `HazmatDetails.js`, `Instructions.js`, `AppointmentDetails.js`, `LoadMetadata.js`. D2 deletes them after the new components fully cover their rendering needs.

## 8. Permissions

Unchanged from FU-035-B: `[PERMISSIONS.SETTINGS, PERMISSIONS.ALL]`.

## 9. Error handling

| Case | Behavior |
|---|---|
| Migration fails on a row | `BEGIN/COMMIT` wrapper rolls back all changes; manual diagnosis required. |
| GET fetch with a row in old shape after migration | Should not happen (migration is mandatory before deploying the new code). If it does, `computeVisibility` reads only new shape; old keys are silently dropped to defaults. |
| Editor saves new shape but resolver expects old | Resolver reads JSONB as-is; `computeVisibility` returns the right object regardless of shape. No version mismatch path needed. |
| Field exists in registry but Load has no data | Section component renders `—` or skips the row (component-level decision, not registry-level). |
| User toggles all fields off in a section | Master stays on (strict on/off rule); section header still renders but with no rows. The section component's `data.length === 0` branch should suppress the header, but D doesn't change that — D2 fixes if it's an issue. |

## 10. Testing

**Unit tests** (`tests/document-sections.test.mjs`, create or extend):
- `computeVisibility` returns correct `{ visibility, fields }` for: empty config, partial config, all-disabled config.
- Default-true behavior for unspecified field keys.
- Master-off behavior: even if `fields.x = true`, parent off means section not rendered (composer's responsibility, but unit-testable via the resolved shape).

**Migration verification** (manual via Supabase SQL Editor):
- Snapshot rows pre-migration via `SELECT id, customer_id, section_config FROM document_templates;`.
- Run migration.
- Verify three sample shapes:
  1. All-defaults row (was `'{}'` or null `section_config`) — unchanged.
  2. Row with `visibility: { bill_to: false }` — becomes `visibility.address_details: false`, `perSection.address_details.fields.customer: false`.
  3. Row with `visibility: { equipment_details: false, appointment_details: true }` — becomes `visibility.order_details: true`, `perSection.order_details.fields.{container_*, chassis_*, seal, hazmat}: false`, `perSection.order_details.fields.{pickup_appointment, delivery_appointment, ...}: true`.

**Integration / live verification:**
- Static check via subagent that new pages route correctly, new sections render in editor, old behaviors preserved.
- Manual browser test by user: navigate to `/settings/document-designer/delivery_order_full`, toggle a child field off, save, reload, verify state preserved. Print a Delivery Order PDF; verify nothing breaks (toggles are mostly soft in D — if a section's data looks the same as before, that's success).

## 11. File list + LoC estimate

| File | Action | Approx LoC |
|---|---|---|
| `lib/constants/document-sections.js` | Refactor — new tree, new `computeVisibility` | +150 |
| `components/pdf/sections/Header.js` | New (move from shared/, gate fields) | 80 |
| `components/pdf/sections/DeliveryOrderDetails.js` | New | 70 |
| `components/pdf/sections/AddressDetails.js` | New | 120 |
| `components/pdf/sections/OrderDetails.js` | New | 150 |
| `components/pdf/sections/Notes.js` | New | 50 |
| `components/pdf/sections/CommodityDetails.js` | Stub | 20 |
| `components/pdf/sections/Signature.js` | Stub | 20 |
| `components/pdf/sections/Disclaimer.js` | Stub | 20 |
| `components/pdf/DeliveryOrderTemplate.js` | Modified — switch case rewrite + Header import | ~40 changed |
| `components/pdf/shared/Header.js` | Delete (after grep confirms no other imports) | -80 |
| `components/settings/document-designer/TemplateEditor.js` | Refactor — nested state + collapsible card UI | +200 |
| `migrations/109_document_template_visibility_backfill.sql` | New | 80 |
| `tests/document-sections.test.mjs` | New / extend | 100 |

**Total:** ~13 files, ~1100 LoC. ~4-5 hr realistic.

## 12. Risk and rollback

**Risks:**
1. **Migration mistranslates a row** → tenant's saved template loses intent. Mitigation: idempotent migration with explicit COALESCE defaults; manual verification via SQL Editor on three sample shapes before merge.
2. **New section component drops a field by accident** → field disappears from PDF. Mitigation: each new component is a thin port of the old component's render code, just gated by `opts.fields` checks. Side-by-side diff during PR review catches drops.
3. **UI complexity gates user adoption** (too many toggles) — Mitigation: collapsible sections + 2-col grids match PortPro density; users can collapse sections they don't care about.
4. **Composer + resolver shape mismatch** if `computeVisibility` change isn't fully consumed — Mitigation: the function signature changes from returning `Record<id, boolean>` to `{ visibility, fields }`; this is a breaking change to its callers. Grep for all callers of `computeVisibility` before refactor; only `DeliveryOrderTemplate.js` should be one.

**Rollback:** revert the commit. Migration 109 has no down-migration in this codebase by convention; if rollback is needed AND deployed code expected the new shape, a forward migration 110 (new → old translation) would be required. Practical reality: since FU-035-B shipped today and ~3 rows exist max, rollback is "restore from 24-hour-old backup, redo any tenant edits made today".

## 13. Forward path (FU-035-D2 and beyond)

What changes in **D2** (next session):
- New section components implement PortPro's PDF layout: 3-col address blocks at top of page, "Order Details" 3-col label-value grid, Commodity table, signature block at bottom, Move Events repositioned mid-doc.
- Multi-move handling per Q1 decision: load-level pickup/delivery/return at top + Move Events section below for full multi-move detail.
- Stub components from D become real: `CommodityDetails.js`, `Signature.js`.
- Old section components deleted: `BillTo.js`, `EquipmentDetails.js`, `HazmatDetails.js`, `Instructions.js`, `AppointmentDetails.js`, `LoadMetadata.js`, `CustomerContact.js`.

What changes in **E** (live preview pane): the new tree's parent + children collapsibles are already structured for preview integration — preview pane consumes the same `{ visibility, fields }` shape via component context.

What changes in **F** (Configuration tab + colors): adds a tab split above the section editor; section editor itself unchanged.

What changes in **G** (watermark + Disclaimer rich text): the `disclaimer` stub becomes a TipTap editor; watermark gets a new section.

What changes in **H1-H9** (other doc types): each gets its own per-doc-type registry following the same hierarchical pattern. The schema generalizes for free.

D is the architectural keystone: once it ships, E/F/G/H are additive, no more refactors to the section schema or editor structure.
