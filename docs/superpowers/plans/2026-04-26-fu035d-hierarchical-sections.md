# FU-035-D Hierarchical Section Schema + Nested-Toggle UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the Delivery Order section registry to a PortPro-mirror parent-child hierarchy (11 parent sections, 45 child fields) with a collapsible nested-toggle editor UI. Migrate existing `section_config` rows to the new shape. PDF render layout unchanged in this FU (those changes go in FU-035-D2).

**Architecture:** The section registry gains an optional `fields` array per entry. `computeVisibility` returns `{ visibility, fields }`. Each new section component reads `opts.fields?.[fieldId]` (default-true). Existing `BillTo` / `EquipmentDetails` / etc. stay on disk but are no longer wired through the composer. A SQL migration translates old flat `visibility` keys to the new parent+children shape.

**Tech Stack:** Next.js 14 / React / @react-pdf/renderer / Supabase Postgres / Node test runner / Tailwind. ES modules in `lib/` and `components/`. Migrations under `migrations/`.

**Spec:** [`docs/superpowers/specs/2026-04-26-fu035d-hierarchical-sections-design.md`](../specs/2026-04-26-fu035d-hierarchical-sections-design.md)

---

## Task 1: Refactor `document-sections.js` registry + `computeVisibility`

**Files:**
- Modify: `lib/constants/document-sections.js` (full rewrite of `DELIVERY_ORDER_SECTIONS`, `computeVisibility`)
- Modify: `tests/document-sections-constants.test.mjs` (rewrite for new shape)

- [ ] **Step 1: Rewrite the test file for the new shape**

Replace `tests/document-sections-constants.test.mjs` with:

```js
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DELIVERY_ORDER_SECTIONS,
  SECTIONS_BY_DOCUMENT_TYPE,
  getSectionsForDocumentType,
  computeVisibility,
} from '../lib/constants/document-sections.js';

test('DELIVERY_ORDER_SECTIONS entries have required keys', () => {
  for (const s of DELIVERY_ORDER_SECTIONS) {
    assert.equal(typeof s.id, 'string', `missing id: ${JSON.stringify(s)}`);
    assert.equal(typeof s.label, 'string', `missing label: ${s.id}`);
    assert.equal(typeof s.defaultVisible, 'boolean', `defaultVisible: ${s.id}`);
    assert.equal(typeof s.toggleable, 'boolean', `toggleable: ${s.id}`);
    if (s.fields) {
      assert.ok(Array.isArray(s.fields), `fields must be array: ${s.id}`);
      for (const f of s.fields) {
        assert.equal(typeof f.id, 'string', `field missing id in ${s.id}`);
        assert.equal(typeof f.label, 'string', `field missing label: ${s.id}.${f.id}`);
        assert.equal(typeof f.defaultVisible, 'boolean', `field defaultVisible: ${s.id}.${f.id}`);
      }
    }
  }
});

test('PortPro DO tree sections are present', () => {
  const ids = DELIVERY_ORDER_SECTIONS.map((s) => s.id);
  for (const id of [
    'header',
    'delivery_order_details',
    'address_details',
    'move_events',
    'order_details',
    'commodity_details',
    'notes',
    'signature',
    'disclaimer',
    'barcode',
    'footer',
  ]) {
    assert.ok(ids.includes(id), `missing section: ${id}`);
  }
});

test('footer is always-on (not toggleable)', () => {
  const footer = DELIVERY_ORDER_SECTIONS.find((s) => s.id === 'footer');
  assert.equal(footer.toggleable, false);
});

test('order_details has the 19 expected fields', () => {
  const od = DELIVERY_ORDER_SECTIONS.find((s) => s.id === 'order_details');
  const fieldIds = od.fields.map((f) => f.id);
  for (const id of [
    'reference_number', 'booking_bl', 'mbol', 'hbol',
    'container_number', 'container_size', 'container_type',
    'chassis_number', 'chassis_size', 'chassis_type', 'chassis_owner',
    'steamship_line', 'seal', 'hazmat', 'pickup_number',
    'pull_container_date', 'return_container_date',
    'last_free_day', 'per_diem_free_day',
  ]) {
    assert.ok(fieldIds.includes(id), `missing order_details field: ${id}`);
  }
  assert.equal(fieldIds.length, 19);
});

test('getSectionsForDocumentType returns the registry for both DO variants', () => {
  assert.equal(getSectionsForDocumentType('delivery_order_full'), DELIVERY_ORDER_SECTIONS);
  assert.equal(getSectionsForDocumentType('delivery_order_next_move'), DELIVERY_ORDER_SECTIONS);
});

test('getSectionsForDocumentType returns [] for unknown types', () => {
  assert.deepEqual(getSectionsForDocumentType('not_a_type'), []);
});

test('computeVisibility returns {visibility, fields} with no config', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, undefined);
  assert.ok(result.visibility);
  assert.ok(result.fields);
  assert.equal(result.visibility.header, true);
  assert.equal(result.visibility.commodity_details, false); // defaultVisible: false
  assert.equal(result.visibility.footer, true); // non-toggleable always true
  // Default-true field semantics
  assert.equal(result.fields.order_details.container_number, true);
  assert.equal(result.fields.header.logo, true);
});

test('computeVisibility honors master visibility override', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { address_details: false },
  });
  assert.equal(result.visibility.address_details, false);
  assert.equal(result.visibility.order_details, true); // unaffected
});

test('computeVisibility honors per-field overrides', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    perSection: {
      order_details: { fields: { container_number: false, seal: false } },
    },
  });
  assert.equal(result.fields.order_details.container_number, false);
  assert.equal(result.fields.order_details.seal, false);
  assert.equal(result.fields.order_details.mbol, true); // unspecified = default-true
});

test('computeVisibility default-true for fields not present in config', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    perSection: { header: { fields: { logo: false } } },
  });
  assert.equal(result.fields.header.logo, false);
  assert.equal(result.fields.header.address, true); // unspecified
  assert.equal(result.fields.header.phone, true); // unspecified
});

test('computeVisibility ignores override for non-toggleable sections', () => {
  const result = computeVisibility(DELIVERY_ORDER_SECTIONS, {
    visibility: { footer: false },
  });
  assert.equal(result.visibility.footer, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: FAIL — current registry doesn't have the new section IDs (`header`, `delivery_order_details`, etc.) and `computeVisibility` doesn't return `{visibility, fields}`.

- [ ] **Step 3: Rewrite `lib/constants/document-sections.js`**

Replace the file contents with:

```js
/**
 * Section registries per document type. The Document Designer
 * (FU-035) uses these as the palette of available toggles.
 *
 * Each section may declare optional `fields` (leaf-level toggles).
 * Storage:
 *   - master toggle  → section_config.visibility[sectionId]
 *   - field toggles  → section_config.perSection[sectionId].fields[fieldId]
 *
 * Default-true semantics: any field not present in config defaults to true.
 *
 * Section flags:
 *   defaultVisible: shown by default unless overridden in tenant config
 *   toggleable:     can be turned off in the Document Designer.
 */

export const DELIVERY_ORDER_SECTIONS = [
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
    id: 'delivery_order_details',
    label: 'Delivery Order Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'delivery_order_number', label: 'Delivery Order #',     defaultVisible: true },
      { id: 'pickup_number',         label: 'Pickup #',             defaultVisible: true },
      { id: 'driver_name',           label: 'Driver Name',          defaultVisible: true },
      { id: 'delivery_appointment',  label: 'Delivery Appointment', defaultVisible: true },
      { id: 'reference_number',      label: 'Reference #',          defaultVisible: true },
    ],
  },
  {
    id: 'address_details',
    label: 'Address Details',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'customer',                                  label: 'Customer',           defaultVisible: true },
      { id: 'pickup_location',                           label: 'Pick Up Location',   defaultVisible: true },
      { id: 'delivery_location',                         label: 'Delivery Location',  defaultVisible: true },
      { id: 'return_location',                           label: 'Return Location',    defaultVisible: true },
      { id: 'appointment_times',                         label: 'Appointment Times',  defaultVisible: true },
      { id: 'display_pickup_for_operational_street_turns', label: 'Display Pickup Location for Operational Street Turns', defaultVisible: false },
    ],
  },
  {
    id: 'move_events',
    label: 'Move Events',
    defaultVisible: true,
    toggleable: true,
  },
  {
    id: 'order_details',
    label: 'Order Details',
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
    defaultVisible: false, // soft until D2
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
    id: 'notes',
    label: 'Notes',
    defaultVisible: true,
    toggleable: true,
    fields: [
      { id: 'driver_notes',   label: 'Driver Notes',   defaultVisible: true },
      { id: 'yard_notes',     label: 'Yard Notes',     defaultVisible: true },
      { id: 'customer_notes', label: 'Customer Notes', defaultVisible: true },
      { id: 'billing_notes',  label: 'Billing Notes',  defaultVisible: false },
      { id: 'load_notes',     label: 'Load Notes',     defaultVisible: true },
    ],
  },
  {
    id: 'signature',
    label: 'Signature Block',
    defaultVisible: false, // soft until D2
    toggleable: true,
  },
  {
    id: 'disclaimer',
    label: 'Disclaimer',
    defaultVisible: false, // soft until G
    toggleable: true,
  },
  {
    id: 'barcode',
    label: 'Load # Barcode',
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

export const SECTIONS_BY_DOCUMENT_TYPE = {
  delivery_order_full: DELIVERY_ORDER_SECTIONS,
  delivery_order_next_move: DELIVERY_ORDER_SECTIONS,
};

export function getSectionsForDocumentType(value) {
  return SECTIONS_BY_DOCUMENT_TYPE[value] || [];
}

/**
 * Compute the effective visibility map AND field-visibility map for a document
 * type given an optional sectionConfig override.
 *
 * Returns:
 *   {
 *     visibility: { [sectionId]: boolean, ... },
 *     fields:     { [sectionId]: { [fieldId]: boolean, ... }, ... }
 *   }
 *
 * Default-true semantics: any field not present in `sectionConfig.perSection[id].fields`
 * resolves to its registry `defaultVisible`. Sections without a `fields` array
 * resolve to an empty `{}` in the result's `fields` map.
 */
export function computeVisibility(sections, sectionConfig) {
  const visibility = {};
  const fields = {};
  for (const s of sections) {
    if (!s.toggleable) {
      visibility[s.id] = true;
    } else {
      const override = sectionConfig?.visibility?.[s.id];
      visibility[s.id] = override === undefined ? s.defaultVisible : override;
    }

    if (s.fields) {
      const fieldOverrides = sectionConfig?.perSection?.[s.id]?.fields || {};
      const resolved = {};
      for (const f of s.fields) {
        const v = fieldOverrides[f.id];
        resolved[f.id] = v === undefined ? f.defaultVisible : v;
      }
      fields[s.id] = resolved;
    } else {
      fields[s.id] = {};
    }
  }
  return { visibility, fields };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/document-sections-constants.test.mjs`
Expected: PASS (all 11 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/constants/document-sections.js tests/document-sections-constants.test.mjs
git commit -m "feat(doc-sections): hierarchical section schema with field-level visibility (FU-035-D)"
```

---

## Task 2: Migration 109 — visibility backfill SQL

**Files:**
- Create: `migrations/109_document_template_visibility_backfill.sql`

- [ ] **Step 1: Write the migration SQL**

Create `migrations/109_document_template_visibility_backfill.sql` with this content (copied from spec §5, with rename fix):

```sql
-- 109_document_template_visibility_backfill.sql
-- Translates document_templates.section_config from the FU-035-B flat shape
-- (visibility keyed by old section IDs: bill_to, equipment_details, ...)
-- to the FU-035-D hierarchical shape (parent + perSection.fields children).
--
-- Idempotent: rows already migrated (perSection.order_details present) are skipped.
-- Drops: customer_contact + driver_per_move toggle intent (subsumed into new sections).

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
    -- Rename old perSection.move_block → new perSection.move_events.
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

- [ ] **Step 2: Ask the user to apply the migration via Supabase SQL Editor**

Tell the user verbatim:

> "Migration 109 written to `migrations/109_document_template_visibility_backfill.sql`. Please copy the file contents and run it in the Supabase SQL Editor. Before running, query `SELECT id, customer_id, section_config FROM document_templates;` and screenshot the result so we can verify the backfill against the before-snapshot. After running, query the same SELECT to confirm new shape (`visibility.address_details`, `perSection.order_details.fields.*` should now exist on each previously-customized row). Confirm 'applied' when done."

Do NOT proceed to Task 3 until the user confirms the migration applied. The composer rewrite in Task 9 expects the new data shape.

- [ ] **Step 3: Commit the migration file**

```bash
git add migrations/109_document_template_visibility_backfill.sql
git commit -m "feat(doc-templates): migration 109 backfill section_config to hierarchical shape"
```

---

## Task 3: New `Header` section component (move from `shared/`)

**Files:**
- Create: `components/pdf/sections/Header.js`
- Modify: `components/pdf/DeliveryOrderTemplate.js` (import path change)
- Delete: `components/pdf/shared/Header.js` (after grep confirms no other imports)

- [ ] **Step 1: Verify nothing else imports `shared/Header.js`**

Run: `grep -rn "shared/Header" components/ pages/ lib/`
Expected: only `components/pdf/DeliveryOrderTemplate.js` should match. If anything else does, stop and surface to user — additional refactor needed.

- [ ] **Step 2: Create the new `Header` section component**

Write `components/pdf/sections/Header.js`:

```js
import { View, Text, Image } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Header section. Renders tenant identity (logo + company name + address +
 * phone + website) on the left, document title + subtitle on the right.
 *
 * `opts.fields`: { logo, address, phone, website, company_name }.
 * Default-true for any field not specified.
 *
 * In FU-035-D the data subset for new fields (logo URL, address, phone,
 * website) is mostly null — the toggles exist but render nothing without
 * data. FU-035-D2 / FU-035-F adds the data wiring.
 */
export default function Header({ tenantName, title, subtitle, contactLine, tenantInfo, opts }) {
  const fields = opts?.fields || {};
  const showLogo        = fields.logo        !== false;
  const showAddress     = fields.address     !== false;
  const showPhone       = fields.phone       !== false;
  const showWebsite     = fields.website === true; // defaultVisible: false
  const showCompanyName = fields.company_name !== false;

  const logoUrl = tenantInfo?.logo_url;
  const address = tenantInfo?.address;
  const phone   = tenantInfo?.phone;
  const website = tenantInfo?.website;

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
        {showLogo && logoUrl ? (
          <Image src={logoUrl} style={{ width: 60, height: 60, objectFit: 'contain' }} />
        ) : null}
        <View>
          {showCompanyName ? (
            <Text style={typography.h2}>{tenantName || 'Company'}</Text>
          ) : null}
          {showAddress && address ? (
            <Text style={typography.muted}>{address}</Text>
          ) : null}
          {showPhone && phone ? (
            <Text style={typography.muted}>{phone}</Text>
          ) : null}
          {showWebsite && website ? (
            <Text style={typography.muted}>{website}</Text>
          ) : null}
          {/* Legacy contactLine kept for back-compat with callers that pass it pre-D2. */}
          {contactLine && !address && !phone ? (
            <Text style={typography.muted}>{contactLine}</Text>
          ) : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={typography.h1}>{title}</Text>
        {subtitle ? (
          <Text style={[typography.value, typography.muted, { marginTop: 2 }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Update import in `DeliveryOrderTemplate.js`**

In `components/pdf/DeliveryOrderTemplate.js`, change:

```js
import Header from './shared/Header';
```

to:

```js
import Header from './sections/Header';
```

- [ ] **Step 4: Delete `components/pdf/shared/Header.js`**

```bash
rm components/pdf/shared/Header.js
```

- [ ] **Step 5: Verify `next build` still succeeds for the PDF route**

Run: `npm run build 2>&1 | tail -40`
Expected: build succeeds, no missing-import errors. (If build is too slow, skip — manual verification in Task 11.)

- [ ] **Step 6: Commit**

```bash
git add components/pdf/sections/Header.js components/pdf/DeliveryOrderTemplate.js
git rm components/pdf/shared/Header.js
git commit -m "feat(pdf): promote Header to a registered section with field-level toggles (FU-035-D)"
```

---

## Task 4: New `DeliveryOrderDetails` section component

**Files:**
- Create: `components/pdf/sections/DeliveryOrderDetails.js`

- [ ] **Step 1: Create the component**

Write `components/pdf/sections/DeliveryOrderDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Delivery Order Details section — top-of-doc reference info.
 * Subsumes data the old `LoadMetadata` and `driver_per_move` section IDs
 * rendered, plus pickup #, delivery appointment, reference #.
 *
 * `opts.fields`: { delivery_order_number, pickup_number, driver_name,
 *                  delivery_appointment, reference_number }
 * Default-true for any field not specified.
 *
 * `data` shape:
 *   {
 *     delivery_order_number,
 *     pickup_number,
 *     driver_name,
 *     delivery_appointment,
 *     reference_number
 *   }
 * In FU-035-D, this data is sourced from `doc.load_metadata` (load_number →
 * delivery_order_number, customer_reference → reference_number) plus first
 * move's driver_name. Future doc.delivery_order_details object is wired in D2.
 */
export default function DeliveryOrderDetails({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const rows = [
    fields.delivery_order_number !== false && data.delivery_order_number
      ? ['Delivery Order #', data.delivery_order_number] : null,
    fields.pickup_number !== false && data.pickup_number
      ? ['Pickup #', data.pickup_number] : null,
    fields.driver_name !== false && data.driver_name
      ? ['Driver', data.driver_name] : null,
    fields.delivery_appointment !== false && data.delivery_appointment
      ? ['Delivery Appt', data.delivery_appointment] : null,
    fields.reference_number !== false && data.reference_number
      ? ['Reference #', data.reference_number] : null,
  ].filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <View style={{ marginBottom: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      {rows.map(([label, value]) => (
        <View key={label} style={{ minWidth: 120 }}>
          <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
          <Text style={typography.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/DeliveryOrderDetails.js
git commit -m "feat(pdf): add DeliveryOrderDetails section (FU-035-D)"
```

---

## Task 5: New `AddressDetails` section component

**Files:**
- Create: `components/pdf/sections/AddressDetails.js`

- [ ] **Step 1: Create the component**

Write `components/pdf/sections/AddressDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

function AddressBlock({ label, org }) {
  if (!org || !org.name) return null;
  const cityLine = [org.city, org.state, org.zip].filter(Boolean).join(', ');
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={typography.label}>{label}</Text>
      <Text style={typography.value}>{org.name}</Text>
      {org.address_line1 ? <Text style={typography.value}>{org.address_line1}</Text> : null}
      {cityLine ? <Text style={typography.value}>{cityLine}</Text> : null}
    </View>
  );
}

/**
 * Address Details section — customer (bill-to) + pickup/delivery/return
 * locations + contact + appointment times + operational street turn flag.
 *
 * Subsumes data the old `bill_to` + `customer_contact` section IDs rendered.
 * Pickup/delivery/return locations are FU-035-D2 territory — registered as
 * fields here but data is null in D.
 *
 * `opts.fields`: { customer, pickup_location, delivery_location,
 *                  return_location, appointment_times,
 *                  display_pickup_for_operational_street_turns }
 * Default-true for any field not specified except the street turn flag
 * (which defaults false — display only when explicitly enabled).
 *
 * `data` shape:
 *   {
 *     customer:           { name, address_line1, city, state, zip, phone, email } | null,
 *     pickup_location:    Org | null,   // D2
 *     delivery_location:  Org | null,   // D2
 *     return_location:    Org | null,   // D2
 *     appointment_times:  { pickup, delivery } | null,
 *     is_operational_street_turn: boolean
 *   }
 */
export default function AddressDetails({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const showCustomer  = fields.customer          !== false;
  const showPickup    = fields.pickup_location   !== false;
  const showDelivery  = fields.delivery_location !== false;
  const showReturn    = fields.return_location   !== false;
  const showApptTimes = fields.appointment_times !== false;
  const showStreetTurn = fields.display_pickup_for_operational_street_turns === true;

  const rows = [];
  if (showCustomer && data.customer) {
    rows.push(<AddressBlock key="customer" label="Customer" org={data.customer} />);
  }
  if (showPickup && data.pickup_location) {
    rows.push(<AddressBlock key="pickup" label="Pick Up Location" org={data.pickup_location} />);
  }
  if (showDelivery && data.delivery_location) {
    rows.push(<AddressBlock key="delivery" label="Delivery Location" org={data.delivery_location} />);
  }
  if (showReturn && data.return_location) {
    rows.push(<AddressBlock key="return" label="Return Location" org={data.return_location} />);
  }

  const phone = data.customer?.phone;
  const email = data.customer?.email;
  const apptPickup = data.appointment_times?.pickup;
  const apptDelivery = data.appointment_times?.delivery;

  if (rows.length === 0 && !phone && !email && !showApptTimes) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      {rows}
      {showCustomer && (phone || email) ? (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          {phone ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Phone</Text>
              <Text style={typography.value}>{phone}</Text>
            </View>
          ) : null}
          {email ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Email</Text>
              <Text style={typography.value}>{email}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {showApptTimes && (apptPickup || apptDelivery) ? (
        <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
          {apptPickup ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Pickup Time</Text>
              <Text style={typography.value}>{apptPickup}</Text>
            </View>
          ) : null}
          {apptDelivery ? (
            <View>
              <Text style={[typography.label, { fontSize: 8 }]}>Delivery Time</Text>
              <Text style={typography.value}>{apptDelivery}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {showStreetTurn && data.is_operational_street_turn ? (
        <Text style={[typography.value, { marginTop: 4, fontStyle: 'italic' }]}>
          Operational Street Turn
        </Text>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/AddressDetails.js
git commit -m "feat(pdf): add AddressDetails section (FU-035-D)"
```

---

## Task 6: New `OrderDetails` section component

**Files:**
- Create: `components/pdf/sections/OrderDetails.js`

- [ ] **Step 1: Create the component**

Write `components/pdf/sections/OrderDetails.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Order Details section — 19 toggleable fields covering equipment, container,
 * appointment, hazmat, and load reference data. Subsumes data the old
 * `equipment_details` + `appointment_details` + `hazmat_details` + parts of
 * `load_metadata` rendered.
 *
 * `opts.fields`: 19 keys per spec §4. Default-true for any not specified.
 *
 * `data` shape (composer-merged from doc.equipment_details + doc.appointment_details
 * + doc.hazmat_details + doc.load_metadata):
 *   {
 *     reference_number, booking_bl, mbol, hbol,
 *     container_number, container_size, container_type,
 *     chassis_number, chassis_size, chassis_type, chassis_owner,
 *     steamship_line, seal, hazmat (boolean | text), pickup_number,
 *     pull_container_date, return_container_date,
 *     last_free_day, per_diem_free_day
 *   }
 */
const FIELD_ORDER = [
  ['reference_number',      'Reference #'],
  ['booking_bl',            'Booking/BL'],
  ['mbol',                  'MBOL #'],
  ['hbol',                  'HBOL #'],
  ['container_number',      'Container #'],
  ['container_size',        'Container Size'],
  ['container_type',        'Container Type'],
  ['chassis_number',        'Chassis #'],
  ['chassis_size',          'Chassis Size'],
  ['chassis_type',          'Chassis Type'],
  ['chassis_owner',         'Chassis Owner'],
  ['steamship_line',        'Steamship Line'],
  ['seal',                  'Seal #'],
  ['hazmat',                'Hazmat'],
  ['pickup_number',         'Pickup #'],
  ['pull_container_date',   'Pull Container Date'],
  ['return_container_date', 'Return Container Date'],
  ['last_free_day',         'Last Free Day'],
  ['per_diem_free_day',     'Per Diem Free Day'],
];

export default function OrderDetails({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const rows = FIELD_ORDER
    .map(([key, label]) => {
      if (fields[key] === false) return null;
      const value = data[key];
      if (value === undefined || value === null || value === '') return null;
      return [label, typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value];
    })
    .filter(Boolean);

  if (rows.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={typography.label}>Order Details</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ minWidth: 100 }}>
            <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
            <Text style={typography.value}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/OrderDetails.js
git commit -m "feat(pdf): add OrderDetails section with 19 toggleable fields (FU-035-D)"
```

---

## Task 7: New `Notes` section component

**Files:**
- Create: `components/pdf/sections/Notes.js`

- [ ] **Step 1: Create the component**

Write `components/pdf/sections/Notes.js`:

```js
import { View, Text } from '@react-pdf/renderer';
import { typography } from '../shared/typography';

/**
 * Notes section — 5 toggleable note types (driver / yard / customer /
 * billing / load). Subsumes data the old `instructions` section ID rendered.
 *
 * `opts.fields`: { driver_notes, yard_notes, customer_notes, billing_notes, load_notes }.
 * Default-true for all except billing_notes (defaultVisible: false in registry).
 *
 * `data` shape:
 *   {
 *     driver_notes:   string | null,
 *     yard_notes:     string | null,
 *     customer_notes: string | null,
 *     billing_notes:  string | null,
 *     load_notes:     string | null   // sourced from doc.instructions.special_instructions
 *   }
 */
const NOTE_ORDER = [
  ['driver_notes',   'Driver Notes'],
  ['yard_notes',     'Yard Notes'],
  ['customer_notes', 'Customer Notes'],
  ['billing_notes',  'Billing Notes'],
  ['load_notes',     'Load Notes'],
];

export default function Notes({ data, opts }) {
  if (!data) return null;
  const fields = opts?.fields || {};
  const visible = NOTE_ORDER
    .map(([key, label]) => {
      // billing_notes default is false; everything else is true.
      const enabled = key === 'billing_notes' ? fields[key] === true : fields[key] !== false;
      if (!enabled) return null;
      const value = data[key];
      if (!value) return null;
      return [label, value];
    })
    .filter(Boolean);

  if (visible.length === 0) return null;

  return (
    <View style={{ marginBottom: 12 }}>
      {visible.map(([label, value]) => (
        <View key={label} style={{ marginBottom: 4 }}>
          <Text style={[typography.label, { fontSize: 8 }]}>{label}</Text>
          <Text style={typography.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/Notes.js
git commit -m "feat(pdf): add Notes section with 5 note-type toggles (FU-035-D)"
```

---

## Task 8: Stub components — `CommodityDetails`, `Signature`, `Disclaimer`

**Files:**
- Create: `components/pdf/sections/CommodityDetails.js`
- Create: `components/pdf/sections/Signature.js`
- Create: `components/pdf/sections/Disclaimer.js`

- [ ] **Step 1: Create three stub components**

Write `components/pdf/sections/CommodityDetails.js`:

```js
/**
 * Commodity Details section — stub in FU-035-D. Real implementation in D2
 * (table with commodity / description / weight / pallets / pieces columns).
 * Toggling this section ON in D has no visible effect.
 */
export default function CommodityDetails() {
  return null;
}
```

Write `components/pdf/sections/Signature.js`:

```js
/**
 * Signature Block section — stub in FU-035-D. Real implementation in D2
 * (Print Name / Receiver Signature / Time In / Time Out / Date / Signature).
 * Toggling this section ON in D has no visible effect.
 *
 * The legacy SignatureBlock.js is still on disk and currently rendered by the
 * 'signature_block' switch case (which is removed in Task 9). After Task 9,
 * this stub takes over and renders nothing until D2.
 */
export default function Signature() {
  return null;
}
```

Write `components/pdf/sections/Disclaimer.js`:

```js
/**
 * Disclaimer section — stub in FU-035-D. Real implementation in FU-035-G
 * (TipTap rich-text editor + per-tenant HTML stored in section_config.disclaimer.html).
 * Toggling this section ON in D has no visible effect.
 */
export default function Disclaimer() {
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add components/pdf/sections/CommodityDetails.js components/pdf/sections/Signature.js components/pdf/sections/Disclaimer.js
git commit -m "feat(pdf): stub CommodityDetails / Signature / Disclaimer sections for D2/G (FU-035-D)"
```

---

## Task 9: Composer rewrite — `DeliveryOrderTemplate.js` `renderSection` switch

**Files:**
- Modify: `components/pdf/DeliveryOrderTemplate.js` (full `renderSection` + render-loop rewrite)

- [ ] **Step 1: Rewrite `DeliveryOrderTemplate.js`**

Replace the entire file `components/pdf/DeliveryOrderTemplate.js` with:

```js
import React from 'react';
import { Document, Page } from '@react-pdf/renderer';
import Header from './sections/Header';
import { typography } from './shared/typography';
import {
  getSectionsForDocumentType,
  computeVisibility,
} from '../../lib/constants/document-sections';
import DeliveryOrderDetails from './sections/DeliveryOrderDetails';
import AddressDetails from './sections/AddressDetails';
import OrderDetails from './sections/OrderDetails';
import Notes from './sections/Notes';
import CommodityDetails from './sections/CommodityDetails';
import Signature from './sections/Signature';
import Disclaimer from './sections/Disclaimer';
import MoveBlock from './sections/MoveBlock';
import BarcodeBlock from './sections/BarcodeBlock';
import DocumentFooter from './sections/DocumentFooter';

/**
 * Build the per-section data subsets the new components expect from the
 * shared `doc` payload. In FU-035-D, this is mostly a re-shape of the
 * data the old per-section components received; new fields with no data
 * source today (logo, locations, weight, etc.) are passed as null.
 */
function buildSectionData(doc) {
  const lm = doc.load_metadata || {};
  const eq = doc.equipment_details || {};
  const ap = doc.appointment_details || {};
  const hz = doc.hazmat_details || {};
  const inst = doc.instructions || {};
  const firstMove = (doc.moves || [])[0] || {};

  return {
    header: {
      tenantName: doc.tenant_name,
      tenantInfo: doc.tenant_info || {},  // logo_url / address / phone / website — populated in D2/F
    },
    delivery_order_details: {
      delivery_order_number: lm.load_number,
      pickup_number:         eq.pickup_number,
      driver_name:           firstMove.driver_name,
      delivery_appointment:  ap.delivery_appt_number,
      reference_number:      lm.customer_reference,
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
      pickup_location:   null, // D2
      delivery_location: null, // D2
      return_location:   null, // D2
      appointment_times: {
        pickup:   ap.pickup_appt_number,
        delivery: ap.delivery_appt_number,
      },
      is_operational_street_turn: doc.is_operational_street_turn || false,
    },
    order_details: {
      reference_number:      lm.customer_reference,
      booking_bl:            eq.booking_number || eq.bl_number,
      mbol:                  eq.mbol_number,
      hbol:                  eq.hbol_number,
      container_number:      eq.container_number || lm.container_number,
      container_size:        eq.container_size,
      container_type:        eq.container_type,
      chassis_number:        eq.chassis_number || lm.chassis_number,
      chassis_size:          eq.chassis_size,
      chassis_type:          eq.chassis_type,
      chassis_owner:         eq.chassis_owner,
      steamship_line:        eq.steamship_line,
      seal:                  eq.seal_number,
      hazmat:                hz.hazmat_class ? `${hz.un_code || ''} ${hz.hazmat_class}`.trim() : null,
      pickup_number:         eq.pickup_number,
      pull_container_date:   ap.pull_container_date,
      return_container_date: ap.return_container_date,
      last_free_day:         ap.last_free_day,
      per_diem_free_day:     ap.per_diem_free_day,
    },
    notes: {
      driver_notes:   inst.driver_notes,
      yard_notes:     null, // D2 / data layer FU
      customer_notes: null, // D2
      billing_notes:  null, // D2
      load_notes:     inst.special_instructions,
    },
  };
}

function renderSection(sectionId, doc, sectionData, opts, ctx) {
  switch (sectionId) {
    case 'header':
      return (
        <Header
          tenantName={sectionData.header.tenantName}
          tenantInfo={sectionData.header.tenantInfo}
          title={ctx.title}
          subtitle={ctx.subtitle}
          opts={opts}
        />
      );
    case 'delivery_order_details':
      return <DeliveryOrderDetails data={sectionData.delivery_order_details} opts={opts} />;
    case 'address_details':
      return <AddressDetails data={sectionData.address_details} opts={opts} />;
    case 'order_details':
      return <OrderDetails data={sectionData.order_details} opts={opts} />;
    case 'move_events':
      return (
        <MoveBlock
          data={{ moves: doc.moves }}
          opts={opts}
          isNextMoveOnly={ctx.variant === 'delivery_order_next_move'}
          totalMoves={doc.total_moves_in_load}
        />
      );
    case 'commodity_details': return <CommodityDetails />;
    case 'notes':              return <Notes data={sectionData.notes} opts={opts} />;
    case 'signature':          return <Signature />;
    case 'disclaimer':         return <Disclaimer />;
    case 'barcode':            return <BarcodeBlock data={doc.load_metadata} />;
    case 'footer':             return <DocumentFooter data={{ tenant_name: doc.tenant_name }} />;
    default:                   return null;
  }
}

export default function DeliveryOrderTemplate({
  docs,
  variant,
  sectionConfig,
  perDocSectionConfigs,
}) {
  const registrySections = getSectionsForDocumentType(variant);

  return (
    <Document>
      {(docs || []).map((doc, idx) => {
        const cfg = perDocSectionConfigs?.[idx] ?? sectionConfig;
        const { visibility, fields } = computeVisibility(registrySections, cfg);
        const order = cfg?.order || registrySections.map((s) => s.id);
        const sectionData = buildSectionData(doc);

        const ctx = {
          variant,
          title: 'DELIVERY ORDER',
          subtitle: variant === 'delivery_order_next_move' ? 'Next Move' : null,
        };

        return (
          <Page key={doc.order_id} size="LETTER" style={typography.page} wrap>
            {order.map((sectionId) => {
              if (!visibility[sectionId]) return null;
              const baseOpts = cfg?.perSection?.[sectionId] || {};
              const opts = { ...baseOpts, fields: fields[sectionId] || {} };
              // move_events still wants the legacy show_driver flag for now —
              // in D, it's controlled by delivery_order_details.fields.driver_name
              // (the visible toggle). Wire it through:
              if (sectionId === 'move_events') {
                opts.show_driver = fields.delivery_order_details?.driver_name !== false;
              }
              const node = renderSection(sectionId, doc, sectionData, opts, ctx);
              return node ? <React.Fragment key={sectionId}>{node}</React.Fragment> : null;
            })}
          </Page>
        );
      })}
    </Document>
  );
}
```

- [ ] **Step 2: Verify the build still completes**

Run: `npm run build 2>&1 | tail -40`
Expected: build succeeds. Pay attention to any "Module not found" errors — they mean an import path is wrong.

If the build is slow (>2 min) skip and rely on Task 11 manual verification.

- [ ] **Step 3: Commit**

```bash
git add components/pdf/DeliveryOrderTemplate.js
git commit -m "feat(pdf): rewrite DeliveryOrderTemplate composer for hierarchical sections (FU-035-D)"
```

---

## Task 10: Refactor `TemplateEditor.js` for nested toggles

**Files:**
- Modify: `components/settings/document-designer/TemplateEditor.js` (full rewrite)

- [ ] **Step 1: Rewrite `TemplateEditor.js`**

Replace `components/settings/document-designer/TemplateEditor.js` with:

```js
import { useEffect, useState } from 'react';
import { Save, RotateCcw, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { getSectionsForDocumentType } from '../../../lib/constants/document-sections';

/**
 * Editor for a single document_templates row. Renders each section as a
 * collapsible card with a master toggle + 2-col grid of child field toggles.
 *
 * State shape:
 *   visibility: { [sectionId]: boolean }   — master toggle per section
 *   fields:     { [sectionId]: { [fieldId]: boolean } }  — field toggles
 *
 * Save serializes back to:
 *   { visibility: {...}, perSection: { [id]: { fields: {...} } } }
 *
 * Default-true for any unspecified field (handled both at compute and render).
 */
function buildInitialState(sections, sectionConfig) {
  const visibility = {};
  const fields = {};
  for (const s of sections) {
    if (!s.toggleable) {
      visibility[s.id] = true;
    } else {
      const v = sectionConfig?.visibility?.[s.id];
      visibility[s.id] = v === undefined ? s.defaultVisible : v;
    }
    if (s.fields) {
      const overrides = sectionConfig?.perSection?.[s.id]?.fields || {};
      const resolved = {};
      for (const f of s.fields) {
        const v = overrides[f.id];
        resolved[f.id] = v === undefined ? f.defaultVisible : v;
      }
      fields[s.id] = resolved;
    }
  }
  return { visibility, fields };
}

export default function TemplateEditor({
  template,
  onSaved,
  onDeleted,
  showDelete = false,
  onError,
}) {
  const sections = getSectionsForDocumentType(template.document_type);

  const [{ visibility, fields }, setState] = useState(() =>
    buildInitialState(sections, template.section_config)
  );
  const [savedState, setSavedState] = useState(() =>
    buildInitialState(sections, template.section_config)
  );
  const [collapsed, setCollapsed] = useState({}); // { [sectionId]: true } when collapsed
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const initial = buildInitialState(sections, template.section_config);
    setState(initial);
    setSavedState(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.section_config, template.id]);

  const isDirty =
    JSON.stringify({ visibility, fields }) !== JSON.stringify(savedState);

  function toggleMaster(sectionId) {
    setState((prev) => ({
      ...prev,
      visibility: { ...prev.visibility, [sectionId]: !prev.visibility[sectionId] },
    }));
  }

  function toggleField(sectionId, fieldId) {
    setState((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [sectionId]: {
          ...prev.fields[sectionId],
          [fieldId]: !prev.fields[sectionId]?.[fieldId],
        },
      },
    }));
  }

  function toggleCollapsed(sectionId) {
    setCollapsed((c) => ({ ...c, [sectionId]: !c[sectionId] }));
  }

  function reset() {
    setState(savedState);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    onError?.(null);
    try {
      const visibilityToSend = Object.fromEntries(
        sections
          .filter((s) => s.toggleable)
          .map((s) => [s.id, visibility[s.id]])
      );
      const perSectionToSend = {};
      for (const s of sections) {
        if (s.fields) {
          perSectionToSend[s.id] = {
            fields: Object.fromEntries(
              s.fields.map((f) => [f.id, fields[s.id]?.[f.id] ?? f.defaultVisible])
            ),
          };
        }
      }
      const sectionConfigToSend = {
        visibility: visibilityToSend,
        perSection: perSectionToSend,
      };
      const isNew = !template.id;
      const url = isNew
        ? '/api/tenant/document-templates'
        : `/api/tenant/document-templates/${template.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const body = isNew
        ? {
            customer_id: template.customer_id || null,
            document_type: template.document_type,
            section_config: sectionConfigToSend,
          }
        : { section_config: sectionConfigToSend };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSavedState({ visibility, fields });
      onSaved?.(data.template);
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate() {
    if (busy || !template.id) return;
    if (
      !confirm(
        'Delete this customer override? Loads for this customer will fall back to the tenant default.'
      )
    ) return;
    setBusy(true);
    onError?.(null);
    try {
      const res = await fetch(
        `/api/tenant/document-templates/${template.id}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      onDeleted?.();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {sections.map((s) => (
          <SectionCard
            key={s.id}
            section={s}
            masterChecked={visibility[s.id]}
            fieldsState={fields[s.id] || {}}
            collapsed={!!collapsed[s.id]}
            busy={busy}
            onToggleMaster={() => toggleMaster(s.id)}
            onToggleField={(fid) => toggleField(s.id, fid)}
            onToggleCollapsed={() => toggleCollapsed(s.id)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-gray-200 dark:border-slate-700">
        <button
          type="button"
          onClick={save}
          disabled={!isDirty || busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium"
        >
          <Save className="w-4 h-4" />
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!isDirty || busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 dark:text-slate-300 text-sm font-medium"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </button>
        {showDelete && template.id ? (
          <button
            type="button"
            onClick={deleteTemplate}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 text-red-600 dark:text-red-400 text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SectionCard({
  section,
  masterChecked,
  fieldsState,
  collapsed,
  busy,
  onToggleMaster,
  onToggleField,
  onToggleCollapsed,
}) {
  const hasFields = Array.isArray(section.fields) && section.fields.length > 0;
  const masterDisabled = busy || !section.toggleable;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5 bg-gray-50/60 dark:bg-slate-800/40">
        {section.toggleable ? (
          <input
            type="checkbox"
            checked={!!masterChecked}
            onChange={onToggleMaster}
            disabled={masterDisabled}
            className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
          />
        ) : (
          <span className="w-4 h-4 inline-block rounded border-2 border-gray-400 dark:border-slate-500 bg-gray-200 dark:bg-slate-700" />
        )}
        <span className="text-sm font-medium text-gray-900 dark:text-slate-100 flex-1">
          {section.label}
        </span>
        {!section.toggleable ? (
          <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 dark:text-slate-400 bg-gray-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">
            Always on
          </span>
        ) : null}
        {hasFields ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        ) : null}
      </div>
      {hasFields && !collapsed ? (
        <div
          className={`grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 border-t border-gray-200 dark:border-slate-800 ${
            !masterChecked ? 'opacity-50' : ''
          }`}
        >
          {section.fields.map((f) => (
            <label
              key={f.id}
              className={`flex items-center gap-2 text-sm ${
                !masterChecked || busy ? 'cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={!!fieldsState[f.id]}
                onChange={() => onToggleField(f.id)}
                disabled={!masterChecked || busy}
                className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-gray-900 dark:text-slate-100">{f.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Manual sanity check via dev server**

Run: `npm run dev` in a separate terminal (or use the Preview MCP).

Navigate to `/settings/document-designer/delivery_order_full` in the browser. Verify:
1. Each section renders as a card with a master toggle + label + collapse arrow.
2. Sections with children show 2-col grid below the header when expanded.
3. Footer section shows "Always on" badge instead of toggle.
4. Toggling master OFF disables the child toggles (checkboxes greyed).
5. Clicking a child toggle changes its state.
6. Save button enables on first change, disables after save.

If the page errors out, the most likely causes are: import path mismatch (`getSectionsForDocumentType` from new location), section_config shape mismatch in the API (Task 2 migration not applied yet — can't proceed without that).

- [ ] **Step 3: Commit**

```bash
git add components/settings/document-designer/TemplateEditor.js
git commit -m "feat(settings): nested-toggle TemplateEditor with collapsible parent + child grid (FU-035-D)"
```

---

## Task 11: dd-qa skill + manual verification

**Files:** none changed (verification only)

- [ ] **Step 1: Run the dd-qa skill on the touched files**

Invoke the dd-qa skill via Skill tool.

The skill scope: `lib/constants/document-sections.js`, `components/settings/document-designer/TemplateEditor.js`, `components/pdf/DeliveryOrderTemplate.js`, all new files in `components/pdf/sections/`.

- [ ] **Step 2: Address any critical findings from dd-qa**

If dd-qa reports field-consistency issues (e.g., sidebar references a removed section ID), fix them inline with appropriate commits per finding.

- [ ] **Step 3: Manual end-to-end test (user-facing)**

Tell the user verbatim:

> "Implementation complete. Please test end-to-end:
> 1. Navigate to `/settings/document-designer/delivery_order_full`.
> 2. Verify the editor shows the new PortPro-mirror tree (Header, Delivery Order Details, Address Details, Move Events, Order Details, Commodity Details, Notes, Signature, Disclaimer, Barcode, Footer).
> 3. Toggle a child field off (e.g., Order Details > Seal #). Save.
> 4. Reload the page. Verify the toggle is still off.
> 5. Bulk-print a Delivery Order PDF. Verify it still renders correctly (visual changes are expected to be minimal in D — the toggles are mostly soft until D2).
> 6. Repeat for `/settings/document-designer/delivery_order_next_move` to confirm both variants work.
> 7. If you have any saved customer overrides, expand one and verify it loaded with sensible toggle defaults from the migration.
> 
> Any issues, screenshot + describe and I'll fix."

- [ ] **Step 4: Update `memory/followups.md`**

Update the FU-035-D entry to "RESOLVED" status. Mark FU-035-D2 as "next" with the spec's §13 forward-path notes.

Run: invoke `update-followups` skill to reconcile the ledger.

- [ ] **Step 5: Final commit (if any)**

```bash
# Only if dd-qa or manual test produced fixes — otherwise skip.
git status
# If clean, no commit needed.
```

---

## Notes for the implementing agent

- **Task 2 (migration) blocks Tasks 9-10 functionally.** Don't run Task 9's PDF render through with un-migrated rows — the composer will read `cfg.visibility.address_details` and find nothing because the row still has `cfg.visibility.bill_to`. If you reach Task 9 and the user hasn't applied the migration yet, surface that and pause.
- **TDD scope:** Task 1 has real unit tests; Tasks 3-10 lack a test harness for React-PDF + React UI in this codebase, so verification is build-success + manual-browser per the spec §10.
- **Existing legacy components** (`BillTo.js`, `EquipmentDetails.js`, `HazmatDetails.js`, `Instructions.js`, `AppointmentDetails.js`, `LoadMetadata.js`, `CustomerContact.js`, `SignatureBlock.js`) are NOT deleted in this plan. They stay on disk through D. D2 deletes them once the new components fully cover their data needs.
- **`computeVisibility` signature changed** — the function now returns `{ visibility, fields }` instead of `Record<id, boolean>`. The only consumer is `DeliveryOrderTemplate.js`, which Task 9 updates. Grep for any other callers before Task 1 commits to be safe: `grep -rn computeVisibility lib/ components/ pages/`. Expected match: only `DeliveryOrderTemplate.js`.
- **Dark mode:** every UI class added in Task 10 includes a `dark:` variant per `dev_dark_mode_convention`.
- **Conventions to follow during edits:** `dev_migration_template.md` (BEGIN/COMMIT + NOTIFY pgrst), `dev_dark_mode_convention.md`.
